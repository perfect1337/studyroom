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

const expiringSoonWithinDays = 1
const contractExpiryCheckInterval = time.Minute

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

			sub := events.NewSubscriber(nc, deps.UserRefs, deps.Contracts)
			if err := sub.Start(ctx); err != nil {
				log.Printf("events: subscribe failed: %v", err)
			}

			stopExpiryJob := startExpiringSoonJob(ctx, deps)
			defer stopExpiryJob()
		}
	} else {
		log.Println("events: NATS_URL not set, skipping event subscription and contract.expiring_soon job")
	}

	// Contract expiration is a data integrity rule, not only a notification feature,
	// so it runs even when NATS is disabled. When NATS is available the job also
	// publishes contract.expired so Academic Service immediately closes access to lessons.
	stopContractExpiryJob := startContractExpiryJob(ctx, deps)
	defer stopContractExpiryJob()

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

// expiringSoonCheckHour — в котором часу по МСК раз в сутки проверяются
// истекающие договоры.
const expiringSoonCheckHour = 8

var mskLocation = time.FixedZone("MSK", 3*60*60)

// startExpiringSoonJob — раз в сутки в expiringSoonCheckHour:00 МСК проверяет
// договоры и отправляет два уведомления: за 1 день до окончания и в день
// окончания. Первый запуск НЕ происходит сразу при старте процесса — иначе
// при каждом перезапуске контейнера (деплой, рестарт, повторный docker
// compose up) уведомление "договор истекает завтра" уходило бы родителям
// повторно: у этой ветки в checkExpiringSoon сознательно нет своего флага
// "уже отправлено" (см. комментарий там же) — только дневная периодичность
// защищала от дублей. Вместо немедленного run() считаем точное время до
// ближайших expiringSoonCheckHour:00 МСК и ждём именно его — тот же приём,
// что уже используется в academic-service/startDailyDigestJob.
func startExpiringSoonJob(ctx context.Context, deps *app.Deps) func() {
	done := make(chan struct{})

	nextRun := func() time.Duration {
		now := time.Now().In(mskLocation)
		next := time.Date(now.Year(), now.Month(), now.Day(), expiringSoonCheckHour, 0, 0, 0, mskLocation)
		if !next.After(now) {
			next = next.AddDate(0, 0, 1)
		}
		return next.Sub(now)
	}

	go func() {
		for {
			select {
			case <-time.After(nextRun()):
				checkExpiringSoon(ctx, deps)
			case <-done:
				return
			}
		}
	}()

	return func() {
		close(done)
	}
}

func startContractExpiryJob(ctx context.Context, deps *app.Deps) func() {
	ticker := time.NewTicker(contractExpiryCheckInterval)
	done := make(chan struct{})

	go func() {
		checkContractExpiry(ctx, deps)
		for {
			select {
			case <-ticker.C:
				checkContractExpiry(ctx, deps)
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

func checkContractExpiry(ctx context.Context, deps *app.Deps) {
	contracts, err := deps.Contracts.ExpireDue(ctx)
	if err != nil {
		log.Printf("[contract-expiry-job] expire due contracts error: %v", err)
		return
	}
	for _, c := range contracts {
		deps.Events.ContractExpired(c.ID, c.StudentID, c.CourseID, c.EndDate.Format("2006-01-02"))
		log.Printf("[contract-expiry-job] contract %d completed after end date (student=%d course=%d)", c.ID, c.StudentID, c.CourseID)
	}
}

func checkExpiringSoon(ctx context.Context, deps *app.Deps) {
	contracts, err := deps.Contracts.ListExpiringSoon(ctx, expiringSoonWithinDays)
	if err != nil {
		log.Printf("[expiring-soon-job] list error: %v", err)
		return
	}

	today := time.Now().Format("2006-01-02")
	tomorrow := time.Now().AddDate(0, 0, 1).Format("2006-01-02")

	for _, c := range contracts {
		end := c.EndDate.Format("2006-01-02")

		switch {
		case end == tomorrow:
			// Первое уведомление: завтра истекает – отправляем, но флаг не ставим.
			deps.Events.ContractExpiringSoon(c.ParentID, c.StudentID, c.ContractNumber, end)
			log.Printf("[expiring-soon-job] sent first notification (tomorrow) for contract %d", c.ID)

		case end == today:
			// Второе уведомление: сегодня истекает – отправляем и ставим флаг.
			deps.Events.ContractExpiringSoon(c.ParentID, c.StudentID, c.ContractNumber, end)
			if err := deps.Contracts.MarkExpiryNotified(ctx, c.ID); err != nil {
				log.Printf("[expiring-soon-job] mark notified contract=%d error: %v", c.ID, err)
			} else {
				log.Printf("[expiring-soon-job] sent second notification (today) and marked for contract %d", c.ID)
			}

		default:
			// Если end_date уже прошла (меньше today) – просто ставим флаг.
			if err := deps.Contracts.MarkExpiryNotified(ctx, c.ID); err != nil {
				log.Printf("[expiring-soon-job] mark notified contract=%d error: %v", c.ID, err)
			}
		}
	}

	if len(contracts) > 0 {
		log.Printf("[expiring-soon-job] processed %d contract(s)", len(contracts))
	}
}
