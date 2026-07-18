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

// List — owner видит все, branch_owner передаёт свой onlyID (сервер сам решает,
// какой id подставить, исходя из claims, а не из query-параметра).
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
