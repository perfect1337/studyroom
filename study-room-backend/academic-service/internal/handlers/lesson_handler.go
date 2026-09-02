package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"studyroom/academic-service/internal/events"
	"studyroom/academic-service/internal/middleware"
	"studyroom/academic-service/internal/models"
	"studyroom/academic-service/internal/repository"

	"github.com/go-chi/chi/v5"
)

type LessonHandler struct {
	lessons     *repository.LessonRepository
	enrollments *repository.EnrollmentRepository
	attendance  *repository.AttendanceRepository
	subgroups   *repository.SubgroupRepository
	userRefs    *repository.UserRefRepository
	userClient  ChildrenResolver
	publisher   events.Publisher
}

func NewLessonHandler(
	lessons *repository.LessonRepository,
	enrollments *repository.EnrollmentRepository,
	attendance *repository.AttendanceRepository,
	subgroups *repository.SubgroupRepository,
	userRefs *repository.UserRefRepository,
	userClient ChildrenResolver,
	publisher events.Publisher,
) *LessonHandler {
	return &LessonHandler{
		lessons: lessons, enrollments: enrollments, attendance: attendance, subgroups: subgroups,
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
		// Тьютор может дополнительно сузить список своих занятий по ученику
		// (фильтр в UI расписания репетитора) — это безопасно, так как
		// filter.TutorID уже принудительно зафиксирован выше и не приходит
		// от клиента, поэтому student_id здесь не расширяет область видимости.
		if v, ok := parseIntQuery(r, "student_id"); ok {
			filter.StudentID = v
		}
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

	// participant_names — фолбэк-имена из user_refs (см. Lesson.ParticipantNames):
	// не блокируем ответ, если резолв не удался, просто отдаём без имён.
	allParticipantIDs := make([]int64, 0, len(lessons))
	for _, l := range lessons {
		allParticipantIDs = append(allParticipantIDs, l.ParticipantIDs...)
	}
	if names, err := h.userRefs.NamesOf(r.Context(), allParticipantIDs); err == nil {
		for _, l := range lessons {
			if len(l.ParticipantIDs) == 0 {
				continue
			}
			m := make(map[int64]string, len(l.ParticipantIDs))
			for _, id := range l.ParticipantIDs {
				if name, ok := names[id]; ok {
					m[id] = name
				}
			}
			if len(m) > 0 {
				l.ParticipantNames = m
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": nonNilLessons(lessons)})
}

// recalculateProgress — пересчитывает progress_pct (см.
// EnrollmentRepository.RecalculateProgress) для списка учеников по одному
// курсу. Best-effort: ошибки пересчёта не прерывают основной запрос (создание
// /изменение/отмену занятия) — прогресс в этом случае просто останется
// прежним до следующего успешного пересчёта, вместо того чтобы ронять
// действие тьютора над самим занятием из-за побочного эффекта.
func (h *LessonHandler) recalculateProgress(ctx context.Context, courseID int64, studentIDs []int64) {
	for _, studentID := range studentIDs {
		_, _ = h.enrollments.RecalculateProgress(ctx, studentID, courseID)
	}
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
	// StudentID — конкретный ученик, для которого тьютор создаёт занятие
	// (см. TutorNewLesson.jsx, где выбор ученика обязателен ещё до курса).
	// Опционально: если не передан, сохраняется старое поведение —
	// участники берутся из ВСЕХ активных enrollments курса (актуально
	// только для по-настоящему группового занятия на весь курс сразу).
	// Именно отсутствие этого поля раньше приводило к тому, что занятие,
	// созданное тьютором для одного ученика, тихо утаскивало в участники
	// заодно и любого другого ученика, которого позже записали на тот же
	// курс — см. баг "второй ученик в расписании".
	StudentID *int64 `json:"student_id"`
	// SubgroupID — сохранённая подгруппа учеников (см. models.Subgroup),
	// альтернатива StudentID для группового занятия на конкретный набор
	// участников курса, а не на всех сразу и не на одного. Взаимоисключим
	// со StudentID — если передано и то, и другое, приоритет у SubgroupID
	// (см. LessonHandler.Create).
	SubgroupID *int64 `json:"subgroup_id"`
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

	lessonDate, err := time.Parse("2006-01-02", req.LessonDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "lesson_date must be YYYY-MM-DD")
		return
	}

	var participantIDs []int64
	switch {
	case req.SubgroupID != nil:
		// Занятие для сохранённой подгруппы — участники это её состав,
		// пересечённый с активными enrollments курса на данный момент (если
		// кто-то из подгруппы успел отчислиться/поставиться на паузу с
		// момента создания подгруппы, в занятие он всё равно не попадёт).
		sg, err := h.subgroups.GetByID(r.Context(), *req.SubgroupID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				writeError(w, http.StatusBadRequest, "BAD_REQUEST", "subgroup not found")
				return
			}
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load subgroup")
			return
		}
		if sg.CourseID != req.CourseID {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "subgroup does not belong to this course")
			return
		}
		if claims.Role == models.RoleTutor && sg.TutorID != claims.UserID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "subgroup belongs to another tutor")
			return
		}
		activeOnCourse := make(map[int64]bool, len(enrollments))
		for _, e := range enrollments {
			if e.Status == models.EnrollmentActive {
				activeOnCourse[e.StudentID] = true
			}
		}
		participantIDs = make([]int64, 0, len(sg.StudentIDs))
		for _, studentID := range sg.StudentIDs {
			if activeOnCourse[studentID] {
				participantIDs = append(participantIDs, studentID)
			}
		}
		if len(participantIDs) == 0 {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "no active students left in this subgroup")
			return
		}
	case req.StudentID != nil:
		// Тьютор явно выбрал ученика — занятие только для него, даже если
		// на курсе активны и другие enrollments (например, ученик, которого
		// записали на этот же курс уже после того, как расписание для
		// первого ученика начали вести).
		found := false
		for _, e := range enrollments {
			if e.Status == models.EnrollmentActive && e.StudentID == *req.StudentID {
				found = true
				break
			}
		}
		if !found {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "student has no active enrollment on this course")
			return
		}
		participantIDs = []int64{*req.StudentID}
	default:
		// Ни ученика, ни подгруппы не передали — старое поведение для
		// по-настоящему группового занятия на весь курс: участники это все
		// активные enrollments.
		participantIDs = make([]int64, 0, len(enrollments))
		for _, e := range enrollments {
			if e.Status == models.EnrollmentActive {
				participantIDs = append(participantIDs, e.StudentID)
			}
		}
	}

	// A lesson may only be scheduled while every participant has an active
	// enrollment and the lesson date is inside that enrollment's contract
	// period. This remains effective even if contract.expired is delayed.
	for _, studentID := range participantIDs {
		// При нескольких активных периодах по одному курсу достаточно одного
		// договора, который покрывает дату занятия. Раньше map затирала более
		// подходящий enrollment последним найденным, из-за чего валидная дата
		// могла случайно считаться недопустимой.
		validForDate := false
		for _, e := range enrollments {
			if e.StudentID != studentID || e.Status != models.EnrollmentActive {
				continue
			}
			if e.StartDate == nil || e.EndDate == nil {
				continue
			}
			if lessonDate.Before(*e.StartDate) || lessonDate.After(*e.EndDate) {
				continue
			}
			validForDate = true
			break
		}
		if !validForDate {
			hasActive := false
			for _, e := range enrollments {
				if e.StudentID == studentID && e.Status == models.EnrollmentActive {
					hasActive = true
					break
				}
			}
			if !hasActive {
				writeError(w, http.StatusBadRequest, "CONTRACT_INACTIVE", "У ученика нет действующего договора на этот курс.")
				return
			}
			// Даты договора обязательны для планирования занятия: иначе backend
			// не может доказать, что дата попадает в оплачиваемый период.
			writeError(w, http.StatusBadRequest, "CONTRACT_INACTIVE", "На выбранную дату у ученика нет действующего договора по этому курсу.")
			return
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

	// Новое занятие меняет знаменатель прогресса (см. RecalculateProgress) —
	// пересчитываем progress_pct участников сразу, а не ждём, пока по
	// занятию сменится статус. Best-effort: сбой пересчёта не должен
	// откатывать уже созданное занятие, поэтому ошибку не возвращаем.
	h.recalculateProgress(r.Context(), lesson.CourseID, participantIDs)

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
		branchID, err := h.lessons.TutorBranchID(r.Context(), lessonID)
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
	// SubgroupID — сменить состав участников группового занятия на состав
	// сохранённой подгруппы (см. models.Subgroup), взаимоисключимо с
	// ParticipantIDs (приоритет у SubgroupID, как и в Create). Позволяет
	// тьютору прямо из расписания отредактировать, для какой подгруппы
	// проводится уже созданное групповое занятие.
	SubgroupID *int64 `json:"subgroup_id"`
	// ParticipantIDs — явный список участников занятия, альтернатива
	// SubgroupID для ручной правки состава без привязки к сохранённой
	// подгруппе. Указатель на слайс (а не просто слайс), чтобы отличать
	// "поле не передано" от "передан пустой список" — последнее отклоняется
	// как невалидное (занятие не может остаться без участников).
	ParticipantIDs *[]int64 `json:"participant_ids"`
}

// Update — PATCH /lessons/{id} (api-contracts.md 2.9).
func (h *LessonHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid lesson id")
		return
	}
	lesson, ok := h.checkLessonAccess(w, r, id)
	if !ok {
		return
	}

	var req updateLessonRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	// Перенос занятия на другую дату разрешён только на дату, когда у каждого
	// участника есть активная запись на этот курс и дата попадает в период
	// действия его договора. Проверка обязательна на backend, потому что
	// фронтенд нельзя считать границей безопасности.
	if req.LessonDate != nil && *req.LessonDate != lesson.LessonDate.Format("2006-01-02") {
		newLessonDate, err := time.Parse("2006-01-02", *req.LessonDate)
		if err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "lesson_date must be YYYY-MM-DD")
			return
		}

		participants, err := h.lessons.Participants(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load lesson participants")
			return
		}
		enrollments, err := h.enrollments.List(r.Context(), repository.EnrollmentFilter{CourseID: &lesson.CourseID})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load course enrollments")
			return
		}

		for _, studentID := range participants {
			valid := false
			for _, e := range enrollments {
				if e.StudentID != studentID || e.Status != models.EnrollmentActive || e.StartDate == nil || e.EndDate == nil {
					continue
				}
				if newLessonDate.Before(*e.StartDate) || newLessonDate.After(*e.EndDate) {
					continue
				}
				valid = true
				break
			}
			if !valid {
				writeError(w, http.StatusBadRequest, "CONTRACT_INACTIVE", "Нельзя перенести занятие: на выбранную дату у ученика нет действующего договора.")
				return
			}
		}
	}

	// Смена состава участников группового занятия (subgroup_id и/или
	// participant_ids) — тьютор редактирует, для какой подгруппы/каких
	// учеников проводится уже созданное занятие, прямо из карточки в
	// расписании, не пересоздавая занятие заново. Разрешено только для
	// занятий, у которых group_type (с учётом возможной смены в этом же
	// запросе) остаётся "group" — для individual состав жёстко привязан к
	// одному ученику и меняется только пересозданием занятия.
	var oldParticipantIDs []int64
	var newParticipantIDs []int64
	wantsParticipantChange := req.SubgroupID != nil || req.ParticipantIDs != nil
	if wantsParticipantChange {
		effectiveGroupType := lesson.GroupType
		if req.GroupType != nil {
			effectiveGroupType = *req.GroupType
		}
		if effectiveGroupType != models.GroupGroup {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "changing participants is only allowed for group lessons")
			return
		}

		effectiveDateStr := lesson.LessonDate.Format("2006-01-02")
		if req.LessonDate != nil {
			effectiveDateStr = *req.LessonDate
		}
		effectiveDate, err := time.Parse("2006-01-02", effectiveDateStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "lesson_date must be YYYY-MM-DD")
			return
		}

		courseEnrollments, err := h.enrollments.List(r.Context(), repository.EnrollmentFilter{CourseID: &lesson.CourseID})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load course enrollments")
			return
		}
		activeOnCourse := make(map[int64]bool, len(courseEnrollments))
		for _, e := range courseEnrollments {
			if e.Status == models.EnrollmentActive {
				activeOnCourse[e.StudentID] = true
			}
		}

		switch {
		case req.SubgroupID != nil:
			sg, err := h.subgroups.GetByID(r.Context(), *req.SubgroupID)
			if err != nil {
				if errors.Is(err, repository.ErrNotFound) {
					writeError(w, http.StatusBadRequest, "BAD_REQUEST", "subgroup not found")
					return
				}
				writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load subgroup")
				return
			}
			if sg.CourseID != lesson.CourseID {
				writeError(w, http.StatusBadRequest, "BAD_REQUEST", "subgroup does not belong to this lesson's course")
				return
			}
			if sg.TutorID != lesson.TutorID {
				writeError(w, http.StatusForbidden, "FORBIDDEN", "subgroup belongs to another tutor")
				return
			}
			for _, studentID := range sg.StudentIDs {
				if activeOnCourse[studentID] {
					newParticipantIDs = append(newParticipantIDs, studentID)
				}
			}
			if len(newParticipantIDs) == 0 {
				writeError(w, http.StatusBadRequest, "BAD_REQUEST", "no active students left in this subgroup")
				return
			}
		case req.ParticipantIDs != nil:
			seen := make(map[int64]bool, len(*req.ParticipantIDs))
			for _, studentID := range *req.ParticipantIDs {
				if seen[studentID] {
					continue
				}
				seen[studentID] = true
				if !activeOnCourse[studentID] {
					writeError(w, http.StatusBadRequest, "BAD_REQUEST", "student has no active enrollment on this course")
					return
				}
				newParticipantIDs = append(newParticipantIDs, studentID)
			}
			if len(newParticipantIDs) == 0 {
				writeError(w, http.StatusBadRequest, "BAD_REQUEST", "participant_ids must not be empty")
				return
			}
		}

		// Как и при создании занятия/переносе даты — дата занятия должна
		// попадать в период действия договора у каждого нового участника.
		for _, studentID := range newParticipantIDs {
			valid := false
			for _, e := range courseEnrollments {
				if e.StudentID != studentID || e.Status != models.EnrollmentActive || e.StartDate == nil || e.EndDate == nil {
					continue
				}
				if effectiveDate.Before(*e.StartDate) || effectiveDate.After(*e.EndDate) {
					continue
				}
				valid = true
				break
			}
			if !valid {
				writeError(w, http.StatusBadRequest, "CONTRACT_INACTIVE", "На дату занятия у одного из учеников нет действующего договора по этому курсу.")
				return
			}
		}

		oldParticipantIDs, err = h.lessons.Participants(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load lesson participants")
			return
		}
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

	lesson, err = h.lessons.Update(r.Context(), id, fields)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to update lesson")
		return
	}

	if wantsParticipantChange {
		if err := h.lessons.ReplaceParticipants(r.Context(), id, newParticipantIDs); err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to update lesson participants")
			return
		}
		// Прогресс могли иметь как удалённые из состава ученики (у них
		// занятие больше не должно учитываться), так и добавленные — считаем
		// по объединению старого и нового состава, а не только по новому.
		union := make(map[int64]bool, len(oldParticipantIDs)+len(newParticipantIDs))
		affected := make([]int64, 0, len(oldParticipantIDs)+len(newParticipantIDs))
		for _, sid := range oldParticipantIDs {
			if !union[sid] {
				union[sid] = true
				affected = append(affected, sid)
			}
		}
		for _, sid := range newParticipantIDs {
			if !union[sid] {
				union[sid] = true
				affected = append(affected, sid)
			}
		}
		h.recalculateProgress(r.Context(), lesson.CourseID, affected)
	}

	// Смена статуса занятия (в первую очередь — отметка "проведено",
	// status='completed') меняет числитель/знаменатель прогресса ученика по
	// этому курсу, поэтому пересчитываем progress_pct всех участников
	// занятия. Раньше progress_pct правился отдельным ручным PATCH
	// /enrollments/{id} — теперь единственный способ его изменить — через
	// статус занятий: либо явным PATCH сюда (ручная правка администратором/
	// тьютором), либо автоматически по расписанию (см. cmd/api/main.go,
	// startAutoCompleteJob + LessonRepository.AutoCompletePast — как только
	// время занятия вышло, оно само становится 'completed' без участия
	// тьютора).
	//
	// Если статус меняют на 'cancelled' через этот же PATCH (а не через
	// DELETE /lessons/{id}) — публикуем то же lesson.cancelled, что и в
	// Delete ниже, чтобы участники узнали об отмене независимо от того,
	// каким способом её сделали.
	cancelledViaUpdate := req.Status != nil && *req.Status == models.LessonCancelled
	if req.Status != nil {
		participants, pErr := h.lessons.Participants(r.Context(), id)
		if pErr == nil {
			h.recalculateProgress(r.Context(), lesson.CourseID, participants)
			if cancelledViaUpdate {
				for _, studentID := range participants {
					h.publisher.LessonCancelled(lesson.ID, studentID, lesson.Topic, lesson.LessonDate.Format("2006-01-02"), lesson.StartTime)
				}
			}
		}
	}

	// Отдаём актуальный состав участников вместе с занятием: фронт мержит
	// ответ PATCH поверх локального lesson-объекта (см. handleLessonSaved в
	// TutorSchedule.jsx/ScheduleDirectory.jsx) и без этого поля продолжил бы
	// показывать старый состав до следующей фоновой перезагрузки расписания.
	if participants, pErr := h.lessons.Participants(r.Context(), id); pErr == nil {
		lesson.ParticipantIDs = participants
	}

	writeJSON(w, http.StatusOK, lesson)
}

