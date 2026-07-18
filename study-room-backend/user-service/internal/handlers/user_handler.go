package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"studyroom/user-service/internal/auth"
	"studyroom/user-service/internal/middleware"
	"studyroom/user-service/internal/models"
	"studyroom/user-service/internal/repository"
)

type UserHandler struct {
	users         *repository.UserRepository
	branches      *repository.BranchRepository
	parentChild   *repository.ParentChildRepository
	authRepo      *repository.AuthRepository
	tutorProfiles *repository.TutorProfileRepository
}

func NewUserHandler(
	users *repository.UserRepository,
	branches *repository.BranchRepository,
	pc *repository.ParentChildRepository,
	authRepo *repository.AuthRepository,
	tutorProfiles *repository.TutorProfileRepository,
) *UserHandler {
	return &UserHandler{
		users: users, branches: branches, parentChild: pc,
		authRepo: authRepo, tutorProfiles: tutorProfiles,
	}
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
	_ = h.authRepo.RevokeAllRefreshTokens(r.Context(), claims.UserID)
	w.WriteHeader(http.StatusOK)
}

// --- 1.9. GET /users — справочник «мои люди» ---
type usersDirectoryResponse struct {
	Children     []*models.User `json:"children"`
	Students     []*models.User `json:"students"`
	Tutors       []*models.User `json:"tutors"`
	BranchOwners []*models.User `json:"branch_owners"`
	Parents      []*models.User `json:"parents"`
}

func emptyDirectory() usersDirectoryResponse {
	return usersDirectoryResponse{
		Children:     []*models.User{},
		Students:     []*models.User{},
		Tutors:       []*models.User{},
		BranchOwners: []*models.User{},
		Parents:      []*models.User{},
	}
}

