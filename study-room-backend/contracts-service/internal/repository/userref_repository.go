package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/contracts-service/internal/models"
)

var ErrNotFound = errors.New("not found")

// UserRefRepository — облегчённая копия пользователей (user_refs),
// наполняется событиями user.created/user.updated (см. internal/events).
// Используется в ApplicationHandler.Create только для мягкой валидации
// (см. README.md) — авторизация по ролям идёт через JWT claims и
// internal/userclient, этот кэш их не заменяет.
type UserRefRepository struct {
	pool *pgxpool.Pool
}

func NewUserRefRepository(pool *pgxpool.Pool) *UserRefRepository {
	return &UserRefRepository{pool: pool}
}

func (r *UserRefRepository) Upsert(ctx context.Context, u *models.UserRef) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO user_refs (user_id, full_name, role, branch_id, synced_at)
		VALUES ($1,$2,$3,$4, now())
		ON CONFLICT (user_id) DO UPDATE SET
			full_name = CASE WHEN EXCLUDED.full_name = '' THEN user_refs.full_name ELSE EXCLUDED.full_name END,
			role = CASE WHEN EXCLUDED.role = '' THEN user_refs.role ELSE EXCLUDED.role END,
			branch_id = EXCLUDED.branch_id,
			synced_at = now()`,
		u.UserID, u.FullName, u.Role, u.BranchID)
	return err
}

func (r *UserRefRepository) GetByID(ctx context.Context, id int64) (*models.UserRef, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT user_id, full_name, role, branch_id FROM user_refs WHERE user_id = $1`, id)

	var u models.UserRef
	err := row.Scan(&u.UserID, &u.FullName, &u.Role, &u.BranchID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}
