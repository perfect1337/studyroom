package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"studyroom/contracts-service/internal/app"
	"studyroom/contracts-service/internal/auth"
	"studyroom/contracts-service/internal/config"
	"studyroom/contracts-service/internal/db"
	"studyroom/contracts-service/internal/events"
	"studyroom/contracts-service/internal/migrate"
)

// expiringSoonWithinDays — за сколько дней до окончания договора публиковать
// contract.expiring_soon. Значение и сам механизм периодической проверки не
// описаны в api-contracts.md/event-schema.md — см. README.md.
const expiringSoonWithinDays = 5
const expiringSoonCheckInterval = 24 * time.Hours

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

	if err := migrate.Run(ctx, pool); err != nil {
		log.Fatalf("migration error: %v", err)
	}
	log.Println("migrations up to date")

	tm := auth.NewTokenManager(cfg.JWTSecret)
	deps := app.NewDeps(pool, tm, cfg.UserServiceURL, events.NoopPublisher{})

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

			stopExpiryJob := startExpiringSoonJob(ctx, deps)
			defer stopExpiryJob()
		}
	} else {
		log.Println("events: NATS_URL not set, skipping event subscription and contract.expiring_soon job")
	}

	if cfg.UserServiceURL == "" {
		log.Println("WARNING: USER_SERVICE_URL is not set — GET /contracts/{id}/expiry for role=parent will fail (403/502)")
	}

	r := app.NewRouter(deps)
	srv := app.NewServer(":"+cfg.Port, r)

	go func() {
		log.Printf("contracts-service listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
}

// startExpiringSoonJob — раз в expiringSoonCheckInterval публикует
// contract.expiring_soon для договоров, у которых end_date наступает в
// ближайшие expiringSoonWithinDays дней (см.
// internal/repository.ContractRepository.ListExpiringSoon). Получатель —
// parent_id самого договора (он уже указан при создании, отдельный
// синхронный запрос в User Service не нужен).
func startExpiringSoonJob(ctx context.Context, deps *app.Deps) func() {
	ticker := time.NewTicker(expiringSoonCheckInterval)
	done := make(chan struct{})

	go func() {
		// Первая проверка сразу при старте, не через сутки.
		checkExpiringSoon(ctx, deps)
		for {
			select {
			case <-ticker.C:
				checkExpiringSoon(ctx, deps)
			case <-done:
				return
			}
		}
	}()

	return func() {
		ticker.Stop()
		close(done)
	}
}

func checkExpiringSoon(ctx context.Context, deps *app.Deps) {
	contracts, err := deps.Contracts.ListExpiringSoon(ctx, expiringSoonWithinDays)
	if err != nil {
		log.Printf("[expiring-soon-job] list error: %v", err)
		return
	}
	for _, c := range contracts {
		deps.Events.ContractExpiringSoon(c.ParentID, c.StudentID, c.ContractNumber, c.EndDate.Format("2006-01-02"))
		if err := deps.Contracts.MarkExpiryNotified(ctx, c.ID); err != nil {
			log.Printf("[expiring-soon-job] mark notified contract=%d error: %v", c.ID, err)
		}
	}
	if len(contracts) > 0 {
		log.Printf("[expiring-soon-job] notified %d contract(s)", len(contracts))
	}
}
