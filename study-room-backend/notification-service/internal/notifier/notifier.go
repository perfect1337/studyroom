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
}

func New(
	notifications *repository.NotificationRepository,
	settings *repository.SettingsRepository,
	usersRef *repository.UserRefRepository,
	mail mailer.Sender,
) *Notifier {
	return &Notifier{notifications: notifications, settings: settings, usersRef: usersRef, mail: mail}
}

// Send создаёт запись в notifications и отправляет email.
// При ошибке SMTP возвращает error (после пометки записи failed).
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
	if err := n.mail.Send(to, subject, message); err != nil {
		errMsg := err.Error()
		log.Printf("notifier: send email to %s failed: %v", to, err)
		_ = n.notifications.UpdateStatus(ctx, created.ID, models.StatusFailed, &errMsg)
		return created, fmt.Errorf("smtp send: %w", err)
	}

	if err := n.notifications.UpdateStatus(ctx, created.ID, models.StatusSent, nil); err != nil {
		log.Printf("notifier: update status to sent failed: %v", err)
	}
	created.Status = models.StatusSent
	return created, nil
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
