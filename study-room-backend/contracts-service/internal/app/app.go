package app

import (
	"net/http"
	"time"

	"studyroom/contracts-service/internal/auth"
	"studyroom/contracts-service/internal/events"
	"studyroom/contracts-service/internal/handlers"
	"studyroom/contracts-service/internal/middleware"
	"studyroom/contracts-service/internal/models"
	"studyroom/contracts-service/internal/openapi"
	"studyroom/contracts-service/internal/repository"
	"studyroom/contracts-service/internal/userclient"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Deps struct {
	Pool *pgxpool.Pool
	TM   *auth.TokenManager

	Contracts *repository.ContractRepository
	UserRefs  *repository.UserRefRepository

	// UserClient — GET /parents/{id}/children, единственный синхронный
	// HTTP-вызов (см. internal/userclient и api-contracts.md 3.3a).
	// Интерфейс handlers.ChildrenResolver — тесты подставляют фейк вместо
	// реального userclient.Client (см. tests/contracts/setup_test.go).
	UserClient handlers.ChildrenResolver

	Events events.Publisher
}

func NewDeps(pool *pgxpool.Pool, tm *auth.TokenManager, userServiceURL string, pub events.Publisher) *Deps {
	if pub == nil {
		pub = events.NoopPublisher{}
	}
	return &Deps{
		Pool:       pool,
		TM:         tm,
		Contracts:  repository.NewContractRepository(pool),
		UserRefs:   repository.NewUserRefRepository(pool),
		UserClient: userclient.New(userServiceURL),
		Events:     pub,
	}
}

// NewRouter собирает HTTP-роутер contracts-service. Публичный префикс —
// /api/v1/contracts (см. api-contracts.md, раздел 3).
func NewRouter(d *Deps) http.Handler {
	h := handlers.NewContractHandler(d.Contracts, d.UserRefs, d.UserClient, d.Events)

	r := chi.NewRouter()
	// Recoverer — первым, чтобы ловить паники даже из middleware ниже
	// по цепочке (см. internal/middleware/recover.go).
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(middleware.Logging)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	// API documentation is intentionally public for local development and debugging.
	r.Get("/openapi.yaml", openapi.SpecHandler)
	r.Get("/docs", openapi.DocsHandler)

	r.Route("/api/v1/contracts", func(r chi.Router) {
		r.Use(middleware.RequireAuth(d.TM))

		// Owner-only aggregate statistics, including soft-deleted contracts.
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireRoles(models.RoleOwner))
			r.Get("/stats", h.Stats)
		})

		// 3.1, 3.3-3.7 — roles: owner (любой филиал), branch_owner (только
		// свой филиал — руководитель филиала имеет тот же функционал по
		// договорам, что и owner, кроме управления сетью филиалов как
		// таковой). Область видимости branch_owner сужается внутри самих
		// хендлеров — см. ContractHandler.Create/GetByID/UpdateFields/
		// UpdateStatus/UpdatePaymentStatus/Delete.
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleBranchOwner))
			r.Post("/", h.Create)
			r.Get("/{id}", h.GetByID)
			r.Patch("/{id}", h.UpdateFields)
			r.Patch("/{id}/status", h.UpdateStatus)
			r.Patch("/{id}/payment-status", h.UpdatePaymentStatus)
			r.Delete("/{id}", h.Delete)
		})

		// 3.2 — owner (любой филиал) / branch_owner (только свой филиал,
		// сервер сам подставляет branch_id из JWT — см. ContractHandler.List).
		// Нужен branch_owner, чтобы показывать срок/статус договора в
		// разделе "Ученики филиала" (/branch/students).
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleBranchOwner))
			r.Get("/", h.List)
		})

		// 3.3a — branch_owner (свой филиал) / parent (свои дети),
		// тонкая проверка внутри самого хендлера (ContractHandler.Expiry).
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireRoles(models.RoleBranchOwner, models.RoleParent))
			r.Get("/{id}/expiry", h.Expiry)
		})

		// /mine — parent-only: список договоров всех своих детей
		// (полные данные, в отличие от /{id}/expiry). Регистрируется как
		// отдельный статический путь, поэтому не конфликтует с /{id}.
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireRoles(models.RoleParent))
			r.Get("/mine", h.ListMine)
		})
	})

	return r
}

func NewServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadTimeout:       10 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
}
