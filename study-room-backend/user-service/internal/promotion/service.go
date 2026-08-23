// Package promotion — ежегодное автоматическое повышение класса учеников с
// началом нового учебного года (1 сентября) и автоматическое удаление тех,
// кто уже закончил 11 класс (для них "12 класса" не существует — они
// считаются выпустившимися).
//
// Идемпотентность: student_profiles.last_promoted_year хранит учебный год
// (число вроде 2026 = учебный год 2026/2027), в котором ученику последний
// раз меняли класс этим job'ом. Без этой отметки повторный запуск в тот же
// учебный год (например, после перезапуска сервиса тем же днём) повысил бы
// класс ещё раз — с этим полем такой повторный запуск просто ничего не
// делает (WHERE last_promoted_year IS NULL OR <> текущий_год).
//
// Ученики, чей class_info не является чистым числом 1..11 (устаревшие
// свободнотекстовые значения вроде "10А", введённые до миграции
// 0005_student_class_number), намеренно НЕ трогаются — SQL-регэксп в WHERE
// их просто не матчит, поэтому job не падает на "грязных" данных и не
// пытается ::int-скастовать нечисловую строку.
package promotion

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"studyroom/user-service/internal/events"
	"studyroom/user-service/internal/models"
)

// gradeRegex — совпадает с CHECK-констрейнтом class_info_is_grade_number
// из миграции 0005 (классы 1..11), но регекс для UPDATE-запроса ниже
// нарочно ловит ТОЛЬКО 1..10 (кандидаты на повышение) — 11 класс обрабатывается
// отдельно веткой "выпуск", а не инкрементом.
const promotableGradeRegex = `^([1-9]|10)$`

type Service struct {
	pool *pgxpool.Pool
	pub  events.Publisher
}

func NewService(pool *pgxpool.Pool, pub events.Publisher) *Service {
	return &Service{pool: pool, pub: pub}
}

// schoolYear — учебный год, к которому относится дата t. С 1 сентября по
// 31 августа следующего календарного года — один и тот же учебный год,
// обозначаемый годом его начала (сентябрь 2026 → 2026, обозначает 2026/2027).
func schoolYear(t time.Time) int {
	if t.Month() >= time.September {
		return t.Year()
	}
	return t.Year() - 1
}

// RunIfDue проверяет, наступил ли (или уже шёл) учебный год, в котором
// повышение ещё не проводилось, и если да — проводит его. Безопасно
// вызывать многократно (в т.ч. каждый день) — благодаря last_promoted_year
// повторные вызовы в рамках одного и того же учебного года не делают
// ничего лишнего.
func (s *Service) RunIfDue(ctx context.Context) error {
	now := time.Now()
	if now.Month() < time.September {
		// До 1 сентября текущего календарного года последний ПОЛНОСТЬЮ
		// наступивший учебный год — это прошлогодний, который уже должен
		// был быть обработан осенью прошлого года. Ждём.
		return nil
	}
	return s.run(ctx, schoolYear(now))
}

// run выполняет собственно повышение классов и выпуск в рамках одной
// транзакции: если что-то из этого упадёт, откатывается всё целиком —
// не может получиться так, что часть учеников выпустили, а часть
// повысили лишь наполовину.
func (s *Service) run(ctx context.Context, year int) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// 1. Собираем данные о выпускниках (класс "11", ещё не обработан в этом
	// учебном году) ДО удаления — после DELETE строки уже не будет, а эти
	// данные нужны для события user.deleted (см. events.DeletedUserInfo).
	rows, err := tx.Query(ctx, `
		SELECT u.id, u.email, u.first_name, u.last_name, u.branch_id,
		       COALESCE(array_agg(ps.parent_id) FILTER (WHERE ps.parent_id IS NOT NULL), '{}')
		FROM users u
		JOIN student_profiles sp ON sp.user_id = u.id
		LEFT JOIN parent_student ps ON ps.student_id = u.id
		WHERE u.role = 'student' AND sp.class_info = '11'
		  AND (sp.last_promoted_year IS NULL OR sp.last_promoted_year <> $1)
		GROUP BY u.id, u.email, u.first_name, u.last_name, u.branch_id
	`, year)
	if err != nil {
		return err
	}
	var graduates []events.DeletedUserInfo
	for rows.Next() {
		var g events.DeletedUserInfo
		if err := rows.Scan(&g.ID, &g.Email, &g.FirstName, &g.LastName, &g.BranchID, &g.ParentIDs); err != nil {
			rows.Close()
			return err
		}
		g.Role = models.RoleStudent
		graduates = append(graduates, g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	// 2. Удаляем выпускников. ON DELETE CASCADE (0001_init.up.sql) сам
	// подчищает student_profiles/parent_student/refresh_tokens в этой же
	// БД — вручную ничего дочищать не нужно.
	if len(graduates) > 0 {
		ids := make([]int64, len(graduates))
		for i, g := range graduates {
			ids[i] = g.ID
		}
		if _, err := tx.Exec(ctx, `DELETE FROM users WHERE id = ANY($1)`, ids); err != nil {
			return err
		}
	}

	// 3. Повышаем оставшихся на класс: 1→2, ..., 10→11.
	tag, err := tx.Exec(ctx, `
		UPDATE student_profiles
		SET class_info = (class_info::int + 1)::text, last_promoted_year = $1
		WHERE class_info ~ '`+promotableGradeRegex+`'
		  AND (last_promoted_year IS NULL OR last_promoted_year <> $1)
	`, year)
	if err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	log.Printf("[promotion] school year %d/%d: promoted %d student(s), graduated %d student(s)",
		year, year+1, tag.RowsAffected(), len(graduates))

	// Публикуем события ПОСЛЕ успешного commit — если бы транзакция
	// откатилась, а событие уже улетело, другие сервисы отреагировали бы
	// на удаление, которого по факту не произошло.
	for _, g := range graduates {
		s.pub.UserDeleted(g)
	}
	return nil
}

// StartScheduler запускает фоновую проверку: сразу при старте (на случай,
// если сервис был выключен ровно 1 сентября или задеплоен позже этой даты —
// без этого повышение просто не произошло бы, пока кто-то не перезапустит
// процесс уже в новом календарном году после сентября) и затем раз в сутки.
// Останавливается через ctx (см. main.go, отмена при shutdown).
func (s *Service) StartScheduler(ctx context.Context) {
	if err := s.RunIfDue(ctx); err != nil {
		log.Printf("[promotion] startup check error: %v", err)
	}
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.RunIfDue(ctx); err != nil {
				log.Printf("[promotion] daily check error: %v", err)
			}
		}
	}
}
