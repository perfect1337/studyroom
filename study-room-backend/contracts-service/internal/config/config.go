package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port        string
	DatabaseURL string
	JWTSecret   string

	// NATSURL — брокер событий. Не обязателен: если пуст, сервис поднимается
	// и работает через HTTP API, просто без подписки на user.* и без
	// публикации contract.*.
	NATSURL string

	// UserServiceURL — единственный синхронный HTTP-вызов Contracts Service:
	// GET /parents/{id}/children для GET /contracts/{id}/expiry с role=parent
	// (см. api-contracts.md, 3.3a и internal/userclient).
	UserServiceURL string
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:           getEnv("PORT", "8083"),
		DatabaseURL:    getEnv("DATABASE_URL", ""),
		JWTSecret:      getEnv("JWT_SECRET", ""),
		NATSURL:        getEnv("NATS_URL", ""),
		UserServiceURL: getEnv("USER_SERVICE_URL", ""),
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
