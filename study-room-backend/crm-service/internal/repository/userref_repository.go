package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/crm-service/internal/models"
)

var ErrNotFound = errors.New("not found")

// UserRefRepository — облегчённая копия пользователей (user_refs),
// наполняется событиями user.created/user.updated (см. internal/events).
// Нужна, чтобы резолвить владельца/владельца филиала, которому нужно
// уведомление о новой заявке (application.received), без синхронного
// похода в User Service на каждую заявку (см. microservices-plan.md, 2.4).
type UserRefRepository struct {
	pool *pgxpool.Pool
}

func NewUserRefRepository(pool *pgxpool.Pool) *UserRefRepository {
	return &UserRefRepository{pool: pool}
}

func (r *UserRefRepository) Upsert(ctx context.Context, u *models.UserRef) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO user_refs (user_id, full_name, role, branch_id, synced_at)
		VALUES ($1,$2,$3,$4, now())
		ON CONFLICT (user_id) DO UPDATE SET
			full_name = CASE WHEN EXCLUDED.full_name = '' THEN user_refs.full_name ELSE EXCLUDED.full_name END,
			role = CASE WHEN EXCLUDED.role = '' THEN user_refs.role ELSE EXCLUDED.role END,
			branch_id = EXCLUDED.branch_id,
			synced_at = now()`,
		u.UserID, u.FullName, u.Role, u.BranchID)
	return err
}

func (r *UserRefRepository) GetByID(ctx context.Context, id int64) (*models.UserRef, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT user_id, full_name, role, branch_id FROM user_refs WHERE user_id = $1`, id)

	var u models.UserRef
	err := row.Scan(&u.UserID, &u.FullName, &u.Role, &u.BranchID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

// FindBranchOwner — первый branch_owner найденного филиала (детерминированно
// по возрастанию user_id), либо nil, если такого ещё нет в user_refs.
func (r *UserRefRepository) FindBranchOwner(ctx context.Context, branchID int64) (*models.UserRef, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT user_id, full_name, role, branch_id FROM user_refs
		 WHERE role = 'branch_owner' AND branch_id = $1
		 ORDER BY user_id LIMIT 1`, branchID)

	var u models.UserRef
	err := row.Scan(&u.UserID, &u.FullName, &u.Role, &u.BranchID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

// FindAnyOwner — первый owner (владелец всей сети филиалов), детерминированно
// по возрастанию user_id. Фолбэк, когда у заявки нет branch_id (вебхук с
// Tilda не знает филиал) или для этого филиала ещё нет branch_owner в кэше.
func (r *UserRefRepository) FindAnyOwner(ctx context.Context) (*models.UserRef, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT user_id, full_name, role, branch_id FROM user_refs
		 WHERE role = 'owner'
		 ORDER BY user_id LIMIT 1`)

	var u models.UserRef
	err := row.Scan(&u.UserID, &u.FullName, &u.Role, &u.BranchID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}
