package contracts_test

import (
	"net/http"
	"strings"
	"testing"
)

func createContractBody(studentID, parentID, courseID, branchID int64) map[string]any {
	return map[string]any{
		"student_id": studentID,
		"parent_id":  parentID,
		"course_id":  courseID,
		"branch_id":  branchID,
		"amount":     4500,
		"start_date": "2026-08-01",
		"end_date":   "2027-01-31",
	}
}

// --- 3.1. POST /contracts -------------------------------------------------

func TestCreateContract_Owner_Success(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)

	res := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 1), ownerToken)
	e.mustOK(res, http.StatusCreated)

	if res.Body["status"] != "active" || res.Body["payment_status"] != "unpaid" {
		t.Fatalf("unexpected defaults: %+v", res.Body)
	}
	number, _ := res.Body["contract_number"].(string)
	if !strings.HasPrefix(number, "SR-2026-") {
		t.Fatalf("unexpected contract_number: %q", number)
	}
}

func TestCreateContract_NonOwner_Forbidden(t *testing.T) {
	e := getEnv(t)
	parentToken := e.accessToken(300, "parent", nil)

	res := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 1), parentToken)
	e.mustOK(res, http.StatusForbidden)
}

func TestCreateContract_EndBeforeStart_Rejected(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)

	body := createContractBody(100, 300, 12, 1)
	body["start_date"] = "2027-01-31"
	body["end_date"] = "2026-08-01"

	res := e.do(http.MethodPost, "/api/v1/contracts", body, ownerToken)
	e.mustOK(res, http.StatusBadRequest)
}

func TestCreateContract_StudentIDRoleMismatch_Rejected(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)

	// student_id=300 на самом деле зарегистрирован в user_refs как tutor —
	// мягкая валидация должна это поймать.
	e.seedUserRef(300, "Не Студент", "tutor", nil)

	res := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(300, 301, 12, 1), ownerToken)
	e.mustOK(res, http.StatusBadRequest)
}

func TestCreateContract_UnknownUserRefs_NotBlocked(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)

	// user_refs пуст (событие user.created ещё не пришло) — не должно блокировать создание.
	res := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(999, 998, 12, 1), ownerToken)
	e.mustOK(res, http.StatusCreated)
}

// --- 3.2. GET /contracts ---------------------------------------------------

func TestListContracts_OwnerOnly(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)
	parentToken := e.accessToken(300, "parent", nil)

	e.mustOK(e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 1), ownerToken), http.StatusCreated)

	forbidden := e.do(http.MethodGet, "/api/v1/contracts", nil, parentToken)
	e.mustOK(forbidden, http.StatusForbidden)

	ok := e.do(http.MethodGet, "/api/v1/contracts", nil, ownerToken)
	e.mustOK(ok, http.StatusOK)
	if len(asSlice(ok.Body["items"])) != 1 {
		t.Fatalf("expected 1 contract, got %+v", ok.Body["items"])
	}
}

func TestListContracts_FilterByBranchAndStatus(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)

	e.mustOK(e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 1), ownerToken), http.StatusCreated)
	e.mustOK(e.do(http.MethodPost, "/api/v1/contracts", createContractBody(101, 301, 12, 2), ownerToken), http.StatusCreated)

	byBranch := e.do(http.MethodGet, "/api/v1/contracts?branch_id=2", nil, ownerToken)
	e.mustOK(byBranch, http.StatusOK)
	items := asSlice(byBranch.Body["items"])
	if len(items) != 1 || items[0].(map[string]any)["branch_id"] != float64(2) {
		t.Fatalf("expected 1 contract with branch_id=2, got %+v", items)
	}

	list := e.do(http.MethodGet, "/api/v1/contracts", nil, ownerToken)
	e.mustOK(list, http.StatusOK)
	firstID := toPathID(asSlice(list.Body["items"])[0].(map[string]any)["id"])
	e.mustOK(e.do(http.MethodPatch, "/api/v1/contracts/"+firstID+"/status", map[string]any{
		"status": "terminated",
	}, ownerToken), http.StatusOK)

	byStatus := e.do(http.MethodGet, "/api/v1/contracts?status=terminated", nil, ownerToken)
	e.mustOK(byStatus, http.StatusOK)
	if len(asSlice(byStatus.Body["items"])) != 1 {
		t.Fatalf("expected 1 terminated contract, got %+v", byStatus.Body["items"])
	}
}

