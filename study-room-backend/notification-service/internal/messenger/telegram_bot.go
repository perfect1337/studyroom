package messenger

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"

	"studyroom/notification-service/internal/models"
	"studyroom/notification-service/internal/repository"
)

// TelegramBot — Telegram Bot с polling-обработчиком входящих сообщений.
// Обрабатывает /start для привязки пользователя к Telegram chat_id.
type TelegramBot struct {
	bot              *tgbotapi.BotAPI
	token            string
	userRefRepo      *repository.UserRefRepository
	telegramUserRepo *repository.TelegramUserRepository
	settingsRepo     *repository.SettingsRepository
	botName          string
	stopCh           chan struct{}

	// chatLimiter — не более 5 попыток ввести email за 5 минут с одного
	// chat_id. Защита от перебора email (кто-то методично присылает боту
	// email за email, пытаясь понять, кто зарегистрирован в системе) и от
	// простого спама командами.
	chatLimiter *chatRateLimiter

	// lookupLimiter — общий потолок в 60 попыток резолва email/минуту на
	// весь бот, вне зависимости от chat_id (см. комментарий в
	// telegram_ratelimit.go — Telegram-чаты бесплатны и их можно наплодить
	// сколько угодно, per-chat лимита одного недостаточно).
	lookupLimiter *globalRateLimiter
	rateLimiter   *RateLimiter
}

// NewTelegramBot создаёт бота без запуска polling с retry при ошибке.
func NewTelegramBot(token string, userRefRepo *repository.UserRefRepository, telegramUserRepo *repository.TelegramUserRepository, settingsRepo *repository.SettingsRepository, sharedLimiters ...*RateLimiter) (*TelegramBot, error) {
	var bot *tgbotapi.BotAPI
	var err error

	// Retry loop — Telegram API может быть временно недоступен при старте
	for attempt := 0; attempt < 5; attempt++ {
		bot, err = tgbotapi.NewBotAPI(token)
		if err == nil {
			break
		}
		if attempt < 4 {
			log.Printf("telegram: bot init attempt %d/%d failed: %v, retrying in 3s...", attempt+1, 5, err)
			time.Sleep(3 * time.Second)
		}
	}
	if err != nil {
		return nil, fmt.Errorf("telegram bot init: %w", err)
	}

	// Проверка соединения — getMe
	var me tgbotapi.User
	for attempt := 0; attempt < 5; attempt++ {
		me, err = bot.GetMe()
		if err == nil {
			break
		}
		if attempt < 4 {
			log.Printf("telegram: getMe attempt %d/%d failed: %v, retrying in 3s...", attempt+1, 5, err)
			time.Sleep(3 * time.Second)
		}
	}
	if err != nil {
		return nil, fmt.Errorf("telegram bot getMe: %w", err)
	}

	rateLimiter := NewRateLimiter(providerGlobalRate, telegramPerChatRate)
	if len(sharedLimiters) > 0 && sharedLimiters[0] != nil {
		rateLimiter = sharedLimiters[0]
	}
	log.Printf("telegram: bot initialized successfully as @%s (chat_id=%d)", me.UserName, me.ID)
	return &TelegramBot{
		bot:              bot,
		token:            token,
		userRefRepo:      userRefRepo,
		telegramUserRepo: telegramUserRepo,
		settingsRepo:     settingsRepo,
		botName:          me.UserName,
		stopCh:           make(chan struct{}),
		chatLimiter:      newChatRateLimiter(5, 5*time.Minute, 5000),
		lookupLimiter:    newGlobalRateLimiter(60, time.Minute),
		rateLimiter:      rateLimiter,
	}, nil
}

// StartPolling запускает long-polling в горутине.
func (b *TelegramBot) StartPolling(ctx context.Context) {
	go b.poll(ctx)
}

func (b *TelegramBot) poll(ctx context.Context) {
	u := tgbotapi.NewUpdate(0)
	u.Timeout = 5
	updates := b.bot.GetUpdatesChan(u)

	log.Println("telegram: polling started")
	for {
		select {
		case <-ctx.Done():
			log.Println("telegram: polling stopped (context cancelled)")
			return
		case <-b.stopCh:
			log.Println("telegram: polling stopped (manual)")
			return
		case tgUpdate, ok := <-updates:
			if !ok {
				log.Println("telegram: update channel closed, restarting polling")
				time.Sleep(1 * time.Second)
				continue
			}
			go b.handleUpdate(ctx, tgUpdate)
		}
	}
}

