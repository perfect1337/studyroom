package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// ChildrenResolver — узкий интерфейс вокруг userclient.Client.Children,
// нужен, чтобы контрактные тесты могли подставить фейковую реализацию
// вместо реального HTTP-похода в User Service (см. tests/contracts/setup_test.go,
// тот же паттерн, что в academic-service/internal/handlers/helpers.go).
type ChildrenResolver interface {
	Children(ctx context.Context, bearerToken string, parentID int64) ([]int64, error)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": message},
	})
}

func parseIntPath(raw string) (int64, error) {
	return strconv.ParseInt(raw, 10, 64)
}

func parseIntQuery(r *http.Request, key string) (*int64, bool) {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return nil, false
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return nil, false
	}
	return &v, true
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	return strings.TrimPrefix(h, "Bearer ")
}

func contains(ids []int64, id int64) bool {
	for _, v := range ids {
		if v == id {
			return true
		}
	}
	return false
}
