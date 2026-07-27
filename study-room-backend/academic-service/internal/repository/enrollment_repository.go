package repository

import (
	"context"
	"errors"

	"studyroom/academic-service/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type EnrollmentRepository struct {
	pool *pgxpool.Pool
}

func NewEnrollmentRepository(pool *pgxpool.Pool) *EnrollmentRepository {
	return &EnrollmentRepository{pool: pool}
}

const enrollmentColumns = `id, student_id, course_id, tutor_id, progress_pct, status, start_date, end_date, created_at`

func scanEnrollment(row pgx.Row) (*models.Enrollment, error) {
	var e models.Enrollment
	err := row.Scan(&e.ID, &e.StudentID, &e.CourseID, &e.TutorID, &e.ProgressPct,
		&e.Status, &e.StartDate, &e.EndDate, &e.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &e, nil
}

// Create — ручное создание записи (POST /enrollments), см. api-contracts.md 2.4.
// Статус и прогресс всегда стартуют как active/0 — соответствует контракту.
func (r *EnrollmentRepository) Create(ctx context.Context, studentID, courseID int64) (*models.Enrollment, error) {
	query := `INSERT INTO enrollments (student_id, course_id, status, progress_pct)
		VALUES ($1,$2,'active',0) RETURNING ` + enrollmentColumns
	return scanEnrollment(r.pool.QueryRow(ctx, query, studentID, courseID))
}

// CreateFromContract — автоматическое создание по событию contract.created
// (см. internal/events/subscriber.go и api-contracts.md 2.4, примечание).
// startDate/endDate/tutorID опциональны — приходят из тела договора, если есть.
//
// Если tutorID указан, дополнительно гарантируем строку в course_tutors:
// иначе ListForTutor (см. ниже — "мои ученики" через JOIN course_tutors)
// не найдёт этого ученика, хотя enrollments.tutor_id уже проставлен —
// именно так тьютор "терял" свежепривязанных по договору учеников из
// расписания и создания занятий (в разделе ДЗ баг не проявлялся, т.к.
// там список учеников берётся иначе — из User Service, без учёта
// enrollments/course_tutors).
func (r *EnrollmentRepository) CreateFromContract(
	ctx context.Context, studentID, courseID int64, tutorID *int64, startDate, endDate *string,
) (*models.Enrollment, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	query := `INSERT INTO enrollments (student_id, course_id, tutor_id, status, progress_pct, start_date, end_date)
		VALUES ($1,$2,$3,'active',0,$4,$5) RETURNING ` + enrollmentColumns
	enrollment, err := scanEnrollment(tx.QueryRow(ctx, query, studentID, courseID, tutorID, startDate, endDate))
	if err != nil {
		return nil, err
	}

	if tutorID != nil {
		if _, err := tx.Exec(ctx,
			`INSERT INTO course_tutors (course_id, tutor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			courseID, *tutorID,
		); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return enrollment, nil
}

func (r *EnrollmentRepository) GetByID(ctx context.Context, id int64) (*models.Enrollment, error) {
	query := `SELECT ` + enrollmentColumns + ` FROM enrollments WHERE id = $1`
	return scanEnrollment(r.pool.QueryRow(ctx, query, id))
}

// EnrollmentFilter — student_id/tutor_id/course_id как в query-параметрах
// контракта 2.5. BranchID — не часть публичного контракта, а внутренний
// фильтр для branch_owner (джойн по courses.branch_id), проставляется
// сервером принудительно, а не пользователем.
type EnrollmentFilter struct {
	StudentID *int64
	// StudentIDs — фильтр "IN (...)", используется для parent с несколькими
	// детьми (см. handlers.EnrollmentHandler.List). Взаимоисключим со StudentID:
	// если задан StudentIDs, StudentID игнорируется.
	StudentIDs []int64
	TutorID    *int64
	CourseID   *int64
	BranchID   *int64
}

func (r *EnrollmentRepository) List(ctx context.Context, f EnrollmentFilter) ([]*models.Enrollment, error) {
	query := `SELECT e.id, e.student_id, e.course_id, e.tutor_id, e.progress_pct, e.status,
		e.start_date, e.end_date, e.created_at
		FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE 1=1`
	args := []any{}
	i := 1
	if len(f.StudentIDs) > 0 {
		query += " AND e.student_id = ANY($" + itoa(i) + ")"
		args = append(args, f.StudentIDs)
		i++
	} else if f.StudentID != nil {
		query += " AND e.student_id = $" + itoa(i)
		args = append(args, *f.StudentID)
		i++
	}
	if f.TutorID != nil {
		query += " AND e.tutor_id = $" + itoa(i)
		args = append(args, *f.TutorID)
		i++
	}
	if f.CourseID != nil {
		query += " AND e.course_id = $" + itoa(i)
		args = append(args, *f.CourseID)
		i++
	}
	if f.BranchID != nil {
		query += " AND c.branch_id = $" + itoa(i)
		args = append(args, *f.BranchID)
		i++
	}
	query += " ORDER BY e.id"

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Enrollment
	for rows.Next() {
		e, err := scanEnrollment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ListForTutor — "мои ученики" преподавателя: enrollments на курсы, которые
// он реально ведёт (course_tutors), а не на все enrollments, где кто-то
// когда-то вручную проставил ему enrollments.tutor_id. branchID передаётся
// сервером принудительно (филиал самого tutor'а) — дополнительная защита
// на случай, если преподавателя ошибочно назначили на курс чужого филиала.
func (r *EnrollmentRepository) ListForTutor(ctx context.Context, tutorID int64, branchID *int64, courseID *int64) ([]*models.Enrollment, error) {
	query := `SELECT e.id, e.student_id, e.course_id, e.tutor_id, e.progress_pct, e.status,
		e.start_date, e.end_date, e.created_at
		FROM enrollments e
		JOIN courses c ON c.id = e.course_id
		JOIN course_tutors ct ON ct.course_id = c.id AND ct.tutor_id = $1
		WHERE 1=1`
	args := []any{tutorID}
	i := 2
	if branchID != nil {
		query += " AND c.branch_id = $" + itoa(i)
		args = append(args, *branchID)
		i++
	}
	if courseID != nil {
		query += " AND e.course_id = $" + itoa(i)
		args = append(args, *courseID)
		i++
	}
	query += " ORDER BY e.id"

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Enrollment
	for rows.Next() {
		e, err := scanEnrollment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// CourseTaughtBy — ведёт ли tutor курс, к которому относится enrollment.
// Используется в правах на PATCH /enrollments/{id}: раньше tutor мог
// менять только ту запись, где enrollments.tutor_id указывал прямо на
// него; теперь этого достаточно, но ЕЩЁ разрешено, если он вообще ведёт
// этот курс (назначен через course_tutors), даже если конкретно на этого
// ученика его вручную не проставляли.
func (r *EnrollmentRepository) CourseTaughtBy(ctx context.Context, courseID, tutorID int64) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM course_tutors WHERE course_id = $1 AND tutor_id = $2)`,
		courseID, tutorID).Scan(&exists)
	return exists, err
}

func (r *EnrollmentRepository) AssignTutor(ctx context.Context, id, tutorID int64) (*models.Enrollment, error) {
	query := `UPDATE enrollments SET tutor_id = $1 WHERE id = $2 RETURNING ` + enrollmentColumns
	return scanEnrollment(r.pool.QueryRow(ctx, query, tutorID, id))
}

// UnassignTutorEverywhere — снимает личное закрепление преподавателя со ВСЕХ
// его enrollments сразу (tutor_id -> NULL). Используется при увольнении
// (users.is_active=false в User Service) по событию user.updated — см.
// events/subscriber.go и CourseRepository.RemoveTutorEverywhere (парная
// операция для course_tutors). Сами enrollments не удаляются — ученик
// остаётся записан на курс, просто теряет закреплённого лично за ним
// репетитора, пока ему не назначат нового.
func (r *EnrollmentRepository) UnassignTutorEverywhere(ctx context.Context, tutorID int64) error {
	_, err := r.pool.Exec(ctx, `UPDATE enrollments SET tutor_id = NULL WHERE tutor_id = $1`, tutorID)
	return err
}

// PauseOrphanedForCourses — переводит в status='paused' все active
// enrollments на перечисленных курсах, у которых прямо сейчас нет личного
// tutor_id (т.е. остались "ничьими" после увольнения последнего/единственного
// преподавателя курса — см. CourseRepository.CoursesWithNoTutors и
// events/subscriber.go: detachTutor).
//
// Зачем: enrollments не удаляются при увольнении препода — это исторические
// записи, ученик остаётся записан на курс. А ListForTutor (см. ADR там же)
// показывает препода всех, кто записан на курсы, которые он ведёт, вообще
// не оглядываясь на личный tutor_id. Из-за этого если такой "осиротевший"
// курс потом отдают совсем другому, новому преподавателю, тот молча
// наследует всех, кто на курсе остался записан, включая учеников уволенного —
// выглядит так, будто к новому преподавателю "сам по себе" привязался чужой
// ученик. Пауза не удаляет и не прячет запись — она остаётся видна и
// администратору, и новому tutor'у, но явно помечена как неактивная, вместо
// того чтобы молча выглядеть как полноценное текущее закрепление. Дальше
// её нужно осознанно снять с паузы (UpdateProgress status='active') или
// переназначить (AssignTutor) — тихого автоматического наследования нет.
func (r *EnrollmentRepository) PauseOrphanedForCourses(ctx context.Context, courseIDs []int64) error {
	if len(courseIDs) == 0 {
		return nil
	}
	_, err := r.pool.Exec(ctx,
		`UPDATE enrollments SET status = 'paused'
		 WHERE course_id = ANY($1) AND status = 'active' AND tutor_id IS NULL`,
		courseIDs)
	return err
}

func (r *EnrollmentRepository) UpdateProgress(ctx context.Context, id int64, fields map[string]any) (*models.Enrollment, error) {
	if len(fields) == 0 {
		return r.GetByID(ctx, id)
	}
	allowedCols := map[string]bool{"progress_pct": true, "status": true, "start_date": true, "end_date": true}
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
	query := "UPDATE enrollments SET " + setClauses + " WHERE id = $" + itoa(i) + " RETURNING " + enrollmentColumns
	return scanEnrollment(r.pool.QueryRow(ctx, query, args...))
}

// CourseBranchID — вспомогательный запрос для авторизации (branch_owner
// может назначать репетитора только на записи курсов своего филиала).
func (r *EnrollmentRepository) CourseBranchID(ctx context.Context, courseID int64) (int64, error) {
	var branchID int64
	err := r.pool.QueryRow(ctx, `SELECT branch_id FROM courses WHERE id = $1`, courseID).Scan(&branchID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return branchID, nil
}
