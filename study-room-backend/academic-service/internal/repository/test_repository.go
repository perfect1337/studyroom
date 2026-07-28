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

const testColumns = `id, student_id, created_by, title, link_url, status, grade, submitted_at, graded_at, created_at`

func scanTest(row pgx.Row) (*models.Test, error) {
	var t models.Test
	err := row.Scan(&t.ID, &t.StudentID, &t.CreatedBy, &t.Title, &t.LinkURL, &t.Status, &t.Grade, &t.SubmittedAt, &t.GradedAt, &t.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}

func (r *TestRepository) Create(ctx context.Context, studentID, createdBy int64, title, linkURL string) (*models.Test, error) {
	query := `INSERT INTO tests (student_id, created_by, title, link_url, status)
		VALUES ($1,$2,$3,$4,'assigned') RETURNING ` + testColumns
	return scanTest(r.pool.QueryRow(ctx, query, studentID, createdBy, title, linkURL))
}

func (r *TestRepository) GetByID(ctx context.Context, id int64) (*models.Test, error) {
	query := `SELECT ` + testColumns + ` FROM tests WHERE id = $1`
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
		where += " AND student_id = ANY($" + itoa(i) + ")"
		args = append(args, f.StudentIDs)
		i++
	} else if f.StudentID != nil {
		where += " AND student_id = $" + itoa(i)
		args = append(args, *f.StudentID)
		i++
	}
	if f.CreatedBy != nil {
		where += " AND created_by = $" + itoa(i)
		args = append(args, *f.CreatedBy)
		i++
	}
	query := "SELECT " + testColumns + " FROM tests " + where + " ORDER BY id DESC"

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
	query := `UPDATE tests SET
			status = 'submitted',
			submitted_at = COALESCE(submitted_at, $2)
		WHERE id = $1 RETURNING ` + testColumns
	return scanTest(r.pool.QueryRow(ctx, query, id, time.Now()))
}

// SetGrade — тьютор выставляет/меняет оценку за тест (1..5). Оценку можно
// ставить и менять в любой момент после сдачи; статус при этом не трогаем.
func (r *TestRepository) SetGrade(ctx context.Context, id int64, grade int) (*models.Test, error) {
	query := `UPDATE tests SET
			grade = $2,
			graded_at = $3
		WHERE id = $1 RETURNING ` + testColumns
	return scanTest(r.pool.QueryRow(ctx, query, id, grade, time.Now()))
}
