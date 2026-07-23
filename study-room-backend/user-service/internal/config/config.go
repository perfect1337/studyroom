package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port            string
	DatabaseURL     string
	JWTSecret       string
	NATSURL         string // опционально: без него события не публикуются
	AppPublicURL    string // база для ссылок в письмах (reset-password)
	AccessTokenTTL  int    // минут
	RefreshTokenTTL int    // дней
	AuthRateLimit   int    // запросов/минуту на IP к /auth/* (по умолчанию 200)
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:            getEnv("PORT", "8081"),
		DatabaseURL:     getEnv("DATABASE_URL", ""),
		JWTSecret:       getEnv("JWT_SECRET", ""),
		NATSURL:         getEnv("NATS_URL", ""),
		AppPublicURL:    getEnv("APP_PUBLIC_URL", "http://localhost:3000"),
		AccessTokenTTL:  15,
		RefreshTokenTTL: 30,
		AuthRateLimit:   getEnvInt("AUTH_RATE_LIMIT_PER_MIN", 200),
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

func getEnvInt(key string, fallback int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
