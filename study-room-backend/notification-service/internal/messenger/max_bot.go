package messenger

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"studyroom/notification-service/internal/models"
	"studyroom/notification-service/internal/repository"
)

// MaxBot — чат-бот в мессенджере MAX (аналог TelegramBot, см. telegram_bot.go).
//
// В отличие от Telegram, MAX-бот НЕ использует long-polling: по требованиям
// платформы (dev.max.ru) для production-окружения события приходят через
// Webhook. При старте сервис регистрирует подписку POST /subscriptions с
// URL на этот сервис, и MAX сам шлёт HTTPS POST с объектом Update.
//
// Обрабатываемые события:
//   - bot_started    — пользователь начал общение → приветствие, просим email
//   - message_created — текст от пользователя (email) → привязка аккаунта
//   - bot_stopped / dialog_removed — пользователь остановил/удалил бота
//
// ВАЖНО: в MAX событие message_created приходит и на сообщения САМОГО бота
// (в отличие от Telegram). Чтобы не зациклиться на собственных ответах,
// сообщения, где sender.is_bot == true (или sender.user_id == ID бота из
// GET /me), игнорируются.
//
// Webhook-эндпоинт монтируется в HTTP-роутер сервиса (см. app.go) и
// проверяет заголовок X-Max-Bot-Api-Secret (настраивается при создании
// подписки).
type MaxBot struct {
	accessToken   string
	webhookSecret string

	userRefRepo  *repository.UserRefRepository
	maxUserRepo  *repository.MaxUserRepository
	settingsRepo *repository.SettingsRepository

	// provider — для ответов пользователю в MAX (та же отправка, что у
	// уведомлений, с тем же троттлингом 2 сообщ/сек на диалог).
	provider *MaxProvider

	// botUserID — ID самого бота в MAX (из GET /me), чтобы отбрасывать
	// message_created, отправленные ботом самому себе. Заполняется в
	// LoadSelf, если вызов /me прошёл; если нет — полагаемся на is_bot.
	botUserID int64

	// chatLimiter — не более 5 попыток ввести email за 5 минут с одного
	// max user_id. Аналог telegram: защита от перебора email и спама.
	chatLimiter *chatRateLimiter

	// lookupLimiter — общий потолок в 60 попыток резолва email/минуту на
	// весь бот (см. комментарий в telegram_ratelimit.go).
	lookupLimiter *globalRateLimiter
}

// maxUpdate — объект Update из MAX Bot API (события webhook'а).
// Поля не из документации игнорируются (lenient JSON).
type maxUpdate struct {
	UpdateType string      `json:"update_type"`
	ChatID     int64       `json:"chat_id"`
	User       *maxUser    `json:"user"`
	Message    *maxMessage `json:"message"`
	IsChannel  bool        `json:"is_channel"`
}

type maxUser struct {
	UserID    int64  `json:"user_id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Username  string `json:"username"`
	IsBot     bool   `json:"is_bot"`
}

type maxMessage struct {
	Sender *maxUser        `json:"sender"`
	Body   *maxMessageBody `json:"body"`
}

type maxMessageBody struct {
	Text string `json:"text"`
}

// maxSubscriptionRequest — тело POST /subscriptions (регистрация webhook'а).
type maxSubscriptionRequest struct {
	URL         string   `json:"url"`
	UpdateTypes []string `json:"update_types"`
	Secret      string   `json:"secret,omitempty"`
}

const maxAPIBase = "https://platform-api2.max.ru"

// maxWebhookUpdateTypes — события, которые нужны боту для привязки.
var maxWebhookUpdateTypes = []string{
	"bot_started",
	"message_created",
	"bot_stopped",
	"dialog_removed",
}

// NewMaxBot создаёт бота БЕЗ сетевых вызовов (webhook-обработчик и репозитории
// уже готовы к работе; регистрация подписки и GET /me выполняются отдельно
// через LoadSelf/Subscribe — чтобы не блокировать старт HTTP-сервера, как и
// инициализация Telegram-бота в main.go).
func NewMaxBot(accessToken, webhookSecret string, userRefRepo *repository.UserRefRepository, maxUserRepo *repository.MaxUserRepository, settingsRepo *repository.SettingsRepository, sharedProviders ...*MaxProvider) *MaxBot {
	provider := NewMaxProvider(accessToken)
	if len(sharedProviders) > 0 && sharedProviders[0] != nil {
		provider = sharedProviders[0]
	}
	return &MaxBot{
		accessToken:   accessToken,
		webhookSecret: webhookSecret,
		userRefRepo:   userRefRepo,
		maxUserRepo:   maxUserRepo,
		settingsRepo:  settingsRepo,
		provider:      provider,
		chatLimiter:   newChatRateLimiter(5, 5*time.Minute, 5000),
		lookupLimiter: newGlobalRateLimiter(60, time.Minute),
	}
}

// LoadSelf получает ID самого бота через GET /me (нужен, чтобы отличать
// сообщения бота от сообщений пользователя в message_created).
func (b *MaxBot) LoadSelf(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, maxAPIBase+"/me", nil)
	if err != nil {
		return fmt.Errorf("max me request: %w", err)
	}
	req.Header.Set("Authorization", b.accessToken)

	resp, err := b.provider.client.Do(req)
	if err != nil {
		return fmt.Errorf("max me: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("max me: unexpected status %d", resp.StatusCode)
	}

	var me struct {
		UserID int64  `json:"user_id"`
		Name   string `json:"name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		return fmt.Errorf("max me decode: %w", err)
	}
	b.botUserID = me.UserID
	log.Printf("max: bot self check ok (bot_user_id=%d, name=%q)", me.UserID, me.Name)
	return nil
}

