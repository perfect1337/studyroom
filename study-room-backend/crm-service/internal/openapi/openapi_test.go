package openapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSpecHandler_ReturnsOpenAPISpec(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/openapi.yaml", nil)

	SpecHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200 for /openapi.yaml, got %d", rr.Code)
	}
	if got := rr.Header().Get("Content-Type"); got != "application/x-yaml" {
		t.Fatalf("expected application/x-yaml content type, got %q", got)
	}
}

func TestDocsHandler_ReturnsSwaggerUIPage(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/docs", nil)

	DocsHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200 for /docs, got %d", rr.Code)
	}
	if got := rr.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Fatalf("expected text/html content type, got %q", got)
	}
}
