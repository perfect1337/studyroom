package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/contracts-service/internal/models"
)

type ContractRepository struct {
	pool *pgxpool.Pool
}

func NewContractRepository(pool *pgxpool.Pool) *ContractRepository {
	return &ContractRepository{pool: pool}
}

const contractColumns = `id, contract_number, student_id, parent_id, course_id, branch_id, amount, payment_status, status, start_date, end_date, created_at, deleted_at, deleted_by`

func scanContract(row pgx.Row) (*models.Contract, error) {
	var c models.Contract
	err := row.Scan(
		&c.ID, &c.ContractNumber, &c.StudentID, &c.ParentID, &c.CourseID, &c.BranchID,
		&c.Amount, &c.PaymentStatus, &c.Status, &c.StartDate, &c.EndDate, &c.CreatedAt, &c.DeletedAt, &c.DeletedBy,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &c, nil
}

// Create — POST /contracts (api-contracts.md 3.1). status=active,
// payment_status=unpaid по умолчанию. contract_number генерируется сразу
// после вставки (нужен id) в формате SR-{год start_date}-{4 цифры id}.
func (r *ContractRepository) Create(ctx context.Context, studentID, parentID, courseID, branchID int64, amount float64, startDate, endDate time.Time) (*models.Contract, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var id int64
	err = tx.QueryRow(ctx, `
		INSERT INTO contracts (contract_number, student_id, parent_id, course_id, branch_id, amount, start_date, end_date)
		VALUES ('', $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		studentID, parentID, courseID, branchID, amount, startDate, endDate,
	).Scan(&id)
	if err != nil {
		return nil, err
	}

	number := fmt.Sprintf("SR-%d-%04d", startDate.Year(), id)

	row := tx.QueryRow(ctx,
		`UPDATE contracts SET contract_number = $1 WHERE id = $2 RETURNING `+contractColumns,
		number, id)
	c, err := scanContract(row)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return c, nil
}

func (r *ContractRepository) GetByID(ctx context.Context, id int64) (*models.Contract, error) {
	query := `SELECT ` + contractColumns + ` FROM contracts WHERE id = $1 AND deleted_at IS NULL`
	return scanContract(r.pool.QueryRow(ctx, query, id))
}

type ListFilter struct {
	BranchID  *int64
	StudentID *int64
	Status    string
}

// List — GET /contracts?branch_id=&student_id=&status= (api-contracts.md 3.2), owner-only.
func (r *ContractRepository) List(ctx context.Context, f ListFilter) ([]*models.Contract, error) {
	query := `SELECT ` + contractColumns + ` FROM contracts WHERE deleted_at IS NULL`
	args := []any{}
	i := 1
	if f.BranchID != nil {
		query += fmt.Sprintf(" AND branch_id = $%d", i)
		args = append(args, *f.BranchID)
		i++
	}
	if f.StudentID != nil {
		query += fmt.Sprintf(" AND student_id = $%d", i)
		args = append(args, *f.StudentID)
		i++
	}
	if f.Status != "" {
		query += fmt.Sprintf(" AND status = $%d", i)
		args = append(args, f.Status)
		i++
	}
	query += " ORDER BY id DESC"

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Contract
	for rows.Next() {
		c, err := scanContract(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ListByStudentIDs — договоры для набора student_id (используется для
// родителя: список договоров всех его детей, см. ContractHandler.ListMine).
// Пустой/nil studentIDs — пустой результат, а не «все договоры».
func (r *ContractRepository) ListByStudentIDs(ctx context.Context, studentIDs []int64) ([]*models.Contract, error) {
	if len(studentIDs) == 0 {
		return []*models.Contract{}, nil
	}
	query := `SELECT ` + contractColumns + ` FROM contracts WHERE student_id = ANY($1) AND deleted_at IS NULL ORDER BY id DESC`
	rows, err := r.pool.Query(ctx, query, studentIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Contract
	for rows.Next() {
		c, err := scanContract(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// UpdateFields — PATCH /contracts/{id} (api-contracts.md 3.4): end_date и/или amount.
func (r *ContractRepository) UpdateFields(ctx context.Context, id int64, startDate, endDate *time.Time, amount *float64) (*models.Contract, error) {
	query := `UPDATE contracts SET
		start_date = COALESCE($1, start_date),
		end_date = COALESCE($2, end_date),
		amount = COALESCE($3, amount)
		WHERE id = $4 RETURNING ` + contractColumns
	return scanContract(r.pool.QueryRow(ctx, query, startDate, endDate, amount, id))
}

// UpdateStatus — PATCH /contracts/{id}/status (api-contracts.md 3.5).
func (r *ContractRepository) UpdateStatus(ctx context.Context, id int64, status string) error {
	tag, err := r.pool.Exec(ctx, `UPDATE contracts SET status = $1 WHERE id = $2`, status, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdatePaymentStatus — PATCH /contracts/{id}/payment-status (api-contracts.md 3.6).
func (r *ContractRepository) UpdatePaymentStatus(ctx context.Context, id int64, paymentStatus string) error {
	tag, err := r.pool.Exec(ctx, `UPDATE contracts SET payment_status = $1 WHERE id = $2`, paymentStatus, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CompleteActiveByStudent — переводит ВСЕ активные договоры ученика в
// status='completed'. Используется при выпуске/удалении ученика (см.
// user.deleted в user-service/internal/promotion) — в отличие от
// Academic Service, где данные ученика (enrollments/homework/tests)
// физически удаляются, здесь договор НЕ удаляется: amount/payment_status —
// финансово-бухгалтерские данные, их потеря стирала бы историю платежей.
// 'completed', а не 'terminated' — ученик закончил обучение штатно
// (11 класс/выпуск), а не разорвал договор досрочно.
func (r *ContractRepository) CompleteActiveByStudent(ctx context.Context, studentID int64) (int64, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE contracts SET status = 'completed' WHERE student_id = $1 AND status = 'active' AND deleted_at IS NULL`,
		studentID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (r *ContractRepository) Delete(ctx context.Context, id int64, deletedBy int64) error {
	tag, err := r.pool.Exec(ctx, `UPDATE contracts SET deleted_at = now(), deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL`, id, deletedBy)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ContractStats contains owner-wide counters. Deleted contracts are retained
// for audit/statistics but excluded from normal contract lists.
type ContractStats struct {
	Total         int64   `json:"total"`
	Active        int64   `json:"active"`
	Completed     int64   `json:"completed"`
	Terminated    int64   `json:"terminated"`
	Deleted       int64   `json:"deleted"`
	DeletedAmount float64 `json:"deleted_amount"`
}

func (r *ContractRepository) Stats(ctx context.Context) (*ContractStats, error) {
	var stats ContractStats
	err := r.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE deleted_at IS NULL),
			COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'active'),
			COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'completed'),
			COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'terminated'),
			COUNT(*) FILTER (WHERE deleted_at IS NOT NULL),
			COALESCE(SUM(amount) FILTER (WHERE deleted_at IS NOT NULL), 0)
		FROM contracts
	`).Scan(&stats.Total, &stats.Active, &stats.Completed, &stats.Terminated, &stats.Deleted, &stats.DeletedAmount)
	if err != nil {
		return nil, err
	}
	return &stats, nil
}

// ListExpiringSoon — договоры со статусом active, у которых end_date попадает
// в ближайшие withinDays дней и уведомление ещё не отправлялось
// (expiry_notified_at IS NULL). Используется фоновой джобой в cmd/api/main.go,
// публикующей contract.expiring_soon — механизм триггера не описан в
// api-contracts.md/event-schema.md, реализован как периодическая проверка
// (см. README.md, "Что ещё не сделано").
func (r *ContractRepository) ListExpiringSoon(ctx context.Context, withinDays int) ([]*models.Contract, error) {
	query := `SELECT ` + contractColumns + ` FROM contracts
		WHERE status = 'active'
		AND expiry_notified_at IS NULL
		AND end_date <= CURRENT_DATE + ($1 * INTERVAL '1 day')
		ORDER BY end_date ASC`
	rows, err := r.pool.Query(ctx, query, withinDays)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Contract
	for rows.Next() {
		c, err := scanContract(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ExpireDue marks active contracts whose end date has passed as completed.
// The end date is inclusive: a contract ending today is valid through today
// and becomes completed on the following day.
func (r *ContractRepository) ExpireDue(ctx context.Context) ([]*models.Contract, error) {
	rows, err := r.pool.Query(ctx, `
		UPDATE contracts
		SET status = 'completed'
		WHERE status = 'active' AND deleted_at IS NULL AND end_date < CURRENT_DATE
		RETURNING `+contractColumns)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Contract
	for rows.Next() {
		c, err := scanContract(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *ContractRepository) MarkExpiryNotified(ctx context.Context, id int64) error {
	_, err := r.pool.Exec(ctx, `UPDATE contracts SET expiry_notified_at = now() WHERE id = $1 AND deleted_at IS NULL`, id)
	return err
}
