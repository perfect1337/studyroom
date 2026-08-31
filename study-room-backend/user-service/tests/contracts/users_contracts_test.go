package contracts_test

import (
	"fmt"
	"testing"

	"studyroom/user-service/internal/models"
)

func TestContract_1_6_Me(t *testing.T) {
	e := getEnv(t)
	u := e.seedUser(seedOpts{
		Email: "me@example.com", Role: models.RoleParent,
		FirstName: "Елена", LastName: "Смирнова",
	})
	tok := e.accessToken(u)

	res := e.do("GET", "/api/v1/users/me", nil, tok)
	e.mustOK(res, 200)
	if int64(res.Body["id"].(float64)) != u.ID {
		t.Fatalf("id=%v", res.Body["id"])
	}
	if res.Body["email"] != "me@example.com" || res.Body["role"] != "parent" {
		t.Fatalf("body=%v", res.Body)
	}
	if _, has := res.Body["password_hash"]; has {
		t.Fatal("password_hash must not be serialized")
	}

	unauth := e.do("GET", "/api/v1/users/me", nil, "")
	e.mustOK(unauth, 401)
}

func TestContract_1_7_UpdateMe(t *testing.T) {
	e := getEnv(t)
	u := e.seedUser(seedOpts{Email: "updme@example.com", Role: models.RoleTutor})
	tok := e.accessToken(u)

	res := e.do("PATCH", "/api/v1/users/me", map[string]any{
		"first_name": "Иван", "last_name": "Петров", "patronymic": "Сергеевич",
		"avatar_url": "https://cdn/a.png",
	}, tok)
	e.mustOK(res, 200)
	if res.Body["first_name"] != "Иван" || res.Body["last_name"] != "Петров" {
		t.Fatalf("body=%v", res.Body)
	}
	if res.Body["avatar_url"] != "https://cdn/a.png" {
		t.Fatalf("avatar=%v", res.Body["avatar_url"])
	}
}

// TestContract_1_7_UpdateMe_EmailRequiresPassword — email одновременно
// служит логином, поэтому его смена требует текущий пароль. Без пароля или
// с неверным паролем — 400, с верным — email обновляется и работает для
// входа под новым значением.
func TestContract_1_7_UpdateMe_EmailRequiresPassword(t *testing.T) {
	e := getEnv(t)
	u := e.seedUser(seedOpts{Email: "emailchange@example.com", Password: "oldpass123", Role: models.RoleTutor})
	tok := e.accessToken(u)

	noPassword := e.do("PATCH", "/api/v1/users/me", map[string]any{
		"email": "newmail1@example.com",
	}, tok)
	e.mustOK(noPassword, 400)

	wrongPassword := e.do("PATCH", "/api/v1/users/me", map[string]any{
		"email": "newmail1@example.com", "current_password": "wrong",
	}, tok)
	e.mustOK(wrongPassword, 400)

	ok := e.do("PATCH", "/api/v1/users/me", map[string]any{
		"email": "newmail1@example.com", "current_password": "oldpass123",
	}, tok)
	e.mustOK(ok, 200)
	if ok.Body["email"] != "newmail1@example.com" {
		t.Fatalf("email=%v", ok.Body["email"])
	}

	login := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "newmail1@example.com", "password": "oldpass123",
	}, "")
	e.mustOK(login, 200)

	// Значения, не менявшиеся относительно текущих (в т.ч. просто отправка
	// прежнего email обратно), не должны требовать пароль.
	noop := e.do("PATCH", "/api/v1/users/me", map[string]any{
		"email": "newmail1@example.com", "first_name": "Пётр",
	}, tok)
	e.mustOK(noop, 200)
}

