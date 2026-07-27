package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/crm-service/internal/models"
)

type ApplicationRepository struct {
	pool *pgxpool.Pool
}

func NewApplicationRepository(pool *pgxpool.Pool) *ApplicationRepository {
	return &ApplicationRepository{pool: pool}
}

const applicationColumns = `id, source, status, name, age, phone, subject_interest, parent_name, student_id, format, branch_id, handled_by, created_at`

func scanApplication(row pgx.Row) (*models.Application, error) {
	var a models.Application
	err := row.Scan(
		&a.ID, &a.Source, &a.Status, &a.Name, &a.Age, &a.Phone, &a.SubjectInterest,
		&a.ParentName, &a.StudentID, &a.Format, &a.BranchID, &a.HandledBy, &a.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &a, nil
}

// CreateFromWebhook — заявка с сайта (Tilda), см. api-contracts.md 4.1.
// source=tilda, status=new, branch_id всегда nil (вебхук филиал не знает —
// см. event-schema.md, "v1.application.received").
func (r *ApplicationRepository) CreateFromWebhook(ctx context.Context, name string, age *int, phone, subjectInterest, parentName *string) (*models.Application, error) {
	query := `INSERT INTO applications (source, status, name, age, phone, subject_interest, parent_name)
		VALUES ('tilda', 'new', $1, $2, $3, $4, $5) RETURNING ` + applicationColumns
	row := r.pool.QueryRow(ctx, query, name, age, phone, subjectInterest, parentName)
	return scanApplication(row)
}

// CreateInternal — заявка из ЛК родителя ("Записаться на новый курс"),
// см. api-contracts.md 4.2. source=internal, status=new.
// parentName/phone — контактные данные родителя, оформившего заявку (может
// быть nil, если фронт/кэш user_refs их не передали — см. application_handler.go).
func (r *ApplicationRepository) CreateInternal(ctx context.Context, name string, studentID int64, subjectInterest, format *string, branchID *int64, parentName, phone *string) (*models.Application, error) {
	query := `INSERT INTO applications (source, status, name, subject_interest, student_id, format, branch_id, parent_name, phone)
		VALUES ('internal', 'new', $1, $2, $3, $4, $5, $6, $7) RETURNING ` + applicationColumns
	row := r.pool.QueryRow(ctx, query, name, subjectInterest, studentID, format, branchID, parentName, phone)
	return scanApplication(row)
}

func (r *ApplicationRepository) GetByID(ctx context.Context, id int64) (*models.Application, error) {
	query := `SELECT ` + applicationColumns + ` FROM applications WHERE id = $1`
	return scanApplication(r.pool.QueryRow(ctx, query, id))
}

// List — GET /applications?status= (api-contracts.md 4.3), owner-only на
// уровне роутера. status пуст — все заявки.
func (r *ApplicationRepository) List(ctx context.Context, status string) ([]*models.Application, error) {
	query := `SELECT ` + applicationColumns + ` FROM applications`
	args := []any{}
	if status != "" {
		query += ` WHERE status = $1`
		args = append(args, status)
	}
	query += ` ORDER BY id DESC`

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Application
	for rows.Next() {
		a, err := scanApplication(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// UpdateStatus — PATCH /applications/{id} (api-contracts.md 4.4).
func (r *ApplicationRepository) UpdateStatus(ctx context.Context, id int64, status string, handledBy *int64) (*models.Application, error) {
	query := `UPDATE applications SET status = $1, handled_by = COALESCE($2, handled_by)
		WHERE id = $3 RETURNING ` + applicationColumns
	return scanApplication(r.pool.QueryRow(ctx, query, status, handledBy, id))
}

func (r *ApplicationRepository) Delete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM applications WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