func TestListContracts_BranchOwner_OwnBranchOnlyRedacted(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)
	branch1 := int64(1)
	branchOwnerToken := e.accessToken(900, "branch_owner", &branch1)

	e.mustOK(e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 1), ownerToken), http.StatusCreated)
	e.mustOK(e.do(http.MethodPost, "/api/v1/contracts", createContractBody(101, 301, 12, 2), ownerToken), http.StatusCreated)

	// branch_owner видит только договор своего филиала (1), даже если явно
	// запросит чужой branch_id=2 в query — сервер подставляет свой из claims.
	res := e.do(http.MethodGet, "/api/v1/contracts?branch_id=2", nil, branchOwnerToken)
	e.mustOK(res, http.StatusOK)
	items := asSlice(res.Body["items"])
	if len(items) != 1 {
		t.Fatalf("expected 1 contract scoped to own branch, got %+v", items)
	}
	item := items[0].(map[string]any)
	if item["branch_id"] != float64(1) {
		t.Fatalf("expected branch_id=1, got %+v", item)
	}
	if item["status"] == nil || item["start_date"] == nil || item["end_date"] == nil {
		t.Fatalf("expected status/start_date/end_date to be present, got %+v", item)
	}
	if _, hasAmount := item["amount"]; hasAmount {
		t.Fatalf("branch_owner must not see amount, got %+v", item)
	}
	if _, hasPaymentStatus := item["payment_status"]; hasPaymentStatus {
		t.Fatalf("branch_owner must not see payment_status, got %+v", item)
	}

	forbidden := e.do(http.MethodGet, "/api/v1/contracts", nil, e.accessToken(300, "parent", nil))
	e.mustOK(forbidden, http.StatusForbidden)
}

// --- 3.3. GET /contracts/{id} ----------------------------------------------

func TestGetContract_NotFound(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)

	res := e.do(http.MethodGet, "/api/v1/contracts/999999", nil, ownerToken)
	e.mustOK(res, http.StatusNotFound)
}

// --- 3.3a. GET /contracts/{id}/expiry --------------------------------------

func TestExpiry_BranchOwner_OwnBranch_Success(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)
	created := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 5), ownerToken)
	e.mustOK(created, http.StatusCreated)
	id := toPathID(created.Body["id"])

	branchID := int64(5)
	branchOwnerToken := e.accessToken(50, "branch_owner", &branchID)

	res := e.do(http.MethodGet, "/api/v1/contracts/"+id+"/expiry", nil, branchOwnerToken)
	e.mustOK(res, http.StatusOK)
	if res.Body["end_date"] == nil {
		t.Fatalf("expected end_date in response, got %+v", res.Body)
	}
	if _, hasAmount := res.Body["amount"]; hasAmount {
		t.Fatalf("expiry response must not expose amount, got %+v", res.Body)
	}
}

func TestExpiry_BranchOwner_OtherBranch_Forbidden(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)
	created := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 5), ownerToken)
	e.mustOK(created, http.StatusCreated)
	id := toPathID(created.Body["id"])

	otherBranch := int64(6)
	branchOwnerToken := e.accessToken(51, "branch_owner", &otherBranch)

	res := e.do(http.MethodGet, "/api/v1/contracts/"+id+"/expiry", nil, branchOwnerToken)
	e.mustOK(res, http.StatusForbidden)
}

func TestExpiry_Parent_OwnChild_Success(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)
	created := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 5), ownerToken)
	e.mustOK(created, http.StatusCreated)
	id := toPathID(created.Body["id"])

	e.children.set(300, 100)
	parentToken := e.accessToken(300, "parent", nil)

	res := e.do(http.MethodGet, "/api/v1/contracts/"+id+"/expiry", nil, parentToken)
	e.mustOK(res, http.StatusOK)
}

