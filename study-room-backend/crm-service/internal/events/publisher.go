// Package events — публикация application.received (см. event-schema.md,
// "v1.application.received"): payload минимальный — owner_user_id, source,
// name. CRM Service не знает формат уведомления, это ответственность
// Notification Service (тот же принцип, что "вариант А" для lesson.created/
// attendance.marked_absent в notification-service).
package events

import (
	"encoding/json"
	"log"

	"github.com/nats-io/nats.go"
)

const SubjectApplicationReceived = "application.received"

type Publisher interface {
	ApplicationReceived(ownerUserID int64, source, name string)
}

type NoopPublisher struct{}

func (NoopPublisher) ApplicationReceived(int64, string, string) {}

type applicationReceivedPayload struct {
	OwnerUserID int64  `json:"owner_user_id"`
	Source      string `json:"source"`
	Name        string `json:"name"`
}

type NATSPublisher struct {
	nc *nats.Conn
}

func NewNATSPublisher(nc *nats.Conn) *NATSPublisher {
	return &NATSPublisher{nc: nc}
}

func (p *NATSPublisher) ApplicationReceived(ownerUserID int64, source, name string) {
	if ownerUserID == 0 {
		// Нет кому уведомлять (user_refs ещё не наполнен owner/branch_owner) —
		// не публикуем событие с пустым получателем, лучше тихо пропустить,
		// чем заставить Notification Service обрабатывать заведомо мусорный payload.
		log.Printf("[events] application.received: no owner_user_id resolved, skip publish (source=%s)", source)
		return
	}
	data, err := json.Marshal(applicationReceivedPayload{
		OwnerUserID: ownerUserID, Source: source, Name: name,
	})
	if err != nil {
		log.Printf("[events] marshal application.received error: %v", err)
		return
	}
	if err := p.nc.Publish(SubjectApplicationReceived, data); err != nil {
		log.Printf("[events] publish application.received error: %v", err)
	}
}
