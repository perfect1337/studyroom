package notifier

import (
	"context"
	"fmt"
	"log"
	"time"

	"studyroom/notification-service/internal/mailer"
	"studyroom/notification-service/internal/messenger"
	"studyroom/notification-service/internal/models"
	"studyroom/notification-service/internal/ratelimit"
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

	// batchSendQueue/emailQuota — отдельный путь доставки только для email
	// "пачечных" уведомлений (см. batchEmailNotifTypes): ежедневного
	// дайджеста занятий (публикуется раз в сутки в 9:00 МСК, см.
	// academic-service startDailyDigestJob) и напоминаний об истекающих
	// договорах. Оба генерируются разом на десятки/сотни получателей и
	// поэтому сами по себе способны упереться в почасовой лимит
	// SMTP-провайдера (mail.ru — не более 500 писем в час на аккаунт).
	//
	// emailQuota ограничивает именно эти два типа сверху (см.
	// defaultSMTPBatchHourlyLimit) — как только за последний час через
	// SMTP отправлено достаточно писем ЭТИХ типов, доставка следующих
	// блокируется внутри processBatchEmailSends (см. ratelimit.HourlyLimiter.
	// Wait) и продолжается только тогда, когда самому старому письму в
	// окне "исполняется" час, т.е. лимит обновляется. Так гарантированно
	// остаётся запас пропускной способности SMTP на остальные типы
	// уведомлений (приветственные письма, сброс пароля, новая заявка,
	// отмена занятия, отсутствие на занятии) — они по-прежнему идут через
	// обычный sendQueue/processBackgroundSends безо всякого троттлинга с
	// нашей стороны.
	batchSendQueue chan *sendJob
	emailQuota     *ratelimit.HourlyLimiter
	emailQuotaMax  int // фактически сконфигурированный лимит, для логов (см. New)
}

type sendJob struct {
	notificationID int64
	userID         int64
	to             string
	subject        string
	body           string
	channel        models.Channel
	notifType      string
}

const (
	defaultSendQueueSize = 128
	defaultSendWorkers   = 4

	// defaultBatchSendQueueSize — с запасом на дневной дайджест: в
	// худшем случае у каждого активного ученика в этот час будет своё
	// письмо, и все они встанут в очередь одновременно в 9:00 МСК, ещё до
	// того, как quota начнёт их выпускать по одному. Больше, чем
	// defaultSendQueueSize, намеренно — эта очередь по конструкции
	// предназначена копить письма, а не обрабатываться мгновенно.
	defaultBatchSendQueueSize = 4096

	// defaultSMTPBatchHourlyLimit — сколько писем в час разрешено на
	// дайджест занятий и напоминания об истечении договора вместе взятые.
	// SMTP-провайдер (mail.ru) отдаёт 500/час на аккаунт; 400 сюда, 100
	// гарантированно остаются на остальные уведомления (см. New —
	// SMTP_BATCH_HOURLY_LIMIT переопределяет значение из конфига).
	defaultSMTPBatchHourlyLimit = 400
)

// batchEmailNotifTypes — типы уведомлений, чья email-доставка идёт через
// batchSendQueue/emailQuota, а не напрямую. Именно эти два типа
// рассылаются пачками по расписанию (см. комментарий у поля batchSendQueue
// в Notifier) — остальные типы почти всегда единичны (один пользователь —
// одно событие: регистрация, сброс пароля и т.д.) и не должны ждать
// освобождения общей SMTP-квоты пачечных рассылок.
var batchEmailNotifTypes = map[string]bool{
	"daily_lessons_digest": true,
	"contract_expiring":    true,
}