func TestExpiry_Parent_NotOwnChild_Forbidden(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)
	created := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 5), ownerToken)
	e.mustOK(created, http.StatusCreated)
	id := toPathID(created.Body["id"])

	e.children.set(301, 999) // чужой ребёнок
	parentToken := e.accessToken(301, "parent", nil)

	res := e.do(http.MethodGet, "/api/v1/contracts/"+id+"/expiry", nil, parentToken)
	e.mustOK(res, http.StatusForbidden)
}

func TestExpiry_Owner_Forbidden(t *testing.T) {
	// У owner уже есть полный 3.3 — облегчённый 3.3a ему не открыт по контракту.
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)
	created := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 5), ownerToken)
	e.mustOK(created, http.StatusCreated)
	id := toPathID(created.Body["id"])

	res := e.do(http.MethodGet, "/api/v1/contracts/"+id+"/expiry", nil, ownerToken)
	e.mustOK(res, http.StatusForbidden)
}

// --- 3.4. PATCH /contracts/{id} --------------------------------------------

func TestUpdateContractFields(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)
	created := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 1), ownerToken)
	e.mustOK(created, http.StatusCreated)
	id := toPathID(created.Body["id"])

	res := e.do(http.MethodPatch, "/api/v1/contracts/"+id, map[string]any{
		"end_date": "2027-06-30",
		"amount":   5000,
	}, ownerToken)
	e.mustOK(res, http.StatusOK)
	if res.Body["amount"] != float64(5000) {
		t.Fatalf("expected amount updated to 5000, got %+v", res.Body["amount"])
	}
}

// --- 3.5. PATCH /contracts/{id}/status -------------------------------------

func TestUpdateContractStatus_Invalid(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)
	created := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 1), ownerToken)
	e.mustOK(created, http.StatusCreated)
	id := toPathID(created.Body["id"])

	res := e.do(http.MethodPatch, "/api/v1/contracts/"+id+"/status", map[string]any{
		"status": "not-a-real-status",
	}, ownerToken)
	e.mustOK(res, http.StatusBadRequest)
}

// --- 3.6. PATCH /contracts/{id}/payment-status -----------------------------

func TestUpdatePaymentStatus(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)
	created := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 1), ownerToken)
	e.mustOK(created, http.StatusCreated)
	id := toPathID(created.Body["id"])

	e.mustOK(e.do(http.MethodPatch, "/api/v1/contracts/"+id+"/payment-status", map[string]any{
		"payment_status": "paid",
	}, ownerToken), http.StatusOK)

	get := e.do(http.MethodGet, "/api/v1/contracts/"+id, nil, ownerToken)
	e.mustOK(get, http.StatusOK)
	if get.Body["payment_status"] != "paid" {
		t.Fatalf("expected payment_status=paid, got %+v", get.Body["payment_status"])
	}
}

func TestUpdatePaymentStatus_Invalid(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)
	created := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 1), ownerToken)
	e.mustOK(created, http.StatusCreated)
	id := toPathID(created.Body["id"])

	res := e.do(http.MethodPatch, "/api/v1/contracts/"+id+"/payment-status", map[string]any{
		"payment_status": "half-paid",
	}, ownerToken)
	e.mustOK(res, http.StatusBadRequest)
}

// --- 3.7. DELETE /contracts/{id} --------------------------------------------

func TestDeleteContract_Owner(t *testing.T) {
	e := getEnv(t)
	ownerToken := e.accessToken(1, "owner", nil)
	created := e.do(http.MethodPost, "/api/v1/contracts", createContractBody(100, 300, 12, 1), ownerToken)
	e.mustOK(created, http.StatusCreated)
	id := toPathID(created.Body["id"])

	e.mustOK(e.do(http.MethodDelete, "/api/v1/contracts/"+id, nil, ownerToken), http.StatusOK)
	e.mustOK(e.do(http.MethodGet, "/api/v1/contracts/"+id, nil, ownerToken), http.StatusNotFound)
}

func TestDeleteContract_NonOwner_Forbidden(t *testing.T) {
	e := getEnv(t)
	parentToken := e.accessToken(300, "parent", nil)

	res := e.do(http.MethodDelete, "/api/v1/contracts/1", nil, parentToken)
	e.mustOK(res, http.StatusForbidden)
}