// TestContract_1_7_UpdateMe_StudentCanChangeEmail — ученик тоже может сам
// сменить свой email (раньше это поле было read-only для роли student, т.к.
// оно совпадает с логином; теперь разрешено наравне с остальными ролями,
// с тем же требованием текущего пароля).
func TestContract_1_7_UpdateMe_StudentCanChangeEmail(t *testing.T) {
	e := getEnv(t)
	st := e.seedUser(seedOpts{Email: "ivanov.andrey@studyroom.internal", Password: "studpass123", Role: models.RoleStudent})
	tok := e.accessToken(st)

	forbiddenNoPassword := e.do("PATCH", "/api/v1/users/me", map[string]any{
		"email": "andrey.real@example.com",
	}, tok)
	e.mustOK(forbiddenNoPassword, 400)

	ok := e.do("PATCH", "/api/v1/users/me", map[string]any{
		"email": "andrey.real@example.com", "current_password": "studpass123",
	}, tok)
	e.mustOK(ok, 200)
	if ok.Body["email"] != "andrey.real@example.com" {
		t.Fatalf("email=%v", ok.Body["email"])
	}

	login := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "andrey.real@example.com", "password": "studpass123",
	}, "")
	e.mustOK(login, 200)
}

func TestContract_1_8_ChangePassword(t *testing.T) {
	e := getEnv(t)
	u := e.seedUser(seedOpts{Email: "chpwd@example.com", Password: "oldpass123", Role: models.RoleParent})
	tok := e.accessToken(u)

	bad := e.do("POST", "/api/v1/users/me/change-password", map[string]any{
		"current_password": "wrong", "new_password": "newpass123",
	}, tok)
	e.mustOK(bad, 400)

	ok := e.do("POST", "/api/v1/users/me/change-password", map[string]any{
		"current_password": "oldpass123", "new_password": "newpass123",
	}, tok)
	e.mustOK(ok, 200)

	login := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "chpwd@example.com", "password": "newpass123",
	}, "")
	e.mustOK(login, 200)
}

