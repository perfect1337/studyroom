package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/notification-service/internal/models"
)

type TelegramUserRepository struct {
	pool *pgxpool.Pool
}

func NewTelegramUserRepository(pool *pgxpool.Pool) *TelegramUserRepository {
	return &TelegramUserRepository{pool: pool}
}

func (r *TelegramUserRepository) Upsert(ctx context.Context, tu *models.TelegramUser) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO telegram_users (telegram_chat_id, telegram_username, user_id, created_at, updated_at)
		VALUES ($1, $2, $3, now(), now())
		ON CONFLICT (telegram_chat_id) DO UPDATE SET
			telegram_username = COALESCE(EXCLUDED.telegram_username, telegram_users.telegram_username),
			user_id = EXCLUDED.user_id,
			updated_at = now()`,
		tu.TelegramChatID, tu.TelegramUsername, tu.UserID)
	return err
}

func (r *TelegramUserRepository) GetByChatID(ctx context.Context, chatID int64) (*models.TelegramUser, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT id, telegram_chat_id, telegram_username, user_id, created_at, updated_at FROM telegram_users WHERE telegram_chat_id = $1`, chatID)

	var tu models.TelegramUser
	err := row.Scan(&tu.ID, &tu.TelegramChatID, &tu.TelegramUsername, &tu.UserID, &tu.CreatedAt, &tu.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil // не найдено — не ErrNotFound
		}
		return nil, err
	}
	return &tu, nil
}

func (r *TelegramUserRepository) GetByUserID(ctx context.Context, userID int64) (*models.TelegramUser, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT id, telegram_chat_id, telegram_username, user_id, created_at, updated_at FROM telegram_users WHERE user_id = $1`, userID)

	var tu models.TelegramUser
	err := row.Scan(&tu.ID, &tu.TelegramChatID, &tu.TelegramUsername, &tu.UserID, &tu.CreatedAt, &tu.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &tu, nil
}

func (r *TelegramUserRepository) GetUserIDByChatID(ctx context.Context, chatID int64) (int64, error) {
	var userID int64
	err := r.pool.QueryRow(ctx, `SELECT user_id FROM telegram_users WHERE telegram_chat_id = $1`, chatID).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	return userID, nil
}

// DeleteByUserID — отвязка Telegram от аккаунта (кнопка "Отвязать Telegram"
// в /settings). Возвращает true, если запись реально существовала и была
// удалена — false, если пользователь и так не был привязан (идемпотентно,
// не ошибка).
func (r *TelegramUserRepository) DeleteByUserID(ctx context.Context, userID int64) (bool, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM telegram_users WHERE user_id = $1`, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
