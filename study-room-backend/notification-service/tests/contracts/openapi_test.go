package contracts_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAPIDocs_Available(t *testing.T) {
	e := getEnv(t)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/openapi.yaml", nil)
	e.router.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200 for /openapi.yaml, got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/docs", nil)
	e.router.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200 for /docs, got %d", rr.Code)
	}
}