// Delete — DELETE /lessons/{id}, фактически отмена занятия: помечает
// lessons.status = 'cancelled' (см. LessonRepository.Cancel), не удаляя
// строку — занятие остаётся в расписании у всех ролей со статусом
// "Отменено" вместо того, чтобы бесследно пропадать из истории.
func (h *LessonHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid lesson id")
		return
	}
	lesson, ok := h.checkLessonAccess(w, r, id)
	if !ok {
		return
	}
	if err := h.lessons.Cancel(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "lesson not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to cancel lesson")
		return
	}

	// Отменённое занятие исключается и из числителя, и из знаменателя
	// прогресса (см. RecalculateProgress), поэтому после отмены прогресс
	// участников нужно пересчитать точно так же, как при отметке "проведено".
	// Раньше здесь же ничего не публиковалось в NATS — участники узнавали
	// об отмене занятия только зайдя в приложение (см. комментарий у
	// Publisher в events/publisher.go).
	if participants, pErr := h.lessons.Participants(r.Context(), id); pErr == nil {
		h.recalculateProgress(r.Context(), lesson.CourseID, participants)
		for _, studentID := range participants {
			h.publisher.LessonCancelled(lesson.ID, studentID, lesson.Topic, lesson.LessonDate.Format("2006-01-02"), lesson.StartTime)
		}
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
