package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func corsOkHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

// TestCORS_UnknownOrigin_NoCredentialHeaders — регрессия на reflect-any-origin:
// для origin'а, которого нет в allowlist, ответ не должен содержать
// Access-Control-Allow-Origin/Allow-Credentials — иначе браузер разрешит
// странице с этого origin читать ответ с credentials.
func TestCORS_UnknownOrigin_NoCredentialHeaders(t *testing.T) {
	SetAllowedOrigins(ParseAllowedOrigins("https://studyroom.example.com"))
	defer SetAllowedOrigins(nil)

	handler := CORS(corsOkHandler())
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected no Access-Control-Allow-Origin for disallowed origin, got %q", got)
	}
	if got := rr.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("expected no Access-Control-Allow-Credentials for disallowed origin, got %q", got)
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("expected request to still reach the handler (200), got %d", rr.Code)
	}
}

// TestCORS_AllowedOrigin_ReflectsOriginWithCredentials — origin из allowlist
// по-прежнему получает рабочий CORS с credentials, как и раньше.
func TestCORS_AllowedOrigin_ReflectsOriginWithCredentials(t *testing.T) {
	SetAllowedOrigins(ParseAllowedOrigins("https://studyroom.example.com, http://localhost:5173"))
	defer SetAllowedOrigins(nil)

	handler := CORS(corsOkHandler())
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("expected Access-Control-Allow-Origin=http://localhost:5173, got %q", got)
	}
	if got := rr.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("expected Access-Control-Allow-Credentials=true, got %q", got)
	}
}

// TestCORS_NoAllowlistConfigured_FailsClosed — пустой/не заданный allowlist
// (дефолт) должен блокировать credentialed cross-origin запросы для всех
// origin'ов, а не пропускать их как раньше.
func TestCORS_NoAllowlistConfigured_FailsClosed(t *testing.T) {
	SetAllowedOrigins(nil)
	defer SetAllowedOrigins(nil)

	handler := CORS(corsOkHandler())
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://studyroom.example.com")
	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected fail-closed default (no allowlist) to omit Access-Control-Allow-Origin, got %q", got)
	}
}

// TestCORS_Preflight_StillRespondsNoContent — OPTIONS preflight по-прежнему
// коротко отвечает 204 (сами заголовки методов/headers не зависят от origin).
func TestCORS_Preflight_StillRespondsNoContent(t *testing.T) {
	SetAllowedOrigins(ParseAllowedOrigins("https://studyroom.example.com"))
	defer SetAllowedOrigins(nil)

	handler := CORS(corsOkHandler())
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/anything", nil)
	req.Header.Set("Origin", "https://studyroom.example.com")
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for OPTIONS preflight, got %d", rr.Code)
	}
	if got := rr.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Fatal("expected Access-Control-Allow-Methods to be set on preflight")
	}
}
