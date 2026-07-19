// Package auth — проверка JWT, выпущенного User Service. Academic Service
// не выпускает токены сам, только проверяет подпись локально по общему
// секрету (JWT_SECRET) — см. п. 2.2 microservices-plan.md. В отличие от
// Notification Service, Academic Service нужны role и branch_id из токена:
// вся матрица прав (owner/branch_owner/tutor/parent/student, см. 2.6
// microservices-plan.md) проверяется на их основе локально, без похода
// в User Service на каждый запрос.
package auth

import (
	"errors"

	"github.com/golang-jwt/jwt/v5"
	"studyroom/academic-service/internal/models"
)

type Claims struct {
	UserID   int64       `json:"user_id"`
	Role     models.Role `json:"role"`
	BranchID *int64      `json:"branch_id"`
	jwt.RegisteredClaims
}

type TokenManager struct {
	secret []byte
}

func NewTokenManager(secret string) *TokenManager {
	return &TokenManager{secret: []byte(secret)}
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
