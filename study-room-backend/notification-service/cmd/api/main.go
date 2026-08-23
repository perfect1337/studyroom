package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"studyroom/notification-service/internal/app"
	"studyroom/notification-service/internal/auth"
	"studyroom/notification-service/internal/config"
	"studyroom/notification-service/internal/db"
	"studyroom/notification-service/internal/events"
	"studyroom/notification-service/internal/mailer"
	"studyroom/notification-service/internal/messenger"
	"studyroom/notification-service/internal/migrate"
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

	mail := mailer.New(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPFrom)
	tm := auth.NewTokenManager(cfg.JWTSecret)
	messengerCfg := messenger.Config{
		TelegramBotToken:    cfg.TelegramBotToken,
		MaxAPIURL:           cfg.MaxAPIURL,
		MaxAppToken:         cfg.MaxAppToken,
		WhatsAppPhoneID:     cfg.WhatsAppPhoneID,
		WhatsAppAccessToken: cfg.WhatsAppAccessToken,
	}
	factory := messenger.NewFactory(messengerCfg)
	deps := app.NewDeps(pool, tm, cfg.ServiceToken, mail, factory)

	// Подписка на NATS — best effort. Если брокер недоступен при старте,
	// сервис всё равно поднимается и работает через HTTP API.
	if natsURL := os.Getenv("NATS_URL"); natsURL != "" {
		nc, err := events.Connect(natsURL)
		if err != nil {
			log.Printf("events: could not connect to NATS at %s: %v (continuing without event subscription)", natsURL, err)
		} else {
			defer nc.Close()
			sub := events.NewSubscriber(nc, deps.Notifier, deps.UsersRef)
			if err := sub.Start(ctx); err != nil {
				log.Printf("events: subscribe failed: %v", err)
			}
		}
	} else {
		log.Println("events: NATS_URL not set, skipping event subscription")
	}

	r := app.NewRouter(deps)
	srv := app.NewServer(":"+cfg.Port, r)

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