func TestContract_1_9_DirectoryByRole(t *testing.T) {
	e := getEnv(t)
	b1 := e.seedBranch("Саратов", "Саратов")
	b2 := e.seedBranch("Энгельс", "Энгельс")

	owner := e.seedUser(seedOpts{Email: "owner@test.local", Role: models.RoleOwner, FirstName: "Овнер"})
	bo1 := e.seedUser(seedOpts{Email: "bo1@test.local", Role: models.RoleBranchOwner, BranchID: &b1.ID, FirstName: "БО1"})
	bo2 := e.seedUser(seedOpts{Email: "bo2@test.local", Role: models.RoleBranchOwner, BranchID: &b2.ID, FirstName: "БО2"})
	tutor1 := e.seedUser(seedOpts{Email: "t1@test.local", Role: models.RoleTutor, BranchID: &b1.ID, FirstName: "Тьютор1"})
	tutor2 := e.seedUser(seedOpts{Email: "t2@test.local", Role: models.RoleTutor, BranchID: &b2.ID, FirstName: "Тьютор2"})
	parent := e.seedUser(seedOpts{Email: "p@test.local", Role: models.RoleParent, FirstName: "Родитель"})
	st1 := e.seedUser(seedOpts{Email: "s1@test.local", Role: models.RoleStudent, BranchID: &b1.ID, FirstName: "Ученик1", LastName: "Иванов"})
	st2 := e.seedUser(seedOpts{Email: "s2@test.local", Role: models.RoleStudent, BranchID: &b2.ID, FirstName: "Ученик2"})
	stOther := e.seedUser(seedOpts{Email: "s3@test.local", Role: models.RoleStudent, BranchID: &b1.ID, FirstName: "Чужой"})
	e.linkParentChild(parent.ID, st1.ID)

	assertKeys := func(t *testing.T, body map[string]any) {
		t.Helper()
		for _, k := range []string{"children", "students", "tutors", "branch_owners", "parents"} {
			if _, ok := body[k]; !ok {
				t.Fatalf("missing key %q", k)
			}
		}
	}

	t.Run("owner sees all", func(t *testing.T) {
		e.t = t
		res := e.do("GET", "/api/v1/users", nil, e.accessToken(owner))
		e.mustOK(res, 200)
		assertKeys(t, res.Body)
		if len(asSlice(res.Body["students"])) < 3 {
			t.Fatalf("students=%v", res.Body["students"])
		}
		if len(asSlice(res.Body["tutors"])) < 2 {
			t.Fatalf("tutors=%v", res.Body["tutors"])
		}
		if len(asSlice(res.Body["branch_owners"])) < 2 {
			t.Fatalf("branch_owners=%v", res.Body["branch_owners"])
		}
		if len(asSlice(res.Body["parents"])) < 1 {
			t.Fatalf("parents=%v", res.Body["parents"])
		}
		if len(asSlice(res.Body["children"])) != 0 {
			t.Fatalf("owner children must be empty")
		}
	})

	t.Run("owner filter branch_id", func(t *testing.T) {
		e.t = t
		res := e.do("GET", fmt.Sprintf("/api/v1/users?branch_id=%d", b1.ID), nil, e.accessToken(owner))
		e.mustOK(res, 200)
		for _, item := range asSlice(res.Body["students"]) {
			m := userMap(item)
			if int64(m["branch_id"].(float64)) != b1.ID {
				t.Fatalf("unexpected student branch %v", m["branch_id"])
			}
		}
		_ = bo2
		_ = tutor2
		_ = st2
		_ = stOther
	})

	t.Run("branch_owner scoped", func(t *testing.T) {
		e.t = t
		res := e.do("GET", "/api/v1/users", nil, e.accessToken(bo1))
		e.mustOK(res, 200)
		assertKeys(t, res.Body)
		students := asSlice(res.Body["students"])
		tutors := asSlice(res.Body["tutors"])
		if len(students) < 2 {
			t.Fatalf("branch students=%v", students)
		}
		if len(tutors) != 1 {
			t.Fatalf("branch tutors=%v", tutors)
		}
		if userMap(tutors[0])["id"].(float64) != float64(tutor1.ID) {
			t.Fatalf("expected tutor1")
		}
		if len(asSlice(res.Body["branch_owners"])) != 0 || len(asSlice(res.Body["parents"])) != 0 {
			t.Fatal("branch_owner must not see owners/parents lists")
		}
	})

	t.Run("tutor students of branch", func(t *testing.T) {
		e.t = t
		res := e.do("GET", "/api/v1/users", nil, e.accessToken(tutor1))
		e.mustOK(res, 200)
		if len(asSlice(res.Body["students"])) < 2 {
			t.Fatalf("tutor students=%v", res.Body["students"])
		}
		if len(asSlice(res.Body["tutors"])) != 0 {
			t.Fatal("tutor tutors must be empty")
		}
	})

	t.Run("parent children", func(t *testing.T) {
		e.t = t
		res := e.do("GET", "/api/v1/users", nil, e.accessToken(parent))
		e.mustOK(res, 200)
		children := asSlice(res.Body["children"])
		if len(children) != 1 {
			t.Fatalf("children=%v", children)
		}
		if int64(userMap(children[0])["id"].(float64)) != st1.ID {
			t.Fatalf("expected st1")
		}
		if len(asSlice(res.Body["students"])) != 0 {
			t.Fatal("parent students must be empty")
		}
	})

	t.Run("student empty directory", func(t *testing.T) {
		e.t = t
		res := e.do("GET", "/api/v1/users", nil, e.accessToken(st1))
		e.mustOK(res, 200)
		for _, k := range []string{"children", "students", "tutors", "branch_owners", "parents"} {
			if len(asSlice(res.Body[k])) != 0 {
				t.Fatalf("%s must be empty for student, got %v", k, res.Body[k])
			}
		}
	})
}

