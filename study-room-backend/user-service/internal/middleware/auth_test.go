package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"studyroom/user-service/internal/auth"
	"studyroom/user-service/internal/models"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func errorCode(t *testing.T, body []byte) string {
	t.Helper()
	var v struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("unmarshal error body: %v (%s)", err, body)
	}
	return v.Error.Code
}

// TestRequireAuth_MissingHeader — без Authorization должен быть 401 UNAUTHORIZED,
// а обёрнутый handler не должен вызываться.
func TestRequireAuth_MissingHeader(t *testing.T) {
	tm := auth.NewTokenManager("secret", 15, 30)
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/anything", nil)
	RequireAuth(tm)(next).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=401", rr.Code)
	}
	if called {
		t.Fatal("next handler must not be called without auth")
	}
	if code := errorCode(t, rr.Body.Bytes()); code != "UNAUTHORIZED" {
		t.Fatalf("error code=%q want=UNAUTHORIZED", code)
	}
}

// TestRequireAuth_MalformedHeader — заголовок без префикса "Bearer " тоже 401.
func TestRequireAuth_MalformedHeader(t *testing.T) {
	tm := auth.NewTokenManager("secret", 15, 30)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/anything", nil)
	req.Header.Set("Authorization", "Basic dXNlcjpwYXNz")
	RequireAuth(tm)(okHandler()).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=401", rr.Code)
	}
}

// TestRequireAuth_InvalidToken — синтаксически верный Bearer-заголовок,
// но токен не парсится (например подписан другим секретом) → 401.
func TestRequireAuth_InvalidToken(t *testing.T) {
	tm := auth.NewTokenManager("secret", 15, 30)
	other := auth.NewTokenManager("other-secret", 15, 30)
	tok, err := other.GenerateAccessToken(&models.User{ID: 1, Role: models.RoleParent})
	if err != nil {
		t.Fatalf("GenerateAccessToken: %v", err)
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/anything", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	RequireAuth(tm)(okHandler()).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=401", rr.Code)
	}
}

// TestRequireAuth_ValidToken — валидный токен пропускает запрос дальше и
// кладёт claims в контекст, доступные через FromContext.
func TestRequireAuth_ValidToken(t *testing.T) {
	tm := auth.NewTokenManager("secret", 15, 30)
	branchID := int64(3)
	u := &models.User{ID: 99, Role: models.RoleTutor, BranchID: &branchID}
	tok, err := tm.GenerateAccessToken(u)
	if err != nil {
		t.Fatalf("GenerateAccessToken: %v", err)
	}

	var gotClaims *auth.Claims
	var gotOK bool
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotClaims, gotOK = FromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/anything", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	RequireAuth(tm)(next).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200", rr.Code)
	}
	if !gotOK || gotClaims == nil {
		t.Fatal("expected claims in context")
	}
	if gotClaims.UserID != u.ID || gotClaims.Role != u.Role {
		t.Fatalf("claims=%+v", gotClaims)
	}
}

// TestFromContext_Absent — если middleware не отработал, FromContext
// должен вернуть ok=false, а не панику или нулевой указатель без проверки.
func TestFromContext_Absent(t *testing.T) {
	req := httptest.NewRequest("GET", "/anything", nil)
	claims, ok := FromContext(req.Context())
	if ok || claims != nil {
		t.Fatalf("expected no claims in bare context, got claims=%v ok=%v", claims, ok)
	}
}

// TestRequireRoles_Allowed — роль из списка разрешённых пропускается дальше.
func TestRequireRoles_Allowed(t *testing.T) {
	tm := auth.NewTokenManager("secret", 15, 30)
	u := &models.User{ID: 1, Role: models.RoleOwner}
	tok, err := tm.GenerateAccessToken(u)
	if err != nil {
		t.Fatalf("GenerateAccessToken: %v", err)
	}

	handler := RequireAuth(tm)(RequireRoles(models.RoleOwner, models.RoleBranchOwner)(okHandler()))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/anything", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200", rr.Code)
	}
}

// TestRequireRoles_Forbidden — роль не входит в список разрешённых → 403 FORBIDDEN.
func TestRequireRoles_Forbidden(t *testing.T) {
	tm := auth.NewTokenManager("secret", 15, 30)
	u := &models.User{ID: 1, Role: models.RoleStudent}
	tok, err := tm.GenerateAccessToken(u)
	if err != nil {
		t.Fatalf("GenerateAccessToken: %v", err)
	}

	handler := RequireAuth(tm)(RequireRoles(models.RoleOwner)(okHandler()))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/anything", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status=%d want=403", rr.Code)
	}
	if code := errorCode(t, rr.Body.Bytes()); code != "FORBIDDEN" {
		t.Fatalf("error code=%q want=FORBIDDEN", code)
	}
}

// TestRequireRoles_NoAuthContext — если RequireRoles вызван без предшествующего
// RequireAuth (нет claims в контексте), это тоже должно быть безопасно
// обработано как 401, а не паника на нулевом указателе.
func TestRequireRoles_NoAuthContext(t *testing.T) {
	handler := RequireRoles(models.RoleOwner)(okHandler())
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/anything", nil)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=401", rr.Code)
	}
}

func TestRequestIDMiddleware_SetsHeader(t *testing.T) {
	handler := RequestID(okHandler())
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/anything", nil)
	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get(RequestIDHeader); got == "" {
		t.Fatal("expected X-Request-ID header to be set")
	}
}

func TestRequestIDMiddleware_PreservesHeader(t *testing.T) {
	const customID = "custom-request-id"
	handler := RequestID(okHandler())
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/anything", nil)
	req.Header.Set(RequestIDHeader, customID)
	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get(RequestIDHeader); got != customID {
		t.Fatalf("expected X-Request-ID=%q, got=%q", customID, got)
	}
}

func TestRateLimitMiddleware_LimitsByIP(t *testing.T) {
	limiter := NewIPRateLimiter(2, time.Minute)
	handler := RateLimit(limiter)(okHandler())
	for i := 1; i <= 2; i++ {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/auth/login", nil)
		req.RemoteAddr = "192.0.2.1:1234"
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("request %d: expected status 200, got %d", i, rr.Code)
		}
		if got := rr.Header().Get("X-RateLimit-Remaining"); got != strconv.Itoa(2-i) {
			t.Fatalf("request %d: expected X-RateLimit-Remaining=%d, got=%q", i, 2-i, got)
		}
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/auth/login", nil)
	req.RemoteAddr = "192.0.2.1:1234"
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("expected status 429 after limit exceeded, got %d", rr.Code)
	}
	if got := rr.Header().Get("Retry-After"); got != "60" {
		t.Fatalf("expected Retry-After=60, got=%q", got)
	}
}