func (b *TelegramBot) handleUpdate(ctx context.Context, update tgbotapi.Update) {
	if update.Message == nil {
		return
	}

	msg := *update.Message
	chatID := int64(msg.Chat.ID)
	text := strings.TrimSpace(msg.Text)
	username := ""
	if msg.From != nil {
		username = msg.From.UserName
	}

	log.Printf("telegram: received from chat %d, text: %q, username: %s", chatID, text, username)

	// Лимит попыток на chat_id — до проверки текста, чтобы резать флуд
	// любыми сообщениями, а не только валидными email.
	if !b.chatLimiter.Allow(chatID) {
		msg := tgbotapi.NewMessage(chatID,
			"⏳ Слишком много сообщений подряд. Пожалуйста, подождите несколько минут и попробуйте снова.")
		if _, err := b.sendMessage(msg); err != nil {
			log.Printf("telegram: send rate-limit message failed: %v", err)
		}
		return
	}

	switch text {
	case "/start":
		b.handleStart(ctx, chatID, username)
	default:
		// Если пользователь уже привязан — можно расширять логику
		// Если нет — просим ввести email
		b.handleText(ctx, chatID, text, username)
	}
}

// handleStart — первый шаг привязки: просим ввести email.
func (b *TelegramBot) handleStart(ctx context.Context, chatID int64, username string) {
	msg := tgbotapi.NewMessage(chatID,
		"👋 Привет! Добро пожаловать в Study Room.\n\n"+
			"Чтобы подключить уведомления, введите email, который вы указали при регистрации в Study Room.\n\n"+
			"Это нужно для того, чтобы я знал, кому отправлять уведомления об оценках, занятиях и платежах.")

	if _, err := b.sendMessage(msg); err != nil {
		log.Printf("telegram: send start message failed: %v", err)
	}
}

