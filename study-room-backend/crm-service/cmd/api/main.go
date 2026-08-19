package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"studyroom/crm-service/internal/app"
	"studyroom/crm-service/internal/auth"
	"studyroom/crm-service/internal/config"
	"studyroom/crm-service/internal/db"
	"studyroom/crm-service/internal/events"
	"studyroom/crm-service/internal/migrate"
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

	tm := auth.NewTokenManager(cfg.JWTSecret)
	deps := app.NewDeps(pool, tm, cfg.TildaWebhookSecret, events.NoopPublisher{})

	// Публикатор события application.received и подписчик на user.* — оба
	// через один NATS-коннекшн. Если NATS не сконфигурирован, сервис всё
	// равно поднимается и работает через HTTP API — просто без событий
	// (тот же паттерн, что в user-service/academic-service/notification-service).
	if cfg.NATSURL != "" {
		nc, err := events.Connect(cfg.NATSURL)
		if err != nil {
			log.Printf("events: could not connect to NATS at %s: %v (continuing without events)", cfg.NATSURL, err)
		} else {
			defer nc.Close()
			deps.Events = events.NewNATSPublisher(nc)

			sub := events.NewSubscriber(nc, deps.UserRefs)
			if err := sub.Start(ctx); err != nil {
				log.Printf("events: subscribe failed: %v", err)
			}
		}
	} else {
		log.Println("events: NATS_URL not set, skipping event subscription")
	}

	if cfg.TildaWebhookSecret == "" {
		log.Println("WARNING: TILDA_WEBHOOK_SECRET is not set — webhook signature check is DISABLED, do not run like this in production")
	}

	r := app.NewRouter(deps)
	srv := app.NewServer(":"+cfg.Port, r)

	go func() {
		log.Printf("crm-service listening on :%s", cfg.Port)
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