// Subscribe регистрирует webhook-подписку: POST /subscriptions с URL этого
// сервиса. Имеет retry-цикл как у инициализации Telegram-бота — MAX API
// может быть временно недоступен при старте контейнера.
func (b *MaxBot) Subscribe(ctx context.Context, webhookURL string) error {
	body := maxSubscriptionRequest{
		URL:         webhookURL,
		UpdateTypes: maxWebhookUpdateTypes,
		Secret:      b.webhookSecret,
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("max subscribe marshal: %w", err)
	}

	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, maxAPIBase+"/subscriptions", bytes.NewBuffer(payload))
		if err != nil {
			return fmt.Errorf("max subscribe request: %w", err)
		}
		req.Header.Set("Authorization", b.accessToken)
		req.Header.Set("Content-Type", "application/json")

		resp, err := b.provider.client.Do(req)
		if err != nil {
			lastErr = err
			if attempt < 4 {
				log.Printf("max: subscribe attempt %d/5 failed: %v, retrying in 3s...", attempt+1, err)
				time.Sleep(3 * time.Second)
			}
			continue
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
			lastErr = fmt.Errorf("max subscribe: status=%d", resp.StatusCode)
			if attempt < 4 {
				log.Printf("max: subscribe attempt %d/5 failed: %v, retrying in 3s...", attempt+1, lastErr)
				time.Sleep(3 * time.Second)
			}
			continue
		}
		log.Printf("max: webhook subscribed at %s (update_types=%v)", webhookURL, maxWebhookUpdateTypes)
		return nil
	}
	return fmt.Errorf("max subscribe: %w", lastErr)
}

// HandleWebhook — обработчик POST /api/v1/notifications/max/webhook.
// MAX ждёт HTTP 200 в течение 30 секунд, иначе событие уходит в retry
// (до 10 попыток). Поэтому обработчик максимально лёгкий и всегда
// отвечает 200, кроме явной ошибки авторизации (неверный secret).
func (b *MaxBot) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	if b.webhookSecret == "" || r.Header.Get("X-Max-Bot-Api-Secret") != b.webhookSecret {
		log.Printf("max: webhook rejected: bad X-Max-Bot-Api-Secret")
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	var upd maxUpdate
	if err := json.NewDecoder(r.Body).Decode(&upd); err != nil {
		// Нераспознанный payload не исправится ретраями — отвечаем 200,
		// чтобы MAX не долбил нас бесконечно (см. политику retry выше).
		log.Printf("max: webhook decode failed: %v", err)
		w.WriteHeader(http.StatusOK)
		return
	}

	// MAX повторяет webhook при любом ответе, отличном от 200.
	// Сначала подтверждаем доставку, затем обрабатываем событие отдельно,
	// чтобы DB/API-вызовы не удерживали webhook HTTP-запрос.
	w.WriteHeader(http.StatusOK)
	go func(update maxUpdate) {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		b.handleUpdate(ctx, &update)
	}(upd)
}

