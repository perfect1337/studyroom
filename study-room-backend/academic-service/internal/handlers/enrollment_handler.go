package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"studyroom/academic-service/internal/auth"
	"studyroom/academic-service/internal/middleware"
	"studyroom/academic-service/internal/models"
	"studyroom/academic-service/internal/repository"
)

type EnrollmentHandler struct {
	repo       *repository.EnrollmentRepository
	userRefs   *repository.UserRefRepository
	userClient ChildrenResolver
}

func NewEnrollmentHandler(repo *repository.EnrollmentRepository, userRefs *repository.UserRefRepository, userClient ChildrenResolver) *EnrollmentHandler {
	return &EnrollmentHandler{repo: repo, userRefs: userRefs, userClient: userClient}
}

type createEnrollmentRequest struct {
	StudentID int64 `json:"student_id"`
	CourseID  int64 `json:"course_id"`
	// BranchID — необязательный, филиал ОКАЗАНИЯ УСЛУГИ по этой конкретной
	// записи (например, owner вручную зачисляет иногороднего ученика на
	// предмет в другом филиале, минуя договор). Если не передан, по
	// умолчанию берётся домашний филиал ученика (user_refs) — это
	// сохраняет прежнее поведение для типового случая "ученик учится там
	// же, где живёт".
	BranchID *int64 `json:"branch_id"`
}

// Create — POST /enrollments, owner only. Ручной способ, для случаев без
// договора (см. api-contracts.md 2.4) — основной путь это событие
// contract.created, см. internal/events/subscriber.go, где branch_id
// зачисления берётся из Contract.BranchID, а не из домашнего филиала
// ученика (см. CreateFromContract).
func (h *EnrollmentHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createEnrollmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.StudentID == 0 || req.CourseID == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "student_id and course_id are required")
		return
	}

	branchID := req.BranchID
	if branchID == nil {
		home, err := h.userRefs.BranchOf(r.Context(), req.StudentID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to resolve student branch")
			return
		}
		branchID = home
	}
	if branchID == nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "branch_id is required (student has no known home branch)")
		return
	}

	enrollment, err := h.repo.Create(r.Context(), req.StudentID, req.CourseID, *branchID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to create enrollment")
		return
	}
	writeJSON(w, http.StatusCreated, enrollment)
}

type assignTutorRequest struct {
	TutorID int64 `json:"tutor_id"`
}

// AssignTutor — PATCH /enrollments/{id}/assign-tutor. owner (любой филиал),
// branch_owner (только записи своего филиала) — см. api-contracts.md 2.4a.
func (h *EnrollmentHandler) AssignTutor(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid enrollment id")
		return
	}

	var req assignTutorRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.TutorID == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "tutor_id is required")
		return
	}

	if claims.Role == models.RoleBranchOwner {
		if !h.enrollmentInOwnBranch(w, r, id, claims) {
			return
		}
	}

	existing, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "enrollment not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load enrollment")
		return
	}
	// Личным тьютором ученика на курсе можно назначить только того, кто
	// вообще ведёт этот курс (course_tutors) — иначе легко получить
	// рассинхрон: enrollments.tutor_id указывает на человека, который
	// в этом курсе формально не преподаёт.
	teachesCourse, err := h.repo.CourseTaughtBy(r.Context(), existing.CourseID, req.TutorID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check course access")
		return
	}
	if !teachesCourse {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "tutor_id does not teach this course")
		return
	}

	enrollment, err := h.repo.AssignTutor(r.Context(), id, req.TutorID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "enrollment not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to assign tutor")
		return
	}
	writeJSON(w, http.StatusOK, enrollment)
}

// enrollmentInOwnBranch — true, если запись относится к курсу филиала
// вызывающего branch_owner; иначе пишет 403/404 в w сама и возвращает false.
func (h *EnrollmentHandler) enrollmentInOwnBranch(w http.ResponseWriter, r *http.Request, enrollmentID int64, claims *auth.Claims) bool {
	enrollment, err := h.repo.GetByID(r.Context(), enrollmentID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "enrollment not found")
			return false
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load enrollment")
		return false
	}
	branchID, err := h.repo.EnrollmentBranchID(r.Context(), enrollment.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check branch")
		return false
	}
	if claims.BranchID == nil || *claims.BranchID != branchID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "enrollment belongs to a different branch")
		return false
	}
	return true
}

