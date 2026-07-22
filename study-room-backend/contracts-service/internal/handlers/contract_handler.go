package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"studyroom/contracts-service/internal/events"
	"studyroom/contracts-service/internal/middleware"
	"studyroom/contracts-service/internal/models"
	"studyroom/contracts-service/internal/repository"
)

const dateLayout = "2006-01-02"

type ContractHandler struct {
	repo       *repository.ContractRepository
	userRefs   *repository.UserRefRepository
	userClient ChildrenResolver
	events     events.Publisher
}

func NewContractHandler(repo *repository.ContractRepository, userRefs *repository.UserRefRepository, userClient ChildrenResolver, pub events.Publisher) *ContractHandler {
	return &ContractHandler{repo: repo, userRefs: userRefs, userClient: userClient, events: pub}
}

type createContractRequest struct {
	StudentID int64   `json:"student_id"`
	ParentID  int64   `json:"parent_id"`
	CourseID  int64   `json:"course_id"`
	BranchID  int64   `json:"branch_id"`
	Amount    float64 `json:"amount"`
	StartDate string  `json:"start_date"`
	EndDate   string  `json:"end_date"`
}

// Create — POST /contracts (api-contracts.md 3.1), roles: owner.
//
// Мягкая валидация student_id/parent_id по user_refs: если запись уже
// синхронизирована событием user.* и роль не совпадает — 400. Если записи
// ещё нет (событие не дошло) — не блокируем создание договора, потому что
// это eventual consistency, а не гарантия (см. README.md).
func (h *ContractHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createContractRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.StudentID == 0 || req.ParentID == 0 || req.CourseID == 0 || req.BranchID == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "student_id, parent_id, course_id, branch_id are required")
		return
	}
	if req.Amount <= 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "amount must be positive")
		return
	}
	startDate, err := time.Parse(dateLayout, req.StartDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "start_date must be YYYY-MM-DD")
		return
	}
	endDate, err := time.Parse(dateLayout, req.EndDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "end_date must be YYYY-MM-DD")
		return
	}
	if !endDate.After(startDate) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "end_date must be after start_date")
		return
	}

	if ref, err := h.userRefs.GetByID(r.Context(), req.StudentID); err == nil && ref.Role != models.RoleStudent {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "student_id does not refer to a student")
		return
	}
	if ref, err := h.userRefs.GetByID(r.Context(), req.ParentID); err == nil && ref.Role != models.RoleParent {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "parent_id does not refer to a parent")
		return
	}

	contract, err := h.repo.Create(r.Context(), req.StudentID, req.ParentID, req.CourseID, req.BranchID, req.Amount, startDate, endDate)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to create contract")
		return
	}

	startStr, endStr := req.StartDate, req.EndDate
	h.events.ContractCreated(contract.ID, contract.StudentID, contract.CourseID, nil, &startStr, &endStr)

	writeJSON(w, http.StatusCreated, contract)
}

// List — GET /contracts?branch_id=&student_id=&status= (api-contracts.md 3.2), roles: owner.
func (h *ContractHandler) List(w http.ResponseWriter, r *http.Request) {
	filter := repository.ListFilter{Status: r.URL.Query().Get("status")}
	if v, ok := parseIntQuery(r, "branch_id"); ok {
		filter.BranchID = v
	}
	if v, ok := parseIntQuery(r, "student_id"); ok {
		filter.StudentID = v
	}

	contracts, err := h.repo.List(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list contracts")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": nonNilContracts(contracts)})
}

func nonNilContracts(c []*models.Contract) []*models.Contract {
	if c == nil {
		return []*models.Contract{}
	}
	return c
}

// GetByID — GET /contracts/{id} (api-contracts.md 3.3), roles: owner.
func (h *ContractHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid contract id")
		return
	}
	contract, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "contract not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to get contract")
		return
	}
	writeJSON(w, http.StatusOK, contract)
}

// Expiry — GET /contracts/{id}/expiry (api-contracts.md 3.3a), roles:
// branch_owner (только своего филиала), parent (только своих детей).
// Owner сюда не заходит — у него уже есть полный 3.3.
func (h *ContractHandler) Expiry(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid contract id")
		return
	}
	contract, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "contract not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to get contract")
		return
	}

	claims, _ := middleware.FromContext(r.Context())
	switch claims.Role {
	case models.RoleBranchOwner:
		if claims.BranchID == nil || *claims.BranchID != contract.BranchID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "contract belongs to a different branch")
			return
		}
	case models.RoleParent:
		children, err := h.userClient.Children(r.Context(), bearerToken(r), claims.UserID)
		if err != nil {
			writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "failed to resolve children")
			return
		}
		if !contains(children, contract.StudentID) {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "contract belongs to a different family")
			return
		}
	default:
		writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted")
		return
	}

	writeJSON(w, http.StatusOK, models.ContractExpiry{ContractID: contract.ID, EndDate: contract.EndDate})
}

type updateContractRequest struct {
	EndDate *string  `json:"end_date"`
	Amount  *float64 `json:"amount"`
}

// UpdateFields — PATCH /contracts/{id} (api-contracts.md 3.4), roles: owner.
func (h *ContractHandler) UpdateFields(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid contract id")
		return
	}
	var req updateContractRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	var endDate *time.Time
	if req.EndDate != nil {
		d, err := time.Parse(dateLayout, *req.EndDate)
		if err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "end_date must be YYYY-MM-DD")
			return
		}
		endDate = &d
	}

	contract, err := h.repo.UpdateFields(r.Context(), id, endDate, req.Amount)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "contract not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to update contract")
		return
	}
	writeJSON(w, http.StatusOK, contract)
}

var validContractStatuses = map[string]bool{
	string(models.StatusActive):     true,
	string(models.StatusCompleted):  true,
	string(models.StatusTerminated): true,
}

type updateStatusRequest struct {
	Status string `json:"status"`
}

// UpdateStatus — PATCH /contracts/{id}/status (api-contracts.md 3.5), roles: owner.
func (h *ContractHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid contract id")
		return
	}
	var req updateStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if !validContractStatuses[req.Status] {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "status must be one of active/completed/terminated")
		return
	}
	if err := h.repo.UpdateStatus(r.Context(), id, req.Status); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "contract not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to update status")
		return
	}
	w.WriteHeader(http.StatusOK)
}

var validPaymentStatuses = map[string]bool{
	string(models.PaymentUnpaid): true,
	string(models.PaymentPaid):   true,
}

type updatePaymentStatusRequest struct {
	PaymentStatus string `json:"payment_status"`
}

// UpdatePaymentStatus — PATCH /contracts/{id}/payment-status (api-contracts.md 3.6), roles: owner.
func (h *ContractHandler) UpdatePaymentStatus(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid contract id")
		return
	}
	var req updatePaymentStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if !validPaymentStatuses[req.PaymentStatus] {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "payment_status must be one of unpaid/paid")
		return
	}
	if err := h.repo.UpdatePaymentStatus(r.Context(), id, req.PaymentStatus); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "contract not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to update payment status")
		return
	}
	w.WriteHeader(http.StatusOK)
}

// Delete — DELETE /contracts/{id} (api-contracts.md 3.7), roles: owner.
func (h *ContractHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid contract id")
		return
	}
	if err := h.repo.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "contract not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to delete contract")
		return
	}
	w.WriteHeader(http.StatusOK)
}
