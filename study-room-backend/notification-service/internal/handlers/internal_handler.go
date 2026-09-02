package handlers

import (
	"encoding/json"
	"net/http"

	"studyroom/notification-service/internal/models"
	"studyroom/notification-service/internal/notifier"
	"studyroom/notification-service/internal/repository"
)

type InternalHandler struct {
	notifier *notifier.Notifier
	usersRef *repository.UserRefRepository
}

func NewInternalHandler(n *notifier.Notifier, usersRef *repository.UserRefRepository) *InternalHandler {
	return &InternalHandler{notifier: n, usersRef: usersRef}
}

type sendNotificationRequest struct {
	UserID  int64  `json:"user_id"`
	Type    string `json:"type"`
	Message string `json:"message"`
	// Email — необязательное поле, отсутствует в исходном контракте
	// api-contracts.md 5.5, добавлено как временный обход, пока подписка
	// на события user.created/user.updated не наполняет users_ref сама
	// (см. internal/events). Если не передан, берётся из users_ref.
	Email string `json:"email,omitempty"`
}

// POST /internal/notifications/send — вызывается другими сервисами
// (Contracts/Academic/CRM) по событиям contract.expiring_soon,
// lesson.created, attendance.marked_absent, application.received.
func (h *InternalHandler) Send(w http.ResponseWriter, r *http.Request) {
	var req sendNotificationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid body")
		return
	}
	if req.UserID == 0 || req.Type == "" || req.Message == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "user_id, type and message are required")
		return
	}

	if _, err := h.notifier.Send(r.Context(), req.UserID, req.Type, req.Message, req.Email); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to send notification")
		return
	}
	w.WriteHeader(http.StatusOK)
}

type syncUserRequest struct {
	ID         int64  `json:"id"`
	Email      string `json:"email"`
	FirstName  string `json:"first_name"`
	LastName   string `json:"last_name"`
	Phone      string `json:"phone,omitempty"`
	TelegramID string `json:"telegram_id,omitempty"`
	WhatsAppID string `json:"whatsapp_id,omitempty"`
}

// POST /internal/users/sync — наполняет users_ref данными пользователя,
// включая контакты для мессенджеров (phone, telegram_id, whatsapp_id).
// В целевой архитектуре это должно приходить только через события NATS.
func (h *InternalHandler) SyncUser(w http.ResponseWriter, r *http.Request) {
	var req syncUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid body")
		return
	}
	if req.ID == 0 || req.Email == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "id and email are required")
		return
	}

	if err := h.usersRef.Upsert(r.Context(), &models.UserRef{
		ID: req.ID, Email: req.Email, FirstName: req.FirstName, LastName: req.LastName,
		Phone: req.Phone, TelegramID: req.TelegramID, WhatsAppID: req.WhatsAppID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to sync user")
		return
	}
	w.WriteHeader(http.StatusOK)
}
