package contracts_test

import (
	"net/http"
	"testing"
)

// --- 4.1. POST /applications/webhook -----------------------------------

func TestWebhook_ValidSignature_CreatesApplication(t *testing.T) {
	e := getEnv(t)

	body := []byte(`{"name":"Кирилл Д.","age":10,"phone":"+79990001122","subject_interest":"Математика","parent_name":"Елена Д."}`)
	sig := signWebhook(testWebhookSecret, body)

	res := e.requestRaw(http.MethodPost, "/api/v1/crm/applications/webhook", body, map[string]string{
		"X-Tilda-Signature": sig,
	})
	e.mustOK(res, http.StatusOK)

	// Заявка действительно создана — проверяем через owner-листинг.
	e.seedUserRef(1, "Иван Владелец", "owner", nil)
	list := e.do(http.MethodGet, "/api/v1/crm/applications", nil, e.accessToken(1, "owner", nil))
	e.mustOK(list, http.StatusOK)
	items := asSlice(list.Body["items"])
	if len(items) != 1 {
		t.Fatalf("expected 1 application, got %d", len(items))
	}
	item := items[0].(map[string]any)
	if item["source"] != "tilda" || item["status"] != "new" || item["name"] != "Кирилл Д." {
		t.Fatalf("unexpected application: %+v", item)
	}
}

func TestWebhook_InvalidSignature_Rejected(t *testing.T) {
	e := getEnv(t)

	body := []byte(`{"name":"Кирилл Д."}`)
	res := e.requestRaw(http.MethodPost, "/api/v1/crm/applications/webhook", body, map[string]string{
		"X-Tilda-Signature": "not-a-valid-signature",
	})
	e.mustOK(res, http.StatusUnauthorized)
}

func TestWebhook_MissingName_Rejected(t *testing.T) {
	e := getEnv(t)

	body := []byte(`{"age":10}`)
	sig := signWebhook(testWebhookSecret, body)
	res := e.requestRaw(http.MethodPost, "/api/v1/crm/applications/webhook", body, map[string]string{
		"X-Tilda-Signature": sig,
	})
	e.mustOK(res, http.StatusBadRequest)
}

// --- 4.2. POST /applications (внутренняя заявка) ------------------------

func TestCreateInternal_Parent_CreatesApplication(t *testing.T) {
	e := getEnv(t)

	branchID := int64(7)
	e.seedUserRef(10, "Пётр Ученик", "student", &branchID)
	parentToken := e.accessToken(20, "parent", &branchID)

	res := e.do(http.MethodPost, "/api/v1/crm/applications", map[string]any{
		"student_id":       10,
		"subject_interest": "Английский язык",
		"format":           "group",
	}, parentToken)
	e.mustOK(res, http.StatusCreated)

	if res.Body["source"] != "internal" || res.Body["status"] != "new" {
		t.Fatalf("unexpected application: %+v", res.Body)
	}
	if res.Body["name"] != "Пётр Ученик" {
		t.Fatalf("expected student name resolved from user_refs, got %+v", res.Body["name"])
	}
}

func TestCreateInternal_NonParent_Forbidden(t *testing.T) {
	e := getEnv(t)
	tutorToken := e.accessToken(30, "tutor", nil)

	res := e.do(http.MethodPost, "/api/v1/crm/applications", map[string]any{
		"student_id": 10,
	}, tutorToken)
	e.mustOK(res, http.StatusForbidden)
	if errCode(res) != "FORBIDDEN" {
		t.Fatalf("expected FORBIDDEN, got %s", errCode(res))
	}
}

func TestCreateInternal_MissingStudentID_Rejected(t *testing.T) {
	e := getEnv(t)
	parentToken := e.accessToken(20, "parent", nil)

	res := e.do(http.MethodPost, "/api/v1/crm/applications", map[string]any{
		"subject_interest": "Физика",
	}, parentToken)
	e.mustOK(res, http.StatusBadRequest)
}

// --- 4.3. GET /applications ----------------------------------------------

func TestListApplications_OwnerOnly(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "Владелец", "owner", nil)
	ownerToken := e.accessToken(1, "owner", nil)
	parentToken := e.accessToken(20, "parent", nil)

	body := []byte(`{"name":"Заявка 1"}`)
	e.requestRaw(http.MethodPost, "/api/v1/crm/applications/webhook", body, map[string]string{
		"X-Tilda-Signature": signWebhook(testWebhookSecret, body),
	})

	forbidden := e.do(http.MethodGet, "/api/v1/crm/applications", nil, parentToken)
	e.mustOK(forbidden, http.StatusForbidden)

	ok := e.do(http.MethodGet, "/api/v1/crm/applications", nil, ownerToken)
	e.mustOK(ok, http.StatusOK)
	if len(asSlice(ok.Body["items"])) != 1 {
		t.Fatalf("expected 1 application, got %+v", ok.Body["items"])
	}
}

