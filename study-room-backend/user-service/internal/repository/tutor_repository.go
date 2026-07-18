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

func (r *TutorProfileRepository) SetStatus(ctx context.Context, userID int64, status models.TutorStatus) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO tutor_profiles (user_id, status) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status
	`, userID, status)
	return err
}

// Upsert создаёт/обновляет профиль репетитора (specialization + status).
func (r *TutorProfileRepository) Upsert(ctx context.Context, userID int64, specialization string, status models.TutorStatus) error {
	var spec *string
	if specialization != "" {
		spec = &specialization
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO tutor_profiles (user_id, specialization, status)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE SET
			specialization = COALESCE(EXCLUDED.specialization, tutor_profiles.specialization),
			status = EXCLUDED.status
	`, userID, spec, status)
	return err
}

type StudentProfileRepository struct {
	pool *pgxpool.Pool
}

func NewStudentProfileRepository(pool *pgxpool.Pool) *StudentProfileRepository {
	return &StudentProfileRepository{pool: pool}
}

func (r *StudentProfileRepository) Upsert(ctx context.Context, userID int64, classInfo, school *string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO student_profiles (user_id, class_info, school)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE SET
			class_info = EXCLUDED.class_info,
			school = EXCLUDED.school
	`, userID, classInfo, school)
	return err
}
