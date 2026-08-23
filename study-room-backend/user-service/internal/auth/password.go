package auth

import "golang.org/x/crypto/bcrypt"

// HashPassword хеширует пароль. Cost 12 — компромисс между безопасностью
// и скоростью логина, подходит для продакшена в 2026 году.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func CheckPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