// handleText — обрабатывает email от пользователя.
func (b *TelegramBot) handleText(ctx context.Context, chatID int64, text string, username string) {
	text = strings.TrimSpace(text)
	// Простая валидация email
	if !strings.Contains(text, "@") {
		msg := tgbotapi.NewMessage(chatID,
			"⚠️ Это не похоже на email. Пожалуйста, введите ваш email, указанный при регистрации в Study Room.")
		if _, err := b.sendMessage(msg); err != nil {
			log.Printf("telegram: send error message failed: %v", err)
		}
		return
	}

	email := strings.ToLower(text)

	// Общий лимит на резолв email по всему боту — отдельно от per-chat
	// лимита выше, т.к. Telegram-чаты создаются бесплатно и в любом
	// количестве: одного лимита на chat_id недостаточно, чтобы помешать
	// массовому перебору email через много разных чатов (см.
	// telegram_ratelimit.go, globalRateLimiter).
	if !b.lookupLimiter.Allow() {
		msg := tgbotapi.NewMessage(chatID,
			"⏳ Сервис сейчас перегружен запросами. Попробуйте, пожалуйста, чуть позже.")
		if _, err := b.sendMessage(msg); err != nil {
			log.Printf("telegram: send lookup rate-limit message failed: %v", err)
		}
		return
	}

	log.Printf("telegram: searching user by email: %q", email)

	// Ищем user по email
	userRef, err := b.userRefRepo.GetByEmail(ctx, email)
	if err != nil || userRef == nil {
		log.Printf("telegram: user not found for email: %q", email)
		// Намеренно нейтральный текст без подстановки введённого email
		// обратно в сообщение: раньше ответ содержал сам email и прямо
		// сообщал "не найден", что позволяло перебором email вычислять,
		// какие адреса зарегистрированы в системе (user enumeration).
		msg := tgbotapi.NewMessage(chatID,
			"🔍 Не получилось найти аккаунт по этому email.\n\n"+
				"Проверьте, что вы вводите именно тот email, который указали при регистрации в Study Room.\n"+
				"Если уверены, что всё верно — напишите в поддержку.")
		if _, err := b.sendMessage(msg); err != nil {
			log.Printf("telegram: send not found message failed: %v", err)
		}
		return
	}

	// Проверяем, не привязан ли уже этот chat_id
	existing, err := b.telegramUserRepo.GetByChatID(ctx, chatID)
	if err != nil {
		log.Printf("telegram: check existing binding failed: %v", err)
		msg := tgbotapi.NewMessage(chatID,
			"❌ Ошибка при проверке привязки. Попробуйте позже.")
		if _, err := b.sendMessage(msg); err != nil {
			log.Printf("telegram: send error message failed: %v", err)
		}
		return
	}

	// Если привязка уже есть — обновляем user_id
	if existing != nil {
		// Обновляем запись
		existing.UserID = userRef.ID
		existing.TelegramUsername = username
		existing.UpdatedAt = time.Now()
		if err := b.telegramUserRepo.Upsert(ctx, existing); err != nil {
			log.Printf("telegram: update binding failed: %v", err)
		}
	} else {
		// Создаём новую привязку
		tu := &models.TelegramUser{
			TelegramChatID:   chatID,
			TelegramUsername: username,
			UserID:           userRef.ID,
		}
		if err := b.telegramUserRepo.Upsert(ctx, tu); err != nil {
			log.Printf("telegram: create binding failed: %v", err)
			msg := tgbotapi.NewMessage(chatID,
				"❌ Ошибка при привязке Telegram к аккаунту. Попробуйте позже.")
			if _, err := b.sendMessage(msg); err != nil {
				log.Printf("telegram: send error message failed: %v", err)
			}
			return
		}
	}

	// Обновляем telegram_id в users_ref
	userRef.TelegramID = fmt.Sprintf("%d", chatID)
	if err := b.userRefRepo.Upsert(ctx, userRef); err != nil {
		log.Printf("telegram: update user_ref failed: %v", err)
	}

	// Включаем telegram_enabled в настройках уведомлений — без этого сама
	// привязка chat_id ни на что не влияет: Notifier.Send отправляет в
	// Telegram только когда settings.TelegramEnabled == true (см.
	// internal/notifier/notifier.go), а этот флаг живёт отдельно от
	// telegram_id/telegram_users и раньше нигде не включался при успешной
	// привязке через бота — только вручную через PATCH /notifications/settings
	// на фронте. Из-за этого пользователь видел "Уведомления через Telegram
	// подключены!" от бота, но реально ничего не приходило, пока он отдельно
	// не заходил в настройки и не включал тумблер Telegram руками. Симметрично
	// UnlinkTelegram, который выключает этот же флаг при отвязке (см.
	// notification_handler.go).
	if b.settingsRepo != nil {
		currentSettings, err := b.settingsRepo.GetOrDefault(ctx, userRef.ID)
		if err != nil {
			log.Printf("telegram: get settings for user %d failed: %v", userRef.ID, err)
			currentSettings = &models.Settings{UserID: userRef.ID, EmailEnabled: true}
		}
		currentSettings.UserID = userRef.ID
		currentSettings.TelegramEnabled = true
		if _, err := b.settingsRepo.Upsert(ctx, currentSettings); err != nil {
			log.Printf("telegram: enable telegram_enabled for user %d failed: %v", userRef.ID, err)
		}
	}

	// Отправляем подтверждение
	displayName := ""
	if userRef.FirstName != "" || userRef.LastName != "" {
		displayName = userRef.FirstName + " " + userRef.LastName
	} else {
		displayName = email
	}

	msg := tgbotapi.NewMessage(chatID,
		fmt.Sprintf("✅ Отлично! Найдён аккаунт: %s\n\nУведомления через Telegram подключены!", displayName))

	if _, err := b.sendMessage(msg); err != nil {
		log.Printf("telegram: send success message failed: %v", err)
	}
}

func (b *TelegramBot) sendMessage(msg tgbotapi.Chattable) (tgbotapi.Message, error) {
	if msg == nil {
		return tgbotapi.Message{}, fmt.Errorf("telegram: nil message")
	}
	// Для входящих команд используем тот же общий лимитер, что и массовая
	// рассылка через Factory, чтобы ответы бота тоже не выбили общий лимит.
	var key string
	if m, ok := msg.(tgbotapi.MessageConfig); ok {
		key = strconv.FormatInt(m.ChatID, 10)
	}
	if b.rateLimiter != nil {
		if err := b.rateLimiter.Wait(context.Background(), key); err != nil {
			return tgbotapi.Message{}, err
		}
	}
	return b.bot.Send(msg)
}

// Stop останавливает polling.
func (b *TelegramBot) Stop() {
	close(b.stopCh)
}
