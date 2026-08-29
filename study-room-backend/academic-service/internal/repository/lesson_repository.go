package repository

import (
	"context"
	"errors"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/academic-service/internal/models"
)

type LessonRepository struct {
	pool *pgxpool.Pool
}

func NewLessonRepository(pool *pgxpool.Pool) *LessonRepository {
	return &LessonRepository{pool: pool}
}

const lessonColumns = `id, course_id, tutor_id, created_by, topic, lesson_date, start_time, end_time,
	location_type, group_type, status, comment, created_at`

func scanLesson(row pgx.Row) (*models.Lesson, error) {
	var l models.Lesson
	err := row.Scan(&l.ID, &l.CourseID, &l.TutorID, &l.CreatedBy, &l.Topic, &l.LessonDate,
		&l.StartTime, &l.EndTime, &l.LocationType, &l.GroupType, &l.Status, &l.Comment, &l.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &l, nil
}

// LessonInput — поля, нужные для создания занятия (см. api-contracts.md 2.8).
type LessonInput struct {
	CourseID     int64
	TutorID      int64
	CreatedBy    int64
	Topic        string
	LessonDate   string
	StartTime    string
	EndTime      string
	LocationType models.LocationType
	GroupType    models.GroupType
	Comment      *string
	// ParticipantIDs — ученики занятия. Для individual-формата обычно один
	// участник; заполняется из enrollment (студент курса) или явно передаётся.
	ParticipantIDs []int64
}

// Create создаёт занятие и его участников одной транзакцией.
func (r *LessonRepository) Create(ctx context.Context, in LessonInput) (*models.Lesson, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	query := `INSERT INTO lessons (course_id, tutor_id, created_by, topic, lesson_date,
		start_time, end_time, location_type, group_type, comment)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ` + lessonColumns
	row := tx.QueryRow(ctx, query, in.CourseID, in.TutorID, in.CreatedBy, in.Topic, in.LessonDate,
		in.StartTime, in.EndTime, in.LocationType, in.GroupType, in.Comment)
	l, err := scanLesson(row)
	if err != nil {
		return nil, err
	}

	for _, sid := range in.ParticipantIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO lesson_participants (lesson_id, student_id) VALUES ($1,$2)
			 ON CONFLICT DO NOTHING`, l.ID, sid); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return l, nil
}

func (r *LessonRepository) GetByID(ctx context.Context, id int64) (*models.Lesson, error) {
	query := `SELECT ` + lessonColumns + ` FROM lessons WHERE id = $1`
	return scanLesson(r.pool.QueryRow(ctx, query, id))
}

// LessonFilter — tutor_id/student_id/date_from/date_to как в контракте 2.7.
// BranchID — внутренний принудительный фильтр для branch_owner (курсы не
// привязаны к филиалу, поэтому фильтруем по филиалу преподавателя занятия
// через user_refs), не часть публичного query-контракта.
type LessonFilter struct {
	TutorID    *int64
	StudentID  *int64
	// StudentIDs — фильтр "IN (...)" для parent с несколькими детьми,
	// взаимоисключим со StudentID (см. EnrollmentFilter для того же паттерна).
	StudentIDs []int64
	BranchID   *int64
	DateFrom   string
	DateTo     string
}

func (r *LessonRepository) List(ctx context.Context, f LessonFilter) ([]*models.Lesson, error) {
	query := `SELECT DISTINCT l.id, l.course_id, l.tutor_id, l.created_by, l.topic, l.lesson_date,
		l.start_time, l.end_time, l.location_type, l.group_type, l.status, l.comment, l.created_at
		FROM lessons l
		LEFT JOIN user_refs ur ON ur.user_id = l.tutor_id`
	if f.StudentID != nil || len(f.StudentIDs) > 0 {
		query += ` JOIN lesson_participants lp ON lp.lesson_id = l.id`
	}
	query += ` WHERE 1=1`
	args := []any{}
	i := 1
	if f.TutorID != nil {
		query += " AND l.tutor_id = $" + strconv.Itoa(i)
		args = append(args, *f.TutorID)
		i++
	}
	if len(f.StudentIDs) > 0 {
		query += " AND lp.student_id = ANY($" + strconv.Itoa(i) + ")"
		args = append(args, f.StudentIDs)
		i++
	} else if f.StudentID != nil {
		query += " AND lp.student_id = $" + strconv.Itoa(i)
		args = append(args, *f.StudentID)
		i++
	}
	if f.BranchID != nil {
		query += " AND ur.branch_id = $" + strconv.Itoa(i)
		args = append(args, *f.BranchID)
		i++
	}
	if f.DateFrom != "" {
		query += " AND l.lesson_date >= $" + strconv.Itoa(i)
		args = append(args, f.DateFrom)
		i++
	}
	if f.DateTo != "" {
		query += " AND l.lesson_date <= $" + strconv.Itoa(i)
		args = append(args, f.DateTo)
		i++
	}
	query += " ORDER BY l.lesson_date, l.start_time"

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Lesson
	for rows.Next() {
		l, err := scanLesson(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (r *LessonRepository) Update(ctx context.Context, id int64, fields map[string]any) (*models.Lesson, error) {
	if len(fields) == 0 {
		return r.GetByID(ctx, id)
	}
	allowedCols := map[string]bool{
		"topic": true, "lesson_date": true, "start_time": true, "end_time": true,
		"location_type": true, "group_type": true, "status": true, "comment": true, "tutor_id": true,
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
	query := "UPDATE lessons SET " + setClauses + " WHERE id = $" + strconv.Itoa(i) + " RETURNING " + lessonColumns
	return scanLesson(r.pool.QueryRow(ctx, query, args...))
}

// Cancel — это и есть "DELETE /lessons/{id}" из контракта (2.9), которое по
// смыслу является отменой занятия, а не удалением его из истории: занятие
// помечается status = 'cancelled' и остаётся в базе, поэтому оно продолжает
// возвращаться из List(...) (тот не фильтрует по status) — тьютор, owner/
// branch_owner и сам ученик/родитель видят его в расписании со статусом
// "Отменено" (см. StatusBadge.jsx на фронте), вместо того чтобы занятие
// молча исчезало из выборки только после следующего фактического запроса.
//
// Раньше здесь был настоящий `DELETE FROM lessons`, из-за чего:
//   - в текущей сессии (без перезагрузки страницы) фронт красиво помечал
//     занятие как "Отменено" локально (EditLessonModal -> onCancelled),
//     но это никак не отражало реальное состояние в БД;
//   - при следующей загрузке расписания (например, после F5) занятие
//     полностью пропадало из ответа /lessons, поскольку строка была
//     физически удалена — то есть создавалось впечатление, что "отмена
//     работает только после обновления страницы".
func (r *LessonRepository) Cancel(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE lessons SET status = $1 WHERE id = $2`, models.LessonCancelled, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteByTutor — полностью удаляет из БД все занятия уволенного репетитора
// (lessons.tutor_id = tutorID), а не просто снимает его с расписания.
// lessons удаляются вместе с lesson_participants и attendance каскадно (см.
// ON DELETE CASCADE в 0001_init.up.sql), поэтому явно чистить эти таблицы
// отдельно не нужно. Используется при увольнении — см. events/subscriber.go,
// detachTutor.
func (r *LessonRepository) DeleteByTutor(ctx context.Context, tutorID int64) (int64, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM lessons WHERE tutor_id = $1`, tutorID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// RemoveStudentEverywhere — удаляет ученика из всех занятий (lesson_participants)
// и его записи о посещаемости (attendance) по ВСЕМ занятиям, но НЕ трогает
// сами lessons — в отличие от DeleteByTutor (там занятие целиком принадлежит
// одному репетитору), на одном занятии могут присутствовать другие ученики,
// поэтому занятие должно остаться для них.
//
// Обе таблицы чистятся явно в одной транзакции: lesson_participants и
// attendance никак не связаны FK друг с другом (обе ссылаются только на
// lessons — см. 0001_init.up.sql), поэтому удаление из одной не каскадирует
// в другую автоматически. Используется при выпуске/удалении ученика — см.
// events/subscriber.go, detachStudent.
func (r *LessonRepository) RemoveStudentEverywhere(ctx context.Context, studentID int64) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM lesson_participants WHERE student_id = $1`, studentID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM attendance WHERE student_id = $1`, studentID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// StudentCoursePair — пара (ученик, курс), для которой нужно пересчитать
// progress_pct (см. EnrollmentRepository.RecalculateProgress). Используется
// как возврат из AutoCompletePast — вызывающей стороне (фоновая джоба в
// cmd/api/main.go) не нужно знать внутренности lesson_participants, чтобы
// понять, кому именно пересчитать прогресс после авто-завершения занятий.
type StudentCoursePair struct {
	StudentID int64
	CourseID  int64
}

// AutoCompletePast — переводит в status='completed' все ещё
// "запланированные" (status='scheduled') занятия, которые уже фактически
// закончились по дате и времени (lesson_date + end_time в прошлом), но
// которые тьютор не отменил и не отметил вручную. Раньше пометка
// "проведено" была ручным действием тьютора; теперь занятие считается
// проведённым автоматически, как только время вышло, если оно не было
// отменено — тьютору вообще не нужно ничего нажимать.
//
// Время сравнивается в часовом поясе Europe/Moscow: даты/время занятий
// вводятся тьюторами в этом поясе (вся бизнес-логика расписания на нём
// завязана), независимо от того, в каком часовом поясе физически
// развёрнута сама БД (обычно UTC на сервере).
//
// Вызывается из фоновой джобы (см. cmd/api/main.go, startAutoCompleteJob) —
// раз в минуту, best-effort. Возвращает пары (ученик, курс), которые нужно
// пересчитать (см. StudentCoursePair) — по одному занятию может быть
// несколько участников (групповое занятие), и один и тот же ученик может
// одновременно завершить несколько занятий за один тик джобы, поэтому пары
// дедуплицированы.
func (r *LessonRepository) AutoCompletePast(ctx context.Context) ([]StudentCoursePair, error) {
	rows, err := r.pool.Query(ctx, `
		UPDATE lessons SET status = 'completed'
		WHERE status = 'scheduled'
		  AND (lesson_date + end_time::time) < (now() AT TIME ZONE 'Europe/Moscow')
		RETURNING id, course_id
	`)
	if err != nil {
		return nil, err
	}
	lessonCourse := map[int64]int64{}
	var lessonIDs []int64
	for rows.Next() {
		var id, courseID int64
		if err := rows.Scan(&id, &courseID); err != nil {
			rows.Close()
			return nil, err
		}
		lessonCourse[id] = courseID
		lessonIDs = append(lessonIDs, id)
	}
	scanErr := rows.Err()
	rows.Close()
	if scanErr != nil {
		return nil, scanErr
	}
	if len(lessonIDs) == 0 {
		return nil, nil
	}

	prows, err := r.pool.Query(ctx,
		`SELECT lesson_id, student_id FROM lesson_participants WHERE lesson_id = ANY($1)`,
		lessonIDs,
	)
	if err != nil {
		return nil, err
	}
	defer prows.Close()

	seen := map[StudentCoursePair]bool{}
	var pairs []StudentCoursePair
	for prows.Next() {
		var lessonID, studentID int64
		if err := prows.Scan(&lessonID, &studentID); err != nil {
			return nil, err
		}
		pair := StudentCoursePair{StudentID: studentID, CourseID: lessonCourse[lessonID]}
		if !seen[pair] {
			seen[pair] = true
			pairs = append(pairs, pair)
		}
	}
	if err := prows.Err(); err != nil {
		return nil, err
	}
	return pairs, nil
}

// CancelForStudentAndCourse — реакция на расторжение договора ученика по
// конкретному курсу (см. events/subscriber.go, handleContractTerminated).
// Отменяет только ещё НЕ проведённые занятия (status='scheduled') — уже
// состоявшиеся (status='completed') остаются как есть: расторжение
// договора не отменяет прошлое и не должно портить историю
// посещаемости/прогресса (см. EnrollmentRepository.RecalculateProgress —
// в её знаменатель и так не попадают отменённые занятия).
//
// Индивидуальные занятия (единственный участник — этот ученик) помечаются
// status='cancelled' целиком, как при обычной ручной отмене (см. Cancel) —
// видны в расписании со статусом "Отменено". Групповые занятия, где кроме
// этого ученика есть другие участники, отменять для всей группы нельзя —
// ученика просто убирают из lesson_participants (как при выпуске, см.
// RemoveStudentEverywhere), а само занятие остаётся в расписании для
// остальных участников.
//
// Возвращает количество занятий, реально помеченных отменёнными (для лога
// в подписчике), не считая тех, откуда ученика просто тихо убрали.
func (r *LessonRepository) CancelForStudentAndCourse(ctx context.Context, studentID, courseID int64) (int64, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE lessons SET status = 'cancelled'
		WHERE course_id = $2 AND status = 'scheduled'
		  AND id IN (SELECT lesson_id FROM lesson_participants WHERE student_id = $1)
		  AND id IN (SELECT lesson_id FROM lesson_participants GROUP BY lesson_id HAVING COUNT(*) = 1)
	`, studentID, courseID)
	if err != nil {
		return 0, err
	}
	cancelled := tag.RowsAffected()

	if _, err := tx.Exec(ctx, `
		DELETE FROM lesson_participants
		WHERE student_id = $1
		  AND lesson_id IN (
		    SELECT l.id FROM lessons l
		    JOIN lesson_participants lp ON lp.lesson_id = l.id AND lp.student_id = $1
		    WHERE l.course_id = $2 AND l.status = 'scheduled'
		  )
	`, studentID, courseID); err != nil {
		return 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return cancelled, nil
}

// TutorBranchID — филиал преподавателя занятия, для проверки прав
// branch_owner (курсы больше не привязаны к филиалу).
func (r *LessonRepository) TutorBranchID(ctx context.Context, lessonID int64) (int64, error) {
	var branchID *int64
	err := r.pool.QueryRow(ctx, `
		SELECT ur.branch_id FROM lessons l
		LEFT JOIN user_refs ur ON ur.user_id = l.tutor_id
		WHERE l.id = $1`,
		lessonID).Scan(&branchID)
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

// ParticipantsByLessons — батч-версия Participants для списка занятий сразу
// (используется в LessonHandler.List, чтобы отдать participant_ids вместе
// со списком занятий без N+1 запросов). Возвращает map lesson_id -> student_ids;
// занятия без участников в карте просто отсутствуют.
func (r *LessonRepository) ParticipantsByLessons(ctx context.Context, lessonIDs []int64) (map[int64][]int64, error) {
	out := map[int64][]int64{}
	if len(lessonIDs) == 0 {
		return out, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT lesson_id, student_id FROM lesson_participants WHERE lesson_id = ANY($1)`, lessonIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var lessonID, studentID int64
		if err := rows.Scan(&lessonID, &studentID); err != nil {
			return nil, err
		}
		out[lessonID] = append(out[lessonID], studentID)
	}
	return out, rows.Err()
}

// IsStudentOfTutor — есть ли у этого преподавателя хоть одно занятие
// (проведённое или ещё запланированное, т.е. не отменённое) с данным
// учеником среди участников. Используется для ограничения выдачи домашних
// заданий и тестов: тьютор может выдавать их только тем ученикам, с
// которыми у него уже было или будет занятие (см. homework_handler.go,
// test_handler.go — Create), а не любому ученику филиала/сети.
func (r *LessonRepository) IsStudentOfTutor(ctx context.Context, tutorID, studentID int64) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM lesson_participants lp
			JOIN lessons l ON l.id = lp.lesson_id
			WHERE l.tutor_id = $1 AND lp.student_id = $2 AND l.status <> 'cancelled'
		)`, tutorID, studentID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// Participants — id учеников, участвующих в занятии (для проверки доступа
// parent/student к посещаемости, см. api-contracts.md 2.11).
func (r *LessonRepository) Participants(ctx context.Context, lessonID int64) ([]int64, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT student_id FROM lesson_participants WHERE lesson_id = $1`, lessonID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// DigestLessonItem — одно занятие ученика на конкретный день, для
// ежедневного дайджеста (см. cmd/api/main.go, startDailyDigestJob).
type DigestLessonItem struct {
	Topic     string
	StartTime string
	EndTime   string
}

// ListTodayByStudent — группирует ещё не отменённые занятия на указанную
// дату (формат YYYY-MM-DD) по участникам: "кому какие занятия сегодня и во
// сколько". Используется дневным дайджестом, отправляемым в 9:00 МСК —
// ученики/родители без занятий в этот день в результат не попадают вообще
// (пустой дайджест никому не рассылается).
func (r *LessonRepository) ListTodayByStudent(ctx context.Context, dateISO string) (map[int64][]DigestLessonItem, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT lp.student_id, l.topic, l.start_time, l.end_time
		FROM lesson_participants lp
		JOIN lessons l ON l.id = lp.lesson_id
		WHERE l.lesson_date = $1 AND l.status <> 'cancelled'
		ORDER BY lp.student_id, l.start_time
	`, dateISO)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out2 := map[int64][]DigestLessonItem{}
	for rows.Next() {
		var studentID int64
		var item DigestLessonItem
		if err := rows.Scan(&studentID, &item.Topic, &item.StartTime, &item.EndTime); err != nil {
			return nil, err
		}
		out2[studentID] = append(out2[studentID], item)
	}
	return out2, rows.Err()
}
