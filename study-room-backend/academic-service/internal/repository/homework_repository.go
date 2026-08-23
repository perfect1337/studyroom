package repository

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/academic-service/internal/models"
)

type HomeworkRepository struct {
	pool *pgxpool.Pool
}

func NewHomeworkRepository(pool *pgxpool.Pool) *HomeworkRepository {
	return &HomeworkRepository{pool: pool}
}

const homeworkColumns = `id, student_id, created_by, link_url, status, viewed_at, created_at`

func scanHomework(row pgx.Row) (*models.Homework, error) {
	var h models.Homework
	err := row.Scan(&h.ID, &h.StudentID, &h.CreatedBy, &h.LinkURL, &h.Status, &h.ViewedAt, &h.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &h, nil
}

func (r *HomeworkRepository) Create(ctx context.Context, studentID, createdBy int64, linkURL string) (*models.Homework, error) {
	query := `INSERT INTO homework (student_id, created_by, link_url, status)
		VALUES ($1,$2,$3,'assigned') RETURNING ` + homeworkColumns
	return scanHomework(r.pool.QueryRow(ctx, query, studentID, createdBy, linkURL))
}

func (r *HomeworkRepository) GetByID(ctx context.Context, id int64) (*models.Homework, error) {
	query := `SELECT ` + homeworkColumns + ` FROM homework WHERE id = $1`
	return scanHomework(r.pool.QueryRow(ctx, query, id))
}

// HomeworkFilter — student_id/created_by как в контракте 2.13.
type HomeworkFilter struct {
	StudentID *int64
	// StudentIDs — фильтр "IN (...)" для parent с несколькими детьми,
	// взаимоисключим со StudentID (см. EnrollmentFilter для того же паттерна).
	StudentIDs []int64
	CreatedBy  *int64
}

func (r *HomeworkRepository) List(ctx context.Context, f HomeworkFilter) ([]*models.Homework, error) {
	where := "WHERE 1=1"
	args := []any{}
	i := 1
	if len(f.StudentIDs) > 0 {
		where += " AND student_id = ANY($" + strconv.Itoa(i) + ")"
		args = append(args, f.StudentIDs)
		i++
	} else if f.StudentID != nil {
		where += " AND student_id = $" + strconv.Itoa(i)
		args = append(args, *f.StudentID)
		i++
	}
	if f.CreatedBy != nil {
		where += " AND created_by = $" + strconv.Itoa(i)
		args = append(args, *f.CreatedBy)
		i++
	}
	query := "SELECT " + homeworkColumns + " FROM homework " + where + " ORDER BY id DESC"

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Homework
	for rows.Next() {
		h, err := scanHomework(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// MarkViewed — переводит домашку в статус viewed и фиксирует время открытия.
// Идемпотентно: повторное открытие не затирает исходный viewed_at
// (см. api-contracts.md 2.14 — "открыть" фиксируется один раз).
func (r *HomeworkRepository) MarkViewed(ctx context.Context, id int64) (*models.Homework, error) {
	query := `UPDATE homework SET
			status = 'viewed',
			viewed_at = COALESCE(viewed_at, $2)
		WHERE id = $1 RETURNING ` + homeworkColumns
	return scanHomework(r.pool.QueryRow(ctx, query, id, time.Now()))
}

// DeleteByStudent — удаляет все домашние задания выпустившегося/удалённого
// ученика. См. events/subscriber.go, detachStudent.
func (r *HomeworkRepository) DeleteByStudent(ctx context.Context, studentID int64) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM homework WHERE student_id = $1`, studentID)
	return err
}
