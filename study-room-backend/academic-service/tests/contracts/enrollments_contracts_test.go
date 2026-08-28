package contracts_test

import (
	"context"
	"testing"

	"studyroom/academic-service/internal/models"
)

// seedCourse — создаёт курс через сам API от имени owner, возвращает его id.
func (e *env) seedCourse(title string, branchID int64) int64 {
	e.t.Helper()
	owner := e.accessToken(999999, models.RoleOwner, nil)
	res := e.do("POST", "/api/v1/academic/courses", map[string]any{
		"title": title, "subject": "Тест", "format": "individual", "branch_id": branchID,
	}, owner)
	e.mustOK(res, 201)
	id, _ := res.Body["id"].(float64)
	return int64(id)
}

// TestEnrollments_Create_OwnerOnly — POST /enrollments, owner only
// (api-contracts.md 2.4). Новая запись стартует active/0/tutor_id=null.
func TestEnrollments_Create_OwnerOnly(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	tutor := e.accessToken(2, models.RoleTutor, branchPtr(1))
	courseID := e.seedCourse("Курс A", 1)

	res := e.do("POST", "/api/v1/academic/enrollments", map[string]any{
		"student_id": 100, "course_id": courseID,
	}, tutor)
	if res.Status != 403 {
		t.Fatalf("tutor create enrollment: status=%d want=403", res.Status)
	}

	res = e.do("POST", "/api/v1/academic/enrollments", map[string]any{
		"student_id": 100, "course_id": courseID,
	}, owner)
	e.mustOK(res, 201)
	if res.Body["status"] != "active" {
		t.Fatalf("status=%v want=active", res.Body["status"])
	}
	if pct, _ := res.Body["progress_pct"].(float64); pct != 0 {
		t.Fatalf("progress_pct=%v want=0", res.Body["progress_pct"])
	}
	if res.Body["tutor_id"] != nil {
		t.Fatalf("tutor_id=%v want=nil", res.Body["tutor_id"])
	}
}

// TestEnrollments_AssignTutor_BranchScoping — PATCH /enrollments/{id}/assign-tutor:
// owner — любой филиал, branch_owner — только свой (api-contracts.md 2.4a).
func TestEnrollments_AssignTutor_BranchScoping(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	branchOwner1 := e.accessToken(2, models.RoleBranchOwner, branchPtr(1))
	branchOwner2 := e.accessToken(3, models.RoleBranchOwner, branchPtr(2))

	courseID := e.seedCourse("Курс филиала 1", 1)
	res := e.do("POST", "/api/v1/academic/enrollments", map[string]any{"student_id": 100, "course_id": courseID}, owner)
	e.mustOK(res, 201)
	enrollmentID := toPathID(res.Body["id"])

	// tutor 15 должен реально вести этот курс (course_tutors) — иначе
	// assign-tutor теперь отвечает 400 "tutor_id does not teach this course".
	e.assignCourseTutor(courseID, 15)

	// чужой филиал -> 403
	res = e.do("PATCH", "/api/v1/academic/enrollments/"+enrollmentID+"/assign-tutor",
		map[string]any{"tutor_id": 15}, branchOwner2)
	if res.Status != 403 {
		t.Fatalf("branch_owner (wrong branch) assign-tutor: status=%d want=403", res.Status)
	}

	// свой филиал -> 200
	res = e.do("PATCH", "/api/v1/academic/enrollments/"+enrollmentID+"/assign-tutor",
		map[string]any{"tutor_id": 15}, branchOwner1)
	e.mustOK(res, 200)
	if tutorID, _ := res.Body["tutor_id"].(float64); tutorID != 15 {
		t.Fatalf("tutor_id=%v want=15", res.Body["tutor_id"])
	}
}

