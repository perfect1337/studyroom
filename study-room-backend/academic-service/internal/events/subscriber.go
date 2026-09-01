// Package events — подписка на события из брокера (NATS). Паттерн идентичен
// notification-service/internal/events/subscriber.go: очередь с queue group
// "academic-service" (несколько реплик поделят сообщения, а не продублируют
// обработку), best-effort — ошибка обработки одного сообщения логируется и
// не валит подписчика.
package events

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/nats-io/nats.go"
	"studyroom/academic-service/internal/models"
	"studyroom/academic-service/internal/repository"
)

// UserEvent — соответствует user.created/user.updated из api-contracts.md
// ("События NATS (User Service → Notification Service)"). Те же поля
// нужны и здесь: role/branch_id — чтобы матрица прав (2.6 microservices-plan.md)
// проверялась локально по user_refs.
type UserEvent struct {
	ID        int64       `json:"id"`
	FirstName string      `json:"first_name"`
	LastName  string      `json:"last_name"`
	Role      models.Role `json:"role"`
	BranchID  *int64      `json:"branch_id"`
	// IsActive — из users.is_active. Нужно, чтобы поймать увольнение
	// репетитора (is_active=false) и отвязать его от курсов/учеников —
	// см. handleUserEvent ниже.
	IsActive bool `json:"is_active"`
}

// ContractCreatedEvent — контракт события ещё не зафиксирован в
// api-contracts.md (Contracts Service — следующий пункт плана, см.
// microservices-plan.md, п.7), поэтому форма реконструирована из тела
// POST /contracts (3.1): student_id, course_id, branch_id, даты, плюс id
// самого договора. Обработчик намеренно нестрогий: если поля не совпадут,
// когда Contracts Service будет реализован, это не должно ронять подписку —
// см. handleContractCreated ниже.
type ContractCreatedEvent struct {
	ContractID int64   `json:"id"`
	StudentID  int64   `json:"student_id"`
	CourseID   int64   `json:"course_id"`
	TutorID    *int64  `json:"tutor_id"`
	StartDate  *string `json:"start_date"`
	EndDate    *string `json:"end_date"`
}

// ContractTerminatedEvent — расторжение договора (см.
// contracts-service/internal/events/publisher.go, ContractTerminated —
// ✅ реализован, форма зафиксирована и на публикующей, и на подписанной
// стороне, см. event-schema.md v1.contract.terminated).
type ContractTerminatedEvent struct {
	ContractID int64 `json:"id"`
	StudentID  int64 `json:"student_id"`
	CourseID   int64 `json:"course_id"`
}

// UserDeletedEvent — соответствует events.UserDeletedEvent из User Service
// (см. user-service/internal/events/publisher.go). Единственный источник на
// момент написания — ежегодное автоудаление выпускников 11 класса (см.
// user-service/internal/promotion), но обработчик не завязан на причину:
// любой user.deleted с role=student запускает detachStudent.
type ContractLifecycleEvent struct {
	ContractID int64  `json:"id"`
	StudentID  int64  `json:"student_id"`
	CourseID   int64  `json:"course_id"`
	StartDate  string `json:"start_date"`
	EndDate    string `json:"end_date"`
}

type UserDeletedEvent struct {
	ID   int64       `json:"id"`
	Role models.Role `json:"role"`
}

func Connect(url string) (*nats.Conn, error) {
	return nats.Connect(url,
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
		nats.Name("academic-service"),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			log.Printf("[events] NATS disconnected: %v", err)
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			log.Printf("[events] NATS reconnected to %s", nc.ConnectedUrl())
		}),
		nats.ClosedHandler(func(nc *nats.Conn) {
			log.Printf("[events] NATS connection closed: %v", nc.LastError())
		}),
	)
}

