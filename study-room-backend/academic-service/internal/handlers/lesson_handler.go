package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"studyroom/academic-service/internal/events"
	"studyroom/academic-service/internal/middleware"
	"studyroom/academic-service/internal/models"
	"studyroom/academic-service/internal/repository"
)

type LessonHandler struct {
	lessons     *repository.LessonRepository
	enrollments *repository.EnrollmentRepository
	attendance  *repository.AttendanceRepository
	userRefs    *repository.UserRefRepository
	userClient  ChildrenResolver
	publisher   events.Publisher
}

func NewLessonHandler(
	lessons *repository.LessonRepository,
	enrollments *repository.EnrollmentRepository,
	attendance *repository.AttendanceRepository,
	userRefs *repository.UserRefRepository,
	userClient ChildrenResolver,
	publisher events.Publisher,
) *LessonHandler {
	return &LessonHandler{
		lessons: lessons, enrollments: enrollments, attendance: attendance,
		userRefs: userRefs, userClient: userClient, publisher: publisher,
	}
}

// List — GET /lessons?tutor_id=&student_id=&branch_id=&date_from=&date_to=
// (api-contracts.md 2.7). Как и в enrollments.List, сервер принудительно
// подставляет фильтр по своей области видимости и не доверяет query от
// клиента для tutor/branch_owner/parent/student.
func (h *LessonHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	filter := repository.LessonFilter{
		DateFrom: r.URL.Query().Get("date_from"),
		DateTo:   r.URL.Query().Get("date_to"),
	}

	switch claims.Role {
	case models.RoleOwner:
		if v, ok := parseIntQuery(r, "tutor_id"); ok {
			filter.TutorID = v
		}
		if v, ok := parseIntQuery(r, "student_id"); ok {
			filter.StudentID = v
		}
		if v, ok := parseIntQuery(r, "branch_id"); ok {
			filter.BranchID = v
		}
	case models.RoleBranchOwner:
		if claims.BranchID == nil {
			writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
		filter.BranchID = claims.BranchID
		if v, ok := parseIntQuery(r, "tutor_id"); ok {
			filter.TutorID = v
		}
		if v, ok := parseIntQuery(r, "student_id"); ok {
			filter.StudentID = v
		}
	case models.RoleTutor:
		tutorID := claims.UserID
		filter.TutorID = &tutorID
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
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted")
		return
	}

	lessons, err := h.lessons.List(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list lessons")
		return
	}

	// Отдаём participant_ids вместе со списком занятий: фронту это нужно,
	// чтобы у тьютора строить "Мои ученики" по факту созданных занятий,
	// а не по enrollments/course_tutors (см. models.Lesson.ParticipantIDs).
	lessonIDs := make([]int64, len(lessons))
	for i, l := range lessons {
		lessonIDs[i] = l.ID
	}
	participantsByLesson, err := h.lessons.ParticipantsByLessons(r.Context(), lessonIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load lesson participants")
		return
	}
	for _, l := range lessons {
		l.ParticipantIDs = participantsByLesson[l.ID]
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": nonNilLessons(lessons)})
}

func nonNilLessons(l []*models.Lesson) []*models.Lesson {
	if l == nil {
		return []*models.Lesson{}
	}
	return l
}

type createLessonRequest struct {
	CourseID     int64               `json:"course_id"`
	TutorID      int64               `json:"tutor_id"`
	Topic        string              `json:"topic"`
	LessonDate   string              `json:"lesson_date"`
	StartTime    string              `json:"start_time"`
	EndTime      string              `json:"end_time"`
	LocationType models.LocationType `json:"location_type"`
	GroupType    models.GroupType    `json:"group_type"`
	Comment      *string             `json:"comment"`
}

// Create — POST /lessons (api-contracts.md 2.8). created_by берётся из JWT,
// а не из тела запроса. Участники занятия в контракте отдельным полем не
// присылаются — они выводятся из активных записей ENROLLMENTS на этот курс
// (для individual-формата это обычно один ученик, для group — несколько);
// после создания занятия для каждого участника публикуется lesson.created.
func (h *LessonHandler) Create(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	var req createLessonRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.CourseID == 0 || req.TutorID == 0 || req.Topic == "" || req.LessonDate == "" ||
		req.StartTime == "" || req.EndTime == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "course_id, tutor_id, topic, lesson_date, start_time, end_time are required")
		return
	}
	if req.LocationType == "" {
		req.LocationType = models.LocationRemote
	}
	if req.GroupType == "" {
		req.GroupType = models.GroupIndividual
	}

	switch claims.Role {
	case models.RoleOwner:
		// любой tutor_id
	case models.RoleTutor:
		if req.TutorID != claims.UserID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "tutor can only create lessons for themselves")
			return
		}
	case models.RoleBranchOwner:
		tutorBranch, err := h.userRefs.BranchOf(r.Context(), req.TutorID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check tutor branch")
			return
		}
		if claims.BranchID == nil || tutorBranch == nil || *claims.BranchID != *tutorBranch {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "tutor_id must belong to your branch")
			return
		}
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted")
		return
	}

	enrollments, err := h.enrollments.List(r.Context(), repository.EnrollmentFilter{CourseID: &req.CourseID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load course enrollments")
		return
	}
	participantIDs := make([]int64, 0, len(enrollments))
	for _, e := range enrollments {
		if e.Status == models.EnrollmentActive {
			participantIDs = append(participantIDs, e.StudentID)
		}
	}

	lesson, err := h.lessons.Create(r.Context(), repository.LessonInput{
		CourseID: req.CourseID, TutorID: req.TutorID, CreatedBy: claims.UserID,
		Topic: req.Topic, LessonDate: req.LessonDate, StartTime: req.StartTime, EndTime: req.EndTime,
		LocationType: req.LocationType, GroupType: req.GroupType, Comment: req.Comment,
		ParticipantIDs: participantIDs,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to create lesson")
		return
	}

	for _, studentID := range participantIDs {
		h.publisher.LessonCreated(lesson.ID, lesson.TutorID, studentID, lesson.Topic, req.LessonDate, req.StartTime)
	}

	writeJSON(w, http.StatusCreated, lesson)
}

// checkLessonAccess — общая проверка для 2.9/2.10: тьютор видит только своё
// занятие, branch_owner — только занятия своего филиала, owner — любые.
// Пишет ответ об ошибке сама и возвращает ok=false, если доступа нет.
func (h *LessonHandler) checkLessonAccess(w http.ResponseWriter, r *http.Request, lessonID int64) (*models.Lesson, bool) {
	claims, _ := middleware.FromContext(r.Context())

	lesson, err := h.lessons.GetByID(r.Context(), lessonID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "lesson not found")
			return nil, false
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load lesson")
		return nil, false
	}

	switch claims.Role {
	case models.RoleOwner:
		return lesson, true
	case models.RoleTutor:
		if lesson.TutorID != claims.UserID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "not your lesson")
			return nil, false
		}
		return lesson, true
	case models.RoleBranchOwner:
		branchID, err := h.lessons.CourseBranchID(r.Context(), lessonID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check branch")
			return nil, false
		}
		if claims.BranchID == nil || *claims.BranchID != branchID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "lesson belongs to a different branch")
			return nil, false
		}
		return lesson, true
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted")
		return nil, false
	}
}

