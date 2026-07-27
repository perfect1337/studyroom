package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/academic-service/internal/models"
)

type CourseRepository struct {
	pool *pgxpool.Pool
}

func NewCourseRepository(pool *pgxpool.Pool) *CourseRepository {
	return &CourseRepository{pool: pool}
}

// courseSelectColumns — курс + агрегированный список id преподавателей,
// которые его ведут (course_tutors). COALESCE(..., '{}') превращает
// NULL (когда ни один преподаватель ещё не назначен) в пустой массив,
// а не в null в JSON.
const courseSelectColumns = `c.id, c.title, c.subject, c.format, c.description, c.branch_id, c.created_at,
	COALESCE(array_agg(ct.tutor_id) FILTER (WHERE ct.tutor_id IS NOT NULL), '{}')::bigint[]`

const courseInsertColumns = `id, title, subject, format, description, branch_id, created_at`

func scanCourseWithTutors(row pgx.Row) (*models.Course, error) {
	var c models.Course
	err := row.Scan(&c.ID, &c.Title, &c.Subject, &c.Format, &c.Description, &c.BranchID, &c.CreatedAt, &c.TutorIDs)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if c.TutorIDs == nil {
		c.TutorIDs = []int64{}
	}
	return &c, nil
}

// scanCourseNoTutors — для INSERT/UPDATE RETURNING, где JOIN на
// course_tutors не нужен (курс только что создан/изменён, набор
// преподавателей никак не поменялся этим запросом).
func scanCourseNoTutors(row pgx.Row) (*models.Course, error) {
	var c models.Course
	err := row.Scan(&c.ID, &c.Title, &c.Subject, &c.Format, &c.Description, &c.BranchID, &c.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.TutorIDs = []int64{}
	return &c, nil
}

func (r *CourseRepository) Create(ctx context.Context, c *models.Course) (*models.Course, error) {
	query := `INSERT INTO courses (title, subject, format, description, branch_id)
		VALUES ($1,$2,$3,$4,$5) RETURNING ` + courseInsertColumns
	row := r.pool.QueryRow(ctx, query, c.Title, c.Subject, c.Format, c.Description, c.BranchID)
	return scanCourseNoTutors(row)
}

func (r *CourseRepository) GetByID(ctx context.Context, id int64) (*models.Course, error) {
	query := `SELECT ` + courseSelectColumns + `
		FROM courses c LEFT JOIN course_tutors ct ON ct.course_id = c.id
		WHERE c.id = $1 GROUP BY c.id`
	return scanCourseWithTutors(r.pool.QueryRow(ctx, query, id))
}

// CourseFilter — branch_id обязателен для всех ролей кроме owner
// (проверяется в handlers, см. api-contracts.md 2.1). subject — опциональный
// ILIKE-фильтр. TutorID — курсы, которые ведёт конкретный преподаватель
// (через course_tutors); используется и для "мои курсы" у tutor, и как
// query-фильтр у owner/branch_owner.
type CourseFilter struct {
	BranchID *int64
	Subject  string
	TutorID  *int64
}

func (r *CourseRepository) List(ctx context.Context, f CourseFilter) ([]*models.Course, error) {
	query := `SELECT ` + courseSelectColumns + `
		FROM courses c LEFT JOIN course_tutors ct ON ct.course_id = c.id`
	where := " WHERE 1=1"
	args := []any{}
	i := 1
	if f.BranchID != nil {
		where += " AND c.branch_id = $" + itoa(i)
		args = append(args, *f.BranchID)
		i++
	}
	if f.Subject != "" {
		where += " AND c.subject ILIKE $" + itoa(i)
		args = append(args, "%"+f.Subject+"%")
		i++
	}
	if f.TutorID != nil {
		where += " AND c.id IN (SELECT course_id FROM course_tutors WHERE tutor_id = $" + itoa(i) + ")"
		args = append(args, *f.TutorID)
		i++
	}
	query += where + " GROUP BY c.id ORDER BY c.id"

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Course
	for rows.Next() {
		c, err := scanCourseWithTutors(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *CourseRepository) Update(ctx context.Context, id int64, fields map[string]any) (*models.Course, error) {
	if len(fields) == 0 {
		return r.GetByID(ctx, id)
	}
	allowedCols := map[string]bool{
		"title": true, "subject": true, "format": true, "description": true, "branch_id": true,
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
		setClauses += col + " = $" + itoa(i)
		args = append(args, val)
		i++
	}
	if len(args) == 0 {
		return r.GetByID(ctx, id)
	}
	args = append(args, id)
	query := "UPDATE courses SET " + setClauses + " WHERE id = $" + itoa(i) + " RETURNING " + courseInsertColumns
	if _, err := scanCourseNoTutors(r.pool.QueryRow(ctx, query, args...)); err != nil {
		return nil, err
	}
	// Возвращаем свежий объект с актуальным tutor_ids (Update сам их не трогает,
	// но клиенту удобнее получить полную картину курса одним ответом).
	return r.GetByID(ctx, id)
}

func (r *CourseRepository) Delete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM courses WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AssignTutor — добавляет преподавателя в число ведущих курс (course_tutors).
// Идемпотентна: повторное назначение того же tutor_id на тот же курс не
// создаёт дубликат и не считается ошибкой.
func (r *CourseRepository) AssignTutor(ctx context.Context, courseID, tutorID int64) error {
	tag, err := r.pool.Exec(ctx,
		`INSERT INTO course_tutors (course_id, tutor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		courseID, tutorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Либо уже был назначен (ON CONFLICT), либо courses.id не существует —
		// отличаем через отдельную проверку, чтобы вернуть внятную 404.
		exists, err := r.exists(ctx, courseID)
		if err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
	}
	return nil
}

// RemoveTutor — снимает преподавателя с курса. Не трогает уже созданные
// enrollments/lessons — это исторические записи, они не переписываются
// задним числом при отзыве доступа.
func (r *CourseRepository) RemoveTutor(ctx context.Context, courseID, tutorID int64) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM course_tutors WHERE course_id = $1 AND tutor_id = $2`, courseID, tutorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListTutorIDs — id преподавателей, ведущих курс.
func (r *CourseRepository) ListTutorIDs(ctx context.Context, courseID int64) ([]int64, error) {
	rows, err := r.pool.Query(ctx, `SELECT tutor_id FROM course_tutors WHERE course_id = $1 ORDER BY tutor_id`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// IsTutorOfCourse — ведёт ли данный преподаватель данный курс. Используется
// для проверки прав (например, может ли tutor обновлять enrollment/lesson
// по курсу, к которому его явно не назначили на конкретного ученика).
func (r *CourseRepository) IsTutorOfCourse(ctx context.Context, courseID, tutorID int64) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM course_tutors WHERE course_id = $1 AND tutor_id = $2)`,
		courseID, tutorID).Scan(&exists)
	return exists, err
}

func (r *CourseRepository) exists(ctx context.Context, courseID int64) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM courses WHERE id = $1)`, courseID).Scan(&exists)
	return exists, err
}

func itoa(i int) string {
	digits := "0123456789"
	if i < 10 {
		return string(digits[i])
	}
	return string(digits[i/10]) + string(digits[i%10])
}