type Subscriber struct {
	nc           *nats.Conn
	userRefRepo  *repository.UserRefRepository
	enrollRepo   *repository.EnrollmentRepository
	courseRepo   *repository.CourseRepository
	lessonRepo   *repository.LessonRepository
	homeworkRepo *repository.HomeworkRepository
	testRepo     *repository.TestRepository
	subgroupRepo *repository.SubgroupRepository
}

func NewSubscriber(nc *nats.Conn, userRefRepo *repository.UserRefRepository, enrollRepo *repository.EnrollmentRepository, courseRepo *repository.CourseRepository, lessonRepo *repository.LessonRepository, homeworkRepo *repository.HomeworkRepository, testRepo *repository.TestRepository, subgroupRepo *repository.SubgroupRepository) *Subscriber {
	return &Subscriber{nc: nc, userRefRepo: userRefRepo, enrollRepo: enrollRepo, courseRepo: courseRepo, lessonRepo: lessonRepo, homeworkRepo: homeworkRepo, testRepo: testRepo, subgroupRepo: subgroupRepo}
}

// Start подписывается на нужные субъекты. Подписки живут вместе с процессом
// (соединение с NATS закрывается в main.go при shutdown, что автоматически
// останавливает и подписчиков) — тот же паттерн, что в notification-service.
func (s *Subscriber) Start(ctx context.Context) error {
	if _, err := s.nc.QueueSubscribe("user.created", "academic-service", s.handleUserCreated(ctx)); err != nil {
		return err
	}
	if _, err := s.nc.QueueSubscribe("user.updated", "academic-service", s.handleUserUpdated(ctx)); err != nil {
		return err
	}
	if _, err := s.nc.QueueSubscribe("contract.created", "academic-service", s.handleContractCreated(ctx)); err != nil {
		return err
	}
	if _, err := s.nc.QueueSubscribe("contract.terminated", "academic-service", s.handleContractTerminated(ctx)); err != nil {
		return err
	}
	if _, err := s.nc.QueueSubscribe("contract.expired", "academic-service", s.handleContractExpired(ctx)); err != nil {
		return err
	}
	if _, err := s.nc.QueueSubscribe("contract.activated", "academic-service", s.handleContractActivated(ctx)); err != nil {
		return err
	}
	if _, err := s.nc.QueueSubscribe("contract.updated", "academic-service", s.handleContractUpdated(ctx)); err != nil {
		return err
	}
	if _, err := s.nc.QueueSubscribe("user.deleted", "academic-service", s.handleUserDeleted(ctx)); err != nil {
		return err
	}
	return nil
}

func (s *Subscriber) upsertUserRef(ctx context.Context, ev UserEvent) {
	ref := &models.UserRef{
		UserID:   ev.ID,
		FullName: (ev.FirstName + " " + ev.LastName),
		Role:     ev.Role,
		BranchID: ev.BranchID,
	}
	if err := s.userRefRepo.Upsert(ctx, ref); err != nil {
		log.Printf("[events] upsert user_ref %d error: %v", ev.ID, err)
	}
}

