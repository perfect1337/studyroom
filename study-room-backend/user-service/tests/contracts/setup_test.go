package contracts_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"studyroom/user-service/internal/app"
	"studyroom/user-service/internal/auth"
	"studyroom/user-service/internal/handlers"
	"studyroom/user-service/internal/migrate"
	"studyroom/user-service/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultTestDSN = "postgres://user_service:devpassword123@localhost:5433/study_room_users?sslmode=disable"

var (
	shared     *env
	sharedOnce sync.Once
	sharedErr  error

	reportMu   sync.Mutex
	reportFile *os.File
	reportPath string
)

func TestMain(m *testing.M) {
	_, thisFile, _, _ := runtime.Caller(0)
	dir := filepath.Join(filepath.Dir(thisFile), "results")
	_ = os.MkdirAll(dir, 0o755)
	reportPath = filepath.Join(dir, "last-run.log")

	f, err := os.Create(reportPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "cannot create report file %s: %v\n", reportPath, err)
		os.Exit(1)
	}
	reportFile = f
	writeReport("Study Room — user-service contract tests\n")
	writeReport("started: %s\n\n", time.Now().Format(time.RFC3339))

	code := m.Run()

	writeReport("\nfinished: %s\nexit code: %d\n", time.Now().Format(time.RFC3339), code)
	_ = reportFile.Close()

	abs, _ := filepath.Abs(reportPath)
	fmt.Printf("\ncontract test report: %s\n", abs)
	os.Exit(code)
}

func writeReport(format string, args ...any) {
	reportMu.Lock()
	defer reportMu.Unlock()
	if reportFile == nil {
		return
	}
	_, _ = fmt.Fprintf(reportFile, format, args...)
}

type env struct {
	t      testing.TB
	pool   *pgxpool.Pool
	deps   *app.Deps
	router http.Handler
	tm     *auth.TokenManager
}

// logf пишет и в файл отчёта, и в t.Log (видно при go test -v).
func (e *env) logf(format string, args ...any) {
	e.t.Helper()
	msg := fmt.Sprintf(format, args...)
	writeReport("%s\n", msg)
	e.t.Log(msg)
}

func getEnv(t *testing.T) *env {
	t.Helper()
	sharedOnce.Do(func() {
		dsn := os.Getenv("TEST_DATABASE_URL")
		if dsn == "" {
			dsn = defaultTestDSN
		}
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		pool, err := pgxpool.New(ctx, dsn)
		if err != nil {
			sharedErr = fmt.Errorf("connect TEST_DATABASE_URL: %w (start postgres: docker compose up -d postgres-users)", err)
			return
		}
		if err := pool.Ping(ctx); err != nil {
			pool.Close()
			sharedErr = fmt.Errorf("ping DB: %w (expected %s)", err, dsn)
			return
		}
		if err := migrate.Run(ctx, pool); err != nil {
			pool.Close()
			sharedErr = fmt.Errorf("migrate: %w", err)
			return
		}

		tm := auth.NewTokenManager("test-jwt-secret-for-contracts", 60, 30)
		cookieOpts := handlers.CookieOptions{Secure: false, SameSite: "Lax"}
		deps := app.NewDeps(pool, tm, nil, "http://localhost:3000", 0, cookieOpts)
		shared = &env{
			pool:   pool,
			deps:   deps,
			router: app.NewRouter(deps),
			tm:     tm,
		}
	})
	if sharedErr != nil {
		t.Skip(sharedErr.Error())
	}
	e := *shared
	e.t = t
	e.reset(t)
	e.logf("═══ %s ═══", t.Name())
	return &e
}

func (e *env) reset(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	_, err := e.pool.Exec(ctx, `
		TRUNCATE TABLE
			password_reset_tokens,
			refresh_tokens,
			parent_student,
			tutor_profiles,
			student_profiles,
			users,
			branches
		RESTART IDENTITY CASCADE
	`)
	if err != nil {
		t.Fatalf("truncate: %v", err)
	}
}

func (e *env) seedBranch(name, city string) *models.Branch {
	e.t.Helper()
	b, err := e.deps.Branches.Create(context.Background(), &models.Branch{
		Name: name, City: city,
	})
	if err != nil {
		e.t.Fatalf("seed branch: %v", err)
	}
	e.logf("  [DB] branch id=%d name=%q city=%q", b.ID, b.Name, b.City)
	return b
}

type seedOpts struct {
	Email     string
	Password  string
	Role      models.Role
	BranchID  *int64
	Phone     *string
	LastName  string
	FirstName string
}

func (e *env) seedUser(o seedOpts) *models.User {
	e.t.Helper()
	if o.Password == "" {
		o.Password = "password123"
	}
	if o.LastName == "" {
		o.LastName = "Тестов"
	}
	if o.FirstName == "" {
		o.FirstName = "Юзер"
	}
	if o.Email == "" {
		o.Email = fmt.Sprintf("%s_%d@test.local", o.Role, time.Now().UnixNano())
	}
	hash, err := auth.HashPassword(o.Password)
	if err != nil {
		e.t.Fatalf("hash password: %v", err)
	}
	u, err := e.deps.Users.Create(context.Background(), &models.User{
		Email: o.Email, Phone: o.Phone, PasswordHash: hash, Role: o.Role,
		LastName: o.LastName, FirstName: o.FirstName, BranchID: o.BranchID, IsActive: true,
	})
	if err != nil {
		e.t.Fatalf("seed user %s: %v", o.Email, err)
	}
	branch := "nil"
	if u.BranchID != nil {
		branch = fmt.Sprintf("%d", *u.BranchID)
	}
	e.logf("  [DB] user id=%d role=%s email=%s branch_id=%s (%s %s)",
		u.ID, u.Role, u.Email, branch, u.LastName, u.FirstName)
	return u
}

