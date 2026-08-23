package auth

import (
	"testing"
	"time"

	"studyroom/user-service/internal/models"
)

func testUser() *models.User {
	branchID := int64(7)
	return &models.User{
		ID:       42,
		Role:     models.RoleTutor,
		BranchID: &branchID,
	}
}

// TestGenerateAndParseAccessToken — счастливый путь: токен, выпущенный
// TokenManager, должен успешно парситься тем же TokenManager и содержать
// именно те claims, из которых собирался (важно: role и branch_id — это то,
// на чём построена матрица прав в других сервисах).
func TestGenerateAndParseAccessToken(t *testing.T) {
	tm := NewTokenManager("test-secret", 15, 30)
	u := testUser()

	tok, err := tm.GenerateAccessToken(u)
	if err != nil {
		t.Fatalf("GenerateAccessToken: %v", err)
	}
	if tok == "" {
		t.Fatal("expected non-empty token")
	}

	claims, err := tm.ParseAccessToken(tok)
	if err != nil {
		t.Fatalf("ParseAccessToken: %v", err)
	}
	if claims.UserID != u.ID {
		t.Fatalf("UserID=%d want=%d", claims.UserID, u.ID)
	}
	if claims.Role != u.Role {
		t.Fatalf("Role=%s want=%s", claims.Role, u.Role)
	}
	if claims.BranchID == nil || *claims.BranchID != *u.BranchID {
		t.Fatalf("BranchID=%v want=%v", claims.BranchID, *u.BranchID)
	}
}

// TestGenerateAccessToken_NilBranchID — owner/parent не привязаны к филиалу,
// branch_id в токене должен остаться nil, а не превратиться в 0.
func TestGenerateAccessToken_NilBranchID(t *testing.T) {
	tm := NewTokenManager("test-secret", 15, 30)
	u := &models.User{ID: 1, Role: models.RoleOwner, BranchID: nil}

	tok, err := tm.GenerateAccessToken(u)
	if err != nil {
		t.Fatalf("GenerateAccessToken: %v", err)
	}
	claims, err := tm.ParseAccessToken(tok)
	if err != nil {
		t.Fatalf("ParseAccessToken: %v", err)
	}
	if claims.BranchID != nil {
		t.Fatalf("expected nil BranchID, got %v", *claims.BranchID)
	}
}

// TestParseAccessToken_WrongSecret — токен, подписанный одним секретом,
// не должен проходить проверку с другим (защита от подделки).
func TestParseAccessToken_WrongSecret(t *testing.T) {
	tm1 := NewTokenManager("secret-one", 15, 30)
	tm2 := NewTokenManager("secret-two", 15, 30)

	tok, err := tm1.GenerateAccessToken(testUser())
	if err != nil {
		t.Fatalf("GenerateAccessToken: %v", err)
	}
	if _, err := tm2.ParseAccessToken(tok); err == nil {
		t.Fatal("expected parse to fail with a different secret")
	}
}

// TestParseAccessToken_Malformed — мусорная строка не должна давать claims,
// ошибка обязана вернуться, а не паника.
func TestParseAccessToken_Malformed(t *testing.T) {
	tm := NewTokenManager("test-secret", 15, 30)
	if _, err := tm.ParseAccessToken("not-a-jwt-at-all"); err == nil {
		t.Fatal("expected error for malformed token")
	}
	if _, err := tm.ParseAccessToken(""); err == nil {
		t.Fatal("expected error for empty token")
	}
}

// TestParseAccessToken_Expired — просроченный access-токен должен
// отклоняться при парсинге (accessTTL отрицательный => уже истёк).
func TestParseAccessToken_Expired(t *testing.T) {
	tm := NewTokenManager("test-secret", -1, 30) // TTL "в прошлом"
	tok, err := tm.GenerateAccessToken(testUser())
	if err != nil {
		t.Fatalf("GenerateAccessToken: %v", err)
	}
	if _, err := tm.ParseAccessToken(tok); err == nil {
		t.Fatal("expected error for expired token")
	}
}

// TestRefreshTokenExpiry — RefreshTokenExpiry должен возвращать время
// примерно через refreshDays дней от текущего момента.
func TestRefreshTokenExpiry(t *testing.T) {
	tm := NewTokenManager("test-secret", 15, 30)
	before := time.Now().Add(30 * 24 * time.Hour)
	got := tm.RefreshTokenExpiry()
	after := time.Now().Add(30 * 24 * time.Hour)

	if got.Before(before.Add(-time.Minute)) || got.After(after.Add(time.Minute)) {
		t.Fatalf("RefreshTokenExpiry=%v not within expected window [%v, %v]", got, before, after)
	}
}