// detachTutor — полная каскадная зачистка репетитора из Academic Service:
// отвязка от всех course_tutors/enrollments И физическое удаление всех его
// lessons (вместе с lesson_participants/attendance — каскадом по FK, см.
// LessonRepository.DeleteByTutor). Общая часть для двух разных сценариев
// (см. вызовы ниже): увольнение существующего репетитора и зачистка
// "унаследованных" назначений у только что созданного.
//
// Занятия удаляются, а не просто снимаются с расписания — по требованию:
// после увольнения преподаватель должен пропасть отовсюду, включая базу
// данных занятий, а не просто получить статус "уволен". История
// посещаемости/участников удалённых занятий при этом безвозвратно теряется —
// это осознанный компромисс, специфичный для увольнения (обычное удаление
// курса такой цепочки не запускает).
//
// Дополнительно: курсы, которые после отвязки остались вообще БЕЗ
// преподавателя, переводят свои active enrollments в paused (см.
// EnrollmentRepository.PauseOrphanedForCourses). Это закрывает баг, из-за
// которого следующий преподаватель, назначенный на такой курс, молча
// "наследовал" учеников уволенного — ListForTutor отдаёт tutor'у всех, кто
// записан на его курсы, не глядя на личный tutor_id (см. ADR в
// EnrollmentRepository.ListForTutor), а сами enrollments при увольнении не
// удаляются. Курсов с несколькими со-преподавателями это не касается: пока
// на курсе остаётся хоть один действующий tutor, его active enrollments не
// трогаем — это легитимный случай, а не "осиротевший" курс.
func (s *Subscriber) detachTutor(ctx context.Context, tutorID int64, reason string) {
	// Список курсов нужно снять ДО удаления из course_tutors — иначе после
	// RemoveTutorEverywhere узнать, какие курсы вообще вёл именно этот
	// tutor, будет уже не по чему.
	taughtCourseIDs, err := s.courseRepo.CoursesTaughtBy(ctx, tutorID)
	if err != nil {
		log.Printf("[events] %s: list taught courses for tutor %d error: %v", reason, tutorID, err)
	}

	if err := s.courseRepo.RemoveTutorEverywhere(ctx, tutorID); err != nil {
		log.Printf("[events] %s: detach tutor %d from courses error: %v", reason, tutorID, err)
	}
	if err := s.enrollRepo.UnassignTutorEverywhere(ctx, tutorID); err != nil {
		log.Printf("[events] %s: detach tutor %d from enrollments error: %v", reason, tutorID, err)
	}
	// Полное каскадное удаление: занятия репетитора физически удаляются из
	// БД (не просто снимаются с расписания), lesson_participants/attendance
	// уходят вместе с ними каскадом по FK (ON DELETE CASCADE, см.
	// 0001_init.up.sql) — см. LessonRepository.DeleteByTutor.
	if s.lessonRepo != nil {
		if n, err := s.lessonRepo.DeleteByTutor(ctx, tutorID); err != nil {
			log.Printf("[events] %s: delete lessons for tutor %d error: %v", reason, tutorID, err)
		} else if n > 0 {
			log.Printf("[events] %s: deleted %d lesson(s) for tutor %d", reason, n, tutorID)
		}
	}
	// Личные подгруппы тьютора (subgroups/subgroup_members) — отдельная от
	// course_tutors/enrollments сущность, поэтому чистится отдельным
	// вызовом. Без этого шага после увольнения и последующего
	// восстановления в штат за преподавателем по-прежнему "числились" бы
	// его старые ученики — см. SubgroupRepository.DeleteByTutor.
	if s.subgroupRepo != nil {
		if n, err := s.subgroupRepo.DeleteByTutor(ctx, tutorID); err != nil {
			log.Printf("[events] %s: delete subgroups for tutor %d error: %v", reason, tutorID, err)
		} else if n > 0 {
			log.Printf("[events] %s: deleted %d subgroup(s) for tutor %d", reason, n, tutorID)
		}
	}

	if len(taughtCourseIDs) == 0 {
		return
	}
	orphaned, err := s.courseRepo.CoursesWithNoTutors(ctx, taughtCourseIDs)
	if err != nil {
		log.Printf("[events] %s: find orphaned courses for tutor %d error: %v", reason, tutorID, err)
		return
	}
	if err := s.enrollRepo.PauseOrphanedForCourses(ctx, orphaned); err != nil {
		log.Printf("[events] %s: pause orphaned enrollments for tutor %d error: %v", reason, tutorID, err)
	}
}

