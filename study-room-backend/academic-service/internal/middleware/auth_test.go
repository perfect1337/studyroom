package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"studyroom/academic-service/internal/auth"
	"studyroom/academic-service/internal/models"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
}

func errorCode(t *testing.T, body []byte) string {
	t.Helper()
	var v struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("unmarshal error body: %v (%s)", err, body)
	}
	return v.Error.Code
}

func signToken(t *testing.T, secret string, userID int64, role models.Role) string {
	t.Helper()
	claims := auth.Claims{UserID: userID, Role: role}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return tok
}

func TestRequireAuth_MissingHeader(t *testing.T) {
	tm := auth.NewTokenManager("secret")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/v1/academic/courses", nil)
	RequireAuth(tm)(okHandler()).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=401", rr.Code)
	}
	if code := errorCode(t, rr.Body.Bytes()); code != "UNAUTHORIZED" {
		t.Fatalf("error code=%q want=UNAUTHORIZED", code)
	}
}

func TestRequireAuth_ValidToken(t *testing.T) {
	tm := auth.NewTokenManager("secret")
	tok := signToken(t, "secret", 55, models.RoleTutor)

	var gotOK bool
	var gotRole models.Role
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := FromContext(r.Context())
		gotOK = ok
		if ok {
			gotRole = claims.Role
		}
		w.WriteHeader(http.StatusOK)
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/v1/academic/courses", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	RequireAuth(tm)(next).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200", rr.Code)
	}
	if !gotOK || gotRole != models.RoleTutor {
		t.Fatalf("expected tutor claims in context, ok=%v role=%v", gotOK, gotRole)
	}
}

func TestRequireAuth_WrongSecret(t *testing.T) {
	tm := auth.NewTokenManager("secret")
	tok := signToken(t, "other-secret", 55, models.RoleTutor)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/v1/academic/courses", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	RequireAuth(tm)(okHandler()).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=401", rr.Code)
	}
}

func TestRequireRoles_Allowed(t *testing.T) {
	tm := auth.NewTokenManager("secret")
	tok := signToken(t, "secret", 1, models.RoleOwner)

	handler := RequireAuth(tm)(RequireRoles(models.RoleOwner, models.RoleBranchOwner)(okHandler()))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/x", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d want=200", rr.Code)
	}
}

func TestRequireRoles_Forbidden(t *testing.T) {
	tm := auth.NewTokenManager("secret")
	tok := signToken(t, "secret", 1, models.RoleStudent)

	handler := RequireAuth(tm)(RequireRoles(models.RoleOwner)(okHandler()))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/x", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status=%d want=403", rr.Code)
	}
	if code := errorCode(t, rr.Body.Bytes()); code != "FORBIDDEN" {
		t.Fatalf("error code=%q want=FORBIDDEN", code)
	}
}

func TestRequireRoles_NoAuthContext(t *testing.T) {
	handler := RequireRoles(models.RoleOwner)(okHandler())
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/x", nil)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=401", rr.Code)
	}
}

func TestFromContext_Absent(t *testing.T) {
	req := httptest.NewRequest("GET", "/x", nil)
	claims, ok := FromContext(req.Context())
	if ok || claims != nil {
		t.Fatalf("expected no claims in bare context, got claims=%v ok=%v", claims, ok)
	}
}
