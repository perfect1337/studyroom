package app

import (
	"net/http"

	"studyroom/user-service/internal/auth"
	"studyroom/user-service/internal/handlers"
	"studyroom/user-service/internal/middleware"
	"studyroom/user-service/internal/models"
	"studyroom/user-service/internal/repository"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Deps struct {
	Pool *pgxpool.Pool
	TM   *auth.TokenManager

	Users         *repository.UserRepository
	Branches      *repository.BranchRepository
	Auth          *repository.AuthRepository
	ParentChild   *repository.ParentChildRepository
	TutorProfiles *repository.TutorProfileRepository
}

func NewDeps(pool *pgxpool.Pool, tm *auth.TokenManager) *Deps {
	return &Deps{
		Pool:          pool,
		TM:            tm,
		Users:         repository.NewUserRepository(pool),
		Branches:      repository.NewBranchRepository(pool),
		Auth:          repository.NewAuthRepository(pool),
		ParentChild:   repository.NewParentChildRepository(pool),
		TutorProfiles: repository.NewTutorProfileRepository(pool),
	}
}

// NewRouter собирает HTTP-роутер user-service (общий для main и тестов).
func NewRouter(d *Deps) http.Handler {
	authHandler := handlers.NewAuthHandler(d.Users, d.Auth, d.TM)
	userHandler := handlers.NewUserHandler(d.Users, d.Branches, d.ParentChild, d.Auth, d.TutorProfiles)
	tutorHandler := handlers.NewTutorHandler(d.TutorProfiles, d.Users)

	r := chi.NewRouter()
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/register", authHandler.Register)
		r.Post("/auth/login", authHandler.Login)
		r.Post("/auth/refresh", authHandler.Refresh)
		r.Post("/auth/forgot-password", authHandler.ForgotPassword)
		r.Post("/auth/reset-password", authHandler.ResetPassword)

		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireAuth(d.TM))

			r.Get("/users/me", userHandler.Me)
			r.Patch("/users/me", userHandler.UpdateMe)
			r.Post("/users/me/change-password", userHandler.ChangePassword)

			r.Get("/users", userHandler.List)
			r.Get("/users/{id}", userHandler.GetByID)
			r.Patch("/users/{id}", userHandler.Update)
			r.Get("/parents/{parentId}/children", userHandler.ListChildren)

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner))
				r.Post("/users/tutors", userHandler.CreateTutor)
				r.Patch("/users/{id}/status", userHandler.SetStatus)
				r.Get("/branches", userHandler.ListBranches)
				r.Post("/branches", userHandler.CreateBranch)
			})

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleParent))
				r.Post("/users/students", userHandler.CreateStudent)
			})

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleBranchOwner))
				r.Patch("/tutors/{id}/status", tutorHandler.SetStatus)
			})
		})
	})

	return r
}