func TestContract_1_10_GetByID_Access(t *testing.T) {
	e := getEnv(t)
	b1 := e.seedBranch("A", "A")
	b2 := e.seedBranch("B", "B")
	owner := e.seedUser(seedOpts{Email: "o@t.l", Role: models.RoleOwner})
	bo := e.seedUser(seedOpts{Email: "bo@t.l", Role: models.RoleBranchOwner, BranchID: &b1.ID})
	parent := e.seedUser(seedOpts{Email: "p@t.l", Role: models.RoleParent})
	child := e.seedUser(seedOpts{Email: "c@t.l", Role: models.RoleStudent, BranchID: &b1.ID})
	other := e.seedUser(seedOpts{Email: "x@t.l", Role: models.RoleStudent, BranchID: &b2.ID})
	e.linkParentChild(parent.ID, child.ID)

	// owner — любой
	e.mustOK(e.do("GET", fmt.Sprintf("/api/v1/users/%d", other.ID), nil, e.accessToken(owner)), 200)

	// self
	e.mustOK(e.do("GET", fmt.Sprintf("/api/v1/users/%d", parent.ID), nil, e.accessToken(parent)), 200)

	// branch_owner своего филиала
	e.mustOK(e.do("GET", fmt.Sprintf("/api/v1/users/%d", child.ID), nil, e.accessToken(bo)), 200)

	// branch_owner чужого филиала — 403
	forbidden := e.do("GET", fmt.Sprintf("/api/v1/users/%d", other.ID), nil, e.accessToken(bo))
	e.mustOK(forbidden, 403)

	// parent своего ребёнка
	e.mustOK(e.do("GET", fmt.Sprintf("/api/v1/users/%d", child.ID), nil, e.accessToken(parent)), 200)

	// parent чужого — 403
	e.mustOK(e.do("GET", fmt.Sprintf("/api/v1/users/%d", other.ID), nil, e.accessToken(parent)), 403)

	// 404
	e.mustOK(e.do("GET", "/api/v1/users/999999", nil, e.accessToken(owner)), 404)
}

func TestContract_1_11_CreateTutor_OwnerOnly(t *testing.T) {
	e := getEnv(t)
	b := e.seedBranch("Саратов", "Саратов")
	owner := e.seedUser(seedOpts{Email: "owner11@t.l", Role: models.RoleOwner})
	bo := e.seedUser(seedOpts{Email: "bo11@t.l", Role: models.RoleBranchOwner, BranchID: &b.ID})

	body := map[string]any{
		"email": "petrov@example.com", "phone": "+79002220002",
		"last_name": "Петров", "first_name": "Иван", "patronymic": "Сергеевич",
		"branch_id": b.ID, "specialization": "Математика, ЕГЭ",
	}

	ok := e.do("POST", "/api/v1/users/tutors", body, e.accessToken(owner))
	e.mustOK(ok, 201)
	if userMap(ok.Body["user"])["role"] != "tutor" {
		t.Fatalf("user=%v", ok.Body["user"])
	}
	if _, has := ok.Body["temp_password"]; has {
		t.Fatal("temp_password must not be returned in CreateTutor response")
	}

	forbidden := e.do("POST", "/api/v1/users/tutors", map[string]any{
		"email": "other@example.com", "last_name": "A", "first_name": "B", "branch_id": b.ID,
	}, e.accessToken(bo))
	e.mustOK(forbidden, 403)
}

func TestContract_CreateBranchOwner_OwnerOnly(t *testing.T) {
	e := getEnv(t)
	b := e.seedBranch("Казань", "Казань")
	owner := e.seedUser(seedOpts{Email: "owner11b@t.l", Role: models.RoleOwner})
	otherBranchOwner := e.seedUser(seedOpts{Email: "bo11b@t.l", Role: models.RoleBranchOwner, BranchID: &b.ID})

	body := map[string]any{
		"email": "director@example.com", "phone": "+79002220003",
		"last_name": "Сидорова", "first_name": "Анна", "patronymic": "Игоревна",
		"branch_id": b.ID,
	}

	ok := e.do("POST", "/api/v1/users/branch-owners", body, e.accessToken(owner))
	e.mustOK(ok, 201)
	created := userMap(ok.Body["user"])
	if created["role"] != "branch_owner" {
		t.Fatalf("user=%v", ok.Body["user"])
	}
	if _, has := ok.Body["temp_password"]; has {
		t.Fatal("temp_password must not be returned in CreateBranchOwner response")
	}

	// branch_owner (даже из другого филиала) не может создавать владельцев филиалов.
	forbidden := e.do("POST", "/api/v1/users/branch-owners", map[string]any{
		"email": "other@example.com", "last_name": "A", "first_name": "B", "branch_id": b.ID,
	}, e.accessToken(otherBranchOwner))
	e.mustOK(forbidden, 403)

	// branch_id, которого не существует, — валидационная ошибка.
	badBranch := e.do("POST", "/api/v1/users/branch-owners", map[string]any{
		"email": "noone@example.com", "last_name": "A", "first_name": "B", "branch_id": 999999,
	}, e.accessToken(owner))
	e.mustOK(badBranch, 400)
}

