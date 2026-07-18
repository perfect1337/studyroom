// Package events — подписка на события брокера (NATS), см. п. 2.3 и 3.9
// microservices-plan.md: "Реализовать Notification Service: подписка на
// события всех остальных сервисов + интеграции с email/SMS/Telegram".
//
// Подписка запускается best-effort: если NATS недоступен при старте,
// сервис всё равно поднимается и продолжает работать через HTTP API
// (POST /internal/notifications/send), просто без автоматической реакции
// на события. Это осознанный компромисс для раннего этапа разработки.
package events

import (
	"context"
	"encoding/json"
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

// Connect пытается подключиться к NATS. Ошибка не фатальна для вызывающего —
// он решает, логировать и продолжать без событий, или считать это фатальным.
func Connect(url string) (*nats.Conn, error) {
	return nats.Connect(url, nats.MaxReconnects(-1))
}

func NewSubscriber(nc *nats.Conn, n *notifier.Notifier, usersRef *repository.UserRefRepository) *Subscriber {
	return &Subscriber{nc: nc, notifier: n, usersRef: usersRef}
}

// user.created / user.updated payload — минимум, нужный для users_ref.
type userEvent struct {
	ID        int64  `json:"id"`
	Email     string `json:"email"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
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

// Start подписывается на все интересующие Notification Service subject'ы.
// Формат subject соответствует architecture-communication.mermaid: user.created,
// user.updated, contract.expiring_soon, lesson.created, attendance.marked_absent,
// application.received.
func (s *Subscriber) Start(ctx context.Context) error {
	handlers := map[string]nats.MsgHandler{
		"user.created":             s.handleUserEvent,
		"user.updated":             s.handleUserEvent,
		"contract.expiring_soon":   s.handleContractExpiring,
		"lesson.created":           s.handleLessonReminder,
		"attendance.marked_absent": s.handleAttendanceAbsent,
		"application.received":     s.handleApplicationReceived,
	}

	for subject, handler := range handlers {
		if _, err := s.nc.Subscribe(subject, handler); err != nil {
			return err
		}
	}
	log.Println("events: subscribed to user.*, contract.expiring_soon, lesson.created, attendance.marked_absent, application.received")
	return nil
}

func (s *Subscriber) handleUserEvent(msg *nats.Msg) {
	var evt userEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad user event payload: %v", err)
		return
	}
	if evt.ID == 0 || evt.Email == "" {
		return
	}
	if err := s.usersRef.Upsert(context.Background(), &models.UserRef{
		ID: evt.ID, Email: evt.Email, FirstName: evt.FirstName, LastName: evt.LastName,
	}); err != nil {
		log.Printf("events: upsert users_ref failed: %v", err)
	}
}

func (s *Subscriber) handleContractExpiring(msg *nats.Msg) {
	var evt contractExpiringEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad contract.expiring_soon payload: %v", err)
		return
	}
	message := "Договор №" + evt.Contract + " истекает " + evt.EndDate
	s.send(evt.UserID, "contract_expiring", message)
}

func (s *Subscriber) handleLessonReminder(msg *nats.Msg) {
	var evt lessonReminderEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad lesson.created payload: %v", err)
		return
	}
	s.send(evt.UserID, "lesson_reminder", evt.Text)
}

func (s *Subscriber) handleAttendanceAbsent(msg *nats.Msg) {
	var evt attendanceAbsentEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad attendance.marked_absent payload: %v", err)
		return
	}
	message := evt.StudentName + " отсутствовал(а) на занятии " + evt.LessonDate
	s.send(evt.ParentUserID, "attendance_marked_absent", message)
}

func (s *Subscriber) handleApplicationReceived(msg *nats.Msg) {
	var evt applicationReceivedEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad application.received payload: %v", err)
		return
	}
	message := "Новая заявка от " + evt.Name + " (источник: " + evt.Source + ")"
	s.send(evt.OwnerUserID, "new_application", message)
}

func (s *Subscriber) send(userID int64, notifType, message string) {
	if userID == 0 {
		return
	}
	if _, err := s.notifier.Send(context.Background(), userID, notifType, message, ""); err != nil {
		log.Printf("events: notifier.Send failed: %v", err)
	}
}