// TestEnrollments_List_RoleScoping — GET /enrollments: tutor только свои,
// parent только детские, student только себя, branch_owner только свой
// филиал, owner без ограничений (api-contracts.md 2.5).
func TestEnrollments_List_RoleScoping(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)

	courseA := e.seedCourse("Курс филиала 1", 1)
	courseB := e.seedCourse("Курс филиала 2", 2)

	mustCreate := func(studentID, courseID int64) int64 {
		res := e.do("POST", "/api/v1/academic/enrollments", map[string]any{"student_id": studentID, "course_id": courseID}, owner)
		e.mustOK(res, 201)
		id, _ := res.Body["id"].(float64)
		return int64(id)
	}
	eStudent100 := mustCreate(100, courseA) // branch 1
	_ = mustCreate(200, courseB)            // branch 2, student 200

	// tutor 15 реально ведёт courseA (course_tutors) — это то, что теперь
	// определяет видимость "моих учеников", а не только личное назначение
	// на конкретную запись.
	e.assignCourseTutor(courseA, 15)

	// назначим тьютора 15 личным репетитором на запись студента 100
	assignRes := e.do("PATCH", "/api/v1/academic/enrollments/"+toPathID(eStudent100)+"/assign-tutor",
		map[string]any{"tutor_id": 15}, owner)
	e.mustOK(assignRes, 200)

	// tutor 15 видит только свою запись (студент 100), не запись студента 200
	tutor := e.accessToken(15, models.RoleTutor, branchPtr(1))
	res := e.do("GET", "/api/v1/academic/enrollments", nil, tutor)
	e.mustOK(res, 200)
	items := asSlice(res.Body["items"])
	if len(items) != 1 {
		t.Fatalf("tutor: got %d enrollments, want 1", len(items))
	}

	// student 100 видит только свою запись
	student := e.accessToken(100, models.RoleStudent, branchPtr(1))
	res = e.do("GET", "/api/v1/academic/enrollments", nil, student)
	e.mustOK(res, 200)
	items = asSlice(res.Body["items"])
	if len(items) != 1 {
		t.Fatalf("student: got %d enrollments, want 1", len(items))
	}

	// parent видит записи только своих детей — 300 не является родителем 100/200
	e.children.set(300, 100) // parent 300 -> child 100
	parent := e.accessToken(300, models.RoleParent, nil)
	res = e.do("GET", "/api/v1/academic/enrollments", nil, parent)
	e.mustOK(res, 200)
	items = asSlice(res.Body["items"])
	if len(items) != 1 {
		t.Fatalf("parent: got %d enrollments, want 1 (only child 100)", len(items))
	}

	// branch_owner филиала 2 видит только запись студента 200
	branchOwner2 := e.accessToken(4, models.RoleBranchOwner, branchPtr(2))
	res = e.do("GET", "/api/v1/academic/enrollments", nil, branchOwner2)
	e.mustOK(res, 200)
	items = asSlice(res.Body["items"])
	if len(items) != 1 {
		t.Fatalf("branch_owner(2): got %d enrollments, want 1", len(items))
	}

	// owner видит обе записи
	res = e.do("GET", "/api/v1/academic/enrollments", nil, owner)
	e.mustOK(res, 200)
	if items := asSlice(res.Body["items"]); len(items) != 2 {
		t.Fatalf("owner: got %d enrollments, want 2", len(items))
	}
}

// TestEnrollments_Update_TutorOwnStudentsOnly — PATCH /enrollments/{id}:
// tutor может менять запись только своих учеников (api-contracts.md 2.6).
// progress_pct через этот эндпоинт больше не выставляется вручную (см.
// EnrollmentHandler.Update) — прогресс считается автоматически по занятиям,
// поэтому здесь проверяется доступ на примере поля status, а не progress_pct.
func TestEnrollments_Update_TutorOwnStudentsOnly(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	courseID := e.seedCourse("Курс", 1)

	res := e.do("POST", "/api/v1/academic/enrollments", map[string]any{"student_id": 100, "course_id": courseID}, owner)
	e.mustOK(res, 201)
	enrollmentID := toPathID(res.Body["id"])

	// tutor 15 ещё не назначен на эту запись -> 403
	tutor15 := e.accessToken(15, models.RoleTutor, branchPtr(1))
	res = e.do("PATCH", "/api/v1/academic/enrollments/"+enrollmentID,
		map[string]any{"status": "paused"}, tutor15)
	if res.Status != 403 {
		t.Fatalf("unassigned tutor update: status=%d want=403", res.Status)
	}

	assignRes := e.do("PATCH", "/api/v1/academic/enrollments/"+enrollmentID+"/assign-tutor",
		map[string]any{"tutor_id": 15}, owner)
	if assignRes.Status != 400 {
		t.Fatalf("assign-tutor before tutor teaches the course: status=%d want=400", assignRes.Status)
	}

	// tutor 15 теперь реально ведёт курс (course_tutors) -> assign-tutor
	// на конкретного ученика становится возможным.
	e.assignCourseTutor(courseID, 15)
	assignRes = e.do("PATCH", "/api/v1/academic/enrollments/"+enrollmentID+"/assign-tutor",
		map[string]any{"tutor_id": 15}, owner)
	e.mustOK(assignRes, 200)

	res = e.do("PATCH", "/api/v1/academic/enrollments/"+enrollmentID,
		map[string]any{"status": "paused"}, tutor15)
	e.mustOK(res, 200)
	if res.Body["status"] != "paused" {
		t.Fatalf("status=%v want=paused", res.Body["status"])
	}

	// Попытка выставить progress_pct вручную тихо игнорируется — значение
	// не меняется этим PATCH (см. updateEnrollmentRequest без ProgressPct).
	res = e.do("PATCH", "/api/v1/academic/enrollments/"+enrollmentID,
		map[string]any{"progress_pct": 50}, tutor15)
	e.mustOK(res, 200)
	if pct, _ := res.Body["progress_pct"].(float64); pct != 0 {
		t.Fatalf("progress_pct=%v want=0 (manual progress_pct must be ignored)", res.Body["progress_pct"])
	}
}

