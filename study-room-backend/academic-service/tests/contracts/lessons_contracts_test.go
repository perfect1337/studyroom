package contracts_test

import (
	"testing"

	"studyroom/academic-service/internal/models"
)

// seedActiveEnrollment создаёт курс + запись студента на него со статусом
// active, чтобы POST /lessons мог вывести из неё участников занятия
// (см. handlers.LessonHandler.Create).
func (e *env) seedActiveEnrollment(studentID, courseID int64) {
	e.t.Helper()
	owner := e.accessToken(999998, models.RoleOwner, nil)
	res := e.do("POST", "/api/v1/academic/enrollments", map[string]any{
		"student_id": studentID, "course_id": courseID,
	}, owner)
	e.mustOK(res, 201)
}

// TestLessons_Create_TutorSelfOnly — POST /lessons: tutor может создавать
// занятия только для себя, owner — для любого репетитора
// (api-contracts.md 2.8).
func TestLessons_Create_TutorSelfOnly(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	courseID := e.seedCourse("Алгебра", 1)
	e.seedActiveEnrollment(100, courseID)

	tutor15 := e.accessToken(15, models.RoleTutor, branchPtr(1))
	body := map[string]any{
		"course_id": courseID, "tutor_id": 20, "topic": "Введение",
		"lesson_date": "2026-08-01", "start_time": "10:00", "end_time": "11:00",
		"location_type": "remote", "group_type": "individual",
	}
	res := e.do("POST", "/api/v1/academic/lessons", body, tutor15)
	if res.Status != 403 {
		t.Fatalf("tutor creating lesson for someone else: status=%d want=403", res.Status)
	}

	body["tutor_id"] = 15
	res = e.do("POST", "/api/v1/academic/lessons", body, tutor15)
	e.mustOK(res, 201)
	if res.Body["topic"] != "Введение" {
		t.Fatalf("unexpected topic: %v", res.Body["topic"])
	}

	// owner может создать занятие с любым tutor_id
	body["tutor_id"] = 20
	res = e.do("POST", "/api/v1/academic/lessons", body, owner)
	e.mustOK(res, 201)
}

// TestLessons_Create_BranchOwnerTutorMustBeInBranch — branch_owner может
// назначать только tutor_id из своего филиала (api-contracts.md 2.8).
func TestLessons_Create_BranchOwnerTutorMustBeInBranch(t *testing.T) {
	e := getEnv(t)
	courseID := e.seedCourse("Химия", 1)
	e.seedActiveEnrollment(100, courseID)

	e.seedUserRef(15, "Тьютор из филиала 1", models.RoleTutor, branchPtr(1))
	e.seedUserRef(16, "Тьютор из филиала 2", models.RoleTutor, branchPtr(2))

	branchOwner1 := e.accessToken(2, models.RoleBranchOwner, branchPtr(1))
	body := map[string]any{
		"course_id": courseID, "tutor_id": 16, "topic": "Тема",
		"lesson_date": "2026-08-01", "start_time": "10:00", "end_time": "11:00",
	}
	res := e.do("POST", "/api/v1/academic/lessons", body, branchOwner1)
	if res.Status != 403 {
		t.Fatalf("branch_owner assigning tutor from another branch: status=%d want=403", res.Status)
	}

	body["tutor_id"] = 15
	res = e.do("POST", "/api/v1/academic/lessons", body, branchOwner1)
	e.mustOK(res, 201)
}

// TestLessons_List_RoleScoping — GET /lessons: tutor только свои занятия,
// student/parent только свои/детские (api-contracts.md 2.7).
func TestLessons_List_RoleScoping(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	courseID := e.seedCourse("География", 1)
	e.seedActiveEnrollment(100, courseID)

	create := func(tutorID int64, topic string) {
		body := map[string]any{
			"course_id": courseID, "tutor_id": tutorID, "topic": topic,
			"lesson_date": "2026-08-01", "start_time": "10:00", "end_time": "11:00",
		}
		res := e.do("POST", "/api/v1/academic/lessons", body, owner)
		e.mustOK(res, 201)
	}
	create(15, "Занятие тьютора 15")
	create(16, "Занятие тьютора 16")

	tutor15 := e.accessToken(15, models.RoleTutor, branchPtr(1))
	res := e.do("GET", "/api/v1/academic/lessons", nil, tutor15)
	e.mustOK(res, 200)
	items := asSlice(res.Body["items"])
	if len(items) != 1 {
		t.Fatalf("tutor: got %d lessons, want 1", len(items))
	}

	student := e.accessToken(100, models.RoleStudent, branchPtr(1))
	res = e.do("GET", "/api/v1/academic/lessons", nil, student)
	e.mustOK(res, 200)
	items = asSlice(res.Body["items"])
	if len(items) != 2 {
		t.Fatalf("student (participant of both): got %d lessons, want 2", len(items))
	}

	e.children.set(300, 100)
	parent := e.accessToken(300, models.RoleParent, nil)
	res = e.do("GET", "/api/v1/academic/lessons", nil, parent)
	e.mustOK(res, 200)
	items = asSlice(res.Body["items"])
	if len(items) != 2 {
		t.Fatalf("parent: got %d lessons, want 2", len(items))
	}
}

