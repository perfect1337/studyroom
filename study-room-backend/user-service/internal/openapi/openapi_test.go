package openapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSpecHandler_ReturnsOpenAPISpec(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/openapi.yaml", nil)
	SpecHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "openapi: 3.0.3") {
		t.Fatal("expected OpenAPI spec content")
	}
	if got := rr.Header().Get("Content-Type"); !strings.Contains(got, "application/x-yaml") {
		t.Fatalf("expected YAML content type, got %q", got)
	}
}

func TestDocsHandler_ReturnsSwaggerUIPage(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/docs", nil)
	DocsHandler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "SwaggerUIBundle") {
		t.Fatal("expected swagger UI page")
	}
	if got := rr.Header().Get("Content-Type"); !strings.Contains(got, "text/html") {
		t.Fatalf("expected HTML content type, got %q", got)
	}
}
