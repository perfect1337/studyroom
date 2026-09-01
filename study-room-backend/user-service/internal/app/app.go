package app

import (
	"net/http"
	"time"

	"studyroom/user-service/internal/auth"
	"studyroom/user-service/internal/events"
	"studyroom/user-service/internal/handlers"
	"studyroom/user-service/internal/middleware"
	"studyroom/user-service/internal/models"
	"studyroom/user-service/internal/openapi"
	"studyroom/user-service/internal/repository"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Deps struct {
	Pool *pgxpool.Pool
	TM   *auth.TokenManager

	Users           *repository.UserRepository
	Branches        *repository.BranchRepository
	Auth            *repository.AuthRepository
	ParentChild     *repository.ParentChildRepository
	TutorProfiles   *repository.TutorProfileRepository
	StudentProfiles *repository.StudentProfileRepository
	Events          events.Publisher
	AppPublicURL    string

	// AuthRateLimit — сколько запросов в минуту на IP разрешено к /auth/*
	// (register/login/refresh/forgot-password/reset-password). 0 или
	// отрицательное значение означает "не задано" — используется дефолт 200.
	// Настраивается через ENV AUTH_RATE_LIMIT_PER_MIN (см. internal/config),
	// прод-поведение по умолчанию не меняется.
	AuthRateLimit int

	// CookieOptions — параметры httpOnly cookie для refresh-токена
	// (COOKIE_SECURE/COOKIE_SAMESITE/COOKIE_DOMAIN, см. internal/config).
	CookieOptions handlers.CookieOptions
}

func NewDeps(pool *pgxpool.Pool, tm *auth.TokenManager, pub events.Publisher, appPublicURL string, authRateLimit int, cookieOpts handlers.CookieOptions) *Deps {
	if pub == nil {
		pub = events.NoopPublisher{}
	}
	return &Deps{
		Pool:            pool,
		TM:              tm,
		Users:           repository.NewUserRepository(pool),
		Branches:        repository.NewBranchRepository(pool),
		Auth:            repository.NewAuthRepository(pool),
		ParentChild:     repository.NewParentChildRepository(pool),
		TutorProfiles:   repository.NewTutorProfileRepository(pool),
		StudentProfiles: repository.NewStudentProfileRepository(pool),
		Events:          pub,
		AppPublicURL:    appPublicURL,
		AuthRateLimit:   authRateLimit,
		CookieOptions:   cookieOpts,
	}
}

// NewRouter собирает HTTP-роутер user-service (общий для main и тестов).
func NewRouter(d *Deps) http.Handler {
	authHandler := handlers.NewAuthHandler(d.Users, d.Auth, d.TM, d.Events, d.AppPublicURL, d.CookieOptions)
	userHandler := handlers.NewUserHandler(d.Users, d.Branches, d.ParentChild, d.Auth, d.TutorProfiles, d.StudentProfiles, d.Events)
	tutorHandler := handlers.NewTutorHandler(d.TutorProfiles, d.Users)

	r := chi.NewRouter()
	// Recoverer — первым, чтобы ловить паники даже из middleware ниже
	// по цепочке (см. internal/middleware/recover.go).
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(middleware.Logging)
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	authRateLimit := d.AuthRateLimit
	if authRateLimit <= 0 {
		authRateLimit = 200
	}
	authLimiter := middleware.NewIPRateLimiter(authRateLimit, time.Minute)
	// Registration has a stricter fixed limit: no more than 2 successful/attempted
	// registration requests per minute from one client IP. The generic auth
	// limiter remains in place for the other auth endpoints.
	registerLimiter := middleware.NewIPRateLimiter(2, time.Minute)

	r.Get("/openapi.yaml", openapi.SpecHandler)
	r.Get("/docs", openapi.DocsHandler)

	r.Route("/api/v1", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(middleware.RateLimit(authLimiter))
			r.With(middleware.RateLimit(registerLimiter)).Post("/auth/register", authHandler.Register)
			r.Post("/auth/login", authHandler.Login)
			r.Post("/auth/refresh", authHandler.Refresh)
			r.Post("/auth/forgot-password", authHandler.ForgotPassword)
			r.Post("/auth/reset-password", authHandler.ResetPassword)
			r.Post("/auth/logout", authHandler.Logout)
		})

		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireAuth(d.TM))

			r.Get("/users/me", userHandler.Me)
			r.Patch("/users/me", userHandler.UpdateMe)
			r.Post("/users/me/change-password", userHandler.ChangePassword)

			r.Get("/users", userHandler.List)
			r.Get("/users/{id}", userHandler.GetByID)
			r.Patch("/users/{id}", userHandler.Update)
			r.Get("/parents/{parentId}/children", userHandler.ListChildren)
			r.Delete("/users/{id}", userHandler.Delete)
			r.Post("/users/{id}/reset-credentials", userHandler.ResetStudentCredentials)
			// Список филиалов — доступен любой аутентифицированной роли (только чтение,
			// ничего чувствительного). Раньше был owner-only, но это мешало родителю
			// выбрать филиал при добавлении ребёнка (см. POST /users/students,
			// req.BranchID) — из-за этого у детей никогда не проставлялся branch_id,
			// и они не попадали в филиальные списки тьюторов/branch_owner.
			r.Get("/branches", userHandler.ListBranches)

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner))
				r.Post("/users/branch-owners", userHandler.CreateBranchOwner)
				r.Post("/branches", userHandler.CreateBranch)
				r.Delete("/branches/{id}", userHandler.DeleteBranch)
				r.Get("/branches/deleted", userHandler.ListDeletedBranches)
			})

			r.Group(func(r chi.Router) {
				// SetStatus (увольнение/восстановление): owner — кого угодно,
				// branch_owner — только преподавателей своего собственного
				// филиала (проверяется внутри UserHandler.SetStatus).
				r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleBranchOwner))
				r.Patch("/users/{id}/status", userHandler.SetStatus)
			})

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleBranchOwner))
				r.Post("/users/tutors", userHandler.CreateTutor)
			})

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleParent, models.RoleBranchOwner))
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