// TestEnrollments_ProgressPct_AutoFromCompletedLessons — прогресс ученика по
// курсу растёт автоматически по мере того, как преподаватель отмечает его
// занятия проведёнными (status='completed'), и не может быть выставлен
// вручную через PATCH /enrollments/{id} (см. EnrollmentRepository.
// RecalculateProgress, вызывается из LessonHandler).
func TestEnrollments_ProgressPct_AutoFromCompletedLessons(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	tutor := e.accessToken(15, models.RoleTutor, branchPtr(1))
	courseID := e.seedCourse("Курс с занятиями", 1)
	e.assignCourseTutor(courseID, 15)

	res := e.do("POST", "/api/v1/academic/enrollments",
		map[string]any{"student_id": 100, "course_id": courseID}, owner)
	e.mustOK(res, 201)

	createLesson := func(topic, date string) string {
		res := e.do("POST", "/api/v1/academic/lessons", map[string]any{
			"course_id": courseID, "tutor_id": 15, "student_id": 100,
			"topic": topic, "lesson_date": date, "start_time": "10:00", "end_time": "11:00",
		}, tutor)
		e.mustOK(res, 201)
		id, _ := res.Body["id"].(float64)
		return toPathID(int64(id))
	}

	lesson1 := createLesson("Тема 1", "2025-01-01")
	lesson2 := createLesson("Тема 2", "2025-01-08")

	// Пока ни одно занятие не проведено — прогресс 0%.
	getRes := e.do("GET", "/api/v1/academic/enrollments?student_id=100", nil, owner)
	e.mustOK(getRes, 200)
	items := asSlice(getRes.Body["items"])
	if len(items) != 1 {
		t.Fatalf("got %d enrollments, want 1", len(items))
	}
	if pct, _ := items[0].(map[string]any)["progress_pct"].(float64); pct != 0 {
		t.Fatalf("initial progress_pct=%v want=0", pct)
	}

	// Отмечаем первое занятие проведённым -> прогресс должен стать 50%
	// (1 из 2 неотменённых занятий).
	res = e.do("PATCH", "/api/v1/academic/lessons/"+lesson1,
		map[string]any{"status": "completed"}, tutor)
	e.mustOK(res, 200)

	getRes = e.do("GET", "/api/v1/academic/enrollments?student_id=100", nil, owner)
	e.mustOK(getRes, 200)
	items = asSlice(getRes.Body["items"])
	if pct, _ := items[0].(map[string]any)["progress_pct"].(float64); pct != 50 {
		t.Fatalf("progress_pct after 1/2 completed=%v want=50", pct)
	}

	// Отмечаем второе занятие проведённым -> прогресс 100%.
	res = e.do("PATCH", "/api/v1/academic/lessons/"+lesson2,
		map[string]any{"status": "completed"}, tutor)
	e.mustOK(res, 200)

	getRes = e.do("GET", "/api/v1/academic/enrollments?student_id=100", nil, owner)
	e.mustOK(getRes, 200)
	items = asSlice(getRes.Body["items"])
	if pct, _ := items[0].(map[string]any)["progress_pct"].(float64); pct != 100 {
		t.Fatalf("progress_pct after 2/2 completed=%v want=100", pct)
	}
}