func TestContract_1_12_CreateStudent(t *testing.T) {
	e := getEnv(t)
	b := e.seedBranch("Саратов", "Саратов")
	owner := e.seedUser(seedOpts{Email: "owner12@t.l", Role: models.RoleOwner})
	parent := e.seedUser(seedOpts{Email: "parent12@t.l", Role: models.RoleParent})
	bo := e.seedUser(seedOpts{Email: "bo12@t.l", Role: models.RoleBranchOwner, BranchID: &b.ID})
	otherParent := e.seedUser(seedOpts{Email: "otherp@t.l", Role: models.RoleParent})

	// owner создаёт
	byOwner := e.do("POST", "/api/v1/users/students", map[string]any{
		"last_name": "Смирнов", "first_name": "Алексей", "patronymic": "Ильич",
		"class_info": "4 Класс", "school": "Школа №1502",
		"branch_id": b.ID, "parent_id": parent.ID,
	}, e.accessToken(owner))
	e.mustOK(byOwner, 201)
	if byOwner.Body["role"] != "student" {
		t.Fatalf("role=%v", byOwner.Body["role"])
	}

	// parent себе
	byParent := e.do("POST", "/api/v1/users/students", map[string]any{
		"last_name": "Смирнов", "first_name": "Мария",
		"branch_id": b.ID, "parent_id": parent.ID,
	}, e.accessToken(parent))
	e.mustOK(byParent, 201)

	// parent чужому parent_id — 403
	e.mustOK(e.do("POST", "/api/v1/users/students", map[string]any{
		"last_name": "X", "first_name": "Y", "parent_id": otherParent.ID,
	}, e.accessToken(parent)), 403)

	// branch_owner не может
	e.mustOK(e.do("POST", "/api/v1/users/students", map[string]any{
		"last_name": "X", "first_name": "Y", "parent_id": parent.ID, "branch_id": b.ID,
	}, e.accessToken(bo)), 403)
}

func TestContract_1_13_UpdateUser(t *testing.T) {
	e := getEnv(t)
	b1 := e.seedBranch("A", "A")
	b2 := e.seedBranch("B", "B")
	owner := e.seedUser(seedOpts{Email: "o13@t.l", Role: models.RoleOwner})
	bo := e.seedUser(seedOpts{Email: "bo13@t.l", Role: models.RoleBranchOwner, BranchID: &b1.ID})
	tutorSame := e.seedUser(seedOpts{Email: "ts@t.l", Role: models.RoleTutor, BranchID: &b1.ID, FirstName: "Old"})
	tutorOther := e.seedUser(seedOpts{Email: "to@t.l", Role: models.RoleTutor, BranchID: &b2.ID})

	ok := e.do("PATCH", fmt.Sprintf("/api/v1/users/%d", tutorSame.ID), map[string]any{
		"first_name": "NewName",
	}, e.accessToken(owner))
	e.mustOK(ok, 200)
	if ok.Body["first_name"] != "NewName" {
		t.Fatalf("body=%v", ok.Body)
	}

	e.mustOK(e.do("PATCH", fmt.Sprintf("/api/v1/users/%d", tutorSame.ID), map[string]any{
		"first_name": "FromBO",
	}, e.accessToken(bo)), 200)

	e.mustOK(e.do("PATCH", fmt.Sprintf("/api/v1/users/%d", tutorOther.ID), map[string]any{
		"first_name": "Nope",
	}, e.accessToken(bo)), 403)
}

