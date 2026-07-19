package events

import (
	"encoding/json"
	"log"

	"github.com/nats-io/nats.go"
)

// Publisher — публикация событий Academic Service (см. microservices-plan.md,
// строка 29: "lesson.created, attendance.marked_absent — публикует Academic
// Service → слушает Notification Service"). Как и в User Service, есть
// no-op реализация — если NATS не сконфигурирован, сервис работает только
// через HTTP API, без событий (см. app.go).
type Publisher interface {
	LessonCreated(lessonID, tutorID, studentID int64, topic, lessonDate, startTime string)
	AttendanceMarkedAbsent(lessonID, studentID int64, reason *string)
}

type NoopPublisher struct{}

func (NoopPublisher) LessonCreated(int64, int64, int64, string, string, string) {}
func (NoopPublisher) AttendanceMarkedAbsent(int64, int64, *string)              {}

type NATSPublisher struct {
	nc *nats.Conn
}

func NewNATSPublisher(nc *nats.Conn) *NATSPublisher {
	return &NATSPublisher{nc: nc}
}

type lessonCreatedPayload struct {
	LessonID   int64  `json:"lesson_id"`
	TutorID    int64  `json:"tutor_id"`
	StudentID  int64  `json:"student_id"`
	Topic      string `json:"topic"`
	LessonDate string `json:"lesson_date"`
	StartTime  string `json:"start_time"`
}

// LessonCreated — публикуется на каждого участника занятия отдельным
// событием, чтобы Notification Service мог напомнить конкретному ученику/
// родителю о конкретном занятии, не разбирая список участников сам.
func (p *NATSPublisher) LessonCreated(lessonID, tutorID, studentID int64, topic, lessonDate, startTime string) {
	p.publish("lesson.created", lessonCreatedPayload{
		LessonID: lessonID, TutorID: tutorID, StudentID: studentID,
		Topic: topic, LessonDate: lessonDate, StartTime: startTime,
	})
}

type attendanceAbsentPayload struct {
	LessonID      int64   `json:"lesson_id"`
	StudentID     int64   `json:"student_id"`
	AbsenceReason *string `json:"absence_reason"`
}

// AttendanceMarkedAbsent — публикуется только для статуса "absent"
// (для "present" уведомлять некого — см. api-contracts.md, 2.10).
func (p *NATSPublisher) AttendanceMarkedAbsent(lessonID, studentID int64, reason *string) {
	p.publish("attendance.marked_absent", attendanceAbsentPayload{
		LessonID: lessonID, StudentID: studentID, AbsenceReason: reason,
	})
}

func (p *NATSPublisher) publish(subject string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[events] marshal %s error: %v", subject, err)
		return
	}
	// best-effort: не блокируем HTTP-ответ пользователю ошибкой публикации,
	// то же решение, что в user-service/internal/events/publisher.go.
	if err := p.nc.Publish(subject, data); err != nil {
		log.Printf("[events] publish %s error: %v", subject, err)
	}
}
