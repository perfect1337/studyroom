package middleware

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"

	"studyroom/notification-service/internal/auth"
)

type ctxKey string

const claimsKey ctxKey = "claims"

// RequireAuth проверяет подпись пользовательского JWT (тот же секрет, что
// в User Service) и кладёт claims в контекст запроса.
func RequireAuth(tm *auth.TokenManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if !strings.HasPrefix(header, "Bearer ") {
				writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing bearer token")
				return
			}
			tokenStr := strings.TrimPrefix(header, "Bearer ")

			claims, err := tm.ParseAccessToken(tokenStr)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid or expired token")
				return
			}

			ctx := context.WithValue(r.Context(), claimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireServiceToken защищает /internal/* эндпоинты — их вызывают только
// другие сервисы (например Contracts Service по событию contract.expiring_soon),
// а не пользователи через фронт. Токен передаётся в заголовке
// X-Service-Token и сравнивается constant-time, чтобы не давать возможности
// подобрать секрет по времени ответа.
func RequireServiceToken(expected string) func(http.Handler) http.Handler {
	expectedBytes := []byte(expected)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got := r.Header.Get("X-Service-Token")
			if got == "" || subtle.ConstantTimeCompare([]byte(got), expectedBytes) != 1 {
				writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid service token")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func FromContext(ctx context.Context) (*auth.Claims, bool) {
	claims, ok := ctx.Value(claimsKey).(*auth.Claims)
	return claims, ok
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write([]byte(`{"error":{"code":"` + code + `","message":"` + message + `"}}`))
}
