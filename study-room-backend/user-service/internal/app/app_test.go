package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestResolveRateLimit_DefaultsAreIndependent — регрессия на общий бюджет
// login/refresh/register: login должен по умолчанию получать заметно более
// строгий лимит, чем refresh, даже если явно не сконфигурирован ни один из
// них (Deps.*RateLimit == 0, "не задано").
func TestResolveRateLimit_DefaultsAreIndependent(t *testing.T) {
	auth := resolveRateLimit(0, defaultAuthRateLimit)
	login := resolveRateLimit(0, defaultLoginRateLimit)
	refresh := resolveRateLimit(0, defaultRefreshRateLimit)

	if login >= auth {
		t.Fatalf("expected default login rate limit (%d) to be stricter than auth default (%d)", login, auth)
	}
	if refresh <= auth {
		t.Fatalf("expected default refresh rate limit (%d) to be more generous than auth default (%d)", refresh, auth)
	}
}

// TestResolveRateLimit_ExplicitValueWins — явно заданное (>0) значение
// должно побеждать дефолт вне зависимости от того, каким был fallback.
func TestResolveRateLimit_ExplicitValueWins(t *testing.T) {
	if got := resolveRateLimit(42, defaultLoginRateLimit); got != 42 {
		t.Fatalf("expected explicit value 42 to win over default, got %d", got)
	}
	if got := resolveRateLimit(-1, defaultLoginRateLimit); got != defaultLoginRateLimit {
		t.Fatalf("expected negative value to fall back to default %d, got %d", defaultLoginRateLimit, got)
	}
}

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
