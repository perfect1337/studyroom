package events

import (
	"encoding/json"
	"log"

	"github.com/nats-io/nats.go"
	"studyroom/academic-service/internal/repository"
)

// Publisher — публикация событий Academic Service (см. microservices-plan.md,
// строка 29: "lesson.created, attendance.marked_absent — публикует Academic
// Service → слушает Notification Service"). Как и в User Service, есть
// no-op реализация — если NATS не сконфигурирован, сервис работает только
// через HTTP API, без событий (см. app.go).
//
// LessonCancelled/DailyLessonsDigest — добавлены по конкретному запросу:
// нужны 3 telegram-уведомления — за день до конца договора (уже было,
// contracts-service), ежедневный дайджест занятий сегодняшнего дня в 9:00
// МСК (см. cmd/api/main.go, startDailyDigestJob) и уведомление об отмене
// занятия. Раньше при отмене занятия (LessonHandler.Update/Delete) вообще
// ничего не публиковалось — Notification Service не мог прислать
// уведомление ни в один канал. Мгновенное "lesson.created" на каждое
// созданное занятие сознательно убрано из Notification Service (см. его
// subscriber.go) в пользу дневного дайджеста — сам ивент здесь оставлен на
// случай других будущих подписчиков, но никто его больше не слушает.
type Publisher interface {
	LessonCreated(lessonID, tutorID, studentID int64, topic, lessonDate, startTime string)
	AttendanceMarkedAbsent(lessonID, studentID int64, reason *string)
	LessonCancelled(lessonID, studentID int64, topic, lessonDate, startTime string)
	DailyLessonsDigest(studentID int64, items []repository.DigestLessonItem)
}

type NoopPublisher struct{}

func (NoopPublisher) LessonCreated(int64, int64, int64, string, string, string) {}
func (NoopPublisher) AttendanceMarkedAbsent(int64, int64, *string)              {}
func (NoopPublisher) LessonCancelled(int64, int64, string, string, string)      {}
func (NoopPublisher) DailyLessonsDigest(int64, []repository.DigestLessonItem)   {}

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
// событием. Notification Service больше не превращает его в мгновенное
// уведомление (см. комментарий у Publisher выше) — событие оставлено на
// случай других будущих подписчиков (аналитика и т.п.).
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

type lessonChangedPayload struct {
	LessonID   int64  `json:"lesson_id"`
	StudentID  int64  `json:"student_id"`
	Topic      string `json:"topic"`
	LessonDate string `json:"lesson_date"`
	StartTime  string `json:"start_time"`
}

// LessonCancelled — публикуется на каждого участника занятия отдельно при
// отмене (см. LessonHandler.Update со status=cancelled и
// LessonHandler.Delete / LessonRepository.Cancel).
func (p *NATSPublisher) LessonCancelled(lessonID, studentID int64, topic, lessonDate, startTime string) {
	p.publish("lesson.cancelled", lessonChangedPayload{
		LessonID: lessonID, StudentID: studentID, Topic: topic,
		LessonDate: lessonDate, StartTime: startTime,
	})
}

// DigestLessonItem — payload одного занятия в ежедневном дайджесте, тот же
// набор полей, что и repository.DigestLessonItem (см. lesson_repository.go),
// но с JSON-тегами для события.
type dailyDigestItemPayload struct {
	Topic     string `json:"topic"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

type dailyLessonsDigestPayload struct {
	StudentID int64                    `json:"student_id"`
	Lessons   []dailyDigestItemPayload `json:"lessons"`
}

// DailyLessonsDigest — публикуется раз в сутки в 9:00 МСК (см.
// cmd/api/main.go, startDailyDigestJob) для каждого ученика, у которого
// СЕГОДНЯ есть хотя бы одно ещё не отменённое занятие — со списком времён
// этих занятий. Для учеников без занятий сегодня событие не публикуется
// вовсе (не рассылаем пустые дайджесты).
func (p *NATSPublisher) DailyLessonsDigest(studentID int64, items []repository.DigestLessonItem) {
	if len(items) == 0 {
		return
	}
	payloadItems := make([]dailyDigestItemPayload, 0, len(items))
	for _, it := range items {
		payloadItems = append(payloadItems, dailyDigestItemPayload{
			Topic: it.Topic, StartTime: it.StartTime, EndTime: it.EndTime,
		})
	}
	p.publish("lesson.daily_digest", dailyLessonsDigestPayload{StudentID: studentID, Lessons: payloadItems})
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