// TestContractTerminated_CancelsLessonsAndTerminatesEnrollment — сценарий
// "расторгли договор -> все занятия ученика по курсу отменяются вместе с
// самим enrollment". Подписчик NATS (handleContractTerminated,
// events/subscriber.go) в этих HTTP-контрактных тестах не поднимается (см.
// setup_test.go — используется events.NoopPublisher{} без реального
// брокера), поэтому здесь напрямую вызываются те же самые методы
// репозиториев, которые вызывает подписчик, — CancelForStudentAndCourse и
// TerminateForCourse — это то, что реально важно протестировать: их
// поведение, а не факт доставки события по сети.
func TestContractTerminated_CancelsLessonsAndTerminatesEnrollment(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	tutor := e.accessToken(15, models.RoleTutor, branchPtr(1))
	courseID := e.seedCourse("Курс для расторжения", 1)
	e.assignCourseTutor(courseID, 15)

	res := e.do("POST", "/api/v1/academic/enrollments",
		map[string]any{"student_id": 100, "course_id": courseID}, owner)
	e.mustOK(res, 201)

	createLesson := func(topic, date string) string {
		res := e.do("POST", "/api/v1/academic/lessons", map[string]any{
			"course_id": courseID, "tutor_id": 15, "student_id": 100,
			"topic": topic, "lesson_date": date, "start_time": "10:00", "end_time": "11:00",
		}, tutor)
		e.mustOK(res, 201)
		id, _ := res.Body["id"].(float64)
		return toPathID(int64(id))
	}

	// Одно занятие уже проведено — должно остаться как есть после
	// расторжения (история не переписывается).
	pastLesson := createLesson("Прошедшая тема", "2025-01-01")
	e.mustOK(e.do("PATCH", "/api/v1/academic/lessons/"+pastLesson,
		map[string]any{"status": "completed"}, tutor), 200)

	// Ещё два занятия впереди — должны быть отменены расторжением.
	futureLesson1 := createLesson("Будущая тема 1", "2025-02-01")
	futureLesson2 := createLesson("Будущая тема 2", "2025-02-08")

	cancelled, err := e.deps.Lessons.CancelForStudentAndCourse(context.Background(), 100, courseID)
	if err != nil {
		t.Fatalf("CancelForStudentAndCourse error: %v", err)
	}
	if cancelled != 2 {
		t.Fatalf("cancelled=%d want=2", cancelled)
	}

	terminated, err := e.deps.Enrollments.TerminateForCourse(context.Background(), 100, courseID)
	if err != nil {
		t.Fatalf("TerminateForCourse error: %v", err)
	}
	if terminated != 1 {
		t.Fatalf("terminated enrollments=%d want=1", terminated)
	}

	// Прошедшее занятие осталось completed.
	getLesson := e.do("GET", "/api/v1/academic/lessons?student_id=100", nil, owner)
	e.mustOK(getLesson, 200)
	byID := map[string]string{}
	for _, item := range asSlice(getLesson.Body["items"]) {
		m := item.(map[string]any)
		byID[toPathID(m["id"])] = m["status"].(string)
	}
	if byID[pastLesson] != "completed" {
		t.Fatalf("past lesson status=%v want=completed", byID[pastLesson])
	}
	if byID[futureLesson1] != "cancelled" || byID[futureLesson2] != "cancelled" {
		t.Fatalf("future lessons not cancelled: %+v", byID)
	}

	// Enrollment переведён в terminated.
	getEnrollment := e.do("GET", "/api/v1/academic/enrollments?student_id=100&course_id="+toPathID(float64(courseID)), nil, owner)
	e.mustOK(getEnrollment, 200)
	items = asSlice(getEnrollment.Body["items"])
	if len(items) != 1 {
		t.Fatalf("got %d enrollments, want 1", len(items))
	}
	if items[0].(map[string]any)["status"] != "terminated" {
		t.Fatalf("enrollment status=%v want=terminated", items[0].(map[string]any)["status"])
	}
}

