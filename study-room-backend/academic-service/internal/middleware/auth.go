package middleware

import (
	"context"
	"net/http"
	"strings"

	"studyroom/academic-service/internal/auth"
	"studyroom/academic-service/internal/models"
)

type ctxKey string

const claimsKey ctxKey = "claims"

// RequireAuth проверяет подпись JWT (общий секрет с User Service) и кладёт
// claims в контекст запроса — тот же паттерн, что в user-service и
// notification-service (см. их internal/middleware).
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

// RequireRoles — 403, если роль вызывающего не входит в разрешённый список.
// Для более тонкой авторизации (например «branch_owner только своего
// филиала») проверка делается внутри самого хендлера — см. handlers/*.go.
func RequireRoles(roles ...models.Role) func(http.Handler) http.Handler {
	allowed := make(map[models.Role]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := FromContext(r.Context())
			if !ok {
				writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "no auth context")
				return
			}
			if !allowed[claims.Role] {
				writeError(w, http.StatusForbidden, "FORBIDDEN", "role not permitted for this action")
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
