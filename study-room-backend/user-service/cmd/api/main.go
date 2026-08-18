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
	deps := app.NewDepsWithRateLimits(pool, tm, pub, cfg.AppPublicURL, cfg.AuthRateLimit, cfg.LoginRateLimit, cfg.RefreshRateLimit, cookieOpts)
	handler := app.NewRouter(deps)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      handler,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("user-service listening on :%s", cfg.Port)
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
	_ = srv.Shutdown(shutdownCtx)
}