// List — GET /enrollments?student_id=&tutor_id=&course_id= (api-contracts.md
// 2.5). Каждая роль получает вынужденный фильтр поверх того, что просит
// клиент в query — сервер никогда не доверяет клиенту границу доступа:
//   - tutor: только свои (tutor_id = claims.UserID, query игнорируется)
//   - parent: только свои дети (список получаем синхронно у User Service)
//   - student: только себя (student_id = claims.UserID)
//   - branch_owner: только свой филиал (по enrollments.branch_id — филиалу
//     оказания услуги конкретной записи, а не по домашнему филиалу ученика,
//     см. repository.EnrollmentFilter)
//   - owner: без ограничений, использует query как есть
func (h *EnrollmentHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	filter := repository.EnrollmentFilter{}

	switch claims.Role {
	case models.RoleOwner:
		if v, ok := parseIntQuery(r, "student_id"); ok {
			filter.StudentID = v
		}
		if v, ok := parseIntQuery(r, "tutor_id"); ok {
			filter.TutorID = v
		}
		if v, ok := parseIntQuery(r, "course_id"); ok {
			filter.CourseID = v
		}
	case models.RoleBranchOwner:
		if claims.BranchID == nil {
			writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
		// Если владелец филиала включил себе "версию учителя" (см. PATCH
		// /users/me/tutor-mode) и запрашивает СВОИХ учеников как
		// преподаватель (?tutor_id=<свой id>, так делает фронт в
		// TutorStudents.jsx/PeopleDirectory для role="tutor"), нужно то же
		// обогащение через course_tutors, что и у обычного tutor ниже
		// (см. ListForTutor) — иначе видны только записи, где кому-то
		// вручную проставили enrollments.tutor_id на него, а ученики,
		// записанные на его курс(ы) через course_tutors без этой ручной
		// проставки, из "Моих учеников" пропадают.
		if v, ok := parseIntQuery(r, "tutor_id"); ok && v != nil && claims.IsTutor && *v == claims.UserID {
			var courseID *int64
			if cv, ok := parseIntQuery(r, "course_id"); ok {
				courseID = cv
			}
			enrollments, err := h.repo.ListForTutor(r.Context(), claims.UserID, claims.BranchID, courseID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list enrollments")
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"items": nonNilEnrollments(enrollments)})
			return
		}
		filter.BranchID = claims.BranchID
		if v, ok := parseIntQuery(r, "tutor_id"); ok {
			filter.TutorID = v
		}
		if v, ok := parseIntQuery(r, "course_id"); ok {
			filter.CourseID = v
		}
	case models.RoleTutor:
		// "Мои ученики" — ученики его филиала, записанные на курс(ы),
		// которые он реально ведёт (course_tutors), а не только те, кому
		// его вручную проставили в enrollments.tutor_id (см. ADR в
		// repository.EnrollmentRepository.ListForTutor).
		if claims.BranchID == nil {
			writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
		var courseID *int64
		if v, ok := parseIntQuery(r, "course_id"); ok {
			courseID = v
		}
		enrollments, err := h.repo.ListForTutor(r.Context(), claims.UserID, claims.BranchID, courseID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list enrollments")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": nonNilEnrollments(enrollments)})
		return
	case models.RoleStudent:
		studentID := claims.UserID
		filter.StudentID = &studentID
		// Ученик видит только текущие активные записи на курсы.
		// История completed/terminated доступна владельцу сети.
		filter.Status = "active"
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
		// Родитель видит только активные записи на текущие курсы.
		// История завершённых/расторгнутых курсов оставляется staff-ролям.
		filter.Status = "active"
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted")
		return
	}

	enrollments, err := h.repo.List(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list enrollments")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": nonNilEnrollments(enrollments)})
}

func nonNilEnrollments(e []*models.Enrollment) []*models.Enrollment {
	if e == nil {
		return []*models.Enrollment{}
	}
	return e
}

