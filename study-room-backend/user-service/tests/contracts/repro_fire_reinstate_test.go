package contracts_test

import (
	"testing"

	"studyroom/user-service/internal/models"
)

// Репродукция бага: увольняем учителя, потом восстанавливаем ("вернуть в
// штат"), затем пробуем залогиниться тем же логином/паролем.
func TestRepro_FireThenReinstateThenLogin(t *testing.T) {
	e := getEnv(t)
	b := e.seedBranch("A", "A")
	owner := e.seedUser(seedOpts{Email: "owner_repro@t.l", Role: models.RoleOwner})
	tutor := e.seedUser(seedOpts{
		Email: "tutor_repro@t.l", Role: models.RoleTutor, BranchID: &b.ID,
		Password: "password123",
	})

	// 1. Логин работает изначально.
	login1 := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "tutor_repro@t.l", "password": "password123",
	}, "")
	e.mustOK(login1, 200)
	t.Logf("initial login: status=%d body=%v", login1.Status, login1.Body)

	// 2. Увольняем.
	fire := e.do("PATCH", "/api/v1/users/"+itoa(tutor.ID)+"/status", map[string]any{
		"is_active": false,
	}, e.accessToken(owner))
	e.mustOK(fire, 200)

	// 3. Логин должен быть запрещён.
	login2 := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "tutor_repro@t.l", "password": "password123",
	}, "")
	t.Logf("login after fire: status=%d body=%v", login2.Status, login2.Body)
	if login2.Status != 403 {
		t.Fatalf("expected 403 after fire, got %d body=%v", login2.Status, login2.Body)
	}

	// 4. Восстанавливаем ("Восстановить в штат").
	restore := e.do("PATCH", "/api/v1/users/"+itoa(tutor.ID)+"/status", map[string]any{
		"is_active": true,
	}, e.accessToken(owner))
	t.Logf("restore call: status=%d body=%v", restore.Status, restore.Body)
	e.mustOK(restore, 200)

	// 5. Логин снова тем же логином/паролем — должен успешно пройти.
	login3 := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "tutor_repro@t.l", "password": "password123",
	}, "")
	t.Logf("login after restore: status=%d body=%v", login3.Status, login3.Body)
	if login3.Status != 200 {
		t.Fatalf("BUG REPRODUCED: expected 200 after restore, got %d body=%v", login3.Status, login3.Body)
	}
}

// То же самое, но и увольнение, и восстановление делает branch_owner
// своего собственного филиала (частый реальный сценарий).
func TestRepro_BranchOwnerFireThenReinstateThenLogin(t *testing.T) {
	e := getEnv(t)
	b := e.seedBranch("B", "B")
	bo := e.seedUser(seedOpts{Email: "bo_repro@t.l", Role: models.RoleBranchOwner, BranchID: &b.ID})
	tutor := e.seedUser(seedOpts{
		Email: "tutor_repro2@t.l", Role: models.RoleTutor, BranchID: &b.ID,
		Password: "password123",
	})

	fire := e.do("PATCH", "/api/v1/users/"+itoa(tutor.ID)+"/status", map[string]any{
		"is_active": false,
	}, e.accessToken(bo))
	t.Logf("fire (by branch_owner): status=%d body=%v", fire.Status, fire.Body)
	e.mustOK(fire, 200)

	login2 := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "tutor_repro2@t.l", "password": "password123",
	}, "")
	if login2.Status != 403 {
		t.Fatalf("expected 403 after fire, got %d body=%v", login2.Status, login2.Body)
	}

	restore := e.do("PATCH", "/api/v1/users/"+itoa(tutor.ID)+"/status", map[string]any{
		"is_active": true,
	}, e.accessToken(bo))
	t.Logf("restore (by branch_owner): status=%d body=%v", restore.Status, restore.Body)
	if restore.Status != 200 {
		t.Fatalf("BUG: branch_owner could not reinstate own tutor, status=%d body=%v", restore.Status, restore.Body)
	}

	login3 := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "tutor_repro2@t.l", "password": "password123",
	}, "")
	t.Logf("login after restore: status=%d body=%v", login3.Status, login3.Body)
	if login3.Status != 200 {
		t.Fatalf("BUG REPRODUCED: expected 200 after restore, got %d body=%v", login3.Status, login3.Body)
	}
}

func itoa(id int64) string {
	if id == 0 {
		return "0"
	}
	neg := id < 0
	if neg {
		id = -id
	}
	buf := [20]byte{}
	i := len(buf)
	for id > 0 {
		i--
		buf[i] = byte('0' + id%10)
		id /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
