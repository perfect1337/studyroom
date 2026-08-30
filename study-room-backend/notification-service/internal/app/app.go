// Package app собирает зависимости и HTTP-роутер сервиса в одном месте.
// Вынесено из cmd/api/main.go, чтобы контрактные тесты (tests/contracts)
// могли поднять тот же самый роутер поверх httptest, без реального
// запущенного сервера — см. user-service/internal/app для того же паттерна.
package app

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"studyroom/notification-service/internal/auth"
	"studyroom/notification-service/internal/handlers"
	"studyroom/notification-service/internal/mailer"
	"studyroom/notification-service/internal/messenger"
	"studyroom/notification-service/internal/middleware"
	"studyroom/notification-service/internal/notifier"
	"studyroom/notification-service/internal/openapi"
	"studyroom/notification-service/internal/repository"
)

// Deps — все зависимости, нужные роутеру и подписчику на события NATS.
type Deps struct {
	Pool *pgxpool.Pool

	Notifications *repository.NotificationRepository
	Settings      *repository.SettingsRepository
	UsersRef      *repository.UserRefRepository
	TelegramUser  *repository.TelegramUserRepository

	Notifier     *notifier.Notifier
	TokenManager *auth.TokenManager
	ServiceToken string
}

// NewDeps собирает Deps из пула соединений и внешних зависимостей.
// mail — mailer.Sender, чтобы в тестах можно было подставить фейковый отправитель
// вместо реального SMTP.
// factory — messenger.Factory для отправки через мессенджеры.
func NewDeps(pool *pgxpool.Pool, tm *auth.TokenManager, serviceToken string, mail mailer.Sender, factory *messenger.Factory) *Deps {
	notificationsRepo := repository.NewNotificationRepository(pool)
	settingsRepo := repository.NewSettingsRepository(pool)
	usersRefRepo := repository.NewUserRefRepository(pool)
	telegramUserRepo := repository.NewTelegramUserRepository(pool)

	return &Deps{
		Pool:           pool,
		Notifications:  notificationsRepo,
		Settings:       settingsRepo,
		UsersRef:       usersRefRepo,
		TelegramUser:   telegramUserRepo,
		Notifier:       notifier.New(notificationsRepo, settingsRepo, usersRefRepo, mail, factory),
		TokenManager:   tm,
		ServiceToken:   serviceToken,
	}
}

// NewRouter строит chi.Router со всеми эндпоинтами сервиса — идентично тому,
// что раньше строилось прямо в main().
func NewRouter(d *Deps) http.Handler {
	notificationHandler := handlers.NewNotificationHandler(d.Notifications, d.Settings, d.TelegramUser, d.UsersRef)
	internalHandler := handlers.NewInternalHandler(d.Notifier, d.UsersRef)

	r := chi.NewRouter()
	// Recoverer — первым, чтобы ловить паники даже из middleware ниже
	// по цепочке (см. internal/middleware/recover.go).
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(middleware.Logging)
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Get("/openapi.yaml", openapi.SpecHandler)
	r.Get("/docs", openapi.DocsHandler)

	r.Route("/api/v1", func(r chi.Router) {
		// --- Требуют пользовательской авторизации ---
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireAuth(d.TokenManager))

			r.Get("/notifications", notificationHandler.List)
			r.Patch("/notifications/{id}/read", notificationHandler.MarkRead)
			r.Get("/notifications/settings", notificationHandler.GetSettings)
			r.Patch("/notifications/settings", notificationHandler.UpdateSettings)
			r.Get("/notifications/telegram/status", notificationHandler.GetTelegramStatus)
			r.Delete("/notifications/telegram/link", notificationHandler.UnlinkTelegram)
		})

		// --- Только service-to-service (X-Service-Token) ---
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireServiceToken(d.ServiceToken))

			r.Post("/internal/notifications/send", internalHandler.Send)
			r.Post("/internal/users/sync", internalHandler.SyncUser)
		})
	})

	return r
}

// NewServer — небольшой хелпер для main(), чтобы не тащить net/http туда напрямую
// сверх необходимого.
func NewServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:         addr,
		Handler:      handler,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}
}
