package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/academic-service/internal/models"
)

type AttendanceRepository struct {
	pool *pgxpool.Pool
}

func NewAttendanceRepository(pool *pgxpool.Pool) *AttendanceRepository {
	return &AttendanceRepository{pool: pool}
}

const attendanceColumns = `id, lesson_id, student_id, status, absence_reason`

func scanAttendance(row pgx.Row) (*models.Attendance, error) {
	var a models.Attendance
	err := row.Scan(&a.ID, &a.LessonID, &a.StudentID, &a.Status, &a.AbsenceReason)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &a, nil
}

// Mark — отметить посещаемость одного ученика на занятии. Идемпотентно:
// повторная отметка того же (lesson_id, student_id) перезаписывает статус
// (см. api-contracts.md 2.10, UNIQUE(lesson_id, student_id) в миграции).
func (r *AttendanceRepository) Mark(ctx context.Context, lessonID, studentID int64, status models.AttendanceStatus, reason *string) (*models.Attendance, error) {
	query := `INSERT INTO attendance (lesson_id, student_id, status, absence_reason)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (lesson_id, student_id) DO UPDATE SET
			status = EXCLUDED.status, absence_reason = EXCLUDED.absence_reason
		RETURNING ` + attendanceColumns
	return scanAttendance(r.pool.QueryRow(ctx, query, lessonID, studentID, status, reason))
}

func (r *AttendanceRepository) ListByLesson(ctx context.Context, lessonID int64) ([]*models.Attendance, error) {
	query := `SELECT ` + attendanceColumns + ` FROM attendance WHERE lesson_id = $1 ORDER BY id`
	rows, err := r.pool.Query(ctx, query, lessonID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Attendance
	for rows.Next() {
		a, err := scanAttendance(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
