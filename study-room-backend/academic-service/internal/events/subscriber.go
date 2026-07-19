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
	return nats.Connect(url, nats.MaxReconnects(-1), nats.Name("academic-service"))
}

type Subscriber struct {
	nc          *nats.Conn
	userRefRepo *repository.UserRefRepository
	enrollRepo  *repository.EnrollmentRepository
}

func NewSubscriber(nc *nats.Conn, userRefRepo *repository.UserRefRepository, enrollRepo *repository.EnrollmentRepository) *Subscriber {
	return &Subscriber{nc: nc, userRefRepo: userRefRepo, enrollRepo: enrollRepo}
}

// Start подписывается на нужные субъекты. Подписки живут вместе с процессом
// (соединение с NATS закрывается в main.go при shutdown, что автоматически
// останавливает и подписчиков) — тот же паттерн, что в notification-service.
func (s *Subscriber) Start(ctx context.Context) error {
	if _, err := s.nc.QueueSubscribe("user.created", "academic-service", s.handleUserEvent(ctx)); err != nil {
		return err
	}
	if _, err := s.nc.QueueSubscribe("user.updated", "academic-service", s.handleUserEvent(ctx)); err != nil {
		return err
	}
	if _, err := s.nc.QueueSubscribe("contract.created", "academic-service", s.handleContractCreated(ctx)); err != nil {
		return err
	}
	return nil
}

func (s *Subscriber) handleUserEvent(ctx context.Context) nats.MsgHandler {
	return func(msg *nats.Msg) {
		var ev UserEvent
		if err := json.Unmarshal(msg.Data, &ev); err != nil {
			log.Printf("[events] user.* unmarshal error: %v", err)
			return
		}
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
