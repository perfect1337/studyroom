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

	// TrustedProxies — список CIDR/IP реверс-прокси (через запятую), которым
	// разрешено доверять заголовку X-Forwarded-For при определении реального
	// IP клиента (используется в rate limit на /auth/* и в аудит-логах).
	// По умолчанию пусто — значит X-Forwarded-For игнорируется полностью и
	// используется реальный TCP-адрес пира. Если сервис стоит за nginx/ingress,
	// сюда нужно явно передать его адрес (например "10.0.0.0/8"), иначе
	// клиент, слав произвольный X-Forwarded-For, обходит rate limit.
	TrustedProxies string

	// Cookie с refresh-токеном (см. internal/handlers/cookies.go)
	// Refresh-токен больше не возвращается в JSON-теле ответа (уязвим к XSS
	// через localStorage), а кладётся в httpOnly cookie — недоступен из JS.
	CookieSecure   bool   // Secure-флаг; в проде за HTTPS держите true (по умолчанию)
	CookieSameSite string // "Lax" (дефолт, работает и для localhost:5173 -> localhost:8081,
	// т.к. порт не влияет на "site"), "None" (для полностью разных доменов,
	// требует CookieSecure=true) или "Strict"
	CookieDomain string // опционально, например ".studyroom.example.com"
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
		TrustedProxies:  getEnv("TRUSTED_PROXIES", ""),
		CookieSecure:    getEnvBool("COOKIE_SECURE", true),
		CookieSameSite:  getEnv("COOKIE_SAMESITE", "Lax"),
		CookieDomain:    getEnv("COOKIE_DOMAIN", ""),
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

func getEnvBool(key string, fallback bool) bool {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}
