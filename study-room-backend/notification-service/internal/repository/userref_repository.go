package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/notification-service/internal/models"
)

// UserRefRepository — облегчённая копия пользователей из User Service.
// Хранит не только email, но и контакты для мессенджеров (phone, telegram_id,
// whatsapp_id), чтобы Notification Service мог резолвать получателя для
// любого канала доставки, не обращаясь к User Service.
type UserRefRepository struct {
	pool *pgxpool.Pool
}

func NewUserRefRepository(pool *pgxpool.Pool) *UserRefRepository {
	return &UserRefRepository{pool: pool}
}

func (r *UserRefRepository) Upsert(ctx context.Context, u *models.UserRef) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO users_ref (id, email, first_name, last_name, parent_id, phone, telegram_id, whatsapp_id, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
		ON CONFLICT (id) DO UPDATE SET
			email = EXCLUDED.email,
			first_name = CASE WHEN EXCLUDED.first_name = '' THEN users_ref.first_name ELSE EXCLUDED.first_name END,
			last_name = CASE WHEN EXCLUDED.last_name = '' THEN users_ref.last_name ELSE EXCLUDED.last_name END,
			parent_id = COALESCE(EXCLUDED.parent_id, users_ref.parent_id),
			phone = COALESCE(EXCLUDED.phone, users_ref.phone),
			telegram_id = COALESCE(EXCLUDED.telegram_id, users_ref.telegram_id),
			whatsapp_id = COALESCE(EXCLUDED.whatsapp_id, users_ref.whatsapp_id),
			updated_at = now()`,
		u.ID, u.Email, u.FirstName, u.LastName, u.ParentID, u.Phone, u.TelegramID, u.WhatsAppID)
	return err
}

// UpsertFromUserService — то же самое, что Upsert, но специально для
// событий user.created/user.updated, которые публикует User Service (см.
// events/subscriber.go, upsertUserRef). User Service вообще не знает о
// существовании telegram_id/whatsapp_id — эти поля целиком принадлежат
// Notification Service (заполняются только через TelegramBot.handleText
// при привязке бота, см. messenger/telegram_bot.go). Раньше здесь
// использовался общий Upsert с `COALESCE(EXCLUDED.telegram_id,
// users_ref.telegram_id)` — но COALESCE защищает только от SQL NULL, а не
// от пустой строки: поле TelegramID в Go — обычный string, его нулевое
// значение "" (а не nil), и evt.TelegramID из user.updated ВСЕГДА "" (в
// payload user-service такого поля просто нет). В итоге каждое
// user.updated (смена имени/телефона и т.п. — вообще любое обновление
// профиля) молча затирало уже привязанный telegram_id/whatsapp_id на "" —
// бот оставался "подключён" (таблица telegram_users не трогалась), но
// notifier.Send() переставал слать в Telegram, т.к. проверяет именно
// ref.TelegramID != "". Здесь telegram_id/whatsapp_id вообще не участвуют
// в UPDATE — синхронизация из User Service их не касается.
func (r *UserRefRepository) UpsertFromUserService(ctx context.Context, u *models.UserRef) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO users_ref (id, email, first_name, last_name, parent_id, phone, telegram_id, whatsapp_id, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,'','', now())
		ON CONFLICT (id) DO UPDATE SET
			email = EXCLUDED.email,
			first_name = CASE WHEN EXCLUDED.first_name = '' THEN users_ref.first_name ELSE EXCLUDED.first_name END,
			last_name = CASE WHEN EXCLUDED.last_name = '' THEN users_ref.last_name ELSE EXCLUDED.last_name END,
			parent_id = COALESCE(EXCLUDED.parent_id, users_ref.parent_id),
			phone = COALESCE(NULLIF(EXCLUDED.phone, ''), users_ref.phone),
			updated_at = now()`,
		u.ID, u.Email, u.FirstName, u.LastName, u.ParentID, u.Phone)
	return err
}

func (r *UserRefRepository) GetByID(ctx context.Context, id int64) (*models.UserRef, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT id, email, first_name, last_name, parent_id, phone, telegram_id, whatsapp_id FROM users_ref WHERE id = $1`, id)

	var u models.UserRef
	err := row.Scan(&u.ID, &u.Email, &u.FirstName, &u.LastName, &u.ParentID, &u.Phone, &u.TelegramID, &u.WhatsAppID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (r *UserRefRepository) GetByEmail(ctx context.Context, email string) (*models.UserRef, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT id, email, first_name, last_name, parent_id, phone, telegram_id, whatsapp_id FROM users_ref WHERE LOWER(email) = LOWER($1)`, email)

	var u models.UserRef
	err := row.Scan(&u.ID, &u.Email, &u.FirstName, &u.LastName, &u.ParentID, &u.Phone, &u.TelegramID, &u.WhatsAppID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

// ClearTelegramID — очищает telegram_id при отвязке бота (см.
// NotificationHandler.UnlinkTelegram). Без этого повторное включение
// telegram_enabled без повторной привязки бота попыталось бы слать на
// старый, уже недействительный chat_id.
func (r *UserRefRepository) ClearTelegramID(ctx context.Context, userID int64) error {
	_, err := r.pool.Exec(ctx, `UPDATE users_ref SET telegram_id = '', updated_at = now() WHERE id = $1`, userID)
	return err
}
