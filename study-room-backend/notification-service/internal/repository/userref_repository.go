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
		`SELECT id, email, first_name, last_name, parent_id, phone, telegram_id, whatsapp_id FROM users_ref WHERE email = $1`, email)

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
