package repository

import (
	"context"
	"errors"
	"math"
	"strconv"

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
// фильтр для branch_owner (курсы больше не привязаны к филиалу, поэтому
// фильтруем по филиалу самого ученика через user_refs), проставляется
// сервером принудительно, а не пользователем.
type EnrollmentFilter struct {
	StudentID *int64
	Status    string
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
		FROM enrollments e
		LEFT JOIN user_refs ur ON ur.user_id = e.student_id
		WHERE 1=1`
	args := []any{}
	i := 1
	if len(f.StudentIDs) > 0 {
		query += " AND e.student_id = ANY($" + strconv.Itoa(i) + ")"
		args = append(args, f.StudentIDs)
		i++
	} else if f.StudentID != nil {
		query += " AND e.student_id = $" + strconv.Itoa(i)
		args = append(args, *f.StudentID)
		i++
	}
	if f.TutorID != nil {
		query += " AND e.tutor_id = $" + strconv.Itoa(i)
		args = append(args, *f.TutorID)
		i++
	}
	if f.CourseID != nil {
		query += " AND e.course_id = $" + strconv.Itoa(i)
		args = append(args, *f.CourseID)
		i++
	}
	if f.Status != "" {
		query += " AND e.status = $" + strconv.Itoa(i)
		args = append(args, f.Status)
		i++
	}
	if f.BranchID != nil {
		query += " AND ur.branch_id = $" + strconv.Itoa(i)
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
		JOIN course_tutors ct ON ct.course_id = e.course_id AND ct.tutor_id = $1
		LEFT JOIN user_refs ur ON ur.user_id = e.student_id
		WHERE 1=1`
	args := []any{tutorID}
	i := 2
	if branchID != nil {
		query += " AND ur.branch_id = $" + strconv.Itoa(i)
		args = append(args, *branchID)
		i++
	}
	if courseID != nil {
		query += " AND e.course_id = $" + strconv.Itoa(i)
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
// её нужно осознанно снять с паузы (UpdateProgress status='active') —
// либо она снимается автоматически, когда курсу назначают преподавателя
// (CourseHandler.AssignTutor вызывает парную операцию
// ResumeOrphanedForCourse ниже; в том числе для того же самого
// преподавателя, восстановленного в штате после увольнения).
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

// ResumeOrphanedForCourse — обратная операция к PauseOrphanedForCourses:
// когда курсу назначают преподавателя (CourseHandler.AssignTutor), снимает
// с паузы записи, которые были поставлены на паузу именно из-за "осиротения"
// курса (status='paused' И tutor_id IS NULL — ручная пауза по другой причине
// тут невозможна: во всей кодовой базе status='paused' выставляется только
// в PauseOrphanedForCourses, см. её комментарий). Заодно проставляет
// tutor_id = tutorID, чтобы ученик сразу был явно закреплён за новым
// преподавателем, а не просто "активен без хозяина".
//
// Без этого шага после увольнения и восстановления/переназначения
// преподавателя на курс его ученики оставались бы в enrollments.status=
// 'paused' навсегда — сам препод по-прежнему видел бы их в "Мои ученики"
// (тот список не фильтрует по status), но не смог бы завести им занятие
// в TutorNewLesson.jsx, где фильтр на активные enrollments есть явно.
func (r *EnrollmentRepository) ResumeOrphanedForCourse(ctx context.Context, courseID, tutorID int64) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE enrollments SET status = 'active', tutor_id = $1
		 WHERE course_id = $2 AND status = 'paused' AND tutor_id IS NULL`,
		tutorID, courseID)
	return err
}

// DeleteByStudent — физически удаляет ВСЕ записи о зачислении ученика на
// курсы. В отличие от UnassignTutorEverywhere (у репетитора отвязка, а не
// удаление — enrollment это данные ученика), тут ученик сам перестаёт
// существовать (выпустился/удалён в User Service, см. user.deleted в
// internal/events/subscriber.go), поэтому его записи о зачислении удаляются
// целиком, а не переводятся в какой-то статус.
func (r *EnrollmentRepository) DeleteByStudent(ctx context.Context, studentID int64) (int64, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM enrollments WHERE student_id = $1`, studentID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// TerminateExpiredForCourse only closes enrollments whose stored contract
// end date has actually passed. This prevents a delayed contract.expired event
// from closing a freshly renewed contract for the same student/course.
func (r *EnrollmentRepository) TerminateExpiredForCourse(ctx context.Context, studentID, courseID int64) (int64, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE enrollments SET status = 'terminated'
		WHERE student_id = $1 AND course_id = $2
		  AND status IN ('active', 'paused')
		  AND end_date IS NOT NULL AND end_date < CURRENT_DATE
	`, studentID, courseID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// TerminateForCourse — переводит enrollment(ы) ученика на конкретном курсе
// в status='terminated' (см. events/subscriber.go, handleContractTerminated —
// реакция на расторжение договора). Затрагивает только active/paused
// записи: уже completed (курс пройден штатно) расторжением договора задним
// числом не переписывается — это исторический факт, а не текущее состояние.
// Возвращает количество затронутых строк (для лога в подписчике).
// ActivateForCourse restores the enrollment for a renewed/continued contract.
// Existing progress and tutor assignment are preserved.
func (r *EnrollmentRepository) ActivateForCourse(ctx context.Context, studentID, courseID int64, startDate, endDate *string) (int64, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE enrollments
		SET status = 'active', start_date = $3, end_date = $4
		WHERE id = (
			SELECT id FROM enrollments
			WHERE student_id = $1 AND course_id = $2
			ORDER BY CASE WHEN status = 'terminated' THEN 0 ELSE 1 END, id DESC
			LIMIT 1
		)`, studentID, courseID, startDate, endDate)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// UpdateDatesForCourse keeps enrollment dates aligned with the contract.
func (r *EnrollmentRepository) UpdateDatesForCourse(ctx context.Context, studentID, courseID int64, startDate, endDate *string) (int64, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE enrollments SET start_date = $3, end_date = $4
		WHERE student_id = $1 AND course_id = $2 AND status IN ('active', 'paused')`,
		studentID, courseID, startDate, endDate)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// CompleteExpiredForCourse переводит enrollment в completed при естественном
// окончании срока договора. Сверка end_date с датой из события защищает от
// запоздалого события старого договора после продления курса.
func (r *EnrollmentRepository) CompleteExpiredForCourse(ctx context.Context, studentID, courseID int64, endDate string) (int64, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE enrollments SET status = 'completed'
		WHERE student_id = $1 AND course_id = $2
		  AND status IN ('active', 'paused')
		  AND end_date = $3::date
		  AND end_date < CURRENT_DATE
	`, studentID, courseID, endDate)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (r *EnrollmentRepository) TerminateForCourse(ctx context.Context, studentID, courseID int64) (int64, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE enrollments SET status = 'terminated'
		WHERE student_id = $1 AND course_id = $2 AND status IN ('active', 'paused')
	`, studentID, courseID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// RecalculateProgress — пересчитывает progress_pct ученика по конкретному
// курсу автоматически, на основе занятий, которые ему реально ставит
// преподаватель (таблицы lessons/lesson_participants), а не вручную.
//
// Прогресс = доля занятий этого ученика на курсе со статусом 'completed'
// от всех НЕотменённых занятий этого ученика на курсе (запланированные +
// проведённые). Отменённые (status='cancelled') занятия не участвуют ни в
// числителе, ни в знаменателе — отменённое занятие не должно ни повышать,
// ни занижать прогресс.
//
// Если у ученика по этому курсу вообще ещё нет занятий — прогресс 0
// (не 100%, чтобы пустой курс не выглядел "пройденным").
//
// Вызывается из LessonHandler всякий раз, когда меняется набор занятий
// ученика по курсу или их статус: создание занятия (см. LessonHandler.Create),
// смена статуса, включая отметку "проведено" (см. LessonHandler.Update) и
// отмена занятия (см. LessonHandler.Delete/Cancel) — то есть после любого
// действия тьютора, которое может изменить числитель или знаменатель.
//
// Именно поэтому ручное выставление progress_pct через
// PATCH /enrollments/{id} убрано из EnrollmentHandler.Update — эта функция
// единственный источник изменения progress_pct, чтобы прогресс всегда
// отражал реальное количество занятий, отмеченных преподавателем, а не
// произвольное число.
//
// Возвращает (nil, nil), если у пары student_id+course_id ещё нет записи
// enrollment (например, ученика отчислили ровно между созданием занятия и
// пересчётом) — это не ошибка вызывающего кода, просто нечего обновлять.
func (r *EnrollmentRepository) RecalculateProgress(ctx context.Context, studentID, courseID int64) (*models.Enrollment, error) {
	var total, completed int
	err := r.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE l.status <> 'cancelled') AS total,
			COUNT(*) FILTER (WHERE l.status = 'completed') AS completed
		FROM lesson_participants lp
		JOIN lessons l ON l.id = lp.lesson_id
		WHERE lp.student_id = $1 AND l.course_id = $2
	`, studentID, courseID).Scan(&total, &completed)
	if err != nil {
		return nil, err
	}

	pct := 0
	if total > 0 {
		pct = int(math.Round(float64(completed) * 100 / float64(total)))
	}

	query := `UPDATE enrollments SET progress_pct = $1
		WHERE student_id = $2 AND course_id = $3
		RETURNING ` + enrollmentColumns
	e, err := scanEnrollment(r.pool.QueryRow(ctx, query, pct, studentID, courseID))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return e, nil
}

func (r *EnrollmentRepository) UpdateProgress(ctx context.Context, id int64, fields map[string]any) (*models.Enrollment, error) {
	if len(fields) == 0 {
		return r.GetByID(ctx, id)
	}
	// progress_pct сюда намеренно не входит: с введением автоматического
	// подсчёта прогресса (см. RecalculateProgress выше) это поле больше не
	// редактируется вручную через PATCH /enrollments/{id}, единственный
	// путь его изменить — реальные занятия, отмеченные преподавателем.
	allowedCols := map[string]bool{"status": true, "start_date": true, "end_date": true}
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
	query := "UPDATE enrollments SET " + setClauses + " WHERE id = $" + strconv.Itoa(i) + " RETURNING " + enrollmentColumns
	return scanEnrollment(r.pool.QueryRow(ctx, query, args...))
}

// EnrollmentStudentBranchID — вспомогательный запрос для авторизации
// (branch_owner может управлять только записями учеников своего филиала).
// Курсы больше не привязаны к филиалу, поэтому филиал берётся из карточки
// ученика (user_refs), а не из курса.
func (r *EnrollmentRepository) EnrollmentStudentBranchID(ctx context.Context, enrollmentID int64) (int64, error) {
	var branchID *int64
	err := r.pool.QueryRow(ctx, `
		SELECT ur.branch_id FROM enrollments e
		LEFT JOIN user_refs ur ON ur.user_id = e.student_id
		WHERE e.id = $1`, enrollmentID).Scan(&branchID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, err
	}
	if branchID == nil {
		return 0, ErrNotFound
	}
	return *branchID, nil
}