type updateEnrollmentRequest struct {
	Status    *string `json:"status"`
	StartDate *string `json:"start_date"`
	EndDate   *string `json:"end_date"`
}

// Update — PATCH /enrollments/{id}. tutor (свои ученики), owner,
// branch_owner (свой филиал) — см. api-contracts.md 2.6.
//
// progress_pct сюда больше не принимается: прогресс ученика по курсу
// теперь считается автоматически, по количеству занятий, которые
// преподаватель реально отметил как проведённые (status='completed') —
// см. repository.EnrollmentRepository.RecalculateProgress, вызывается из
// LessonHandler при создании/изменении/отмене занятия. Если в теле запроса
// всё же придёт progress_pct, поле просто игнорируется.
func (h *EnrollmentHandler) Update(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid enrollment id")
		return
	}

	enrollment, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "enrollment not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load enrollment")
		return
	}

	switch claims.Role {
	case models.RoleOwner:
		// без ограничений
	case models.RoleBranchOwner:
		branchID, err := h.repo.EnrollmentBranchID(r.Context(), enrollment.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check branch")
			return
		}
		if claims.BranchID == nil || *claims.BranchID != branchID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "enrollment belongs to a different branch")
			return
		}
	case models.RoleTutor:
		isAssigned := enrollment.TutorID != nil && *enrollment.TutorID == claims.UserID
		if !isAssigned {
			teachesCourse, err := h.repo.CourseTaughtBy(r.Context(), enrollment.CourseID, claims.UserID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check course access")
				return
			}
			if !teachesCourse {
				writeError(w, http.StatusForbidden, "FORBIDDEN", "not your student")
				return
			}
		}
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted")
		return
	}

	var req updateEnrollmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	fields := map[string]any{}
	if req.Status != nil {
		fields["status"] = *req.Status
	}
	if req.StartDate != nil {
		fields["start_date"] = *req.StartDate
	}
	if req.EndDate != nil {
		fields["end_date"] = *req.EndDate
	}

	updated, err := h.repo.UpdateProgress(r.Context(), id, fields)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to update enrollment")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// StudentsByBranch — GET /enrollments/branch/{branchID}/students
// Возвращает список student IDs, у которых есть enrollment в указанном филиале.
// Используется user-service для фильтрации учеников branch_owner'а — чтобы
// видеть не только "домашних" учеников (users.branch_id), но и иногородних,
// которые обучаются в этом филиале по enrollment (enrollments.branch_id).
// Доступно owner и branch_owner.
func (h *EnrollmentHandler) StudentsByBranch(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	if claims.Role != models.RoleOwner && claims.Role != models.RoleBranchOwner {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only owner or branch_owner can access")
		return
	}

	id, err := parseIntPath(chi.URLParam(r, "branchID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid branchID")
		return
	}

	studentIDs, err := h.repo.StudentIDsByBranch(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list students")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"student_ids": studentIDs})
}

// StudentsByTutor — GET /enrollments/tutor/{tutorID}/students
// Возвращает student IDs с активным enrollment у указанного тьютора,
// независимо от домашнего филиала ученика. Используется user-service
// (см. academicclient.StudentIDsByTutor) — тот же принцип, что и
// StudentsByBranch выше, только "иногородний" здесь означает "домашний
// филиал ученика отличается от филиала самого тьютора", а не branch_owner'а.
// Доступ: owner — любой tutorID; tutor — только про самого себя (иначе один
// репетитор мог бы узнать состав учеников другого, просто подставив чужой id).
func (h *EnrollmentHandler) StudentsByTutor(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	id, err := parseIntPath(chi.URLParam(r, "tutorID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid tutorID")
		return
	}

	switch claims.Role {
	case models.RoleOwner:
		// разрешено
	case models.RoleTutor:
		if claims.UserID != id {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "tutor can only query own students")
			return
		}
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only owner or tutor can access")
		return
	}

	studentIDs, err := h.repo.StudentIDsByTutor(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list students")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"student_ids": studentIDs})
}

func bearerToken(r *http.Request) string {
	return strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
}
