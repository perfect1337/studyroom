package notifier

import (
	"context"
	"fmt"
	"log"

	"studyroom/notification-service/internal/mailer"
	"studyroom/notification-service/internal/models"
	"studyroom/notification-service/internal/repository"
)

type Notifier struct {
	notifications *repository.NotificationRepository
	settings      *repository.SettingsRepository
	usersRef      *repository.UserRefRepository
	mail          mailer.Sender
	sendQueue     chan *sendJob
}

type sendJob struct {
	notificationID int64
	to             string
	subject        string
	body           string
}

const (
	defaultSendQueueSize = 128
	defaultSendWorkers   = 4
)

func New(
	notifications *repository.NotificationRepository,
	settings *repository.SettingsRepository,
	usersRef *repository.UserRefRepository,
	mail mailer.Sender,
) *Notifier {
	n := &Notifier{
		notifications: notifications,
		settings:      settings,
		usersRef:      usersRef,
		mail:          mail,
		sendQueue:     make(chan *sendJob, defaultSendQueueSize),
	}
	for i := 0; i < defaultSendWorkers; i++ {
		go n.processBackgroundSends()
	}
	return n
}

// Send создаёт запись в notifications и ставит email на фоновую отправку.
// При ошибке SMTP статус уведомления обновляется на failed, но ошибка не возвращается
// синхронно: запрос не ждёт завершения SMTP-сессии.
func (n *Notifier) Send(ctx context.Context, userID int64, notifType, message, emailOverride string) (*models.Notification, error) {
	created, err := n.notifications.Create(ctx, &models.Notification{
		UserID:  userID,
		Type:    notifType,
		Channel: models.ChannelEmail,
		Message: message,
		Status:  models.StatusPending,
	})
	if err != nil {
		return nil, fmt.Errorf("create notification: %w", err)
	}

	settings, err := n.settings.GetOrDefault(ctx, userID)
	if err != nil {
		log.Printf("notifier: get settings for user %d: %v", userID, err)
		settings = &models.Settings{UserID: userID, EmailEnabled: true}
	}
	if !settings.EmailEnabled {
		errMsg := "email channel disabled for user"
		_ = n.notifications.UpdateStatus(ctx, created.ID, models.StatusFailed, &errMsg)
		return created, fmt.Errorf("%s", errMsg)
	}

	to := emailOverride
	if to == "" {
		ref, err := n.usersRef.GetByID(ctx, userID)
		if err != nil {
			errMsg := "no known email for user (users_ref empty — sync via user.created event or POST /internal/users/sync)"
			_ = n.notifications.UpdateStatus(ctx, created.ID, models.StatusFailed, &errMsg)
			return created, fmt.Errorf("%s", errMsg)
		}
		to = ref.Email
	}

	subject := subjectFor(notifType)
	job := &sendJob{
		notificationID: created.ID,
		to:             to,
		subject:        subject,
		body:           message,
	}
	select {
	case n.sendQueue <- job:
		return created, nil
	default:
		errMsg := "notification queue is full"
		_ = n.notifications.UpdateStatus(ctx, created.ID, models.StatusFailed, &errMsg)
		return created, fmt.Errorf("%s", errMsg)
	}
}

func (n *Notifier) processBackgroundSends() {
	for job := range n.sendQueue {
		n.processSendJob(job)
	}
}

func (n *Notifier) processSendJob(job *sendJob) {
	ctx := context.Background()
	if err := n.mail.Send(job.to, job.subject, job.body); err != nil {
		errMsg := err.Error()
		log.Printf("notifier: send email to %s failed: %v", job.to, err)
		if updateErr := n.notifications.UpdateStatus(ctx, job.notificationID, models.StatusFailed, &errMsg); updateErr != nil {
			log.Printf("notifier: update status failed after smtp error: %v", updateErr)
		}
		return
	}
	if err := n.notifications.UpdateStatus(ctx, job.notificationID, models.StatusSent, nil); err != nil {
		log.Printf("notifier: update status to sent failed: %v", err)
	}
}

func subjectFor(notifType string) string {
	switch notifType {
	case "lesson_reminder":
		return "Study Room — напоминание о занятии"
	case "contract_expiring":
		return "Study Room — истекает договор"
	case "new_application":
		return "Study Room — новая заявка"
	case "attendance_marked_absent":
		return "Study Room — отсутствие на занятии"
	case "welcome":
		return "Study Room — добро пожаловать"
	case "account_credentials":
		return "Study Room — данные для входа"
	case "password_reset":
		return "Study Room — сброс пароля"
	default:
		return "Study Room — уведомление"
	}
}
