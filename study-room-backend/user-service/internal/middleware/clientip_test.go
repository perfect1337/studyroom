package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func withRemoteAddr(req *http.Request, addr string) *http.Request {
	req.RemoteAddr = addr
	return req
}

func TestClientIP_NoTrustedProxies_IgnoresXFF(t *testing.T) {
	// По умолчанию (SetTrustedProxies не вызывался/пустой список) сервис
	// доступен напрямую — X-Forwarded-For от клиента не должен влиять
	// на определяемый IP, иначе rate limit тривиально обходится.
	SetTrustedProxies(nil)

	req := withRemoteAddr(httptest.NewRequest("GET", "/", nil), "203.0.113.9:54321")
	req.Header.Set("X-Forwarded-For", "1.2.3.4")

	got := clientIP(req)
	if got != "203.0.113.9" {
		t.Fatalf("expected raw TCP peer IP to be used, got %q", got)
	}
}

func TestClientIP_UntrustedPeer_IgnoresXFF(t *testing.T) {
	tp, err := ParseTrustedProxies("10.0.0.0/8")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	SetTrustedProxies(tp)
	defer SetTrustedProxies(nil)

	// Пир НЕ входит в доверенную сеть -> запрос пришёл напрямую от клиента,
	// который может вписать в XFF что угодно. Должен быть проигнорирован.
	req := withRemoteAddr(httptest.NewRequest("GET", "/", nil), "203.0.113.9:54321")
	req.Header.Set("X-Forwarded-For", "9.9.9.9")

	got := clientIP(req)
	if got != "203.0.113.9" {
		t.Fatalf("expected XFF from untrusted peer to be ignored, got %q", got)
	}
}

func TestClientIP_TrustedPeer_UsesRightmostUntrustedHop(t *testing.T) {
	tp, err := ParseTrustedProxies("10.0.0.0/8")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	SetTrustedProxies(tp)
	defer SetTrustedProxies(nil)

	// Пир — доверенный ingress (10.x.x.x). Цепочка XFF: "клиент, доверенный_хоп".
	req := withRemoteAddr(httptest.NewRequest("GET", "/", nil), "10.0.0.5:443")
	req.Header.Set("X-Forwarded-For", "198.51.100.7, 10.0.0.5")

	got := clientIP(req)
	if got != "198.51.100.7" {
		t.Fatalf("expected real client IP from XFF chain, got %q", got)
	}
}

func TestClientIP_TrustedPeer_SpoofedLeadingHopStillResolved(t *testing.T) {
	tp, err := ParseTrustedProxies("10.0.0.0/8")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	SetTrustedProxies(tp)
	defer SetTrustedProxies(nil)

	// Клиент пытается подделать несколько IP слева, но реальный прокси все
	// равно добавляет своё значение последним хопом — берём его сосед справа.
	req := withRemoteAddr(httptest.NewRequest("GET", "/", nil), "10.0.0.5:443")
	req.Header.Set("X-Forwarded-For", "6.6.6.6, 7.7.7.7, 203.0.113.50, 10.0.0.5")

	got := clientIP(req)
	if got != "203.0.113.50" {
		t.Fatalf("expected the hop just before the trusted proxy, got %q", got)
	}
}

func TestClientIP_TrustedPeer_NoXFF_FallsBackToPeer(t *testing.T) {
	tp, err := ParseTrustedProxies("10.0.0.0/8")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	SetTrustedProxies(tp)
	defer SetTrustedProxies(nil)

	req := withRemoteAddr(httptest.NewRequest("GET", "/", nil), "10.0.0.5:443")

	got := clientIP(req)
	if got != "10.0.0.5" {
		t.Fatalf("expected fallback to peer IP, got %q", got)
	}
}

func TestParseTrustedProxies_InvalidCIDR(t *testing.T) {
	if _, err := ParseTrustedProxies("not-a-cidr/xyz"); err == nil {
		t.Fatal("expected error for invalid CIDR")
	}
}

func TestParseTrustedProxies_Empty(t *testing.T) {
	tp, err := ParseTrustedProxies("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if tp.trusts("1.2.3.4") {
		t.Fatal("empty trusted proxies list must trust nothing")
	}
}
