// Package events — публикация доменных событий User Service в NATS.
// Notification Service (и позже Academic/Contracts/CRM) подписаны на эти subject'ы.
package events

import (
	"encoding/json"
	"log"
	"time"

	"github.com/nats-io/nats.go"
	"studyroom/user-service/internal/models"
)

const (
	SubjectUserCreated            = "user.created"
	SubjectUserUpdated            = "user.updated"
	SubjectPasswordResetRequested = "password_reset_requested"
)

// Publisher — best-effort: ошибка публикации логируется, HTTP-запрос не валится.
type Publisher interface {
	UserCreated(u *models.User, tempPassword, notifyEmail string, parentID *int64)
	UserUpdated(u *models.User)
	PasswordResetRequested(userID int64, email, resetToken, resetURL string, expiresAt time.Time)
	Close()
}

type UserEvent struct {
	ID           int64   `json:"id"`
	Email        string  `json:"email"`
	FirstName    string  `json:"first_name"`
	LastName     string  `json:"last_name"`
	Role         string  `json:"role"`
	BranchID     *int64  `json:"branch_id,omitempty"`
	TempPassword string  `json:"temp_password,omitempty"`
	NotifyEmail  string  `json:"notify_email,omitempty"` // куда слать credentials (родитель ученика)
	// ParentID — только для role=student, id родителя (parent_student.parent_id).
	// Добавлено, чтобы Notification Service мог резолвить
	// student_id → parent_id локально при attendance.marked_absent,
	// не дёргая User Service синхронно (см. event-schema.md, п. attendance.marked_absent).
	ParentID *int64 `json:"parent_id,omitempty"`
}

type PasswordResetEvent struct {
	UserID     int64  `json:"user_id"`
	Email      string `json:"email"`
	ResetToken string `json:"reset_token"`
	ResetURL   string `json:"reset_url"`
	ExpiresAt  string `json:"expires_at"`
}

type NATSPublisher struct {
	nc *nats.Conn
}

func Connect(url string) (*nats.Conn, error) {
	return nats.Connect(url, nats.MaxReconnects(-1), nats.Name("user-service"))
}

func NewNATSPublisher(nc *nats.Conn) *NATSPublisher {
	return &NATSPublisher{nc: nc}
}

func (p *NATSPublisher) publish(subject string, v any) {
	if p == nil || p.nc == nil {
		return
	}
	data, err := json.Marshal(v)
	if err != nil {
		log.Printf("events: marshal %s: %v", subject, err)
		return
	}
	if err := p.nc.Publish(subject, data); err != nil {
		log.Printf("events: publish %s: %v", subject, err)
		return
	}
}

func (p *NATSPublisher) UserCreated(u *models.User, tempPassword, notifyEmail string, parentID *int64) {
	if u == nil {
		return
	}
	p.publish(SubjectUserCreated, UserEvent{
		ID: u.ID, Email: u.Email, FirstName: u.FirstName, LastName: u.LastName,
		Role: string(u.Role), BranchID: u.BranchID,
		TempPassword: tempPassword, NotifyEmail: notifyEmail,
		ParentID: parentID,
	})
}

func (p *NATSPublisher) UserUpdated(u *models.User) {
	if u == nil {
		return
	}
	p.publish(SubjectUserUpdated, UserEvent{
		ID: u.ID, Email: u.Email, FirstName: u.FirstName, LastName: u.LastName,
		Role: string(u.Role), BranchID: u.BranchID,
	})
}

func (p *NATSPublisher) PasswordResetRequested(userID int64, email, resetToken, resetURL string, expiresAt time.Time) {
	p.publish(SubjectPasswordResetRequested, PasswordResetEvent{
		UserID: userID, Email: email, ResetToken: resetToken,
		ResetURL: resetURL, ExpiresAt: expiresAt.UTC().Format(time.RFC3339),
	})
}

func (p *NATSPublisher) Close() {
	if p != nil && p.nc != nil {
		_ = p.nc.Drain()
		p.nc.Close()
	}
}

// NoopPublisher — для тестов и локального запуска без NATS.
type NoopPublisher struct{}

func (NoopPublisher) UserCreated(*models.User, string, string, *int64)                  {}
func (NoopPublisher) UserUpdated(*models.User)                                          {}
func (NoopPublisher) PasswordResetRequested(int64, string, string, string, time.Time) {}
func (NoopPublisher) Close()                                                            {}