// detachStudent — полная зачистка ученика из Academic Service после его
// физического удаления в User Service (см. user.deleted в
// user-service/internal/promotion — на данный момент единственный
// источник: ежегодное автоудаление выпускников 11 класса).
//
// В отличие от detachTutor, здесь никакие занятия НЕ удаляются целиком —
// на одном занятии могут присутствовать другие ученики (lessons это
// групповые события, см. lesson_participants), поэтому ученика убирают
// точечно из lesson_participants/attendance, а сами lessons остаются для
// остальных участников. Полностью удаляются только сущности, которые
// целиком принадлежат этому ученику: enrollments, homework, tests и его
// запись в user_refs.
func (s *Subscriber) detachStudent(ctx context.Context, studentID int64) {
	if n, err := s.enrollRepo.DeleteByStudent(ctx, studentID); err != nil {
		log.Printf("[events] student graduated: delete enrollments for student %d error: %v", studentID, err)
	} else if n > 0 {
		log.Printf("[events] student graduated: deleted %d enrollment(s) for student %d", n, studentID)
	}
	if s.lessonRepo != nil {
		if err := s.lessonRepo.RemoveStudentEverywhere(ctx, studentID); err != nil {
			log.Printf("[events] student graduated: remove student %d from lessons error: %v", studentID, err)
		}
	}
	if s.homeworkRepo != nil {
		if err := s.homeworkRepo.DeleteByStudent(ctx, studentID); err != nil {
			log.Printf("[events] student graduated: delete homework for student %d error: %v", studentID, err)
		}
	}
	if s.testRepo != nil {
		if err := s.testRepo.DeleteByStudent(ctx, studentID); err != nil {
			log.Printf("[events] student graduated: delete tests for student %d error: %v", studentID, err)
		}
	}
	if err := s.userRefRepo.Delete(ctx, studentID); err != nil {
		log.Printf("[events] student graduated: delete user_ref %d error: %v", studentID, err)
	}
}

// handleUserDeleted — реакция на физическое удаление пользователя в User
// Service. Единственная роль, для которой это сейчас вообще происходит —
// student (выпускник 11 класса), поэтому обработчик проверяет роль и не
// делает ничего для остальных (увольнение репетитора идёт отдельным путём
// через user.updated с is_active=false, см. handleUserUpdated — репетиторов
// физически не удаляют).
func (s *Subscriber) handleUserDeleted(ctx context.Context) nats.MsgHandler {
	return func(msg *nats.Msg) {
		var ev UserDeletedEvent
		if err := json.Unmarshal(msg.Data, &ev); err != nil {
			log.Printf("[events] user.deleted unmarshal error: %v", err)
			return
		}
		if ev.Role == models.RoleStudent {
			s.detachStudent(ctx, ev.ID)
		}
	}
}

// handleUserCreated — заводит user_ref и, для роли tutor, СРАЗУ подчищает
// любые уже существующие в этой БД course_tutors/enrollments.tutor_id на
// этот числовой id.
//
// Зачем: id пользователей — это SERIAL в БД User Service, а course_tutors/
// enrollments живут в отдельной БД Academic Service БЕЗ настоящего FK
// (см. 0001_init.up.sql). Если БД User Service когда-либо пересоздавалась
// "с нуля" (например, `docker compose down -v` только для одного сервиса,
// или повторный прогон seed_studyroom.py после ручной очистки только
// users-базы), нумерация id начинается заново — и новый пользователь может
// получить тот же числовой id, что раньше был у старого/тестового
// репетитора, чьи course_tutors/enrollments в Academic Service никуда не
// делись. В результате свежесозданный репетитор "по наследству" оказывается
// привязан к чужим ученикам, хотя в User Service это два разных аккаунта.
//
// У только что созданного пользователя не может быть ЛЕГИТИМНЫХ назначений
// (он появился секунду назад), поэтому чистка здесь безопасна в любом
// случае — если хвостов не было, обе операции просто ничего не удалят.
func (s *Subscriber) handleUserCreated(ctx context.Context) nats.MsgHandler {
	return func(msg *nats.Msg) {
		var ev UserEvent
		if err := json.Unmarshal(msg.Data, &ev); err != nil {
			log.Printf("[events] user.created unmarshal error: %v", err)
			return
		}
		s.upsertUserRef(ctx, ev)

		if ev.Role == models.RoleTutor {
			s.detachTutor(ctx, ev.ID, "cleanup stale assignments on user.created")
		}
	}
}

