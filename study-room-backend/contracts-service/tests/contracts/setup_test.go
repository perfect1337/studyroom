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
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"studyroom/contracts-service/internal/app"
	"studyroom/contracts-service/internal/auth"
	"studyroom/contracts-service/internal/events"
	"studyroom/contracts-service/internal/migrate"
	"studyroom/contracts-service/internal/models"
)

const defaultTestDSN = "postgres://contracts_service:devpassword123@localhost:5437/study_room_contracts?sslmode=disable"

const testJWTSecret = "test-jwt-secret-for-contracts"

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
	writeReport("Study Room — contracts-service contract tests\n")
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

// fakeChildrenResolver подменяет реальный HTTP-поход в User Service
// (GET /parents/{id}/children, см. internal/userclient). Тесты явно
// прописывают, кто чей ребёнок, вместо поднятия второго сервиса.
type fakeChildrenResolver struct {
	mu       sync.Mutex
	children map[int64][]int64 // parentID -> []studentID
}

func newFakeChildrenResolver() *fakeChildrenResolver {
	return &fakeChildrenResolver{children: map[int64][]int64{}}
}

func (f *fakeChildrenResolver) Children(_ context.Context, _ string, parentID int64) ([]int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.children[parentID], nil
}

func (f *fakeChildrenResolver) set(parentID int64, studentIDs ...int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.children[parentID] = studentIDs
}

type env struct {
	t        testing.TB
	pool     *pgxpool.Pool
	deps     *app.Deps
	router   http.Handler
	tm       *auth.TokenManager
	children *fakeChildrenResolver
}

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
			sharedErr = fmt.Errorf("connect TEST_DATABASE_URL: %w (start postgres: docker compose up -d postgres-contracts)", err)
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

		tm := auth.NewTokenManager(testJWTSecret)
		children := newFakeChildrenResolver()
		deps := app.NewDeps(pool, tm, "http://unused-in-tests.invalid", events.NoopPublisher{})
		deps.UserClient = children

		shared = &env{
			pool:     pool,
			deps:     deps,
			router:   app.NewRouter(deps),
			tm:       tm,
			children: children,
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
			contracts,
			user_refs
		RESTART IDENTITY CASCADE
	`)
	if err != nil {
		t.Fatalf("truncate: %v", err)
	}
	e.children.mu.Lock()
	e.children.children = map[int64][]int64{}
	e.children.mu.Unlock()
}

// seedUserRef кладёт запись в user_refs напрямую — эквивалент события
// user.created/user.updated, но без похода через NATS в тесте.
func (e *env) seedUserRef(id int64, fullName string, role models.Role, branchID *int64) {
	e.t.Helper()
	if err := e.deps.UserRefs.Upsert(context.Background(), &models.UserRef{
		UserID: id, FullName: fullName, Role: role, BranchID: branchID,
	}); err != nil {
		e.t.Fatalf("seed user_ref id=%d: %v", id, err)
	}
	e.logf("  [DB] user_refs id=%d role=%s branch_id=%v", id, role, branchID)
}

// accessToken выпускает валидный JWT с тем же секретом, что проверяет
// сервис — Contracts Service не выпускает токены сам (это делает User
// Service), поэтому в тесте подписываем вручную через тот же auth.Claims.
func (e *env) accessToken(userID int64, role models.Role, branchID *int64) string {
	e.t.Helper()
	claims := auth.Claims{
		UserID:   userID,
		Role:     role,
		BranchID: branchID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testJWTSecret))
	if err != nil {
		e.t.Fatalf("sign token: %v", err)
	}
	e.logf("  [JWT] access for user_id=%d role=%s → %s", userID, role, truncate(tok, 24))
	return tok
}

type apiResult struct {
	Status int
	Body   map[string]any
	Raw    []byte
}

// do выполняет запрос с Authorization: Bearer <token> (или без него, если token == "").
func (e *env) do(method, path string, body any, token string) apiResult {
	return e.request(method, path, body, map[string]string{
		"Authorization": bearerOrEmpty(token),
	})
}

func bearerOrEmpty(token string) string {
	if token == "" {
		return ""
	}
	return "Bearer " + token
}

func (e *env) request(method, path string, body any, headers map[string]string) apiResult {
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

	e.logf("┌─ %s", e.t.Name())
	e.logf("│  → %s %s", method, path)
	for k, v := range headers {
		if v != "" {
			e.logf("│    %s: %s", k, truncate(v, 40))
		}
	}
	if len(rawBody) > 0 {
		e.logf("│    request body:\n%s", indentJSON(rawBody, "│      "))
	} else {
		e.logf("│    request body: (empty)")
	}

	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		if v != "" {
			req.Header.Set(k, v)
		}
	}
	rr := httptest.NewRecorder()
	e.router.ServeHTTP(rr, req)

	raw := rr.Body.Bytes()
	out := apiResult{Status: rr.Code, Raw: raw, Body: map[string]any{}}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out.Body)
	}

	e.logf("│  ← %d %s", out.Status, http.StatusText(out.Status))
	if len(raw) > 0 {
		e.logf("│    response body:\n%s", indentJSON(raw, "│      "))
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

// toPathID превращает id, пришедший из JSON-ответа (float64), в строку без
// дробной части — например, для подстановки в URL вида /contracts/{id}.
func toPathID(v any) string {
	switch n := v.(type) {
	case float64:
		return strconv.FormatInt(int64(n), 10)
	case int64:
		return strconv.FormatInt(n, 10)
	case int:
		return strconv.Itoa(n)
	default:
		return fmt.Sprintf("%v", v)
	}
}
