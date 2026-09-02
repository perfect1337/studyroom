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
	SubjectUserDeleted            = "user.deleted"
	SubjectPasswordResetRequested = "password_reset_requested"
	SubjectUserCredentialsReset   = "user.credentials_reset"
)

// Publisher — best-effort: ошибка публикации логируется, HTTP-запрос не валится.
type Publisher interface {
	UserCreated(u *models.User, tempPassword, notifyEmail string, parentID *int64)
	UserUpdated(u *models.User)
	// UserDeleted — пользователь физически удалён из БД User Service (пока
	// единственный источник — ежегодное автоудаление выпускников 11 класса,
	// см. internal/promotion). Другие сервисы (Academic/Contracts/CRM)
	// хранят student_id БЕЗ настоящего FK на User Service (разные БД, см.
	// комментарий в crm-service/.../0001_init.up.sql), поэтому сами не
	// узнают об удалении без этого события — они могут подписаться на
	// user.deleted, чтобы почистить/заморозить свои записи по этому id.
	// На момент написания ни один из них ещё не подписан — это отдельная
	// доработка вне рамок текущей задачи (см. итоговое сообщение).
	UserDeleted(u DeletedUserInfo)
	PasswordResetRequested(userID int64, email, resetToken, resetURL string, expiresAt time.Time)
	// CredentialsReset — логин/пароль пользователя принудительно сброшены
	// (например, родитель или owner сбросил доступ ребёнку — см. ResetStudentCredentials).
	// В отличие от UserCreated, письмо должно говорить "обновлены", а не "созданы".
	CredentialsReset(u *models.User, tempPassword, notifyEmail string, parentID *int64)
	Close()
}

// DeletedUserInfo — снимок данных удаляемого пользователя, который нужно
// собрать ДО DELETE (после удаления строки в БД уже не будет). Отдельный
// тип, а не *models.User, потому что промоушен-джобу не нужен весь профиль —
// только то, что реально уходит в событие.
type DeletedUserInfo struct {
	ID        int64
	Email     string
	FirstName string
	LastName  string
	Role      models.Role
	BranchID  *int64
	// ParentIDs — id всех родителей удаляемого ученика (parent_student),
	// чтобы Notification Service мог, если понадобится, разослать им
	// уведомление о выпуске — см. UserDeletedEvent.
	ParentIDs []int64
}

type UserEvent struct {
	ID           int64  `json:"id"`
	Email        string `json:"email"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
	Role         string `json:"role"`
	BranchID     *int64 `json:"branch_id,omitempty"`
	TempPassword string `json:"temp_password,omitempty"`
	NotifyEmail  string `json:"notify_email,omitempty"` // куда слать credentials (родитель ученика)
	// ParentID — только для role=student, id родителя (parent_student.parent_id).
	// Добавлено, чтобы Notification Service мог резолвить
	// student_id → parent_id локально при attendance.marked_absent,
	// не дёргая User Service синхронно (см. event-schema.md, п. attendance.marked_absent).
	ParentID *int64 `json:"parent_id,omitempty"`
	// IsActive — текущее значение users.is_active. Добавлено, чтобы подписчики
	// (Academic Service) могли реагировать на увольнение репетитора
	// (is_active=false) и отвязывать его от курсов/учеников локально, не
	// дёргая User Service синхронно — см. academic-service/internal/events/subscriber.go.
	IsActive bool `json:"is_active"`
	// ClassInfo — класс ученика (только для role=student), из
	// student_profiles.class_info. Добавлено, чтобы CRM Service мог
	// показывать класс прямо в заявке на запись на курс, резолвя его
	// локально из user_refs, не дёргая User Service синхронно на каждую
	// заявку — см. crm-service/internal/events/subscriber.go и
	// application_handler.go CreateInternal.
	ClassInfo *string `json:"class_info,omitempty"`
}

type PasswordResetEvent struct {
	UserID     int64  `json:"user_id"`
	Email      string `json:"email"`
	ResetToken string `json:"reset_token"`
	ResetURL   string `json:"reset_url"`
	ExpiresAt  string `json:"expires_at"`
}

type UserDeletedEvent struct {
	ID        int64   `json:"id"`
	Email     string  `json:"email"`
	FirstName string  `json:"first_name"`
	LastName  string  `json:"last_name"`
	Role      string  `json:"role"`
	BranchID  *int64  `json:"branch_id,omitempty"`
	ParentIDs []int64 `json:"parent_ids,omitempty"`
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
		ParentID: parentID, IsActive: u.IsActive, ClassInfo: u.ClassInfo,
	})
}

func (p *NATSPublisher) CredentialsReset(u *models.User, tempPassword, notifyEmail string, parentID *int64) {
	if u == nil {
		return
	}
	p.publish(SubjectUserCredentialsReset, UserEvent{
		ID: u.ID, Email: u.Email, FirstName: u.FirstName, LastName: u.LastName,
		Role: string(u.Role), BranchID: u.BranchID,
		TempPassword: tempPassword, NotifyEmail: notifyEmail,
		ParentID: parentID, IsActive: u.IsActive, ClassInfo: u.ClassInfo,
	})
}

func (p *NATSPublisher) UserUpdated(u *models.User) {
	if u == nil {
		return
	}
	p.publish(SubjectUserUpdated, UserEvent{
		ID: u.ID, Email: u.Email, FirstName: u.FirstName, LastName: u.LastName,
		Role: string(u.Role), BranchID: u.BranchID, IsActive: u.IsActive, ClassInfo: u.ClassInfo,
	})
}

func (p *NATSPublisher) UserDeleted(u DeletedUserInfo) {
	p.publish(SubjectUserDeleted, UserDeletedEvent{
		ID: u.ID, Email: u.Email, FirstName: u.FirstName, LastName: u.LastName,
		Role: string(u.Role), BranchID: u.BranchID, ParentIDs: u.ParentIDs,
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

func (NoopPublisher) UserCreated(*models.User, string, string, *int64)                {}
func (NoopPublisher) UserUpdated(*models.User)                                        {}
func (NoopPublisher) UserDeleted(DeletedUserInfo)                                     {}
func (NoopPublisher) PasswordResetRequested(int64, string, string, string, time.Time) {}
func (NoopPublisher) CredentialsReset(*models.User, string, string, *int64)           {}
func (NoopPublisher) Close()                                                          {}
