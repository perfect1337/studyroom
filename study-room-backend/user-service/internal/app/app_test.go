package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRouter_ExposesOpenAPIDocs(t *testing.T) {
	router := NewRouter(&Deps{AppPublicURL: ""})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/openapi.yaml", nil)
	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/docs", nil)
	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200 for /docs, got %d", rr.Code)
	}
}
