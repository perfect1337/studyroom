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
	Tests       *repository.TestRepository
	Subgroups   *repository.SubgroupRepository
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
		Tests:       repository.NewTestRepository(pool),
		Subgroups:   repository.NewSubgroupRepository(pool),
		UserRefs:    repository.NewUserRefRepository(pool),
		UserClient:  userclient.New(userServiceURL),
		Events:      pub,
	}
}

// NewRouter собирает HTTP-роутер academic-service (общий для main и тестов).
// Публичный префикс — /api/v1/academic (см. api-contracts.md, раздел 2).
func NewRouter(d *Deps) http.Handler {
	courseHandler := handlers.NewCourseHandler(d.Courses, d.UserRefs, d.Enrollments, d.UserClient)
	enrollHandler := handlers.NewEnrollmentHandler(d.Enrollments, d.UserClient)
	lessonHandler := handlers.NewLessonHandler(d.Lessons, d.Enrollments, d.Attendance, d.Subgroups, d.Courses, d.UserRefs, d.UserClient, d.Events)
	homeworkHandler := handlers.NewHomeworkHandler(d.Homework, d.Lessons, d.UserRefs, d.UserClient)
	testHandler := handlers.NewTestHandler(d.Tests, d.Lessons, d.UserRefs, d.UserClient)
	subgroupHandler := handlers.NewSubgroupHandler(d.Subgroups, d.Courses, d.Enrollments, d.UserRefs)

	r := chi.NewRouter()
	// Recoverer — первым, чтобы ловить паники даже из middleware ниже
	// по цепочке (см. internal/middleware/recover.go).
	r.Use(middleware.Recoverer)
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
			// 2.1a — список преподавателей курса, нужен фронту и для "мои
			// курсы", и для карточки курса у owner/branch_owner. Публичный
			// в рамках сервиса (RequireAuth уже применена выше) — сам факт
			// "кто ведёт курс" не более чувствителен, чем список курсов.
			r.Get("/courses/{id}/tutors", courseHandler.ListTutors)
			r.Get("/enrollments", enrollHandler.List)
			r.Get("/lessons", lessonHandler.List)
			// 2.11 — доступна ещё parent/student при условии участия,
			// проверяется внутри GetAttendance.
			r.Get("/lessons/{id}/attendance", lessonHandler.GetAttendance)
			r.Get("/homework", homeworkHandler.List)
			// 2.19 — тесты: ссылка тьютора ученику + оценка за прохождение.
			// Область видимости сужается внутри testHandler.List (см. комментарий там).
			r.Get("/tests", testHandler.List)
			// Подгруппы: список тоже сужается внутри хендлера (owner/branch_owner
			// видят по фильтру, tutor — только свои, см. SubgroupHandler.List).
			r.Get("/subgroups", subgroupHandler.List)

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner))
				r.Post("/enrollments", enrollHandler.Create)
			})

			// Курсы: owner управляет курсами всей сети (может создавать курс
			// сразу на все филиалы), branch_owner — только курсами своего
			// филиала (руководитель филиала имеет весь тот же функционал, что
			// и owner, кроме управления сетью филиалов как таковой). Хендлеры
			// сами принудительно подставляют/проверяют branch_id для
			// branch_owner — см. CourseHandler.Create/Update/Delete.
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleBranchOwner))
				r.Post("/courses", courseHandler.Create)
				r.Patch("/courses/{id}", courseHandler.Update)
				r.Delete("/courses/{id}", courseHandler.Delete)
			})

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleBranchOwner))
				r.Patch("/enrollments/{id}/assign-tutor", enrollHandler.AssignTutor)
				// 2.1b — назначить/снять преподавателя с курса (course_tutors).
				// branch_owner ограничен своим филиалом — проверяется внутри
				// хендлера (и курс, и сам преподаватель должны быть из его
				// филиала).
				r.Post("/courses/{id}/tutors", courseHandler.AssignTutor)
				r.Delete("/courses/{id}/tutors/{tutorId}", courseHandler.RemoveTutor)
			})

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleOwner, models.RoleBranchOwner, models.RoleTutor))
				r.Patch("/enrollments/{id}", enrollHandler.Update)
				r.Post("/lessons", lessonHandler.Create)
				r.Patch("/lessons/{id}", lessonHandler.Update)
				r.Delete("/lessons/{id}", lessonHandler.Delete)
				r.Post("/lessons/{id}/attendance", lessonHandler.MarkAttendance)
				// Подгруппы: создание/изменение/удаление доступны тем же ролям,
				// что и управление занятиями — доступ дальше сужается внутри
				// хендлера (SubgroupHandler.canManage) по фактическому владельцу.
				r.Post("/subgroups", subgroupHandler.Create)
				r.Patch("/subgroups/{id}", subgroupHandler.Update)
				r.Delete("/subgroups/{id}", subgroupHandler.Delete)
			})

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleTutor))
				r.Post("/homework", homeworkHandler.Create)
				r.Post("/tests", testHandler.Create)
				r.Patch("/tests/{id}/grade", testHandler.Grade)
			})

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireRoles(models.RoleStudent))
				r.Get("/homework/{id}/open", homeworkHandler.Open)
				r.Post("/tests/{id}/submit", testHandler.Submit)
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
