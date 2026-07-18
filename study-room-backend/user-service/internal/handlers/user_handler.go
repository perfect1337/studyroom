package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"studyroom/user-service/internal/auth"
	"studyroom/user-service/internal/middleware"
	"studyroom/user-service/internal/models"
	"studyroom/user-service/internal/repository"
)

type UserHandler struct {
	users        *repository.UserRepository
	branches     *repository.BranchRepository
	parentChild  *repository.ParentChildRepository
}

func NewUserHandler(users *repository.UserRepository, branches *repository.BranchRepository, pc *repository.ParentChildRepository) *UserHandler {
	return &UserHandler{users: users, branches: branches, parentChild: pc}
}

// --- 1.6. GET /users/me ---
func (h *UserHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	u, err := h.users.GetByID(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// --- 1.7. PATCH /users/me ---
func (h *UserHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	var body struct {
		FirstName  *string `json:"first_name"`
		LastName   *string `json:"last_name"`
		Patronymic *string `json:"patronymic"`
		AvatarURL  *string `json:"avatar_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}
	fields := map[string]any{}
	if body.FirstName != nil {
		fields["first_name"] = *body.FirstName
	}
	if body.LastName != nil {
		fields["last_name"] = *body.LastName
	}
	if body.Patronymic != nil {
		fields["patronymic"] = *body.Patronymic
	}
	if body.AvatarURL != nil {
		fields["avatar_url"] = *body.AvatarURL
	}
	updated, err := h.users.Update(r.Context(), claims.UserID, fields)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// --- 1.8. POST /users/me/change-password ---
func (h *UserHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "new_password min 8 chars")
		return
	}
	u, err := h.users.GetByID(r.Context(), claims.UserID)
	if err != nil || !auth.CheckPassword(body.CurrentPassword, u.PasswordHash) {
		writeError(w, http.StatusBadRequest, "INVALID_CREDENTIALS", "current password is incorrect")
		return
	}
	newHash, err := auth.HashPassword(body.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "hashing failed")
		return
	}
	if _, err := h.users.Update(r.Context(), claims.UserID, map[string]any{"password_hash": newHash}); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
		return
	}
	w.WriteHeader(http.StatusOK)
}

// --- 1.9. GET /users ---
func (h *UserHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	q := r.URL.Query()

	filter := repository.ListFilter{Search: q.Get("search")}
	if roleStr := q.Get("role"); roleStr != "" {
		role := models.Role(roleStr)
		filter.Role = &role
	}
	if page, err := strconv.Atoi(q.Get("page")); err == nil {
		filter.Page = page
	}
	if filter.Page < 1 {
		filter.Page = 1
	}

	// branch_owner не может обойти ограничение своим фильтром — сервер
	// принудительно подставляет его собственный branch_id (см. контракт 1.9).
	if claims.Role == models.RoleBranchOwner {
		filter.BranchID = claims.BranchID
	} else if bidStr := q.Get("branch_id"); bidStr != "" {
		if bid, err := strconv.ParseInt(bidStr, 10, 64); err == nil {
			filter.BranchID = &bid
		}
	}

	users, total, err := h.users.List(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": users, "total": total, "page": filter.Page})
}

// --- 1.10. GET /users/{id} ---
func (h *UserHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	claims, _ := middleware.FromContext(r.Context())

	target, err := h.users.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		return
	}

	if !canViewUser(r, h, claims, target) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "not allowed to view this user")
		return
	}
	writeJSON(w, http.StatusOK, target)
}

// canViewUser реализует правила из контракта 1.10: owner — все; branch_owner —
// только свой филиал; parent — только свои дети; сам пользователь — себя.
// (Проверку "tutor -> свой ученик" здесь сделать нельзя: это знает только
// Academic Service, у User Service такой информации нет — TODO: синхронный
// вызов в Academic Service или локальный кэш enrollments, когда он появится.)
func canViewUser(r *http.Request, h *UserHandler, claims *auth.Claims, target *models.User) bool {
	if claims.Role == models.RoleOwner {
		return true
	}
	if claims.UserID == target.ID {
		return true
	}
	if claims.Role == models.RoleBranchOwner {
		return target.BranchID != nil && claims.BranchID != nil && *target.BranchID == *claims.BranchID
	}
	if claims.Role == models.RoleParent {
		isParent, err := h.parentChild.IsParentOf(r.Context(), claims.UserID, target.ID)
		return err == nil && isParent
	}
	return false
}

// --- 1.11. POST /users/tutors ---
type createTutorRequest struct {
	Email          string  `json:"email"`
	Phone          *string `json:"phone"`
	LastName       string  `json:"last_name"`
	FirstName      string  `json:"first_name"`
	Patronymic     *string `json:"patronymic"`
	BranchID       *int64  `json:"branch_id"`
	Specialization string  `json:"specialization"`
}

func (h *UserHandler) CreateTutor(w http.ResponseWriter, r *http.Request) {
	var req createTutorRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}
	tempPassword, err := auth.GenerateOpaqueToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "token generation failed")
		return
	}
	tempPassword = tempPassword[:12] // временный пароль покороче токена

	hash, err := auth.HashPassword(tempPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "hashing failed")
		return
	}

	u := &models.User{
		Email: req.Email, Phone: req.Phone, PasswordHash: hash, Role: models.RoleTutor,
		LastName: req.LastName, FirstName: req.FirstName, Patronymic: req.Patronymic,
		BranchID: req.BranchID, IsActive: true,
	}
	created, err := h.users.Create(r.Context(), u)
	if err != nil {
		if errors.Is(err, repository.ErrDuplicate) {
			writeError(w, http.StatusConflict, "ALREADY_EXISTS", "email or phone already registered")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "could not create tutor")
		return
	}

	// TODO: создать строку в tutor_profiles (specialization и т.д.) —
	// вынесено отдельным шагом, т.к. профиль — таблица 1-к-1, отдельная от users.
	// TODO: опубликовать user.created, Notification Service отправит tempPassword на email.

	writeJSON(w, http.StatusCreated, map[string]any{"user": created, "temp_password": tempPassword})
}

// --- 1.12. POST /users/students ---
type createStudentRequest struct {
	LastName   string  `json:"last_name"`
	FirstName  string  `json:"first_name"`
	Patronymic *string `json:"patronymic"`
	ClassInfo  *string `json:"class_info"`
	School     *string `json:"school"`
	BranchID   *int64  `json:"branch_id"`
	ParentID   int64   `json:"parent_id"`
}

func (h *UserHandler) CreateStudent(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	var req createStudentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}

	// parent может создать ребёнка только себе — см. контракт 1.12
	if claims.Role == models.RoleParent && req.ParentID != claims.UserID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "parent_id must be your own id")
		return
	}

	tempPassword, _ := auth.GenerateOpaqueToken()
	tempPassword = tempPassword[:12]
	hash, err := auth.HashPassword(tempPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "hashing failed")
		return
	}

	// email/логин ученика генерируется автоматически — у младших школьников
	// обычно нет своей почты; используем служебный псевдо-email на базе id.
	// Настоящую отправку данных для входа делает Notification Service по email родителя.
	placeholderEmail := "student+pending@studyroom.internal"

	u := &models.User{
		Email: placeholderEmail, PasswordHash: hash, Role: models.RoleStudent,
		LastName: req.LastName, FirstName: req.FirstName, Patronymic: req.Patronymic,
		BranchID: req.BranchID, IsActive: true,
	}
	created, err := h.users.Create(r.Context(), u)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "could not create student")
		return
	}

	if err := h.parentChild.Link(r.Context(), req.ParentID, created.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "could not link parent")
		return
	}

	// TODO: создать student_profiles (class_info, school), обновить email на
	// реальный сгенерированный (id-based) теперь, когда known ID, и отправить
	// событие user.created с temp_password на email родителя через Notification Service.

	writeJSON(w, http.StatusCreated, created)
}

// --- 1.13. PATCH /users/{id} ---
func (h *UserHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	claims, _ := middleware.FromContext(r.Context())

	target, err := h.users.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		return
	}
	if claims.Role != models.RoleOwner {
		if claims.Role != models.RoleBranchOwner || target.BranchID == nil || claims.BranchID == nil || *target.BranchID != *claims.BranchID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "not allowed to edit this user")
			return
		}
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}
	// Разрешаем редактировать только эти поля — чтобы через PATCH нельзя было
	// незаметно подменить role/email/is_active в обход выделенных под это методов.
	allowed := map[string]bool{"first_name": true, "last_name": true, "patronymic": true, "avatar_url": true}
	fields := map[string]any{}
	for k, v := range body {
		if allowed[k] {
			fields[k] = v
		}
	}

	updated, err := h.users.Update(r.Context(), id, fields)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// --- 1.14. PATCH /users/{id}/status ---
func (h *UserHandler) SetStatus(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	var body struct {
		IsActive bool `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}
	if _, err := h.users.Update(r.Context(), id, map[string]any{"is_active": body.IsActive}); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
		return
	}
	w.WriteHeader(http.StatusOK)
}

// --- 1.16. GET /branches ---
func (h *UserHandler) ListBranches(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	var onlyID *int64
	if claims.Role == models.RoleBranchOwner {
		onlyID = claims.BranchID
	}
	branches, err := h.branches.List(r.Context(), onlyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": branches})
}

// --- 1.17. POST /branches ---
func (h *UserHandler) CreateBranch(w http.ResponseWriter, r *http.Request) {
	var body models.Branch
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}
	created, err := h.branches.Create(r.Context(), &body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "create failed")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

// --- 1.18. GET /parents/{parentId}/children ---
func (h *UserHandler) ListChildren(w http.ResponseWriter, r *http.Request) {
	parentID, err := strconv.ParseInt(chi.URLParam(r, "parentId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid parentId")
		return
	}
	claims, _ := middleware.FromContext(r.Context())
	if claims.Role == models.RoleParent && claims.UserID != parentID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "can only view your own children")
		return
	}

	// Упрощённая реализация через List: в реальности лучше отдельным JOIN-запросом
	// repository.ParentChildRepository, здесь для краткости фильтруем по списку.
	students, _, err := h.users.List(r.Context(), repository.ListFilter{Role: rolePtr(models.RoleStudent), PerPage: 100})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
		return
	}
	var children []*models.User
	for _, s := range students {
		isChild, err := h.parentChild.IsParentOf(r.Context(), parentID, s.ID)
		if err == nil && isChild {
			children = append(children, s)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": children})
}

func rolePtr(r models.Role) *models.Role { return &r }
