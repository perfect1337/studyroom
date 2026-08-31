package repository

import (
	"context"
	"errors"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/academic-service/internal/models"
)

type SubgroupRepository struct {
	pool *pgxpool.Pool
}

func NewSubgroupRepository(pool *pgxpool.Pool) *SubgroupRepository {
	return &SubgroupRepository{pool: pool}
}

// Create — создаёт подгруппу и сразу заполняет её состав. Обе вставки — в
// одной транзакции: подгруппа без единого участника бессмысленна для
// вызывающего кода (SubgroupHandler.Create требует непустой student_ids),
// но так и на уровне репозитория гарантируется отсутствие "повисшей"
// пустой подгруппы, если вставка состава вдруг упадёт.
func (r *SubgroupRepository) Create(ctx context.Context, courseID, tutorID int64, name string, studentIDs []int64) (*models.Subgroup, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var sg models.Subgroup
	err = tx.QueryRow(ctx,
		`INSERT INTO subgroups (course_id, tutor_id, name) VALUES ($1,$2,$3)
		 RETURNING id, course_id, tutor_id, name, created_at`,
		courseID, tutorID, name,
	).Scan(&sg.ID, &sg.CourseID, &sg.TutorID, &sg.Name, &sg.CreatedAt)
	if err != nil {
		return nil, err
	}

	for _, studentID := range studentIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO subgroup_members (subgroup_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			sg.ID, studentID,
		); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	sg.StudentIDs = studentIDs
	return &sg, nil
}

func (r *SubgroupRepository) GetByID(ctx context.Context, id int64) (*models.Subgroup, error) {
	var sg models.Subgroup
	err := r.pool.QueryRow(ctx,
		`SELECT id, course_id, tutor_id, name, created_at FROM subgroups WHERE id = $1`,
		id,
	).Scan(&sg.ID, &sg.CourseID, &sg.TutorID, &sg.Name, &sg.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	studentIDs, err := r.MembersOf(ctx, id)
	if err != nil {
		return nil, err
	}
	sg.StudentIDs = studentIDs
	return &sg, nil
}

// MembersOf — id учеников подгруппы. Отдельный метод (а не только через
// GetByID) — нужен LessonHandler.Create, чтобы получить состав без
// повторного похода за самой подгруппой, если она уже загружена.
func (r *SubgroupRepository) MembersOf(ctx context.Context, subgroupID int64) ([]int64, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT student_id FROM subgroup_members WHERE subgroup_id = $1 ORDER BY student_id`,
		subgroupID,
	)
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

// SubgroupFilter — как и в остальных List (см. CourseFilter/EnrollmentFilter):
// CourseID/TutorID сужают выборку, хендлер сам решает, что подставлять
// исходя из роли (владелец видит любые, тьютор — только свои).
type SubgroupFilter struct {
	CourseID *int64
	TutorID  *int64
}

func (r *SubgroupRepository) List(ctx context.Context, f SubgroupFilter) ([]*models.Subgroup, error) {
	query := `SELECT id, course_id, tutor_id, name, created_at FROM subgroups WHERE 1=1`
	args := []any{}
	i := 1
	if f.CourseID != nil {
		query += " AND course_id = $" + strconv.Itoa(i)
		args = append(args, *f.CourseID)
		i++
	}
	if f.TutorID != nil {
		query += " AND tutor_id = $" + strconv.Itoa(i)
		args = append(args, *f.TutorID)
		i++
	}
	query += " ORDER BY name"

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.Subgroup
	var ids []int64
	for rows.Next() {
		var sg models.Subgroup
		if err := rows.Scan(&sg.ID, &sg.CourseID, &sg.TutorID, &sg.Name, &sg.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &sg)
		ids = append(ids, sg.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Состав подгрупп подтягиваем одним запросом на все id сразу, а не
	// N+1 внутри цикла выше (тот же приём, что и в LessonHandler.List
	// для participant_ids — см. ParticipantsByLessons).
	if len(ids) == 0 {
		return out, nil
	}
	membersRows, err := r.pool.Query(ctx,
		`SELECT subgroup_id, student_id FROM subgroup_members WHERE subgroup_id = ANY($1) ORDER BY student_id`,
		ids,
	)
	if err != nil {
		return nil, err
	}
	defer membersRows.Close()

	membersBySubgroup := make(map[int64][]int64, len(ids))
	for membersRows.Next() {
		var subgroupID, studentID int64
		if err := membersRows.Scan(&subgroupID, &studentID); err != nil {
			return nil, err
		}
		membersBySubgroup[subgroupID] = append(membersBySubgroup[subgroupID], studentID)
	}
	if err := membersRows.Err(); err != nil {
		return nil, err
	}
	for _, sg := range out {
		sg.StudentIDs = membersBySubgroup[sg.ID]
	}
	return out, nil
}

// Rename — только имя. Состав меняется отдельным методом SetMembers, чтобы
// частичный PATCH ({"name": "..."}) не требовал от клиента каждый раз
// присылать полный список участников заново.
func (r *SubgroupRepository) Rename(ctx context.Context, id int64, name string) error {
	tag, err := r.pool.Exec(ctx, `UPDATE subgroups SET name = $1 WHERE id = $2`, name, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetMembers — полностью заменяет состав подгруппы на переданный список
// (проще и надёжнее, чем разбирать add/remove diff на клиенте — фронт и
// так всегда оперирует полным списком выбранных учеников в форме).
func (r *SubgroupRepository) SetMembers(ctx context.Context, subgroupID int64, studentIDs []int64) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM subgroup_members WHERE subgroup_id = $1`, subgroupID); err != nil {
		return err
	}
	for _, studentID := range studentIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO subgroup_members (subgroup_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			subgroupID, studentID,
		); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *SubgroupRepository) Delete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM subgroups WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteByTutor — физически удаляет ВСЕ подгруппы данного преподавателя
// (вместе с их составом — subgroup_members уходит каскадом по FK, см.
// 0007_subgroups.up.sql). Используется при увольнении репетитора (см.
// events/subscriber.go: detachTutor), парно с CourseRepository.
// RemoveTutorEverywhere/EnrollmentRepository.UnassignTutorEverywhere/
// LessonRepository.DeleteByTutor.
//
// Зачем это отдельная операция: subgroups.tutor_id и subgroup_members —
// это ЛИЧНЫЙ, приватный для тьютора набор ("моя группа для занятий"),
// никак не связанный с course_tutors/enrollments — увольнение чистит
// только их. Без этого шага после увольнения подгруппа со своим старым
// составом учеников продолжала бы существовать в БД с тем же tutor_id, и
// при восстановлении в штат ("Восстановить в штат") преподаватель снова
// видел бы её (и её старых учеников) в GET /subgroups?tutor_id=...,
// например при создании нового занятия в TutorNewLesson.jsx — хотя из
// course_tutors/enrollments он к этим ученикам уже никак не привязан.
// Восстановление in-tutor-service (SetStatus/reinstateTutorOrActivate)
// эту таблицу не трогает и не должно — только сам факт увольнения
// (user.updated, is_active=false) считается источником правды для чистки.
func (r *SubgroupRepository) DeleteByTutor(ctx context.Context, tutorID int64) (int64, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM subgroups WHERE tutor_id = $1`, tutorID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
