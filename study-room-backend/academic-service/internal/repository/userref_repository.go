package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/academic-service/internal/models"
)

var ErrNotFound = errors.New("not found")

// UserRefRepository — облегчённая копия пользователей (user_refs),
// наполняется событиями user.created/user.updated (см. internal/events).
// Нужна, чтобы проверять роль/филиал репетитора или ученика локально,
// без синхронного похода в User Service на каждый запрос.
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

// BranchOf — удобный хелпер: филиал пользователя из локального кэша, либо
// nil, если пользователя ещё нет в user_refs (например, событие user.created
// от User Service ещё не дошло — best-effort доставка, см. events/subscriber.go).
//
// Для одного пользователя это ок, но НЕ используйте в цикле по списку (N+1
// запросов) — для этого случая есть BranchesOf ниже.
func (r *UserRefRepository) BranchOf(ctx context.Context, userID int64) (*int64, error) {
	ref, err := r.GetByID(ctx, userID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return ref.BranchID, nil
}

// BranchesOf — пакетная версия BranchOf: один запрос вместо одного на
// каждого userID. Используется там, где нужно отфильтровать список записей
// (homework/tests) по филиалу их студентов — раньше это делалось построчным
// вызовом BranchOf в цикле (N+1 запросов к БД на один HTTP-запрос), см.
// HomeworkHandler.filterByOwnBranch / TestHandler.filterByOwnBranch.
//
// Возвращает map[user_id]*branch_id. Пользователи, которых ещё нет в
// user_refs (событие user.created ещё не дошло), в map просто отсутствуют —
// вызывающий код должен трактовать отсутствие ключа так же, как nil от
// BranchOf (т.е. "филиал неизвестен").
func (r *UserRefRepository) BranchesOf(ctx context.Context, userIDs []int64) (map[int64]*int64, error) {
	result := make(map[int64]*int64, len(userIDs))
	if len(userIDs) == 0 {
		return result, nil
	}

	// Дедуп: один и тот же student_id может встречаться в списке много раз
	// (несколько домашек/тестов одного ученика) — не гонять лишние байты в
	// запросе, хотя ANY($1) и так корректно обработал бы дубликаты.
	seen := make(map[int64]struct{}, len(userIDs))
	unique := make([]int64, 0, len(userIDs))
	for _, id := range userIDs {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}

	rows, err := r.pool.Query(ctx,
		`SELECT user_id, branch_id FROM user_refs WHERE user_id = ANY($1)`, unique)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var userID int64
		var branchID *int64
		if err := rows.Scan(&userID, &branchID); err != nil {
			return nil, err
		}
		result[userID] = branchID
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// NamesOf — пакетное получение full_name по списку user_id, из локального
// кэша user_refs. Используется, чтобы подставить имя участнику занятия/
// автору дз-теста, когда GET /users на фронте его не отдаёт из-за
// branch-фильтра (см. Lesson.ParticipantNames, Homework.StudentName,
// Test.StudentName). Отсутствующие в user_refs id просто отсутствуют в
// результирующей map — вызывающий код должен иметь свой fallback.
func (r *UserRefRepository) NamesOf(ctx context.Context, userIDs []int64) (map[int64]string, error) {
	result := make(map[int64]string, len(userIDs))
	if len(userIDs) == 0 {
		return result, nil
	}

	seen := make(map[int64]struct{}, len(userIDs))
	unique := make([]int64, 0, len(userIDs))
	for _, id := range userIDs {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}

	rows, err := r.pool.Query(ctx,
		`SELECT user_id, full_name FROM user_refs WHERE user_id = ANY($1)`, unique)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var userID int64
		var fullName string
		if err := rows.Scan(&userID, &fullName); err != nil {
			return nil, err
		}
		if fullName != "" {
			result[userID] = fullName
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