// TestLessons_UpdateDelete_AccessControl — PATCH/DELETE /lessons/{id}: не
// свой тьютор не может трогать чужое занятие (api-contracts.md 2.9).
func TestLessons_UpdateDelete_AccessControl(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	courseID := e.seedCourse("Биология", 1)
	e.seedActiveEnrollment(100, courseID)

	body := map[string]any{
		"course_id": courseID, "tutor_id": 15, "topic": "Клетка",
		"lesson_date": "2026-08-01", "start_time": "10:00", "end_time": "11:00",
	}
	res := e.do("POST", "/api/v1/academic/lessons", body, owner)
	e.mustOK(res, 201)
	lessonID := toPathID(res.Body["id"])

	otherTutor := e.accessToken(99, models.RoleTutor, branchPtr(1))
	res = e.do("PATCH", "/api/v1/academic/lessons/"+lessonID, map[string]any{"topic": "Взлом"}, otherTutor)
	if res.Status != 403 {
		t.Fatalf("other tutor updating lesson: status=%d want=403", res.Status)
	}

	ownTutor := e.accessToken(15, models.RoleTutor, branchPtr(1))
	res = e.do("PATCH", "/api/v1/academic/lessons/"+lessonID, map[string]any{"topic": "Клетка (обновлено)"}, ownTutor)
	e.mustOK(res, 200)
	if res.Body["topic"] != "Клетка (обновлено)" {
		t.Fatalf("topic not updated: %v", res.Body["topic"])
	}

	res = e.do("DELETE", "/api/v1/academic/lessons/"+lessonID, nil, otherTutor)
	if res.Status != 403 {
		t.Fatalf("other tutor deleting lesson: status=%d want=403", res.Status)
	}

	res = e.do("DELETE", "/api/v1/academic/lessons/"+lessonID, nil, ownTutor)
	e.mustOK(res, 200)
}

// TestAttendance_MarkAndGet — POST/GET /lessons/{id}/attendance
// (api-contracts.md 2.10-2.11): тьютор отмечает, участник (student/parent
// ребёнка) может прочитать, посторонний студент — нет.
func TestAttendance_MarkAndGet(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	courseID := e.seedCourse("Информатика", 1)
	e.seedActiveEnrollment(100, courseID)

	body := map[string]any{
		"course_id": courseID, "tutor_id": 15, "topic": "Циклы",
		"lesson_date": "2026-08-01", "start_time": "10:00", "end_time": "11:00",
	}
	res := e.do("POST", "/api/v1/academic/lessons", body, owner)
	e.mustOK(res, 201)
	lessonID := toPathID(res.Body["id"])

	tutor15 := e.accessToken(15, models.RoleTutor, branchPtr(1))
	markRes := e.do("POST", "/api/v1/academic/lessons/"+lessonID+"/attendance", map[string]any{
		"records": []map[string]any{
			{"student_id": 100, "status": "absent", "absence_reason": "болен"},
		},
	}, tutor15)
	e.mustOK(markRes, 200)

	// участник (студент 100) может прочитать
	student100 := e.accessToken(100, models.RoleStudent, branchPtr(1))
	getRes := e.do("GET", "/api/v1/academic/lessons/"+lessonID+"/attendance", nil, student100)
	e.mustOK(getRes, 200)
	items := asSlice(getRes.Body["items"])
	if len(items) != 1 {
		t.Fatalf("attendance items: got %d, want 1", len(items))
	}
	first, _ := items[0].(map[string]any)
	if first["status"] != "absent" {
		t.Fatalf("status=%v want=absent", first["status"])
	}

	// посторонний студент (не участник занятия) не может прочитать
	student200 := e.accessToken(200, models.RoleStudent, branchPtr(1))
	getRes = e.do("GET", "/api/v1/academic/lessons/"+lessonID+"/attendance", nil, student200)
	if getRes.Status != 403 {
		t.Fatalf("non-participant student: status=%d want=403", getRes.Status)
	}

	// родитель студента 100 может прочитать, родитель постороннего — нет
	e.children.set(300, 100)
	parentOf100 := e.accessToken(300, models.RoleParent, nil)
	getRes = e.do("GET", "/api/v1/academic/lessons/"+lessonID+"/attendance", nil, parentOf100)
	e.mustOK(getRes, 200)

	e.children.set(301, 999)
	parentOfSomeoneElse := e.accessToken(301, models.RoleParent, nil)
	getRes = e.do("GET", "/api/v1/academic/lessons/"+lessonID+"/attendance", nil, parentOfSomeoneElse)
	if getRes.Status != 403 {
		t.Fatalf("unrelated parent: status=%d want=403", getRes.Status)
	}
}
