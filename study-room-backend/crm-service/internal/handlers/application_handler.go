package handlers

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"studyroom/crm-service/internal/auth"
	"studyroom/crm-service/internal/events"
	"studyroom/crm-service/internal/middleware"
	"studyroom/crm-service/internal/models"
	"studyroom/crm-service/internal/repository"
)

type ApplicationHandler struct {
	repo          *repository.ApplicationRepository
	userRefs      *repository.UserRefRepository
	events        events.Publisher
	webhookSecret string
}

func NewApplicationHandler(repo *repository.ApplicationRepository, userRefs *repository.UserRefRepository, pub events.Publisher, webhookSecret string) *ApplicationHandler {
	return &ApplicationHandler{repo: repo, userRefs: userRefs, events: pub, webhookSecret: webhookSecret}
}

type webhookRequest struct {
	Name            string  `json:"name"`
	Age             *int    `json:"age"`
	Phone           *string `json:"phone"`
	SubjectInterest *string `json:"subject_interest"`
	ParentName      *string `json:"parent_name"`
}

// Webhook — POST /applications/webhook (api-contracts.md 4.1). auth: false —
// вместо JWT проверяется подпись в заголовке X-Tilda-Signature: HMAC-SHA256
// от сырого тела запроса, ключ — TILDA_WEBHOOK_SECRET, hex-encoded.
//
// ВАЖНО: реальный алгоритм подписи Tilda нужно свериться с их документацией
// вебхуков при интеграции — здесь заложена стандартная HMAC-SHA256-схема
// как наиболее распространённая, а не заявленный самой Tilda контракт
// (в api-contracts.md 4.1 сказано только "проверка подписи webhook по
// секретному ключу в заголовке", без указания алгоритма).
func (h *ApplicationHandler) Webhook(w http.ResponseWriter, r *http.Request) {
	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "cannot read body")
		return
	}

	if h.webhookSecret == "" {
		// Только для локальной разработки/тестов, см. config.TildaWebhookSecret.
		log.Printf("[crm] WARNING: TILDA_WEBHOOK_SECRET is not set, skipping signature check — do not run like this in production")
	} else if !validSignature(rawBody, r.Header.Get("X-Tilda-Signature"), h.webhookSecret) {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid webhook signature")
		return
	}

	var req webhookRequest
	if err := json.Unmarshal(rawBody, &req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "name is required")
		return
	}

	app, err := h.repo.CreateFromWebhook(r.Context(), req.Name, req.Age, req.Phone, req.SubjectInterest, req.ParentName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to create application")
		return
	}

	h.notifyReceived(r.Context(), app)
	w.WriteHeader(http.StatusOK)
}

func validSignature(body []byte, signature, secret string) bool {
	if signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

type createInternalRequest struct {
	StudentID       int64   `json:"student_id"`
	SubjectInterest *string `json:"subject_interest"`
	Format          *string `json:"format"`
	// ParentName/Phone — контактные данные родителя, который оформляет заявку.
	// Раньше для source=internal эти поля всегда были nil (считалось, что
	// данные уже есть в User Service и дублировать их незачем). На практике
	// менеджеру, который обрабатывает заявку в CRM, нужно видеть контакт
	// родителя сразу в самой заявке, поэтому фронт теперь передаёт их явно
	// (берутся из профиля залогиненного родителя, см. ParentOverview.jsx).
	ParentName *string `json:"parent_name"`
	Phone      *string `json:"phone"`
}

// CreateInternal — POST /applications (api-contracts.md 4.2), roles: parent
// (проверяется в роутере). Имя заявки берётся из локального кэша
// user_refs по student_id (наполняется событиями user.*) — если событие
// ещё не дошло, используется заглушка "Ученик #id", заявка всё равно
// создаётся (не блокируем родителя из-за задержки доставки события).
func (h *ApplicationHandler) CreateInternal(w http.ResponseWriter, r *http.Request) {
	var req createInternalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.StudentID == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "student_id is required")
		return
	}

	claims, _ := middleware.FromContext(r.Context())

	studentName := ""
	branchID := claims.BranchID
	if ref, err := h.userRefs.GetByID(r.Context(), req.StudentID); err == nil {
		studentName = ref.FullName
		if ref.BranchID != nil {
			branchID = ref.BranchID
		}
	}
	if studentName == "" {
		studentName = studentPlaceholder(req.StudentID)
	}

	// Если фронт не прислал parent_name, подстрахуемся именем родителя из
	// user_refs по его собственному user_id (claims.UserID) — тот же кэш,
	// что и для ученика, только по роли parent.
	parentName := req.ParentName
	if (parentName == nil || *parentName == "") && claims != nil {
		if ref, err := h.userRefs.GetByID(r.Context(), claims.UserID); err == nil && ref.FullName != "" {
			parentName = &ref.FullName
		}
	}

	app, err := h.repo.CreateInternal(r.Context(), studentName, req.StudentID, req.SubjectInterest, req.Format, branchID, parentName, req.Phone)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to create application")
		return
	}

	h.notifyReceived(r.Context(), app)
	writeJSON(w, http.StatusCreated, app)
}

