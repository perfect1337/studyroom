package middleware

import (
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequestIDMiddleware_SetsHeaderWhenMissing(t *testing.T) {
	h := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rr, req)

	if got := rr.Header().Get(RequestIDHeader); got == "" {
		t.Fatalf("expected %s header to be set", RequestIDHeader)
	}
}

func TestRequestIDMiddleware_PreservesExistingID(t *testing.T) {
	expected := "test-request-id"
	h := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Context().Value(requestIDKey(RequestIDHeader)); got != expected {
			t.Fatalf("expected request id in context to be %q, got %v", expected, got)
		}
		w.WriteHeader(http.StatusOK)
	}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(RequestIDHeader, expected)
	h.ServeHTTP(rr, req)

	if got := rr.Header().Get(RequestIDHeader); got != expected {
		t.Fatalf("expected %s header to be preserved, got %q", RequestIDHeader, got)
	}
}

func TestLoggingMiddleware_EmitsStructuredLog(t *testing.T) {
	var output string
	LogOutput = func(line string) {
		output = line
	}
	defer func() { LogOutput = func(line string) { log.Println(line) } }()

	h := RequestID(Logging(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		w.Write([]byte("ok"))
	})))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/crm/applications", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusTeapot {
		t.Fatalf("expected status %d, got %d", http.StatusTeapot, rr.Code)
	}
	if !strings.Contains(output, `"status":418`) {
		t.Fatalf("expected log output to contain status 418, got %q", output)
	}
	if !strings.Contains(output, `"request_id"`) {
		t.Fatalf("expected log output to contain request_id, got %q", output)
	}
}
