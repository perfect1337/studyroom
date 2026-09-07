// Package events — публикация contract.created и contract.expiring_soon
// (см. event-schema.md — это источник истины по форме payload, сверено
// перед реализацией, а не реконструировано заново из REST-тела).
package events

import (
	"encoding/json"
	"log"

	"github.com/nats-io/nats.go"
)

const (
	SubjectContractCreated      = "contract.created"
	SubjectContractExpiringSoon = "contract.expiring_soon"
	SubjectContractTerminated   = "contract.terminated"
	SubjectContractExpired      = "contract.expired"
	SubjectContractActivated    = "contract.activated"
	SubjectContractUpdated      = "contract.updated"
)

type Publisher interface {
	ContractCreated(id, studentID, courseID int64, tutorID *int64, startDate, endDate *string)
	ContractExpiringSoon(userID int64, studentId int64, contractNumber, endDate string)
	ContractTerminated(id, studentID, courseID int64)
	ContractExpired(id, studentID, courseID int64, endDate string)
	ContractActivated(id, studentID, courseID int64, startDate, endDate string)
	ContractUpdated(id, studentID, courseID int64, startDate, endDate string)
}

type NoopPublisher struct{}

func (NoopPublisher) ContractCreated(int64, int64, int64, *int64, *string, *string) {}
func (NoopPublisher) ContractExpiringSoon(int64, int64, string, string)             {}
func (NoopPublisher) ContractTerminated(int64, int64, int64)                        {}
func (NoopPublisher) ContractExpired(int64, int64, int64, string)                   {}
func (NoopPublisher) ContractActivated(int64, int64, int64, string, string)         {}
func (NoopPublisher) ContractUpdated(int64, int64, int64, string, string)           {}

type contractCreatedPayload struct {
	ID        int64   `json:"id"`
	StudentID int64   `json:"student_id"`
	CourseID  int64   `json:"course_id"`
	TutorID   *int64  `json:"tutor_id"`
	StartDate *string `json:"start_date"`
	EndDate   *string `json:"end_date"`
}

type contractExpiringSoonPayload struct {
	UserID         int64  `json:"user_id"`
	StudentID      int64  `json:"student_id"`
	ContractNumber string `json:"contract_number"`
	EndDate        string `json:"end_date"`
}

// contractTerminatedPayload — расторжение договора (PATCH /contracts/{id}/status
// с status="terminated", api-contracts.md 3.5). Подписан Academic Service
// (см. academic-service/internal/events/subscriber.go, handleContractTerminated):
// отменяет все ещё не проведённые (status='scheduled') занятия ученика по
// этому курсу и переводит саму запись enrollments в status='terminated' —
// см. комментарий там же для полной картины и обоснования.
type contractTerminatedPayload struct {
	ID        int64 `json:"id"`
	StudentID int64 `json:"student_id"`
	CourseID  int64 `json:"course_id"`
}

type contractLifecyclePayload struct {
	ID        int64  `json:"id"`
	StudentID int64  `json:"student_id"`
	CourseID  int64  `json:"course_id"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
}

type NATSPublisher struct {
	nc *nats.Conn
}

func NewNATSPublisher(nc *nats.Conn) *NATSPublisher {
	return &NATSPublisher{nc: nc}
}

// ContractCreated — основной путь наполнения enrollments в Academic
// Service (см. academic-service/internal/events/subscriber.go,
// handleContractCreated). tutor_id всегда nil — POST /contracts не
// принимает tutor_id (см. api-contracts.md 3.1), назначение репетитора на
// enrollment — отдельное действие уже на стороне Academic Service.
func (p *NATSPublisher) ContractCreated(id, studentID, courseID int64, tutorID *int64, startDate, endDate *string) {
	data, err := json.Marshal(contractCreatedPayload{
		ID: id, StudentID: studentID, CourseID: courseID,
		TutorID: tutorID, StartDate: startDate, EndDate: endDate,
	})
	if err != nil {
		log.Printf("[events] marshal contract.created error: %v", err)
		return
	}
	if err := p.nc.Publish(SubjectContractCreated, data); err != nil {
		log.Printf("[events] publish contract.created error: %v", err)
	}
}

func (p *NATSPublisher) ContractExpiringSoon(userID int64, studentID int64, contractNumber, endDate string) {
	if userID == 0 {
		log.Printf("[events] contract.expiring_soon: empty user_id, skip publish (contract=%s)", contractNumber)
		return
	}
	data, err := json.Marshal(contractExpiringSoonPayload{
		UserID: userID, StudentID: studentID, ContractNumber: contractNumber, EndDate: endDate,
	})
	if err != nil {
		log.Printf("[events] marshal contract.expiring_soon error: %v", err)
		return
	}
	if err := p.nc.Publish(SubjectContractExpiringSoon, data); err != nil {
		log.Printf("[events] publish contract.expiring_soon error: %v", err)
	}
}

// ContractTerminated — публикуется из ContractHandler.UpdateStatus, когда
// новый статус договора — "terminated" (см. api-contracts.md 3.5).
func (p *NATSPublisher) ContractTerminated(id, studentID, courseID int64) {
	data, err := json.Marshal(contractTerminatedPayload{ID: id, StudentID: studentID, CourseID: courseID})
	if err != nil {
		log.Printf("[events] marshal contract.terminated error: %v", err)
		return
	}
	if err := p.nc.Publish(SubjectContractTerminated, data); err != nil {
		log.Printf("[events] publish contract.terminated error: %v", err)
	}
}

func (p *NATSPublisher) ContractExpired(id, studentID, courseID int64, endDate string) {
	p.publishLifecycle(SubjectContractExpired, contractLifecyclePayload{ID: id, StudentID: studentID, CourseID: courseID, EndDate: endDate})
}

func (p *NATSPublisher) ContractActivated(id, studentID, courseID int64, startDate, endDate string) {
	p.publishLifecycle(SubjectContractActivated, contractLifecyclePayload{ID: id, StudentID: studentID, CourseID: courseID, StartDate: startDate, EndDate: endDate})
}

func (p *NATSPublisher) ContractUpdated(id, studentID, courseID int64, startDate, endDate string) {
	p.publishLifecycle(SubjectContractUpdated, contractLifecyclePayload{ID: id, StudentID: studentID, CourseID: courseID, StartDate: startDate, EndDate: endDate})
}

func (p *NATSPublisher) publishLifecycle(subject string, payload contractLifecyclePayload) {
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[events] marshal %s error: %v", subject, err)
		return
	}
	if err := p.nc.Publish(subject, data); err != nil {
		log.Printf("[events] publish %s error: %v", subject, err)
	}
}
