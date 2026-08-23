package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"studyroom/notification-service/internal/middleware"
	"studyroom/notification-service/internal/models"
	"studyroom/notification-service/internal/repository"
)

type NotificationHandler struct {
	notifications  *repository.NotificationRepository
	settings       *repository.SettingsRepository
	telegramUser   *repository.TelegramUserRepository
}

func NewNotificationHandler(
	notifications *repository.NotificationRepository,
	settings *repository.SettingsRepository,
	telegramUser *repository.TelegramUserRepository,
) *NotificationHandler {
	return &NotificationHandler{notifications: notifications, settings: settings, telegramUser: telegramUser}
}

// GET /notifications?unread_only=true
func (h *NotificationHandler) List(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "no auth context")
		return
	}
	unreadOnly := r.URL.Query().Get("unread_only") == "true"

	items, err := h.notifications.ListByUser(r.Context(), claims.UserID, unreadOnly)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list notifications")
		return
	}
	if items == nil {
		items = []*models.Notification{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// PATCH /notifications/{id}/read
func (h *NotificationHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "no auth context")
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}

	if err := h.notifications.MarkRead(r.Context(), id, claims.UserID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "notification not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to mark as read")
		return
	}
	w.WriteHeader(http.StatusOK)
}

// GET /notifications/settings
func (h *NotificationHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "no auth context")
		return
	}
	s, err := h.settings.GetOrDefault(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to load settings")
		return
	}
	writeJSON(w, http.StatusOK, s)
}

type updateSettingsRequest struct {
	EmailEnabled       bool   `json:"email_enabled"`
	MaxEnabled         bool   `json:"max_enabled"`
	TelegramEnabled    bool   `json:"telegram_enabled"`
	WhatsAppEnabled    bool   `json:"whatsapp_enabled"`
	PreferredMessenger string `json:"preferred_messenger"`
}

// PATCH /notifications/settings
func (h *NotificationHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "no auth context")
		return
	}
	var req updateSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid body")
		return
	}

	updated, err := h.settings.Upsert(r.Context(), &models.Settings{
		UserID:             claims.UserID,
		EmailEnabled:       req.EmailEnabled,
		MaxEnabled:         req.MaxEnabled,
		TelegramEnabled:    req.TelegramEnabled,
		WhatsAppEnabled:    req.WhatsAppEnabled,
		PreferredMessenger: req.PreferredMessenger,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to update settings")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// GET /notifications/telegram/status
func (h *NotificationHandler) GetTelegramStatus(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "no auth context")
		return
	}

	tu, err := h.telegramUser.GetByUserID(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check telegram status")
		return
	}

	if tu != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"connected":      true,
			"telegram_chat_id": tu.TelegramChatID,
			"telegram_username": tu.TelegramUsername,
		})
	} else {
		writeJSON(w, http.StatusOK, map[string]any{
			"connected": false,
		})
	}
}
