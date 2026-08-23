package contracts_test

import (
	"context"
	"testing"

	"studyroom/user-service/internal/models"
)

func TestContract_1_1_RegisterParent(t *testing.T) {
	e := getEnv(t)
	phone := "+79001110001"
	res := e.do("POST", "/api/v1/auth/register", map[string]any{
		"email": "elena@example.com", "phone": phone, "password": "min8chars",
		"last_name": "Смирнова", "first_name": "Елена", "patronymic": "Владимировна",
	}, "")
	e.mustOK(res, 200)

	if res.Body["access_token"] == nil || res.Body["access_token"] == "" {
		t.Fatal("expected access_token")
	}
	if res.Body["refresh_token"] != nil {
		t.Fatal("refresh_token must NOT be present in JSON body (it belongs in an httpOnly cookie)")
	}
	rc := res.findCookie("sr_refresh_token")
	if rc == nil || rc.Value == "" {
		t.Fatal("expected sr_refresh_token httpOnly cookie")
	}
	if !rc.HttpOnly {
		t.Fatal("refresh cookie must be HttpOnly")
	}
	if res.Body["user_id"] == nil {
		t.Fatal("expected user_id per contract 1.1")
	}
	// регистрация всегда parent — проверяем через login / me
	login := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "elena@example.com", "password": "min8chars",
	}, "")
	e.mustOK(login, 200)
	if userMap(login.Body["user"])["role"] != string(models.RoleParent) {
		t.Fatalf("register must create parent, got %v", login.Body["user"])
	}

	// повторная регистрация — conflict
	dup := e.do("POST", "/api/v1/auth/register", map[string]any{
		"email": "elena@example.com", "password": "min8chars",
		"last_name": "X", "first_name": "Y",
	}, "")
	e.mustOK(dup, 409)
	if errCode(dup) != "ALREADY_EXISTS" {
		t.Fatalf("code=%s", errCode(dup))
	}
}

func TestContract_1_1_RegisterValidation(t *testing.T) {
	e := getEnv(t)
	res := e.do("POST", "/api/v1/auth/register", map[string]any{
		"email": "bad@example.com", "password": "short",
		"last_name": "A", "first_name": "B",
	}, "")
	e.mustOK(res, 400)
	if errCode(res) != "VALIDATION_ERROR" {
		t.Fatalf("code=%s", errCode(res))
	}
}

func TestContract_1_2_Login(t *testing.T) {
	e := getEnv(t)
	u := e.seedUser(seedOpts{
		Email: "login@example.com", Password: "min8chars",
		Role: models.RoleParent, FirstName: "Елена", LastName: "Смирнова",
	})

	res := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "login@example.com", "password": "min8chars",
	}, "")
	e.mustOK(res, 200)
	if res.Body["access_token"] == "" {
		t.Fatal("expected access_token")
	}
	if res.Body["refresh_token"] != nil {
		t.Fatal("refresh_token must NOT be present in JSON body")
	}
	if rc := res.findCookie("sr_refresh_token"); rc == nil || rc.Value == "" || !rc.HttpOnly {
		t.Fatal("expected httpOnly sr_refresh_token cookie")
	}
	got := userMap(res.Body["user"])
	if int64(got["id"].(float64)) != u.ID {
		t.Fatalf("user.id=%v want=%d", got["id"], u.ID)
	}
	if got["role"] != "parent" || got["first_name"] != "Елена" || got["last_name"] != "Смирнова" {
		t.Fatalf("user payload=%v", got)
	}

	bad := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "login@example.com", "password": "wrongpass1",
	}, "")
	e.mustOK(bad, 401)
	if errCode(bad) != "INVALID_CREDENTIALS" {
		t.Fatalf("code=%s", errCode(bad))
	}
}

func TestContract_1_2_LoginDisabledAccount(t *testing.T) {
	e := getEnv(t)
	u := e.seedUser(seedOpts{Email: "disabled@example.com", Password: "min8chars", Role: models.RoleParent})
	_, err := e.deps.Users.Update(context.Background(), u.ID, map[string]any{"is_active": false})
	if err != nil {
		t.Fatal(err)
	}
	res := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "disabled@example.com", "password": "min8chars",
	}, "")
	e.mustOK(res, 403)
	if errCode(res) != "ACCOUNT_DISABLED" {
		t.Fatalf("code=%s", errCode(res))
	}
}

