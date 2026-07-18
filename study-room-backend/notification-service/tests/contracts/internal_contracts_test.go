package contracts_test

import (
	"testing"
)

// 5.5. Отправить уведомление (internal, service-to-service)
func TestContract_5_5_SendNotification(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "user1@example.com", "Иван", "Иванов")

	res := e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 1, "type": "contract_expiring", "message": "Договор №284-М истекает через 7 дней",
	}, testServiceToken)
	e.mustOK(res, 200)

	if e.mail.count() != 1 {
		t.Fatalf("expected 1 email sent, got %d", e.mail.count())
	}
	last, ok := e.mail.last()
	if !ok || last.To != "user1@example.com" {
		t.Fatalf("expected email to user1@example.com, got %+v", last)
	}
}

// email в теле запроса переопределяет users_ref (временное расширение контракта,
// см. internal/handlers/internal_handler.go).
func TestContract_5_5_SendNotification_EmailOverride(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "user1@example.com", "A", "A")

	res := e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 1, "type": "lesson_reminder", "message": "override test",
		"email": "override@example.com",
	}, testServiceToken)
	e.mustOK(res, 200)

	last, ok := e.mail.last()
	if !ok || last.To != "override@example.com" {
		t.Fatalf("expected override email, got %+v", last)
	}
}

// Без записи в users_ref и без email в теле — уведомление помечается failed,
// SMTP не вызывается.
func TestContract_5_5_SendNotification_NoKnownEmail(t *testing.T) {
	e := getEnv(t)
	// пользователь НЕ засинкан в users_ref
	res := e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 999, "type": "lesson_reminder", "message": "куда слать?",
	}, testServiceToken)
	// notifier возвращает ошибку -> internal handler отвечает 500,
	// но письмо точно не должно уйти.
	if res.Status != 500 {
		t.Fatalf("expected 500 when no known email, got %d", res.Status)
	}
	if e.mail.count() != 0 {
		t.Fatalf("expected no email sent, got %d", e.mail.count())
	}
}

// Ошибка SMTP помечает уведомление failed и не роняет сервис.
func TestContract_5_5_SendNotification_SMTPFailure(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "bounces@example.com", "A", "A")
	e.mail.failFor["bounces@example.com"] = "smtp auth: 535 5.7.8 Error: authentication failed"

	res := e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 1, "type": "lesson_reminder", "message": "должно упасть",
	}, testServiceToken)
	if res.Status != 500 {
		t.Fatalf("expected 500 on smtp failure, got %d", res.Status)
	}

	list := e.do("GET", "/api/v1/notifications?unread_only=false", nil, e.accessToken(1))
	e.mustOK(list, 200)
	items := asSlice(list.Body["items"])
	if len(items) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(items))
	}
	item := items[0].(map[string]any)
	if item["status"] != "failed" {
		t.Fatalf("expected status=failed, got %v", item)
	}
	if item["error"] == nil {
		t.Fatal("expected error message to be recorded")
	}
}

func TestContract_5_5_SendNotification_Validation(t *testing.T) {
	e := getEnv(t)

	missing := e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"type": "lesson_reminder", "message": "нет user_id",
	}, testServiceToken)
	e.mustOK(missing, 400)
	if errCode(missing) != "BAD_REQUEST" {
		t.Fatalf("code=%s", errCode(missing))
	}

	badJSON := e.doInternal("POST", "/api/v1/internal/notifications/send", "не json объект, а строка", testServiceToken)
	e.mustOK(badJSON, 400)
}

// service-to-service эндпоинты защищены отдельным токеном, не пользовательским JWT.
func TestContract_5_5_SendNotification_RequiresServiceToken(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "user1@example.com", "A", "A")

	noToken := e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 1, "type": "lesson_reminder", "message": "x",
	}, "")
	e.mustOK(noToken, 401)
	if errCode(noToken) != "UNAUTHORIZED" {
		t.Fatalf("code=%s", errCode(noToken))
	}

	wrongToken := e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 1, "type": "lesson_reminder", "message": "x",
	}, "totally-wrong-token")
	e.mustOK(wrongToken, 401)

	// пользовательский JWT тоже не должен подойти для internal-эндпоинта
	userTokenAsService := e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 1, "type": "lesson_reminder", "message": "x",
	}, e.accessToken(1))
	e.mustOK(userTokenAsService, 401)

	if e.mail.count() != 0 {
		t.Fatal("no email should be sent without a valid service token")
	}
}

// POST /internal/users/sync — наполняет users_ref, влияет на дальнейшую отправку.
func TestContract_UsersSync(t *testing.T) {
	e := getEnv(t)

	res := e.doInternal("POST", "/api/v1/internal/users/sync", map[string]any{
		"id": 42, "email": "synced@example.com", "first_name": "Пётр", "last_name": "Петров",
	}, testServiceToken)
	e.mustOK(res, 200)

	send := e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 42, "type": "welcome", "message": "добро пожаловать",
	}, testServiceToken)
	e.mustOK(send, 200)

	last, ok := e.mail.last()
	if !ok || last.To != "synced@example.com" {
		t.Fatalf("expected email to synced@example.com, got %+v", last)
	}
}

func TestContract_UsersSync_Validation(t *testing.T) {
	e := getEnv(t)

	noEmail := e.doInternal("POST", "/api/v1/internal/users/sync", map[string]any{
		"id": 1,
	}, testServiceToken)
	e.mustOK(noEmail, 400)
	if errCode(noEmail) != "BAD_REQUEST" {
		t.Fatalf("code=%s", errCode(noEmail))
	}

	noID := e.doInternal("POST", "/api/v1/internal/users/sync", map[string]any{
		"email": "x@example.com",
	}, testServiceToken)
	e.mustOK(noID, 400)
}

func TestContract_UsersSync_RequiresServiceToken(t *testing.T) {
	e := getEnv(t)
	res := e.doInternal("POST", "/api/v1/internal/users/sync", map[string]any{
		"id": 1, "email": "x@example.com",
	}, "")
	e.mustOK(res, 401)
}

// Upsert по одному и тому же id обновляет email, но не затирает имя пустой строкой
// (см. internal/repository/userref_repository.go).
func TestContract_UsersSync_UpsertKeepsNameOnEmptyUpdate(t *testing.T) {
	e := getEnv(t)
	e.mustOK(e.doInternal("POST", "/api/v1/internal/users/sync", map[string]any{
		"id": 7, "email": "first@example.com", "first_name": "Имя", "last_name": "Фамилия",
	}, testServiceToken), 200)

	// повторный sync без имени/фамилии — email обновляется, имя должно остаться прежним
	e.mustOK(e.doInternal("POST", "/api/v1/internal/users/sync", map[string]any{
		"id": 7, "email": "second@example.com",
	}, testServiceToken), 200)

	send := e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 7, "type": "welcome", "message": "test",
	}, testServiceToken)
	e.mustOK(send, 200)

	last, ok := e.mail.last()
	if !ok || last.To != "second@example.com" {
		t.Fatalf("expected updated email second@example.com, got %+v", last)
	}
}
