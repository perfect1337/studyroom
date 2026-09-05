package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"studyroom/academic-service/internal/middleware"
	"studyroom/academic-service/internal/models"
	"studyroom/academic-service/internal/repository"
)

type CourseHandler struct {
	repo       *repository.CourseRepository
	userRefs   *repository.UserRefRepository
	enrollRepo *repository.EnrollmentRepository
	userClient ChildrenResolver
}

func NewCourseHandler(repo *repository.CourseRepository, userRefs *repository.UserRefRepository, enrollRepo *repository.EnrollmentRepository, userClient ChildrenResolver) *CourseHandler {
	return &CourseHandler{repo: repo, userRefs: userRefs, enrollRepo: enrollRepo, userClient: userClient}
}

// List — GET /courses?subject=&tutor_id= (api-contracts.md 2.1). Курсы не
// привязаны к филиалу — весь каталог курсов общий для всей сети, виден
// всем ролям одинаково, включая родителя (roles: "любая" в контракте).
//
// Раньше для parent тут была отдельная ветка, которая возвращала только
// курсы, на которые уже есть enrollments у его детей. Это ломало форму
// "Записаться на новый курс" на фронте (ParentOverview) — она использует
// этот же список для выбора предмета при подаче заявки на новый курс, и
// с той логикой список всегда был пустым, пока ребёнка не запишут хоть
// куда-то вручную (замкнутый круг: чтобы записаться, нужно быть уже
// записанным). Контракт 2.1 такого ограничения не предполагает, поэтому
// родитель просто идёт по общей ветке ниже, как owner/branch_owner/tutor/
// student.
//
// tutor_id — опциональный доп.фильтр "только курсы, которые ведёт этот
// преподаватель" (через course_tutors). Tutor может передать только
// свой собственный id (используется для "Мои курсы" на фронте) — чужой
// tutor_id ему запрещён, чтобы не подглядывать нагрузку других
// преподавателей.
func (h *CourseHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	filter := repository.CourseFilter{Subject: r.URL.Query().Get("subject")}

	if v, ok := parseIntQuery(r, "tutor_id"); ok && v != nil {
		if claims.Role == models.RoleTutor && *v != claims.UserID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "tutor can only filter by their own tutor_id")
			return
		}
		filter.TutorID = v
	}

	courses, err := h.repo.List(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list courses")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": nonNilCourses(courses)})
}

func nonNilCourses(c []*models.Course) []*models.Course {
	if c == nil {
		return []*models.Course{}
	}
	return c
}

type createCourseRequest struct {
	Title       string              `json:"title"`
	Subject     string              `json:"subject"`
	Format      models.CourseFormat `json:"format"`
	Description *string             `json:"description"`
}

// Create — POST /courses, roles: owner, branch_owner. Курс общий для всей
// сети — филиал не указывается и не сохраняется.
func (h *CourseHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createCourseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	if req.Title == "" || req.Subject == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "title and subject are required")
		return
	}
	if req.Format == "" {
		req.Format = models.FormatIndividual
	}

	course, err := h.repo.Create(r.Context(), &models.Course{
		Title: req.Title, Subject: req.Subject, Format: req.Format,
		Description: req.Description,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to create course")
		return
	}
	writeJSON(w, http.StatusCreated, course)
}

type updateCourseRequest struct {
	Title       *string              `json:"title"`
	Subject     *string              `json:"subject"`
	Format      *models.CourseFormat `json:"format"`
	Description *string              `json:"description"`
}

// Update — PATCH /courses/{id}, roles: owner, branch_owner. Курс общий для
// всей сети, поэтому доступен для редактирования из любого филиала.
// Разрешено менять любое из полей курса (title, subject, format,
// description) — как по отдельности, так и все сразу.
func (h *CourseHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid course id")
		return
	}

	var req updateCourseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	fields := map[string]any{}
	if req.Title != nil {
		fields["title"] = *req.Title
	}
	if req.Subject != nil {
		fields["subject"] = *req.Subject
	}
	if req.Format != nil {
		fields["format"] = *req.Format
	}
	if req.Description != nil {
		fields["description"] = *req.Description
	}

	course, err := h.repo.Update(r.Context(), id, fields)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "course not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to update course")
		return
	}
	writeJSON(w, http.StatusOK, course)
}

// Delete — DELETE /courses/{id}, roles: owner ТОЛЬКО. branch_owner удалять
// курсы не может (даже несмотря на то, что может их создавать и
// редактировать) — удаление курса общей сети затрагивает все филиалы сразу
// (enrollments, договоры, история занятий), поэтому оставлено только
// владельцу сети. Ограничение задаётся на уровне роута (см. app.go —
// отдельная r.Group только с RoleOwner), но проверяем роль ещё раз и здесь,
// чтобы хендлер был защищён сам по себе, даже если роут когда-нибудь
// случайно окажется не в той группе.
func (h *CourseHandler) Delete(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	if claims.Role != models.RoleOwner {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only owner can delete courses")
		return
	}

	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid course id")
		return
	}

	if err := h.repo.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "course not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to delete course")
		return
	}
	w.WriteHeader(http.StatusOK)
}

// ListTutors — GET /courses/{id}/tutors. Любая аутентифицированная роль
// (как и GET /courses) — список id преподавателей курса сам по себе не
// секрет внутри системы.
func (h *CourseHandler) ListTutors(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid course id")
		return
	}
	tutorIDs, err := h.repo.ListTutorIDs(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list course tutors")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tutor_ids": tutorIDs})
}

type assignCourseTutorRequest struct {
	TutorID int64 `json:"tutor_id"`
}

// AssignTutor — POST /courses/{id}/tutors, owner или branch_owner. Курс
// общий для всей сети, поэтому доступен из любого филиала; преподаватель
// может быть назначен на курс независимо от своего филиала.
func (h *CourseHandler) AssignTutor(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid course id")
		return
	}

	var req assignCourseTutorRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.TutorID == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "tutor_id is required")
		return
	}

	if _, err := h.repo.GetByID(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "course not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load course")
		return
	}

	if err := h.repo.AssignTutor(r.Context(), id, req.TutorID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "course not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to assign tutor")
		return
	}

	// Курс мог "осиротеть" (остаться без единого преподавателя) после
	// увольнения — тогда его active enrollments поставили на паузу (см.
	// events/subscriber.go: detachTutor -> PauseOrphanedForCourses). Теперь,
	// когда курсу назначили преподавателя (в том числе того же самого,
	// восстановленного в штате), возвращаем эти записи в активное состояние
	// и явно закрепляем их за новым tutor'ом — см.
	// EnrollmentRepository.ResumeOrphanedForCourse.
	if err := h.enrollRepo.ResumeOrphanedForCourse(r.Context(), id, req.TutorID); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to resume paused enrollments")
		return
	}

	updated, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load course")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// RemoveTutor — DELETE /courses/{id}/tutors/{tutorId}. Те же права, что и
// на AssignTutor.
func (h *CourseHandler) RemoveTutor(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid course id")
		return
	}
	tutorID, err := parseIntPath(chi.URLParam(r, "tutorId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid tutor id")
		return
	}

	if err := h.repo.RemoveTutor(r.Context(), id, tutorID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "course/tutor assignment not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to remove tutor")
		return
	}
	w.WriteHeader(http.StatusOK)
}
