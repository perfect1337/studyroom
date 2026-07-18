package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"studyroom/notification-service/internal/auth"
	"studyroom/notification-service/internal/config"
	"studyroom/notification-service/internal/db"
	"studyroom/notification-service/internal/events"
	"studyroom/notification-service/internal/handlers"
	"studyroom/notification-service/internal/mailer"
	"studyroom/notification-service/internal/middleware"
	"studyroom/notification-service/internal/migrate"
	"studyroom/notification-service/internal/notifier"
	"studyroom/notification-service/internal/repository"
)

func main() {
	ctx := context.Background()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connection error: %v", err)
	}
	defer pool.Close()

	// Миграции применяются автоматически при каждом старте контейнера.
	if err := migrate.Run(ctx, pool); err != nil {
		log.Fatalf("migration error: %v", err)
	}
	log.Println("migrations up to date")

	notificationRepo := repository.NewNotificationRepository(pool)
	settingsRepo := repository.NewSettingsRepository(pool)
	usersRefRepo := repository.NewUserRefRepository(pool)

	mail := mailer.New(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPFrom)
	notify := notifier.New(notificationRepo, settingsRepo, usersRefRepo, mail)

	tm := auth.NewTokenManager(cfg.JWTSecret)

	notificationHandler := handlers.NewNotificationHandler(notificationRepo, settingsRepo)
	internalHandler := handlers.NewInternalHandler(notify, usersRefRepo)

	// Подписка на NATS — best effort. Если брокер недоступен при старте,
	// сервис всё равно поднимается и работает через HTTP API.
	if natsURL := os.Getenv("NATS_URL"); natsURL != "" {
		nc, err := events.Connect(natsURL)
		if err != nil {
			log.Printf("events: could not connect to NATS at %s: %v (continuing without event subscription)", natsURL, err)
		} else {
			defer nc.Close()
			sub := events.NewSubscriber(nc, notify, usersRefRepo)
			if err := sub.Start(ctx); err != nil {
				log.Printf("events: subscribe failed: %v", err)
			}
		}
	} else {
		log.Println("events: NATS_URL not set, skipping event subscription")
	}

	r := chi.NewRouter()
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	r.Route("/api/v1", func(r chi.Router) {
		// --- Требуют пользовательской авторизации ---
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireAuth(tm))

			r.Get("/notifications", notificationHandler.List)
			r.Patch("/notifications/{id}/read", notificationHandler.MarkRead)
			r.Get("/notifications/settings", notificationHandler.GetSettings)
			r.Patch("/notifications/settings", notificationHandler.UpdateSettings)
		})

		// --- Только service-to-service (X-Service-Token) ---
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireServiceToken(cfg.ServiceToken))

			r.Post("/internal/notifications/send", internalHandler.Send)
			r.Post("/internal/users/sync", internalHandler.SyncUser)
		})
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("notification-service listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Graceful shutdown — чтобы docker compose down не рвал соединения грубо.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
}
