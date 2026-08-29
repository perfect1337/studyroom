package main

import (
	"context"
	"log"
	"net"
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

	// Кастомный DialContext: сначала пробуем все IPv6-адреса хоста, затем
	// все IPv4 — и только если ни один не подключился, отдаём дело
	// стандартному dial'у. Нужен, если сеть до внешних API (Telegram,
	// SMTP и т.п.) нестабильна по одному из семейств адресов.
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			// Получаем все IP-адреса для хоста.
			addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			var ipv6Addrs, ipv4Addrs []net.IP
			for _, ip := range addrs {
				if ip.IP.To4() == nil && ip.IP.To16() != nil {
					ipv6Addrs = append(ipv6Addrs, ip.IP)
				} else if ip.IP.To4() != nil {
					ipv4Addrs = append(ipv4Addrs, ip.IP)
				}
			}
			dialer := &net.Dialer{Timeout: 30 * time.Second}
			// Сначала пробуем IPv6.
			for _, ip := range ipv6Addrs {
				conn, err := dialer.DialContext(ctx, "tcp6", net.JoinHostPort(ip.String(), port))
				if err == nil {
					return conn, nil
				}
			}
			// Если IPv6 не сработал, пробуем IPv4.
			for _, ip := range ipv4Addrs {
				conn, err := dialer.DialContext(ctx, "tcp4", net.JoinHostPort(ip.String(), port))
				if err == nil {
					return conn, nil
				}
			}
			// Если ничего не вышло — стандартный dial как запасной вариант.
			return dialer.DialContext(ctx, network, addr)
		},
		ForceAttemptHTTP2: true,
	}
	http.DefaultClient = &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
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

	// Telegram bot polling запускаем в фоне, НЕ блокируя старт HTTP-сервера
	// ниже. NewTelegramBot делает синхронный retry (до 5 попыток NewBotAPI
	// + ещё до 5 попыток GetMe, с паузами по 3с между ними) — если сеть до
	// Telegram API с сервера медленная или временно недоступна, это могло
	// растягиваться на минуту-две, и всё это время HTTP-сервер вообще не
	// слушал порт (он стартовал строго ПОСЛЕ этого блока) — снаружи это
	// выглядело как "сервис не отвечает" (502 от nginx на /api/v1/notifications
	// и любой другой путь этого сервиса), хотя сам процесс уже был запущен.
	// Теперь сервер поднимается сразу, а бот донастраивается параллельно.
	if cfg.TelegramBotToken != "" {
		go func() {
			bot, err := messenger.NewTelegramBot(cfg.TelegramBotToken, deps.UsersRef, deps.TelegramUser)
			if err != nil {
				log.Printf("telegram: bot init failed: %v (continuing without bot polling)", err)
				return
			}
			bot.StartPolling(ctx)
		}()
	} else {
		log.Println("telegram: TELEGRAM_BOT_TOKEN not set, skipping bot polling")
	}

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
