package middleware

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLoggingMiddleware_EmitsJSON(t *testing.T) {
	var buf bytes.Buffer
	origOutput := log.Writer()
	origFlags := log.Flags()
	origPrefix := log.Prefix()
	log.SetOutput(&buf)
	log.SetFlags(0)
	log.SetPrefix("")
	defer func() {
		log.SetOutput(origOutput)
		log.SetFlags(origFlags)
		log.SetPrefix(origPrefix)
	}()

	handler := RequestID(Logging(okHandler()))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz?test=1", nil)
	req.RemoteAddr = "203.0.113.5:12345"
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	line := bytes.TrimSpace(buf.Bytes())
	var entry map[string]any
	if err := json.Unmarshal(line, &entry); err != nil {
		t.Fatalf("expected JSON log entry, got error: %v", err)
	}
	if entry["path"] != "/healthz" {
		t.Fatalf("expected path /healthz, got %v", entry["path"])
	}
	if entry["status"] != float64(http.StatusOK) {
		t.Fatalf("expected status 200, got %v", entry["status"])
	}
	if entry["request_id"] == "" {
		t.Fatal("expected request_id in log entry")
	}
}
