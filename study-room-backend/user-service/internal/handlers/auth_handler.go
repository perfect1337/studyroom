package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"studyroom/user-service/internal/auth"
	"studyroom/user-service/internal/events"
	"studyroom/user-service/internal/models"
	"studyroom/user-service/internal/repository"
)

type AuthHandler struct {
	users        *repository.UserRepository
	authRepo     *repository.AuthRepository
	tm           *auth.TokenManager
	events       events.Publisher
	appPublicURL string
}

func NewAuthHandler(
	users *repository.UserRepository,
	authRepo *repository.AuthRepository,
	tm *auth.TokenManager,
	pub events.Publisher,
	appPublicURL string,
) *AuthHandler {
	if pub == nil {
		pub = events.NoopPublisher{}
	}
	return &AuthHandler{users: users, authRepo: authRepo, tm: tm, events: pub, appPublicURL: appPublicURL}
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

	h.events.UserCreated(created, "", "", nil)

	access, refresh, err := h.createTokenPair(r, created)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id": created.ID, "access_token": access, "refresh_token": refresh,
	})
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

	access, refresh, err := h.createTokenPair(r, u)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": access, "refresh_token": refresh,
		"user": map[string]any{
			"id": u.ID, "role": u.Role, "first_name": u.FirstName, "last_name": u.LastName,
		},
	})
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
	if !u.IsActive {
		_ = h.authRepo.RevokeAllRefreshTokens(r.Context(), u.ID)
		writeError(w, http.StatusForbidden, "ACCOUNT_DISABLED", "account is deactivated")
		return
	}

	_ = h.authRepo.RevokeRefreshToken(r.Context(), hash)
	access, refresh, err := h.createTokenPair(r, u)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": access, "refresh_token": refresh,
	})
}

func (h *AuthHandler) createTokenPair(r *http.Request, u *models.User) (access, refresh string, err error) {
	access, err = h.tm.GenerateAccessToken(u)
	if err != nil {
		return "", "", errors.New("token generation failed")
	}
	refreshPlain, err := auth.GenerateOpaqueToken()
	if err != nil {
		return "", "", errors.New("token generation failed")
	}
	if err := h.authRepo.SaveRefreshToken(r.Context(), u.ID, auth.HashToken(refreshPlain), h.tm.RefreshTokenExpiry()); err != nil {
		return "", "", errors.New("could not persist refresh token")
	}
	return access, refreshPlain, nil
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

	u, err := h.users.GetByLogin(r.Context(), req.Email)
	if err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	resetPlain, err := auth.GenerateOpaqueToken()
	if err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}
	expiresAt := time.Now().Add(1 * time.Hour)
	if err := h.authRepo.SavePasswordResetToken(r.Context(), u.ID, auth.HashToken(resetPlain), expiresAt); err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	base := strings.TrimRight(h.appPublicURL, "/")
	resetURL := base + "/reset-password?token=" + resetPlain
	h.events.PasswordResetRequested(u.ID, u.Email, resetPlain, resetURL, expiresAt)

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
	userID, err := h.authRepo.ConsumePasswordResetToken(r.Context(), tokenHash)
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
	_ = h.authRepo.RevokeAllRefreshTokens(r.Context(), userID)

	w.WriteHeader(http.StatusOK)
}
