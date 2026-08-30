package events

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/nats-io/nats.go"
	"studyroom/notification-service/internal/models"
	"studyroom/notification-service/internal/notifier"
	"studyroom/notification-service/internal/repository"
)

type Subscriber struct {
	nc         *nats.Conn
	notifier   *notifier.Notifier
	usersRef   *repository.UserRefRepository
	queueGroup string
}

const defaultQueueGroup = "notification-service"

func Connect(url string) (*nats.Conn, error) {
	return nats.Connect(url,
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
		nats.Name("notification-service"),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			log.Printf("events: disconnected from NATS: %v", err)
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			log.Printf("events: reconnected to NATS at %s", nc.ConnectedUrl())
		}),
		nats.ClosedHandler(func(nc *nats.Conn) {
			log.Printf("events: NATS connection closed, last error: %v", nc.LastError())
		}),
	)
}

func NewSubscriber(nc *nats.Conn, n *notifier.Notifier, usersRef *repository.UserRefRepository) *Subscriber {
	return &Subscriber{nc: nc, notifier: n, usersRef: usersRef, queueGroup: defaultQueueGroup}
}

type userEvent struct {
	ID           int64  `json:"id"`
	Email        string `json:"email"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
	Role         string `json:"role"`
	TempPassword string `json:"temp_password"`
	NotifyEmail  string `json:"notify_email"`
	ParentID     *int64 `json:"parent_id"`
	Phone        string `json:"phone,omitempty"`
	TelegramID   string `json:"telegram_id,omitempty"`
	WhatsAppID   string `json:"whatsapp_id,omitempty"`
}

type passwordResetEvent struct {
	UserID     int64  `json:"user_id"`
	Email      string `json:"email"`
	ResetToken string `json:"reset_token"`
	ResetURL   string `json:"reset_url"`
	ExpiresAt  string `json:"expires_at"`
}

type contractExpiringEvent struct {
	UserID         int64  `json:"user_id"`
    Contract       string `json:"contract_number"`
    EndDate        string `json:"end_date"`
    StudentID      int64  `json:"student_id"`
}

// lessonCreatedEvent — payload lesson.created, публикуется Academic Service
// на каждое созданное занятие (см. academic-service/internal/events/
// publisher.go). Notification Service больше не подписан на lesson.created
// напрямую (мгновенное уведомление заменено ежедневным дайджестом — см.
// handleDailyDigest ниже), тип оставлен неиспользуемым на случай, если
// понадобится вернуть обработчик.
type lessonCreatedEvent struct {
	LessonID   int64  `json:"lesson_id"`
	TutorID    int64  `json:"tutor_id"`
	StudentID  int64  `json:"student_id"`
	Topic      string `json:"topic"`
	LessonDate string `json:"lesson_date"`
	StartTime  string `json:"start_time"`
}

// attendanceAbsentEvent — реальный payload Academic Service (см.
// event-schema.md, "v1.attendance.marked_absent", вариант А). Получателя
// (родителя) Notification Service резолвит сам через users_ref.parent_id,
// наполняемый из user.created/user.updated (см. userEvent.ParentID выше).
type attendanceAbsentEvent struct {
	LessonID      int64   `json:"lesson_id"`
	StudentID     int64   `json:"student_id"`
	AbsenceReason *string `json:"absence_reason"`
}

type applicationReceivedEvent struct {
	OwnerUserID int64  `json:"owner_user_id"`
	Source      string `json:"source"`
	Name        string `json:"name"`
}

func (s *Subscriber) Start(ctx context.Context) error {
	handlers := map[string]nats.MsgHandler{
		"user.created":             s.handleUserCreated,
		"user.updated":             s.handleUserUpdated,
		"user.credentials_reset":   s.handleCredentialsReset,
		"password_reset_requested": s.handlePasswordReset,
		"contract.expiring_soon":   s.handleContractExpiring,
		"lesson.cancelled":         s.handleLessonCancelled,
		"lesson.daily_digest":      s.handleDailyDigest,
		"attendance.marked_absent": s.handleAttendanceAbsent,
		"application.received":     s.handleApplicationReceived,
	}

	for subject, handler := range handlers {
		if _, err := s.nc.QueueSubscribe(subject, s.queueGroup, handler); err != nil {
			return err
		}
	}
	if err := s.nc.Flush(); err != nil {
		return err
	}
	log.Printf("events: subscribed to %d subjects in queue group %q", len(handlers), s.queueGroup)
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

	case "branch_owner":
		if evt.TempPassword == "" {
			return
		}
		message := fmt.Sprintf(
			"Здравствуйте, %s %s!\n\nДля вас создан аккаунт владельца филиала в Study Room.\n\nЛогин: %s\nВременный пароль: %s\n\nСмените пароль после первого входа.",
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

func (s *Subscriber) handleCredentialsReset(msg *nats.Msg) {
	var evt userEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad user.credentials_reset payload: %v", err)
		return
	}
	if evt.TempPassword == "" {
		return
	}

	switch evt.Role {
	case "student":
		if evt.NotifyEmail == "" {
			return
		}
		// Как и при создании ученика — письмо уходит родителю, у ученика
		// своей реальной почты нет.
		parentID := evt.ID
		if ref, err := s.usersRef.GetByEmail(context.Background(), evt.NotifyEmail); err == nil {
			parentID = ref.ID
		}
		message := fmt.Sprintf(
			"Данные для входа в личный кабинет ученика %s %s обновлены.\n\nЛогин: %s\nНовый временный пароль: %s",
			evt.FirstName, evt.LastName, evt.Email, evt.TempPassword,
		)
		s.send(parentID, "account_credentials", message, evt.NotifyEmail)

	default:
		if evt.Email == "" {
			return
		}
		message := fmt.Sprintf(
			"Здравствуйте, %s %s!\n\nВаши данные для входа в Study Room обновлены.\n\nЛогин: %s\nНовый временный пароль: %s",
			evt.FirstName, evt.LastName, evt.Email, evt.TempPassword,
		)
		s.send(evt.ID, "account_credentials", message, "")
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
	// UpsertFromUserService (а не общий Upsert) — принципиально: события от
	// User Service не должны трогать telegram_id/whatsapp_id, см. подробный
	// комментарий в userref_repository.go, UpsertFromUserService.
	if err := s.usersRef.UpsertFromUserService(context.Background(), &models.UserRef{
		ID: evt.ID, Email: evt.Email, FirstName: evt.FirstName, LastName: evt.LastName,
		ParentID: evt.ParentID, Phone: evt.Phone,
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

    // Получаем имя ученика из users_ref
    var studentName string
    if evt.StudentID != 0 {
        student, err := s.usersRef.GetByID(context.Background(), evt.StudentID)
        if err != nil {
            log.Printf("events: contract.expiring_soon: student_id=%d not found in users_ref: %v", evt.StudentID, err)
            studentName = "вашему ребёнку" // fallback
        } else {
            studentName = strings.TrimSpace(student.FirstName + " " + student.LastName)
            if studentName == "" {
                studentName = "вашему ребёнку"
            }
        }
    } else {
        studentName = "вашему ребёнку"
    }

    // Форматируем дату
    endDate, err := time.Parse("2006-01-02", evt.EndDate)
    var dateStr string
    if err == nil {
        months := []string{
            "января", "февраля", "марта", "апреля", "мая", "июня",
            "июля", "августа", "сентября", "октября", "ноября", "декабря",
        }
        dateStr = fmt.Sprintf("%d %s %d", endDate.Day(), months[endDate.Month()-1], endDate.Year())
    } else {
        dateStr = evt.EndDate // fallback
    }

    message := fmt.Sprintf(
        "Договор по вашему ребёнку %s истекает %s. Не забудьте оплатить продление, если оно требуется.",
        studentName, dateStr,
    )

    s.send(evt.UserID, "contract_expiring", message, "")
}

// lessonChangedEvent — payload для lesson.cancelled (см.
// academic-service/internal/events/publisher.go, lessonChangedPayload).
type lessonChangedEvent struct {
	LessonID   int64  `json:"lesson_id"`
	StudentID  int64  `json:"student_id"`
	Topic      string `json:"topic"`
	LessonDate string `json:"lesson_date"`
	StartTime  string `json:"start_time"`
}

// handleLessonCancelled — тьютор отменил занятие (см. LessonHandler.Update
// со status=cancelled и LessonHandler.Delete). Раньше такого события не
// было вовсе — ни один канал не узнавал об отмене занятия.
func (s *Subscriber) handleLessonCancelled(msg *nats.Msg) {
	var evt lessonChangedEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad lesson.cancelled payload: %v", err)
		return
	}
	if evt.StudentID == 0 {
		return
	}
	message := fmt.Sprintf(
		"Занятие «%s» %s в %s отменено",
		evt.Topic, evt.LessonDate, evt.StartTime,
	)
	s.send(s.notifyRecipientFor(evt.StudentID), "lesson_cancelled", message, "")
}

// dailyDigestLessonItem/dailyLessonsDigestEvent — payload для
// lesson.daily_digest (см. academic-service/internal/events/publisher.go,
// dailyLessonsDigestPayload). Публикуется раз в сутки в 9:00 МСК, только
// для учеников, у которых на сегодня есть хотя бы одно занятие.
type dailyDigestLessonItem struct {
	Topic     string `json:"topic"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

type dailyLessonsDigestEvent struct {
	StudentID int64                    `json:"student_id"`
	Lessons   []dailyDigestLessonItem  `json:"lessons"`
}

// handleDailyDigest — ежедневная сводка "какие занятия сегодня и во
// сколько" для конкретного ученика. Это единственное уведомление о
// занятиях как таковых (мгновенное уведомление на каждое созданное занятие
// сознательно убрано — по решению заказчика оставлен только этот дайджест).
func (s *Subscriber) handleDailyDigest(msg *nats.Msg) {
	var evt dailyLessonsDigestEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad lesson.daily_digest payload: %v", err)
		return
	}
	if evt.StudentID == 0 || len(evt.Lessons) == 0 {
		return
	}

	studentName := "у вашего ребёнка"
	if student, err := s.usersRef.GetByID(context.Background(), evt.StudentID); err == nil {
		if name := strings.TrimSpace(student.FirstName + " " + student.LastName); name != "" {
			studentName = "у " + name
		}
	}

	var lines strings.Builder
	fmt.Fprintf(&lines, "Сегодня %s занятия:\n", studentName)
	for _, l := range evt.Lessons {
		fmt.Fprintf(&lines, "%s–%s — %s\n", l.StartTime, l.EndTime, l.Topic)
	}
	message := strings.TrimRight(lines.String(), "\n")

	s.send(s.notifyRecipientFor(evt.StudentID), "daily_lessons_digest", message, "")
}

