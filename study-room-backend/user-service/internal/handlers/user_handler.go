package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/mail"
	"strconv"
	"strings"

	"studyroom/user-service/internal/auth"
	"studyroom/user-service/internal/events"
	"studyroom/user-service/internal/middleware"
	"studyroom/user-service/internal/models"
	"studyroom/user-service/internal/repository"

	"github.com/go-chi/chi/v5"
)

type UserHandler struct {
	users           *repository.UserRepository
	branches        *repository.BranchRepository
	parentChild     *repository.ParentChildRepository
	authRepo        *repository.AuthRepository
	tutorProfiles   *repository.TutorProfileRepository
	studentProfiles *repository.StudentProfileRepository
	events          events.Publisher
	// tm/cookies — только для SetTutorMode ниже: переключение "версии
	// учителя" меняет is_tutor в JWT-claims, поэтому нужно сразу
	// перевыпустить пару токенов (как при логине), а не ждать, пока
	// естественный /auth/refresh подтянет новое значение.
	tm      *auth.TokenManager
	cookies cookieSettings
}

func NewUserHandler(
	users *repository.UserRepository,
	branches *repository.BranchRepository,
	pc *repository.ParentChildRepository,
	authRepo *repository.AuthRepository,
	tutorProfiles *repository.TutorProfileRepository,
	studentProfiles *repository.StudentProfileRepository,
	pub events.Publisher,
	tm *auth.TokenManager,
	cookieOpts CookieOptions,
) *UserHandler {
	if pub == nil {
		pub = events.NoopPublisher{}
	}
	return &UserHandler{
		users: users, branches: branches, parentChild: pc,
		authRepo: authRepo, tutorProfiles: tutorProfiles, studentProfiles: studentProfiles, events: pub,
		tm: tm,
		cookies: cookieSettings{
			secure:   cookieOpts.Secure,
			sameSite: parseSameSite(cookieOpts.SameSite),
			domain:   cookieOpts.Domain,
		},
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
		Email      *string `json:"email"`
		// CurrentPassword — обязателен, когда Email реально меняется (email
		// одновременно служит логином для входа, в т.ч. у ученика — см. ниже),
		// подтверждает, что запрос отправляет владелец аккаунта, а не
		// перехваченная сессия.
		CurrentPassword string `json:"current_password"`
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
	if body.Email != nil {
		normalized := strings.ToLower(strings.TrimSpace(*body.Email))
		if _, err := mail.ParseAddress(normalized); err != nil {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid email")
			return
		}
		// Email одновременно служит логином для входа (в т.ч. у ученика —
		// раньше это поле мог менять только тьютор/админ через сброс
		// учётных данных, теперь ученик может и сам, наравне с остальными
		// ролями). Значение реально меняется — требуем подтверждение
		// текущим паролем, иначе кто угодно с перехваченной сессией мог бы
		// тихо увести логин на свой адрес.
		current, err := h.users.GetByID(r.Context(), claims.UserID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
			return
		}
		if normalized != strings.ToLower(current.Email) {
			if body.CurrentPassword == "" || !auth.CheckPassword(body.CurrentPassword, current.PasswordHash) {
				writeError(w, http.StatusBadRequest, "INVALID_CREDENTIALS", "current password is required and must be correct to change email")
				return
			}
		}
		fields["email"] = normalized
	}
	if len(fields) > 0 {
		if _, err := h.users.Update(r.Context(), claims.UserID, fields); err != nil {
			if errors.Is(err, repository.ErrDuplicate) {
				writeError(w, http.StatusConflict, "ALREADY_EXISTS", "email or phone already registered")
				return
			}
			writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
			return
		}
	}

	if body.ClassInfo != nil && !models.IsValidGrade(*body.ClassInfo) {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "class_info must be a number from 1 to 11")
		return
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

// --- PATCH /users/me/tutor-mode ---
// Включает/выключает "версию учителя" для владельца филиала (см. models.User.
// IsTutor): тот же UI и функционал, что у обычного tutor (назначение себе
// курсов через POST /courses/{id}/tutors в academic-service, создание
// homework/tests, выставление оценок — см. RequireTutorCapable там), при
// этом сама роль в токене остаётся branch_owner. Доступно только
// branch_owner — ни owner, ни tutor, ни остальным ролям переключать
// нечего (у tutor это право уже есть по самой роли).
//
// Выключение, наоборот, УДАЛЯЕТ всю информацию о пользователе как о
// преподавателе:
//   - tutor_profile (специализация/статус/рейтинг/стаж) — физически, см.
//     h.tutorProfiles.Delete ниже;
//   - назначения курсов (course_tutors) и личные подгруппы в Academic
//     Service — асинхронно, через событие user.tutor_mode_disabled (см.
//     TutorModeDisabled в events/publisher.go и detachTutor в
//     academic-service/internal/events/subscriber.go).
//
// При этом уже стоящие в расписании занятия НЕ удаляются и не отменяются —
// у них только обнуляется tutor_id (см. LessonRepository.
// DetachTutorFromLessons), т.е. занятие остаётся на месте в расписании
// филиала, но сам пользователь как преподаватель из него пропадает
// (назначить занятие может заново любой tutor того же курса).
//
// Повторное включение — это, по сути, регистрация заново: профиль
// преподавателя создаётся с нуля (см. SetStatus ниже), старые course_tutors
// не восстанавливаются — их нужно назначить заново.
type setTutorModeRequest struct {
	Enabled bool `json:"enabled"`
}

func (h *UserHandler) SetTutorMode(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	if claims.Role != models.RoleBranchOwner {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only a branch owner can toggle teacher mode")
		return
	}

	var req setTutorModeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}

	updated, err := h.users.Update(r.Context(), claims.UserID, map[string]any{"is_tutor": req.Enabled})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to update teacher mode")
		return
	}

	if req.Enabled {
		// Заводим профиль преподавателя с нуля — Upsert идемпотентен и не
		// упадёт, даже если по каким-то причинам строка уже существует, но
		// после выключения (см. ветку else) её физически не остаётся, так
		// что для повторного включения это всегда фактически новая
		// регистрация в роли преподавателя.
		if err := h.tutorProfiles.SetStatus(r.Context(), claims.UserID, models.TutorStatusActive); err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to set up teacher profile")
			return
		}
	} else {
		// Выключение тумблера — полное удаление информации о пользователе
		// как о преподавателе (см. комментарий над setTutorModeRequest):
		// сам tutor_profile — здесь, синхронно; назначения курсов/подгруппы
		// в Academic Service — асинхронно, событием ниже.
		if err := h.tutorProfiles.Delete(r.Context(), claims.UserID); err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to remove teacher profile")
			return
		}
		h.events.TutorModeDisabled(claims.UserID)
	}

	// is_tutor меняет содержимое JWT — перевыпускаем токены сразу (как при
	// логине), иначе фронту пришлось бы ждать естественного /auth/refresh,
	// чтобы получить доступ к учительским эндпоинтам сразу после переключения
	// тумблера в настройках.
	access, err := h.tm.GenerateAccessToken(updated)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "token generation failed")
		return
	}
	refreshPlain, err := auth.GenerateOpaqueToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "token generation failed")
		return
	}
	if err := h.authRepo.SaveRefreshToken(r.Context(), updated.ID, auth.HashToken(refreshPlain), h.tm.RefreshTokenExpiry()); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "could not persist refresh token")
		return
	}
	setRefreshCookie(w, h.cookies, refreshPlain, h.tm.RefreshTokenExpiry())

	full, err := h.users.GetByID(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load user")
		return
	}
	h.events.UserUpdated(full)
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": access,
		"user":         full,
	})
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
			for _, id := range c.BranchIDs {
				branchIDs[id] = struct{}{}
			}
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
		active := true
		students, err := h.users.ListAll(ctx, repository.ListFilter{
			Role: rolePtr(models.RoleStudent), BranchID: branchFilter, IsActive: &active, Search: search,
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

		// Если branch_owner включил себе "версию учителя" (см. PATCH
		// /users/me/tutor-mode), он должен появляться в разделе "Преподаватели"
		// своего же филиала — иначе ни TeachersDirectory (карточка), ни
		// TeacherDetail (назначение курсов через course_tutors) его не найдут,
		// хотя POST /courses/{id}/tutors для его собственного user_id уже
		// прекрасно работает (см. course_handler.go — там роль tutor_id не
		// проверяется). Загружаем актуальный флаг из БД, а не из claims.IsTutor:
		// на другой вкладке/устройстве токен мог ещё не перевыпуститься после
		// переключения тумблера, а список преподавателей должен быть верным
		// в любом случае.
		self, err := h.users.GetByID(ctx, claims.UserID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "list failed")
			return
		}
		if self.IsTutor && matchesSearch(self, search) {
			// В начало списка — это тот самый преподаватель, ради которого
			// он и открыл раздел ("сам себе назначить курс").
			tutors = append([]*models.User{self}, tutors...)
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

		// Владельцы филиалов, включившие себе "версию учителя" (см. PATCH
		// /users/me/tutor-mode), должны попадать в раздел "Преподаватели" не
		// только у себя самих (см. ветку RoleBranchOwner выше — там self
		// добавляется вручную), но и у owner'а — иначе список тьюторов у
		// владельца сети не совпадает с тем, что видит branch_owner про
		// самого себя, и owner не может назначить его на курс/увидеть в
		// TeachersDirectory. Owner видит сразу все филиалы, поэтому просто
		// проверяем флаг у уже загруженных branchOwners, без похода в БД.
		for _, bo := range branchOwners {
			if bo.IsTutor && matchesSearch(bo, search) {
				tutors = append(tutors, bo)
			}
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

func userHasBranch(u *models.User, branchID *int64) bool {
	if u == nil || branchID == nil {
		return false
	}
	for _, id := range u.BranchIDs {
		if id == *branchID {
			return true
		}
	}
	return u.BranchID != nil && *u.BranchID == *branchID
}

func sharesAnyBranch(a, b *models.User) bool {
	if a == nil || b == nil {
		return false
	}
	for _, id := range a.BranchIDs {
		if userHasBranch(b, &id) {
			return true
		}
	}
	if a.BranchID != nil {
		return userHasBranch(b, a.BranchID)
	}
	return false
}

func canViewUser(r *http.Request, h *UserHandler, claims *auth.Claims, target *models.User) bool {
	if claims.Role == models.RoleOwner {
		return true
	}
	if claims.UserID == target.ID {
		return true
	}
	if claims.Role == models.RoleBranchOwner {
		return userHasBranch(target, claims.BranchID)
	}
	if claims.Role == models.RoleParent {
		if target.Role == models.RoleStudent {
			isParent, err := h.parentChild.IsParentOf(r.Context(), claims.UserID, target.ID)
			return err == nil && isParent
		}
		if target.Role == models.RoleTutor {
			children, err := h.parentChild.ListChildren(r.Context(), claims.UserID, "")
			if err != nil {
				return false
			}
			for _, c := range children {
				if sharesAnyBranch(c, target) {
					return true
				}
			}
		}
		return false
	}
	if claims.Role == models.RoleTutor && target.Role == models.RoleStudent {
		// Тьютор может видеть ученика, только если у обоих есть общий филиал.
		// Claims содержат текущий основной филиал, поэтому сначала проверяем его.
		return userHasBranch(target, claims.BranchID)
	}
	if claims.Role == models.RoleStudent && target.Role == models.RoleTutor {
		return userHasBranch(target, claims.BranchID)
	}
	return false
}

// PUT /users/{id}/branches — replace memberships for a tutor/student. Owner only.
type setBranchesRequest struct {
	BranchIDs []int64 `json:"branch_ids"`
}

func (h *UserHandler) SetUserBranches(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	claims, _ := middleware.FromContext(r.Context())
	if claims.Role != models.RoleOwner {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only owner can manage user branches")
		return
	}
	target, err := h.users.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		return
	}
	if target.Role != models.RoleTutor && target.Role != models.RoleStudent {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "branches can only be managed for students and tutors")
		return
	}
	var req setBranchesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}
	u, err := h.users.SetBranches(r.Context(), id, target.Role, req.BranchIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	h.events.UserUpdated(u)
	writeJSON(w, http.StatusOK, u)
}

// --- 1.11. POST /users/tutors ---
type createTutorRequest struct {
	Email          string  `json:"email"`
	Phone          *string `json:"phone"`
	LastName       string  `json:"last_name"`
	FirstName      string  `json:"first_name"`
	Patronymic     *string `json:"patronymic"`
	BranchID       *int64  `json:"branch_id"`
	BranchIDs      []int64 `json:"branch_ids"`
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
		req.BranchIDs = []int64{*claims.BranchID}
	}
	if len(req.BranchIDs) == 0 && req.BranchID != nil {
		req.BranchIDs = []int64{*req.BranchID}
	}
	if len(req.BranchIDs) == 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "branch_id or branch_ids required")
		return
	}
	req.BranchID = &req.BranchIDs[0]

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
	if len(req.BranchIDs) > 1 {
		created, err = h.users.SetBranches(r.Context(), created.ID, models.RoleTutor, req.BranchIDs)
		if err != nil {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
			return
		}
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
	// ClassInfo — класс ученика (1-11), обязателен: используется ежегодным
	// job'ом автоповышения класса (см. internal/promotion) и подтягивается
	// в заявки на запись на курс через user_refs в CRM Service. Раньше было
	// необязательным свободным текстом — теперь строго число 1..11 для
	// ЛЮБОЙ роли, создающей ученика (owner/parent/branch_owner идут через
	// этот же обработчик, см. роут в app.go).
	ClassInfo *string `json:"class_info"`
	School    *string `json:"school"`
	BranchID  *int64  `json:"branch_id"`
	BranchIDs []int64 `json:"branch_ids"`
	ParentID  int64   `json:"parent_id"`
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
	if req.ClassInfo == nil || !models.IsValidGrade(*req.ClassInfo) {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "class_info is required and must be a number from 1 to 11")
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
		req.BranchIDs = []int64{*claims.BranchID}
	}
	if len(req.BranchIDs) == 0 && req.BranchID != nil {
		req.BranchIDs = []int64{*req.BranchID}
	}
	if len(req.BranchIDs) == 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "branch_id or branch_ids required")
		return
	}
	req.BranchID = &req.BranchIDs[0]

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
		if errors.Is(cErr, repository.ErrChildLimit) {
			writeError(w, http.StatusConflict, "CHILD_LIMIT_REACHED", "a parent can have no more than 10 children")
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

	if len(req.BranchIDs) > 1 {
		created, err = h.users.SetBranches(r.Context(), created.ID, models.RoleStudent, req.BranchIDs)
		if err != nil {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
			return
		}
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
		if claims.Role != models.RoleBranchOwner || !userHasBranch(target, claims.BranchID) {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "not allowed to edit this user")
			return
		}
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}
	allowed := map[string]bool{"first_name": true, "last_name": true, "patronymic": true, "avatar_url": true, "email": true}
	fields := map[string]any{}
	for k, v := range body {
		if allowed[k] {
			fields[k] = v
		}
	}

	// Членства по филиалам — операция уровня owner. Старый branch_id сохраняем
	// для обратной совместимости: если приходит только он, это означает
	// перевод пользователя в один филиал. Новый branch_ids позволяет
	// назначить несколько филиалов за один запрос.
	var branchIDs []int64
	branchMembershipsChanged := false
	if raw, ok := body["branch_ids"]; ok {
		if claims.Role != models.RoleOwner {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "only owner can change user branches")
			return
		}
		if target.Role != models.RoleTutor && target.Role != models.RoleStudent {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "branches can only be changed for students and tutors")
			return
		}
		arr, ok := raw.([]any)
		if !ok {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "branch_ids must be an array")
			return
		}
		for _, item := range arr {
			n, ok := item.(float64)
			if !ok || n <= 0 || n != float64(int64(n)) {
				writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid branch_ids")
				return
			}
			branchIDs = append(branchIDs, int64(n))
		}
		branchMembershipsChanged = true
	} else if raw, ok := body["branch_id"]; ok {
		if claims.Role != models.RoleOwner {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "only owner can change user branches")
			return
		}
		if target.Role != models.RoleTutor && target.Role != models.RoleStudent {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "branches can only be changed for students and tutors")
			return
		}
		n, ok := raw.(float64)
		if !ok || n <= 0 || n != float64(int64(n)) {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid branch_id")
			return
		}
		branchIDs = []int64{int64(n)}
		branchMembershipsChanged = true
	}

	// У ученика email — это сгенерированный логин, а не настоящая почта (см.
	// комментарий в CreateStudent) — его правит только сброс учётных данных,
	// а не этот общий эндпоинт, иначе можно случайно увести ученика в дубликат.
	if _, ok := fields["email"]; ok && target.Role == models.RoleStudent {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "student login cannot be changed here")
		return
	}
	if rawEmail, ok := fields["email"]; ok {
		emailStr, ok := rawEmail.(string)
		if !ok {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid email")
			return
		}
		normalized := strings.ToLower(strings.TrimSpace(emailStr))
		if _, err := mail.ParseAddress(normalized); err != nil {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid email")
			return
		}
		fields["email"] = normalized
	}

	if branchMembershipsChanged {
		if _, err := h.users.SetBranches(r.Context(), id, target.Role, branchIDs); err != nil {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
			return
		}
	}

	updated, err := h.users.Update(r.Context(), id, fields)
	if err != nil {
		if errors.Is(err, repository.ErrDuplicate) {
			writeError(w, http.StatusConflict, "ALREADY_EXISTS", "email or phone already registered")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
		return
	}
	// Update() возвращает облегчённую модель без branch_ids, поэтому после
	// изменения членств перечитываем полную модель перед публикацией события.
	updated, err = h.users.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
		return
	}
	h.events.UserUpdated(updated)
	writeJSON(w, http.StatusOK, updated)
}

