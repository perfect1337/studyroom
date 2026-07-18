// Package auth — проверка JWT, выпущенного User Service. Notification Service
// не выпускает токены сам, только проверяет подпись локально по общему секрету
// (JWT_SECRET), как и остальные сервисы (см. п. 2.2 microservices-plan.md).
package auth

import (
	"errors"

	"github.com/golang-jwt/jwt/v5"
)

// Claims — минимальный набор полей, которые нужны Notification Service:
// для собственных уведомлений/настроек достаточно user_id, роль не проверяется.
type Claims struct {
	UserID int64 `json:"user_id"`
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
