package contracts_test

import (
	"testing"

	"studyroom/academic-service/internal/models"
)

// TestHomework_Create_TutorOnly — POST /homework, tutor only
// (api-contracts.md 2.12).
func TestHomework_Create_TutorOnly(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	tutor := e.accessToken(15, models.RoleTutor, branchPtr(1))

	res := e.do("POST", "/api/v1/academic/homework", map[string]any{
		"student_id": 100, "link_url": "https://example.com/hw1",
	}, owner)
	if res.Status != 403 {
		t.Fatalf("owner creating homework: status=%d want=403", res.Status)
	}

	res = e.do("POST", "/api/v1/academic/homework", map[string]any{
		"student_id": 100, "link_url": "https://example.com/hw1",
	}, tutor)
	e.mustOK(res, 201)
	if res.Body["status"] != "assigned" {
		t.Fatalf("status=%v want=assigned", res.Body["status"])
	}
	if res.Body["viewed_at"] != nil {
		t.Fatalf("viewed_at=%v want=nil", res.Body["viewed_at"])
	}
}

// TestHomework_List_RoleScoping — GET /homework: tutor только выданное им,
// student только своё, parent только детское (api-contracts.md 2.13).
func TestHomework_List_RoleScoping(t *testing.T) {
	e := getEnv(t)
	tutor15 := e.accessToken(15, models.RoleTutor, branchPtr(1))
	tutor16 := e.accessToken(16, models.RoleTutor, branchPtr(1))

	create := func(tok string, studentID int64) {
		res := e.do("POST", "/api/v1/academic/homework", map[string]any{
			"student_id": studentID, "link_url": "https://example.com/hw",
		}, tok)
		e.mustOK(res, 201)
	}
	create(tutor15, 100)
	create(tutor16, 200)

	res := e.do("GET", "/api/v1/academic/homework", nil, tutor15)
	e.mustOK(res, 200)
	if items := asSlice(res.Body["items"]); len(items) != 1 {
		t.Fatalf("tutor15: got %d homework, want 1", len(items))
	}

	student100 := e.accessToken(100, models.RoleStudent, branchPtr(1))
	res = e.do("GET", "/api/v1/academic/homework", nil, student100)
	e.mustOK(res, 200)
	if items := asSlice(res.Body["items"]); len(items) != 1 {
		t.Fatalf("student100: got %d homework, want 1", len(items))
	}

	e.children.set(300, 100, 200)
	parent := e.accessToken(300, models.RoleParent, nil)
	res = e.do("GET", "/api/v1/academic/homework", nil, parent)
	e.mustOK(res, 200)
	if items := asSlice(res.Body["items"]); len(items) != 2 {
		t.Fatalf("parent of both: got %d homework, want 2", len(items))
	}
}

// TestHomework_Open_StudentOwnOnly — GET /homework/{id}/open: student only,
// только своё задание; первое открытие переводит assigned -> viewed
// (api-contracts.md 2.14).
func TestHomework_Open_StudentOwnOnly(t *testing.T) {
	e := getEnv(t)
	tutor := e.accessToken(15, models.RoleTutor, branchPtr(1))

	res := e.do("POST", "/api/v1/academic/homework", map[string]any{
		"student_id": 100, "link_url": "https://example.com/hw-open",
	}, tutor)
	e.mustOK(res, 201)
	hwID := toPathID(res.Body["id"])

	// чужой студент не может открыть
	otherStudent := e.accessToken(200, models.RoleStudent, branchPtr(1))
	res = e.do("GET", "/api/v1/academic/homework/"+hwID+"/open", nil, otherStudent)
	if res.Status != 403 {
		t.Fatalf("other student opening homework: status=%d want=403", res.Status)
	}

	// tutor тоже не может открыть (роут закрыт RequireRoles(student))
	res = e.do("GET", "/api/v1/academic/homework/"+hwID+"/open", nil, tutor)
	if res.Status != 403 {
		t.Fatalf("tutor opening homework: status=%d want=403", res.Status)
	}

	// свой студент открывает -> редирект на link_url
	student100 := e.accessToken(100, models.RoleStudent, branchPtr(1))
	res = e.do("GET", "/api/v1/academic/homework/"+hwID+"/open", nil, student100)
	if res.Status != 302 {
		t.Fatalf("status=%d want=302", res.Status)
	}
	if res.Location != "https://example.com/hw-open" {
		t.Fatalf("Location=%q want=https://example.com/hw-open", res.Location)
	}

	// после первого открытия статус должен стать viewed
	listRes := e.do("GET", "/api/v1/academic/homework", nil, student100)
	e.mustOK(listRes, 200)
	items := asSlice(listRes.Body["items"])
	if len(items) != 1 {
		t.Fatalf("got %d homework, want 1", len(items))
	}
	first, _ := items[0].(map[string]any)
	if first["status"] != "viewed" {
		t.Fatalf("status=%v want=viewed after opening", first["status"])
	}
	if first["viewed_at"] == nil {
		t.Fatal("viewed_at should be set after opening")
	}
}

// TestHomework_RequiresAuth — без токена всё закрыто.
func TestHomework_RequiresAuth(t *testing.T) {
	e := getEnv(t)
	res := e.do("GET", "/api/v1/academic/homework", nil, "")
	if res.Status != 401 {
		t.Fatalf("status=%d want=401", res.Status)
	}
}
