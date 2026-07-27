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

// Delete — удаляет филиал по id. Пользователи, привязанные к филиалу
// (branch_id), не удаляются — FK branches(id) настроен ON DELETE SET NULL
// (см. миграцию 0001_init.up.sql), поэтому они просто останутся без филиала.
// Возвращает ErrNotFound, если филиала с таким id не существует — обработчик
// сам решает, каким статусом на это ответить.
func (r *BranchRepository) Delete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM branches WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// List — без onlyID возвращает все филиалы (для owner).
// onlyID оставлен на случай точечной выборки внутри сервиса.
func (r *BranchRepository) List(ctx context.Context, onlyID *int64) ([]*models.Branch, error) {
	query := `SELECT id, name, city, address, phone, created_at FROM branches`
	args := []any{}
	if onlyID != nil {
		query += ` WHERE id = $1`
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
		if err := rows.Scan(&b.ID, &b.Name, &b.City, &b.Address, &b.Phone, &b.CreatedAt); err != nil {
			return nil, err
		}
		branches = append(branches, &b)
	}
	return branches, rows.Err()
}
