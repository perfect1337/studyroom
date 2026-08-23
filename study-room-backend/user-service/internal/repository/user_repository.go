package repository

import (
	"context"
	"errors"
	"strconv"
	"strings"

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

// profileColumns — то же самое + профиль репетитора и профиль ученика (nil для
// ролей, к которым не относятся — LEFT JOIN). Нужен, чтобы List/ListAll/GetByID
// возвращали specialization/tutor_status для tutor и class_info/school/avg_grade/
// attendance_pct для student: раньше их вообще не было в ответе GET /users(/{id}),
// из-за чего в UI статус преподавателя после обновления страницы "откатывался" на
// дефолтный, а карточка ученика никогда не показывала класс/школу, хотя в БД
// данные были записаны корректно.
const profileColumns = `users.id, users.email, users.phone, users.password_hash, users.role, users.last_name, users.first_name,
	users.patronymic, users.avatar_url, users.branch_id, users.is_active, users.created_at, users.updated_at,
	tutor_profiles.specialization, tutor_profiles.status,
	student_profiles.class_info, student_profiles.school, student_profiles.avg_grade, student_profiles.attendance_pct,
	branches.name`

const fromProfileJoins = `FROM users
	LEFT JOIN tutor_profiles ON tutor_profiles.user_id = users.id
	LEFT JOIN student_profiles ON student_profiles.user_id = users.id
	LEFT JOIN branches ON branches.id = users.branch_id `

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

func scanUserWithProfiles(row pgx.Row) (*models.User, error) {
	var u models.User
	err := row.Scan(&u.ID, &u.Email, &u.Phone, &u.PasswordHash, &u.Role, &u.LastName,
		&u.FirstName, &u.Patronymic, &u.AvatarURL, &u.BranchID, &u.IsActive,
		&u.CreatedAt, &u.UpdatedAt, &u.Specialization, &u.TutorStatus,
		&u.ClassInfo, &u.School, &u.AvgGrade, &u.AttendancePct, &u.BranchName)
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
	query := "SELECT " + profileColumns + " " + fromProfileJoins + "WHERE users.id = $1"
	return scanUserWithProfiles(r.pool.QueryRow(ctx, query, id))
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
	allowedCols := map[string]bool{
		"first_name": true, "last_name": true, "patronymic": true, "avatar_url": true,
		"password_hash": true, "is_active": true, "phone": true, "branch_id": true,
		"email": true,
	}
	setClauses := ""
	args := []any{}
	i := 1
	for col, val := range fields {
		if !allowedCols[col] {
			continue
		}
		if i > 1 {
			setClauses += ", "
		}
		setClauses += col + " = $" + strconv.Itoa(i)
		args = append(args, val)
		i++
	}
	if len(args) == 0 {
		return r.GetByID(ctx, id)
	}
	setClauses += ", updated_at = now()"
	args = append(args, id)

	query := "UPDATE users SET " + setClauses + " WHERE id = $" + strconv.Itoa(i) + " RETURNING " + userColumns
	updated, err := scanUser(r.pool.QueryRow(ctx, query, args...))
	if err != nil {
		// email/phone связаны unique-констрейнтом в БД — при смене почты на уже
		// занятую нужно вернуть предсказуемый ErrDuplicate (как в Create), а не
		// голую ошибку драйвера, иначе хендлер отдаст 500 вместо 409.
		if isPgUniqueViolation(err) {
			return nil, ErrDuplicate
		}
		return nil, err
	}
	return updated, nil
}

// CreateStudentWithParent создаёт ученика, профиль и связь с родителем в одной транзакции.
func (r *UserRepository) CreateStudentWithParent(
	ctx context.Context,
	u *models.User,
	parentID int64,
	classInfo, school *string,
) (*models.User, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var parentRole models.Role
	err = tx.QueryRow(ctx, `SELECT role FROM users WHERE id = $1`, parentID).Scan(&parentRole)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if parentRole != models.RoleParent {
		return nil, ErrNotFound
	}

	query := `INSERT INTO users (email, phone, password_hash, role, last_name, first_name,
		patronymic, avatar_url, branch_id, is_active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING ` + userColumns
	created, err := scanUser(tx.QueryRow(ctx, query, u.Email, u.Phone, u.PasswordHash, u.Role,
		u.LastName, u.FirstName, u.Patronymic, u.AvatarURL, u.BranchID, u.IsActive))
	if err != nil {
		if isPgUniqueViolation(err) {
			return nil, ErrDuplicate
		}
		return nil, err
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO parent_student (parent_id, student_id) VALUES ($1,$2)`,
		parentID, created.ID); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO student_profiles (user_id, class_info, school) VALUES ($1,$2,$3)
	`, created.ID, classInfo, school); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	// scanUser выше не делает JOIN на student_profiles (это INSERT в users,
	// профиля на тот момент ещё не существовало) — дозаполняем вручную из
	// того, что только что сами же записали, чтобы вызывающий код (событие
	// user.created, см. UserHandler.CreateStudent) сразу видел актуальный
	// class_info, не читая профиль повторным запросом.
	created.ClassInfo = classInfo
	created.School = school
	return created, nil
}

type ListFilter struct {
	Role     *models.Role
	Roles    []models.Role // если задан — OR по нескольким ролям (Role игнорируется)
	BranchID *int64
	Search   string
	Page     int
	PerPage  int
}

func (r *UserRepository) List(ctx context.Context, f ListFilter) ([]*models.User, int, error) {
	if f.Page < 1 {
		f.Page = 1
	}
	if f.PerPage < 1 || f.PerPage > 500 {
		f.PerPage = 20
	}

	where := "WHERE 1=1"
	args := []any{}
	i := 1
	if len(f.Roles) > 0 {
		roleStrs := make([]string, len(f.Roles))
		for idx, role := range f.Roles {
			roleStrs[idx] = string(role)
		}
		where += " AND users.role = ANY($" + strconv.Itoa(i) + ")"
		args = append(args, roleStrs)
		i++
	} else if f.Role != nil {
		where += " AND users.role = $" + strconv.Itoa(i)
		args = append(args, *f.Role)
		i++
	}
	if f.BranchID != nil {
		where += " AND users.branch_id = $" + strconv.Itoa(i)
		args = append(args, *f.BranchID)
		i++
	}
	if f.Search != "" {
		where += " AND (users.last_name ILIKE $" + strconv.Itoa(i) + " OR users.first_name ILIKE $" + strconv.Itoa(i) + ")"
		args = append(args, "%"+f.Search+"%")
		i++
	}

	var total int
	countQuery := "SELECT count(*) " + fromProfileJoins + where
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, f.PerPage, (f.Page-1)*f.PerPage)
	query := "SELECT " + profileColumns + " " + fromProfileJoins + where +
		" ORDER BY users.id LIMIT $" + strconv.Itoa(i) + " OFFSET $" + strconv.Itoa(i+1)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var users []*models.User
	for rows.Next() {
		u, err := scanUserWithProfiles(rows)
		if err != nil {
			return nil, 0, err
		}
		users = append(users, u)
	}
	return users, total, rows.Err()
}

// ListAll — без пагинации (для справочника «мои люди»), лимит 500.
func (r *UserRepository) ListAll(ctx context.Context, f ListFilter) ([]*models.User, error) {
	f.Page = 1
	f.PerPage = 500
	users, _, err := r.List(ctx, f)
	return users, err
}

func isPgUniqueViolation(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "duplicate key value") || strings.Contains(err.Error(), "unique constraint"))
}
