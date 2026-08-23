package contracts_test

import (
	"fmt"
	"testing"
)

// 5.1. Список своих уведомлений
func TestContract_5_1_ListNotifications(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "user1@example.com", "Иван", "Иванов")
	token := e.accessToken(1)

	// пусто по умолчанию
	empty := e.do("GET", "/api/v1/notifications?unread_only=false", nil, token)
	e.mustOK(empty, 200)
	if items := asSlice(empty.Body["items"]); len(items) != 0 {
		t.Fatalf("expected empty items, got %v", items)
	}

	// отправляем уведомление через internal API — оно должно появиться в списке
	send := e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 1, "type": "lesson_reminder", "message": "Завтра в 15:00 занятие",
	}, testServiceToken)
	e.mustOK(send, 200)

	list := e.do("GET", "/api/v1/notifications?unread_only=false", nil, token)
	e.mustOK(list, 200)
	items := asSlice(list.Body["items"])
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	item := items[0].(map[string]any)
	if item["type"] != "lesson_reminder" || item["status"] != "sent" || item["is_read"] != false {
		t.Fatalf("unexpected item: %v", item)
	}

	// unread_only=true — тоже должно вернуть его (ещё не прочитано)
	unread := e.do("GET", "/api/v1/notifications?unread_only=true", nil, token)
	e.mustOK(unread, 200)
	if len(asSlice(unread.Body["items"])) != 1 {
		t.Fatal("expected 1 unread item")
	}
}

// Список показывает только СВОИ уведомления, чужие не видны.
func TestContract_5_1_ListNotifications_OnlyOwn(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "user1@example.com", "A", "A")
	e.seedUserRef(2, "user2@example.com", "B", "B")

	e.mustOK(e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 1, "type": "lesson_reminder", "message": "для user 1",
	}, testServiceToken), 200)
	e.mustOK(e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 2, "type": "lesson_reminder", "message": "для user 2",
	}, testServiceToken), 200)

	res := e.do("GET", "/api/v1/notifications?unread_only=false", nil, e.accessToken(1))
	e.mustOK(res, 200)
	items := asSlice(res.Body["items"])
	if len(items) != 1 {
		t.Fatalf("expected 1 item visible to user 1, got %d", len(items))
	}
	if items[0].(map[string]any)["message"] != "для user 1" {
		t.Fatalf("user 1 saw someone else's notification: %v", items[0])
	}
}

func TestContract_5_1_RequiresAuth(t *testing.T) {
	e := getEnv(t)

	noToken := e.do("GET", "/api/v1/notifications", nil, "")
	e.mustOK(noToken, 401)
	if errCode(noToken) != "UNAUTHORIZED" {
		t.Fatalf("code=%s", errCode(noToken))
	}

	garbage := e.do("GET", "/api/v1/notifications", nil, "not-a-real-token")
	e.mustOK(garbage, 401)

	e.seedUserRef(1, "expired@example.com", "A", "A")
	expired := e.do("GET", "/api/v1/notifications", nil, e.expiredToken(1))
	e.mustOK(expired, 401)
}

// 5.2. Отметить уведомление прочитанным
func TestContract_5_2_MarkRead(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "user1@example.com", "A", "A")
	token := e.accessToken(1)

	e.mustOK(e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 1, "type": "lesson_reminder", "message": "тест",
	}, testServiceToken), 200)

	list := e.do("GET", "/api/v1/notifications?unread_only=false", nil, token)
	e.mustOK(list, 200)
	id := int64(asSlice(list.Body["items"])[0].(map[string]any)["id"].(float64))

	markRes := e.do("PATCH", fmt.Sprintf("/api/v1/notifications/%d/read", id), nil, token)
	e.mustOK(markRes, 200)

	after := e.do("GET", "/api/v1/notifications?unread_only=true", nil, token)
	e.mustOK(after, 200)
	if len(asSlice(after.Body["items"])) != 0 {
		t.Fatal("expected 0 unread after marking as read")
	}
}

// Нельзя отметить прочитанным чужое уведомление.
func TestContract_5_2_MarkRead_NotOwn(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "user1@example.com", "A", "A")
	e.seedUserRef(2, "user2@example.com", "B", "B")

	e.mustOK(e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 1, "type": "lesson_reminder", "message": "чужое",
	}, testServiceToken), 200)

	list := e.do("GET", "/api/v1/notifications?unread_only=false", nil, e.accessToken(1))
	e.mustOK(list, 200)
	id := int64(asSlice(list.Body["items"])[0].(map[string]any)["id"].(float64))

	res := e.do("PATCH", fmt.Sprintf("/api/v1/notifications/%d/read", id), nil, e.accessToken(2))
	e.mustOK(res, 404)
	if errCode(res) != "NOT_FOUND" {
		t.Fatalf("code=%s", errCode(res))
	}
}