// --- 1.14. DELETE /users/{id} ---
// Owner-only physical deletion of a parent account together with all linked
// student accounts. Events are published only after the DB transaction has
// committed so Academic/Contracts services can clean up their local data.
func (h *UserHandler) Delete(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	if claims.Role != models.RoleOwner {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only owner can delete users")
		return
	}

	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}

	target, err := h.users.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		return
	}
	if target.Role != models.RoleParent {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only parent accounts can be deleted here")
		return
	}

	deleted, err := h.users.DeleteParentCascade(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "user not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "delete failed")
		return
	}
	for _, u := range deleted {
		h.events.UserDeleted(events.DeletedUserInfo{
			ID: u.ID, Email: u.Email, FirstName: u.FirstName, LastName: u.LastName,
			Role: u.Role, BranchID: u.BranchID, BranchIDs: u.BranchIDs,
		})
	}
	w.WriteHeader(http.StatusNoContent)
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
		if target.Role != models.RoleTutor || !userHasBranch(target, claims.BranchID) {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "can only change status of tutors in your own branch")
			return
		}
	}

	if target.Role == models.RoleParent {
		// Для родителя owner меняет доступ всей семьи: родитель + все
		// привязанные ученики. Это атомарная операция в User Service.
		updatedUsers, err := h.users.SetParentAndChildrenActive(r.Context(), target.ID, body.IsActive)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				writeError(w, http.StatusNotFound, "NOT_FOUND", "user not found")
				return
			}
			writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
			return
		}
		for _, u := range updatedUsers {
			h.events.UserUpdated(u)
			if !u.IsActive {
				_ = h.authRepo.RevokeAllRefreshTokens(r.Context(), u.ID)
			}
		}
		w.WriteHeader(http.StatusOK)
		return
	}

	if body.IsActive {
		if err := h.reinstateTutorOrActivate(r.Context(), target); err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	}

	if err := h.fireTutorOrDeactivate(r.Context(), target); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
		return
	}
	w.WriteHeader(http.StatusOK)
}

