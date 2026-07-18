package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/notification-service/internal/models"
)

// UserRefRepository — облегчённая копия пользователей (id, email), нужна
// только чтобы знать, на какой email слать письма, не дёргая User Service
// синхронно на каждую отправку. Наполняется событиями user.created/user.updated
// (см. internal/events) либо вручную через POST /internal/users/sync.
type UserRefRepository struct {
	pool *pgxpool.Pool
}

func NewUserRefRepository(pool *pgxpool.Pool) *UserRefRepository {
	return &UserRefRepository{pool: pool}
}

func (r *UserRefRepository) Upsert(ctx context.Context, u *models.UserRef) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO users_ref (id, email, first_name, last_name, updated_at)
		VALUES ($1,$2,$3,$4, now())
		ON CONFLICT (id) DO UPDATE SET
			email = EXCLUDED.email,
			first_name = EXCLUDED.first_name,
			last_name = EXCLUDED.last_name,
			updated_at = now()`,
		u.ID, u.Email, u.FirstName, u.LastName)
	return err
}

func (r *UserRefRepository) GetByID(ctx context.Context, id int64) (*models.UserRef, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT id, email, first_name, last_name FROM users_ref WHERE id = $1`, id)

	var u models.UserRef
	err := row.Scan(&u.ID, &u.Email, &u.FirstName, &u.LastName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}
