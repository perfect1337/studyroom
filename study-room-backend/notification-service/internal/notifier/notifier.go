package notifier

import (
	"context"
	"fmt"
	"log"

	"studyroom/notification-service/internal/mailer"
	"studyroom/notification-service/internal/messenger"
	"studyroom/notification-service/internal/models"
	"studyroom/notification-service/internal/repository"
)

// Notifier orchestrates notification delivery across all channels.
// Each enabled channel creates its own notification record in the DB.
type Notifier struct {
	notifications *repository.NotificationRepository
	settings      *repository.SettingsRepository
	usersRef      *repository.UserRefRepository
	mail          mailer.Sender
	factory       *messenger.Factory
	sendQueue     chan *sendJob
}

type sendJob struct {
	notificationID int64
	userID         int64
	to             string
	subject        string
	body           string
	channel        models.Channel
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
	factory *messenger.Factory,
) *Notifier {
	n := &Notifier{
		notifications: notifications,
		settings:      settings,
		usersRef:      usersRef,
		mail:          mail,
		factory:       factory,
		sendQueue:     make(chan *sendJob, defaultSendQueueSize),
	}
	for i := 0; i < defaultSendWorkers; i++ {
		go n.processBackgroundSends()
	}
	return n
}

// Send creates a notification record and dispatches to ALL enabled channels.
// Each channel gets its own DB record so delivery can be tracked independently.
func (n *Notifier) Send(ctx context.Context, userID int64, notifType, message, emailOverride string) (*models.Notification, error) {
	subject := subjectFor(notifType)

	// Load user settings
	settings, err := n.settings.GetOrDefault(ctx, userID)
	if err != nil {
		log.Printf("notifier: get settings for user %d: %v", userID, err)
		settings = &models.Settings{UserID: userID, EmailEnabled: true}
	}

	// Load user refs for contact resolution
	ref, err := n.usersRef.GetByID(ctx, userID)
	if err != nil {
		log.Printf("notifier: get user ref for user %d: %v", userID, err)
		ref = &models.UserRef{ID: userID}
	}

	// Create notification records for ALL enabled channels
	createdRecords := make([]*models.Notification, 0)

	if settings.EmailEnabled {
		to := emailOverride
		if to == "" {
			to = ref.Email
		}
		if to != "" {
			rec, err := n.createAndQueueJob(ctx, userID, notifType, message, subject, models.ChannelEmail, to)
			if err != nil {
				log.Printf("notifier: email dispatch failed for user %d: %v", userID, err)
			} else {
				createdRecords = append(createdRecords, rec)
			}
		}
	}

	if settings.TelegramEnabled && ref.TelegramID != "" {
		rec, err := n.createAndQueueJob(ctx, userID, notifType, message, subject, models.ChannelTelegram, ref.TelegramID)
		if err != nil {
			log.Printf("notifier: telegram dispatch failed for user %d: %v", userID, err)
		} else {
			createdRecords = append(createdRecords, rec)
		}
	}

	if settings.WhatsAppEnabled && ref.WhatsAppID != "" {
		rec, err := n.createAndQueueJob(ctx, userID, notifType, message, subject, models.ChannelWhatsApp, ref.WhatsAppID)
		if err != nil {
			log.Printf("notifier: whatsapp dispatch failed for user %d: %v", userID, err)
		} else {
			createdRecords = append(createdRecords, rec)
		}
	}

	if settings.MaxEnabled && ref.Phone != "" {
		rec, err := n.createAndQueueJob(ctx, userID, notifType, message, subject, models.ChannelMax, ref.Phone)
		if err != nil {
			log.Printf("notifier: max dispatch failed for user %d: %v", userID, err)
		} else {
			createdRecords = append(createdRecords, rec)
		}
	}

	if len(createdRecords) == 0 {
		return nil, fmt.Errorf("no enabled channels for user %d (email=%v, telegram=%v, whatsapp=%v, max=%v)",
			userID, settings.EmailEnabled, settings.TelegramEnabled, settings.WhatsAppEnabled, settings.MaxEnabled)
	}

	// Return the first record (preferred channel) as the "main" notification
	return createdRecords[0], nil
}