// fireTutorOrDeactivate — общая логика увольнения/деактивации пользователя
// (is_active=false), используется как ручным увольнением через
// PATCH /users/{id}/status, так и автоматическим массовым увольнением
// преподавателей при удалении их филиала (см. DeleteBranch ниже). Помимо
// блокировки входа: отзывает все refresh-токены, для tutor переводит
// tutor_profiles в inactive (видно в TeacherDetail.jsx как "Неактивен") и
// публикует user.updated — по этому событию Academic Service асинхронно
// отвязывает учеников уволенного репетитора (course_tutors/enrollments.tutor_id,
// см. academic-service/internal/events/subscriber.go). Сам пользователь и
// его branch_id НЕ трогаются — запись остаётся видна в разделе
// «Филиалы» → «Удалённые» (или просто в списке уволенных), только со
// статусом "Уволен"/"Неактивен".
func (h *UserHandler) fireTutorOrDeactivate(ctx context.Context, target *models.User) error {
	updated, err := h.users.Update(ctx, target.ID, map[string]any{"is_active": false})
	if err != nil {
		return err
	}
	_ = h.authRepo.RevokeAllRefreshTokens(ctx, target.ID)

	if target.Role == models.RoleTutor {
		if err := h.tutorProfiles.SetStatus(ctx, target.ID, models.TutorStatusInactive); err != nil {
			return err
		}
	}
	h.events.UserUpdated(updated)
	return nil
}

