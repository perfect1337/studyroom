package contracts_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"studyroom/notification-service/internal/app"
	"studyroom/notification-service/internal/auth"
	"studyroom/notification-service/internal/messenger"
	"studyroom/notification-service/internal/migrate"
	"studyroom/notification-service/internal/models"
)

const defaultTestDSN = "postgres://notification_service:devpassword123@localhost:5434/study_room_notifications?sslmode=disable"

const testJWTSecret = "test-jwt-secret-for-contracts"
const testServiceToken = "test-service-token-for-contracts"

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
	writeReport("Study Room — notification-service contract tests\n")
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

// fakeMailer подменяет реальный SMTP в тестах: письма не улетают наружу,
// а складываются в память, чтобы тест мог проверить факт и содержимое отправки.
// Также умеет симулировать ошибку SMTP для конкретного адреса (см. failFor).
type fakeMailer struct {
	mu      sync.Mutex
	sent    []sentMail
	failFor map[string]string
}

type sentMail struct {
	To, Subject, Body string
}

func newFakeMailer() *fakeMailer {
	return &fakeMailer{failFor: map[string]string{}}
}

func (f *fakeMailer) Send(to, subject, body string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if msg, ok := f.failFor[to]; ok {
		return errors.New(msg)
	}
	f.sent = append(f.sent, sentMail{To: to, Subject: subject, Body: body})
	return nil
}

func (f *fakeMailer) reset() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = nil
	f.failFor = map[string]string{}
}

func (f *fakeMailer) last() (sentMail, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.sent) == 0 {
		return sentMail{}, false
	}
	return f.sent[len(f.sent)-1], true
}

func (f *fakeMailer) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.sent)
}

type env struct {
	t      testing.TB
	pool   *pgxpool.Pool
	deps   *app.Deps
	router http.Handler
	tm     *auth.TokenManager
	mail   *fakeMailer
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
			sharedErr = fmt.Errorf("connect TEST_DATABASE_URL: %w (start postgres: docker compose up -d postgres-notifications)", err)
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
		mail := newFakeMailer()
		messengerCfg := messenger.Config{}
		factory := messenger.NewFactory(messengerCfg)
		// -1 отключает почасовой троттлинг batch-уведомлений (см.
		// notifier.New) — контрактные тесты шлют единичные письма и не
		// должны зависеть от реального SMTP-лимита/скользящего окна.
		deps := app.NewDeps(pool, tm, testServiceToken, mail, factory, -1)

		shared = &env{
			pool:   pool,
			deps:   deps,
			router: app.NewRouter(deps),
			tm:     tm,
			mail:   mail,
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
			notifications,
			notification_settings,
			users_ref
		RESTART IDENTITY CASCADE
	`)
	if err != nil {
		t.Fatalf("truncate: %v", err)
	}
	e.mail.reset()
}

func (e *env) waitForMailCount(expected int) {
	deadline := time.Now().Add(2 * time.Second)
	for {
		if e.mail.count() >= expected {
			return
		}
		if time.Now().After(deadline) {
			e.t.Fatalf("expected %d emails sent, got %d", expected, e.mail.count())
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// seedUserRef кладёт запись в users_ref напрямую (эквивалент POST /internal/users/sync
// или события user.created, но без похода через HTTP/NATS в тесте).
func (e *env) seedUserRef(id int64, email, firstName, lastName string) {
	e.t.Helper()
	if err := e.deps.UsersRef.Upsert(context.Background(), &models.UserRef{
		ID: id, Email: email, FirstName: firstName, LastName: lastName,
	}); err != nil {
		e.t.Fatalf("seed users_ref id=%d: %v", id, err)
	}
	e.logf("  [DB] users_ref id=%d email=%s", id, email)
}

// accessToken выпускает валидный JWT с тем же секретом, что проверяет сервис —
// TokenManager сервиса не выпускает токены сам (это делает User Service), поэтому
// в тесте подписываем вручную через тот же auth.Claims.
func (e *env) accessToken(userID int64) string {
	e.t.Helper()
	claims := auth.Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testJWTSecret))
	if err != nil {
		e.t.Fatalf("sign token: %v", err)
	}
	e.logf("  [JWT] access for user_id=%d → %s", userID, truncate(tok, 24))
	return tok
}

func (e *env) expiredToken(userID int64) string {
	e.t.Helper()
	claims := auth.Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testJWTSecret))
	if err != nil {
		e.t.Fatalf("sign expired token: %v", err)
	}
	return tok
}

type apiResult struct {
	Status int
	Body   map[string]any
	Raw    []byte
}

// do выполняет запрос с пользовательским Authorization: Bearer <token> (или без него, если token == "").
func (e *env) do(method, path string, body any, token string) apiResult {
	return e.request(method, path, body, map[string]string{
		"Authorization": bearerOrEmpty(token),
	})
}

// doInternal выполняет запрос с X-Service-Token — для /internal/* эндпоинтов.
func (e *env) doInternal(method, path string, body any, serviceToken string) apiResult {
	headers := map[string]string{}
	if serviceToken != "" {
		headers["X-Service-Token"] = serviceToken
	}
	return e.request(method, path, body, headers)
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
