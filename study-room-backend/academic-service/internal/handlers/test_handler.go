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

type TestHandler struct {
	repo       *repository.TestRepository
	userRefs   *repository.UserRefRepository
	userClient ChildrenResolver
}

func NewTestHandler(repo *repository.TestRepository, userRefs *repository.UserRefRepository, userClient ChildrenResolver) *TestHandler {
	return &TestHandler{repo: repo, userRefs: userRefs, userClient: userClient}
}

type createTestRequest struct {
	StudentID int64  `json:"student_id"`
	Title     string `json:"title"`
	LinkURL   string `json:"link_url"`
	// CourseID — необязательная привязка к курсу/предмету, по которому
	// выдан тест (см. models.Test и 0004_tests_course.up.sql). Нужна,
	// чтобы ученик/родитель/админ видели не только название теста, но и
	// курс с предметом в списке (StudentTests/ParentOverview/...).
	CourseID *int64 `json:"course_id"`
}

// Create — POST /tests, tutor only. Как и homework, тест — это ссылка на
// внешний ресурс плюс название, но в отличие от homework у теста есть
// жизненный цикл "сдан/не сдан" и оценка (см. Submit/Grade ниже).
func (h *TestHandler) Create(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	var req createTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.StudentID == 0 || req.Title == "" || req.LinkURL == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "student_id, title and link_url are required")
		return
	}

	t, err := h.repo.Create(r.Context(), req.StudentID, claims.UserID, req.Title, req.LinkURL, req.CourseID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to create test")
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

// List — GET /tests?student_id=&status= — область видимости совпадает с
// homeworkHandler.List (см. комментарий там): tutor видит только свои
// выданные тесты, student — только свои, parent — тесты своих детей,
// branch_owner — тесты учеников своего филиала, owner — всё/по фильтру.
func (h *TestHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	filter := repository.TestFilter{}

	switch claims.Role {
	case models.RoleOwner:
		if v, ok := parseIntQuery(r, "student_id"); ok {
			filter.StudentID = v
		}
	case models.RoleTutor:
		createdBy := claims.UserID
		filter.CreatedBy = &createdBy
	case models.RoleStudent:
		studentID := claims.UserID
		filter.StudentID = &studentID
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
	case models.RoleBranchOwner:
		// область branch_owner фильтруется ниже, после загрузки списка —
		// как в homeworkHandler.List.
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted")
		return
	}

	items, err := h.repo.List(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list tests")
		return
	}

	if claims.Role == models.RoleBranchOwner {
		items, err = h.filterByOwnBranch(r, claims.BranchID, items)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to filter by branch")
			return
		}
	}

	if status := r.URL.Query().Get("status"); status != "" {
		filtered := make([]*models.Test, 0, len(items))
		for _, t := range items {
			if string(t.Status) == status {
				filtered = append(filtered, t)
			}
		}
		items = filtered
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": nonNilTests(items)})
}

// filterByOwnBranch — фильтрует тесты по филиалу их студентов.
//
// Раньше здесь был вызов h.userRefs.BranchOf в цикле — то есть один SQL-запрос
// на каждый элемент списка (N+1). Теперь id студентов собираются один раз и
// филиалы для всех подгружаются одним запросом через BranchesOf — см. тот же
// фикс и комментарий в HomeworkHandler.filterByOwnBranch.
func (h *TestHandler) filterByOwnBranch(r *http.Request, branchID *int64, items []*models.Test) ([]*models.Test, error) {
	if branchID == nil {
		return []*models.Test{}, nil
	}
	if len(items) == 0 {
		return []*models.Test{}, nil
	}

	studentIDs := make([]int64, 0, len(items))
	for _, t := range items {
		studentIDs = append(studentIDs, t.StudentID)
	}

	branches, err := h.userRefs.BranchesOf(r.Context(), studentIDs)
	if err != nil {
		return nil, err
	}

	out := make([]*models.Test, 0, len(items))
	for _, t := range items {
		if studentBranch := branches[t.StudentID]; studentBranch != nil && *studentBranch == *branchID {
			out = append(out, t)
		}
	}
	return out, nil
}

func nonNilTests(t []*models.Test) []*models.Test {
	if t == nil {
		return []*models.Test{}
	}
	return t
}

// Submit — POST /tests/{id}/submit, student only, только свой тест.
// Переводит тест assigned -> submitted ("сдан"); дальше тьютор ставит
// оценку через Grade.
func (h *TestHandler) Submit(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid test id")
		return
	}

	t, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "test not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load test")
		return
	}
	if t.StudentID != claims.UserID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "not your test")
		return
	}

	t, err = h.repo.Submit(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to submit test")
		return
	}
	writeJSON(w, http.StatusOK, t)
}

type gradeTestRequest struct {
	Grade int `json:"grade"`
}

// Grade — PATCH /tests/{id}/grade, tutor only, только тест, который сам
// выдал (created_by = self). Оценка — 1..5 (см. tests_grade_range в
// миграции), можно ставить только после сдачи (status = submitted) —
// иначе оценивать нечего.
func (h *TestHandler) Grade(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid test id")
		return
	}

	var req gradeTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.Grade < 1 || req.Grade > 5 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "grade must be between 1 and 5")
		return
	}

	t, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "test not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load test")
		return
	}
	if t.CreatedBy != claims.UserID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "not your test")
		return
	}
	if t.Status != models.TestSubmitted {
		writeError(w, http.StatusConflict, "CONFLICT", "test is not submitted yet")
		return
	}

	t, err = h.repo.SetGrade(r.Context(), id, req.Grade)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to grade test")
		return
	}
	writeJSON(w, http.StatusOK, t)
}
