package contracts_test

import (
	"testing"

	"studyroom/academic-service/internal/models"
)

// TestCourseTutors_AssignRemove_OwnerAndBranchOwner — POST/DELETE
// /courses/{id}/tutors: owner (любой филиал), branch_owner (только курс
// и преподаватель своего филиала).
func TestCourseTutors_AssignRemove_OwnerAndBranchOwner(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	branchOwner1 := e.accessToken(2, models.RoleBranchOwner, branchPtr(1))
	branchOwner2 := e.accessToken(3, models.RoleBranchOwner, branchPtr(2))
	e.seedUserRef(15, "Тьютор Филиала 1", models.RoleTutor, branchPtr(1))
	e.seedUserRef(16, "Тьютор Филиала 2", models.RoleTutor, branchPtr(2))

	courseID := e.seedCourse("Курс филиала 1", 1)

	// branch_owner чужого филиала не может назначить преподавателя на курс -> 403
	res := e.do("POST", "/api/v1/academic/courses/"+toPathID(float64(courseID))+"/tutors",
		map[string]any{"tutor_id": 15}, branchOwner2)
	if res.Status != 403 {
		t.Fatalf("branch_owner(2) assign tutor to course of branch 1: status=%d want=403", res.Status)
	}

	// branch_owner своего филиала, но преподаватель из чужого филиала -> 403
	res = e.do("POST", "/api/v1/academic/courses/"+toPathID(float64(courseID))+"/tutors",
		map[string]any{"tutor_id": 16}, branchOwner1)
	if res.Status != 403 {
		t.Fatalf("branch_owner(1) assign tutor from branch 2: status=%d want=403", res.Status)
	}

	// branch_owner своего филиала + преподаватель своего филиала -> 200
	res = e.do("POST", "/api/v1/academic/courses/"+toPathID(float64(courseID))+"/tutors",
		map[string]any{"tutor_id": 15}, branchOwner1)
	e.mustOK(res, 200)
	tutorIDs := asSlice(res.Body["tutor_ids"])
	if len(tutorIDs) != 1 {
		t.Fatalf("tutor_ids=%v want len 1", res.Body["tutor_ids"])
	}

	// GET /courses/{id}/tutors отражает назначение
	res = e.do("GET", "/api/v1/academic/courses/"+toPathID(float64(courseID))+"/tutors", nil, owner)
	e.mustOK(res, 200)
	if ids := asSlice(res.Body["tutor_ids"]); len(ids) != 1 {
		t.Fatalf("GET tutors: got %v, want 1 tutor", res.Body["tutor_ids"])
	}

	// owner может снять преподавателя с курса
	res = e.do("DELETE", "/api/v1/academic/courses/"+toPathID(float64(courseID))+"/tutors/15", nil, owner)
	e.mustOK(res, 200)

	res = e.do("GET", "/api/v1/academic/courses/"+toPathID(float64(courseID))+"/tutors", nil, owner)
	e.mustOK(res, 200)
	if ids := asSlice(res.Body["tutor_ids"]); len(ids) != 0 {
		t.Fatalf("GET tutors after removal: got %v, want 0", res.Body["tutor_ids"])
	}
}

// TestEnrollments_TutorStudents_BySameCourse — ключевой сценарий из ТЗ:
// "ученики преподавателя" = ученики его филиала, записанные на курс,
// который он ведёт. Без ручного назначения enrollments.tutor_id на
// каждого ученика — только через course_tutors.
func TestEnrollments_TutorStudents_BySameCourse(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)

	courseA := e.seedCourse("Алгебра", 1)  // курс филиала 1, ведёт tutor 15
	courseB := e.seedCourse("Физика", 1)   // курс филиала 1, ведёт другой tutor
	courseC := e.seedCourse("Химия", 2)    // курс филиала 2

	mustCreate := func(studentID, courseID int64) {
		res := e.do("POST", "/api/v1/academic/enrollments", map[string]any{"student_id": studentID, "course_id": courseID}, owner)
		e.mustOK(res, 201)
	}
	mustCreate(100, courseA) // ученик на курсе, который ведёт tutor 15
	mustCreate(200, courseB) // ученик того же филиала, но другой курс
	mustCreate(300, courseC) // ученик другого филиала

	e.assignCourseTutor(courseA, 15)

	tutor := e.accessToken(15, models.RoleTutor, branchPtr(1))
	res := e.do("GET", "/api/v1/academic/enrollments", nil, tutor)
	e.mustOK(res, 200)
	items := asSlice(res.Body["items"])
	if len(items) != 1 {
		t.Fatalf("tutor: got %d enrollments, want 1 (только ученик своего курса)", len(items))
	}
	first, _ := items[0].(map[string]any)
	if sid, _ := first["student_id"].(float64); int64(sid) != 100 {
		t.Fatalf("tutor's student_id=%v want=100", first["student_id"])
	}

	// без ручного assign-tutor на энкоймент — доступ на PATCH записи всё
	// равно есть, т.к. tutor ведёт курс этой записи. progress_pct теперь
	// считается автоматически (см. RecalculateProgress) и через PATCH не
	// выставляется, поэтому проверяем доступ на поле status.
	enrollRes := e.do("GET", "/api/v1/academic/enrollments?course_id="+toPathID(float64(courseA)), nil, tutor)
	e.mustOK(enrollRes, 200)
	enrollItems := asSlice(enrollRes.Body["items"])
	if len(enrollItems) != 1 {
		t.Fatalf("expected 1 enrollment for courseA, got %d", len(enrollItems))
	}
	enrollmentID := toPathID(enrollItems[0].(map[string]any)["id"])

	patchRes := e.do("PATCH", "/api/v1/academic/enrollments/"+enrollmentID,
		map[string]any{"status": "paused"}, tutor)
	e.mustOK(patchRes, 200)
	if patchRes.Body["status"] != "paused" {
		t.Fatalf("status=%v want=paused", patchRes.Body["status"])
	}
}

// TestCourses_List_TutorIDFilter — GET /courses?tutor_id= — "мои курсы":
// tutor может фильтровать только по своему id, owner/branch_owner — по
// любому.
func TestCourses_List_TutorIDFilter(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)

	courseA := e.seedCourse("Курс A", 1)
	_ = e.seedCourse("Курс B", 1)
	e.assignCourseTutor(courseA, 15)

	tutor := e.accessToken(15, models.RoleTutor, branchPtr(1))
	res := e.do("GET", "/api/v1/academic/courses?tutor_id=15", nil, tutor)
	e.mustOK(res, 200)
	if items := asSlice(res.Body["items"]); len(items) != 1 {
		t.Fatalf("tutor mine: got %d courses, want 1", len(items))
	}

	// tutor не может подсмотреть чужую нагрузку
	res = e.do("GET", "/api/v1/academic/courses?tutor_id=999", nil, tutor)
	if res.Status != 403 {
		t.Fatalf("tutor filtering by foreign tutor_id: status=%d want=403", res.Status)
	}

	// owner может фильтровать по любому tutor_id
	res = e.do("GET", "/api/v1/academic/courses?branch_id=1&tutor_id=15", nil, owner)
	e.mustOK(res, 200)
	if items := asSlice(res.Body["items"]); len(items) != 1 {
		t.Fatalf("owner filter by tutor_id: got %d courses, want 1", len(items))
	}
}
