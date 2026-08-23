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

	// --- Мессенджеры ---
	// Telegram Bot API
	TelegramBotToken string // токен от @BotFather (например, 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)

	// MAX (MaxCore Solutions)
	MaxAPIURL    string // URL MAX API (например, https://max.example.com/api/v1)
	MaxAppToken  string // токен приложения для авторизации MAX

	// WhatsApp Cloud API (Meta)
	WhatsAppPhoneID    string // ID номера телефона из WhatsApp Business API (например, 1234567890)
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

		// Мессенджеры (не обязательны для запуска — проверяются при первой отправке)
		TelegramBotToken:    getEnv("TELEGRAM_BOT_TOKEN", ""),
		MaxAPIURL:           getEnv("MAX_API_URL", ""),
		MaxAppToken:         getEnv("MAX_APP_TOKEN", ""),
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
