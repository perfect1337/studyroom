package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"studyroom/academic-service/internal/models"
)

func signToken(t *testing.T, secret string, userID int64, role models.Role, branchID *int64, expiresAt time.Time) string {
	t.Helper()
	claims := Claims{
		UserID: userID, Role: role, BranchID: branchID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return tok
}

// TestParseAccessToken_Valid — токен, подписанный тем же секретом, что и
// User Service, должен успешно распарситься со всеми claims (role/branch_id
// нужны Academic Service для матрицы прав, см. internal/auth/jwt.go).
func TestParseAccessToken_Valid(t *testing.T) {
	tm := NewTokenManager("shared-secret")
	branchID := int64(7)
	tok := signToken(t, "shared-secret", 42, models.RoleTutor, &branchID, time.Now().Add(time.Hour))

	claims, err := tm.ParseAccessToken(tok)
	if err != nil {
		t.Fatalf("ParseAccessToken: %v", err)
	}
	if claims.UserID != 42 || claims.Role != models.RoleTutor {
		t.Fatalf("claims=%+v", claims)
	}
	if claims.BranchID == nil || *claims.BranchID != 7 {
		t.Fatalf("BranchID=%v want=7", claims.BranchID)
	}
}

// TestParseAccessToken_NilBranchID — owner/parent не привязаны к филиалу.
func TestParseAccessToken_NilBranchID(t *testing.T) {
	tm := NewTokenManager("shared-secret")
	tok := signToken(t, "shared-secret", 1, models.RoleOwner, nil, time.Now().Add(time.Hour))

	claims, err := tm.ParseAccessToken(tok)
	if err != nil {
		t.Fatalf("ParseAccessToken: %v", err)
	}
	if claims.BranchID != nil {
		t.Fatalf("expected nil BranchID, got %v", *claims.BranchID)
	}
}

func TestParseAccessToken_WrongSecret(t *testing.T) {
	tm := NewTokenManager("shared-secret")
	tok := signToken(t, "different-secret", 1, models.RoleOwner, nil, time.Now().Add(time.Hour))

	if _, err := tm.ParseAccessToken(tok); err == nil {
		t.Fatal("expected error for token signed with a different secret")
	}
}

func TestParseAccessToken_Expired(t *testing.T) {
	tm := NewTokenManager("shared-secret")
	tok := signToken(t, "shared-secret", 1, models.RoleOwner, nil, time.Now().Add(-time.Hour))

	if _, err := tm.ParseAccessToken(tok); err == nil {
		t.Fatal("expected error for expired token")
	}
}

// TestParseAccessToken_UnexpectedSigningMethod — защита от "alg confusion":
// токен, подписанный alg=none, должен отклоняться независимо от секрета.
func TestParseAccessToken_UnexpectedSigningMethod(t *testing.T) {
	tm := NewTokenManager("shared-secret")
	claims := Claims{
		UserID: 1, Role: models.RoleOwner,
		RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))},
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

func TestParseAccessToken_Malformed(t *testing.T) {
	tm := NewTokenManager("shared-secret")
	if _, err := tm.ParseAccessToken("garbage"); err == nil {
		t.Fatal("expected error for malformed token")
	}
	if _, err := tm.ParseAccessToken(""); err == nil {
		t.Fatal("expected error for empty token")
	}
}
