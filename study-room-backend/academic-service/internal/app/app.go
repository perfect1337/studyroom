package app

import (
	"net/http"
	"time"

	"studyroom/academic-service/internal/auth"
	"studyroom/academic-service/internal/events"
	"studyroom/academic-service/internal/handlers"
	"studyroom/academic-service/internal/middleware"
	"studyroom/academic-service/internal/models"
	"studyroom/academic-service/internal/openapi"
	"studyroom/academic-service/internal/repository"
	"studyroom/academic-service/internal/userclient"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Deps struct {
	Pool *pgxpool.Pool
	TM   *auth.TokenManager

	Courses     *repository.CourseRepository
	Enrollments *repository.EnrollmentRepository
	Lessons     *repository.LessonRepository
	Attendance  *repository.AttendanceRepository
	Homework    *repository.HomeworkRepository
	UserRefs    *repository.UserRefRepository

	UserClient handlers.ChildrenResolver
	Events     events.Publisher
}

func NewDeps(pool *pgxpool.Pool, tm *auth.TokenManager, userServiceURL string, pub events.Publisher) *Deps {
	if pub == nil {
		pub = events.NoopPublisher{}
	}
	return &Deps{
		Pool:        pool,
		TM:          tm,
		Courses:     repository.NewCourseRepository(pool),
		Enrollments: repository.NewEnrollmentRepository(pool),
		Lessons:     repository.NewLessonRepository(pool),
		Attendance:  repository.NewAttendanceRepository(pool),
		Homework:    repository.NewHomeworkRepository(pool),
		UserRefs:    repository.NewUserRefRepository(pool),
		UserClient:  userclient.New(userServiceURL),
		Events:      pub,
	}
}

// NewRouter собирает HTTP-роутер academic-service (общий для main и тестов).
// Публичный префикс — /api/v1/academic (см. api-contracts.md, раздел 2).
func NewRouter(d *Deps) http.Handler {
	courseHandler := handlers.NewCourseHandler(d.Courses)
	enrollHandler := handlers.NewEnrollmentHandler(d.Enrollments, d.UserClient)
	lessonHandler := handlers.NewLessonHandler(d.Lessons, d.Enrollments, d.Attendance, d.UserRefs, d.UserClient, d.Events)
	homeworkHandler := handlers.NewHomeworkHandler(d.Homework, d.UserRefs, d.UserClient)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Logging)
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Get("/openapi.yaml", openapi.SpecHandler)
	r.Get("/docs", openapi.DocsHandler)
 
	r.Route("/api/v1/academic", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireAuth(d.TM))

			// 2.1 / 2.5 / 2.7 / 2.13 — списки: доступны любой роли, каждая
			// хендлером принудительно сужается до своей области видимости
			// (см. handlers/*.go), поэтому RequireRoles тут не нужен.
			r.Get("/courses", courseHandler.List)
			r.Get("/enrollments", enrollHandler.List)
			r.Get("/lessons", lessonHandler.List)
			// 2.11 — доступна ещё parent/student при условии участия,
			// проверяется внутри GetAttendance.
			r.Get("/lessons/{id}/attendance", lessonHandler.GetAttendance)
			r.Get("/homework", homeworkHandler.List)

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner))
				r.Post("/courses", courseHandler.Create)
				r.Patch("/courses/{id}", courseHandler.Update)
				r.Delete("/courses/{id}", courseHandler.Delete)
				r.Post("/enrollments", enrollHandler.Create)
			})

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleBranchOwner))
				r.Patch("/enrollments/{id}/assign-tutor", enrollHandler.AssignTutor)
			})

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleBranchOwner, models.RoleTutor))
				r.Patch("/enrollments/{id}", enrollHandler.Update)
				r.Post("/lessons", lessonHandler.Create)
				r.Patch("/lessons/{id}", lessonHandler.Update)
				r.Delete("/lessons/{id}", lessonHandler.Delete)
				r.Post("/lessons/{id}/attendance", lessonHandler.MarkAttendance)
			})

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleTutor))
				r.Post("/homework", homeworkHandler.Create)
			})

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleStudent))
				r.Get("/homework/{id}/open", homeworkHandler.Open)
			})
		})
	})

	return r
}

func NewServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
}
