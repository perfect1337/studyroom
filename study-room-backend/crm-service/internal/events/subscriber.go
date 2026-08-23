// Package events — подписка на события из брокера (NATS). Паттерн идентичен
// academic-service/internal/events/subscriber.go: очередь с queue group
// "crm-service" (несколько реплик поделят сообщения, а не продублируют
// обработку), best-effort — ошибка обработки одного сообщения логируется и
// не валит подписчика.
package events

import (
	"context"
	"encoding/json"
	"log"

	"github.com/nats-io/nats.go"
	"studyroom/crm-service/internal/models"
	"studyroom/crm-service/internal/repository"
)

// UserEvent — соответствует user.created/user.updated (см. event-schema.md).
// CRM Service читает только своё подмножество (id/имя/роль/branch_id) —
// лишние поля (email, temp_password и т.п.) просто игнорируются encoding/json.
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
		nats.Name("crm-service"),
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
	if _, err := s.nc.QueueSubscribe("user.created", "crm-service", s.handleUserEvent(ctx)); err != nil {
		return err
	}
	if _, err := s.nc.QueueSubscribe("user.updated", "crm-service", s.handleUserEvent(ctx)); err != nil {
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
