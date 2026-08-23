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
	nc          *nats.Conn
	userRefRepo *repository.UserRefRepository
}

func NewSubscriber(nc *nats.Conn, userRefRepo *repository.UserRefRepository) *Subscriber {
	return &Subscriber{nc: nc, userRefRepo: userRefRepo}
}

func (s *Subscriber) Start(ctx context.Context) error {
	if _, err := s.nc.QueueSubscribe("user.created", "contracts-service", s.handleUserEvent(ctx)); err != nil {
		return err
	}
	if _, err := s.nc.QueueSubscribe("user.updated", "contracts-service", s.handleUserEvent(ctx)); err != nil {
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
