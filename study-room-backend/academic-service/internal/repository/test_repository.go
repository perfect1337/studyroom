package repository

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/academic-service/internal/models"
)

type TestRepository struct {
	pool *pgxpool.Pool
}

func NewTestRepository(pool *pgxpool.Pool) *TestRepository {
	return &TestRepository{pool: pool}
}

const testColumns = `t.id, t.student_id, t.created_by, t.title, t.link_url, t.status, t.grade, t.submitted_at, t.graded_at, t.created_at, t.course_id, c.title, c.subject`

// testFrom — общий FROM/JOIN для всех SELECT'ов теста: LEFT JOIN, потому
// что course_id nullable (тест мог быть выдан без привязки к курсу, или
// курс с тех пор удалили — см. ON DELETE SET NULL в 0004_tests_course).
const testFrom = `FROM tests t LEFT JOIN courses c ON c.id = t.course_id`

func scanTest(row pgx.Row) (*models.Test, error) {
	var t models.Test
	err := row.Scan(&t.ID, &t.StudentID, &t.CreatedBy, &t.Title, &t.LinkURL, &t.Status, &t.Grade, &t.SubmittedAt, &t.GradedAt, &t.CreatedAt, &t.CourseID, &t.CourseTitle, &t.CourseSubject)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}

func (r *TestRepository) Create(ctx context.Context, studentID, createdBy int64, title, linkURL string, courseID *int64) (*models.Test, error) {
	query := `WITH ins AS (
			INSERT INTO tests (student_id, created_by, title, link_url, status, course_id)
			VALUES ($1,$2,$3,$4,'assigned',$5) RETURNING *
		) SELECT ` + testColumns + ` FROM ins t LEFT JOIN courses c ON c.id = t.course_id`
	return scanTest(r.pool.QueryRow(ctx, query, studentID, createdBy, title, linkURL, courseID))
}

func (r *TestRepository) GetByID(ctx context.Context, id int64) (*models.Test, error) {
	query := `SELECT ` + testColumns + ` ` + testFrom + ` WHERE t.id = $1`
	return scanTest(r.pool.QueryRow(ctx, query, id))
}

// TestFilter — тот же паттерн, что HomeworkFilter (см. homework_repository.go).
type TestFilter struct {
	StudentID  *int64
	StudentIDs []int64
	CreatedBy  *int64
}

func (r *TestRepository) List(ctx context.Context, f TestFilter) ([]*models.Test, error) {
	where := "WHERE 1=1"
	args := []any{}
	i := 1
	if len(f.StudentIDs) > 0 {
		where += " AND t.student_id = ANY($" + itoa(i) + ")"
		args = append(args, f.StudentIDs)
		i++
	} else if f.StudentID != nil {
		where += " AND t.student_id = $" + itoa(i)
		args = append(args, *f.StudentID)
		i++
	}
	if f.CreatedBy != nil {
		where += " AND t.created_by = $" + itoa(i)
		args = append(args, *f.CreatedBy)
		i++
	}
	query := "SELECT " + testColumns + " " + testFrom + " " + where + " ORDER BY t.id DESC"

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Test
	for rows.Next() {
		t, err := scanTest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Submit — ученик отмечает тест сданным. Идемпотентно: повторная сдача не
// затирает исходный submitted_at (аналог MarkViewed у homework).
func (r *TestRepository) Submit(ctx context.Context, id int64) (*models.Test, error) {
	query := `WITH upd AS (
			UPDATE tests SET
				status = 'submitted',
				submitted_at = COALESCE(submitted_at, $2)
			WHERE id = $1 RETURNING *
		) SELECT ` + testColumns + ` FROM upd t LEFT JOIN courses c ON c.id = t.course_id`
	return scanTest(r.pool.QueryRow(ctx, query, id, time.Now()))
}

// SetGrade — тьютор выставляет/меняет оценку за тест (1..5). Оценку можно
// ставить и менять в любой момент после сдачи; статус при этом не трогаем.
func (r *TestRepository) SetGrade(ctx context.Context, id int64, grade int) (*models.Test, error) {
	query := `WITH upd AS (
			UPDATE tests SET
				grade = $2,
				graded_at = $3
			WHERE id = $1 RETURNING *
		) SELECT ` + testColumns + ` FROM upd t LEFT JOIN courses c ON c.id = t.course_id`
	return scanTest(r.pool.QueryRow(ctx, query, id, grade, time.Now()))
}
