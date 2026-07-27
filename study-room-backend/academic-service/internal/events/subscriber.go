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
	nc          *nats.Conn
	userRefRepo *repository.UserRefRepository
	enrollRepo  *repository.EnrollmentRepository
	courseRepo  *repository.CourseRepository
}

func NewSubscriber(nc *nats.Conn, userRefRepo *repository.UserRefRepository, enrollRepo *repository.EnrollmentRepository, courseRepo *repository.CourseRepository) *Subscriber {
	return &Subscriber{nc: nc, userRefRepo: userRefRepo, enrollRepo: enrollRepo, courseRepo: courseRepo}
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

// detachTutor — отвязывает репетитора от всех course_tutors/enrollments в
// этой БД. Общая часть для двух разных сценариев (см. вызовы ниже):
// увольнение существующего репетитора и зачистка "унаследованных"
// назначений у только что созданного.
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
// увольнение репетитора (is_active=false), отвязывает его от всех курсов и
// учеников. Сами enrollments/lessons/homework не удаляются — это
// исторические записи, они остаются, просто теряют закреплённого
// репетитора. Best-effort: ошибка логируется, подписчика не валит.
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