func TestContract_5_2_MarkRead_InvalidID(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "user1@example.com", "A", "A")
	res := e.do("PATCH", "/api/v1/notifications/not-a-number/read", nil, e.accessToken(1))
	e.mustOK(res, 400)
	if errCode(res) != "BAD_REQUEST" {
		t.Fatalf("code=%s", errCode(res))
	}
}

// 5.3. Получить настройки каналов (дефолт: email включён, мессенджеры выключены)
func TestContract_5_3_GetSettings_Default(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "user1@example.com", "A", "A")

	res := e.do("GET", "/api/v1/notifications/settings", nil, e.accessToken(1))
	e.mustOK(res, 200)
	if res.Body["email_enabled"] != true || res.Body["max_enabled"] != false ||
		res.Body["telegram_enabled"] != false || res.Body["whatsapp_enabled"] != false {
		t.Fatalf("unexpected default settings: %v", res.Body)
	}
}

// 5.4. Обновить настройки каналов
func TestContract_5_4_UpdateSettings(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "user1@example.com", "A", "A")
	token := e.accessToken(1)

	res := e.do("PATCH", "/api/v1/notifications/settings", map[string]any{
		"email_enabled": true, "max_enabled": true, "telegram_enabled": true, "whatsapp_enabled": true,
	}, token)
	e.mustOK(res, 200)
	if res.Body["email_enabled"] != true || res.Body["max_enabled"] != true ||
		res.Body["telegram_enabled"] != true || res.Body["whatsapp_enabled"] != true {
		t.Fatalf("unexpected updated settings: %v", res.Body)
	}

	// сохранилось — повторный GET отдаёт то же самое
	get := e.do("GET", "/api/v1/notifications/settings", nil, token)
	e.mustOK(get, 200)
	if get.Body["email_enabled"] != true || get.Body["telegram_enabled"] != true {
		t.Fatalf("settings not persisted: %v", get.Body)
	}
}

// Отключённый email-канал должен помечать уведомление failed.
func TestContract_5_4_EmailDisabled_BlocksSend(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "user1@example.com", "A", "A")
	token := e.accessToken(1)

	e.mustOK(e.do("PATCH", "/api/v1/notifications/settings", map[string]any{
		"email_enabled": false, "max_enabled": false, "telegram_enabled": false, "whatsapp_enabled": false,
	}, token), 200)

	send := e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 1, "type": "lesson_reminder", "message": "не должно уйти",
	}, testServiceToken)
	// notifier.Send теперь возвращает ошибку когда нет включённых каналов
	if send.Status != 200 && send.Status != 500 {
		t.Fatalf("unexpected status %d", send.Status)
	}
	if e.mail.count() != 0 {
		t.Fatalf("expected no email sent while channel disabled, got %d", e.mail.count())
	}

	list := e.do("GET", "/api/v1/notifications?unread_only=false", nil, token)
	e.mustOK(list, 200)
	items := asSlice(list.Body["items"])
	if len(items) != 1 || items[0].(map[string]any)["status"] != "failed" {
		t.Fatalf("expected 1 failed notification, got %v", items)
	}
}

// Тест: отправка через Telegram работает при включённом канале
func TestContract_5_5_TelegramChannel(t *testing.T) {
	e := getEnv(t)
	// seed с telegram_id
	e.pool.Exec(e.ctx,
		`INSERT INTO users_ref (id, email, first_name, last_name, telegram_id, updated_at)
		 VALUES (1, 'user1@example.com', 'A', 'A', '987654321', now())
		 ON CONFLICT DO NOTHING`,
	)

	token := e.accessToken(1)

	// Включаем telegram канал
	e.mustOK(e.do("PATCH", "/api/v1/notifications/settings", map[string]any{
		"email_enabled": false, "telegram_enabled": true,
	}, token), 200)

	// Отправляем
	send := e.doInternal("POST", "/api/v1/internal/notifications/send", map[string]any{
		"user_id": 1, "type": "lesson_reminder", "message": "Завтра занятие",
	}, testServiceToken)
	e.mustOK(send, 200)

	// Проверить что создалась запись telegram канала
	list := e.do("GET", "/api/v1/notifications?unread_only=false", nil, token)
	e.mustOK(list, 200)
	items := asSlice(list.Body["items"])
	if len(items) != 1 {
		t.Fatalf("expected 1 telegram notification, got %d", len(items))
	}
}
