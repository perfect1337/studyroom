package auth

import "testing"

// TestGenerateOpaqueToken_Format проверяет, что токен — это hex-строка
// ожидаемой длины (32 случайных байта → 64 hex-символа) и что повторные
// вызовы не повторяются.
func TestGenerateOpaqueToken_Format(t *testing.T) {
	tok, err := GenerateOpaqueToken()
	if err != nil {
		t.Fatalf("GenerateOpaqueToken: %v", err)
	}
	if len(tok) != 64 {
		t.Fatalf("expected 64 hex chars (32 bytes), got %d: %q", len(tok), tok)
	}
	for _, r := range tok {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			t.Fatalf("expected lowercase hex string, got char %q in %q", r, tok)
		}
	}

	tok2, err := GenerateOpaqueToken()
	if err != nil {
		t.Fatalf("GenerateOpaqueToken #2: %v", err)
	}
	if tok == tok2 {
		t.Fatal("expected two independently generated tokens to differ")
	}
}

// TestHashToken_Deterministic — HashToken должен быть чистой функцией:
// одинаковый вход → одинаковый выход, разный вход → разный выход.
func TestHashToken_Deterministic(t *testing.T) {
	h1 := HashToken("some-refresh-token")
	h2 := HashToken("some-refresh-token")
	if h1 != h2 {
		t.Fatal("expected HashToken to be deterministic for the same input")
	}
	if h1 == "some-refresh-token" {
		t.Fatal("hash must not equal the plaintext token")
	}

	h3 := HashToken("different-refresh-token")
	if h1 == h3 {
		t.Fatal("expected different inputs to produce different hashes")
	}
}

// TestHashToken_SHA256Length — HashToken документирован как SHA-256,
// значит длина hex-представления должна быть ровно 64 символа.
func TestHashToken_SHA256Length(t *testing.T) {
	h := HashToken("anything")
	if len(h) != 64 {
		t.Fatalf("expected 64 hex chars for sha256, got %d", len(h))
	}
}
