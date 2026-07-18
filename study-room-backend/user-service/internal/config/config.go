package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port            string
	DatabaseURL     string
	JWTSecret       string
	NATSURL         string // опционально: без него события не публикуются
	AppPublicURL    string // база для ссылок в письмах (reset-password)
	AccessTokenTTL  int    // минут
	RefreshTokenTTL int    // дней
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
