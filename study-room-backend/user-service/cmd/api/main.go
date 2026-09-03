package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"studyroom/user-service/internal/app"
	"studyroom/user-service/internal/auth"
	"studyroom/user-service/internal/config"
	"studyroom/user-service/internal/db"
	"studyroom/user-service/internal/events"
	"studyroom/user-service/internal/handlers"
	"studyroom/user-service/internal/middleware"
	"studyroom/user-service/internal/migrate"
	"studyroom/user-service/internal/models"
	"studyroom/user-service/internal/promotion"
	"studyroom/user-service/internal/repository"
)

func main() {
	ctx := context.Background()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	trustedProxies, err := middleware.ParseTrustedProxies(cfg.TrustedProxies)
	if err != nil {
		log.Fatalf("config error: %v", err)
	}
	middleware.SetTrustedProxies(trustedProxies)
	if cfg.TrustedProxies == "" {
		log.Println("TRUSTED_PROXIES not set: X-Forwarded-For is ignored, rate limit/logs use raw TCP peer IP")
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

	var pub events.Publisher = events.NoopPublisher{}
	if cfg.NATSURL != "" {
		nc, err := events.Connect(cfg.NATSURL)
		if err != nil {
			log.Printf("events: could not connect to NATS at %s: %v (continuing without publish)", cfg.NATSURL, err)
		} else {
			natsPub := events.NewNATSPublisher(nc)
			pub = natsPub
			defer natsPub.Close()
			log.Printf("events: publishing to NATS at %s", cfg.NATSURL)
		}
	} else {
		log.Println("events: NATS_URL not set, event publish disabled")
	}

	tm := auth.NewTokenManager(cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)
	cookieOpts := handlers.CookieOptions{
		Secure:   cfg.CookieSecure,
		SameSite: cfg.CookieSameSite,
		Domain:   cfg.CookieDomain,
	}
	deps := app.NewDeps(pool, tm, pub, cfg.AppPublicURL, cfg.AuthRateLimit, cookieOpts)
	handler := app.NewRouter(deps)

	// Пользователи, заведённые в обход обычного API (сидинг миграцией,
	// 0005_seed_owner.up.sql — единственный owner, без которого некому
	// войти в свежую БД) никогда не публиковали user.created/user.updated,
	// поэтому локальные кэши других сервисов (crm-service.user_refs,
	// notification-service.users_ref) ничего о них не знают: заявки не
	// резолвятся в получателя (crm publisher.go — ownerUserID==0 => skip
	// publish), уведомления никому не шлются. reconcileOwners переотправляет
	// user.updated (не user.created — без побочных эффектов вида "письмо о
	// регистрации") для всех текущих owner'ов при каждом старте сервиса —
	// идемпотентно (только upsert в кэшах-подписчиках) и НЕ завязано на
	// конкретный id (тот, что реально выдаст Postgres на INSERT), в отличие
	// от вписывания id вручную через psql/curl при каждом пересоздании
	// окружения.
	reconcileOwners(ctx, deps.Users, pub)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadTimeout:       10 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	go func() {
		log.Printf("user-service listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Ежегодное повышение класса / выпуск учеников — см. internal/promotion.
	// Отдельный контекст, отменяемый при shutdown ниже, чтобы фоновый тикер
	// не пережил остановку сервера.
	promotionCtx, cancelPromotion := context.WithCancel(context.Background())
	defer cancelPromotion()
	go promotion.NewService(pool, pub).StartScheduler(promotionCtx)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

// reconcileOwners переотправляет user.updated для всех пользователей с
// role=owner. Best-effort и неблокирующий: ошибка чтения из БД или паблиша
// в NATS (например, NoopPublisher, если NATS_URL не задан) только логируется
// — сервис поднимается в любом случае, как и раньше.
func reconcileOwners(ctx context.Context, users *repository.UserRepository, pub events.Publisher) {
	role := models.RoleOwner
	owners, err := users.ListAll(ctx, repository.ListFilter{Role: &role})
	if err != nil {
		log.Printf("reconcile: could not list owners: %v (skipping sync)", err)
		return
	}
	for _, u := range owners {
		pub.UserUpdated(u)
	}
	if len(owners) > 0 {
		log.Printf("reconcile: re-published user.updated for %d owner(s) to sync downstream caches", len(owners))
	}
}
