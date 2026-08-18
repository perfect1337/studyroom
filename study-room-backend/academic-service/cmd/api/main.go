package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"studyroom/academic-service/internal/app"
	"studyroom/academic-service/internal/auth"
	"studyroom/academic-service/internal/config"
	"studyroom/academic-service/internal/db"
	"studyroom/academic-service/internal/events"
	"studyroom/academic-service/internal/middleware"
	"studyroom/academic-service/internal/migrate"
)

func main() {
	ctx := context.Background()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	middleware.SetAllowedOrigins(middleware.ParseAllowedOrigins(cfg.AllowedOrigins))
	if cfg.AllowedOrigins == "" {
		log.Println("ALLOWED_ORIGINS not set: browser cross-origin requests with credentials are blocked for all origins")
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
	deps := app.NewDeps(pool, tm, cfg.UserServiceURL, events.NoopPublisher{})

	// Публикатор событий (lesson.created, attendance.marked_absent) и
	// подписчик (user.*, contract.created) — оба через один NATS-коннекшн.
	// Если NATS не сконфигурирован, сервис всё равно поднимается и
	// работает через HTTP API — просто без событий (тот же паттерн, что в
	// user-service и notification-service).
	if cfg.NATSURL != "" {
		nc, err := events.Connect(cfg.NATSURL)
		if err != nil {
			log.Printf("events: could not connect to NATS at %s: %v (continuing without events)", cfg.NATSURL, err)
		} else {
			defer nc.Close()
			deps.Events = events.NewNATSPublisher(nc)

			sub := events.NewSubscriber(nc, deps.UserRefs, deps.Enrollments, deps.Courses, deps.Lessons)
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
		log.Printf("academic-service listening on :%s", cfg.Port)
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
