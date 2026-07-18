package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"studyroom/user-service/internal/auth"
	"studyroom/user-service/internal/models"
	"studyroom/user-service/internal/repository"
)

type AuthHandler struct {
	users *repository.UserRepository
	authRepo *repository.AuthRepository
	tm    *auth.TokenManager
}

func NewAuthHandler(users *repository.UserRepository, authRepo *repository.AuthRepository, tm *auth.TokenManager) *AuthHandler {
	return &AuthHandler{users: users, authRepo: authRepo, tm: tm}
}

// --- 1.1. POST /auth/register ---
type registerRequest struct {
	Email      string  `json:"email"`
	Phone      *string `json:"phone"`
	Password   string  `json:"password"`
	LastName   string  `json:"last_name"`
	FirstName  string  `json:"first_name"`
	Patronymic *string `json:"patronymic"`
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}
	if req.Email == "" || len(req.Password) < 8 || req.LastName == "" || req.FirstName == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "email, password (min 8 chars), last_name, first_name required")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "hashing failed")
		return
	}

	// Самостоятельная регистрация всегда создаёт роль parent — см. контракт 1.1
	u := &models.User{
		Email: req.Email, Phone: req.Phone, PasswordHash: hash,
		Role: models.RoleParent, LastName: req.LastName, FirstName: req.FirstName,
		Patronymic: req.Patronymic, IsActive: true,
	}

	created, err := h.users.Create(r.Context(), u)
	if err != nil {
		if errors.Is(err, repository.ErrDuplicate) {
			writeError(w, http.StatusConflict, "ALREADY_EXISTS", "email or phone already registered")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL", "could not create user")
		return
	}

	h.issueTokenPair(w, r, created)

	// TODO: опубликовать событие user.created в брокер — Notification Service
	// пришлёт приветственное письмо, Academic/Contracts/CRM обновят user_refs.
}

// --- 1.2. POST /auth/login ---
type loginRequest struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}

	u, err := h.users.GetByLogin(r.Context(), req.Login)
	if err != nil {
		// Намеренно одинаковая ошибка что для "нет юзера", что для "неверный пароль" —
		// иначе через код ответа можно перебором узнавать, какие email зарегистрированы.
		writeError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid login or password")
		return
	}
	if !auth.CheckPassword(req.Password, u.PasswordHash) {
		writeError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid login or password")
		return
	}
	if !u.IsActive {
		writeError(w, http.StatusForbidden, "ACCOUNT_DISABLED", "account is deactivated")
		return
	}

	h.issueTokenPair(w, r, u)
}

// --- 1.3. POST /auth/refresh ---
type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid body")
		return
	}

	hash := auth.HashToken(req.RefreshToken)
	userID, err := h.authRepo.FindUserIDByRefreshToken(r.Context(), hash)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "INVALID_TOKEN", "refresh token invalid or expired")
		return
	}

	u, err := h.users.GetByID(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "INVALID_TOKEN", "user not found")
		return
	}

	// Ротация: старый refresh-токен гасим, выдаём новую пару.
	_ = h.authRepo.RevokeRefreshToken(r.Context(), hash)
	h.issueTokenPair(w, r, u)
}

// issueTokenPair — общая логика выдачи access+refresh, используется в register/login/refresh.
func (h *AuthHandler) issueTokenPair(w http.ResponseWriter, r *http.Request, u *models.User) {
	access, err := h.tm.GenerateAccessToken(u)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "token generation failed")
		return
	}

	refreshPlain, err := auth.GenerateOpaqueToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "token generation failed")
		return
	}
	if err := h.authRepo.SaveRefreshToken(r.Context(), u.ID, auth.HashToken(refreshPlain), h.tm.RefreshTokenExpiry()); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "could not persist refresh token")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"access_token":  access,
		"refresh_token": refreshPlain,
		"user": map[string]any{
			"id": u.ID, "role": u.Role, "first_name": u.FirstName, "last_name": u.LastName,
		},
	})
}

// --- 1.4. POST /auth/forgot-password ---
type forgotPasswordRequest struct {
	Email string `json:"email"`
}

func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req forgotPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "email required")
		return
	}

	// Всегда 200, даже если email не найден — иначе через код ответа можно
	// перебором узнавать, какие адреса зарегистрированы (см. контракт 1.4).
	u, err := h.users.GetByLogin(r.Context(), req.Email)
	if err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	resetPlain, err := auth.GenerateOpaqueToken()
	if err != nil {
		w.WriteHeader(http.StatusOK) // не палим внутреннюю ошибку через код ответа
		return
	}
	expiresAt := time.Now().Add(1 * time.Hour)
	if err := h.authRepo.SavePasswordResetToken(r.Context(), u.ID, auth.HashToken(resetPlain), expiresAt); err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	// TODO: заменить на публикацию события password_reset_requested в NATS,
	// как только появится Notification Service — он отправит письмо со ссылкой
	// вида https://app.studyroom.ru/reset-password?token=<resetPlain>.
	// Пока — просто лог на сервере, чтобы можно было тестировать флоу руками.
	log.Printf("[DEV] password reset token for %s: %s (expires %s)", u.Email, resetPlain, expiresAt.Format(time.RFC3339))

	w.WriteHeader(http.StatusOK)
}

// --- 1.5. POST /auth/reset-password ---
type resetPasswordRequest struct {
	ResetToken  string `json:"reset_token"`
	NewPassword string `json:"new_password"`
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req resetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "reset_token and new_password (min 8 chars) required")
		return
	}

	tokenHash := auth.HashToken(req.ResetToken)
	userID, err := h.authRepo.FindValidPasswordResetToken(r.Context(), tokenHash)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_TOKEN", "reset token is invalid, expired or already used")
		return
	}

	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "hashing failed")
		return
	}
	if _, err := h.users.Update(r.Context(), userID, map[string]any{"password_hash": newHash}); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
		return
	}

	// Токен одноразовый — гасим сразу после использования.
	_ = h.authRepo.MarkPasswordResetTokenUsed(r.Context(), tokenHash)

	w.WriteHeader(http.StatusOK)
}
