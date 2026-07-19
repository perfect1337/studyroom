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
	repo *repository.CourseRepository
}

func NewCourseHandler(repo *repository.CourseRepository) *CourseHandler {
	return &CourseHandler{repo: repo}
}

// List — GET /courses?branch_id=&subject= (api-contracts.md 2.1).
// Фильтр по branch_id обязателен для всех ролей кроме owner — сервер
// подставляет его принудительно из claims, а не доверяет query-параметру,
// иначе branch_owner/tutor/student/parent смогли бы подсмотреть чужой филиал
// просто поменяв ?branch_id= в адресной строке.
func (h *CourseHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	filter := repository.CourseFilter{Subject: r.URL.Query().Get("subject")}
	if claims.Role == models.RoleOwner {
		branchID, ok := parseIntQuery(r, "branch_id")
		if !ok {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid branch_id")
			return
		}
		filter.BranchID = branchID
	} else {
		if claims.BranchID == nil {
			writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
		filter.BranchID = claims.BranchID
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
	Title       string             `json:"title"`
	Subject     string             `json:"subject"`
	Format      models.CourseFormat `json:"format"`
	Description *string            `json:"description"`
	BranchID    int64              `json:"branch_id"`
}

// Create — POST /courses, owner only (RequireRoles в роутере).
func (h *CourseHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createCourseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.Title == "" || req.Subject == "" || req.BranchID == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "title, subject and branch_id are required")
		return
	}
	if req.Format == "" {
		req.Format = models.FormatIndividual
	}

	course, err := h.repo.Create(r.Context(), &models.Course{
		Title: req.Title, Subject: req.Subject, Format: req.Format,
		Description: req.Description, BranchID: req.BranchID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to create course")
		return
	}
	writeJSON(w, http.StatusCreated, course)
}

type updateCourseRequest struct {
	Title       *string             `json:"title"`
	Subject     *string             `json:"subject"`
	Format      *models.CourseFormat `json:"format"`
	Description *string             `json:"description"`
	BranchID    *int64              `json:"branch_id"`
}

// Update — PATCH /courses/{id}, owner only.
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
	if req.BranchID != nil {
		fields["branch_id"] = *req.BranchID
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

// Delete — DELETE /courses/{id}, owner only.
func (h *CourseHandler) Delete(w http.ResponseWriter, r *http.Request) {
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
