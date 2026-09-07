package events

import (
	"context"
	"encoding/json"
	"log"

	"github.com/nats-io/nats.go"
	"studyroom/contracts-service/internal/models"
	"studyroom/contracts-service/internal/repository"
)

type UserEvent struct {
	ID        int64       `json:"id"`
	FirstName string      `json:"first_name"`
	LastName  string      `json:"last_name"`
	Role      models.Role `json:"role"`
	BranchID  *int64      `json:"branch_id"`
}

type UserDeletedEvent struct {
	ID   int64       `json:"id"`
	Role models.Role `json:"role"`
}

func Connect(url string) (*nats.Conn, error) {
	return nats.Connect(
		url,
		nats.MaxReconnects(-1),
		nats.Name("contracts-service"),
		nats.DisconnectErrHandler(func(nc *nats.Conn, err error) {
			log.Printf("[events] disconnected from NATS: %v", err)
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			log.Printf("[events] reconnected to NATS: %s", nc.ConnectedUrl())
		}),
		nats.ClosedHandler(func(nc *nats.Conn) {
			log.Printf("[events] NATS connection closed: %v", nc.LastError())
		}),
	)
}

type Subscriber struct {
	nc           *nats.Conn
	userRefRepo  *repository.UserRefRepository
	contractRepo *repository.ContractRepository
}

func NewSubscriber(nc *nats.Conn, userRefRepo *repository.UserRefRepository, contractRepo *repository.ContractRepository) *Subscriber {
	return &Subscriber{nc: nc, userRefRepo: userRefRepo, contractRepo: contractRepo}
}

func (s *Subscriber) Start(ctx context.Context) error {
	if _, err := s.nc.QueueSubscribe("user.created", "contracts-service", s.handleUserEvent(ctx)); err != nil {
		return err
	}
	if _, err := s.nc.QueueSubscribe("user.updated", "contracts-service", s.handleUserEvent(ctx)); err != nil {
		return err
	}
	if _, err := s.nc.QueueSubscribe("user.deleted", "contracts-service", s.handleUserDeleted(ctx)); err != nil {
		return err
	}
	return nil
}

// handleUserDeleted — ученик выпустился/удалён в User Service (см.
// user-service/internal/promotion). Договор НЕ удаляется (финансовые
// данные — сумма, статус оплаты — должны сохраниться для бухгалтерии),
// вместо этого все его АКТИВНЫЕ договоры переводятся в 'completed' —
// см. ContractRepository.CompleteActiveByStudent.
func (s *Subscriber) handleUserDeleted(ctx context.Context) nats.MsgHandler {
	return func(msg *nats.Msg) {
		var ev UserDeletedEvent
		if err := json.Unmarshal(msg.Data, &ev); err != nil {
			log.Printf("[events] user.deleted unmarshal error: %v", err)
			return
		}
		if ev.Role != models.RoleStudent || ev.ID == 0 {
			return
		}
		n, err := s.contractRepo.CompleteActiveByStudent(ctx, ev.ID)
		if err != nil {
			log.Printf("[events] student graduated: complete contracts for student %d error: %v", ev.ID, err)
			return
		}
		if n > 0 {
			log.Printf("[events] student graduated: completed %d contract(s) for student %d", n, ev.ID)
		}
	}
}

func (s *Subscriber) handleUserEvent(ctx context.Context) nats.MsgHandler {
	return func(msg *nats.Msg) {
		var ev UserEvent
		if err := json.Unmarshal(msg.Data, &ev); err != nil {
			log.Printf("[events] user.* unmarshal error: %v", err)
			return
		}
		if ev.ID == 0 {
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