// TestContract_1_14_SetStatus_BranchScoped — раньше этот тест назывался
// "...OwnerOnly" и (ошибочно) ожидал 403, когда branch_owner восстанавливает
// ("Восстановить в штат", is_active=true) преподавателя СВОЕГО ЖЕ филиала —
// то есть ровно тот сценарий, который согласно комментариям в
// UserHandler.SetStatus (и app.go, группа роутов /users/{id}/status) должен
// быть РАЗРЕШЁН. Старая версия теста не соответствовала фактическому и
// задуманному поведению кода и была битым/устаревшим тестом. Здесь она
// заменена на набор проверок, которые реально соответствуют контракту:
//   - owner может уволить/восстановить кого угодно;
//   - branch_owner может уволить/восстановить преподавателя СВОЕГО филиала
//     (в т.ч. полный цикл "уволить → восстановить");
//   - branch_owner НЕ может тронуть статус преподавателя ЧУЖОГО филиала.
func TestContract_1_14_SetStatus_BranchScoped(t *testing.T) {
	e := getEnv(t)
	b1 := e.seedBranch("A", "A")
	b2 := e.seedBranch("B", "B")
	owner := e.seedUser(seedOpts{Email: "o14@t.l", Role: models.RoleOwner})
	bo := e.seedUser(seedOpts{Email: "bo14@t.l", Role: models.RoleBranchOwner, BranchID: &b1.ID})
	target := e.seedUser(seedOpts{Email: "tgt14@t.l", Role: models.RoleTutor, BranchID: &b1.ID})
	foreignTutor := e.seedUser(seedOpts{Email: "ftgt14@t.l", Role: models.RoleTutor, BranchID: &b2.ID})

	// owner увольняет.
	e.mustOK(e.do("PATCH", fmt.Sprintf("/api/v1/users/%d/status", target.ID), map[string]any{
		"is_active": false,
	}, e.accessToken(owner)), 200)

	// branch_owner СВОЕГО филиала успешно восстанавливает.
	e.mustOK(e.do("PATCH", fmt.Sprintf("/api/v1/users/%d/status", target.ID), map[string]any{
		"is_active": true,
	}, e.accessToken(bo)), 200)

	// branch_owner ЧУЖОГО филиала не может тронуть статус чужого тьютора —
	// ни уволить, ни восстановить.
	e.mustOK(e.do("PATCH", fmt.Sprintf("/api/v1/users/%d/status", foreignTutor.ID), map[string]any{
		"is_active": false,
	}, e.accessToken(bo)), 403)
}

func TestContract_1_15_TutorStatus(t *testing.T) {
	e := getEnv(t)
	b1 := e.seedBranch("A", "A")
	b2 := e.seedBranch("B", "B")
	owner := e.seedUser(seedOpts{Email: "o15@t.l", Role: models.RoleOwner})
	bo := e.seedUser(seedOpts{Email: "bo15@t.l", Role: models.RoleBranchOwner, BranchID: &b1.ID})
	tutorSame := e.seedUser(seedOpts{Email: "ts15@t.l", Role: models.RoleTutor, BranchID: &b1.ID})
	tutorOther := e.seedUser(seedOpts{Email: "to15@t.l", Role: models.RoleTutor, BranchID: &b2.ID})

	e.mustOK(e.do("PATCH", fmt.Sprintf("/api/v1/tutors/%d/status", tutorSame.ID), map[string]any{
		"status": "vacation",
	}, e.accessToken(bo)), 200)

	// branch_owner не может inactive
	e.mustOK(e.do("PATCH", fmt.Sprintf("/api/v1/tutors/%d/status", tutorSame.ID), map[string]any{
		"status": "inactive",
	}, e.accessToken(bo)), 403)

	// owner может inactive
	e.mustOK(e.do("PATCH", fmt.Sprintf("/api/v1/tutors/%d/status", tutorSame.ID), map[string]any{
		"status": "inactive",
	}, e.accessToken(owner)), 200)

	// branch_owner чужого филиала
	e.mustOK(e.do("PATCH", fmt.Sprintf("/api/v1/tutors/%d/status", tutorOther.ID), map[string]any{
		"status": "active",
	}, e.accessToken(bo)), 403)
}

func TestContract_1_16_ListBranches(t *testing.T) {
	e := getEnv(t)
	b1 := e.seedBranch("Саратов", "Саратов")
	_ = e.seedBranch("Энгельс", "Энгельс")
	owner := e.seedUser(seedOpts{Email: "o16@t.l", Role: models.RoleOwner})
	bo := e.seedUser(seedOpts{Email: "bo16@t.l", Role: models.RoleBranchOwner, BranchID: &b1.ID})

	all := e.do("GET", "/api/v1/branches", nil, e.accessToken(owner))
	e.mustOK(all, 200)
	if len(asSlice(all.Body["items"])) != 2 {
		t.Fatalf("owner items=%v", all.Body["items"])
	}

	// branch_owner — 403: свой филиал уже в JWT / me
	e.mustOK(e.do("GET", "/api/v1/branches", nil, e.accessToken(bo)), 403)
}

