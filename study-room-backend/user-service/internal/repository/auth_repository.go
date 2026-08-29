package repository

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/user-service/internal/models"
)

// refreshReuseGrace — окно, в течение которого повторное предъявление уже
// отозванного (только что заменённого при ротации) refresh-токена ещё
// считается легитимной гонкой, а не кражей. См. миграцию
// 0006_refresh_token_grace и комментарий у RotateRefreshToken.
const refreshReuseGrace = 30 * time.Second

// ErrRefreshTokenReused возвращается, когда токен предъявлен уже за
// пределами grace-периода после своей ротации — похоже на использование
// скомпрометированного (украденного/подсмотренного) токена. В этом случае
// все refresh-сессии пользователя гасятся превентивно.
var ErrRefreshTokenReused = errors.New("refresh token reused after grace period")

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

// FindUserIDByRefreshToken возвращает user_id, если токен существует, не
// истёк и либо ещё не был отозван, либо был отозван совсем недавно
// (см. refreshReuseGrace) — такое повторное предъявление трактуется как
// гонка (например, ответ на предыдущую ротацию не долетел до браузера
// из-за перезагрузки страницы), а не как ошибка. Если токен отозван уже
// давно — считаем это реиспользованием потенциально украденного токена и
// гасим все сессии пользователя, возвращая ErrRefreshTokenReused.
func (r *AuthRepository) FindUserIDByRefreshToken(ctx context.Context, tokenHash string) (int64, error) {
	var userID int64
	var revokedAt *time.Time
	err := r.pool.QueryRow(ctx,
		`SELECT user_id, revoked_at FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now()`,
		tokenHash).Scan(&userID, &revokedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, ErrNotFound
		}
		return 0, err
	}

	if revokedAt != nil {
		if time.Since(*revokedAt) > refreshReuseGrace {
			_ = r.RevokeAllRefreshTokens(ctx, userID)
			return 0, ErrRefreshTokenReused
		}
		// В пределах grace-периода — разрешаем ротацию повторно (гонка,
		// не кража).
	}

	return userID, nil
}

// RotateRefreshToken помечает токен отозванным (soft-revoke), но не удаляет
// его сразу — см. комментарий у refreshReuseGrace и миграцию
// 0006_refresh_token_grace. Идемпотентно: повторный вызов для уже
// отозванного токена ничего не ломает (просто не найдёт строку с
// revoked_at IS NULL и ничего не обновит), новая пара токенов при этом
// всё равно успешно выдаётся вызывающим кодом. Используется ТОЛЬКО при
// ротации в /auth/refresh — для явного выхода (Logout) нужен настоящий
// DELETE, см. RevokeRefreshToken ниже, иначе токен можно было бы повторно
// использовать в течение grace-периода уже после того, как пользователь
// сам разлогинился.
func (r *AuthRepository) RotateRefreshToken(ctx context.Context, tokenHash string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
		tokenHash)
	return err
}

// RevokeRefreshToken удаляет один токен насовсем (явный logout) — в отличие
// от RotateRefreshToken, здесь никакого grace-периода на повторное
// использование быть не должно: раз пользователь вышел, токен должен стать
// недействительным немедленно и безусловно.
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

// GetParentOfStudent возвращает родителя данного ученика (через parent_student).
// Нужно, чтобы после сброса учётных данных ученика отправить письмо на почту
// родителя (у ученика своей реальной почты нет — см. CreateStudent).
func (r *ParentChildRepository) GetParentOfStudent(ctx context.Context, studentID int64) (*models.User, error) {
	query := `SELECT u.id, u.email, u.phone, u.password_hash, u.role, u.last_name, u.first_name,
		u.patronymic, u.avatar_url, u.branch_id, u.is_active, u.created_at, u.updated_at
		FROM users u
		INNER JOIN parent_student ps ON ps.parent_id = u.id
		WHERE ps.student_id = $1
		LIMIT 1`
	return scanUser(r.pool.QueryRow(ctx, query, studentID))
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
