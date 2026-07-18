package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"studyroom/notification-service/internal/auth"
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

func signToken(t *testing.T, secret string, userID int64) string {
	t.Helper()
	claims := auth.Claims{UserID: userID}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return tok
}

// TestRequireAuth_MissingHeader — без Authorization: Bearer — 401 UNAUTHORIZED.
func TestRequireAuth_MissingHeader(t *testing.T) {
	tm := auth.NewTokenManager("secret")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/v1/notifications", nil)
	RequireAuth(tm)(okHandler()).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=401", rr.Code)
	}
	if code := errorCode(t, rr.Body.Bytes()); code != "UNAUTHORIZED" {
		t.Fatalf("error code=%q want=UNAUTHORIZED", code)
	}
}

// TestRequireAuth_ValidToken — валидный токен, подписанный тем же секретом,
// что и в User Service, пропускает запрос и кладёт claims в контекст.
func TestRequireAuth_ValidToken(t *testing.T) {
	tm := auth.NewTokenManager("secret")
	tok := signToken(t, "secret", 55)

	var gotOK bool
	var gotUserID int64
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := FromContext(r.Context())
		gotOK = ok
		if ok {
			gotUserID = claims.UserID
		}
		w.WriteHeader(http.StatusOK)
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/v1/notifications", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	RequireAuth(tm)(next).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200", rr.Code)
	}
	if !gotOK || gotUserID != 55 {
		t.Fatalf("expected claims with user_id=55 in context, ok=%v id=%d", gotOK, gotUserID)
	}
}

// TestRequireAuth_WrongSecret — токен, подписанный не тем секретом
// (например протухший общий секрет между сервисами), отклоняется.
func TestRequireAuth_WrongSecret(t *testing.T) {
	tm := auth.NewTokenManager("secret")
	tok := signToken(t, "some-other-secret", 55)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/v1/notifications", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	RequireAuth(tm)(okHandler()).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=401", rr.Code)
	}
}

// TestRequireServiceToken_Valid — корректный X-Service-Token пропускает запрос.
// Эти internal-эндпоинты вызываются другими сервисами (например при
// contract.expiring_soon), а не пользователями через фронт.
func TestRequireServiceToken_Valid(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/internal/notifications/send", nil)
	req.Header.Set("X-Service-Token", "correct-token")
	RequireServiceToken("correct-token")(okHandler()).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200", rr.Code)
	}
}

// TestRequireServiceToken_Missing — отсутствующий заголовок — 401.
func TestRequireServiceToken_Missing(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/internal/notifications/send", nil)
	RequireServiceToken("correct-token")(okHandler()).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=401", rr.Code)
	}
	if code := errorCode(t, rr.Body.Bytes()); code != "UNAUTHORIZED" {
		t.Fatalf("error code=%q want=UNAUTHORIZED", code)
	}
}

// TestRequireServiceToken_Wrong — неверный токен тоже 401, а обёрнутый
// handler не должен вызываться.
func TestRequireServiceToken_Wrong(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/internal/notifications/send", nil)
	req.Header.Set("X-Service-Token", "wrong-token")
	RequireServiceToken("correct-token")(next).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=401", rr.Code)
	}
	if called {
		t.Fatal("next handler must not be called with a wrong service token")
	}
}

// TestRequireServiceToken_EmptyExpected — граничный случай конфигурации:
// если ожидаемый токен пустой (сервис не настроен), пустой заголовок
// всё равно не должен проходить проверку.
func TestRequireServiceToken_EmptyExpected(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/internal/notifications/send", nil)
	RequireServiceToken("")(okHandler()).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=401 even when expected token is empty", rr.Code)
	}
}

// TestFromContext_Absent — без RequireAuth в цепочке FromContext должен
// вернуть ok=false, а не панику.
func TestFromContext_Absent(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/v1/notifications", nil)
	claims, ok := FromContext(req.Context())
	if ok || claims != nil {
		t.Fatalf("expected no claims in bare context, got claims=%v ok=%v", claims, ok)
	}
}
