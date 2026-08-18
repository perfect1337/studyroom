package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port        string
	DatabaseURL string

	// JWTSecret — тот же секрет, что у User Service: подпись токена
	// проверяется локально, без похода в User Service на каждый запрос
	// (см. microservices-plan.md, 2.2).
	JWTSecret string

	// NATSURL — брокер событий. Не обязателен: если пуст, сервис поднимается
	// и работает через HTTP API, просто без подписки на user.* и без
	// публикации application.received (см. main.go).
	NATSURL string

	// TildaWebhookSecret — секрет для проверки подписи вебхука Tilda
	// (заголовок X-Tilda-Signature, см. api-contracts.md 4.1). Если пуст —
	// проверка подписи пропускается (только для локальной разработки,
	// НЕ для продакшена — см. handlers/application_handler.go).
	TildaWebhookSecret string

	// AllowedOrigins — список origin'ов (через запятую), которым разрешён
	// CORS с credentials (см. internal/middleware/cors.go). По умолчанию
	// пусто — браузерные cross-origin запросы с credentials заблокированы
	// для всех origin'ов. Для локальной разработки укажите адрес фронтенда,
	// например "http://localhost:5173,http://localhost:3000".
	AllowedOrigins string
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:               getEnv("PORT", "8084"),
		DatabaseURL:        getEnv("DATABASE_URL", ""),
		JWTSecret:          getEnv("JWT_SECRET", ""),
		NATSURL:            getEnv("NATS_URL", ""),
		TildaWebhookSecret: getEnv("TILDA_WEBHOOK_SECRET", ""),
		AllowedOrigins:     getEnv("ALLOWED_ORIGINS", ""),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.JWTSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
