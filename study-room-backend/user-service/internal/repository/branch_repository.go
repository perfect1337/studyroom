package repository

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/user-service/internal/models"
)

type BranchRepository struct {
	pool *pgxpool.Pool
}

func NewBranchRepository(pool *pgxpool.Pool) *BranchRepository {
	return &BranchRepository{pool: pool}
}

func (r *BranchRepository) Create(ctx context.Context, b *models.Branch) (*models.Branch, error) {
	query := `INSERT INTO branches (name, city, address, phone) VALUES ($1,$2,$3,$4)
		RETURNING id, name, city, address, phone, created_at`
	row := r.pool.QueryRow(ctx, query, b.Name, b.City, b.Address, b.Phone)
	var created models.Branch
	err := row.Scan(&created.ID, &created.Name, &created.City, &created.Address, &created.Phone, &created.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &created, nil
}

// Delete — "удаляет" филиал по id. С 0004_branch_soft_delete это мягкое
// удаление: строка branches НЕ стирается физически, а помечается
// deleted_at, чтобы owner мог позже открыть филиал в разделе "Удалённые"
// и посмотреть, какие преподаватели/ученики там были (см. GET
// /branches/deleted и GET /users?branch_id=...).
//
// В той же транзакции полностью удаляются (хард-делит, вместе со всеми
// зависимыми строками — refresh_tokens и т.п. через ON DELETE CASCADE)
// аккаунты руководителей филиала (role=branch_owner), привязанных к этому
// branch_id — по требованию: раз филиал закрывается, у него больше нет
// своего руководителя, и его учётная запись не должна продолжать
// существовать. Обычные преподаватели и ученики филиала НЕ удаляются —
// они остаются в базе с тем же branch_id (теперь указывающим на
// "удалённый" филиал), чтобы их можно было посмотреть в разделе
// "Удалённые".
//
// Возвращает ErrNotFound, если филиала с таким id не существует или он уже
// удалён — обработчик сам решает, каким статусом на это ответить.
func (r *BranchRepository) Delete(ctx context.Context, id int64) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx,
		`UPDATE branches SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM users WHERE branch_id = $1 AND role = 'branch_owner'`, id); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// List — без onlyID возвращает все активные (не удалённые) филиалы (для
// owner). onlyID оставлен на случай точечной выборки внутри сервиса —
// например, CreateBranchOwner проверяет, что branch_id существует и ещё не
// удалён, прежде чем создавать руководителя.
func (r *BranchRepository) List(ctx context.Context, onlyID *int64) ([]*models.Branch, error) {
	query := `SELECT id, name, city, address, phone, created_at, deleted_at FROM branches WHERE deleted_at IS NULL`
	args := []any{}
	if onlyID != nil {
		query += ` AND id = $1`
		args = append(args, *onlyID)
	}
	query += ` ORDER BY id`

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var branches []*models.Branch
	for rows.Next() {
		var b models.Branch
		if err := rows.Scan(&b.ID, &b.Name, &b.City, &b.Address, &b.Phone, &b.CreatedAt, &b.DeletedAt); err != nil {
			return nil, err
		}
		branches = append(branches, &b)
	}
	return branches, rows.Err()
}

// ListDeleted — филиалы в "корзине" (раздел "Удалённые" на вкладке
// "Филиалы"). Нужны, чтобы owner мог посмотреть, какие преподаватели и
// ученики были в закрытом филиале — сам список людей запрашивается
// отдельно через GET /users?branch_id=<id этого филиала>, т.к. branch_id
// у них никуда не делся.
func (r *BranchRepository) ListDeleted(ctx context.Context) ([]*models.Branch, error) {
	query := `SELECT id, name, city, address, phone, created_at, deleted_at
		FROM branches WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`

	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var branches []*models.Branch
	for rows.Next() {
		var b models.Branch
		if err := rows.Scan(&b.ID, &b.Name, &b.City, &b.Address, &b.Phone, &b.CreatedAt, &b.DeletedAt); err != nil {
			return nil, err
		}
		branches = append(branches, &b)
	}
	return branches, rows.Err()
}