type updateLessonRequest struct {
	Topic        *string              `json:"topic"`
	LessonDate   *string              `json:"lesson_date"`
	StartTime    *string              `json:"start_time"`
	EndTime      *string              `json:"end_time"`
	LocationType *models.LocationType `json:"location_type"`
	GroupType    *models.GroupType    `json:"group_type"`
	Status       *models.LessonStatus `json:"status"`
	Comment      *string              `json:"comment"`
	TutorID      *int64               `json:"tutor_id"`
}

// Update — PATCH /lessons/{id} (api-contracts.md 2.9).
func (h *LessonHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid lesson id")
		return
	}
	if _, ok := h.checkLessonAccess(w, r, id); !ok {
		return
	}

	var req updateLessonRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	fields := map[string]any{}
	if req.Topic != nil {
		fields["topic"] = *req.Topic
	}
	if req.LessonDate != nil {
		fields["lesson_date"] = *req.LessonDate
	}
	if req.StartTime != nil {
		fields["start_time"] = *req.StartTime
	}
	if req.EndTime != nil {
		fields["end_time"] = *req.EndTime
	}
	if req.LocationType != nil {
		fields["location_type"] = *req.LocationType
	}
	if req.GroupType != nil {
		fields["group_type"] = *req.GroupType
	}
	if req.Status != nil {
		fields["status"] = *req.Status
	}
	if req.Comment != nil {
		fields["comment"] = *req.Comment
	}
	if req.TutorID != nil {
		fields["tutor_id"] = *req.TutorID
	}

	lesson, err := h.lessons.Update(r.Context(), id, fields)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to update lesson")
		return
	}
	writeJSON(w, http.StatusOK, lesson)
}

