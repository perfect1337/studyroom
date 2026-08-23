package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
)

// GenerateOpaqueToken — случайная строка для refresh-токена.
// В отличие от access-токена, это НЕ JWT: сам по себе он ничего не
// рассказывает о пользователе, а служит только ключом к записи в БД,
// которую можно отозвать (logout, компрометация).
func GenerateOpaqueToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// HashToken — refresh-токен в БД хранится не в открытом виде (как и пароль),
// а его SHA-256 хеш, чтобы утечка БД не давала злоумышленнику готовые токены.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