func (b *MaxBot) handleUpdate(ctx context.Context, upd *maxUpdate) {
	switch upd.UpdateType {
	case "bot_started":
		if upd.User == nil {
			log.Printf("max: bot_started without user, ignoring")
			return
		}
		b.handleStart(ctx, upd.User.UserID, upd.User.Username)
	case "message_created":
		b.handleMessage(ctx, upd)
	case "bot_stopped", "dialog_removed":
		userID := b.senderUserID(upd)
		log.Printf("max: user %d stopped/removed dialog with bot (update_type=%s)", userID, upd.UpdateType)
	default:
		log.Printf("max: unhandled update_type=%s", upd.UpdateType)
	}
}

// senderUserID достаёт user_id инициатора события из разных мест объекта.
func (b *MaxBot) senderUserID(upd *maxUpdate) int64 {
	if upd == nil {
		return 0
	}
	if upd.User != nil && upd.User.UserID != 0 {
		return upd.User.UserID
	}
	if upd.Message != nil && upd.Message.Sender != nil {
		return upd.Message.Sender.UserID
	}
	return 0
}

// isOwnMessage — сообщение, отправленное самим ботом (MAX шлёт боту
// message_created и на его собственные сообщения — такие обрабатывать нельзя).
func (b *MaxBot) isOwnMessage(upd *maxUpdate) bool {
	if upd == nil || upd.Message == nil || upd.Message.Sender == nil {
		return false
	}
	s := upd.Message.Sender
	if s.IsBot {
		return true
	}
	if b.botUserID != 0 && s.UserID == b.botUserID {
		return true
	}
	return false
}

// handleStart — первый шаг привязки: просим ввести email (аналог
// TelegramBot.handleStart).
func (b *MaxBot) handleStart(ctx context.Context, maxUserID int64, username string) {
	text := "👋 Привет! Добро пожаловать в Study Room.\n\n" +
		"Чтобы подключить уведомления, введите email, который вы указали при регистрации в Study Room.\n\n" +
		"Это нужно для того, чтобы я знал, кому отправлять уведомления об оценках, занятиях и платежах."

	if err := b.reply(maxUserID, text); err != nil {
		log.Printf("max: send start message to user %d failed: %v", maxUserID, err)
	}
}

// handleMessage — обрабатывает входящее сообщение: собственные сообщения
// бота игнорируются, /start просит email, всё остальное трактуется как email.
func (b *MaxBot) handleMessage(ctx context.Context, upd *maxUpdate) {
	if b.isOwnMessage(upd) {
		return
	}
	if upd.Message == nil || upd.Message.Body == nil {
		return
	}

	maxUserID := b.senderUserID(upd)
	if maxUserID == 0 {
		log.Printf("max: message_created without sender user_id, ignoring")
		return
	}

	username := ""
	if s := upd.Message.Sender; s != nil {
		username = s.Username
	}

	text := strings.TrimSpace(upd.Message.Body.Text)

	log.Printf("max: received from user %d, text: %q, username: %s", maxUserID, text, username)

	// Лимит попыток на user_id — до проверки текста, чтобы резать флуд
	// любыми сообщениями (аналог telegram).
	if !b.chatLimiter.Allow(maxUserID) {
		if err := b.reply(maxUserID, "⏳ Слишком много сообщений подряд. Пожалуйста, подождите несколько минут и попробуйте снова."); err != nil {
			log.Printf("max: send rate-limit message failed: %v", err)
		}
		return
	}

	switch text {
	case "/start":
		b.handleStart(ctx, maxUserID, username)
	default:
		b.handleText(ctx, maxUserID, text, username)
	}
}