// Delete — DELETE /lessons/{id}, фактически отмена занятия.
func (h *LessonHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid lesson id")
		return
	}
	if _, ok := h.checkLessonAccess(w, r, id); !ok {
		return
	}
	if err := h.lessons.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "lesson not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to delete lesson")
		return
	}
	w.WriteHeader(http.StatusOK)
}

type attendanceRecord struct {
	StudentID     int64   `json:"student_id"`
	Status        string  `json:"status"`
	AbsenceReason *string `json:"absence_reason"`
}

type markAttendanceRequest struct {
	Records []attendanceRecord `json:"records"`
}

// MarkAttendance — POST /lessons/{id}/attendance (api-contracts.md 2.10).
// Для каждой записи со статусом "absent" публикуется attendance.marked_absent
// (слушает Notification Service — уведомление родителю).
func (h *LessonHandler) MarkAttendance(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid lesson id")
		return
	}
	if _, ok := h.checkLessonAccess(w, r, id); !ok {
		return
	}

	var req markAttendanceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	for _, rec := range req.Records {
		if rec.StudentID == 0 || (rec.Status != string(models.AttendancePresent) && rec.Status != string(models.AttendanceAbsent)) {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "each record needs student_id and a valid status")
			return
		}
		_, err := h.attendance.Mark(r.Context(), id, rec.StudentID, models.AttendanceStatus(rec.Status), rec.AbsenceReason)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to mark attendance")
			return
		}
		if rec.Status == string(models.AttendanceAbsent) {
			h.publisher.AttendanceMarkedAbsent(id, rec.StudentID, rec.AbsenceReason)
		}
	}
	w.WriteHeader(http.StatusOK)
}

// GetAttendance — GET /lessons/{id}/attendance (api-contracts.md 2.11).
// В отличие от checkLessonAccess (2.9/2.10), сюда допущены ещё parent
// (если участвует его ребёнок) и student (если участвует сам).
func (h *LessonHandler) GetAttendance(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid lesson id")
		return
	}

	switch claims.Role {
	case models.RoleOwner, models.RoleTutor, models.RoleBranchOwner:
		if _, ok := h.checkLessonAccess(w, r, id); !ok {
			return
		}
	case models.RoleStudent:
		participants, err := h.lessons.Participants(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load participants")
			return
		}
		if !containsInt64(participants, claims.UserID) {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "you don't participate in this lesson")
			return
		}
	case models.RoleParent:
		participants, err := h.lessons.Participants(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load participants")
			return
		}
		children, err := h.userClient.Children(r.Context(), bearerToken(r), claims.UserID)
		if err != nil {
			writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "failed to resolve children")
			return
		}
		if !anyIntersect(participants, children) {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "your child doesn't participate in this lesson")
			return
		}
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted")
		return
	}

	records, err := h.attendance.ListByLesson(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list attendance")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": nonNilAttendance(records)})
}

func nonNilAttendance(a []*models.Attendance) []*models.Attendance {
	if a == nil {
		return []*models.Attendance{}
	}
	return a
}

func containsInt64(list []int64, v int64) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func anyIntersect(a, b []int64) bool {
	set := make(map[int64]bool, len(a))
	for _, x := range a {
		set[x] = true
	}
	for _, y := range b {
		if set[y] {
			return true
		}
	}
	return false
}
