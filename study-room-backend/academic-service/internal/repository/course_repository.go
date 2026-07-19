package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/academic-service/internal/models"
)

type CourseRepository struct {
	pool *pgxpool.Pool
}

func NewCourseRepository(pool *pgxpool.Pool) *CourseRepository {
	return &CourseRepository{pool: pool}
}

const courseColumns = `id, title, subject, format, description, branch_id, created_at`

func scanCourse(row pgx.Row) (*models.Course, error) {
	var c models.Course
	err := row.Scan(&c.ID, &c.Title, &c.Subject, &c.Format, &c.Description, &c.BranchID, &c.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &c, nil
}

func (r *CourseRepository) Create(ctx context.Context, c *models.Course) (*models.Course, error) {
	query := `INSERT INTO courses (title, subject, format, description, branch_id)
		VALUES ($1,$2,$3,$4,$5) RETURNING ` + courseColumns
	row := r.pool.QueryRow(ctx, query, c.Title, c.Subject, c.Format, c.Description, c.BranchID)
	return scanCourse(row)
}

func (r *CourseRepository) GetByID(ctx context.Context, id int64) (*models.Course, error) {
	query := `SELECT ` + courseColumns + ` FROM courses WHERE id = $1`
	return scanCourse(r.pool.QueryRow(ctx, query, id))
}

// CourseFilter — branch_id обязателен для всех ролей кроме owner
// (проверяется в handlers, см. api-contracts.md 2.1). subject — опциональный
// ILIKE-фильтр.
type CourseFilter struct {
	BranchID *int64
	Subject  string
}

func (r *CourseRepository) List(ctx context.Context, f CourseFilter) ([]*models.Course, error) {
	where := "WHERE 1=1"
	args := []any{}
	i := 1
	if f.BranchID != nil {
		where += " AND branch_id = $" + itoa(i)
		args = append(args, *f.BranchID)
		i++
	}
	if f.Subject != "" {
		where += " AND subject ILIKE $" + itoa(i)
		args = append(args, "%"+f.Subject+"%")
		i++
	}
	query := "SELECT " + courseColumns + " FROM courses " + where + " ORDER BY id"

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Course
	for rows.Next() {
		c, err := scanCourse(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *CourseRepository) Update(ctx context.Context, id int64, fields map[string]any) (*models.Course, error) {
	if len(fields) == 0 {
		return r.GetByID(ctx, id)
	}
	allowedCols := map[string]bool{
		"title": true, "subject": true, "format": true, "description": true, "branch_id": true,
	}
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
	query := "UPDATE courses SET " + setClauses + " WHERE id = $" + itoa(i) + " RETURNING " + courseColumns
	return scanCourse(r.pool.QueryRow(ctx, query, args...))
}

func (r *CourseRepository) Delete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM courses WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func itoa(i int) string {
	digits := "0123456789"
	if i < 10 {
		return string(digits[i])
	}
	return string(digits[i/10]) + string(digits[i%10])
}
