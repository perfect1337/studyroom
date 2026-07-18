package repository

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/user-service/internal/models"
)

type AuthRepository struct {
	pool *pgxpool.Pool
}

func NewAuthRepository(pool *pgxpool.Pool) *AuthRepository {
	return &AuthRepository{pool: pool}
}

func (r *AuthRepository) SaveRefreshToken(ctx context.Context, userID int64, tokenHash string, expiresAt time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
		userID, tokenHash, expiresAt)
	return err
}

// FindUserIDByRefreshToken возвращает user_id, если токен существует и не истёк.
func (r *AuthRepository) FindUserIDByRefreshToken(ctx context.Context, tokenHash string) (int64, error) {
	var userID int64
	err := r.pool.QueryRow(ctx,
		`SELECT user_id FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now()`,
		tokenHash).Scan(&userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return userID, nil
}

// RevokeRefreshToken удаляет токен — используется при refresh (ротация:
// старый токен погашается, выдаётся новый) и при логауте.
func (r *AuthRepository) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM refresh_tokens WHERE token_hash = $1`, tokenHash)
	return err
}

// --- Восстановление пароля (1.4 / 1.5) ---

func (r *AuthRepository) SavePasswordResetToken(ctx context.Context, userID int64, tokenHash string, expiresAt time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
		userID, tokenHash, expiresAt)
	return err
}

// FindValidPasswordResetToken — токен должен существовать, не быть использованным
// и не быть истёкшим. Возвращает user_id, если всё ок.
func (r *AuthRepository) FindValidPasswordResetToken(ctx context.Context, tokenHash string) (int64, error) {
	var userID int64
	err := r.pool.QueryRow(ctx,
		`SELECT user_id FROM password_reset_tokens
		 WHERE token_hash = $1 AND expires_at > now() AND used_at IS NULL`,
		tokenHash).Scan(&userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return userID, nil
}

func (r *AuthRepository) MarkPasswordResetTokenUsed(ctx context.Context, tokenHash string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = $1`, tokenHash)
	return err
}

type ParentChildRepository struct {
	pool *pgxpool.Pool
}

func NewParentChildRepository(pool *pgxpool.Pool) *ParentChildRepository {
	return &ParentChildRepository{pool: pool}
}

func (r *ParentChildRepository) Link(ctx context.Context, parentID, studentID int64) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO parent_student (parent_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		parentID, studentID)
	return err
}

func (r *ParentChildRepository) IsParentOf(ctx context.Context, parentID, studentID int64) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM parent_student WHERE parent_id=$1 AND student_id=$2)`,
		parentID, studentID).Scan(&exists)
	return exists, err
}

// ListChildren возвращает учеников, привязанных к родителю через parent_student.
func (r *ParentChildRepository) ListChildren(ctx context.Context, parentID int64, search string) ([]*models.User, error) {
	where := `WHERE ps.parent_id = $1`
	args := []any{parentID}
	if search != "" {
		where += ` AND (u.last_name ILIKE $2 OR u.first_name ILIKE $2)`
		args = append(args, "%"+search+"%")
	}
	query := `SELECT u.id, u.email, u.phone, u.password_hash, u.role, u.last_name, u.first_name,
		u.patronymic, u.avatar_url, u.branch_id, u.is_active, u.created_at, u.updated_at
		FROM users u
		INNER JOIN parent_student ps ON ps.student_id = u.id
		` + where + ` ORDER BY u.id`

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []*models.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}
