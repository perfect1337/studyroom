package app

import (
	"net/http"
	"time"

	"studyroom/crm-service/internal/auth"
	"studyroom/crm-service/internal/events"
	"studyroom/crm-service/internal/handlers"
	"studyroom/crm-service/internal/middleware"
	"studyroom/crm-service/internal/models"
	"studyroom/crm-service/internal/openapi"
	"studyroom/crm-service/internal/repository"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Deps struct {
	Pool *pgxpool.Pool
	TM   *auth.TokenManager

	Applications *repository.ApplicationRepository
	UserRefs     *repository.UserRefRepository

	Events        events.Publisher
	WebhookSecret string
}

func NewDeps(pool *pgxpool.Pool, tm *auth.TokenManager, webhookSecret string, pub events.Publisher) *Deps {
	if pub == nil {
		pub = events.NoopPublisher{}
	}
	return &Deps{
		Pool:          pool,
		TM:            tm,
		Applications:  repository.NewApplicationRepository(pool),
		UserRefs:      repository.NewUserRefRepository(pool),
		Events:        pub,
		WebhookSecret: webhookSecret,
	}
}

// NewRouter собирает HTTP-роутер crm-service (общий для main и тестов).
// Публичный префикс — /api/v1/crm (см. api-contracts.md, раздел 4).
func NewRouter(d *Deps) http.Handler {
	appHandler := handlers.NewApplicationHandler(d.Applications, d.UserRefs, d.Events, d.WebhookSecret)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Logging)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Get("/openapi.yaml", openapi.SpecHandler)
	r.Get("/docs", openapi.DocsHandler)

	r.Route("/api/v1/crm", func(r chi.Router) {
		// 4.1 — вебхук Tilda: auth: false, вместо JWT проверяется подпись
		// в самом хендлере (X-Tilda-Signature), см. api-contracts.md.
		r.Post("/applications/webhook", appHandler.Webhook)

		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireAuth(d.TM))

			// 4.2 — внутренняя заявка, roles: parent.
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleParent))
				r.Post("/applications", appHandler.CreateInternal)
			})

			// 4.3-4.5 — список/обновление/удаление заявок, roles: owner.
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner))
				r.Get("/applications", appHandler.List)
				r.Patch("/applications/{id}", appHandler.UpdateStatus)
				r.Delete("/applications/{id}", appHandler.Delete)
			})
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
