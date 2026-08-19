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
	// и работает через HTTP API, просто без подписки на user.*/contract.created
	// и без публикации lesson.created/attendance.marked_absent (см. main.go).
	NATSURL string

	// UserServiceURL — используется только для одного синхронного случая:
	// проверить, что вызывающий-parent действительно родитель конкретного
	// ученика (GET /parents/{id}/children), когда список детей нужен "здесь
	// и сейчас" для фильтрации записей/занятий/домашки — см.
	// microservices-plan.md, 2.1. Everything else uses the local user_refs cache.
	UserServiceURL string
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:           getEnv("PORT", "8082"),
		DatabaseURL:    getEnv("DATABASE_URL", ""),
		JWTSecret:      getEnv("JWT_SECRET", ""),
		NATSURL:        getEnv("NATS_URL", ""),
		UserServiceURL: getEnv("USER_SERVICE_URL", "http://user-service:8081"),
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
