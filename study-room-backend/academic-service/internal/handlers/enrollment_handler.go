package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"studyroom/academic-service/internal/auth"
	"studyroom/academic-service/internal/middleware"
	"studyroom/academic-service/internal/models"
	"studyroom/academic-service/internal/repository"
)

type EnrollmentHandler struct {
	repo       *repository.EnrollmentRepository
	userClient ChildrenResolver
}

func NewEnrollmentHandler(repo *repository.EnrollmentRepository, userClient ChildrenResolver) *EnrollmentHandler {
	return &EnrollmentHandler{repo: repo, userClient: userClient}
}

type createEnrollmentRequest struct {
	StudentID int64 `json:"student_id"`
	CourseID  int64 `json:"course_id"`
}

// Create — POST /enrollments, owner only. Ручной способ, для случаев без
// договора (см. api-contracts.md 2.4) — основной путь это событие
// contract.created, см. internal/events/subscriber.go.
func (h *EnrollmentHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createEnrollmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.StudentID == 0 || req.CourseID == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "student_id and course_id are required")
		return
	}

	enrollment, err := h.repo.Create(r.Context(), req.StudentID, req.CourseID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to create enrollment")
		return
	}
	writeJSON(w, http.StatusCreated, enrollment)
}

type assignTutorRequest struct {
	TutorID int64 `json:"tutor_id"`
}

// AssignTutor — PATCH /enrollments/{id}/assign-tutor. owner (любой филиал),
// branch_owner (только записи своего филиала) — см. api-contracts.md 2.4a.
func (h *EnrollmentHandler) AssignTutor(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid enrollment id")
		return
	}

	var req assignTutorRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.TutorID == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "tutor_id is required")
		return
	}

	if claims.Role == models.RoleBranchOwner {
		if !h.enrollmentInOwnBranch(w, r, id, claims) {
			return
		}
	}

	existing, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "enrollment not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load enrollment")
		return
	}
	// Личным тьютором ученика на курсе можно назначить только того, кто
	// вообще ведёт этот курс (course_tutors) — иначе легко получить
	// рассинхрон: enrollments.tutor_id указывает на человека, который
	// в этом курсе формально не преподаёт.
	teachesCourse, err := h.repo.CourseTaughtBy(r.Context(), existing.CourseID, req.TutorID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check course access")
		return
	}
	if !teachesCourse {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "tutor_id does not teach this course")
		return
	}

	enrollment, err := h.repo.AssignTutor(r.Context(), id, req.TutorID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "enrollment not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to assign tutor")
		return
	}
	writeJSON(w, http.StatusOK, enrollment)
}

// enrollmentInOwnBranch — true, если запись относится к курсу филиала
// вызывающего branch_owner; иначе пишет 403/404 в w сама и возвращает false.
func (h *EnrollmentHandler) enrollmentInOwnBranch(w http.ResponseWriter, r *http.Request, enrollmentID int64, claims *auth.Claims) bool {
	enrollment, err := h.repo.GetByID(r.Context(), enrollmentID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "enrollment not found")
			return false
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load enrollment")
		return false
	}
	branchID, err := h.repo.EnrollmentStudentBranchID(r.Context(), enrollment.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check branch")
		return false
	}
	if claims.BranchID == nil || *claims.BranchID != branchID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "enrollment belongs to a different branch")
		return false
	}
	return true
}

