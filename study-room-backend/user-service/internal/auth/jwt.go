package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"studyroom/user-service/internal/models"
)

// Claims — то, что "видят" остальные сервисы, проверяя токен локально.
// Именно role и branch_id используются в матрице прав из ТЗ.
type Claims struct {
	UserID   int64       `json:"user_id"`
	Role     models.Role `json:"role"`
	BranchID *int64      `json:"branch_id"`
	jwt.RegisteredClaims
}

type TokenManager struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewTokenManager(secret string, accessMinutes, refreshDays int) *TokenManager {
	return &TokenManager{
		secret:     []byte(secret),
		accessTTL:  time.Duration(accessMinutes) * time.Minute,
		refreshTTL: time.Duration(refreshDays) * 24 * time.Hour,
	}
}

func (tm *TokenManager) GenerateAccessToken(u *models.User) (string, error) {
	claims := Claims{
		UserID:   u.ID,
		Role:     u.Role,
		BranchID: u.BranchID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(tm.accessTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Subject:   "access",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(tm.secret)
}

// GenerateRefreshToken — непрозрачная случайная строка, а не JWT: хранится
// в БД как хеш (refresh_tokens.token_hash), чтобы его можно было отозвать.
func (tm *TokenManager) RefreshTokenExpiry() time.Time {
	return time.Now().Add(tm.refreshTTL)
}

func (tm *TokenManager) ParseAccessToken(tokenStr string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return tm.secret, nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
