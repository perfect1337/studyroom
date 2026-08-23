package auth

import "testing"

// TestHashPassword_CheckPassword проверяет базовый цикл: захешировать пароль
// и убедиться, что верный пароль проходит проверку, а неверный — нет.
func TestHashPassword_CheckPassword(t *testing.T) {
	hash, err := HashPassword("min8chars")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if hash == "" {
		t.Fatal("expected non-empty hash")
	}
	if hash == "min8chars" {
		t.Fatal("hash must not equal plaintext password")
	}
	if !CheckPassword("min8chars", hash) {
		t.Fatal("expected correct password to match its hash")
	}
	if CheckPassword("wrongpass1", hash) {
		t.Fatal("expected wrong password to not match")
	}
}

// TestHashPassword_Unique — bcrypt использует случайную соль, поэтому два
// хеша одного и того же пароля не должны совпадать, но оба должны быть валидны.
func TestHashPassword_Unique(t *testing.T) {
	h1, err := HashPassword("samepassword1")
	if err != nil {
		t.Fatalf("HashPassword #1: %v", err)
	}
	h2, err := HashPassword("samepassword1")
	if err != nil {
		t.Fatalf("HashPassword #2: %v", err)
	}
	if h1 == h2 {
		t.Fatal("expected different salts to produce different hashes")
	}
	if !CheckPassword("samepassword1", h1) || !CheckPassword("samepassword1", h2) {
		t.Fatal("both hashes must validate the same password")
	}
}

// TestCheckPassword_InvalidHash — CheckPassword не должен паниковать
// на мусорном хеше, а просто вернуть false.
func TestCheckPassword_InvalidHash(t *testing.T) {
	if CheckPassword("anything", "not-a-bcrypt-hash") {
		t.Fatal("expected false for malformed hash")
	}
	if CheckPassword("", "") {
		t.Fatal("expected false for empty password/hash pair")
	}
}
