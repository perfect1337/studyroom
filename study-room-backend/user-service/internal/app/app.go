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

	// AuthRateLimit — сколько запросов в минуту на IP разрешено к
	// register/forgot-password/reset-password/logout. 0 или отрицательное
	// значение означает "не задано" — используется дефолт 200. Настраивается
	// через ENV AUTH_RATE_LIMIT_PER_MIN (см. internal/config).
	//
	// login и refresh НЕ используют этот лимит — у них отдельные бюджеты
	// (LoginRateLimit/RefreshRateLimit), см. ниже.
	AuthRateLimit int

	// LoginRateLimit — отдельный, более строгий лимит на POST /auth/login
	// (запросов/минуту на IP). 0 или отрицательное значение — дефолт 20.
	// Настраивается через ENV LOGIN_RATE_LIMIT_PER_MIN.
	LoginRateLimit int

	// RefreshRateLimit — отдельный, более щедрый лимит на POST /auth/refresh
	// (запросов/минуту на IP). 0 или отрицательное значение — дефолт 600.
	// Настраивается через ENV REFRESH_RATE_LIMIT_PER_MIN.
	RefreshRateLimit int

	// CookieOptions — параметры httpOnly cookie для refresh-токена
	// (COOKIE_SECURE/COOKIE_SAMESITE/COOKIE_DOMAIN, см. internal/config).
	CookieOptions handlers.CookieOptions
}

func NewDeps(pool *pgxpool.Pool, tm *auth.TokenManager, pub events.Publisher, appPublicURL string, authRateLimit int, cookieOpts handlers.CookieOptions) *Deps {
	return NewDepsWithRateLimits(pool, tm, pub, appPublicURL, authRateLimit, 0, 0, cookieOpts)
}

// NewDepsWithRateLimits — как NewDeps, но с явными отдельными лимитами для
// login и refresh (см. комментарии к полям Deps.LoginRateLimit /
// Deps.RefreshRateLimit). loginRateLimit/refreshRateLimit <= 0 означают
// "не задано" — применяются дефолты 20 и 600 соответственно.
func NewDepsWithRateLimits(pool *pgxpool.Pool, tm *auth.TokenManager, pub events.Publisher, appPublicURL string, authRateLimit, loginRateLimit, refreshRateLimit int, cookieOpts handlers.CookieOptions) *Deps {
	if pub == nil {
		pub = events.NoopPublisher{}
	}
	return &Deps{
		Pool:             pool,
		TM:               tm,
		Users:            repository.NewUserRepository(pool),
		Branches:         repository.NewBranchRepository(pool),
		Auth:             repository.NewAuthRepository(pool),
		ParentChild:      repository.NewParentChildRepository(pool),
		TutorProfiles:    repository.NewTutorProfileRepository(pool),
		StudentProfiles:  repository.NewStudentProfileRepository(pool),
		Events:           pub,
		AppPublicURL:     appPublicURL,
		AuthRateLimit:    authRateLimit,
		LoginRateLimit:   loginRateLimit,
		RefreshRateLimit: refreshRateLimit,
		CookieOptions:    cookieOpts,
	}
}

// Дефолты лимитов на IP/минуту, применяются когда соответствующее поле
// Deps <= 0 ("не задано"). См. комментарии к полям Deps.*RateLimit.
const (
	defaultAuthRateLimit    = 200
	defaultLoginRateLimit   = 20
	defaultRefreshRateLimit = 600
)

// resolveRateLimit возвращает configured, если он задан (> 0), иначе fallback.
// Вынесено в отдельную чистую функцию, чтобы дефолты для login/refresh/
// остальных auth-эндпоинтов можно было протестировать без поднятия роутера
// и БД (см. app_test.go).
func resolveRateLimit(configured, fallback int) int {
	if configured <= 0 {
		return fallback
	}
	return configured
}

// NewRouter собирает HTTP-роутер user-service (общий для main и тестов).
func NewRouter(d *Deps) http.Handler {
	authHandler := handlers.NewAuthHandler(d.Users, d.Auth, d.TM, d.Events, d.AppPublicURL, d.CookieOptions)
	userHandler := handlers.NewUserHandler(d.Users, d.Branches, d.ParentChild, d.Auth, d.TutorProfiles, d.StudentProfiles, d.Events)
	tutorHandler := handlers.NewTutorHandler(d.TutorProfiles, d.Users)

	r := chi.NewRouter()
	r.Use(middleware.CORS)
	r.Use(middleware.RequestID)
	r.Use(middleware.Logging)
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	// Три отдельных лимитера вместо одного общего на весь /auth/*:
	// login исторически делил бюджет с refresh/register/logout, из-за чего
	// приходилось выбирать между "достаточно щедро для refresh" и
	// "достаточно строго для брутфорса логина" — оба сразу не получались.
	// Теперь у каждой группы свой бюджет и своя семантика риска.
	authRateLimit := resolveRateLimit(d.AuthRateLimit, defaultAuthRateLimit)
	loginRateLimit := resolveRateLimit(d.LoginRateLimit, defaultLoginRateLimit)
	refreshRateLimit := resolveRateLimit(d.RefreshRateLimit, defaultRefreshRateLimit)
	authLimiter := middleware.NewIPRateLimiter(authRateLimit, time.Minute)
	loginLimiter := middleware.NewIPRateLimiter(loginRateLimit, time.Minute)
	refreshLimiter := middleware.NewIPRateLimiter(refreshRateLimit, time.Minute)

	r.Get("/openapi.yaml", openapi.SpecHandler)
	r.Get("/docs", openapi.DocsHandler)

	r.Route("/api/v1", func(r chi.Router) {
		// login — самый чувствительный к брутфорсу/credential stuffing
		// эндпоинт, поэтому у него отдельный, заметно более строгий лимит.
		r.Group(func(r chi.Router) {
			r.Use(middleware.RateLimit(loginLimiter))
			r.Post("/auth/login", authHandler.Login)
		})

		// refresh легитимно дёргается часто (несколько вкладок/устройств,
		// фоновое обновление access-токена) — щедрый отдельный лимит, чтобы
		// не мешать обычным пользователям и не делить бюджет с login.
		r.Group(func(r chi.Router) {
			r.Use(middleware.RateLimit(refreshLimiter))
			r.Post("/auth/refresh", authHandler.Refresh)
		})

		r.Group(func(r chi.Router) {
			r.Use(middleware.RateLimit(authLimiter))
			r.Post("/auth/register", authHandler.Register)
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
