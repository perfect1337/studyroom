package events

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/nats-io/nats.go"
	"studyroom/notification-service/internal/models"
	"studyroom/notification-service/internal/notifier"
	"studyroom/notification-service/internal/repository"
)

type Subscriber struct {
	nc       *nats.Conn
	notifier *notifier.Notifier
	usersRef *repository.UserRefRepository
}

func Connect(url string) (*nats.Conn, error) {
	return nats.Connect(url, nats.MaxReconnects(-1), nats.Name("notification-service"))
}

func NewSubscriber(nc *nats.Conn, n *notifier.Notifier, usersRef *repository.UserRefRepository) *Subscriber {
	return &Subscriber{nc: nc, notifier: n, usersRef: usersRef}
}

type userEvent struct {
	ID           int64  `json:"id"`
	Email        string `json:"email"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
	Role         string `json:"role"`
	TempPassword string `json:"temp_password"`
	NotifyEmail  string `json:"notify_email"`
}

type passwordResetEvent struct {
	UserID     int64  `json:"user_id"`
	Email      string `json:"email"`
	ResetToken string `json:"reset_token"`
	ResetURL   string `json:"reset_url"`
	ExpiresAt  string `json:"expires_at"`
}

type contractExpiringEvent struct {
	UserID   int64  `json:"user_id"`
	Contract string `json:"contract_number"`
	EndDate  string `json:"end_date"`
}

type lessonReminderEvent struct {
	UserID int64  `json:"user_id"`
	Text   string `json:"message"`
}

type attendanceAbsentEvent struct {
	ParentUserID int64  `json:"parent_user_id"`
	StudentName  string `json:"student_name"`
	LessonDate   string `json:"lesson_date"`
}

type applicationReceivedEvent struct {
	OwnerUserID int64  `json:"owner_user_id"`
	Source      string `json:"source"`
	Name        string `json:"name"`
}

func (s *Subscriber) Start(ctx context.Context) error {
	handlers := map[string]nats.MsgHandler{
		"user.created":               s.handleUserCreated,
		"user.updated":               s.handleUserUpdated,
		"password_reset_requested":   s.handlePasswordReset,
		"contract.expiring_soon":     s.handleContractExpiring,
		"lesson.created":             s.handleLessonReminder,
		"attendance.marked_absent":   s.handleAttendanceAbsent,
		"application.received":       s.handleApplicationReceived,
	}

	for subject, handler := range handlers {
		if _, err := s.nc.Subscribe(subject, handler); err != nil {
			return err
		}
	}
	log.Println("events: subscribed to user.*, password_reset_requested, contract/lesson/attendance/application")
	return nil
}

func (s *Subscriber) handleUserUpdated(msg *nats.Msg) {
	var evt userEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad user.updated payload: %v", err)
		return
	}
	s.upsertUserRef(evt)
}

func (s *Subscriber) handleUserCreated(msg *nats.Msg) {
	var evt userEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad user.created payload: %v", err)
		return
	}
	if !s.upsertUserRef(evt) {
		return
	}

	switch evt.Role {
	case "parent":
		message := fmt.Sprintf(
			"Здравствуйте, %s %s!\n\nВы зарегистрированы в Study Room как родитель.\nВойти можно с email: %s",
			evt.FirstName, evt.LastName, evt.Email,
		)
		s.send(evt.ID, "welcome", message, "")

	case "tutor":
		if evt.TempPassword == "" {
			return
		}
		message := fmt.Sprintf(
			"Здравствуйте, %s %s!\n\nДля вас создан аккаунт репетитора в Study Room.\n\nЛогин: %s\nВременный пароль: %s\n\nСмените пароль после первого входа.",
			evt.FirstName, evt.LastName, evt.Email, evt.TempPassword,
		)
		s.send(evt.ID, "account_credentials", message, "")

	case "student":
		if evt.TempPassword == "" || evt.NotifyEmail == "" {
			return
		}
		// Письмо родителю; в inbox родителя тоже появится запись с user_id родителя —
		// ищем parent по notify_email в users_ref (должен быть после его регистрации).
		parentID := evt.ID
		if ref, err := s.usersRef.GetByEmail(context.Background(), evt.NotifyEmail); err == nil {
			parentID = ref.ID
		}
		message := fmt.Sprintf(
			"Для вашего ребёнка %s %s создан аккаунт ученика в Study Room.\n\nЛогин: %s\nВременный пароль: %s",
			evt.FirstName, evt.LastName, evt.Email, evt.TempPassword,
		)
		s.send(parentID, "account_credentials", message, evt.NotifyEmail)
	}
}

func (s *Subscriber) handlePasswordReset(msg *nats.Msg) {
	var evt passwordResetEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad password_reset_requested payload: %v", err)
		return
	}
	if evt.UserID == 0 || evt.Email == "" || evt.ResetURL == "" {
		return
	}
	// На всякий случай обновим email в users_ref (имена не затираем).
	_ = s.usersRef.Upsert(context.Background(), &models.UserRef{
		ID: evt.UserID, Email: evt.Email,
	})

	message := fmt.Sprintf(
		"Вы запросили сброс пароля в Study Room.\n\nПерейдите по ссылке (действует до %s):\n%s\n\nЕсли это были не вы — просто проигнорируйте письмо.",
		evt.ExpiresAt, evt.ResetURL,
	)
	s.send(evt.UserID, "password_reset", message, evt.Email)
}

func (s *Subscriber) upsertUserRef(evt userEvent) bool {
	if evt.ID == 0 || evt.Email == "" {
		return false
	}
	if err := s.usersRef.Upsert(context.Background(), &models.UserRef{
		ID: evt.ID, Email: evt.Email, FirstName: evt.FirstName, LastName: evt.LastName,
	}); err != nil {
		log.Printf("events: upsert users_ref failed: %v", err)
		return false
	}
	return true
}

func (s *Subscriber) handleContractExpiring(msg *nats.Msg) {
	var evt contractExpiringEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad contract.expiring_soon payload: %v", err)
		return
	}
	message := "Договор №" + evt.Contract + " истекает " + evt.EndDate
	s.send(evt.UserID, "contract_expiring", message, "")
}

func (s *Subscriber) handleLessonReminder(msg *nats.Msg) {
	var evt lessonReminderEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad lesson.created payload: %v", err)
		return
	}
	s.send(evt.UserID, "lesson_reminder", evt.Text, "")
}

func (s *Subscriber) handleAttendanceAbsent(msg *nats.Msg) {
	var evt attendanceAbsentEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad attendance.marked_absent payload: %v", err)
		return
	}
	message := evt.StudentName + " отсутствовал(а) на занятии " + evt.LessonDate
	s.send(evt.ParentUserID, "attendance_marked_absent", message, "")
}

func (s *Subscriber) handleApplicationReceived(msg *nats.Msg) {
	var evt applicationReceivedEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad application.received payload: %v", err)
		return
	}
	message := "Новая заявка от " + evt.Name + " (источник: " + evt.Source + ")"
	s.send(evt.OwnerUserID, "new_application", message, "")
}

func (s *Subscriber) send(userID int64, notifType, message, emailOverride string) {
	if userID == 0 {
		return
	}
	if _, err := s.notifier.Send(context.Background(), userID, notifType, message, emailOverride); err != nil {
		log.Printf("events: notifier.Send type=%s user=%d: %v", notifType, userID, err)
	}
}
