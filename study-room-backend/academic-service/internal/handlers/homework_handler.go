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

type HomeworkHandler struct {
	repo       *repository.HomeworkRepository
	userRefs   *repository.UserRefRepository
	userClient ChildrenResolver
}

func NewHomeworkHandler(repo *repository.HomeworkRepository, userRefs *repository.UserRefRepository, userClient ChildrenResolver) *HomeworkHandler {
	return &HomeworkHandler{repo: repo, userRefs: userRefs, userClient: userClient}
}

type createHomeworkRequest struct {
	StudentID int64  `json:"student_id"`
	LinkURL   string `json:"link_url"`
}

// Create — POST /homework, tutor only (api-contracts.md 2.12). Никаких
// title/description/срока сдачи — задание это просто ссылка.
func (h *HomeworkHandler) Create(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	var req createHomeworkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.StudentID == 0 || req.LinkURL == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "student_id and link_url are required")
		return
	}

	hw, err := h.repo.Create(r.Context(), req.StudentID, claims.UserID, req.LinkURL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to create homework")
		return
	}
	writeJSON(w, http.StatusCreated, hw)
}

// List — GET /homework?student_id=&status= (api-contracts.md 2.13).
//   - tutor: только свои выданные (created_by = self)
//   - student: только свои (student_id = self)
//   - parent: только детские (список детей из User Service)
//   - owner/branch_owner: "в рамках доступной области" — поскольку у
//     домашки нет своего branch_id, для branch_owner область — ученики
//     своего филиала (фильтруем по user_refs.branch_id); owner не ограничен.
//
// Фильтр по status применяется после запроса (полей немного, отдельный
// SQL-параметр избыточен для этого объёма данных).
func (h *HomeworkHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	filter := repository.HomeworkFilter{}

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
		// область branch_owner — ученики его филиала; фильтруем в памяти,
		// т.к. связи "ученик -> branch_id" физически лежат в user_refs,
		// а не в homework.
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted")
		return
	}

	items, err := h.repo.List(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list homework")
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
		filtered := make([]*models.Homework, 0, len(items))
		for _, hw := range items {
			if string(hw.Status) == status {
				filtered = append(filtered, hw)
			}
		}
		items = filtered
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": nonNilHomework(items)})
}

// filterByOwnBranch — фильтрует домашки по филиалу их студентов.
//
// Раньше здесь был вызов h.userRefs.BranchOf в цикле — то есть один SQL-запрос
// на каждый элемент списка (N+1). При больших списках (много домашки в
// системе) это N лишних round-trip'ов к БД на один HTTP-запрос. Теперь id
// студентов собираются один раз и филиалы для всех подгружаются одним
// запросом через BranchesOf — фильтрация происходит по уже загруженной map.
func (h *HomeworkHandler) filterByOwnBranch(r *http.Request, branchID *int64, items []*models.Homework) ([]*models.Homework, error) {
	if branchID == nil {
		return []*models.Homework{}, nil
	}
	if len(items) == 0 {
		return []*models.Homework{}, nil
	}

	studentIDs := make([]int64, 0, len(items))
	for _, hw := range items {
		studentIDs = append(studentIDs, hw.StudentID)
	}

	branches, err := h.userRefs.BranchesOf(r.Context(), studentIDs)
	if err != nil {
		return nil, err
	}

	out := make([]*models.Homework, 0, len(items))
	for _, hw := range items {
		if studentBranch := branches[hw.StudentID]; studentBranch != nil && *studentBranch == *branchID {
			out = append(out, hw)
		}
	}
	return out, nil
}

func nonNilHomework(h []*models.Homework) []*models.Homework {
	if h == nil {
		return []*models.Homework{}
	}
	return h
}

// Open — GET /homework/{id}/open, student only, только своё задание
// (api-contracts.md 2.14). Редиректит на link_url; первый переход
// переводит статус assigned -> viewed.
func (h *HomeworkHandler) Open(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid homework id")
		return
	}

	hw, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "homework not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load homework")
		return
	}
	if hw.StudentID != claims.UserID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "not your homework")
		return
	}

	if hw.Status == models.HomeworkAssigned {
		if _, err := h.repo.MarkViewed(r.Context(), id); err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to mark homework as viewed")
			return
		}
	}

	http.Redirect(w, r, hw.LinkURL, http.StatusFound)
}
