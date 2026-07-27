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
	repo     *repository.CourseRepository
	userRefs *repository.UserRefRepository
	enrollRepo *repository.EnrollmentRepository
	userClient ChildrenResolver
}

func NewCourseHandler(repo *repository.CourseRepository, userRefs *repository.UserRefRepository, enrollRepo *repository.EnrollmentRepository, userClient ChildrenResolver ) *CourseHandler {
	return &CourseHandler{repo: repo, userRefs: userRefs, enrollRepo: enrollRepo, userClient: userClient}
}

// List — GET /courses?branch_id=&subject=&tutor_id= (api-contracts.md 2.1).
// Фильтр по branch_id обязателен для всех ролей кроме owner — сервер
// подставляет его принудительно из claims, а не доверяет query-параметру,
// иначе branch_owner/tutor/student/parent смогли бы подсмотреть чужой филиал
// просто поменяв ?branch_id= в адресной строке.
//
// tutor_id — опциональный доп.фильтр "только курсы, которые ведёт этот
// преподаватель" (через course_tutors). Tutor может передать только
// свой собственный id (используется для "Мои курсы" на фронте) — чужой
// tutor_id ему запрещён, чтобы не подглядывать нагрузку других
// преподавателей своего филиала.
func (h *CourseHandler) List(w http.ResponseWriter, r *http.Request) {
    claims, _ := middleware.FromContext(r.Context())
    filter := repository.CourseFilter{Subject: r.URL.Query().Get("subject")}

    // ---- Родитель: видит курсы, на которые записаны его дети ----
    if claims.Role == models.RoleParent {
        children, err := h.userClient.Children(r.Context(), bearerToken(r), claims.UserID)
        if err != nil {
            writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "failed to resolve children")
            return
        }
        if len(children) == 0 {
            writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
            return
        }
        // Получаем все энролменты для этих детей
        enrollFilter := repository.EnrollmentFilter{StudentIDs: children}
        enrollments, err := h.enrollRepo.List(r.Context(), enrollFilter)
        if err != nil {
            writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to get enrollments")
            return
        }
        // Извлекаем уникальные course_id
        courseIDSet := map[int64]bool{}
        for _, e := range enrollments {
            courseIDSet[e.CourseID] = true
        }
        if len(courseIDSet) == 0 {
            writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
            return
        }
        // Превращаем в слайс
        courseIDs := make([]int64, 0, len(courseIDSet))
        for id := range courseIDSet {
            courseIDs = append(courseIDs, id)
        }
        // Вызываем метод репозитория для получения курсов по списку ID
        courses, err := h.repo.List(r.Context(), repository.CourseFilter{IDs: courseIDs})
		if err != nil {
    		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list courses")
    		return
		}		
        writeJSON(w, http.StatusOK, map[string]any{"items": nonNilCourses(courses)})
        return
    }

    // ---- Остальные роли (owner, branch_owner, tutor, student) ----
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

// AssignTutor — POST /courses/{id}/tutors, owner (любой филиал) или
// branch_owner (только курсы своего филиала, и только преподавателей
// своего же филиала — иначе получится "ведёт курс в чужом филиале",
// что ломает саму идею "ученики = мой филиал + мой курс").
func (h *CourseHandler) AssignTutor(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
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

	course, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "course not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load course")
		return
	}

	if claims.Role == models.RoleBranchOwner {
		if claims.BranchID == nil || *claims.BranchID != course.BranchID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "course belongs to a different branch")
			return
		}
		tutorBranch, err := h.userRefs.BranchOf(r.Context(), req.TutorID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check tutor branch")
			return
		}
		if tutorBranch == nil || *tutorBranch != course.BranchID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "tutor must belong to the course's branch")
			return
		}
	}

	if err := h.repo.AssignTutor(r.Context(), id, req.TutorID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "course not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to assign tutor")
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
	claims, _ := middleware.FromContext(r.Context())
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

	if claims.Role == models.RoleBranchOwner {
		course, err := h.repo.GetByID(r.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				writeError(w, http.StatusNotFound, "NOT_FOUND", "course not found")
				return
			}
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load course")
			return
		}
		if claims.BranchID == nil || *claims.BranchID != course.BranchID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "course belongs to a different branch")
			return
		}
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
