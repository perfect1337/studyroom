package repository

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/user-service/internal/models"
)

type TutorProfileRepository struct {
	pool *pgxpool.Pool
}

func NewTutorProfileRepository(pool *pgxpool.Pool) *TutorProfileRepository {
	return &TutorProfileRepository{pool: pool}
}

// EnsureExists создаёт пустой профиль при первом обращении (например,
// при первой смене статуса, если профиль ещё не был создан явно).
func (r *TutorProfileRepository) SetStatus(ctx context.Context, userID int64, status models.TutorStatus) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO tutor_profiles (user_id, status) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status
	`, userID, status)
	return err
}
