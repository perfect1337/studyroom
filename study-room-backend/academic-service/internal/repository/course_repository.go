package repository

import (
	"context"
	"errors"
	"strconv"

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
const courseSelectColumns = `c.id, c.title, c.subject, c.format, c.description, c.created_at,
	COALESCE(array_agg(ct.tutor_id) FILTER (WHERE ct.tutor_id IS NOT NULL), '{}')::bigint[]`

const courseInsertColumns = `id, title, subject, format, description, created_at`

func scanCourseWithTutors(row pgx.Row) (*models.Course, error) {
	var c models.Course
	err := row.Scan(&c.ID, &c.Title, &c.Subject, &c.Format, &c.Description, &c.CreatedAt, &c.TutorIDs)
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
	err := row.Scan(&c.ID, &c.Title, &c.Subject, &c.Format, &c.Description, &c.CreatedAt)
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
	query := `INSERT INTO courses (title, subject, format, description)
		VALUES ($1,$2,$3,$4) RETURNING ` + courseInsertColumns
	row := r.pool.QueryRow(ctx, query, c.Title, c.Subject, c.Format, c.Description)
	return scanCourseNoTutors(row)
}

func (r *CourseRepository) GetByID(ctx context.Context, id int64) (*models.Course, error) {
	query := `SELECT ` + courseSelectColumns + `
		FROM courses c LEFT JOIN course_tutors ct ON ct.course_id = c.id
		WHERE c.id = $1 GROUP BY c.id`
	return scanCourseWithTutors(r.pool.QueryRow(ctx, query, id))
}

// CourseFilter — курсы больше не привязаны к филиалу, каталог общий для
// всей сети. subject — опциональный ILIKE-фильтр. TutorID — курсы, которые
// ведёт конкретный преподаватель (через course_tutors); используется и для
// "мои курсы" у tutor, и как query-фильтр у owner/branch_owner.
type CourseFilter struct {
	Subject string
	TutorID *int64
	IDs     []int64
}

func (r *CourseRepository) List(ctx context.Context, f CourseFilter) ([]*models.Course, error) {
	query := `SELECT ` + courseSelectColumns + `
		FROM courses c LEFT JOIN course_tutors ct ON ct.course_id = c.id`
	where := " WHERE 1=1"
	args := []any{}
	i := 1
	if f.Subject != "" {
		where += " AND c.subject ILIKE $" + strconv.Itoa(i)
		args = append(args, "%"+f.Subject+"%")
		i++
	}
	if f.TutorID != nil {
		where += " AND c.id IN (SELECT course_id FROM course_tutors WHERE tutor_id = $" + strconv.Itoa(i) + ")"
		args = append(args, *f.TutorID)
		i++
	}
	if len(f.IDs) > 0 {
		where += " AND c.id = ANY($" + strconv.Itoa(i) + ")"
		args = append(args, f.IDs)
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
		"title": true, "subject": true, "format": true, "description": true,
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
	args = append(args, id)
	query := "UPDATE courses SET " + setClauses + " WHERE id = $" + strconv.Itoa(i) + " RETURNING " + courseInsertColumns
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

// RemoveTutorEverywhere — снимает преподавателя со ВСЕХ курсов сразу.
// Используется при увольнении (users.is_active=false, см. user-service
// SetStatus) по событию user.updated — см. events/subscriber.go. В отличие
// от RemoveTutor, не требует id конкретного курса и не считается ошибкой,
// если преподаватель ни на одном курсе не значился (tag.RowsAffected() == 0
// в этом случае — валидный исход, не ErrNotFound).
func (r *CourseRepository) RemoveTutorEverywhere(ctx context.Context, tutorID int64) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM course_tutors WHERE tutor_id = $1`, tutorID)
	return err
}

// CoursesTaughtBy — id курсов, которые ведёт данный преподаватель (course_tutors).
// Нужно вызывать ДО RemoveTutorEverywhere: после удаления строк из
// course_tutors узнать, что курс вообще вёл именно этот tutor, будет уже
// нечем — см. events/subscriber.go: detachTutor.
func (r *CourseRepository) CoursesTaughtBy(ctx context.Context, tutorID int64) ([]int64, error) {
	rows, err := r.pool.Query(ctx, `SELECT course_id FROM course_tutors WHERE tutor_id = $1`, tutorID)
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

// CoursesWithNoTutors — из переданного списка курсов возвращает те, у
// которых прямо сейчас не осталось ни одного преподавателя в course_tutors.
//
// Нужно, чтобы отличить курс, лишившийся ОДНОГО из нескольких
// со-преподавателей (там остаются другие действующие tutor'ы — их active
// enrollments трогать нельзя), от курса, оставшегося вообще без препода.
// Используется detachTutor'ом (events/subscriber.go) при увольнении —
// см. EnrollmentRepository.PauseOrphanedForCourses.
func (r *CourseRepository) CoursesWithNoTutors(ctx context.Context, courseIDs []int64) ([]int64, error) {
	if len(courseIDs) == 0 {
		return nil, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT c.id FROM courses c
		 WHERE c.id = ANY($1)
		   AND NOT EXISTS (SELECT 1 FROM course_tutors ct WHERE ct.course_id = c.id)`,
		courseIDs)
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