// handleUserUpdated — обновляет user_ref и, если User Service прислал
// увольнение репетитора (is_active=false), каскадно зачищает его из
// Academic Service: отвязывает от всех курсов/учеников (course_tutors,
// enrollments.tutor_id) и физически удаляет все его lessons — см.
// detachTutor. enrollments как записи о зачислении студентов при этом не
// удаляются (это данные студента, а не репетитора), только теряют
// закреплённого репетитора. Best-effort: ошибка логируется, подписчика не
// валит.
func (s *Subscriber) handleUserUpdated(ctx context.Context) nats.MsgHandler {
	return func(msg *nats.Msg) {
		var ev UserEvent
		if err := json.Unmarshal(msg.Data, &ev); err != nil {
			log.Printf("[events] user.updated unmarshal error: %v", err)
			return
		}
		s.upsertUserRef(ctx, ev)

		if ev.Role == models.RoleTutor && !ev.IsActive {
			s.detachTutor(ctx, ev.ID, "tutor fired")
		}
	}
}

// handleContractCreated — основной путь наполнения ENROLLMENTS (см.
// api-contracts.md, примечание к 2.4). Если Contracts Service ещё не
// задеплоен, subject просто пуст — обработчик молча ждёт первых сообщений.
func (s *Subscriber) handleContractCreated(ctx context.Context) nats.MsgHandler {
	return func(msg *nats.Msg) {
		var ev ContractCreatedEvent
		if err := json.Unmarshal(msg.Data, &ev); err != nil {
			log.Printf("[events] contract.created unmarshal error: %v", err)
			return
		}
		if ev.StudentID == 0 || ev.CourseID == 0 {
			log.Printf("[events] contract.created: missing student_id/course_id, skip (contract_id=%d)", ev.ContractID)
			return
		}
		if _, err := s.enrollRepo.CreateFromContract(ctx, ev.StudentID, ev.CourseID, ev.TutorID, ev.StartDate, ev.EndDate); err != nil {
			log.Printf("[events] create enrollment from contract %d error: %v", ev.ContractID, err)
		}
	}
}

func (s *Subscriber) handleContractExpired(ctx context.Context) nats.MsgHandler {
	return func(msg *nats.Msg) {
		var ev ContractLifecycleEvent
		if err := json.Unmarshal(msg.Data, &ev); err != nil {
			log.Printf("[events] contract.expired unmarshal error: %v", err)
			return
		}
		if ev.StudentID == 0 || ev.CourseID == 0 {
			return
		}
		endDate, err := time.Parse("2006-01-02", ev.EndDate)
		if err != nil {
			log.Printf("[events] contract %d expired: invalid end_date %q: %v", ev.ContractID, ev.EndDate, err)
			return
		}
		if _, err := s.lessonRepo.CancelForStudentAndCourseAfterDate(ctx, ev.StudentID, ev.CourseID, endDate); err != nil {
			log.Printf("[events] contract %d expired: cancel post-expiry lessons error: %v", ev.ContractID, err)
		}
		if n, err := s.enrollRepo.CompleteExpiredForCourse(ctx, ev.StudentID, ev.CourseID); err != nil {
			log.Printf("[events] contract %d expired: complete enrollment error: %v", ev.ContractID, err)
		} else if n > 0 {
			log.Printf("[events] contract %d expired: completed enrollment for student %d/course %d", ev.ContractID, ev.StudentID, ev.CourseID)
		}
	}
}

