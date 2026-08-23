package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// signToken — вспомогательная функция, собирает JWT так же, как это делает
// User Service (см. user-service/internal/auth/jwt.go), чтобы проверить
// совместимость независимой реализации ParseAccessToken.
func signToken(t *testing.T, secret string, userID int64, expiresAt time.Time) string {
	t.Helper()
	claims := Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Subject:   "access",
		},
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return tok
}

// TestParseAccessToken_Valid — токен, подписанный тем же секретом,
// должен успешно распарситься с правильным user_id.
func TestParseAccessToken_Valid(t *testing.T) {
	tm := NewTokenManager("shared-secret")
	tok := signToken(t, "shared-secret", 123, time.Now().Add(time.Hour))

	claims, err := tm.ParseAccessToken(tok)
	if err != nil {
		t.Fatalf("ParseAccessToken: %v", err)
	}
	if claims.UserID != 123 {
		t.Fatalf("UserID=%d want=123", claims.UserID)
	}
}

// TestParseAccessToken_WrongSecret — Notification Service не выпускает
// токены сам, но обязан отвергать токены, подписанные не тем секретом,
// который сконфигурирован как общий с User Service.
func TestParseAccessToken_WrongSecret(t *testing.T) {
	tm := NewTokenManager("shared-secret")
	tok := signToken(t, "different-secret", 123, time.Now().Add(time.Hour))

	if _, err := tm.ParseAccessToken(tok); err == nil {
		t.Fatal("expected error for token signed with a different secret")
	}
}

// TestParseAccessToken_Expired — просроченный токен должен отклоняться.
func TestParseAccessToken_Expired(t *testing.T) {
	tm := NewTokenManager("shared-secret")
	tok := signToken(t, "shared-secret", 123, time.Now().Add(-time.Hour))

	if _, err := tm.ParseAccessToken(tok); err == nil {
		t.Fatal("expected error for expired token")
	}
}

// TestParseAccessToken_UnexpectedSigningMethod — токен, подписанный
// алгоритмом, отличным от HMAC (например "none" или RSA), должен
// отклоняться независимо от секрета — иначе это классическая уязвимость
// "alg confusion" в JWT-библиотеках.
func TestParseAccessToken_UnexpectedSigningMethod(t *testing.T) {
	tm := NewTokenManager("shared-secret")
	claims := Claims{
		UserID: 1,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	unsafeToken := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	tok, err := unsafeToken.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("sign none-alg token: %v", err)
	}

	if _, err := tm.ParseAccessToken(tok); err == nil {
		t.Fatal("expected error for alg=none token")
	}
}

// TestParseAccessToken_Malformed — произвольный мусор не должен парситься
// и не должен паниковать.
func TestParseAccessToken_Malformed(t *testing.T) {
	tm := NewTokenManager("shared-secret")
	if _, err := tm.ParseAccessToken("garbage"); err == nil {
		t.Fatal("expected error for malformed token")
	}
	if _, err := tm.ParseAccessToken(""); err == nil {
		t.Fatal("expected error for empty token")
	}
}