// TestAutoCompletePast_MarksPastScheduledLessonsCompleted — занятие должно
// само становиться "проведённым", как только его время вышло, без клика
// тьютора (см. LessonRepository.AutoCompletePast, запускается фоновой
// джобой в cmd/api/main.go). Не отменённое занятие "вчера" считается
// проведённым; будущее занятие (создано на 2099 год) остаётся
// запланированным; отменённое занятие "вчера" остаётся отменённым.
func TestAutoCompletePast_MarksPastScheduledLessonsCompleted(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	tutor := e.accessToken(15, models.RoleTutor, branchPtr(1))
	courseID := e.seedCourse("Курс для автозавершения", 1)
	e.assignCourseTutor(courseID, 15)

	res := e.do("POST", "/api/v1/academic/enrollments",
		map[string]any{"student_id": 100, "course_id": courseID}, owner)
	e.mustOK(res, 201)

	createLesson := func(topic, date string) string {
		res := e.do("POST", "/api/v1/academic/lessons", map[string]any{
			"course_id": courseID, "tutor_id": 15, "student_id": 100,
			"topic": topic, "lesson_date": date, "start_time": "10:00", "end_time": "11:00",
		}, tutor)
		e.mustOK(res, 201)
		id, _ := res.Body["id"].(float64)
		return toPathID(int64(id))
	}

	pastLesson := createLesson("Вчерашнее занятие", "2020-01-01")
	futureLesson := createLesson("Будущее занятие", "2099-01-01")
	cancelledLesson := createLesson("Отменённое вчера", "2020-01-01")
	e.mustOK(e.do("DELETE", "/api/v1/academic/lessons/"+cancelledLesson, nil, tutor), 200)

	pairs, err := e.deps.Lessons.AutoCompletePast(context.Background())
	if err != nil {
		t.Fatalf("AutoCompletePast error: %v", err)
	}
	if len(pairs) != 1 || pairs[0].StudentID != 100 || pairs[0].CourseID != courseID {
		t.Fatalf("pairs=%+v want=[{100 %d}]", pairs, courseID)
	}

	getLessons := e.do("GET", "/api/v1/academic/lessons?student_id=100", nil, owner)
	e.mustOK(getLessons, 200)
	byID := map[string]string{}
	for _, item := range asSlice(getLessons.Body["items"]) {
		m := item.(map[string]any)
		byID[toPathID(m["id"])] = m["status"].(string)
	}
	if byID[pastLesson] != "completed" {
		t.Fatalf("past lesson status=%v want=completed", byID[pastLesson])
	}
	if byID[futureLesson] != "scheduled" {
		t.Fatalf("future lesson status=%v want=scheduled", byID[futureLesson])
	}
	if byID[cancelledLesson] != "cancelled" {
		t.Fatalf("cancelled lesson status=%v want=cancelled (must stay cancelled, not resurrected as completed)", byID[cancelledLesson])
	}

	// Повторный вызов не должен находить уже обработанные занятия заново.
	pairsAgain, err := e.deps.Lessons.AutoCompletePast(context.Background())
	if err != nil {
		t.Fatalf("AutoCompletePast (2nd call) error: %v", err)
	}
	if len(pairsAgain) != 0 {
		t.Fatalf("2nd call pairs=%+v want=empty", pairsAgain)
	}

	// Прогресс пересчитывается по паре (ученик, курс), которую вернул
	// AutoCompletePast — как это делает фоновая джоба.
	if _, err := e.deps.Enrollments.RecalculateProgress(context.Background(), 100, courseID); err != nil {
		t.Fatalf("RecalculateProgress error: %v", err)
	}
	getEnrollment := e.do("GET", "/api/v1/academic/enrollments?student_id=100&course_id="+toPathID(float64(courseID)), nil, owner)
	e.mustOK(getEnrollment, 200)
	items := asSlice(getEnrollment.Body["items"])
	// 1 проведённое (pastLesson) + 1 запланированное (futureLesson) в
	// знаменателе; отменённое в знаменатель не входит.
	if pct, _ := items[0].(map[string]any)["progress_pct"].(float64); pct != 50 {
		t.Fatalf("progress_pct=%v want=50", pct)
	}
}

