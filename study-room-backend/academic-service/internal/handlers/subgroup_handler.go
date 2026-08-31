package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"studyroom/academic-service/internal/auth"
	"studyroom/academic-service/internal/middleware"
	"studyroom/academic-service/internal/models"
	"studyroom/academic-service/internal/repository"
)

// SubgroupHandler — CRUD для подгрупп (сохраняемый набор учеников на
// групповом курсе, переиспользуемый при создании занятий — см.
// LessonHandler.Create, createLessonRequest.SubgroupID). Доступ повторяет
// схему LessonHandler: owner/branch_owner видят и создают подгруппы в
// пределах своей области, tutor — только свои собственные.
type SubgroupHandler struct {
	subgroups   *repository.SubgroupRepository
	courses     *repository.CourseRepository
	enrollments *repository.EnrollmentRepository
	userRefs    *repository.UserRefRepository
}

func NewSubgroupHandler(
	subgroups *repository.SubgroupRepository,
	courses *repository.CourseRepository,
	enrollments *repository.EnrollmentRepository,
	userRefs *repository.UserRefRepository,
) *SubgroupHandler {
	return &SubgroupHandler{subgroups: subgroups, courses: courses, enrollments: enrollments, userRefs: userRefs}
}

// List — GET /subgroups?course_id=&tutor_id=. Как и в остальных List
// (courses/enrollments/lessons), сервер принудительно сужает выборку по
// роли — query-параметры от клиента не расширяют область видимости.
func (h *SubgroupHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	filter := repository.SubgroupFilter{}
	if v, ok := parseIntQuery(r, "course_id"); ok {
		filter.CourseID = v
	}

	switch claims.Role {
	case models.RoleOwner, models.RoleBranchOwner:
		if v, ok := parseIntQuery(r, "tutor_id"); ok {
			filter.TutorID = v
		}
	case models.RoleTutor:
		tutorID := claims.UserID
		filter.TutorID = &tutorID
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted")
		return
	}

	items, err := h.subgroups.List(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load subgroups")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type createSubgroupRequest struct {
	CourseID   int64   `json:"course_id"`
	TutorID    int64   `json:"tutor_id"`
	Name       string  `json:"name"`
	StudentIDs []int64 `json:"student_ids"`
}

// Create — POST /subgroups. Требует курс с format='group' (подгруппа на
// индивидуальном курсе не имеет смысла — там и так всегда один ученик) и
// у каждого student_id — активный enrollment именно на этот курс, той же
// проверкой, что и single-student занятие в LessonHandler.Create.
func (h *SubgroupHandler) Create(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	var req createSubgroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.CourseID == 0 || req.Name == "" || len(req.StudentIDs) == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "course_id, name, student_ids are required")
		return
	}

	switch claims.Role {
	case models.RoleOwner:
		if req.TutorID == 0 {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "tutor_id is required")
			return
		}
	case models.RoleBranchOwner:
		if req.TutorID == 0 {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "tutor_id is required")
			return
		}
		tutorBranch, err := h.userRefs.BranchOf(r.Context(), req.TutorID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check tutor branch")
			return
		}
		if claims.BranchID == nil || tutorBranch == nil || *claims.BranchID != *tutorBranch {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "tutor_id must belong to your branch")
			return
		}
	case models.RoleTutor:
		req.TutorID = claims.UserID
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted")
		return
	}

	course, err := h.courses.GetByID(r.Context(), req.CourseID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "course not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load course")
		return
	}
	if course.Format != models.FormatGroup {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "subgroups are only available for group-format courses")
		return
	}

	enrollments, err := h.enrollments.List(r.Context(), repository.EnrollmentFilter{CourseID: &req.CourseID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load course enrollments")
		return
	}
	activeOnCourse := make(map[int64]bool, len(enrollments))
	for _, e := range enrollments {
		if e.Status == models.EnrollmentActive {
			activeOnCourse[e.StudentID] = true
		}
	}
	for _, studentID := range req.StudentIDs {
		if !activeOnCourse[studentID] {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "all students must have an active enrollment on this course")
			return
		}
	}

	sg, err := h.subgroups.Create(r.Context(), req.CourseID, req.TutorID, req.Name, req.StudentIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to create subgroup")
		return
	}
	writeJSON(w, http.StatusCreated, sg)
}

type updateSubgroupRequest struct {
	Name       *string  `json:"name"`
	StudentIDs *[]int64 `json:"student_ids"`
}

// Update — PATCH /subgroups/{id}. Оба поля опциональны и независимы: можно
// прислать только name (переименование) или только student_ids (замена
// состава целиком, без diff'а add/remove — см. SetMembers).
func (h *SubgroupHandler) Update(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}

	sg, err := h.subgroups.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "subgroup not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load subgroup")
		return
	}
	if !h.canManage(r, claims, sg) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "not allowed to modify this subgroup")
		return
	}

	var req updateSubgroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	if req.Name != nil {
		if *req.Name == "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "name cannot be empty")
			return
		}
		if err := h.subgroups.Rename(r.Context(), id, *req.Name); err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to rename subgroup")
			return
		}
	}

	if req.StudentIDs != nil {
		if len(*req.StudentIDs) == 0 {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "student_ids cannot be empty")
			return
		}
		enrollments, err := h.enrollments.List(r.Context(), repository.EnrollmentFilter{CourseID: &sg.CourseID})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load course enrollments")
			return
		}
		activeOnCourse := make(map[int64]bool, len(enrollments))
		for _, e := range enrollments {
			if e.Status == models.EnrollmentActive {
				activeOnCourse[e.StudentID] = true
			}
		}
		for _, studentID := range *req.StudentIDs {
			if !activeOnCourse[studentID] {
				writeError(w, http.StatusBadRequest, "BAD_REQUEST", "all students must have an active enrollment on this course")
				return
			}
		}
		if err := h.subgroups.SetMembers(r.Context(), id, *req.StudentIDs); err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to update subgroup members")
			return
		}
	}

	updated, err := h.subgroups.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load subgroup")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *SubgroupHandler) Delete(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}

	sg, err := h.subgroups.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "subgroup not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load subgroup")
		return
	}
	if !h.canManage(r, claims, sg) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "not allowed to delete this subgroup")
		return
	}

	if err := h.subgroups.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to delete subgroup")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// canManage — owner может всё; branch_owner — если подгруппа принадлежит
// тьютору его филиала; tutor — только свою собственную (сравнение по
// TutorID, а не по участию в занятии — подгруппа приватна для создателя,
// как и в LessonHandler.List/Update для собственных занятий тьютора).
func (h *SubgroupHandler) canManage(r *http.Request, claims *auth.Claims, sg *models.Subgroup) bool {
	switch claims.Role {
	case models.RoleOwner:
		return true
	case models.RoleBranchOwner:
		tutorBranch, err := h.userRefs.BranchOf(r.Context(), sg.TutorID)
		if err != nil || tutorBranch == nil || claims.BranchID == nil {
			return false
		}
		return *claims.BranchID == *tutorBranch
	case models.RoleTutor:
		return claims.UserID == sg.TutorID
	default:
		return false
	}
}