func TestContract_1_17_CreateBranch_OwnerOnly(t *testing.T) {
	e := getEnv(t)
	b := e.seedBranch("X", "X")
	owner := e.seedUser(seedOpts{Email: "o17@t.l", Role: models.RoleOwner})
	bo := e.seedUser(seedOpts{Email: "bo17@t.l", Role: models.RoleBranchOwner, BranchID: &b.ID})

	ok := e.do("POST", "/api/v1/branches", map[string]any{
		"name": "Энгельс", "city": "Энгельс", "address": "ул. 1", "phone": "+7",
	}, e.accessToken(owner))
	e.mustOK(ok, 201)
	if ok.Body["name"] != "Энгельс" {
		t.Fatalf("body=%v", ok.Body)
	}

	e.mustOK(e.do("POST", "/api/v1/branches", map[string]any{
		"name": "Nope", "city": "Nope",
	}, e.accessToken(bo)), 403)
}

func TestContract_1_18_ListChildren(t *testing.T) {
	e := getEnv(t)
	parent := e.seedUser(seedOpts{Email: "p18@t.l", Role: models.RoleParent})
	other := e.seedUser(seedOpts{Email: "op18@t.l", Role: models.RoleParent})
	owner := e.seedUser(seedOpts{Email: "o18@t.l", Role: models.RoleOwner})
	child := e.seedUser(seedOpts{Email: "c18@t.l", Role: models.RoleStudent, FirstName: "Алексей", LastName: "Смирнов"})
	e.linkParentChild(parent.ID, child.ID)

	ok := e.do("GET", fmt.Sprintf("/api/v1/parents/%d/children", parent.ID), nil, e.accessToken(parent))
	e.mustOK(ok, 200)
	items := asSlice(ok.Body["items"])
	if len(items) != 1 || int64(userMap(items[0])["id"].(float64)) != child.ID {
		t.Fatalf("items=%v", items)
	}
	if userMap(items[0])["first_name"] != "Алексей" {
		t.Fatalf("expected slim child DTO, got %v", items[0])
	}
	if _, hasEmail := userMap(items[0])["email"]; hasEmail {
		t.Fatal("children must not expose full user email")
	}

	// чужой parentId для parent — 403
	e.mustOK(e.do("GET", fmt.Sprintf("/api/v1/parents/%d/children", parent.ID), nil, e.accessToken(other)), 403)

	// owner может смотреть
	e.mustOK(e.do("GET", fmt.Sprintf("/api/v1/parents/%d/children", parent.ID), nil, e.accessToken(owner)), 200)

	// tutor/student — 403
	tutor := e.seedUser(seedOpts{Email: "t18@t.l", Role: models.RoleTutor})
	e.mustOK(e.do("GET", fmt.Sprintf("/api/v1/parents/%d/children", parent.ID), nil, e.accessToken(tutor)), 403)
}

func TestContract_AuthRequiredOnProtectedRoutes(t *testing.T) {
	e := getEnv(t)
	paths := []struct {
		method, path string
	}{
		{"GET", "/api/v1/users"},
		{"GET", "/api/v1/branches"},
		{"POST", "/api/v1/users/tutors"},
		{"POST", "/api/v1/branches"},
	}
	for _, p := range paths {
		res := e.do(p.method, p.path, map[string]any{}, "")
		if res.Status != 401 {
			t.Fatalf("%s %s => %d want 401", p.method, p.path, res.Status)
		}
	}
}

func TestContract_1_16_Branches_ForbiddenForParent(t *testing.T) {
	e := getEnv(t)
	_ = e.seedBranch("A", "A")
	parent := e.seedUser(seedOpts{Email: "p16f@t.l", Role: models.RoleParent})
	e.mustOK(e.do("GET", "/api/v1/branches", nil, e.accessToken(parent)), 403)
}
