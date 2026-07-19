package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/academic-service/internal/models"
)

type EnrollmentRepository struct {
	pool *pgxpool.Pool
}

func NewEnrollmentRepository(pool *pgxpool.Pool) *EnrollmentRepository {
	return &EnrollmentRepository{pool: pool}
}

const enrollmentColumns = `id, student_id, course_id, tutor_id, progress_pct, status, start_date, end_date, created_at`

func scanEnrollment(row pgx.Row) (*models.Enrollment, error) {
	var e models.Enrollment
	err := row.Scan(&e.ID, &e.StudentID, &e.CourseID, &e.TutorID, &e.ProgressPct,
		&e.Status, &e.StartDate, &e.EndDate, &e.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &e, nil
}

// Create — ручное создание записи (POST /enrollments), см. api-contracts.md 2.4.
// Статус и прогресс всегда стартуют как active/0 — соответствует контракту.
func (r *EnrollmentRepository) Create(ctx context.Context, studentID, courseID int64) (*models.Enrollment, error) {
	query := `INSERT INTO enrollments (student_id, course_id, status, progress_pct)
		VALUES ($1,$2,'active',0) RETURNING ` + enrollmentColumns
	return scanEnrollment(r.pool.QueryRow(ctx, query, studentID, courseID))
}

// CreateFromContract — автоматическое создание по событию contract.created
// (см. internal/events/subscriber.go и api-contracts.md 2.4, примечание).
// startDate/endDate/tutorID опциональны — приходят из тела договора, если есть.
func (r *EnrollmentRepository) CreateFromContract(
	ctx context.Context, studentID, courseID int64, tutorID *int64, startDate, endDate *string,
) (*models.Enrollment, error) {
	query := `INSERT INTO enrollments (student_id, course_id, tutor_id, status, progress_pct, start_date, end_date)
		VALUES ($1,$2,$3,'active',0,$4,$5) RETURNING ` + enrollmentColumns
	return scanEnrollment(r.pool.QueryRow(ctx, query, studentID, courseID, tutorID, startDate, endDate))
}

func (r *EnrollmentRepository) GetByID(ctx context.Context, id int64) (*models.Enrollment, error) {
	query := `SELECT ` + enrollmentColumns + ` FROM enrollments WHERE id = $1`
	return scanEnrollment(r.pool.QueryRow(ctx, query, id))
}

// EnrollmentFilter — student_id/tutor_id/course_id как в query-параметрах
// контракта 2.5. BranchID — не часть публичного контракта, а внутренний
// фильтр для branch_owner (джойн по courses.branch_id), проставляется
// сервером принудительно, а не пользователем.
type EnrollmentFilter struct {
	StudentID  *int64
	// StudentIDs — фильтр "IN (...)", используется для parent с несколькими
	// детьми (см. handlers.EnrollmentHandler.List). Взаимоисключим со StudentID:
	// если задан StudentIDs, StudentID игнорируется.
	StudentIDs []int64
	TutorID    *int64
	CourseID   *int64
	BranchID   *int64
}

func (r *EnrollmentRepository) List(ctx context.Context, f EnrollmentFilter) ([]*models.Enrollment, error) {
	query := `SELECT e.id, e.student_id, e.course_id, e.tutor_id, e.progress_pct, e.status,
		e.start_date, e.end_date, e.created_at
		FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE 1=1`
	args := []any{}
	i := 1
	if len(f.StudentIDs) > 0 {
		query += " AND e.student_id = ANY($" + itoa(i) + ")"
		args = append(args, f.StudentIDs)
		i++
	} else if f.StudentID != nil {
		query += " AND e.student_id = $" + itoa(i)
		args = append(args, *f.StudentID)
		i++
	}
	if f.TutorID != nil {
		query += " AND e.tutor_id = $" + itoa(i)
		args = append(args, *f.TutorID)
		i++
	}
	if f.CourseID != nil {
		query += " AND e.course_id = $" + itoa(i)
		args = append(args, *f.CourseID)
		i++
	}
	if f.BranchID != nil {
		query += " AND c.branch_id = $" + itoa(i)
		args = append(args, *f.BranchID)
		i++
	}
	query += " ORDER BY e.id"

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Enrollment
	for rows.Next() {
		e, err := scanEnrollment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *EnrollmentRepository) AssignTutor(ctx context.Context, id, tutorID int64) (*models.Enrollment, error) {
	query := `UPDATE enrollments SET tutor_id = $1 WHERE id = $2 RETURNING ` + enrollmentColumns
	return scanEnrollment(r.pool.QueryRow(ctx, query, tutorID, id))
}

func (r *EnrollmentRepository) UpdateProgress(ctx context.Context, id int64, fields map[string]any) (*models.Enrollment, error) {
	if len(fields) == 0 {
		return r.GetByID(ctx, id)
	}
	allowedCols := map[string]bool{"progress_pct": true, "status": true, "start_date": true, "end_date": true}
	setClauses := ""
	args := []any{}
	i := 1
	for col, val := range fields {
		if !allowedCols[col] {
			continue
		}
		if i > 1 {
			setClauses += ", "
		}
		setClauses += col + " = $" + itoa(i)
		args = append(args, val)
		i++
	}
	if len(args) == 0 {
		return r.GetByID(ctx, id)
	}
	args = append(args, id)
	query := "UPDATE enrollments SET " + setClauses + " WHERE id = $" + itoa(i) + " RETURNING " + enrollmentColumns
	return scanEnrollment(r.pool.QueryRow(ctx, query, args...))
}

// CourseBranchID — вспомогательный запрос для авторизации (branch_owner
// может назначать репетитора только на записи курсов своего филиала).
func (r *EnrollmentRepository) CourseBranchID(ctx context.Context, courseID int64) (int64, error) {
	var branchID int64
	err := r.pool.QueryRow(ctx, `SELECT branch_id FROM courses WHERE id = $1`, courseID).Scan(&branchID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return branchID, nil
}