func TestContract_1_3_Refresh(t *testing.T) {
	e := getEnv(t)
	e.seedUser(seedOpts{Email: "refresh@example.com", Password: "min8chars", Role: models.RoleParent})
	login := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "refresh@example.com", "password": "min8chars",
	}, "")
	e.mustOK(login, 200)
	oldCookie := login.findCookie("sr_refresh_token")
	if oldCookie == nil {
		t.Fatal("expected refresh cookie from login")
	}

	res := e.doCookie("POST", "/api/v1/auth/refresh", nil, "", oldCookie)
	e.mustOK(res, 200)
	if res.Body["access_token"] == "" {
		t.Fatal("expected new access_token")
	}
	newCookie := res.findCookie("sr_refresh_token")
	if newCookie == nil || newCookie.Value == "" {
		t.Fatal("expected rotated refresh cookie")
	}
	if newCookie.Value == oldCookie.Value {
		t.Fatal("refresh token must rotate")
	}

	// старый refresh больше не работает
	reuse := e.doCookie("POST", "/api/v1/auth/refresh", nil, "", oldCookie)
	e.mustOK(reuse, 401)
	if errCode(reuse) != "INVALID_TOKEN" {
		t.Fatalf("code=%s", errCode(reuse))
	}

	// без cookie вообще — тоже 401, а не паника/500
	noCookie := e.do("POST", "/api/v1/auth/refresh", nil, "")
	e.mustOK(noCookie, 401)
	if errCode(noCookie) != "INVALID_TOKEN" {
		t.Fatalf("code=%s", errCode(noCookie))
	}
}

func TestContract_Logout(t *testing.T) {
	e := getEnv(t)
	e.seedUser(seedOpts{Email: "logout@example.com", Password: "min8chars", Role: models.RoleParent})
	login := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "logout@example.com", "password": "min8chars",
	}, "")
	e.mustOK(login, 200)
	cookie := login.findCookie("sr_refresh_token")
	if cookie == nil {
		t.Fatal("expected refresh cookie from login")
	}

	out := e.doCookie("POST", "/api/v1/auth/logout", nil, "", cookie)
	e.mustOK(out, 200)
	cleared := out.findCookie("sr_refresh_token")
	if cleared == nil || cleared.MaxAge >= 0 {
		t.Fatal("expected logout to clear the refresh cookie (MaxAge < 0)")
	}

	// отозванный токен больше не работает для refresh
	after := e.doCookie("POST", "/api/v1/auth/refresh", nil, "", cookie)
	e.mustOK(after, 401)
	if errCode(after) != "INVALID_TOKEN" {
		t.Fatalf("code=%s", errCode(after))
	}

	// logout без cookie вообще — идемпотентно, не 500
	again := e.do("POST", "/api/v1/auth/logout", nil, "")
	e.mustOK(again, 200)
}

func TestContract_1_4_ForgotPassword(t *testing.T) {
	e := getEnv(t)
	e.seedUser(seedOpts{Email: "resetme@example.com", Role: models.RoleParent})

	// существующий email — 200
	ok := e.do("POST", "/api/v1/auth/forgot-password", map[string]any{
		"email": "resetme@example.com",
	}, "")
	e.mustOK(ok, 200)

	// несуществующий — тоже 200 (не палим наличие)
	missing := e.do("POST", "/api/v1/auth/forgot-password", map[string]any{
		"email": "nobody@example.com",
	}, "")
	e.mustOK(missing, 200)
}

func TestContract_1_5_ResetPassword(t *testing.T) {
	e := getEnv(t)
	u := e.seedUser(seedOpts{Email: "pwd@example.com", Password: "oldpassword", Role: models.RoleParent})
	token := e.saveResetToken(u.ID) // токен кладём в БД напрямую (как после forgot)

	res := e.do("POST", "/api/v1/auth/reset-password", map[string]any{
		"reset_token": token, "new_password": "newpassword1",
	}, "")
	e.mustOK(res, 200)

	// логин со старым паролем не проходит
	oldLogin := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "pwd@example.com", "password": "oldpassword",
	}, "")
	e.mustOK(oldLogin, 401)

	// с новым — ок
	newLogin := e.do("POST", "/api/v1/auth/login", map[string]any{
		"login": "pwd@example.com", "password": "newpassword1",
	}, "")
	e.mustOK(newLogin, 200)

	// токен одноразовый
	again := e.do("POST", "/api/v1/auth/reset-password", map[string]any{
		"reset_token": token, "new_password": "anotherpass1",
	}, "")
	e.mustOK(again, 400)
	if errCode(again) != "INVALID_TOKEN" {
		t.Fatalf("code=%s", errCode(again))
	}
}