// List — GET /enrollments?student_id=&tutor_id=&course_id= (api-contracts.md
// 2.5). Каждая роль получает вынужденный фильтр поверх того, что просит
// клиент в query — сервер никогда не доверяет клиенту границу доступа:
//   - tutor: только свои (tutor_id = claims.UserID, query игнорируется)
//   - parent: только свои дети (список получаем синхронно у User Service)
//   - student: только себя (student_id = claims.UserID)
//   - branch_owner: только свой филиал (по филиалу ученика в user_refs)
//   - owner: без ограничений, использует query как есть
func (h *EnrollmentHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	filter := repository.EnrollmentFilter{}

	switch claims.Role {
	case models.RoleOwner:
		if v, ok := parseIntQuery(r, "student_id"); ok {
			filter.StudentID = v
		}
		if v, ok := parseIntQuery(r, "tutor_id"); ok {
			filter.TutorID = v
		}
		if v, ok := parseIntQuery(r, "course_id"); ok {
			filter.CourseID = v
		}
	case models.RoleBranchOwner:
		if claims.BranchID == nil {
			writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
		filter.BranchID = claims.BranchID
		if v, ok := parseIntQuery(r, "tutor_id"); ok {
			filter.TutorID = v
		}
		if v, ok := parseIntQuery(r, "course_id"); ok {
			filter.CourseID = v
		}
	case models.RoleTutor:
		// "Мои ученики" — ученики его филиала, записанные на курс(ы),
		// которые он реально ведёт (course_tutors), а не только те, кому
		// его вручную проставили в enrollments.tutor_id (см. ADR в
		// repository.EnrollmentRepository.ListForTutor).
		if claims.BranchID == nil {
			writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
		var courseID *int64
		if v, ok := parseIntQuery(r, "course_id"); ok {
			courseID = v
		}
		enrollments, err := h.repo.ListForTutor(r.Context(), claims.UserID, claims.BranchID, courseID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list enrollments")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": nonNilEnrollments(enrollments)})
		return
	case models.RoleStudent:
		studentID := claims.UserID
		filter.StudentID = &studentID
		// Ученик видит только текущие активные записи на курсы.
		// История completed/terminated доступна владельцу сети.
		filter.Status = "active"
	case models.RoleParent:
		children, err := h.userClient.Children(r.Context(), bearerToken(r), claims.UserID)
		if err != nil {
			writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "failed to resolve children")
			return
		}
		if len(children) == 0 {
			writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
		filter.StudentIDs = children
		// Родитель видит только активные записи на текущие курсы.
		// История завершённых/расторгнутых курсов оставляется staff-ролям.
		filter.Status = "active"
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted")
		return
	}

	enrollments, err := h.repo.List(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list enrollments")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": nonNilEnrollments(enrollments)})
}

func nonNilEnrollments(e []*models.Enrollment) []*models.Enrollment {
	if e == nil {
		return []*models.Enrollment{}
	}
	return e
}

type updateEnrollmentRequest struct {
	Status    *string `json:"status"`
	StartDate *string `json:"start_date"`
	EndDate   *string `json:"end_date"`
}

// Update — PATCH /enrollments/{id}. tutor (свои ученики), owner,
// branch_owner (свой филиал) — см. api-contracts.md 2.6.
//
// progress_pct сюда больше не принимается: прогресс ученика по курсу
// теперь считается автоматически, по количеству занятий, которые
// преподаватель реально отметил как проведённые (status='completed') —
// см. repository.EnrollmentRepository.RecalculateProgress, вызывается из
// LessonHandler при создании/изменении/отмене занятия. Если в теле запроса
// всё же придёт progress_pct, поле просто игнорируется.
func (h *EnrollmentHandler) Update(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid enrollment id")
		return
	}

	enrollment, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "enrollment not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load enrollment")
		return
	}

	switch claims.Role {
	case models.RoleOwner:
		// без ограничений
	case models.RoleBranchOwner:
		branchID, err := h.repo.EnrollmentStudentBranchID(r.Context(), enrollment.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check branch")
			return
		}
		if claims.BranchID == nil || *claims.BranchID != branchID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "enrollment belongs to a different branch")
			return
		}
	case models.RoleTutor:
		isAssigned := enrollment.TutorID != nil && *enrollment.TutorID == claims.UserID
		if !isAssigned {
			teachesCourse, err := h.repo.CourseTaughtBy(r.Context(), enrollment.CourseID, claims.UserID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check course access")
				return
			}
			if !teachesCourse {
				writeError(w, http.StatusForbidden, "FORBIDDEN", "not your student")
				return
			}
		}
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted")
		return
	}

	var req updateEnrollmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	fields := map[string]any{}
	if req.Status != nil {
		fields["status"] = *req.Status
	}
	if req.StartDate != nil {
		fields["start_date"] = *req.StartDate
	}
	if req.EndDate != nil {
		fields["end_date"] = *req.EndDate
	}

	updated, err := h.repo.UpdateProgress(r.Context(), id, fields)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to update enrollment")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func bearerToken(r *http.Request) string {
	return strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
}
