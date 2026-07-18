package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/notification-service/internal/models"
)

type SettingsRepository struct {
	pool *pgxpool.Pool
}

func NewSettingsRepository(pool *pgxpool.Pool) *SettingsRepository {
	return &SettingsRepository{pool: pool}
}

// GetOrDefault возвращает настройки пользователя, а если их ещё нет — дефолтные
// (email включён, остальное выключено), не создавая строку в БД.
func (r *SettingsRepository) GetOrDefault(ctx context.Context, userID int64) (*models.Settings, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT user_id, email_enabled, sms_enabled, messenger_enabled
		 FROM notification_settings WHERE user_id = $1`, userID)

	var s models.Settings
	err := row.Scan(&s.UserID, &s.EmailEnabled, &s.SMSEnabled, &s.MessengerEnabled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &models.Settings{UserID: userID, EmailEnabled: true}, nil
		}
		return nil, err
	}
	return &s, nil
}

// Upsert создаёт или обновляет настройки одним запросом (INSERT ... ON CONFLICT).
func (r *SettingsRepository) Upsert(ctx context.Context, s *models.Settings) (*models.Settings, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO notification_settings (user_id, email_enabled, sms_enabled, messenger_enabled)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (user_id) DO UPDATE SET
			email_enabled = EXCLUDED.email_enabled,
			sms_enabled = EXCLUDED.sms_enabled,
			messenger_enabled = EXCLUDED.messenger_enabled
		RETURNING user_id, email_enabled, sms_enabled, messenger_enabled`,
		s.UserID, s.EmailEnabled, s.SMSEnabled, s.MessengerEnabled)

	var out models.Settings
	if err := row.Scan(&out.UserID, &out.EmailEnabled, &out.SMSEnabled, &out.MessengerEnabled); err != nil {
		return nil, err
	}
	return &out, nil
}
