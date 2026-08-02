package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"studyroom/user-service/internal/auth"
	"studyroom/user-service/internal/events"
	"studyroom/user-service/internal/middleware"
	"studyroom/user-service/internal/models"
	"studyroom/user-service/internal/repository"
)

type UserHandler struct {
	users           *repository.UserRepository
	branches        *repository.BranchRepository
	parentChild     *repository.ParentChildRepository
	authRepo        *repository.AuthRepository
	tutorProfiles   *repository.TutorProfileRepository
	studentProfiles *repository.StudentProfileRepository
	events          events.Publisher
}

func NewUserHandler(
	users *repository.UserRepository,
	branches *repository.BranchRepository,
	pc *repository.ParentChildRepository,
	authRepo *repository.AuthRepository,
	tutorProfiles *repository.TutorProfileRepository,
	studentProfiles *repository.StudentProfileRepository,
	pub events.Publisher,
) *UserHandler {
	if pub == nil {
		pub = events.NoopPublisher{}
	}
	return &UserHandler{
		users: users, branches: branches, parentChild: pc,
		authRepo: authRepo, tutorProfiles: tutorProfiles, studentProfiles: studentProfiles, events: pub,
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
		// ClassInfo/School — «Класс» и «Школа» из student_profiles. Хранятся
		// отдельно от users (см. schema), поэтому обновляются через
		// StudentProfileRepository, а не через h.users.Update. Разрешено
		// редактировать только самому ученику — у остальных ролей такого
		// профиля нет.
		ClassInfo *string `json:"class_info"`
		School    *string `json:"school"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}
	if (body.ClassInfo != nil || body.School != nil) && claims.Role != models.RoleStudent {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only a student can edit class/school")
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
	if len(fields) > 0 {
		if _, err := h.users.Update(r.Context(), claims.UserID, fields); err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
			return
		}
	}

	if body.ClassInfo != nil || body.School != nil {
		// Upsert перезаписывает оба поля разом, поэтому подставляем текущее
		// значение для того из них, что не пришло в запросе, — иначе оно
		// затёрлось бы в NULL.
		current, err := h.users.GetByID(r.Context(), claims.UserID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
			return
		}
		classInfo, school := current.ClassInfo, current.School
		if body.ClassInfo != nil {
			classInfo = body.ClassInfo
		}
		if body.School != nil {
			school = body.School
		}
		if err := h.studentProfiles.Upsert(r.Context(), claims.UserID, classInfo, school); err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
			return
		}
	}

	updated, err := h.users.GetByID(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
		return
	}
	h.events.UserUpdated(updated)
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

		// Родителю нужны и преподаватели — иначе календарь/расписание ребёнка
		// не может показать ФИО преподавателя и вместо этого показывает
		// "Преподаватель #id" (см. StudentDetail.jsx). Отдаём преподавателей
		// филиалов, в которых учатся дети этого родителя.
		branchIDs := map[int64]struct{}{}
		for _, c := range children {
			if c.BranchID != nil {
				branchIDs[*c.BranchID] = struct{}{}
			}
		}
		if len(branchIDs) > 0 {
			tutorsSeen := map[int64]struct{}{}
			var tutors []*models.User
			for bid := range branchIDs {
				branchID := bid
				branchTutors, err := h.users.ListAll(ctx, repository.ListFilter{
					Role: rolePtr(models.RoleTutor), BranchID: &branchID,
				})
				if err != nil {
					writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
					return
				}
				for _, t := range branchTutors {
					if _, ok := tutorsSeen[t.ID]; ok {
						continue
					}
					tutorsSeen[t.ID] = struct{}{}
					tutors = append(tutors, t)
				}
			}
			if tutors != nil {
				out.Tutors = tutors
			}
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

		// Родители не привязаны к филиалу (у одного родителя могут быть дети
		// в разных филиалах), поэтому фильтровать их по branch_id нельзя —
		// это ограничило бы branch_owner только семьями, у которых уже ЕСТЬ
		// ребёнок в его филиале, и он не смог бы оформить договор для
		// совершенно новой семьи (ровно так же, как это делает owner —
		// см. ветку RoleOwner ниже, без фильтра по филиалу).
		parents, err := h.users.ListAll(ctx, repository.ListFilter{
			Role: rolePtr(models.RoleParent), Search: search,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
			return
		}
		if parents != nil {
			out.Parents = parents
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
		if target.Role == models.RoleStudent {
			isParent, err := h.parentChild.IsParentOf(r.Context(), claims.UserID, target.ID)
			return err == nil && isParent
		}
		// Родителю также нужно уметь посмотреть карточку репетитора своего
		// ребёнка (см. GET /users/{id} из ParentSchedule.jsx — там подтягивают
		// имя преподавателя по lesson.tutor_id). Прямой связи parent->tutor
		// нет, поэтому разрешаем по тому же принципу, что и student/tutor
		// ниже: репетитор виден, если он работает в одном филиале хотя бы с
		// одним из детей этого родителя.
		if target.Role == models.RoleTutor {
			children, err := h.parentChild.ListChildren(r.Context(), claims.UserID, "")
			if err != nil {
				return false
			}
			for _, c := range children {
				if c.BranchID != nil && target.BranchID != nil && *c.BranchID == *target.BranchID {
					return true
				}
			}
		}
		return false
	}
	if claims.Role == models.RoleTutor && target.Role == models.RoleStudent {
		return target.BranchID != nil && claims.BranchID != nil && *target.BranchID == *claims.BranchID
	}
	if claims.Role == models.RoleStudent && target.Role == models.RoleTutor{
		return target.BranchID != nil && claims.BranchID !=nil && *target.BranchID == *claims.BranchID
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
	claims, _ := middleware.FromContext(r.Context())

	var req createTutorRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}
	if req.Email == "" || req.LastName == "" || req.FirstName == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "email, last_name, first_name required")
		return
	}

	// branch_owner добавляет преподавателя только в свой собственный филиал —
	// branch_id из запроса игнорируется и принудительно подставляется из
	// claims, аналогично courses/contracts/students.
	if claims.Role == models.RoleBranchOwner {
		if claims.BranchID == nil {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "branch_owner has no branch")
			return
		}
		req.BranchID = claims.BranchID
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

	h.events.UserCreated(created, tempPassword, "", nil)
	writeJSON(w, http.StatusCreated, map[string]any{"user": created})
}

// --- POST /users/branch-owners ---
// Создание владельца филиала. Доступно только owner (см. RequireRoles в
// app.go). Логин — реальная почта (как у tutor): на неё уходит письмо с
// временным паролем через events.UserCreated (notification-service,
// case "branch_owner" в handleUserCreated).
type createBranchOwnerRequest struct {
	Email      string  `json:"email"`
	Phone      *string `json:"phone"`
	LastName   string  `json:"last_name"`
	FirstName  string  `json:"first_name"`
	Patronymic *string `json:"patronymic"`
	BranchID   int64   `json:"branch_id"`
}

func (h *UserHandler) CreateBranchOwner(w http.ResponseWriter, r *http.Request) {
	var req createBranchOwnerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}
	if req.Email == "" || req.LastName == "" || req.FirstName == "" || req.BranchID == 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "email, last_name, first_name, branch_id required")
		return
	}

	if existing, err := h.branches.List(r.Context(), &req.BranchID); err != nil || len(existing) == 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "branch_id must be an existing branch")
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

	branchID := req.BranchID
	u := &models.User{
		Email: req.Email, Phone: req.Phone, PasswordHash: hash, Role: models.RoleBranchOwner,
		LastName: req.LastName, FirstName: req.FirstName, Patronymic: req.Patronymic,
		BranchID: &branchID, IsActive: true,
	}
	created, err := h.users.Create(r.Context(), u)
	if err != nil {
		if errors.Is(err, repository.ErrDuplicate) {
			writeError(w, http.StatusConflict, "ALREADY_EXISTS", "email or phone already registered")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "could not create branch owner")
		return
	}

	h.events.UserCreated(created, tempPassword, "", nil)
	writeJSON(w, http.StatusCreated, map[string]any{"user": created})
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

	// branch_owner создаёт ученика (в рамках оформления договора) только для
	// своего собственного филиала — branch_id из запроса игнорируется и
	// принудительно подставляется из claims, аналогично courses/contracts.
	if claims.Role == models.RoleBranchOwner {
		if claims.BranchID == nil {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "branch_owner has no branch")
			return
		}
		req.BranchID = claims.BranchID
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

	// Логин ученика — человекочитаемый (транслитерация ФИО), а не случайный
	// набор цифр: у ученика нет реальной почты, email тут используется только
	// как логин для входа (см. AuthHandler.Login / GetByLogin).
	var created *models.User
	suffix := ""
	for attempt := 0; ; attempt++ {
		u := &models.User{
			Email: generateStudentLogin(req.LastName, req.FirstName, suffix), PasswordHash: hash, Role: models.RoleStudent,
			LastName: req.LastName, FirstName: req.FirstName, Patronymic: req.Patronymic,
			BranchID: req.BranchID, IsActive: true,
		}
		var cErr error
		created, cErr = h.users.CreateStudentWithParent(r.Context(), u, req.ParentID, req.ClassInfo, req.School)
		if cErr == nil {
			break
		}
		if errors.Is(cErr, repository.ErrNotFound) {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "parent_id must be an existing parent")
			return
		}
		if errors.Is(cErr, repository.ErrDuplicate) && attempt < 5 {
			// Логин занят (тёзка) — добавляем короткий суффикс и пробуем снова.
			token, tErr := auth.GenerateOpaqueToken()
			if tErr != nil {
				writeError(w, http.StatusInternalServerError, "INTERNAL", "could not create student")
				return
			}
			suffix = token[:4]
			continue
		}
		if errors.Is(cErr, repository.ErrDuplicate) {
			writeError(w, http.StatusConflict, "ALREADY_EXISTS", "could not create student")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "could not create student")
		return
	}

	notifyEmail := ""
	if parent, err := h.users.GetByID(r.Context(), req.ParentID); err == nil {
		notifyEmail = parent.Email
	}
	parentID := req.ParentID
	h.events.UserCreated(created, tempPassword, notifyEmail, &parentID)
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
	h.events.UserUpdated(updated)
	writeJSON(w, http.StatusOK, updated)
}

// --- 1.14. PATCH /users/{id}/status ---
func (h *UserHandler) SetStatus(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

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

	// Нужна роль пользователя ДО обновления, чтобы понять, увольняем ли мы
	// именно репетитора (иначе tutor_profiles трогать не за чем).
	target, err := h.users.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		return
	}

	// branch_owner может увольнять/восстанавливать только преподавателей
	// своего собственного филиала — руководитель другого филиала, owner
	// или сам branch_owner ему недоступны.
	if claims.Role == models.RoleBranchOwner {
		if target.Role != models.RoleTutor || target.BranchID == nil || claims.BranchID == nil || *target.BranchID != *claims.BranchID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "can only change status of tutors in your own branch")
			return
		}
	}

	updated, err := h.users.Update(r.Context(), id, map[string]any{"is_active": body.IsActive})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
		return
	}
	if !body.IsActive {
		_ = h.authRepo.RevokeAllRefreshTokens(r.Context(), id)

		// Увольнение репетитора: помимо блокировки входа (is_active=false),
		// его статус в tutor_profiles тоже переводится в inactive — это то,
		// что видно в карточке преподавателя и в списках (см. TeacherDetail.jsx,
		// TUTOR_STATUS_LABEL.inactive = "Неактивен"). Отвязка его учеников
		// (course_tutors / enrollments.tutor_id) происходит асинхронно в
		// Academic Service по событию user.updated с is_active=false — см.
		// academic-service/internal/events/subscriber.go.
		if target.Role == models.RoleTutor {
			if err := h.tutorProfiles.SetStatus(r.Context(), id, models.TutorStatusInactive); err != nil {
				writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
				return
			}
		}
	}
	h.events.UserUpdated(updated)
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

// --- 1.17b. DELETE /branches/{id} ---
// Доступ только owner. Двойное подтверждение удаления реализовано на
// фронтенде (см. AdminBranches.jsx) — бэкенд просто выполняет удаление.
//
// Это мягкое удаление (см. BranchRepository.Delete): сам филиал остаётся в
// базе с проставленным deleted_at и пропадает из GET /branches, но
// появляется в GET /branches/deleted ("Удалённые"), чтобы можно было
// посмотреть, какие преподаватели и ученики там были. Руководители этого
// филиала (role=branch_owner) при этом удаляются полностью — их аккаунты
// физически стираются из базы вместе с самим удалением филиала. Обычные
// преподаватели и ученики филиала не удаляются, они лишь остаются
// привязаны к уже удалённому филиалу.
func (h *UserHandler) DeleteBranch(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid branch id")
		return
	}
	if err := h.branches.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "branch not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "delete failed")
		return
	}
	w.WriteHeader(http.StatusOK)
}

// --- 1.17c. GET /branches/deleted ---
// Доступ только owner. Раздел "Удалённые" на вкладке "Филиалы" — список
// мягко удалённых филиалов. Чтобы посмотреть преподавателей/учеников
// конкретного удалённого филиала, фронт дополнительно дёргает
// GET /users?branch_id=<id>&... — у этих пользователей branch_id никуда
// не делся, изменился только сам филиал (стал "удалённым").
func (h *UserHandler) ListDeletedBranches(w http.ResponseWriter, r *http.Request) {
	branches, err := h.branches.ListDeleted(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
		return
	}
	if branches == nil {
		branches = []*models.Branch{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": branches})
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

// --- POST /users/{id}/reset-credentials — сброс логина/пароля ученика.
// Доступно: owner (любой ученик); parent — только для своего ребёнка
// (проверяется через parent_student, как и в ListChildren/canViewUser).
// Логин у ученика не меняется (email как был, так и остаётся), генерируется
// только новый временный пароль. Уведомление уходит на почту родителя —
// у самого ученика реальной почты нет (см. CreateStudent).
type resetCredentialsResponse struct {
	Login        string `json:"login"`
	TempPassword string `json:"temp_password"`
}

func (h *UserHandler) ResetStudentCredentials(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	claims, _ := middleware.FromContext(r.Context())

	target, err := h.users.GetByID(r.Context(), id)
	if err != nil || target.Role != models.RoleStudent {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "student not found")
		return
	}

	switch claims.Role {
	case models.RoleOwner:
		// ok
	case models.RoleParent:
		isParent, err := h.parentChild.IsParentOf(r.Context(), claims.UserID, target.ID)
		if err != nil || !isParent {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "can only reset your own child's credentials")
			return
		}
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted for this action")
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
	if _, err := h.users.Update(r.Context(), id, map[string]any{"password_hash": hash}); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
		return
	}
	_ = h.authRepo.RevokeAllRefreshTokens(r.Context(), id)

	notifyEmail := ""
	var parentID *int64
	if parent, err := h.parentChild.GetParentOfStudent(r.Context(), id); err == nil {
		notifyEmail = parent.Email
		pid := parent.ID
		parentID = &pid
	}
	h.events.CredentialsReset(target, tempPassword, notifyEmail, parentID)

	writeJSON(w, http.StatusOK, resetCredentialsResponse{Login: target.Email, TempPassword: tempPassword})
}

func rolePtr(r models.Role) *models.Role { return &r }
