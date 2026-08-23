package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"studyroom/notification-service/internal/middleware"
)

func TestRequestIDMiddleware_SetsHeaderWhenMissing(t *testing.T) {
	called := false
	handler := middleware.RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if id := w.Header().Get(middleware.RequestIDHeader); id == "" {
			t.Fatal("expected X-Request-ID header to be set")
		}
	}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	handler.ServeHTTP(rr, req)

	if !called {
		t.Fatal("expected handler to be called")
	}
	if got := rr.Header().Get(middleware.RequestIDHeader); got == "" {
		t.Fatal("expected response header X-Request-ID to be set")
	}
}

func TestRequestIDMiddleware_PreservesExistingID(t *testing.T) {
	const expected = "test-request-id"
	called := false
	handler := middleware.RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if got := r.Header.Get(middleware.RequestIDHeader); got != expected {
			t.Fatalf("expected request header preserved, got %q", got)
		}
	}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set(middleware.RequestIDHeader, expected)
	handler.ServeHTTP(rr, req)

	if !called {
		t.Fatal("expected handler to be called")
	}
	if got := rr.Header().Get(middleware.RequestIDHeader); got != expected {
		t.Fatalf("expected response header %q, got %q", expected, got)
	}
}

func TestLoggingMiddleware_EmitsJSONLog(t *testing.T) {
	var logged string
	oldLogger := middleware.LogOutput
	middleware.LogOutput = func(message string) {
		logged = message
	}
	defer func() {
		middleware.LogOutput = oldLogger
	}()

	handler := middleware.Logging(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/missing", nil)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", rr.Code)
	}
	if !strings.Contains(logged, `"path":"/missing"`) {
		t.Fatalf("expected logged JSON to contain path, got %s", logged)
	}
	if !strings.Contains(logged, `"status":404`) {
		t.Fatalf("expected logged JSON to contain status, got %s", logged)
	}
}