func (s *Subscriber) handleContractActivated(ctx context.Context) nats.MsgHandler {
	return func(msg *nats.Msg) {
		var ev ContractLifecycleEvent
		if err := json.Unmarshal(msg.Data, &ev); err != nil {
			log.Printf("[events] contract.activated unmarshal error: %v", err)
			return
		}
		if ev.StudentID == 0 || ev.CourseID == 0 {
			return
		}
		if n, err := s.enrollRepo.ActivateForCourse(ctx, ev.StudentID, ev.CourseID, &ev.StartDate, &ev.EndDate); err != nil {
			log.Printf("[events] contract %d activated: activate enrollment error: %v", ev.ContractID, err)
		} else if n == 0 {
			log.Printf("[events] contract %d activated: no enrollment to reactivate for student %d/course %d", ev.ContractID, ev.StudentID, ev.CourseID)
		}
	}
}

func (s *Subscriber) handleContractUpdated(ctx context.Context) nats.MsgHandler {
	return func(msg *nats.Msg) {
		var ev ContractLifecycleEvent
		if err := json.Unmarshal(msg.Data, &ev); err != nil {
			log.Printf("[events] contract.updated unmarshal error: %v", err)
			return
		}
		if ev.StudentID == 0 || ev.CourseID == 0 {
			return
		}
		if _, err := s.enrollRepo.UpdateDatesForCourse(ctx, ev.StudentID, ev.CourseID, &ev.StartDate, &ev.EndDate); err != nil {
			log.Printf("[events] contract %d updated: update enrollment dates error: %v", ev.ContractID, err)
		}
	}
}

// handleContractTerminated — реакция на расторжение договора (см.
// contracts-service/internal/handlers/contract_handler.go, UpdateStatus).
// По требованию: расторжение договора ученика отменяет ВСЕ его занятия по
// этому курсу вместе с самой активной записью (enrollment) на курс.
//
// Порядок важен: сначала отменяем занятия (LessonRepository.
// CancelForStudentAndCourse — только ещё не проведённые, см. её комментарий),
// ПОТОМ переводим enrollment в status='terminated'. Если бы enrollment
// терминировался первым, а отмена занятий упала бы с ошибкой, ученик
// остался бы с расторгнутым договором, но всё ещё активными занятиями в
// расписании — заметно более странная незавершённость, чем наоборот (лишние
// отменённые занятия при технически ещё не расторгнутом enrollment почти
// незаметны и безвредны). Обе операции best-effort и независимы друг от
// друга — ошибка одной не блокирует другую, только логируется.
func (s *Subscriber) handleContractTerminated(ctx context.Context) nats.MsgHandler {
	return func(msg *nats.Msg) {
		var ev ContractTerminatedEvent
		if err := json.Unmarshal(msg.Data, &ev); err != nil {
			log.Printf("[events] contract.terminated unmarshal error: %v", err)
			return
		}
		if ev.StudentID == 0 || ev.CourseID == 0 {
			log.Printf("[events] contract.terminated: missing student_id/course_id, skip (contract_id=%d)", ev.ContractID)
			return
		}

		if s.lessonRepo != nil {
			if n, err := s.lessonRepo.CancelForStudentAndCourse(ctx, ev.StudentID, ev.CourseID); err != nil {
				log.Printf("[events] contract %d terminated: cancel lessons for student %d/course %d error: %v",
					ev.ContractID, ev.StudentID, ev.CourseID, err)
			} else if n > 0 {
				log.Printf("[events] contract %d terminated: cancelled %d lesson(s) for student %d/course %d",
					ev.ContractID, n, ev.StudentID, ev.CourseID)
			}
		}

		if n, err := s.enrollRepo.TerminateForCourse(ctx, ev.StudentID, ev.CourseID); err != nil {
			log.Printf("[events] contract %d terminated: update enrollment for student %d/course %d error: %v",
				ev.ContractID, ev.StudentID, ev.CourseID, err)
		} else if n == 0 {
			log.Printf("[events] contract %d terminated: no active/paused enrollment found for student %d/course %d",
				ev.ContractID, ev.StudentID, ev.CourseID)
		}
	}
}