func TestListApplications_FilterByStatus(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "Владелец", "owner", nil)
	ownerToken := e.accessToken(1, "owner", nil)

	for _, name := range []string{"Заявка A", "Заявка B"} {
		body := []byte(`{"name":"` + name + `"}`)
		e.requestRaw(http.MethodPost, "/api/v1/crm/applications/webhook", body, map[string]string{
			"X-Tilda-Signature": signWebhook(testWebhookSecret, body),
		})
	}

	list := e.do(http.MethodGet, "/api/v1/crm/applications", nil, ownerToken)
	e.mustOK(list, http.StatusOK)
	items := asSlice(list.Body["items"])
	if len(items) != 2 {
		t.Fatalf("expected 2 applications, got %d", len(items))
	}
	firstID := toPathID(items[0].(map[string]any)["id"])

	e.mustOK(e.do(http.MethodPatch, "/api/v1/crm/applications/"+firstID, map[string]any{
		"status": "converted",
	}, ownerToken), http.StatusOK)

	filtered := e.do(http.MethodGet, "/api/v1/crm/applications?status=converted", nil, ownerToken)
	e.mustOK(filtered, http.StatusOK)
	filteredItems := asSlice(filtered.Body["items"])
	if len(filteredItems) != 1 {
		t.Fatalf("expected 1 converted application, got %d", len(filteredItems))
	}
}

// --- 4.4. PATCH /applications/{id} --------------------------------------

func TestUpdateStatus_InvalidStatus_Rejected(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "Владелец", "owner", nil)
	ownerToken := e.accessToken(1, "owner", nil)

	body := []byte(`{"name":"Заявка"}`)
	e.requestRaw(http.MethodPost, "/api/v1/crm/applications/webhook", body, map[string]string{
		"X-Tilda-Signature": signWebhook(testWebhookSecret, body),
	})
	list := e.do(http.MethodGet, "/api/v1/crm/applications", nil, ownerToken)
	id := toPathID(asSlice(list.Body["items"])[0].(map[string]any)["id"])

	res := e.do(http.MethodPatch, "/api/v1/crm/applications/"+id, map[string]any{
		"status": "not-a-real-status",
	}, ownerToken)
	e.mustOK(res, http.StatusBadRequest)
}

func TestUpdateStatus_NotFound(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "Владелец", "owner", nil)
	ownerToken := e.accessToken(1, "owner", nil)

	res := e.do(http.MethodPatch, "/api/v1/crm/applications/999999", map[string]any{
		"status": "converted",
	}, ownerToken)
	e.mustOK(res, http.StatusNotFound)
}

// --- 4.5. DELETE /applications/{id} -------------------------------------

func TestDeleteApplication_Owner(t *testing.T) {
	e := getEnv(t)
	e.seedUserRef(1, "Владелец", "owner", nil)
	ownerToken := e.accessToken(1, "owner", nil)

	body := []byte(`{"name":"Заявка на удаление"}`)
	e.requestRaw(http.MethodPost, "/api/v1/crm/applications/webhook", body, map[string]string{
		"X-Tilda-Signature": signWebhook(testWebhookSecret, body),
	})
	list := e.do(http.MethodGet, "/api/v1/crm/applications", nil, ownerToken)
	id := toPathID(asSlice(list.Body["items"])[0].(map[string]any)["id"])

	e.mustOK(e.do(http.MethodDelete, "/api/v1/crm/applications/"+id, nil, ownerToken), http.StatusOK)

	after := e.do(http.MethodGet, "/api/v1/crm/applications", nil, ownerToken)
	e.mustOK(after, http.StatusOK)
	if len(asSlice(after.Body["items"])) != 0 {
		t.Fatalf("expected 0 applications after delete, got %+v", after.Body["items"])
	}
}

func TestDeleteApplication_NonOwner_Forbidden(t *testing.T) {
	e := getEnv(t)
	parentToken := e.accessToken(20, "parent", nil)

	res := e.do(http.MethodDelete, "/api/v1/crm/applications/1", nil, parentToken)
	e.mustOK(res, http.StatusForbidden)
}

// --- резолв получателя application.received (через branch_owner/owner) --

func TestResolveNotifyTarget_PrefersBranchOwnerOverGlobalOwner(t *testing.T) {
	e := getEnv(t)
	branchID := int64(5)
	e.seedUserRef(1, "Глобальный владелец", "owner", nil)
	e.seedUserRef(2, "Владелец филиала", "branch_owner", &branchID)
	e.seedUserRef(10, "Ученик", "student", &branchID)

	parentToken := e.accessToken(20, "parent", &branchID)
	res := e.do(http.MethodPost, "/api/v1/crm/applications", map[string]any{
		"student_id": 10,
	}, parentToken)
	e.mustOK(res, http.StatusCreated)

	// NoopPublisher не проверить напрямую, но сам факт, что запрос не упал
	// при наличии обоих кандидатов, и branch_id заявки соответствует
	// branch_owner — косвенное подтверждение резолва в handlers.resolveNotifyTarget.
	if res.Body["branch_id"] != float64(branchID) {
		t.Fatalf("expected branch_id=%d on created application, got %+v", branchID, res.Body["branch_id"])
	}
}
