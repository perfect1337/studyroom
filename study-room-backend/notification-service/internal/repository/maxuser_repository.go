package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/notification-service/internal/models"
)

// MaxUserRepository — связка MAX user_id с user_id в системе.
// Полный аналог TelegramUserRepository, но для мессенджера MAX
// (таблица max_users, миграция 0008).
type MaxUserRepository struct {
	pool *pgxpool.Pool
}

func NewMaxUserRepository(pool *pgxpool.Pool) *MaxUserRepository {
	return &MaxUserRepository{pool: pool}
}

func (r *MaxUserRepository) Upsert(ctx context.Context, tu *models.MaxUser) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO max_users (max_user_id, max_username, user_id, created_at, updated_at)
		VALUES ($1, $2, $3, now(), now())
		ON CONFLICT (max_user_id) DO UPDATE SET
			max_username = COALESCE(EXCLUDED.max_username, max_users.max_username),
			user_id = EXCLUDED.user_id,
			updated_at = now()`,
		tu.MaxUserID, tu.MaxUsername, tu.UserID)
	return err
}

func (r *MaxUserRepository) GetByMaxUserID(ctx context.Context, maxUserID int64) (*models.MaxUser, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT id, max_user_id, max_username, user_id, created_at, updated_at FROM max_users WHERE max_user_id = $1`, maxUserID)

	var tu models.MaxUser
	err := row.Scan(&tu.ID, &tu.MaxUserID, &tu.MaxUsername, &tu.UserID, &tu.CreatedAt, &tu.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil // не найдено — не ErrNotFound
		}
		return nil, err
	}
	return &tu, nil
}

func (r *MaxUserRepository) GetByUserID(ctx context.Context, userID int64) (*models.MaxUser, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT id, max_user_id, max_username, user_id, created_at, updated_at FROM max_users WHERE user_id = $1`, userID)

	var tu models.MaxUser
	err := row.Scan(&tu.ID, &tu.MaxUserID, &tu.MaxUsername, &tu.UserID, &tu.CreatedAt, &tu.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &tu, nil
}

// DeleteByUserID — отвязка MAX от аккаунта (кнопка "Отвязать MAX").
// Возвращает true, если запись реально существовала и была удалена —
// false, если пользователь и так не был привязан (идемпотентно).
func (r *MaxUserRepository) DeleteByUserID(ctx context.Context, userID int64) (bool, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM max_users WHERE user_id = $1`, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