func (h *UserHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	q := r.URL.Query()
	search := q.Get("search")

	var branchFilter *int64
	switch claims.Role {
	case models.RoleBranchOwner, models.RoleTutor:
		if claims.BranchID == nil {
			// Без филиала — пустой справочник, а не утечка всех учеников.
			writeJSON(w, http.StatusOK, emptyDirectory())
			return
		}
		branchFilter = claims.BranchID
	case models.RoleOwner:
		if bidStr := q.Get("branch_id"); bidStr != "" {
			if bid, err := strconv.ParseInt(bidStr, 10, 64); err == nil {
				branchFilter = &bid
			}
		}
	}

	out := emptyDirectory()
	ctx := r.Context()

	switch claims.Role {
	case models.RoleParent:
		children, err := h.parentChild.ListChildren(ctx, claims.UserID, search)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
			return
		}
		if children != nil {
			out.Children = children
		}

	case models.RoleTutor:
		students, err := h.users.ListAll(ctx, repository.ListFilter{
			Role: rolePtr(models.RoleStudent), BranchID: branchFilter, Search: search,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
			return
		}
		if students != nil {
			out.Students = students
		}

	case models.RoleBranchOwner:
		students, err := h.users.ListAll(ctx, repository.ListFilter{
			Role: rolePtr(models.RoleStudent), BranchID: branchFilter, Search: search,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
			return
		}
		tutors, err := h.users.ListAll(ctx, repository.ListFilter{
			Role: rolePtr(models.RoleTutor), BranchID: branchFilter, Search: search,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
			return
		}
		if students != nil {
			out.Students = students
		}
		if tutors != nil {
			out.Tutors = tutors
		}

	case models.RoleOwner:
		students, err := h.users.ListAll(ctx, repository.ListFilter{
			Role: rolePtr(models.RoleStudent), BranchID: branchFilter, Search: search,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
			return
		}
		tutors, err := h.users.ListAll(ctx, repository.ListFilter{
			Role: rolePtr(models.RoleTutor), BranchID: branchFilter, Search: search,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
			return
		}
		branchOwners, err := h.users.ListAll(ctx, repository.ListFilter{
			Role: rolePtr(models.RoleBranchOwner), BranchID: branchFilter, Search: search,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
			return
		}
		parents, err := h.users.ListAll(ctx, repository.ListFilter{
			Role: rolePtr(models.RoleParent), Search: search,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
			return
		}
		if students != nil {
			out.Students = students
		}
		if tutors != nil {
			out.Tutors = tutors
		}
		if branchOwners != nil {
			out.BranchOwners = branchOwners
		}
		if parents != nil {
			out.Parents = parents
		}
	}

	writeJSON(w, http.StatusOK, out)
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
	// Пока нет enrollments: tutor видит учеников своего филиала (как в GET /users).
	if claims.Role == models.RoleTutor && target.Role == models.RoleStudent {
		return target.BranchID != nil && claims.BranchID != nil && *target.BranchID == *claims.BranchID
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
	if req.Email == "" || req.LastName == "" || req.FirstName == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "email, last_name, first_name required")
		return
	}
	tempPassword, err := auth.GenerateOpaqueToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "token generation failed")
		return
	}
	tempPassword = tempPassword[:12]

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

	if err := h.tutorProfiles.Upsert(r.Context(), created.ID, req.Specialization, models.TutorStatusActive); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "could not create tutor profile")
		return
	}

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
	if req.LastName == "" || req.FirstName == "" || req.ParentID == 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "last_name, first_name, parent_id required")
		return
	}

	if claims.Role == models.RoleParent && req.ParentID != claims.UserID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "parent_id must be your own id")
		return
	}

	tempPassword, err := auth.GenerateOpaqueToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "token generation failed")
		return
	}
	tempPassword = tempPassword[:12]
	hash, err := auth.HashPassword(tempPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "hashing failed")
		return
	}

	placeholderEmail := fmt.Sprintf("student+%d@studyroom.internal", time.Now().UnixNano())
	u := &models.User{
		Email: placeholderEmail, PasswordHash: hash, Role: models.RoleStudent,
		LastName: req.LastName, FirstName: req.FirstName, Patronymic: req.Patronymic,
		BranchID: req.BranchID, IsActive: true,
	}

	created, err := h.users.CreateStudentWithParent(r.Context(), u, req.ParentID, req.ClassInfo, req.School)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "parent_id must be an existing parent")
			return
		}
		if errors.Is(err, repository.ErrDuplicate) {
			writeError(w, http.StatusConflict, "ALREADY_EXISTS", "could not create student")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "could not create student")
		return
	}

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
	if !body.IsActive {
		_ = h.authRepo.RevokeAllRefreshTokens(r.Context(), id)
	}
	w.WriteHeader(http.StatusOK)
}

// --- 1.16. GET /branches ---
// Доступ только owner — RestrictRoles на роутере. Branch_owner свой филиал
// берёт из JWT /users/me, список сети ему не нужен.
func (h *UserHandler) ListBranches(w http.ResponseWriter, r *http.Request) {
	branches, err := h.branches.List(r.Context(), nil)
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
	if body.Name == "" || body.City == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "name and city required")
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

	switch claims.Role {
	case models.RoleParent:
		if claims.UserID != parentID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "can only view your own children")
			return
		}
	case models.RoleOwner:
		// ok
	case models.RoleBranchOwner:
		if claims.BranchID == nil {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "branch_owner has no branch")
			return
		}
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted for this action")
		return
	}

	views, err := h.parentChild.ListChildrenViews(r.Context(), parentID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
		return
	}
	if views == nil {
		views = []repository.ChildView{}
	}

	if claims.Role == models.RoleBranchOwner {
		filtered := make([]repository.ChildView, 0, len(views))
		for _, c := range views {
			if c.BranchID != nil && *c.BranchID == *claims.BranchID {
				filtered = append(filtered, c)
			}
		}
		views = filtered
	}

	items := make([]map[string]any, 0, len(views))
	for _, c := range views {
		item := map[string]any{
			"id": c.ID, "first_name": c.FirstName, "last_name": c.LastName,
		}
		if c.ClassInfo != nil {
			item["class_info"] = *c.ClassInfo
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func rolePtr(r models.Role) *models.Role { return &r }