// reinstateTutorOrActivate — обратная операция к fireTutorOrDeactivate
// ("Восстановить в штат"): снимает блокировку входа (is_active=true) и,
// что важно, для tutor также возвращает tutor_profiles.status обратно в
// active.
//
// БАГ, который здесь исправлен: раньше PATCH /users/{id}/status с
// is_active=true просто делал users.is_active=true и всё — tutor_status
// так и оставался "inactive" (его выставил fireTutorOrDeactivate при
// увольнении). Само по себе это не мешало логину (SetStatus и Login
// проверяют только users.is_active), НО именно эта асимметрия и была
// источником реальной проблемы "уволили — восстановили — всё равно не
// пускает": карточка преподавателя (TeacherDetail.jsx) продолжала
// показывать статус "Неактивен" рядом с выпадающим списком
// TutorStatusSelect, который виден ВСЕГДА, в том числе для уволенных.
// Администратор, не заметив (или не поняв) отдельную кнопку "Восстановить
// в штат" в шапке, часто вместо неё просто переключал этот дропдаун на
// "Активен" — а это дергает СОВСЕМ ДРУГОЙ endpoint (PATCH
// /tutors/{id}/status), который трогает только tutor_profiles.status и
// НЕ трогает users.is_active. В итоге бейдж мог даже показать "Активен",
// а вход по-прежнему был запрещён (users.is_active оставался false),
// потому что настоящее восстановление так и не было вызвано.
//
// Теперь единственная кнопка "Восстановить в штат" синхронно приводит в
// порядок оба поля разом, а UI (см. TeacherDetail.jsx) больше не даёт
// трогать TutorStatusSelect, пока сотрудник уволен — так что запутаться
// между этими двумя контролами больше нельзя.
func (h *UserHandler) reinstateTutorOrActivate(ctx context.Context, target *models.User) error {
	updated, err := h.users.Update(ctx, target.ID, map[string]any{"is_active": true})
	if err != nil {
		return err
	}

	if target.Role == models.RoleTutor {
		if err := h.tutorProfiles.SetStatus(ctx, target.ID, models.TutorStatusActive); err != nil {
			return err
		}
	}
	h.events.UserUpdated(updated)
	return nil
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
// физически стираются из базы вместе с самим удалением филиала.
//
// Обычные преподаватели филиала не удаляются и не отвязываются от
// branch_id (иначе они пропали бы из GET /users?branch_id=<id> и их
// нельзя было бы найти в разделе «Удалённые») — вместо этого они
// автоматически "увольняются" той же логикой, что и ручное увольнение
// через PATCH /users/{id}/status (is_active=false, отзыв refresh-токенов,
// tutor_profiles → inactive, отвязка их учеников в Academic Service по
// событию user.updated). Так их карточки остаются доступны в «Удалённые»
// со статусом "Уволен", просто больше не смогут войти и вести занятия.
// Ученики филиала не трогаются вообще.
func (h *UserHandler) DeleteBranch(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid branch id")
		return
	}

	// Список берём ДО удаления филиала — сам список тьюторов ищется по
	// branch_id, который у них не меняется, так что порядок относительно
	// h.branches.Delete не принципиален, но так проще: не удаляем филиал,
	// если вдруг не смогли прочитать его тьюторов.
	role := models.RoleTutor
	tutors, err := h.users.ListAll(r.Context(), repository.ListFilter{Role: &role, BranchID: &id})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "list tutors failed")
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

	// Массовое увольнение: только те, кто ещё не был уволен вручную ранее
	// (is_active уже false у них не трогаем — не нужно второй раз отзывать
	// токены/публиковать событие). Ошибку по отдельному тьютору не считаем
	// фатальной для всего запроса — филиал уже удалён, продолжаем
	// увольнять остальных и просто логируем, чтобы одна проблемная запись
	// не блокировала увольнение всех остальных.
	for _, t := range tutors {
		if !t.IsActive {
			continue
		}
		if err := h.fireTutorOrDeactivate(r.Context(), t); err != nil {
			log.Printf("[branches] delete branch=%d: fire tutor=%d failed: %v", id, t.ID, err)
		}
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

// matchesSearch — то же самое условие, что ILIKE last_name/first_name в
// user_repository.go (buildListQuery), но применённое к одному, уже
// загруженному пользователю — см. добавление branch_owner-а самого себя в
// список преподавателей выше (UserHandler.List, ветка RoleBranchOwner):
// его нельзя прогнать через тот же SQL-фильтр, т.к. он выбирается не из
// БД по роли tutor, а подставляется вручную.
func matchesSearch(u *models.User, search string) bool {
	if search == "" {
		return true
	}
	q := strings.ToLower(search)
	return strings.Contains(strings.ToLower(u.LastName), q) || strings.Contains(strings.ToLower(u.FirstName), q)
}
