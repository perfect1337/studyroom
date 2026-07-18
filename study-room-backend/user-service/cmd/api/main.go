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
	"studyroom/user-service/internal/auth"
	"studyroom/user-service/internal/config"
	"studyroom/user-service/internal/db"
	"studyroom/user-service/internal/handlers"
	"studyroom/user-service/internal/middleware"
	"studyroom/user-service/internal/migrate"
	"studyroom/user-service/internal/models"
	"studyroom/user-service/internal/repository"
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

	// Миграции применяются автоматически при каждом старте контейнера —
	// именно это заменяет ручной psql/golang-migrate шаг из докера.
	if err := migrate.Run(ctx, pool); err != nil {
		log.Fatalf("migration error: %v", err)
	}
	log.Println("migrations up to date")

	userRepo := repository.NewUserRepository(pool)
	branchRepo := repository.NewBranchRepository(pool)
	authRepo := repository.NewAuthRepository(pool)
	parentChildRepo := repository.NewParentChildRepository(pool)
	tutorProfileRepo := repository.NewTutorProfileRepository(pool)

	tm := auth.NewTokenManager(cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)

	authHandler := handlers.NewAuthHandler(userRepo, authRepo, tm)
	userHandler := handlers.NewUserHandler(userRepo, branchRepo, parentChildRepo)
	tutorHandler := handlers.NewTutorHandler(tutorProfileRepo, userRepo)

	r := chi.NewRouter()
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	r.Route("/api/v1", func(r chi.Router) {
		// --- Публичные (auth: false) ---
		r.Post("/auth/register", authHandler.Register)
		r.Post("/auth/login", authHandler.Login)
		r.Post("/auth/refresh", authHandler.Refresh)
		r.Post("/auth/forgot-password", authHandler.ForgotPassword)
		r.Post("/auth/reset-password", authHandler.ResetPassword)

		// --- Требуют авторизации ---
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireAuth(tm))

			r.Get("/users/me", userHandler.Me)
			r.Patch("/users/me", userHandler.UpdateMe)
			r.Post("/users/me/change-password", userHandler.ChangePassword)

			r.Get("/users", userHandler.List)
			r.Get("/users/{id}", userHandler.GetByID)
			r.Patch("/users/{id}", userHandler.Update)

			r.Get("/branches", userHandler.ListBranches)
			r.Get("/parents/{parentId}/children", userHandler.ListChildren)

			// --- Только owner ---
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner))
				r.Post("/users/tutors", userHandler.CreateTutor)
				r.Patch("/users/{id}/status", userHandler.SetStatus)
				r.Post("/branches", userHandler.CreateBranch)
			})

			// --- owner + parent ---
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleParent))
				r.Post("/users/students", userHandler.CreateStudent)
			})

			// --- owner + branch_owner (доп. проверка на inactive — внутри хендлера) ---
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleBranchOwner))
				r.Patch("/tutors/{id}/status", tutorHandler.SetStatus)
			})
		})
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("user-service listening on :%s", cfg.Port)
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
