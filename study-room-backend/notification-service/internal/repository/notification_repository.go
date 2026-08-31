package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/notification-service/internal/models"
)

var ErrNotFound = errors.New("not found")

type NotificationRepository struct {
	pool *pgxpool.Pool
}

func NewNotificationRepository(pool *pgxpool.Pool) *NotificationRepository {
	return &NotificationRepository{pool: pool}
}

const notificationColumns = `id, user_id, type, channel, message, status, is_read, error, created_at`

func scanNotification(row pgx.Row) (*models.Notification, error) {
	var n models.Notification
	err := row.Scan(&n.ID, &n.UserID, &n.Type, &n.Channel, &n.Message, &n.Status,
		&n.IsRead, &n.Error, &n.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &n, nil
}

// Create создаёт уведомление в статусе pending — сама отправка (email/sms/...)
// выполняется отдельным шагом в handlers/сервисе, после чего статус обновляется.
func (r *NotificationRepository) Create(ctx context.Context, n *models.Notification) (*models.Notification, error) {
	query := `INSERT INTO notifications (user_id, type, channel, message, status)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING ` + notificationColumns

	row := r.pool.QueryRow(ctx, query, n.UserID, n.Type, n.Channel, n.Message, n.Status)
	return scanNotification(row)
}

func (r *NotificationRepository) UpdateStatus(ctx context.Context, id int64, status models.Status, errMsg *string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE notifications SET status = $1, error = $2 WHERE id = $3`,
		status, errMsg, id)
	return err
}

// ListByUser — уведомления конкретного пользователя для колокольчика,
// опционально только непрочитанные.
//
// Фильтр по channel = 'in_app' — принципиально: строки с channel в
// (email/telegram/whatsapp/max) создаются в Notifier.Send для КАЖДОГО
// включённого внешнего канала отдельно (это трекинг реальной доставки,
// см. Notifier.createAndQueueJob), и раньше ListByUser отдавала их все —
// пользователь с несколькими включёнными каналами видел в колокольчике
// один и тот же текст продублированным по числу каналов. channel='in_app'
// создаётся Notifier.Send ровно один раз на событие, безусловно (см.
// ChannelInApp в internal/models) — это и есть то, что должен показывать
// колокольчик.
func (r *NotificationRepository) ListByUser(ctx context.Context, userID int64, unreadOnly bool) ([]*models.Notification, error) {
	query := `SELECT ` + notificationColumns + ` FROM notifications WHERE user_id = $1 AND channel = 'in_app'`
	args := []any{userID}
	if unreadOnly {
		query += ` AND is_read = false`
	}
	query += ` ORDER BY created_at DESC LIMIT 200`

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*models.Notification
	for rows.Next() {
		n, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, n)
	}
	return result, rows.Err()
}

// MarkRead помечает уведомление прочитанным, но только если оно принадлежит userID —
// защита от того, чтобы один пользователь мог отметить чужое уведомление.
func (r *NotificationRepository) MarkRead(ctx context.Context, id, userID int64) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
		id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
