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

// RevokeRefreshToken удаляет один токен (ротация refresh).
func (r *AuthRepository) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM refresh_tokens WHERE token_hash = $1`, tokenHash)
	return err
}

// RevokeAllRefreshTokens гасит все сессии пользователя (disable / смена пароля).
func (r *AuthRepository) RevokeAllRefreshTokens(ctx context.Context, userID int64) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM refresh_tokens WHERE user_id = $1`, userID)
	return err
}

// --- Восстановление пароля (1.4 / 1.5) ---

func (r *AuthRepository) SavePasswordResetToken(ctx context.Context, userID int64, tokenHash string, expiresAt time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
		userID, tokenHash, expiresAt)
	return err
}

// ConsumePasswordResetToken атомарно помечает токен использованным и возвращает user_id.
// Защита от гонки: два параллельных запроса не смогут оба пройти.
func (r *AuthRepository) ConsumePasswordResetToken(ctx context.Context, tokenHash string) (int64, error) {
	var userID int64
	err := r.pool.QueryRow(ctx, `
		UPDATE password_reset_tokens
		SET used_at = now()
		WHERE token_hash = $1 AND expires_at > now() AND used_at IS NULL
		RETURNING user_id
	`, tokenHash).Scan(&userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return userID, nil
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

// ChildView — урезанный ответ для контракта 1.18.
type ChildView struct {
	ID        int64   `json:"id"`
	FirstName string  `json:"first_name"`
	LastName  string  `json:"last_name"`
	ClassInfo *string `json:"class_info,omitempty"`
	BranchID  *int64  `json:"-"`
}

// ListChildrenViews возвращает детей с class_info из student_profiles.
func (r *ParentChildRepository) ListChildrenViews(ctx context.Context, parentID int64) ([]ChildView, error) {
	query := `
		SELECT u.id, u.first_name, u.last_name, sp.class_info, u.branch_id
		FROM users u
		INNER JOIN parent_student ps ON ps.student_id = u.id
		LEFT JOIN student_profiles sp ON sp.user_id = u.id
		WHERE ps.parent_id = $1
		ORDER BY u.id`
	rows, err := r.pool.Query(ctx, query, parentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ChildView
	for rows.Next() {
		var c ChildView
		if err := rows.Scan(&c.ID, &c.FirstName, &c.LastName, &c.ClassInfo, &c.BranchID); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