// notifyRecipientFor — получатель уведомления про конкретного ученика: если
// у него есть родитель (users_ref.parent_id) — уведомляем родителя, у
// которого обычно и настроены реальные каналы связи; если родителя нет
// (например, взрослый ученик без привязанного родительского аккаунта) —
// отправляем самому ученику, чтобы не потерять уведомление совсем. Тот же
// приём уже используется в handleAttendanceAbsent.
func (s *Subscriber) notifyRecipientFor(studentID int64) int64 {
	student, err := s.usersRef.GetByID(context.Background(), studentID)
	if err != nil || student.ParentID == nil {
		return studentID
	}
	return *student.ParentID
}

// handleAttendanceAbsent — Academic Service публикует только lesson_id/
// student_id/absence_reason (не знает родителя, см. event-schema.md).
// Получателя (родителя) и текст собирает сама Notification Service, резолвя
// student_id -> parent_id через users_ref (наполняется из user.created/
// user.updated, поле parent_id). Если резолв не удался (users_ref ещё не
// синхронизирован, либо это не ученик) — уведомление тихо не отправляется,
// как и раньше, но теперь по прозрачной причине, а не из-за неверных полей.
func (s *Subscriber) handleAttendanceAbsent(msg *nats.Msg) {
	var evt attendanceAbsentEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad attendance.marked_absent payload: %v", err)
		return
	}
	if evt.StudentID == 0 {
		return
	}

	student, err := s.usersRef.GetByID(context.Background(), evt.StudentID)
	if err != nil {
		log.Printf("events: attendance.marked_absent: unknown student_id=%d in users_ref: %v", evt.StudentID, err)
		return
	}
	if student.ParentID == nil {
		log.Printf("events: attendance.marked_absent: student_id=%d has no parent_id in users_ref", evt.StudentID)
		return
	}

	studentName := strings.TrimSpace(student.FirstName + " " + student.LastName)
	if studentName == "" {
		studentName = fmt.Sprintf("Ученик #%d", evt.StudentID)
	}
	message := studentName + " отсутствовал(а) на занятии"
	if evt.AbsenceReason != nil && *evt.AbsenceReason != "" {
		message += " (причина: " + *evt.AbsenceReason + ")"
	}
	s.send(*student.ParentID, "attendance_marked_absent", message, "")
}

func (s *Subscriber) handleApplicationReceived(msg *nats.Msg) {
	var evt applicationReceivedEvent
	if err := json.Unmarshal(msg.Data, &evt); err != nil {
		log.Printf("events: bad application.received payload: %v", err)
		return
	}
	// Раньше сюда добавлялась пометка "(источник: tilda/internal)" — это
	// техническая деталь, не нужная получателю уведомления, поэтому убрали.
	message := "Новая заявка от " + evt.Name
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