func studentPlaceholder(id int64) string {
	return "Ученик #" + strconv.FormatInt(id, 10)
}

// List — GET /applications?status= (api-contracts.md 4.3), roles: owner
// (вся сеть), branch_owner (только заявки своего филиала).
func (h *ApplicationHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	status := r.URL.Query().Get("status")
	apps, err := h.repo.List(r.Context(), status)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list applications")
		return
	}
	apps = nonNilApplications(apps)

	if claims.Role == models.RoleBranchOwner {
		if claims.BranchID == nil {
			writeJSON(w, http.StatusOK, map[string]any{"items": []*models.Application{}})
			return
		}
		filtered := make([]*models.Application, 0, len(apps))
		for _, a := range apps {
			if a.BranchID != nil && *a.BranchID == *claims.BranchID {
				filtered = append(filtered, a)
			}
		}
		apps = filtered
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": apps})
}

func nonNilApplications(a []*models.Application) []*models.Application {
	if a == nil {
		return []*models.Application{}
	}
	return a
}

type updateStatusRequest struct {
	Status    string `json:"status"`
	HandledBy *int64 `json:"handled_by"`
}

var validStatuses = map[string]bool{
	string(models.StatusNew):        true,
	string(models.StatusInProgress): true,
	string(models.StatusConverted):  true,
	string(models.StatusRejected):   true,
}

// UpdateStatus — PATCH /applications/{id} (api-contracts.md 4.4), roles:
// owner (любая заявка), branch_owner (только заявка своего филиала).
func (h *ApplicationHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid application id")
		return
	}

	var req updateStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if req.Status == "" || !validStatuses[req.Status] {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "status must be one of new/in_progress/converted/rejected")
		return
	}

	if claims.Role == models.RoleBranchOwner {
		if !h.branchOwnerCanAccess(r.Context(), claims, id) {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "application belongs to another branch")
			return
		}
	}

	app, err := h.repo.UpdateStatus(r.Context(), id, req.Status, req.HandledBy)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "application not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to update application")
		return
	}
	writeJSON(w, http.StatusOK, app)
}

// Delete — DELETE /applications/{id} (api-contracts.md 4.5), roles: owner
// (любая заявка), branch_owner (только заявка своего филиала).
func (h *ApplicationHandler) Delete(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.FromContext(r.Context())

	id, err := parseIntPath(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid application id")
		return
	}

	if claims.Role == models.RoleBranchOwner {
		if !h.branchOwnerCanAccess(r.Context(), claims, id) {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "application belongs to another branch")
			return
		}
	}

	if err := h.repo.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "application not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to delete application")
		return
	}
	w.WriteHeader(http.StatusOK)
}

// branchOwnerCanAccess — true, если заявка id принадлежит филиалу claims
// (branch_owner). Используется в UpdateStatus/Delete, чтобы руководитель
// филиала не мог менять/удалять заявки чужих филиалов.
func (h *ApplicationHandler) branchOwnerCanAccess(ctx context.Context, claims *auth.Claims, id int64) bool {
	if claims.BranchID == nil {
		return false
	}
	app, err := h.repo.GetByID(ctx, id)
	if err != nil {
		return false
	}
	return app.BranchID != nil && *app.BranchID == *claims.BranchID
}

// notifyReceived — уведомляет владельца сети (owner) о каждой заявке без
// исключений, и дополнительно — branch_owner филиала заявки, если он
// известен. Раньше owner уведомлялся только если у заявки не было
// branch_owner (фолбэк), из-за чего владелец сети не видел заявки филиалов,
// у которых есть свой branch_owner. Best-effort: ошибка резолва/публикации
// не блокирует ответ пользователю, только логируется (см. events/publisher.go).
func (h *ApplicationHandler) notifyReceived(ctx context.Context, app *models.Application) {
	branchOwnerID, globalOwnerID := h.resolveNotifyTargets(ctx, app.BranchID)

	if branchOwnerID != 0 {
		h.events.ApplicationReceived(branchOwnerID, string(app.Source), app.Name)
	}
	// globalOwnerID != branchOwnerID защищает от повторного уведомления,
	// если вдруг это один и тот же человек (например, owner сам же назначен
	// branch_owner-ом единственного филиала).
	if globalOwnerID != 0 && globalOwnerID != branchOwnerID {
		h.events.ApplicationReceived(globalOwnerID, string(app.Source), app.Name)
	}
}

func (h *ApplicationHandler) resolveNotifyTargets(ctx context.Context, branchID *int64) (branchOwnerID, globalOwnerID int64) {
	if branchID != nil {
		if owner, err := h.userRefs.FindBranchOwner(ctx, *branchID); err == nil {
			branchOwnerID = owner.UserID
		}
	}
	if owner, err := h.userRefs.FindAnyOwner(ctx); err == nil {
		globalOwnerID = owner.UserID
	}
	return branchOwnerID, globalOwnerID
}