// createAndQueueJob creates a notification record and queues it for delivery.
func (n *Notifier) createAndQueueJob(ctx context.Context, userID int64, notifType, message, subject string, channel models.Channel, to string) (*models.Notification, error) {
	created, err := n.notifications.Create(ctx, &models.Notification{
		UserID:  userID,
		Type:    notifType,
		Channel: channel,
		Message: message,
		Status:  models.StatusPending,
	})
	if err != nil {
		return nil, fmt.Errorf("create notification: %w", err)
	}

	job := &sendJob{
		notificationID: created.ID,
		userID:         userID,
		to:             to,
		subject:        subject,
		body:           message,
		channel:        channel,
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

// SendDirect sends a notification through a single specified channel.
// Used for testing and manual dispatch.
func (n *Notifier) SendDirect(ctx context.Context, userID int64, channel models.Channel, notifType, message string) (*models.Notification, error) {
	subject := subjectFor(notifType)
	ref, err := n.usersRef.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("get user ref: %w", err)
	}

	to, ok := n.resolveContact(ref, channel)
	if !ok {
		return nil, fmt.Errorf("no contact for channel %s", channel)
	}

	return n.createAndQueueJob(ctx, userID, notifType, message, subject, channel, to)
}

func (n *Notifier) processBackgroundSends() {
	for job := range n.sendQueue {
		n.processSendJob(job)
	}
}

func (n *Notifier) processSendJob(job *sendJob) {
	ctx := context.Background()

	switch job.channel {
	case models.ChannelEmail:
		n.sendEmail(ctx, job)
	case models.ChannelTelegram, models.ChannelWhatsApp, models.ChannelMax:
		n.sendMessenger(ctx, job)
	default:
		log.Printf("notifier: unknown channel %s for notification %d", job.channel, job.notificationID)
	}
}

func (n *Notifier) sendEmail(ctx context.Context, job *sendJob) {
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

func (n *Notifier) sendMessenger(ctx context.Context, job *sendJob) {
	provider, err := n.factory.Get(string(job.channel))
	if err != nil {
		errMsg := err.Error()
		log.Printf("notifier: get messenger provider for %s: %v", job.channel, err)
		if updateErr := n.notifications.UpdateStatus(ctx, job.notificationID, models.StatusFailed, &errMsg); updateErr != nil {
			log.Printf("notifier: update status failed after provider error: %v", updateErr)
		}
		return
	}

	if err := provider.Send(job.userID, job.to, job.subject, job.body); err != nil {
		errMsg := err.Error()
		log.Printf("notifier: send %s to %s failed: %v", job.channel, job.to, err)
		if updateErr := n.notifications.UpdateStatus(ctx, job.notificationID, models.StatusFailed, &errMsg); updateErr != nil {
			log.Printf("notifier: update status failed after messenger error: %v", updateErr)
		}
		return
	}
	if err := n.notifications.UpdateStatus(ctx, job.notificationID, models.StatusSent, nil); err != nil {
		log.Printf("notifier: update status to sent failed: %v", err)
	}
}

// resolveContact returns the contact info for the given channel.
func (n *Notifier) resolveContact(ref *models.UserRef, channel models.Channel) (string, bool) {
	switch channel {
	case models.ChannelEmail:
		return ref.Email, ref.Email != ""
	case models.ChannelTelegram:
		return ref.TelegramID, ref.TelegramID != ""
	case models.ChannelWhatsApp:
		return ref.WhatsAppID, ref.WhatsAppID != ""
	case models.ChannelMax:
		return ref.Phone, ref.Phone != ""
	default:
		return "", false
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
