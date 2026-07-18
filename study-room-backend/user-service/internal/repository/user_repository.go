package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/user-service/internal/models"
)

var ErrNotFound = errors.New("not found")
var ErrDuplicate = errors.New("already exists")

type UserRepository struct {
	pool *pgxpool.Pool
}

func NewUserRepository(pool *pgxpool.Pool) *UserRepository {
	return &UserRepository{pool: pool}
}

const userColumns = `id, email, phone, password_hash, role, last_name, first_name,
	patronymic, avatar_url, branch_id, is_active, created_at, updated_at`

func scanUser(row pgx.Row) (*models.User, error) {
	var u models.User
	err := row.Scan(&u.ID, &u.Email, &u.Phone, &u.PasswordHash, &u.Role, &u.LastName,
		&u.FirstName, &u.Patronymic, &u.AvatarURL, &u.BranchID, &u.IsActive,
		&u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) Create(ctx context.Context, u *models.User) (*models.User, error) {
	query := `INSERT INTO users (email, phone, password_hash, role, last_name, first_name,
		patronymic, avatar_url, branch_id, is_active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING ` + userColumns

	row := r.pool.QueryRow(ctx, query, u.Email, u.Phone, u.PasswordHash, u.Role,
		u.LastName, u.FirstName, u.Patronymic, u.AvatarURL, u.BranchID, u.IsActive)

	created, err := scanUser(row)
	if err != nil {
		if isPgUniqueViolation(err) {
			return nil, ErrDuplicate
		}
		return nil, err
	}
	return created, nil
}

func (r *UserRepository) GetByID(ctx context.Context, id int64) (*models.User, error) {
	query := `SELECT ` + userColumns + ` FROM users WHERE id = $1`
	return scanUser(r.pool.QueryRow(ctx, query, id))
}

func (r *UserRepository) GetByLogin(ctx context.Context, login string) (*models.User, error) {
	// login может быть email ИЛИ телефоном — так и задумано контрактом (см. 1.2)
	query := `SELECT ` + userColumns + ` FROM users WHERE email = $1 OR phone = $1`
	return scanUser(r.pool.QueryRow(ctx, query, login))
}

func (r *UserRepository) Update(ctx context.Context, id int64, fields map[string]any) (*models.User, error) {
	if len(fields) == 0 {
		return r.GetByID(ctx, id)
	}
	setClauses := ""
	args := []any{}
	i := 1
	for col, val := range fields {
		if i > 1 {
			setClauses += ", "
		}
		setClauses += col + " = $" + itoa(i)
		args = append(args, val)
		i++
	}
	setClauses += ", updated_at = now()"
	args = append(args, id)

	query := "UPDATE users SET " + setClauses + " WHERE id = $" + itoa(i) + " RETURNING " + userColumns
	return scanUser(r.pool.QueryRow(ctx, query, args...))
}

type ListFilter struct {
	Role     *models.Role
	BranchID *int64
	Search   string
	Page     int
	PerPage  int
}

func (r *UserRepository) List(ctx context.Context, f ListFilter) ([]*models.User, int, error) {
	if f.Page < 1 {
		f.Page = 1
	}
	if f.PerPage < 1 || f.PerPage > 100 {
		f.PerPage = 20
	}

	where := "WHERE 1=1"
	args := []any{}
	i := 1
	if f.Role != nil {
		where += " AND role = $" + itoa(i)
		args = append(args, *f.Role)
		i++
	}
	if f.BranchID != nil {
		where += " AND branch_id = $" + itoa(i)
		args = append(args, *f.BranchID)
		i++
	}
	if f.Search != "" {
		where += " AND (last_name ILIKE $" + itoa(i) + " OR first_name ILIKE $" + itoa(i) + ")"
		args = append(args, "%"+f.Search+"%")
		i++
	}

	var total int
	countQuery := "SELECT count(*) FROM users " + where
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, f.PerPage, (f.Page-1)*f.PerPage)
	query := "SELECT " + userColumns + " FROM users " + where +
		" ORDER BY id LIMIT $" + itoa(i) + " OFFSET $" + itoa(i+1)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var users []*models.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, 0, err
		}
		users = append(users, u)
	}
	return users, total, rows.Err()
}

func itoa(i int) string {
	// без fmt.Sprintf ради простоты — чисел мало, не критично
	digits := "0123456789"
	if i < 10 {
		return string(digits[i])
	}
	return string(digits[i/10]) + string(digits[i%10])
}

func isPgUniqueViolation(err error) bool {
	return err != nil && (contains(err.Error(), "duplicate key value") || contains(err.Error(), "unique constraint"))
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (func() bool {
		for i := 0; i+len(substr) <= len(s); i++ {
			if s[i:i+len(substr)] == substr {
				return true
			}
		}
		return false
	})()
}
