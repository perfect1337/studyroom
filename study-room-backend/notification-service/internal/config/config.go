package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port        string
	DatabaseURL string

	// JWTSecret — тот же секрет, что у User Service: подпись токена
	// проверяется локально, без похода в User Service на каждый запрос.
	JWTSecret string

	// ServiceToken — отдельный service-to-service токен для
	// POST /internal/notifications/send и POST /internal/users/sync.
	// Не пользовательский JWT, вызывается только другими сервисами.
	ServiceToken string

	// --- SMTP (Яндекс.Почта) ---
	// Яндекс: smtp.yandex.ru, порт 465 (SSL/implicit TLS) либо 587 (STARTTLS).
	// SMTPUser/SMTPPassword — логин (полный email) и пароль приложения,
	// сгенерированный в настройках Яндекс ID (обычный пароль от почты не подойдёт,
	// если включена двухфакторная аутентификация).
	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
	SMTPFrom     string // "Study Room <no-reply@yourdomain.ru>" или просто email

	// SMTPBatchHourlyLimit — сколько писем в час разрешено потратить на
	// "пачечные" уведомления (ежедневный дайджест занятий в 9:00 МСК и
	// напоминания об истекающих договорах, см. notifier.batchEmailNotifTypes).
	// Провайдер (mail.ru) отдаёт 500 писем/час на аккаунт — по умолчанию
	// сюда уходит 400, гарантированный запас 100 остаётся на остальные
	// уведомления (welcome/сброс пароля/новая заявка и т.д., см.
	// notifier.New). 0 — использовать значение по умолчанию (400),
	// отрицательное — отключить троттлинг вовсе.
	SMTPBatchHourlyLimit int

	// --- Мессенджеры ---
	// Telegram Bot API
	TelegramBotToken string // токен от @BotFather (например, 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)

	// MAX (MaxCore Solutions / VK) — Bot API, https://dev.max.ru
	// Токен выдаётся при создании бота (MasterBot в MAX или «MAX для
	// бизнеса» — команда «Получить токен»).
	MaxAccessToken   string // токен бота (заголовок Authorization в запросах к platform-api2.max.ru)
	MaxWebhookURL    string // публичный HTTPS URL webhook'а (например, https://mestudyroom64.ru/api/v1/notifications/max/webhook)
	MaxWebhookSecret string // секрет для заголовка X-Max-Bot-Api-Secret (5–256 символов: A-Z a-z 0-9 - _)
	MaxBotUsername   string // username бота в MAX (например, id6452127780_bot) — для ссылок на фронте

	// WhatsApp Cloud API (Meta)
	WhatsAppPhoneID     string // ID номера телефона из WhatsApp Business API (например, 1234567890)
	WhatsAppAccessToken string // access token из Meta Developer Console
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:         getEnv("PORT", "8085"),
		DatabaseURL:  getEnv("DATABASE_URL", ""),
		JWTSecret:    getEnv("JWT_SECRET", ""),
		ServiceToken: getEnv("SERVICE_TOKEN", ""),

		SMTPHost:     getEnv("SMTP_HOST", "smtp.yandex.ru"),
		SMTPPort:     getEnvInt("SMTP_PORT", 465),
		SMTPUser:     getEnv("SMTP_USER", ""),
		SMTPPassword: getEnv("SMTP_PASSWORD", ""),
		SMTPFrom:     getEnv("SMTP_FROM", ""),

		SMTPBatchHourlyLimit: getEnvInt("SMTP_BATCH_HOURLY_LIMIT", 400),

		// Мессенджеры (не обязательны для запуска — проверяются при первой отправке)
		TelegramBotToken:    getEnv("TELEGRAM_BOT_TOKEN", ""),
		MaxAccessToken:      getEnv("MAX_ACCESS_TOKEN", ""),
		MaxWebhookURL:       getEnv("MAX_WEBHOOK_URL", ""),
		MaxWebhookSecret:    getEnv("MAX_WEBHOOK_SECRET", ""),
		MaxBotUsername:      getEnv("MAX_BOT_USERNAME", ""),
		WhatsAppPhoneID:     getEnv("WHATSAPP_PHONE_NUMBER_ID", ""),
		WhatsAppAccessToken: getEnv("WHATSAPP_ACCESS_TOKEN", ""),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.JWTSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	if cfg.ServiceToken == "" {
		return nil, fmt.Errorf("SERVICE_TOKEN is required")
	}
	if cfg.SMTPUser == "" || cfg.SMTPPassword == "" {
		return nil, fmt.Errorf("SMTP_USER and SMTP_PASSWORD are required (Яндекс: логин — полный email, пароль — пароль приложения)")
	}
	if cfg.SMTPFrom == "" {
		cfg.SMTPFrom = cfg.SMTPUser
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