func (e *env) linkParentChild(parentID, studentID int64) {
	e.t.Helper()
	if err := e.deps.ParentChild.Link(context.Background(), parentID, studentID); err != nil {
		e.t.Fatalf("link parent-child: %v", err)
	}
	e.logf("  [DB] parent_student parent_id=%d student_id=%d", parentID, studentID)
}

func (e *env) accessToken(u *models.User) string {
	e.t.Helper()
	tok, err := e.tm.GenerateAccessToken(u)
	if err != nil {
		e.t.Fatalf("access token: %v", err)
	}
	e.logf("  [JWT] access for id=%d role=%s → %s", u.ID, u.Role, truncate(tok, 24))
	return tok
}

func (e *env) saveResetToken(userID int64) string {
	e.t.Helper()
	plain, err := auth.GenerateOpaqueToken()
	if err != nil {
		e.t.Fatalf("reset token: %v", err)
	}
	err = e.deps.Auth.SavePasswordResetToken(
		context.Background(), userID, auth.HashToken(plain), time.Now().Add(time.Hour),
	)
	if err != nil {
		e.t.Fatalf("save reset token: %v", err)
	}
	e.logf("  [DB] password_reset_token for user_id=%d → %s", userID, truncate(plain, 16))
	return plain
}

type apiResult struct {
	Status  int
	Body    map[string]any
	Raw     []byte
	Cookies []*http.Cookie
}

func (e *env) do(method, path string, body any, token string) apiResult {
	return e.doCookie(method, path, body, token, nil)
}

// doCookie — как do, но дополнительно отправляет cookie в запросе (нужно
// для /auth/refresh и /auth/logout, которые теперь читают refresh-токен
// из httpOnly cookie, а не из JSON body).
func (e *env) doCookie(method, path string, body any, token string, cookie *http.Cookie) apiResult {
	e.t.Helper()

	var rawBody []byte
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			e.t.Fatalf("marshal: %v", err)
		}
		rawBody = b
		reader = bytes.NewReader(b)
	}

	authLabel := "none"
	if token != "" {
		authLabel = "Bearer " + truncate(token, 24)
	}

	e.logf("┌─ %s", e.t.Name())
	e.logf("│  → %s %s", method, path)
	e.logf("│    Authorization: %s", authLabel)
	if len(rawBody) > 0 {
		e.logf("│    request body:\n%s", indentJSON(rawBody, "│      "))
	} else {
		e.logf("│    request body: (empty)")
	}

	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rr := httptest.NewRecorder()
	e.router.ServeHTTP(rr, req)

	raw := rr.Body.Bytes()
	out := apiResult{Status: rr.Code, Raw: raw, Body: map[string]any{}, Cookies: rr.Result().Cookies()}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out.Body)
	}

	e.logf("│  ← %d %s", out.Status, http.StatusText(out.Status))
	if len(raw) > 0 {
		e.logf("│    response body:\n%s", indentJSON(maskSecrets(raw), "│      "))
	} else {
		e.logf("│    response body: (empty)")
	}
	e.logf("└─")

	return out
}

func (e *env) mustOK(res apiResult, want int) {
	e.t.Helper()
	if res.Status != want {
		msg := fmt.Sprintf("status=%d want=%d body=%s", res.Status, want, string(res.Raw))
		writeReport("  ✗ FAIL: %s\n", msg)
		e.t.Fatalf("%s", msg)
	}
	e.logf("  ✓ expect status %d — ok", want)
}

func (res apiResult) findCookie(name string) *http.Cookie {
	for _, c := range res.Cookies {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func indentJSON(raw []byte, prefix string) string {
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, raw, "", "  "); err != nil {
		return prefix + string(raw)
	}
	lines := bytes.Split(pretty.Bytes(), []byte("\n"))
	var out bytes.Buffer
	for i, line := range lines {
		out.WriteString(prefix)
		out.Write(line)
		if i < len(lines)-1 {
			out.WriteByte('\n')
		}
	}
	return out.String()
}

// maskSecrets прячет длинные токены в логе ответа, оставляя префикс.
func maskSecrets(raw []byte) []byte {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return raw
	}
	maskKeys(m)
	b, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return b
}

func maskKeys(m map[string]any) {
	for k, v := range m {
		switch val := v.(type) {
		case string:
			if k == "access_token" || k == "refresh_token" || k == "temp_password" || k == "reset_token" {
				m[k] = truncate(val, 16)
			}
		case map[string]any:
			maskKeys(val)
		case []any:
			for _, item := range val {
				if child, ok := item.(map[string]any); ok {
					maskKeys(child)
				}
			}
		}
	}
}

func errCode(res apiResult) string {
	errObj, _ := res.Body["error"].(map[string]any)
	if errObj == nil {
		return ""
	}
	code, _ := errObj["code"].(string)
	return code
}

func asSlice(v any) []any {
	if v == nil {
		return nil
	}
	s, _ := v.([]any)
	return s
}

func userMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}