// handleText — обрабатывает email от пользователя (аналог
// TelegramBot.handleText, включая защиту от перебора email).
func (b *MaxBot) handleText(ctx context.Context, maxUserID int64, text string, username string) {
	text = strings.TrimSpace(text)

	// Простая валидация email
	if !strings.Contains(text, "@") {
		if err := b.reply(maxUserID, "⚠️ Это не похоже на email. Пожалуйста, введите ваш email, указанный при регистрации в Study Room."); err != nil {
			log.Printf("max: send error message failed: %v", err)
		}
		return
	}

	email := strings.ToLower(text)

	// Общий лимит на резолв email по всему боту (см. telegram_ratelimit.go,
	// globalRateLimiter) — MAX-аккаунты, как и Telegram-чаты, бесплатны и в
	// любом количестве, одного per-user лимита недостаточно.
	if !b.lookupLimiter.Allow() {
		if err := b.reply(maxUserID, "⏳ Сервис сейчас перегружен запросами. Попробуйте, пожалуйста, чуть позже."); err != nil {
			log.Printf("max: send lookup rate-limit message failed: %v", err)
		}
		return
	}

	log.Printf("max: searching user by email: %q", email)

	userRef, err := b.userRefRepo.GetByEmail(ctx, email)
	if err != nil || userRef == nil {
		log.Printf("max: user not found for email: %q", email)
		// Намеренно нейтральный текст без подстановки введённого email —
		// против перебора адресов (user enumeration), см. telegram_bot.go.
		if err := b.reply(maxUserID,
			"🔍 Не получилось найти аккаунт по этому email.\n\n"+
				"Проверьте, что вы вводите именно тот email, который указали при регистрации в Study Room.\n"+
				"Если уверены, что всё верно — напишите в поддержку."); err != nil {
			log.Printf("max: send not found message failed: %v", err)
		}
		return
	}

	// Проверяем, не привязан ли уже этот max_user_id
	existing, err := b.maxUserRepo.GetByMaxUserID(ctx, maxUserID)
	if err != nil {
		log.Printf("max: check existing binding failed: %v", err)
		if err := b.reply(maxUserID, "❌ Ошибка при проверке привязки. Попробуйте позже."); err != nil {
			log.Printf("max: send error message failed: %v", err)
		}
		return
	}

	// Если привязка уже есть — обновляем user_id
	if existing != nil {
		existing.UserID = userRef.ID
		existing.MaxUsername = username
		existing.UpdatedAt = time.Now()
		if err := b.maxUserRepo.Upsert(ctx, existing); err != nil {
			log.Printf("max: update binding failed: %v", err)
		}
	} else {
		// Создаём новую привязку
		mu := &models.MaxUser{
			MaxUserID:   maxUserID,
			MaxUsername: username,
			UserID:      userRef.ID,
		}
		if err := b.maxUserRepo.Upsert(ctx, mu); err != nil {
			log.Printf("max: create binding failed: %v", err)
			if err := b.reply(maxUserID, "❌ Ошибка при привязке MAX к аккаунту. Попробуйте позже."); err != nil {
				log.Printf("max: send error message failed: %v", err)
			}
			return
		}
	}

	// Обновляем max_id в users_ref
	userRef.MaxID = strconv.FormatInt(maxUserID, 10)
	if err := b.userRefRepo.Upsert(ctx, userRef); err != nil {
		log.Printf("max: update user_ref failed: %v", err)
	}

	// Включаем max_enabled в настройках уведомлений — без этого привязка
	// ни на что не влияет (Notifier.Send проверяет settings.MaxEnabled),
	// см. аналогичный комментарий в telegram_bot.go.
	if b.settingsRepo != nil {
		currentSettings, err := b.settingsRepo.GetOrDefault(ctx, userRef.ID)
		if err != nil {
			log.Printf("max: get settings for user %d failed: %v", userRef.ID, err)
			currentSettings = &models.Settings{UserID: userRef.ID, EmailEnabled: true}
		}
		currentSettings.UserID = userRef.ID
		currentSettings.MaxEnabled = true
		if _, err := b.settingsRepo.Upsert(ctx, currentSettings); err != nil {
			log.Printf("max: enable max_enabled for user %d failed: %v", userRef.ID, err)
		}
	}

	// Отправляем подтверждение
	displayName := ""
	if userRef.FirstName != "" || userRef.LastName != "" {
		displayName = strings.TrimSpace(userRef.FirstName + " " + userRef.LastName)
	} else {
		displayName = email
	}

	if err := b.reply(maxUserID, fmt.Sprintf("✅ Отлично! Найден аккаунт: %s\n\nУведомления через MAX подключены!", displayName)); err != nil {
		log.Printf("max: send success message failed: %v", err)
	}
}

// reply отправляет текстовое сообщение пользователю MAX по его max user_id.
func (b *MaxBot) reply(maxUserID int64, text string) error {
	return b.provider.Send(0, strconv.FormatInt(maxUserID, 10), "", text)
}
