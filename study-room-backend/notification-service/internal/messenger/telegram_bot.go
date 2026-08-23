package messenger

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"

	"studyroom/notification-service/internal/models"
	"studyroom/notification-service/internal/repository"
)

// TelegramBot — Telegram Bot с polling-обработчиком входящих сообщений.
// Обрабатывает /start для привязки пользователя к Telegram chat_id.
type TelegramBot struct {
	bot            *tgbotapi.BotAPI
	token          string
	userRefRepo      *repository.UserRefRepository
	telegramUserRepo *repository.TelegramUserRepository
	botName        string
	stopCh         chan struct{}
}

// NewTelegramBot создаёт бота без запуска polling.
func NewTelegramBot(token string, userRefRepo *repository.UserRefRepository, telegramUserRepo *repository.TelegramUserRepository) (*TelegramBot, error) {
	bot, err := tgbotapi.NewBotAPI(token)
	if err != nil {
		return nil, fmt.Errorf("telegram bot init: %w", err)
	}

	bot.Debug = false
	log.Println("telegram: bot initialized successfully")
	return &TelegramBot{
		bot:              bot,
		token:            token,
		userRefRepo:      userRefRepo,
		telegramUserRepo: telegramUserRepo,
		botName:          "StudyRoomNotificationBot",
		stopCh:           make(chan struct{}),
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

	if _, err := b.bot.Send(msg); err != nil {
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
		if _, err := b.bot.Send(msg); err != nil {
			log.Printf("telegram: send error message failed: %v", err)
		}
		return
	}

	email := strings.ToLower(text)

	log.Printf("telegram: searching user by email: %q", email)

	// Ищем user по email
	userRef, err := b.userRefRepo.GetByEmail(ctx, email)
	if err != nil || userRef == nil {
		log.Printf("telegram: user not found for email: %q", email)
		msg := tgbotapi.NewMessage(chatID,
			fmt.Sprintf("🔍 Пользователь с email `%s` не найден в системе.\n\n"+
				"Проверьте, что вы вводите именно тот email, который указали при регистрации.\n"+
				"Если уверены, что email правильный — напишите в поддержку.", email))
		if _, err := b.bot.Send(msg); err != nil {
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
		if _, err := b.bot.Send(msg); err != nil {
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
			if _, err := b.bot.Send(msg); err != nil {
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

	// Отправляем подтверждение
	displayName := ""
	if userRef.FirstName != "" || userRef.LastName != "" {
		displayName = userRef.FirstName + " " + userRef.LastName
	} else {
		displayName = email
	}

	msg := tgbotapi.NewMessage(chatID,
		fmt.Sprintf("✅ Отлично! Найдён аккаунт: %s\n\nУведомления через Telegram подключены!", displayName))

	if _, err := b.bot.Send(msg); err != nil {
		log.Printf("telegram: send success message failed: %v", err)
	}
}

// Stop останавливает polling.
func (b *TelegramBot) Stop() {
	close(b.stopCh)
}
