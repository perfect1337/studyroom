package events

import (
	"context"
	"encoding/json"
	"log"

	"github.com/nats-io/nats.go"
	"studyroom/user-service/internal/repository"
)

type ContractBranchEvent struct {
	ID        int64 `json:"id"`
	StudentID int64 `json:"student_id"`
	BranchID  int64 `json:"branch_id"`
}

type ContractLifecycleEvent struct {
	ID        int64 `json:"id"`
	StudentID int64 `json:"student_id"`
}

type Subscriber struct {
	nc    *nats.Conn
	users *repository.UserRepository
}

func NewSubscriber(nc *nats.Conn, users *repository.UserRepository) *Subscriber {
	return &Subscriber{nc: nc, users: users}
}

func (s *Subscriber) Start(ctx context.Context) error {
	if s == nil || s.nc == nil || s.users == nil {
		return nil
	}
	for _, subject := range []string{"contract.created", "contract.activated", "contract.terminated", "contract.expired", "contract.completed", "contract.deleted"} {
		var handler nats.MsgHandler
		switch subject {
		case "contract.created":
			handler = s.handleCreated
		case "contract.activated":
			handler = s.handleActivated
		case "contract.terminated", "contract.expired", "contract.completed", "contract.deleted":
			handler = s.handleRemoved
		}
		if _, err := s.nc.QueueSubscribe(subject, "user-service", handler); err != nil {
			return err
		}
	}
	return nil
}

func (s *Subscriber) handleCreated(msg *nats.Msg) {
	var ev ContractBranchEvent
	if err := json.Unmarshal(msg.Data, &ev); err != nil {
		log.Printf("[events] contract.created decode error: %v", err)
		return
	}
	if ev.ID == 0 || ev.StudentID == 0 || ev.BranchID == 0 {
		return
	}
	if err := s.users.AddStudentContractBranch(context.Background(), ev.ID, ev.StudentID, ev.BranchID); err != nil {
		log.Printf("[events] add student %d to branch %d from contract %d: %v", ev.StudentID, ev.BranchID, ev.ID, err)
	}
}

func (s *Subscriber) handleActivated(msg *nats.Msg) {
	// contract.activated historically has no branch_id. The source row created
	// by contract.created already supplies the branch membership.
}

func (s *Subscriber) handleRemoved(msg *nats.Msg) {
	var ev ContractLifecycleEvent
	if err := json.Unmarshal(msg.Data, &ev); err != nil {
		log.Printf("[events] contract lifecycle decode error: %v", err)
		return
	}
	if ev.ID == 0 || ev.StudentID == 0 {
		return
	}
	if err := s.users.RemoveStudentContractBranch(context.Background(), ev.ID, ev.StudentID); err != nil {
		log.Printf("[events] remove student %d contract %d branch: %v", ev.StudentID, ev.ID, err)
	}
}