// New создаёt Notifier. smtpBatchHourlyLimit — верхняя граница писем в час
// для batchEmailNotifTypes (см. defaultSMTPBatchHourlyLimit): 0 значит
// "использовать значение по умолчанию", отрицательное — "троттлинга нет"
// (полезно для тестов/локальной разработки без реального SMTP-лимита).
func New(
	notifications *repository.NotificationRepository,
	settings *repository.SettingsRepository,
	usersRef *repository.UserRefRepository,
	mail mailer.Sender,
	factory *messenger.Factory,
	smtpBatchHourlyLimit int,
) *Notifier {
	if smtpBatchHourlyLimit == 0 {
		smtpBatchHourlyLimit = defaultSMTPBatchHourlyLimit
	}
	n := &Notifier{
		notifications:  notifications,
		settings:       settings,
		usersRef:       usersRef,
		mail:           mail,
		factory:        factory,
		sendQueue:      make(chan *sendJob, defaultSendQueueSize),
		batchSendQueue: make(chan *sendJob, defaultBatchSendQueueSize),
		emailQuota:     ratelimit.NewHourlyLimiter(smtpBatchHourlyLimit, time.Hour),
		emailQuotaMax:  smtpBatchHourlyLimit,
	}
	for i := 0; i < defaultSendWorkers; i++ {
		go n.processBackgroundSends()
	}
	// Один воркер: очередь и так последовательно ограничена общей квотой
	// emailQuota, несколько воркеров здесь не увеличили бы реальную
	// пропускную способность SMTP, а вот порядок отправки (FIFO) удобнее
	// сохранить простым — письма уходят в том порядке, в котором встали
	// в очередь.
	go n.processBatchEmailSends()
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
		notifType:      notifType,
	}

	// Только email-доставка "пачечных" типов (дайджест занятий,
	// напоминание об истекающем договоре) идёт через отдельную очередь с
	// почасовой SMTP-квотой — см. комментарий у Notifier.batchSendQueue.
	// Те же типы через telegram/whatsapp/max квоту не расходуют — она
	// ограничивает именно SMTP.
	queue := n.sendQueue
	queueFullMsg := "notification queue is full"
	if channel == models.ChannelEmail && batchEmailNotifTypes[notifType] {
		queue = n.batchSendQueue
		queueFullMsg = "batch email queue is full"
	}

	select {
	case queue <- job:
		return created, nil
	default:
		_ = n.notifications.UpdateStatus(ctx, created.ID, models.StatusFailed, &queueFullMsg)
		return created, fmt.Errorf("%s", queueFullMsg)
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

// processBatchEmailSends — воркер для batchSendQueue (см. Notifier.
// batchSendQueue). Для каждого письма сначала блокируется на emailQuota.
// Wait, пока не появится свободное место в почасовой SMTP-квоте, и только
// потом реально отправляет письмо — это и есть требуемое поведение
// "уведомления встают в очередь и уходят только после обновления лимита".
//
// ctx — фоновый (context.Background()), т.к. у Notifier сейчас нет общего
// жизненного цикла/отмены (тот же паттерн, что и в processSendJob) —
// значит Wait здесь блокируется исключительно по квоте и практически
// никогда не возвращает ошибку.
func (n *Notifier) processBatchEmailSends() {
	for job := range n.batchSendQueue {
		ctx := context.Background()
		if n.emailQuotaMax > 0 {
			if used := n.emailQuota.Used(); used >= n.emailQuotaMax {
				log.Printf("notifier: SMTP hourly batch quota reached (%d/%d), queueing %s for notification %d until it frees up",
					used, n.emailQuotaMax, job.notifType, job.notificationID)
			}
		}
		if err := n.emailQuota.Wait(ctx); err != nil {
			errMsg := err.Error()
			log.Printf("notifier: batch email quota wait failed for notification %d: %v", job.notificationID, err)
			_ = n.notifications.UpdateStatus(ctx, job.notificationID, models.StatusFailed, &errMsg)
			continue
		}
		n.sendEmail(ctx, job)
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
	case "daily_lessons_digest":
		return "Study Room — занятия сегодня"
	case "lesson_cancelled":
		return "Study Room — занятие отменено"
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
