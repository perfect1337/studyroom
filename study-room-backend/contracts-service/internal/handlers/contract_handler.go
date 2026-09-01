package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"studyroom/contracts-service/internal/auth"
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

// Create — POST /contracts (api-contracts.md 3.1), roles: owner (любой
// филиал), branch_owner (только свой — branch_id из запроса игнорируется и
// принудительно подставляется из claims).
//
// Мягкая валидация student_id/parent_id по user_refs: если запись уже
// синхронизирована событием user.* и роль не совпадает — 400. Если записи
// ещё нет (событие не дошло) — не блокируем создание договора, потому что
// это eventual consistency, а не гарантия (см. README.md).
func (h *ContractHandler) Create(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	var req createContractRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}

	if claims.Role == models.RoleBranchOwner {
		if claims.BranchID == nil {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "branch_owner has no branch")
			return
		}
		req.BranchID = *claims.BranchID
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

// List — GET /contracts?branch_id=&student_id=&status= (api-contracts.md 3.2),
// roles: owner (любой филиал) / branch_owner (принудительно только свой —
// query-параметр branch_id для него игнорируется, иначе он смог бы
// подсмотреть договоры чужого филиала просто поменяв параметр в адресе).
func (h *ContractHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())
	filter := repository.ListFilter{Status: r.URL.Query().Get("status")}

	if claims.Role == models.RoleBranchOwner {
		if claims.BranchID == nil {
			writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
		filter.BranchID = claims.BranchID
	} else if v, ok := parseIntQuery(r, "branch_id"); ok {
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

// ListMine — GET /contracts/mine, роль: parent.
// Возвращает договоры всех детей текущего родителя (полные данные — сумма,
// статус оплаты, срок), в отличие от /{id}/expiry, где отдаётся только
// дата окончания. Список детей берётся тем же способом, что и в Expiry —
// через userClient.Children(parentID).
func (h *ContractHandler) ListMine(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	children, err := h.userClient.Children(r.Context(), bearerToken(r), claims.UserID)
	if err != nil {
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "failed to resolve children")
		return
	}

	contracts, err := h.repo.ListByStudentIDs(r.Context(), children)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list contracts")
		return
	}

	// Родитель видит только текущие активные договоры. Ограничение применяется
	// на сервере, а не только скрывается во фронтенде.
	filtered := make([]*models.Contract, 0, len(contracts))
	for _, c := range contracts {
		if c.Status == models.StatusActive {
			filtered = append(filtered, c)
		}
	}
	contracts = filtered

	writeJSON(w, http.StatusOK, map[string]any{"items": nonNilContracts(contracts)})
}

func nonNilContracts(c []*models.Contract) []*models.Contract {
	if c == nil {
		return []*models.Contract{}
	}
	return c
}

// GetByID — GET /contracts/{id} (api-contracts.md 3.3), roles: owner (любой
// договор), branch_owner (только договор своего филиала).
func (h *ContractHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

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
	if claims.Role == models.RoleBranchOwner && (claims.BranchID == nil || *claims.BranchID != contract.BranchID) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "contract belongs to a different branch")
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

// UpdateFields — PATCH /contracts/{id} (api-contracts.md 3.4), roles: owner
// (любой договор), branch_owner (только договор своего филиала).
func (h *ContractHandler) UpdateFields(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid contract id")
		return
	}
	if err := h.checkBranchOwnerAccess(r.Context(), claims, id); err != nil {
		writeError(w, http.StatusForbidden, "FORBIDDEN", err.Error())
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
	// Keep Academic Service's enrollment dates in sync with contract dates.
	h.events.ContractUpdated(contract.ID, contract.StudentID, contract.CourseID,
		contract.StartDate.Format(dateLayout), contract.EndDate.Format(dateLayout))

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

// UpdateStatus — PATCH /contracts/{id}/status (api-contracts.md 3.5), roles:
// owner (любой договор), branch_owner (только договор своего филиала).
//
// Расторжение (status="terminated") публикует contract.terminated (см.
// events/publisher.go) — на него подписан Academic Service и каскадно
// отменяет ещё не проведённые занятия ученика по этому курсу и переводит
// саму запись enrollments в status="terminated" (см.
// academic-service/internal/events/subscriber.go, handleContractTerminated).
// Событие публикуется best-effort уже ПОСЛЕ успешного обновления статуса
// самого договора — сбой доставки не должен блокировать расторжение
// договора как таковое, это asynchronous side-effect, а не часть транзакции.
func (h *ContractHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid contract id")
		return
	}
	if err := h.checkBranchOwnerAccess(r.Context(), claims, id); err != nil {
		writeError(w, http.StatusForbidden, "FORBIDDEN", err.Error())
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

	// Договор нужен ДО обновления статуса — student_id/course_id не
	// меняются самим UpdateStatus, но GetByID после успешного апдейта не
	// вернёт ничего нового и лишь добавляет ещё один запрос к БД впустую;
	// читаем его один раз заранее.
	// Load the contract for every lifecycle transition: Academic Service needs
	// the student/course pair for activation, termination and expiry handling.
	contract, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "contract not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load contract")
		return
	}
	if req.Status == string(models.StatusActive) && contract.EndDate.Format(dateLayout) < time.Now().Format(dateLayout) {
		writeError(w, http.StatusBadRequest, "CONTRACT_EXPIRED", "cannot activate an expired contract; extend the end date first")
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

	switch req.Status {
	case string(models.StatusTerminated):
		h.events.ContractTerminated(contract.ID, contract.StudentID, contract.CourseID)
	case string(models.StatusActive):
		h.events.ContractActivated(contract.ID, contract.StudentID, contract.CourseID,
			contract.StartDate.Format(dateLayout), contract.EndDate.Format(dateLayout))
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

// UpdatePaymentStatus — PATCH /contracts/{id}/payment-status (api-contracts.md 3.6), roles:
// owner (любой договор), branch_owner (только договор своего филиала).
func (h *ContractHandler) UpdatePaymentStatus(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid contract id")
		return
	}
	if err := h.checkBranchOwnerAccess(r.Context(), claims, id); err != nil {
		writeError(w, http.StatusForbidden, "FORBIDDEN", err.Error())
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

// Delete — DELETE /contracts/{id} (api-contracts.md 3.7), roles: owner
// (любой договор), branch_owner (только договор своего филиала).
func (h *ContractHandler) Delete(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid contract id")
		return
	}
	if err := h.checkBranchOwnerAccess(r.Context(), claims, id); err != nil {
		writeError(w, http.StatusForbidden, "FORBIDDEN", err.Error())
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

// checkBranchOwnerAccess — для branch_owner проверяет, что договор id
// принадлежит его филиалу (для owner всегда nil — без ограничений). Общий
// хелпер для UpdateFields/UpdateStatus/UpdatePaymentStatus/Delete, чтобы
// руководитель филиала не мог менять/удалять договоры чужих филиалов.
func (h *ContractHandler) checkBranchOwnerAccess(ctx context.Context, claims *auth.Claims, contractID int64) error {
	if claims.Role != models.RoleBranchOwner {
		return nil
	}
	if claims.BranchID == nil {
		return errors.New("branch_owner has no branch")
	}
	contract, err := h.repo.GetByID(ctx, contractID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil // 404 отдаст сам вызывающий хендлер при попытке обновления/удаления
		}
		return err
	}
	if contract.BranchID != *claims.BranchID {
		return errors.New("contract belongs to a different branch")
	}
	return nil
}
