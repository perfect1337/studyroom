package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"studyroom/notification-service/internal/middleware"
	"studyroom/notification-service/internal/models"
	"studyroom/notification-service/internal/repository"
)

type NotificationHandler struct {
	notifications *repository.NotificationRepository
	settings      *repository.SettingsRepository
	telegramUser  *repository.TelegramUserRepository
	maxUser       *repository.MaxUserRepository
	usersRef      *repository.UserRefRepository
}

func NewNotificationHandler(
	notifications *repository.NotificationRepository,
	settings *repository.SettingsRepository,
	telegramUser *repository.TelegramUserRepository,
	maxUser *repository.MaxUserRepository,
	usersRef *repository.UserRefRepository,
) *NotificationHandler {
	return &NotificationHandler{notifications: notifications, settings: settings, telegramUser: telegramUser, maxUser: maxUser, usersRef: usersRef}
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
			"connected":         true,
			"telegram_chat_id":  tu.TelegramChatID,
			"telegram_username": tu.TelegramUsername,
		})
	} else {
		writeJSON(w, http.StatusOK, map[string]any{
			"connected": false,
		})
	}
}

// DELETE /notifications/telegram/link — отвязка Telegram от аккаунта.
// Раньше такого эндпоинта не было вовсе: единственный способ отвязать бота
// был выключить его вручную в самом Telegram (заблокировать/удалить чат),
// но даже это не удаляло запись telegram_users — просто отправка сообщений
// начинала молча падать. Теперь запись удаляется явно; заодно выключаем
// telegram_enabled в настройках, чтобы UI сразу показал состояние
// "не подключено" и не пытался слать в Telegram, пока пользователь не
// привяжет его заново.
func (h *NotificationHandler) UnlinkTelegram(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "no auth context")
		return
	}

	if _, err := h.telegramUser.DeleteByUserID(r.Context(), claims.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to unlink telegram")
		return
	}
	if err := h.usersRef.ClearTelegramID(r.Context(), claims.UserID); err != nil {
		// Отвязка в telegram_users уже прошла (это главное — бот больше не
		// пришлёт вам ничего) — сбой очистки локального кэша не должен
		// превращать это в ошибку всего запроса, но логируем.
		log.Printf("notifications: clear telegram_id for user %d failed: %v", claims.UserID, err)
	}

	current, err := h.settings.GetOrDefault(r.Context(), claims.UserID)
	if err == nil && current.TelegramEnabled {
		current.TelegramEnabled = false
		if current.PreferredMessenger == "telegram" {
			current.PreferredMessenger = ""
		}
		if _, err := h.settings.Upsert(r.Context(), current); err != nil {
			// Отвязка самого Telegram уже произошла (важнее) — сбой апдейта
			// настроек не должен превращать это в ошибку всего запроса.
			writeJSON(w, http.StatusOK, map[string]any{"connected": false})
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"connected": false})
}

// GET /notifications/max/status
func (h *NotificationHandler) GetMaxStatus(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "no auth context")
		return
	}

	mu, err := h.maxUser.GetByUserID(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to check max status")
		return
	}
	if mu == nil {
		writeJSON(w, http.StatusOK, map[string]any{"connected": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"connected":    true,
		"max_user_id":  mu.MaxUserID,
		"max_username": mu.MaxUsername,
	})
}

// DELETE /notifications/max/link — отвязка MAX от аккаунта.
func (h *NotificationHandler) UnlinkMax(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.FromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "no auth context")
		return
	}

	if _, err := h.maxUser.DeleteByUserID(r.Context(), claims.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to unlink max")
		return
	}
	if err := h.usersRef.ClearMaxID(r.Context(), claims.UserID); err != nil {
		log.Printf("notifications: clear max_id for user %d failed: %v", claims.UserID, err)
	}
	current, err := h.settings.GetOrDefault(r.Context(), claims.UserID)
	if err == nil && current.MaxEnabled {
		current.MaxEnabled = false
		if current.PreferredMessenger == "max" {
			current.PreferredMessenger = ""
		}
		if _, err := h.settings.Upsert(r.Context(), current); err != nil {
			log.Printf("notifications: disable max for user %d failed: %v", claims.UserID, err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"connected": false})
}
