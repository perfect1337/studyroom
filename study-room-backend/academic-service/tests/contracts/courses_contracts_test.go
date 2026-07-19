package contracts_test

import (
	"testing"

	"studyroom/academic-service/internal/models"
)

func branchPtr(v int64) *int64 { return &v }

// TestCourses_Create_OwnerOnly — POST /courses доступен только owner
// (api-contracts.md 2.2).
func TestCourses_Create_OwnerOnly(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	branchOwner := e.accessToken(2, models.RoleBranchOwner, branchPtr(1))

	res := e.do("POST", "/api/v1/academic/courses", map[string]any{
		"title": "Математика - ЕГЭ", "subject": "Математика", "format": "individual", "branch_id": 1,
	}, owner)
	e.mustOK(res, 201)
	if res.Body["title"] != "Математика - ЕГЭ" {
		t.Fatalf("unexpected title in response: %v", res.Body["title"])
	}

	res = e.do("POST", "/api/v1/academic/courses", map[string]any{
		"title": "Английский", "subject": "Английский", "format": "group", "branch_id": 1,
	}, branchOwner)
	if res.Status != 403 {
		t.Fatalf("branch_owner create course: status=%d want=403", res.Status)
	}
	if code := errCode(res); code != "FORBIDDEN" {
		t.Fatalf("error code=%q want=FORBIDDEN", code)
	}
}

// TestCourses_Create_MissingFields — обязательные поля должны валидироваться.
func TestCourses_Create_MissingFields(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)

	res := e.do("POST", "/api/v1/academic/courses", map[string]any{"title": "Без предмета"}, owner)
	if res.Status != 400 {
		t.Fatalf("status=%d want=400", res.Status)
	}
}

// TestCourses_List_BranchScoping — owner видит все филиалы без фильтра;
// не-owner обязан получить только свой филиал, даже если он не указал
// ?branch_id= сам (сервер подставляет его принудительно) — api-contracts.md 2.1.
func TestCourses_List_BranchScoping(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)

	create := func(title string, branchID int64) {
		res := e.do("POST", "/api/v1/academic/courses", map[string]any{
			"title": title, "subject": "Математика", "format": "individual", "branch_id": branchID,
		}, owner)
		e.mustOK(res, 201)
	}
	create("Курс филиала 1", 1)
	create("Курс филиала 2", 2)

	// owner без фильтра видит оба филиала
	res := e.do("GET", "/api/v1/academic/courses", nil, owner)
	e.mustOK(res, 200)
	if items := asSlice(res.Body["items"]); len(items) != 2 {
		t.Fatalf("owner without filter: got %d courses, want 2", len(items))
	}

	// tutor из филиала 1 видит только курсы филиала 1, даже не спрашивая branch_id
	tutor := e.accessToken(10, models.RoleTutor, branchPtr(1))
	res = e.do("GET", "/api/v1/academic/courses", nil, tutor)
	e.mustOK(res, 200)
	items := asSlice(res.Body["items"])
	if len(items) != 1 {
		t.Fatalf("tutor branch=1: got %d courses, want 1", len(items))
	}
	first, _ := items[0].(map[string]any)
	if first["title"] != "Курс филиала 1" {
		t.Fatalf("tutor got course from a different branch: %v", first["title"])
	}
}

// TestCourses_UpdateDelete_OwnerOnly — PATCH/DELETE /courses/{id}: owner-only,
// branch_owner не может редактировать курсы (api-contracts.md 2.3).
func TestCourses_UpdateDelete_OwnerOnly(t *testing.T) {
	e := getEnv(t)
	owner := e.accessToken(1, models.RoleOwner, nil)
	branchOwner := e.accessToken(2, models.RoleBranchOwner, branchPtr(1))

	res := e.do("POST", "/api/v1/academic/courses", map[string]any{
		"title": "Физика", "subject": "Физика", "format": "individual", "branch_id": 1,
	}, owner)
	e.mustOK(res, 201)
	id := res.Body["id"]

	patchPath := "/api/v1/academic/courses/" + toPathID(id)

	res = e.do("PATCH", patchPath, map[string]any{"title": "Физика (обновлено)"}, branchOwner)
	if res.Status != 403 {
		t.Fatalf("branch_owner patch course: status=%d want=403", res.Status)
	}

	res = e.do("PATCH", patchPath, map[string]any{"title": "Физика (обновлено)"}, owner)
	e.mustOK(res, 200)
	if res.Body["title"] != "Физика (обновлено)" {
		t.Fatalf("title not updated: %v", res.Body["title"])
	}

	res = e.do("DELETE", patchPath, nil, branchOwner)
	if res.Status != 403 {
		t.Fatalf("branch_owner delete course: status=%d want=403", res.Status)
	}

	res = e.do("DELETE", patchPath, nil, owner)
	e.mustOK(res, 200)

	res = e.do("DELETE", patchPath, nil, owner)
	if res.Status != 404 {
		t.Fatalf("delete already-deleted course: status=%d want=404", res.Status)
	}
}

// TestCourses_RequiresAuth — без токена все методы должны быть 401.
func TestCourses_RequiresAuth(t *testing.T) {
	e := getEnv(t)
	res := e.do("GET", "/api/v1/academic/courses", nil, "")
	if res.Status != 401 {
		t.Fatalf("status=%d want=401", res.Status)
	}
}
