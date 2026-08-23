package load

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/nats-io/nats.go"
)

type config struct {
	UserBase         string
	AcademicBase     string
	ContractsBase    string
	CRMBase          string
	NotificationBase string
	NATSUrl          string
	JWTSecret        string
	CRMWebhookSecret string
}

type accessClaims struct {
	UserID   int64  `json:"user_id"`
	Role     string `json:"role"`
	BranchID *int64 `json:"branch_id,omitempty"`
	jwt.RegisteredClaims
}

type scenarioReport struct {
	Name     string
	Status   string
	Duration time.Duration
	Notes    []string
	Logs     []string
}

type loadTestReport struct {
	Start        time.Time
	End          time.Time
	Overall      string
	Config       config
	Skipped      bool
	SkipReason   string
	StartupError string
	Scenarios    []scenarioReport
}

var loadReport = loadTestReport{Start: time.Now()}

var currentScenario *scenarioReport

func reportLog(format string, args ...any) {
	if currentScenario == nil {
		return
	}
	currentScenario.Logs = append(currentScenario.Logs, fmt.Sprintf(format, args...))
}

func reportNote(note string) {
	if currentScenario == nil {
		return
	}
	currentScenario.Notes = append(currentScenario.Notes, note)
}

// failf records the failure reason on the current scenario's report before
// failing the test, so report.md shows *why* a scenario failed instead of
// just "FAIL".
func failf(t *testing.T, format string, args ...any) {
	t.Helper()
	msg := fmt.Sprintf(format, args...)
	reportNote("FAILED: " + msg)
	t.Fatalf("%s", msg)
}

func fail(t *testing.T, msg string) {
	t.Helper()
	reportNote("FAILED: " + msg)
	t.Fatal(msg)
}

type registerResponse struct {
	UserID      int64  `json:"user_id"`
	AccessToken string `json:"access_token"`
}

type loginResponse struct {
	AccessToken string `json:"access_token"`
	User        struct {
		ID        int64  `json:"id"`
		Role      string `json:"role"`
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
	} `json:"user"`
}

type workflowResources struct {
	OwnerToken     string
	ParentToken    string
	ParentEmail    string
	ParentPassword string
	ParentID       int64
	StudentID      int64
	TutorID        int64
	BranchID       int64
	CourseID       int64
	ContractID     int64
}

type notificationSettingsResponse struct {
	EmailEnabled     bool `json:"email_enabled"`
	SMSEnabled       bool `json:"sms_enabled"`
	MessengerEnabled bool `json:"messenger_enabled"`
}

func TestMain(m *testing.M) {
	code := m.Run()
	loadReport.End = time.Now()
	if loadReport.Overall == "" {
		loadReport.Overall = "PASS"
	}
	if loadReport.Skipped {
		loadReport.Overall = "SKIPPED"
	} else if code != 0 {
		loadReport.Overall = "FAIL"
	}
	if err := writeLoadReport(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to write load test report: %v\n", err)
	}
	os.Exit(code)
}

func TestDistributedLoadScenarios(t *testing.T) {
	cfg := loadConfig()
	client := &http.Client{Timeout: 12 * time.Second}

	loadReport.Config = cfg
	missing := requireServices(t, cfg, client)
	if len(missing) > 0 {
		loadReport.StartupError = strings.Join(missing, "; ")
		failf(t, "cross-service tests cannot run because services are not available: %s", loadReport.StartupError)
	}

	runScenario(t, "HealthzAndDocs", func(t *testing.T) {
		testHealthzAndDocs(t, cfg, client)
	})

	runScenario(t, "AuthNegativeCases", func(t *testing.T) {
		testAuthNegativeCases(t, cfg, client)
	})

	resources := workflowResources{ParentEmail: fmt.Sprintf("parent+%d@test.local", time.Now().UnixNano()), ParentPassword: "Password123!"}
	runScenario(t, "InitialSetup", func(t *testing.T) {
		resources = setupUserWorkflow(t, cfg, client, resources.ParentEmail, resources.ParentPassword)
	})

	runScenario(t, "UserAuthenticationAndDirectory", func(t *testing.T) {
		testUserAuthenticationAndDirectory(t, cfg, client, resources)
	})

	runScenario(t, "AuthorizationAndRBAC", func(t *testing.T) {
		testAuthorizationAndRBAC(t, cfg, client, resources)
	})

	runScenario(t, "UserProfileAndDirectory", func(t *testing.T) {
		testUserProfileAndDirectory(t, cfg, client, resources)
	})

	runScenario(t, "UserAdminManagement", func(t *testing.T) {
		testUserAdminManagement(t, cfg, client, resources)
	})

	runScenario(t, "ContractsLifecycle", func(t *testing.T) {
		testContractsLifecycle(t, cfg, client, resources)
	})

	runScenario(t, "ContractsValidationAndAccessControl", func(t *testing.T) {
		testContractsValidationAndAccessControl(t, cfg, client, resources)
	})

	runScenario(t, "ContractsCRUD", func(t *testing.T) {
		testContractsCRUD(t, cfg, client, resources)
	})

	runScenario(t, "ContractsPaymentStatus", func(t *testing.T) {
		testContractsPaymentStatus(t, cfg, client, resources)
	})

	runScenario(t, "AcademicLessonAndAttendance", func(t *testing.T) {
		testAcademicLessonAndAttendance(t, cfg, client, resources)
	})

	runScenario(t, "AcademicValidationAndAccessControl", func(t *testing.T) {
		testAcademicValidationAndAccessControl(t, cfg, client, resources)
	})

	runScenario(t, "CoursesCRUD", func(t *testing.T) {
		testCoursesCRUD(t, cfg, client, resources)
	})

	runScenario(t, "EnrollmentsCRUD", func(t *testing.T) {
		testEnrollmentsCRUD(t, cfg, client, resources)
	})

	runScenario(t, "LessonsCRUD", func(t *testing.T) {
		testLessonsCRUD(t, cfg, client, resources)
	})

	runScenario(t, "HomeworkLifecycle", func(t *testing.T) {
		testHomeworkLifecycle(t, cfg, client, resources)
	})

	runScenario(t, "NotificationSettingsAndRead", func(t *testing.T) {
		testNotificationSettingsAndRead(t, cfg, client, resources)
	})

	runScenario(t, "NotificationsAccessControl", func(t *testing.T) {
		testNotificationsAccessControl(t, cfg, client, resources)
	})

	runScenario(t, "AcademicEnrollmentFromContract", func(t *testing.T) {
		testAcademicEnrollmentFromContract(t, cfg, client, resources.ParentToken, resources.StudentID)
	})

	runScenario(t, "CRMWebhookIntake", func(t *testing.T) {
		testCRMWebhookIntake(t, cfg, client)
	})

	runScenario(t, "CRMValidationAndAccessControl", func(t *testing.T) {
		testCRMValidationAndAccessControl(t, cfg, client, resources)
	})

	runScenario(t, "CRMToNotificationFlow", func(t *testing.T) {
		testCRMToNotificationFlow(t, cfg, client, resources)
	})
}

func writeLoadReport() error {
	var b strings.Builder
	b.WriteString("# Load Test Report\n\n")
	b.WriteString(fmt.Sprintf("**Run started:** %s\n\n", loadReport.Start.Format(time.RFC3339)))
	b.WriteString(fmt.Sprintf("**Run finished:** %s\n\n", loadReport.End.Format(time.RFC3339)))
	b.WriteString(fmt.Sprintf("**Overall result:** %s\n\n", loadReport.Overall))
	b.WriteString("## Configuration\n\n")
	b.WriteString(fmt.Sprintf("- user-service: %s\n", loadReport.Config.UserBase))
	b.WriteString(fmt.Sprintf("- academic-service: %s\n", loadReport.Config.AcademicBase))
	b.WriteString(fmt.Sprintf("- contracts-service: %s\n", loadReport.Config.ContractsBase))
	b.WriteString(fmt.Sprintf("- crm-service: %s\n", loadReport.Config.CRMBase))
	b.WriteString(fmt.Sprintf("- notification-service: %s\n", loadReport.Config.NotificationBase))
	b.WriteString(fmt.Sprintf("- nats-url: %s\n", loadReport.Config.NATSUrl))
	jwtSecretNote := "(hidden)"
	if loadReport.Config.JWTSecret == "change-me-in-production" {
		jwtSecretNote = "(default placeholder)"
	}
	b.WriteString(fmt.Sprintf("- jwt-secret: %s\n", jwtSecretNote))
	webhookSecretNote := "(hidden)"
	if loadReport.Config.CRMWebhookSecret == "" {
		webhookSecretNote = "(not set - webhook signature check disabled)"
	}
	b.WriteString(fmt.Sprintf("- tilda-webhook-secret: %s\n\n", webhookSecretNote))
	if loadReport.Skipped {
		b.WriteString(fmt.Sprintf("## Skipped\n\n%s\n\n", loadReport.SkipReason))
	}
	if loadReport.StartupError != "" {
		b.WriteString("## Service availability check failed\n\n")
		b.WriteString(fmt.Sprintf("%s\n\n", loadReport.StartupError))
	}

	var passed, failedCount, skipped, totalRequests int
	for _, scenario := range loadReport.Scenarios {
		switch scenario.Status {
		case "PASS":
			passed++
		case "FAIL":
			failedCount++
		case "SKIPPED":
			skipped++
		}
		for _, log := range scenario.Logs {
			if strings.Contains(log, " -> ") {
				totalRequests++
			}
		}
	}

	b.WriteString("## Summary\n\n")
	b.WriteString(fmt.Sprintf("- scenarios: %d (passed: %d, failed: %d, skipped: %d)\n", len(loadReport.Scenarios), passed, failedCount, skipped))
	b.WriteString(fmt.Sprintf("- HTTP requests made: %d\n", totalRequests))
	b.WriteString(fmt.Sprintf("- total run time: %s\n\n", loadReport.End.Sub(loadReport.Start).Round(time.Millisecond)))

	b.WriteString("| Scenario | Status | Duration | Requests |\n")
	b.WriteString("|---|---|---|---|\n")
	for _, scenario := range loadReport.Scenarios {
		reqCount := 0
		for _, log := range scenario.Logs {
			if strings.Contains(log, " -> ") {
				reqCount++
			}
		}
		b.WriteString(fmt.Sprintf("| %s | %s | %s | %d |\n", scenario.Name, scenario.Status, scenario.Duration.Round(time.Millisecond), reqCount))
	}
	b.WriteString("\n")

	b.WriteString("## Scenario results\n\n")
	for _, scenario := range loadReport.Scenarios {
		statusMark := "✅"
		if scenario.Status == "FAIL" {
			statusMark = "❌"
		} else if scenario.Status == "SKIPPED" {
			statusMark = "⚠️"
		}
		b.WriteString(fmt.Sprintf("### %s %s\n\n", statusMark, scenario.Name))
		b.WriteString(fmt.Sprintf("- status: %s\n", scenario.Status))
		b.WriteString(fmt.Sprintf("- duration: %s\n", scenario.Duration.Round(time.Millisecond)))
		if len(scenario.Notes) > 0 {
			b.WriteString("- notes:\n")
			for _, note := range scenario.Notes {
				b.WriteString(fmt.Sprintf("  - %s\n", note))
			}
		}
		if len(scenario.Logs) > 0 {
			b.WriteString(fmt.Sprintf("- details (%d entries):\n", len(scenario.Logs)))
			for i, log := range scenario.Logs {
				b.WriteString(fmt.Sprintf("  %d. %s\n", i+1, log))
			}
		}
		b.WriteString("\n")
	}
	return os.WriteFile("report.md", []byte(b.String()), 0o644)
}

func runScenario(t *testing.T, name string, fn func(t *testing.T)) {
	start := time.Now()
	result := scenarioReport{Name: name}
	currentScenario = &result
	defer func() { currentScenario = nil }()

	var skipped bool
	var passed bool
	t.Run(name, func(t *testing.T) {
		defer func() {
			skipped = t.Skipped()
			passed = !t.Failed() && !skipped
		}()
		fn(t)
	})

	result.Duration = time.Since(start)
	if skipped {
		result.Status = "SKIPPED"
	} else if !passed {
		result.Status = "FAIL"
	} else {
		result.Status = "PASS"
	}
	loadReport.Scenarios = append(loadReport.Scenarios, result)
	if result.Status == "PASS" {
		reportLog("scenario completed successfully")
	}
}

func loadConfig() config {
	return config{
		UserBase:         envOrDefault("USER_SERVICE_URL", "http://localhost:8081"),
		AcademicBase:     envOrDefault("ACADEMIC_SERVICE_URL", "http://localhost:8082"),
		ContractsBase:    envOrDefault("CONTRACTS_SERVICE_URL", "http://localhost:8083"),
		CRMBase:          envOrDefault("CRM_SERVICE_URL", "http://localhost:8084"),
		NotificationBase: envOrDefault("NOTIFICATION_SERVICE_URL", "http://localhost:8085"),
		NATSUrl:          envOrDefault("NATS_URL", "nats://localhost:4222"),
		JWTSecret:        envOrDefault("JWT_SECRET", "change-me-in-production"),
		CRMWebhookSecret: envOrDefault("TILDA_WEBHOOK_SECRET", ""),
	}
}

func envOrDefault(key, fallback string) string {
	if val := strings.TrimSpace(os.Getenv(key)); val != "" {
		return val
	}
	return fallback
}

func requireServices(t *testing.T, cfg config, client *http.Client) []string {
	t.Helper()

	services := map[string]string{
		"user-service":         cfg.UserBase + "/healthz",
		"academic-service":     cfg.AcademicBase + "/healthz",
		"contracts-service":    cfg.ContractsBase + "/healthz",
		"crm-service":          cfg.CRMBase + "/healthz",
		"notification-service": cfg.NotificationBase + "/healthz",
	}

	var missing []string
	for name, url := range services {
		resp, err := client.Get(url)
		if err != nil {
			missing = append(missing, fmt.Sprintf("%s unavailable: %v", name, err))
			continue
		}
		func() {
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				missing = append(missing, fmt.Sprintf("%s returned %d", name, resp.StatusCode))
			}
		}()
	}

	if _, err := nats.Connect(cfg.NATSUrl, nats.Timeout(3*time.Second), nats.MaxReconnects(1)); err != nil {
		missing = append(missing, fmt.Sprintf("nats unavailable: %v", err))
	}

	if len(missing) > 0 {
		return missing
	}
	return nil
}

func testHealthzAndDocs(t *testing.T, cfg config, client *http.Client) {
	t.Helper()

	urls := map[string][]string{
		"user-service":         {cfg.UserBase + "/healthz", cfg.UserBase + "/openapi.yaml", cfg.UserBase + "/docs"},
		"academic-service":     {cfg.AcademicBase + "/healthz", cfg.AcademicBase + "/openapi.yaml", cfg.AcademicBase + "/docs"},
		"contracts-service":    {cfg.ContractsBase + "/healthz", cfg.ContractsBase + "/openapi.yaml", cfg.ContractsBase + "/docs"},
		"crm-service":          {cfg.CRMBase + "/healthz", cfg.CRMBase + "/openapi.yaml", cfg.CRMBase + "/docs"},
		"notification-service": {cfg.NotificationBase + "/healthz", cfg.NotificationBase + "/openapi.yaml", cfg.NotificationBase + "/docs"},
	}

	for service, endpoints := range urls {
		for _, endpoint := range endpoints {
			resp, err := client.Get(endpoint)
			if err != nil {
				failf(t, "%s failed %s: %v", service, endpoint, err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				failf(t, "%s %s returned %d", service, endpoint, resp.StatusCode)
			}
			reportLog("OK %s %s", service, endpoint)
		}
	}
}

func testUserAuthenticationAndDirectory(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	loginResp, refreshCookie := loginParent(t, client, cfg.UserBase, resources.ParentEmail, resources.ParentPassword)
	if loginResp.User.ID != resources.ParentID {
		failf(t, "logged-in user id=%d does not match created parent id=%d", loginResp.User.ID, resources.ParentID)
	}
	reportLog("parent login success for user %d", loginResp.User.ID)

	refreshResp, rotatedCookie := refreshToken(t, client, cfg.UserBase, refreshCookie)
	reportLog("refresh token returned new access token")

	// Старая (уже отозванная ротацией) cookie больше не должна работать.
	replayStatus, _, _, _, err := doJSONRequestCookie(client, "POST", cfg.UserBase+"/api/v1/auth/refresh", "", nil, refreshCookie)
	if err != nil {
		failf(t, "replaying rotated-out refresh cookie failed: %v", err)
	}
	expectStatus(t, replayStatus, http.StatusUnauthorized, "reusing a refresh token after it rotated")
	reportLog("confirmed a rotated-out refresh token is rejected")

	respStatus, meBody, _, err := doJSONRequest(client, "GET", cfg.UserBase+"/api/v1/users/me", refreshResp.AccessToken, nil)
	if err != nil {
		failf(t, "fetch me failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "fetch me expected 200, got %d", respStatus)
	}
	meMap, ok := meBody.(map[string]any)
	if !ok {
		failf(t, "users/me response is not JSON object")
	}
	if id, ok := parseNumericID(meMap["id"]); !ok || id != resources.ParentID {
		failf(t, "users/me returned wrong id: %#v", meMap["id"])
	}
	reportLog("users/me returned parent profile for id %d", resources.ParentID)

	newName := "Ирина"
	respStatus, updatedBody, _, err := doJSONRequest(client, "PATCH", cfg.UserBase+"/api/v1/users/me", refreshResp.AccessToken, map[string]any{"first_name": newName})
	if err != nil {
		failf(t, "update me failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "update me expected 200, got %d", respStatus)
	}
	updatedMap, ok := updatedBody.(map[string]any)
	if !ok {
		failf(t, "update me response is not JSON object")
	}
	if name, ok := updatedMap["first_name"].(string); !ok || name != newName {
		failf(t, "expected first_name %q, got %#v", newName, updatedMap["first_name"])
	}
	reportLog("updated parent first_name to %s", newName)

	respStatus, childrenBody, _, err := doJSONRequest(client, "GET", cfg.UserBase+fmt.Sprintf("/api/v1/parents/%d/children", resources.ParentID), resources.ParentToken, nil)
	if err != nil {
		failf(t, "list children failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "list children expected 200, got %d", respStatus)
	}
	childrenMap, ok := childrenBody.(map[string]any)
	if !ok {
		failf(t, "list children response is not JSON object")
	}
	children, ok := childrenMap["items"].([]any)
	if !ok {
		failf(t, "list children response missing items")
	}
	if len(children) == 0 {
		fail(t, "expected at least one child for parent")
	}
	reportLog("parent has %d child(ren)", len(children))

	// POST /auth/logout: отзывает refresh-токен и чистит cookie на клиенте.
	logoutStatus, _, _, logoutCookies, err := doJSONRequestCookie(client, "POST", cfg.UserBase+"/api/v1/auth/logout", "", nil, rotatedCookie)
	if err != nil {
		failf(t, "logout failed: %v", err)
	}
	if logoutStatus != http.StatusOK {
		failf(t, "logout expected 200, got %d", logoutStatus)
	}
	if cleared := refreshCookieFrom(logoutCookies); cleared == nil || cleared.MaxAge >= 0 {
		failf(t, "logout expected to clear sr_refresh_token cookie (MaxAge < 0), got %+v", cleared)
	}
	reportLog("logout cleared the refresh cookie")

	// Отозванный logout-ом refresh-токен больше не должен работать.
	afterLogoutStatus, _, _, _, err := doJSONRequestCookie(client, "POST", cfg.UserBase+"/api/v1/auth/refresh", "", nil, rotatedCookie)
	if err != nil {
		failf(t, "refresh after logout failed: %v", err)
	}
	expectStatus(t, afterLogoutStatus, http.StatusUnauthorized, "refreshing with a token revoked by logout")
	reportLog("confirmed refresh token is invalid after logout")

	// Logout идемпотентен: без cookie вообще — тоже 200, а не 500.
	idempotentStatus, _, _, _, err := doJSONRequestCookie(client, "POST", cfg.UserBase+"/api/v1/auth/logout", "", nil, nil)
	if err != nil {
		failf(t, "logout without cookie failed: %v", err)
	}
	if idempotentStatus != http.StatusOK {
		failf(t, "logout without cookie expected 200, got %d", idempotentStatus)
	}
	reportLog("confirmed logout without a cookie is idempotent (200)")
}

// testAuthNegativeCases exercises user-service auth error paths that the
// happy-path InitialSetup/UserAuthenticationAndDirectory scenarios never
// reach: duplicate registration, weak passwords, bad credentials, and
// invalid refresh/reset tokens. None of this depends on workflowResources,
// so it can run before InitialSetup.
func testAuthNegativeCases(t *testing.T, cfg config, client *http.Client) {
	t.Helper()

	email := fmt.Sprintf("parent-negative+%d@test.local", time.Now().UnixNano())
	password := "Password123!"
	registerParent(t, client, cfg.UserBase, email, password)
	reportLog("registered baseline user %s for negative auth checks", email)

	respStatus, _, _, err := doJSONRequest(client, "POST", cfg.UserBase+"/api/v1/auth/register", "", map[string]any{
		"email": email, "password": password, "last_name": "Test", "first_name": "Test",
	})
	if err != nil {
		failf(t, "duplicate register request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusConflict, "registering an already-used email")
	reportLog("confirmed duplicate registration returns 409")

	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.UserBase+"/api/v1/auth/register", "", map[string]any{
		"email":      fmt.Sprintf("parent-shortpw+%d@test.local", time.Now().UnixNano()),
		"password":   "short",
		"last_name":  "Test",
		"first_name": "Test",
	})
	if err != nil {
		failf(t, "short password register request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusBadRequest, "registering with a password under 8 characters")
	reportLog("confirmed registration validation rejects short passwords")

	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.UserBase+"/api/v1/auth/register", "", map[string]any{
		"email": fmt.Sprintf("parent-missing+%d@test.local", time.Now().UnixNano()), "password": password,
	})
	if err != nil {
		failf(t, "missing-name register request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusBadRequest, "registering without first_name/last_name")
	reportLog("confirmed registration validation rejects missing name fields")

	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.UserBase+"/api/v1/auth/login", "", map[string]any{
		"login": email, "password": "WrongPassword123!",
	})
	if err != nil {
		failf(t, "wrong-password login request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusUnauthorized, "logging in with the wrong password")
	reportLog("confirmed login rejects the wrong password")

	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.UserBase+"/api/v1/auth/login", "", map[string]any{
		"login": fmt.Sprintf("nobody+%d@test.local", time.Now().UnixNano()), "password": password,
	})
	if err != nil {
		failf(t, "unknown login request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusUnauthorized, "logging in with an unknown login")
	reportLog("confirmed login rejects an unknown identity")

	respStatus, _, _, _, err = doJSONRequestCookie(client, "POST", cfg.UserBase+"/api/v1/auth/refresh", "", nil,
		&http.Cookie{Name: "sr_refresh_token", Value: "not-a-real-refresh-token"})
	if err != nil {
		failf(t, "invalid refresh token request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusUnauthorized, "refreshing with an invalid refresh token")
	reportLog("confirmed refresh rejects an invalid refresh token")

	// Forgot-password must not leak whether an email is registered: 200 either way.
	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.UserBase+"/api/v1/auth/forgot-password", "", map[string]any{
		"email": fmt.Sprintf("nobody+%d@test.local", time.Now().UnixNano()),
	})
	if err != nil {
		failf(t, "forgot-password for unknown email failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusOK, "requesting a password reset for an unknown email")
	reportLog("confirmed forgot-password does not leak account existence")

	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.UserBase+"/api/v1/auth/reset-password", "", map[string]any{
		"reset_token": "not-a-real-reset-token", "new_password": "NewPassword123!",
	})
	if err != nil {
		failf(t, "invalid reset token request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusBadRequest, "resetting a password with an invalid reset token")
	reportLog("confirmed reset-password rejects an invalid reset token")
}

// testAuthorizationAndRBAC exercises the RequireAuth/RequireRoles middleware
// paths in user-service that the happy-path scenarios never hit: missing or
// malformed bearer tokens, and roles attempting actions outside their scope
// (api-contracts.md 1.11/1.12/1.17/1.18 role restrictions).
func testAuthorizationAndRBAC(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	respStatus, _, _, err := doJSONRequest(client, "GET", cfg.UserBase+"/api/v1/users/me", "", nil)
	if err != nil {
		failf(t, "users/me without token failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusUnauthorized, "fetching users/me without a bearer token")
	reportLog("confirmed users/me rejects requests without a token")

	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.UserBase+"/api/v1/users/me", "not-a-real-jwt", nil)
	if err != nil {
		failf(t, "users/me with malformed token failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusUnauthorized, "fetching users/me with a malformed token")
	reportLog("confirmed users/me rejects a malformed token")

	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.UserBase+"/api/v1/branches", resources.ParentToken, map[string]any{
		"name": "Should Be Rejected", "city": "Nowhere",
	})
	if err != nil {
		failf(t, "parent create branch request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "parent creating a branch")
	reportLog("confirmed parent role cannot create branches (403)")

	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.UserBase+"/api/v1/users/tutors", resources.ParentToken, map[string]any{
		"email":          fmt.Sprintf("tutor-rejected+%d@test.local", time.Now().UnixNano()),
		"last_name":      "Test",
		"first_name":     "Test",
		"branch_id":      resources.BranchID,
		"specialization": "Test",
	})
	if err != nil {
		failf(t, "parent create tutor request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "parent creating a tutor")
	reportLog("confirmed parent role cannot create tutors (403)")

	// A parent may only create students under their own parent_id.
	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.UserBase+"/api/v1/users/students", resources.ParentToken, map[string]any{
		"last_name": "Test", "first_name": "Test",
		"parent_id": resources.ParentID + 987654, "branch_id": resources.BranchID,
	})
	if err != nil {
		failf(t, "parent create student for another parent request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "parent creating a student under someone else's parent_id")
	reportLog("confirmed a parent cannot create a student under another parent's id")

	// A parent may only view their own children.
	otherParentEmail := fmt.Sprintf("parent-rbac-unrelated+%d@test.local", time.Now().UnixNano())
	otherParent := registerParent(t, client, cfg.UserBase, otherParentEmail, "Password123!")
	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.UserBase+fmt.Sprintf("/api/v1/parents/%d/children", resources.ParentID), otherParent.AccessToken, nil)
	if err != nil {
		failf(t, "unrelated parent list children request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "a parent listing another parent's children")
	reportLog("confirmed a parent cannot view another parent's children list")
}

// testUserProfileAndDirectory exercises the user-service endpoints the
// earlier scenarios never reach: changing your own password (api-contracts.md
// 1.8), the role-aware "my people" directory (1.9), and fetching another
// user by id under the ownership/visibility rules (1.10).
func testUserProfileAndDirectory(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	// 1.9 - a parent's directory must list their own children and leave
	// every other list empty (the endpoint always returns all five keys).
	respStatus, dirBody, _, err := doJSONRequest(client, "GET", cfg.UserBase+"/api/v1/users", resources.ParentToken, nil)
	if err != nil {
		failf(t, "parent users directory failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "parent users directory expected 200, got %d", respStatus)
	}
	dirMap, ok := dirBody.(map[string]any)
	if !ok {
		failf(t, "users directory response is not JSON object")
	}
	children, ok := dirMap["children"].([]any)
	if !ok {
		failf(t, "users directory response missing children")
	}
	foundChild := false
	for _, item := range children {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if id, ok := parseNumericID(row["id"]); ok && id == resources.StudentID {
			foundChild = true
		}
	}
	if !foundChild {
		failf(t, "parent directory did not include student %d in children", resources.StudentID)
	}
	for _, key := range []string{"students", "tutors", "branch_owners", "parents"} {
		if _, ok := dirMap[key].([]any); !ok {
			failf(t, "parent directory response missing empty %q list", key)
		}
	}
	reportLog("confirmed parent directory lists their own child and leaves other lists empty")

	// 1.9 - owner's directory, filtered by branch_id, must include the
	// tutor created for this run.
	respStatus, ownerDirBody, _, err := doJSONRequest(client, "GET", cfg.UserBase+fmt.Sprintf("/api/v1/users?branch_id=%d", resources.BranchID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "owner users directory failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "owner users directory expected 200, got %d", respStatus)
	}
	ownerDirMap, ok := ownerDirBody.(map[string]any)
	if !ok {
		failf(t, "owner users directory response is not JSON object")
	}
	tutors, ok := ownerDirMap["tutors"].([]any)
	if !ok {
		failf(t, "owner users directory response missing tutors")
	}
	foundTutor := false
	for _, item := range tutors {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if id, ok := parseNumericID(row["id"]); ok && id == resources.TutorID {
			foundTutor = true
		}
	}
	if !foundTutor {
		failf(t, "owner directory filtered by branch_id=%d did not include tutor %d", resources.BranchID, resources.TutorID)
	}
	reportLog("confirmed owner directory filtered by branch_id includes the run's tutor")

	// 1.10 - owner can fetch any user by id.
	respStatus, studentBody, _, err := doJSONRequest(client, "GET", cfg.UserBase+fmt.Sprintf("/api/v1/users/%d", resources.StudentID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "owner get student by id failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "owner get student by id expected 200, got %d", respStatus)
	}
	studentMap, ok := studentBody.(map[string]any)
	if !ok {
		failf(t, "get student by id response is not JSON object")
	}
	if id, ok := parseNumericID(studentMap["id"]); !ok || id != resources.StudentID {
		failf(t, "get student by id returned wrong id: %#v", studentMap["id"])
	}
	reportLog("confirmed owner can fetch student %d by id", resources.StudentID)

	// 1.10 - a parent can fetch their own child by id.
	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.UserBase+fmt.Sprintf("/api/v1/users/%d", resources.StudentID), resources.ParentToken, nil)
	if err != nil {
		failf(t, "parent get own child by id failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "parent get own child by id expected 200, got %d", respStatus)
	}
	reportLog("confirmed a parent can fetch their own child by id")

	// 1.10 - an unrelated parent must not be able to fetch someone else's child.
	otherParentEmail := fmt.Sprintf("parent-directory-unrelated+%d@test.local", time.Now().UnixNano())
	otherParent := registerParent(t, client, cfg.UserBase, otherParentEmail, "Password123!")
	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.UserBase+fmt.Sprintf("/api/v1/users/%d", resources.StudentID), otherParent.AccessToken, nil)
	if err != nil {
		failf(t, "unrelated parent get student by id failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "an unrelated parent fetching someone else's child by id")
	reportLog("confirmed an unrelated parent cannot fetch another parent's child by id")

	// 1.10 - fetching a nonexistent user id returns 404.
	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.UserBase+"/api/v1/users/999999999", resources.OwnerToken, nil)
	if err != nil {
		failf(t, "get nonexistent user by id failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusNotFound, "fetching a nonexistent user by id")
	reportLog("confirmed fetching a nonexistent user id returns 404")

	// 1.8 - change-password happy path: register a disposable parent so we
	// don't touch the shared workflow parent's credentials, then confirm the
	// old password stops working and the new one logs in.
	changeParentEmail := fmt.Sprintf("parent-changepw+%d@test.local", time.Now().UnixNano())
	changeParentPassword := "Password123!"
	changeParent := registerParent(t, client, cfg.UserBase, changeParentEmail, changeParentPassword)

	newPassword := "NewPassword456!"
	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.UserBase+"/api/v1/users/me/change-password", changeParent.AccessToken, map[string]any{
		"current_password": changeParentPassword,
		"new_password":     newPassword,
	})
	if err != nil {
		failf(t, "change password failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "change password expected 200, got %d", respStatus)
	}
	reportLog("changed password for user %d", changeParent.UserID)

	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.UserBase+"/api/v1/auth/login", "", map[string]any{
		"login": changeParentEmail, "password": changeParentPassword,
	})
	if err != nil {
		failf(t, "login with old password after change failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusUnauthorized, "logging in with the password from before a change-password call")
	reportLog("confirmed the old password no longer works after change-password")

	loginResp, _ := loginParent(t, client, cfg.UserBase, changeParentEmail, newPassword)
	if loginResp.User.ID != changeParent.UserID {
		failf(t, "login with new password returned unexpected user id %d", loginResp.User.ID)
	}
	reportLog("confirmed the new password works after change-password")

	// 1.8 - an incorrect current_password must be rejected.
	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.UserBase+"/api/v1/users/me/change-password", loginResp.AccessToken, map[string]any{
		"current_password": "TotallyWrongPassword!",
		"new_password":     "AnotherPassword789!",
	})
	if err != nil {
		failf(t, "change password with wrong current password failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusBadRequest, "changing password with an incorrect current password")
	reportLog("confirmed change-password rejects an incorrect current password")
}

// testUserAdminManagement exercises the owner/branch_owner admin surface
// that workflow setup never calls directly: the network-wide branch list
// (api-contracts.md 1.16), editing another user's profile fields (1.13),
// activating/deactivating an account (1.14), and toggling a tutor's on-duty
// status (1.15), including the owner-only "inactive" restriction.
func testUserAdminManagement(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	// 1.16 - GET /branches is owner-only and must include the branch created for this run.
	respStatus, branchesBody, _, err := doJSONRequest(client, "GET", cfg.UserBase+"/api/v1/branches", resources.OwnerToken, nil)
	if err != nil {
		failf(t, "list branches failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "list branches expected 200, got %d", respStatus)
	}
	branchesMap, ok := branchesBody.(map[string]any)
	if !ok {
		failf(t, "list branches response is not JSON object")
	}
	branchItems, ok := branchesMap["items"].([]any)
	if !ok {
		failf(t, "list branches response missing items")
	}
	foundBranch := false
	for _, item := range branchItems {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if id, ok := parseNumericID(row["id"]); ok && id == resources.BranchID {
			foundBranch = true
		}
	}
	if !foundBranch {
		failf(t, "branch list did not include the run's branch %d", resources.BranchID)
	}
	reportLog("confirmed owner branch list includes branch %d", resources.BranchID)

	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.UserBase+"/api/v1/branches", resources.ParentToken, nil)
	if err != nil {
		failf(t, "parent list branches request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "a parent listing branches")
	reportLog("confirmed a parent cannot list branches (403)")

	// 1.13 - owner edits a disposable student's profile fields.
	editStudentID := createStudent(t, client, cfg.UserBase, resources.ParentToken, resources.BranchID, resources.ParentID)
	reportLog("created disposable student %d for admin-editing checks", editStudentID)

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.UserBase+fmt.Sprintf("/api/v1/users/%d", editStudentID), resources.OwnerToken, map[string]any{
		"last_name": "ОбновленнаяФамилия",
	})
	if err != nil {
		failf(t, "owner update user failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "owner update user expected 200, got %d", respStatus)
	}
	reportLog("owner updated last_name for user %d", editStudentID)

	// A branch_owner scoped to the same branch may edit users in that branch.
	branchOwnerToken := makeToken(t, cfg.JWTSecret, int64(810000000)+resources.BranchID, "branch_owner", &resources.BranchID)
	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.UserBase+fmt.Sprintf("/api/v1/users/%d", editStudentID), branchOwnerToken, map[string]any{
		"first_name": "ОбновленноеИмя",
	})
	if err != nil {
		failf(t, "branch_owner update user in own branch failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "branch_owner update user in own branch expected 200, got %d", respStatus)
	}
	reportLog("confirmed branch_owner can edit a user in their own branch")

	// A branch_owner scoped to a different branch must be rejected.
	otherBranchID := resources.BranchID + 555555
	otherBranchOwnerToken := makeToken(t, cfg.JWTSecret, int64(820000000)+otherBranchID, "branch_owner", &otherBranchID)
	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.UserBase+fmt.Sprintf("/api/v1/users/%d", editStudentID), otherBranchOwnerToken, map[string]any{
		"first_name": "ShouldBeRejected",
	})
	if err != nil {
		failf(t, "branch_owner update user in another branch request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "branch_owner editing a user from another branch")
	reportLog("confirmed branch_owner cannot edit a user outside their branch (403)")

	// A parent has no admin-edit rights over anyone, including their own child.
	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.UserBase+fmt.Sprintf("/api/v1/users/%d", editStudentID), resources.ParentToken, map[string]any{
		"first_name": "ShouldBeRejected",
	})
	if err != nil {
		failf(t, "parent update user request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "a parent using the admin user-edit endpoint")
	reportLog("confirmed a parent cannot use the admin edit endpoint, even on their own child (403)")

	// 1.14 - owner deactivates then reactivates the disposable student.
	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.UserBase+fmt.Sprintf("/api/v1/users/%d/status", editStudentID), resources.OwnerToken, map[string]any{
		"is_active": false,
	})
	if err != nil {
		failf(t, "deactivate user failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "deactivate user expected 200, got %d", respStatus)
	}
	reportLog("deactivated user %d", editStudentID)

	respStatus, statusBody, _, err := doJSONRequest(client, "GET", cfg.UserBase+fmt.Sprintf("/api/v1/users/%d", editStudentID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "re-fetch deactivated user failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "re-fetch deactivated user expected 200, got %d", respStatus)
	}
	statusMap, ok := statusBody.(map[string]any)
	if !ok {
		failf(t, "re-fetch deactivated user response is not JSON object")
	}
	if active, ok := statusMap["is_active"].(bool); !ok || active {
		failf(t, "expected deactivated user is_active=false, got %#v", statusMap["is_active"])
	}
	reportLog("confirmed user %d is_active=false after deactivation", editStudentID)

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.UserBase+fmt.Sprintf("/api/v1/users/%d/status", editStudentID), resources.OwnerToken, map[string]any{
		"is_active": true,
	})
	if err != nil {
		failf(t, "reactivate user failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "reactivate user expected 200, got %d", respStatus)
	}
	reportLog("reactivated user %d", editStudentID)

	// The status route is owner-only at the router level - a branch_owner
	// must be rejected outright, even for their own branch's user.
	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.UserBase+fmt.Sprintf("/api/v1/users/%d/status", editStudentID), branchOwnerToken, map[string]any{
		"is_active": false,
	})
	if err != nil {
		failf(t, "branch_owner set user status request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "branch_owner setting a user's active status")
	reportLog("confirmed branch_owner cannot toggle a user's active status (403)")

	// 1.15 - tutor status: owner can set any value; branch_owner can set
	// active/vacation/sick_leave for their own branch's tutors but not
	// "inactive"; other roles are rejected outright by the router.
	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.UserBase+fmt.Sprintf("/api/v1/tutors/%d/status", resources.TutorID), resources.OwnerToken, map[string]any{
		"status": "vacation",
	})
	if err != nil {
		failf(t, "owner set tutor status failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "owner set tutor status expected 200, got %d", respStatus)
	}
	reportLog("owner set tutor %d status to vacation", resources.TutorID)

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.UserBase+fmt.Sprintf("/api/v1/tutors/%d/status", resources.TutorID), branchOwnerToken, map[string]any{
		"status": "sick_leave",
	})
	if err != nil {
		failf(t, "branch_owner set tutor status failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "branch_owner set tutor status expected 200, got %d", respStatus)
	}
	reportLog("confirmed branch_owner can set their own branch's tutor status to sick_leave")

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.UserBase+fmt.Sprintf("/api/v1/tutors/%d/status", resources.TutorID), branchOwnerToken, map[string]any{
		"status": "inactive",
	})
	if err != nil {
		failf(t, "branch_owner set tutor inactive request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "branch_owner setting a tutor status to inactive")
	reportLog("confirmed branch_owner cannot set a tutor status to inactive (403)")

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.UserBase+fmt.Sprintf("/api/v1/tutors/%d/status", resources.TutorID), resources.OwnerToken, map[string]any{
		"status": "not-a-real-status",
	})
	if err != nil {
		failf(t, "owner set tutor status to invalid value request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusBadRequest, "setting a tutor status to an invalid value")
	reportLog("confirmed an invalid tutor status value is rejected")

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.UserBase+fmt.Sprintf("/api/v1/tutors/%d/status", resources.TutorID), resources.ParentToken, map[string]any{
		"status": "active",
	})
	if err != nil {
		failf(t, "parent set tutor status request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "a parent setting a tutor's status")
	reportLog("confirmed a parent cannot set a tutor's status (403)")

	// Reset the shared tutor back to active so later scenarios see a normal tutor.
	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.UserBase+fmt.Sprintf("/api/v1/tutors/%d/status", resources.TutorID), resources.OwnerToken, map[string]any{
		"status": "active",
	})
	if err != nil {
		failf(t, "reset tutor status to active failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "reset tutor status to active expected 200, got %d", respStatus)
	}
	reportLog("reset tutor %d status back to active", resources.TutorID)
}

// testContractsLifecycle exercises fetching a single contract, listing
// contracts (both owner-only per api-contracts.md 3.2/3.3), and moving a
// contract through a status transition.
func testContractsLifecycle(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	respStatus, body, _, err := doJSONRequest(client, "GET", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d", resources.ContractID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "get contract failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "get contract expected 200, got %d", respStatus)
	}
	contractMap, ok := body.(map[string]any)
	if !ok {
		failf(t, "get contract response is not JSON object")
	}
	if id, ok := parseNumericID(contractMap["id"]); !ok || id != resources.ContractID {
		failf(t, "get contract returned wrong id: %#v", contractMap["id"])
	}
	reportLog("fetched contract %d", resources.ContractID)

	// Listing contracts is owner-only (api-contracts.md 3.2) - there is no
	// parent-facing contract list; parents only get the lightweight /expiry
	// endpoint (3.3a).
	respStatus, listBody, _, err := doJSONRequest(client, "GET", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts?student_id=%d", resources.StudentID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "list contracts failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "list contracts expected 200, got %d", respStatus)
	}
	listMap, ok := listBody.(map[string]any)
	if !ok {
		failf(t, "list contracts response is not JSON object")
	}
	items, ok := listMap["items"].([]any)
	if !ok {
		failf(t, "list contracts response missing items")
	}
	found := false
	for _, item := range items {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if id, ok := parseNumericID(row["id"]); ok && id == resources.ContractID {
			found = true
			break
		}
	}
	if !found {
		failf(t, "contract %d not found in student's contract list", resources.ContractID)
	}
	reportLog("owner can see contract %d in contract list", resources.ContractID)

	// Contracts are created directly with status "active" (there is no
	// separate "sign" step/endpoint - see api-contracts.md 3.1). Exercise the
	// real status-transition endpoint (3.5, owner-only, no response body)
	// instead, then confirm the change via GetByID.
	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d/status", resources.ContractID), resources.OwnerToken, map[string]any{
		"status": "completed",
	})
	if err != nil {
		failf(t, "update contract status failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "update contract status expected 200, got %d", respStatus)
	}
	reportLog("contract %d status update request accepted", resources.ContractID)

	respStatus, updatedBody, _, err := doJSONRequest(client, "GET", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d", resources.ContractID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "re-fetch contract failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "re-fetch contract expected 200, got %d", respStatus)
	}
	updatedMap, ok := updatedBody.(map[string]any)
	if !ok {
		failf(t, "re-fetch contract response is not JSON object")
	}
	if status, _ := updatedMap["status"].(string); status != "completed" {
		failf(t, "expected contract status to be completed, got %q", status)
	}
	reportLog("contract %d transitioned to status \"completed\"", resources.ContractID)
}

// testContractsValidationAndAccessControl exercises contracts-service input
// validation (api-contracts.md 3.1) and the role/ownership checks around
// GetByID/expiry (3.2/3.3/3.3a) that testContractsLifecycle does not cover.
func testContractsValidationAndAccessControl(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	start := time.Now().Add(24 * time.Hour).Format("2006-01-02")
	end := time.Now().Add(31 * 24 * time.Hour).Format("2006-01-02")

	// Only owner may create contracts - a parent must be rejected.
	respStatus, _, _, err := doJSONRequest(client, "POST", cfg.ContractsBase+"/api/v1/contracts", resources.ParentToken, map[string]any{
		"student_id": resources.StudentID, "parent_id": resources.ParentID,
		"course_id": resources.CourseID, "branch_id": resources.BranchID,
		"amount": 1000.0, "start_date": start, "end_date": end,
	})
	if err != nil {
		failf(t, "parent create contract request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "parent creating a contract")
	reportLog("confirmed parent role cannot create contracts (403)")

	badPayloads := []struct {
		name string
		body map[string]any
	}{
		{"missing student_id", map[string]any{"parent_id": resources.ParentID, "course_id": resources.CourseID, "branch_id": resources.BranchID, "amount": 1000.0, "start_date": start, "end_date": end}},
		{"non-positive amount", map[string]any{"student_id": resources.StudentID, "parent_id": resources.ParentID, "course_id": resources.CourseID, "branch_id": resources.BranchID, "amount": 0.0, "start_date": start, "end_date": end}},
		{"end_date before start_date", map[string]any{"student_id": resources.StudentID, "parent_id": resources.ParentID, "course_id": resources.CourseID, "branch_id": resources.BranchID, "amount": 1000.0, "start_date": end, "end_date": start}},
		{"malformed start_date", map[string]any{"student_id": resources.StudentID, "parent_id": resources.ParentID, "course_id": resources.CourseID, "branch_id": resources.BranchID, "amount": 1000.0, "start_date": "not-a-date", "end_date": end}},
	}
	for _, tc := range badPayloads {
		respStatus, _, _, err := doJSONRequest(client, "POST", cfg.ContractsBase+"/api/v1/contracts", resources.OwnerToken, tc.body)
		if err != nil {
			failf(t, "create contract (%s) request failed: %v", tc.name, err)
		}
		expectStatus(t, respStatus, http.StatusBadRequest, "creating a contract with "+tc.name)
	}
	reportLog("confirmed contract creation validation rejects malformed payloads")

	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.ContractsBase+"/api/v1/contracts/999999999", resources.OwnerToken, nil)
	if err != nil {
		failf(t, "get nonexistent contract failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusNotFound, "fetching a nonexistent contract")
	reportLog("confirmed nonexistent contract returns 404")

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d/status", resources.ContractID), resources.OwnerToken, map[string]any{
		"status": "not_a_real_status",
	})
	if err != nil {
		failf(t, "update contract status with bad value failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusBadRequest, "updating contract status to an invalid value")
	reportLog("confirmed invalid contract status value is rejected")

	// A branch_owner from a different branch must not see this contract's expiry.
	otherBranchID := createBranch(t, client, cfg.UserBase, resources.OwnerToken)
	otherBranchOwnerToken := makeToken(t, cfg.JWTSecret, int64(800000000)+otherBranchID, "branch_owner", &otherBranchID)
	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d/expiry", resources.ContractID), otherBranchOwnerToken, nil)
	if err != nil {
		failf(t, "expiry lookup by unrelated branch owner failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "branch_owner of a different branch reading contract expiry")
	reportLog("confirmed branch_owner from another branch cannot read this contract's expiry")

	// A parent unrelated to this student must not see the contract's expiry either.
	otherParentEmail := fmt.Sprintf("parent-contracts-unrelated+%d@test.local", time.Now().UnixNano())
	otherParent := registerParent(t, client, cfg.UserBase, otherParentEmail, "Password123!")
	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d/expiry", resources.ContractID), otherParent.AccessToken, nil)
	if err != nil {
		failf(t, "expiry lookup by unrelated parent failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "unrelated parent reading contract expiry")
	reportLog("confirmed a parent outside the family cannot read this contract's expiry")
}

// testContractsCRUD exercises contracts-service field updates and hard
// delete (api-contracts.md 3.4/3.6) on a disposable contract, so it never
// touches resources.ContractID that other scenarios still rely on.
func testContractsCRUD(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	contractID := createContract(t, cfg.ContractsBase, client, resources.OwnerToken, resources.StudentID, resources.ParentID, resources.CourseID, resources.BranchID)
	reportLog("created disposable contract %d for CRUD checks", contractID)

	newAmount := 20000.0
	respStatus, _, _, err := doJSONRequest(client, "PATCH", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d", contractID), resources.OwnerToken, map[string]any{
		"amount": newAmount,
	})
	if err != nil {
		failf(t, "update contract fields failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "update contract fields expected 200, got %d", respStatus)
	}
	reportLog("updated contract %d amount to %.0f", contractID, newAmount)

	respStatus, refetched, _, err := doJSONRequest(client, "GET", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d", contractID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "re-fetch updated contract failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "re-fetch updated contract expected 200, got %d", respStatus)
	}
	refetchedMap, ok := refetched.(map[string]any)
	if !ok {
		failf(t, "re-fetch updated contract response is not JSON object")
	}
	amount, ok := refetchedMap["amount"].(json.Number)
	if !ok {
		failf(t, "re-fetched contract amount is not numeric: %#v", refetchedMap["amount"])
	}
	if f, _ := amount.Float64(); f != newAmount {
		failf(t, "expected contract amount %v, got %v", newAmount, f)
	}
	reportLog("confirmed contract %d amount persisted as %.0f", contractID, newAmount)

	// A parent must not be able to update contract fields (owner-only).
	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d", contractID), resources.ParentToken, map[string]any{
		"amount": 1.0,
	})
	if err != nil {
		failf(t, "parent update contract fields request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "parent updating contract fields")
	reportLog("confirmed parent role cannot update contract fields (403)")

	// A parent must not be able to delete a contract either.
	respStatus, _, _, err = doJSONRequest(client, "DELETE", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d", contractID), resources.ParentToken, nil)
	if err != nil {
		failf(t, "parent delete contract request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "parent deleting a contract")
	reportLog("confirmed parent role cannot delete contracts (403)")

	respStatus, _, _, err = doJSONRequest(client, "DELETE", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d", contractID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "delete contract failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "delete contract expected 200, got %d", respStatus)
	}
	reportLog("deleted contract %d", contractID)

	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d", contractID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "re-fetch deleted contract failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusNotFound, "fetching a deleted contract")
	reportLog("confirmed deleted contract %d no longer exists (404)", contractID)
}

// testContractsPaymentStatus exercises the owner-only manual payment-marking
// endpoint (api-contracts.md 3.6), which none of the other contract
// scenarios call.
func testContractsPaymentStatus(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	contractID := createContract(t, cfg.ContractsBase, client, resources.OwnerToken, resources.StudentID, resources.ParentID, resources.CourseID, resources.BranchID)
	reportLog("created disposable contract %d for payment-status checks", contractID)

	respStatus, _, _, err := doJSONRequest(client, "PATCH", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d/payment-status", contractID), resources.OwnerToken, map[string]any{
		"payment_status": "paid",
	})
	if err != nil {
		failf(t, "mark contract paid failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "mark contract paid expected 200, got %d", respStatus)
	}
	reportLog("marked contract %d as paid", contractID)

	respStatus, contractBody, _, err := doJSONRequest(client, "GET", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d", contractID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "re-fetch contract after payment update failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "re-fetch contract after payment update expected 200, got %d", respStatus)
	}
	contractMap, ok := contractBody.(map[string]any)
	if !ok {
		failf(t, "contract response is not JSON object")
	}
	if status, _ := contractMap["payment_status"].(string); status != "paid" {
		failf(t, "expected contract payment_status=paid, got %#v", contractMap["payment_status"])
	}
	reportLog("confirmed contract %d payment_status persisted as paid", contractID)

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d/payment-status", contractID), resources.OwnerToken, map[string]any{
		"payment_status": "not-a-real-status",
	})
	if err != nil {
		failf(t, "mark contract with invalid payment status request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusBadRequest, "setting an invalid payment_status value")
	reportLog("confirmed an invalid payment_status value is rejected")

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d/payment-status", contractID), resources.ParentToken, map[string]any{
		"payment_status": "unpaid",
	})
	if err != nil {
		failf(t, "parent mark contract payment status request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "a parent updating a contract's payment status")
	reportLog("confirmed a parent cannot update a contract's payment status (403)")

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.ContractsBase+"/api/v1/contracts/999999999/payment-status", resources.OwnerToken, map[string]any{
		"payment_status": "paid",
	})
	if err != nil {
		failf(t, "mark nonexistent contract paid request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusNotFound, "marking a nonexistent contract's payment status")
	reportLog("confirmed marking a nonexistent contract's payment status returns 404")
}

// testAcademicLessonAndAttendance creates a lesson for the course used in the
// workflow, marks a student present, and verifies the attendance record is readable.
func testAcademicLessonAndAttendance(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	lessonDate := time.Now().Add(48 * time.Hour).Format("2006-01-02")
	respStatus, body, _, err := doJSONRequest(client, "POST", cfg.AcademicBase+"/api/v1/academic/lessons", resources.OwnerToken, map[string]any{
		"course_id":   resources.CourseID,
		"tutor_id":    resources.TutorID,
		"topic":       "Load Test Lesson",
		"lesson_date": lessonDate,
		"start_time":  "10:00",
		"end_time":    "10:45",
	})
	if err != nil {
		failf(t, "create lesson failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		failf(t, "create lesson expected 201, got %d", respStatus)
	}
	lessonID := mustGetInt64(body, "id", t)
	reportLog("created lesson %d for course %d", lessonID, resources.CourseID)

	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/lessons/%d/attendance", lessonID), resources.OwnerToken, map[string]any{
		"records": []map[string]any{
			{"student_id": resources.StudentID, "status": "present"},
		},
	})
	if err != nil {
		failf(t, "mark attendance failed: %v", err)
	}
	if respStatus != http.StatusCreated && respStatus != http.StatusOK {
		failf(t, "mark attendance expected 200/201, got %d", respStatus)
	}
	reportLog("marked attendance present for student %d on lesson %d", resources.StudentID, lessonID)

	respStatus, listBody, _, err := doJSONRequest(client, "GET", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/lessons/%d/attendance", lessonID), resources.ParentToken, nil)
	if err != nil {
		failf(t, "list attendance failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "list attendance expected 200, got %d", respStatus)
	}
	listMap, ok := listBody.(map[string]any)
	if !ok {
		failf(t, "list attendance response is not JSON object")
	}
	items, ok := listMap["items"].([]any)
	if !ok {
		failf(t, "list attendance response missing items")
	}
	found := false
	for _, item := range items {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id, idOK := parseNumericID(row["student_id"])
		status, _ := row["status"].(string)
		if idOK && id == resources.StudentID && status == "present" {
			found = true
			break
		}
	}
	if !found {
		failf(t, "expected attendance record with status present for student %d on lesson %d", resources.StudentID, lessonID)
	}
	reportLog("verified attendance record for student %d on lesson %d", resources.StudentID, lessonID)
}

// testAcademicValidationAndAccessControl exercises academic-service input
// validation and the tutor/branch_owner/parent scoping rules around lessons
// and attendance (api-contracts.md 2.8/2.9/2.10/2.11) that
// testAcademicLessonAndAttendance does not cover.
func testAcademicValidationAndAccessControl(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	respStatus, _, _, err := doJSONRequest(client, "POST", cfg.AcademicBase+"/api/v1/academic/lessons", resources.OwnerToken, map[string]any{
		"course_id": resources.CourseID,
	})
	if err != nil {
		failf(t, "create lesson with missing fields request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusBadRequest, "creating a lesson with missing required fields")
	reportLog("confirmed lesson creation validation rejects incomplete payloads")

	lessonDate := time.Now().Add(72 * time.Hour).Format("2006-01-02")

	// A parent must not be able to create lessons.
	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.AcademicBase+"/api/v1/academic/lessons", resources.ParentToken, map[string]any{
		"course_id": resources.CourseID, "tutor_id": resources.TutorID, "topic": "Should Be Rejected",
		"lesson_date": lessonDate, "start_time": "11:00", "end_time": "11:45",
	})
	if err != nil {
		failf(t, "parent create lesson request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "parent creating a lesson")
	reportLog("confirmed parent role cannot create lessons (403)")

	// A tutor must not be able to create a lesson under a different tutor_id.
	tutorToken := makeToken(t, cfg.JWTSecret, resources.TutorID, "tutor", &resources.BranchID)
	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.AcademicBase+"/api/v1/academic/lessons", tutorToken, map[string]any{
		"course_id": resources.CourseID, "tutor_id": resources.TutorID + 123456, "topic": "Should Be Rejected",
		"lesson_date": lessonDate, "start_time": "12:00", "end_time": "12:45",
	})
	if err != nil {
		failf(t, "tutor create lesson for another tutor request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "tutor creating a lesson under a different tutor_id")
	reportLog("confirmed a tutor cannot create lessons on behalf of another tutor")

	// Create a real lesson to exercise attendance validation and access control against.
	respStatus, body, _, err := doJSONRequest(client, "POST", cfg.AcademicBase+"/api/v1/academic/lessons", resources.OwnerToken, map[string]any{
		"course_id": resources.CourseID, "tutor_id": resources.TutorID, "topic": "Validation Lesson",
		"lesson_date": lessonDate, "start_time": "13:00", "end_time": "13:45",
	})
	if err != nil {
		failf(t, "create lesson for validation checks failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusCreated, "creating the lesson used for validation checks")
	lessonID := mustGetInt64(body, "id", t)
	reportLog("created lesson %d to exercise attendance validation/access checks", lessonID)

	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/lessons/%d/attendance", lessonID), resources.OwnerToken, map[string]any{
		"records": []map[string]any{
			{"student_id": resources.StudentID, "status": "not_a_real_status"},
		},
	})
	if err != nil {
		failf(t, "mark attendance with invalid status request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusBadRequest, "marking attendance with an invalid status value")
	reportLog("confirmed invalid attendance status value is rejected")

	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.AcademicBase+"/api/v1/academic/lessons/999999999/attendance", resources.OwnerToken, nil)
	if err != nil {
		failf(t, "get attendance for nonexistent lesson failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusNotFound, "fetching attendance for a nonexistent lesson")
	reportLog("confirmed nonexistent lesson returns 404")

	// A parent whose child does not attend this lesson must not see attendance.
	otherParentEmail := fmt.Sprintf("parent-academic-unrelated+%d@test.local", time.Now().UnixNano())
	otherParent := registerParent(t, client, cfg.UserBase, otherParentEmail, "Password123!")
	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/lessons/%d/attendance", lessonID), otherParent.AccessToken, nil)
	if err != nil {
		failf(t, "get attendance by unrelated parent failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "unrelated parent reading lesson attendance")
	reportLog("confirmed a parent whose child doesn't attend the lesson cannot read attendance")
}

// testCoursesCRUD exercises academic-service course update/delete
// (api-contracts.md 2.2/2.3), owner-only, on a disposable course.
func testCoursesCRUD(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	courseID := createCourse(t, client, cfg.AcademicBase, resources.OwnerToken, resources.BranchID)
	reportLog("created disposable course %d for CRUD checks", courseID)

	newTitle := "Load Test Mathematics (Updated)"
	respStatus, body, _, err := doJSONRequest(client, "PATCH", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/courses/%d", courseID), resources.OwnerToken, map[string]any{
		"title": newTitle,
	})
	if err != nil {
		failf(t, "update course failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "update course expected 200, got %d", respStatus)
	}
	bodyMap, ok := body.(map[string]any)
	if !ok {
		failf(t, "update course response is not JSON object")
	}
	if title, _ := bodyMap["title"].(string); title != newTitle {
		failf(t, "expected updated course title %q, got %#v", newTitle, bodyMap["title"])
	}
	reportLog("updated course %d title", courseID)

	// Course update/delete is owner-only - a branch_owner must be rejected.
	branchOwnerToken := makeToken(t, cfg.JWTSecret, int64(800000000)+resources.BranchID, "branch_owner", &resources.BranchID)
	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/courses/%d", courseID), branchOwnerToken, map[string]any{
		"title": "Should Be Rejected",
	})
	if err != nil {
		failf(t, "branch_owner update course request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "branch_owner updating a course")
	reportLog("confirmed branch_owner role cannot update courses (403)")

	respStatus, _, _, err = doJSONRequest(client, "DELETE", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/courses/%d", courseID), branchOwnerToken, nil)
	if err != nil {
		failf(t, "branch_owner delete course request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "branch_owner deleting a course")
	reportLog("confirmed branch_owner role cannot delete courses (403)")

	respStatus, _, _, err = doJSONRequest(client, "DELETE", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/courses/%d", courseID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "delete course failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "delete course expected 200, got %d", respStatus)
	}
	reportLog("deleted course %d", courseID)

	respStatus, _, _, err = doJSONRequest(client, "DELETE", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/courses/%d", courseID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "re-delete course failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusNotFound, "deleting an already-deleted course")
	reportLog("confirmed deleting an already-deleted course returns 404")
}

// testEnrollmentsCRUD exercises academic-service enrollment progress
// updates and tutor assignment (api-contracts.md 2.4a/2.6) on a disposable
// enrollment, independent of the enrollment auto-created from
// resources.ContractID via the contract.created event.
func testEnrollmentsCRUD(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	respStatus, body, _, err := doJSONRequest(client, "POST", cfg.AcademicBase+"/api/v1/academic/enrollments", resources.OwnerToken, map[string]any{
		"student_id": resources.StudentID,
		"course_id":  resources.CourseID,
	})
	if err != nil {
		failf(t, "create enrollment failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		failf(t, "create enrollment expected 201, got %d", respStatus)
	}
	enrollmentID := mustGetInt64(body, "id", t)
	reportLog("created disposable enrollment %d for CRUD checks", enrollmentID)

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/enrollments/%d/assign-tutor", enrollmentID), resources.OwnerToken, map[string]any{
		"tutor_id": resources.TutorID,
	})
	if err != nil {
		failf(t, "assign tutor to enrollment failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "assign tutor to enrollment expected 200, got %d", respStatus)
	}
	reportLog("assigned tutor %d to enrollment %d", resources.TutorID, enrollmentID)

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/enrollments/%d", enrollmentID), resources.OwnerToken, map[string]any{
		"progress_pct": 42,
	})
	if err != nil {
		failf(t, "update enrollment progress failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "update enrollment progress expected 200, got %d", respStatus)
	}
	reportLog("updated enrollment %d progress to 42%%", enrollmentID)

	// A parent must not be able to assign tutors or update enrollments
	// (owner/branch_owner/tutor only).
	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/enrollments/%d/assign-tutor", enrollmentID), resources.ParentToken, map[string]any{
		"tutor_id": resources.TutorID,
	})
	if err != nil {
		failf(t, "parent assign tutor request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "parent assigning a tutor to an enrollment")
	reportLog("confirmed parent role cannot assign tutors (403)")

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/enrollments/%d", enrollmentID), resources.ParentToken, map[string]any{
		"progress_pct": 100,
	})
	if err != nil {
		failf(t, "parent update enrollment request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "parent updating enrollment progress")
	reportLog("confirmed parent role cannot update enrollment progress (403)")

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.AcademicBase+"/api/v1/academic/enrollments/999999999/assign-tutor", resources.OwnerToken, map[string]any{
		"tutor_id": resources.TutorID,
	})
	if err != nil {
		failf(t, "assign tutor to nonexistent enrollment failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusNotFound, "assigning a tutor to a nonexistent enrollment")
	reportLog("confirmed assigning a tutor to a nonexistent enrollment returns 404")
}

// testLessonsCRUD exercises academic-service lesson updates and deletion
// (api-contracts.md 2.9) on a disposable lesson, independent of the lesson
// created in testAcademicLessonAndAttendance.
func testLessonsCRUD(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	lessonDate := time.Now().Add(96 * time.Hour).Format("2006-01-02")
	respStatus, body, _, err := doJSONRequest(client, "POST", cfg.AcademicBase+"/api/v1/academic/lessons", resources.OwnerToken, map[string]any{
		"course_id":   resources.CourseID,
		"tutor_id":    resources.TutorID,
		"topic":       "CRUD Test Lesson",
		"lesson_date": lessonDate,
		"start_time":  "14:00",
		"end_time":    "14:45",
	})
	if err != nil {
		failf(t, "create lesson for CRUD checks failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		failf(t, "create lesson for CRUD checks expected 201, got %d", respStatus)
	}
	lessonID := mustGetInt64(body, "id", t)
	reportLog("created disposable lesson %d for CRUD checks", lessonID)

	newTopic := "CRUD Test Lesson (Updated)"
	respStatus, updatedBody, _, err := doJSONRequest(client, "PATCH", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/lessons/%d", lessonID), resources.OwnerToken, map[string]any{
		"topic": newTopic,
	})
	if err != nil {
		failf(t, "update lesson failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "update lesson expected 200, got %d", respStatus)
	}
	updatedMap, ok := updatedBody.(map[string]any)
	if !ok {
		failf(t, "update lesson response is not JSON object")
	}
	if topic, _ := updatedMap["topic"].(string); topic != newTopic {
		failf(t, "expected updated lesson topic %q, got %#v", newTopic, updatedMap["topic"])
	}
	reportLog("updated lesson %d topic", lessonID)

	// A parent must not be able to update or delete lessons.
	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/lessons/%d", lessonID), resources.ParentToken, map[string]any{
		"topic": "Should Be Rejected",
	})
	if err != nil {
		failf(t, "parent update lesson request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "parent updating a lesson")
	reportLog("confirmed parent role cannot update lessons (403)")

	respStatus, _, _, err = doJSONRequest(client, "DELETE", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/lessons/%d", lessonID), resources.ParentToken, nil)
	if err != nil {
		failf(t, "parent delete lesson request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "parent deleting a lesson")
	reportLog("confirmed parent role cannot delete lessons (403)")

	respStatus, _, _, err = doJSONRequest(client, "DELETE", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/lessons/%d", lessonID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "delete lesson failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "delete lesson expected 200, got %d", respStatus)
	}
	reportLog("deleted lesson %d", lessonID)

	respStatus, _, _, err = doJSONRequest(client, "DELETE", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/lessons/%d", lessonID), resources.OwnerToken, nil)
	if err != nil {
		failf(t, "re-delete lesson failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusNotFound, "deleting an already-deleted lesson")
	reportLog("confirmed deleting an already-deleted lesson returns 404")
}

// testHomeworkLifecycle exercises the homework flow that no other scenario
// touches: a tutor assigns homework, the assigned student opens it (which
// flips its status from "assigned" to "viewed" and redirects to the link),
// and role/visibility restrictions are enforced (api-contracts.md
// 2.12/2.13/2.14).
func testHomeworkLifecycle(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	tutorToken := makeToken(t, cfg.JWTSecret, resources.TutorID, "tutor", &resources.BranchID)
	studentToken := makeToken(t, cfg.JWTSecret, resources.StudentID, "student", &resources.BranchID)

	respStatus, _, _, err := doJSONRequest(client, "POST", cfg.AcademicBase+"/api/v1/academic/homework", tutorToken, map[string]any{
		"student_id": resources.StudentID,
	})
	if err != nil {
		failf(t, "create homework with missing fields request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusBadRequest, "creating homework without link_url")
	reportLog("confirmed homework creation validation rejects incomplete payloads")

	// Only a tutor may assign homework.
	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.AcademicBase+"/api/v1/academic/homework", resources.ParentToken, map[string]any{
		"student_id": resources.StudentID, "link_url": "https://example.com/homework/should-be-rejected",
	})
	if err != nil {
		failf(t, "parent create homework request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "parent assigning homework")
	reportLog("confirmed parent role cannot assign homework (403)")

	respStatus, body, _, err := doJSONRequest(client, "POST", cfg.AcademicBase+"/api/v1/academic/homework", tutorToken, map[string]any{
		"student_id": resources.StudentID, "link_url": "https://example.com/homework/load-test",
	})
	if err != nil {
		failf(t, "create homework failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		failf(t, "create homework expected 201, got %d", respStatus)
	}
	homeworkID := mustGetInt64(body, "id", t)
	reportLog("tutor %d assigned homework %d to student %d", resources.TutorID, homeworkID, resources.StudentID)

	respStatus, listBody, _, err := doJSONRequest(client, "GET", cfg.AcademicBase+"/api/v1/academic/homework", tutorToken, nil)
	if err != nil {
		failf(t, "tutor list homework failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "tutor list homework expected 200, got %d", respStatus)
	}
	if !homeworkListContains(listBody, homeworkID, t) {
		failf(t, "expected homework %d in tutor's own homework list", homeworkID)
	}
	reportLog("confirmed tutor sees homework %d in their own list", homeworkID)

	respStatus, parentListBody, _, err := doJSONRequest(client, "GET", cfg.AcademicBase+"/api/v1/academic/homework", resources.ParentToken, nil)
	if err != nil {
		failf(t, "parent list homework failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "parent list homework expected 200, got %d", respStatus)
	}
	if !homeworkListContains(parentListBody, homeworkID, t) {
		failf(t, "expected homework %d in parent's children's homework list", homeworkID)
	}
	reportLog("confirmed parent sees homework %d for their child", homeworkID)

	// A different student must not be able to open this homework.
	otherStudentID := createStudent(t, client, cfg.UserBase, resources.ParentToken, resources.BranchID, resources.ParentID)
	otherStudentToken := makeToken(t, cfg.JWTSecret, otherStudentID, "student", &resources.BranchID)
	noRedirectClient := &http.Client{
		Timeout: client.Timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	respStatus, _, _, err = doJSONRequest(noRedirectClient, "GET", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/homework/%d/open", homeworkID), otherStudentToken, nil)
	if err != nil {
		failf(t, "other student open homework request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "a different student opening someone else's homework")
	reportLog("confirmed a student cannot open another student's homework (403)")

	// The assigned student opens it: expect a redirect (302) to link_url.
	respStatus, _, _, err = doJSONRequest(noRedirectClient, "GET", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/homework/%d/open", homeworkID), studentToken, nil)
	if err != nil {
		failf(t, "open homework failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusFound, "the assigned student opening their homework")
	reportLog("student %d opened homework %d (redirected to link)", resources.StudentID, homeworkID)

	// Status should now have flipped from "assigned" to "viewed".
	respStatus, viewedListBody, _, err := doJSONRequest(client, "GET", cfg.AcademicBase+"/api/v1/academic/homework?status=viewed", tutorToken, nil)
	if err != nil {
		failf(t, "list viewed homework failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "list viewed homework expected 200, got %d", respStatus)
	}
	if !homeworkListContains(viewedListBody, homeworkID, t) {
		failf(t, "expected homework %d to have status \"viewed\" after being opened", homeworkID)
	}
	reportLog("confirmed homework %d status flipped to \"viewed\" after opening", homeworkID)

	respStatus, _, _, err = doJSONRequest(noRedirectClient, "GET", cfg.AcademicBase+"/api/v1/academic/homework/999999999/open", studentToken, nil)
	if err != nil {
		failf(t, "open nonexistent homework request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusNotFound, "opening a nonexistent homework item")
	reportLog("confirmed opening a nonexistent homework item returns 404")
}

// homeworkListContains reports whether a GET /academic/homework response
// body contains an item with the given id.
func homeworkListContains(body any, homeworkID int64, t *testing.T) bool {
	t.Helper()
	bodyMap, ok := body.(map[string]any)
	if !ok {
		failf(t, "homework list response is not JSON object")
	}
	items, ok := bodyMap["items"].([]any)
	if !ok {
		failf(t, "homework list response missing items")
	}
	for _, item := range items {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if id, ok := parseNumericID(row["id"]); ok && id == homeworkID {
			return true
		}
	}
	return false
}

// testNotificationSettingsAndRead reads and updates a parent's notification
// preferences, then verifies an unread notification can be marked as read.
func testNotificationSettingsAndRead(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	respStatus, body, _, err := doJSONRequest(client, "GET", cfg.NotificationBase+"/api/v1/notifications/settings", resources.ParentToken, nil)
	if err != nil {
		failf(t, "get notification settings failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "get notification settings expected 200, got %d", respStatus)
	}
	var settings notificationSettingsResponse
	decodeJSONMap(body, &settings, t)
	reportLog("fetched notification settings: email=%v sms=%v messenger=%v", settings.EmailEnabled, settings.SMSEnabled, settings.MessengerEnabled)

	respStatus, updatedBody, _, err := doJSONRequest(client, "PATCH", cfg.NotificationBase+"/api/v1/notifications/settings", resources.ParentToken, map[string]any{
		"sms_enabled": !settings.SMSEnabled,
	})
	if err != nil {
		failf(t, "update notification settings failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "update notification settings expected 200, got %d", respStatus)
	}
	var updatedSettings notificationSettingsResponse
	decodeJSONMap(updatedBody, &updatedSettings, t)
	if updatedSettings.SMSEnabled == settings.SMSEnabled {
		failf(t, "expected sms_enabled to toggle from %v", settings.SMSEnabled)
	}
	reportLog("toggled sms_enabled from %v to %v", settings.SMSEnabled, updatedSettings.SMSEnabled)

	respStatus, listBody, _, err := doJSONRequest(client, "GET", cfg.NotificationBase+"/api/v1/notifications?unread_only=true", resources.ParentToken, nil)
	if err != nil {
		failf(t, "list notifications failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "list notifications expected 200, got %d", respStatus)
	}
	listMap, ok := listBody.(map[string]any)
	if !ok {
		failf(t, "list notifications response is not JSON object")
	}
	items, _ := listMap["items"].([]any)
	if len(items) == 0 {
		reportNote("no unread notifications present for parent yet; skipping mark-as-read verification")
		return
	}
	first, ok := items[0].(map[string]any)
	if !ok {
		failf(t, "notification item is not JSON object")
	}
	notifID, ok := parseNumericID(first["id"])
	if !ok {
		failf(t, "notification item missing numeric id")
	}

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.NotificationBase+fmt.Sprintf("/api/v1/notifications/%d/read", notifID), resources.ParentToken, nil)
	if err != nil {
		failf(t, "mark notification read failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "mark notification read expected 200, got %d", respStatus)
	}
	reportLog("marked notification %d as read", notifID)

	respStatus, unreadBody, _, err := doJSONRequest(client, "GET", cfg.NotificationBase+"/api/v1/notifications?unread_only=true", resources.ParentToken, nil)
	if err != nil {
		failf(t, "list unread notifications after read failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "list unread notifications after read expected 200, got %d", respStatus)
	}
	unreadMap, ok := unreadBody.(map[string]any)
	if !ok {
		failf(t, "list unread notifications response is not JSON object")
	}
	unreadItems, _ := unreadMap["items"].([]any)
	for _, item := range unreadItems {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if id, ok := parseNumericID(row["id"]); ok && id == notifID {
			failf(t, "notification %d still present in unread list after marking read", notifID)
		}
	}
	reportLog("confirmed notification %d no longer present in unread list", notifID)
}

// testNotificationsAccessControl exercises notification-service auth
// enforcement and not-found handling that testNotificationSettingsAndRead
// does not cover.
func testNotificationsAccessControl(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	respStatus, _, _, err := doJSONRequest(client, "GET", cfg.NotificationBase+"/api/v1/notifications", "", nil)
	if err != nil {
		failf(t, "list notifications without a token failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusUnauthorized, "listing notifications without a bearer token")
	reportLog("confirmed notifications endpoint rejects requests without a token")

	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.NotificationBase+"/api/v1/notifications", "not-a-real-jwt", nil)
	if err != nil {
		failf(t, "list notifications with a malformed token failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusUnauthorized, "listing notifications with a malformed token")
	reportLog("confirmed notifications endpoint rejects a malformed token")

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.NotificationBase+"/api/v1/notifications/999999999/read", resources.ParentToken, nil)
	if err != nil {
		failf(t, "mark nonexistent notification read failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusNotFound, "marking a nonexistent notification as read")
	reportLog("confirmed marking a nonexistent notification as read returns 404")
}

// testCRMValidationAndAccessControl exercises crm-service input validation
// and the parent/owner role split (api-contracts.md 4.2/4.3/4.4/4.5) that
// testCRMToNotificationFlow does not cover.
// testCRMWebhookIntake exercises the unauthenticated Tilda webhook intake
// (api-contracts.md 4.1), which none of the other CRM scenarios call since
// they all use the internal, JWT-protected application endpoints.
func testCRMWebhookIntake(t *testing.T, cfg config, client *http.Client) {
	t.Helper()

	payload := map[string]any{
		"name":             "Load Test Иванов",
		"age":              9,
		"phone":            fmt.Sprintf("+7900%07d", time.Now().UnixNano()%10000000),
		"subject_interest": "Робототехника",
		"parent_name":      "Load Test Родитель",
	}
	rawBody, err := json.Marshal(payload)
	if err != nil {
		failf(t, "marshal webhook payload failed: %v", err)
	}

	status, err := postWebhook(client, cfg.CRMBase+"/api/v1/crm/applications/webhook", rawBody, cfg.CRMWebhookSecret)
	if err != nil {
		failf(t, "tilda webhook request failed: %v", err)
	}
	if status != http.StatusOK {
		failf(t, "tilda webhook expected 200, got %d", status)
	}
	reportLog("tilda webhook accepted a new application")

	invalidBody, err := json.Marshal(map[string]any{"age": 9})
	if err != nil {
		failf(t, "marshal invalid webhook payload failed: %v", err)
	}
	status, err = postWebhook(client, cfg.CRMBase+"/api/v1/crm/applications/webhook", invalidBody, cfg.CRMWebhookSecret)
	if err != nil {
		failf(t, "tilda webhook missing-name request failed: %v", err)
	}
	expectStatus(t, status, http.StatusBadRequest, "posting a webhook application without a name")
	reportLog("confirmed the webhook rejects a payload without a name")

	if cfg.CRMWebhookSecret == "" {
		reportNote("TILDA_WEBHOOK_SECRET is not set - skipping the invalid-signature check (signature verification is disabled server-side under this configuration too)")
		return
	}

	req, err := http.NewRequestWithContext(context.Background(), "POST", cfg.CRMBase+"/api/v1/crm/applications/webhook", bytes.NewReader(rawBody))
	if err != nil {
		failf(t, "build invalid-signature webhook request failed: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tilda-Signature", "0000invalidsignature0000")
	resp, err := client.Do(req)
	if err != nil {
		failf(t, "invalid-signature webhook request failed: %v", err)
	}
	defer resp.Body.Close()
	expectStatus(t, resp.StatusCode, http.StatusUnauthorized, "posting a webhook with an invalid X-Tilda-Signature")
	reportLog("confirmed the webhook rejects an invalid signature")
}

// postWebhook posts a Tilda-style webhook payload, signing it with HMAC-SHA256
// when a secret is configured (mirroring crm-service's own validSignature check).
func postWebhook(client *http.Client, url string, rawBody []byte, secret string) (int, error) {
	req, err := http.NewRequestWithContext(context.Background(), "POST", url, bytes.NewReader(rawBody))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(rawBody)
		req.Header.Set("X-Tilda-Signature", hex.EncodeToString(mac.Sum(nil)))
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

func testCRMValidationAndAccessControl(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	// Only a parent may submit an application through the internal endpoint.
	respStatus, _, _, err := doJSONRequest(client, "POST", cfg.CRMBase+"/api/v1/crm/applications", resources.OwnerToken, map[string]any{
		"student_id": resources.StudentID, "subject_interest": "Физика",
	})
	if err != nil {
		failf(t, "owner create application request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "owner submitting a CRM application")
	reportLog("confirmed owner role cannot submit CRM applications (403)")

	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.CRMBase+"/api/v1/crm/applications", resources.ParentToken, map[string]any{
		"subject_interest": "Физика",
	})
	if err != nil {
		failf(t, "create application with missing student_id request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusBadRequest, "submitting a CRM application without student_id")
	reportLog("confirmed CRM application validation rejects a missing student_id")

	// A parent must not be able to list applications (owner-only).
	respStatus, _, _, err = doJSONRequest(client, "GET", cfg.CRMBase+"/api/v1/crm/applications", resources.ParentToken, nil)
	if err != nil {
		failf(t, "parent list applications request failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusForbidden, "parent listing CRM applications")
	reportLog("confirmed parent role cannot list CRM applications (403)")

	// Create a real application to exercise status-update validation against.
	respStatus, body, _, err := doJSONRequest(client, "POST", cfg.CRMBase+"/api/v1/crm/applications", resources.ParentToken, map[string]any{
		"student_id": resources.StudentID, "subject_interest": "Химия", "format": "offline",
	})
	if err != nil {
		failf(t, "create application for validation checks failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusCreated, "creating the application used for validation checks")
	applicationID := mustGetInt64(body, "id", t)
	reportLog("created application %d to exercise status validation", applicationID)

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.CRMBase+fmt.Sprintf("/api/v1/crm/applications/%d", applicationID), resources.OwnerToken, map[string]any{
		"status": "not_a_real_status",
	})
	if err != nil {
		failf(t, "update application status with bad value failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusBadRequest, "updating a CRM application to an invalid status")
	reportLog("confirmed invalid CRM application status value is rejected")

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.CRMBase+"/api/v1/crm/applications/999999999", resources.OwnerToken, map[string]any{
		"status": "in_progress",
	})
	if err != nil {
		failf(t, "update nonexistent application failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusNotFound, "updating a nonexistent CRM application")
	reportLog("confirmed updating a nonexistent CRM application returns 404")

	respStatus, _, _, err = doJSONRequest(client, "DELETE", cfg.CRMBase+"/api/v1/crm/applications/999999999", resources.OwnerToken, nil)
	if err != nil {
		failf(t, "delete nonexistent application failed: %v", err)
	}
	expectStatus(t, respStatus, http.StatusNotFound, "deleting a nonexistent CRM application")
	reportLog("confirmed deleting a nonexistent CRM application returns 404")
}

func loginParent(t *testing.T, client *http.Client, baseURL, email, password string) (loginResponse, *http.Cookie) {
	t.Helper()

	respStatus, body, _, cookies, err := doJSONRequestCookie(client, "POST", baseURL+"/api/v1/auth/login", "", map[string]any{"login": email, "password": password}, nil)
	if err != nil {
		failf(t, "login failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "login expected 200, got %d", respStatus)
	}
	var result loginResponse
	decodeJSONMap(body, &result, t)
	rc := refreshCookieFrom(cookies)
	if rc == nil {
		failf(t, "login response is missing the sr_refresh_token cookie")
	}
	return result, rc
}

// refreshToken обновляет access-токен, отправляя refresh-cookie, полученную
// от loginParent (или от предыдущего вызова refreshToken — токен
// ротируется при каждом обновлении). Возвращает новую cookie для следующей
// ротации.
func refreshToken(t *testing.T, client *http.Client, baseURL string, cookie *http.Cookie) (loginResponse, *http.Cookie) {
	t.Helper()

	respStatus, body, _, cookies, err := doJSONRequestCookie(client, "POST", baseURL+"/api/v1/auth/refresh", "", nil, cookie)
	if err != nil {
		failf(t, "token refresh failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "token refresh expected 200, got %d", respStatus)
	}
	var result loginResponse
	decodeJSONMap(body, &result, t)
	rc := refreshCookieFrom(cookies)
	if rc == nil {
		failf(t, "refresh response is missing the rotated sr_refresh_token cookie")
	}
	return result, rc
}

func setupUserWorkflow(t *testing.T, cfg config, client *http.Client, parentEmail, parentPassword string) workflowResources {
	t.Helper()

	resources := workflowResources{
		OwnerToken:     makeToken(t, cfg.JWTSecret, 9999, "owner", nil),
		ParentEmail:    parentEmail,
		ParentPassword: parentPassword,
	}

	registered := registerParent(t, client, cfg.UserBase, resources.ParentEmail, resources.ParentPassword)
	resources.ParentToken = registered.AccessToken
	resources.ParentID = registered.UserID
	reportLog("registered parent %s with user id %d", resources.ParentEmail, resources.ParentID)

	resources.BranchID = createBranch(t, client, cfg.UserBase, resources.OwnerToken)
	reportLog("created branch %d", resources.BranchID)

	resources.TutorID = createTutor(t, client, cfg.UserBase, resources.OwnerToken, resources.BranchID)
	reportLog("created tutor %d", resources.TutorID)

	resources.CourseID = createCourse(t, client, cfg.AcademicBase, resources.OwnerToken, resources.BranchID)
	reportLog("created course %d", resources.CourseID)

	resources.StudentID = createStudent(t, client, cfg.UserBase, resources.ParentToken, resources.BranchID, resources.ParentID)
	reportLog("created student %d for parent %d", resources.StudentID, resources.ParentID)

	resources.ContractID = createContract(t, cfg.ContractsBase, client, resources.OwnerToken, resources.StudentID, resources.ParentID, resources.CourseID, resources.BranchID)
	reportLog("created contract %d for student %d", resources.ContractID, resources.StudentID)

	return resources
}

func createBranch(t *testing.T, client *http.Client, baseURL, ownerToken string) int64 {
	respStatus, body, _, err := doJSONRequest(client, "POST", baseURL+"/api/v1/branches", ownerToken, map[string]any{
		"name": "Load Test Branch",
		"city": "Testopolis",
	})
	if err != nil {
		failf(t, "create branch failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		failf(t, "create branch expected 201, got %d", respStatus)
	}
	return mustGetInt64(body, "id", t)
}

func createTutor(t *testing.T, client *http.Client, baseURL, ownerToken string, branchID int64) int64 {
	respStatus, body, _, err := doJSONRequest(client, "POST", baseURL+"/api/v1/users/tutors", ownerToken, map[string]any{
		"email":          fmt.Sprintf("tutor+%d@test.local", time.Now().UnixNano()),
		"last_name":      "Сидоров",
		"first_name":     "Пётр",
		"branch_id":      branchID,
		"specialization": "Математика",
	})
	if err != nil {
		failf(t, "create tutor failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		failf(t, "create tutor expected 201, got %d", respStatus)
	}
	bodyMap, ok := body.(map[string]any)
	if !ok {
		failf(t, "create tutor response is not JSON object")
	}
	user, ok := bodyMap["user"].(map[string]any)
	if !ok {
		failf(t, "create tutor response missing user object")
	}
	id, ok := parseNumericID(user["id"])
	if !ok {
		failf(t, "create tutor response user.id is not numeric: %#v", user["id"])
	}
	return id
}

func createCourse(t *testing.T, client *http.Client, baseURL, ownerToken string, branchID int64) int64 {
	respStatus, body, _, err := doJSONRequest(client, "POST", baseURL+"/api/v1/academic/courses", ownerToken, map[string]any{
		"title":     "Load Test Mathematics",
		"subject":   "Mathematics",
		"format":    "individual",
		"branch_id": branchID,
	})
	if err != nil {
		failf(t, "create course failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		failf(t, "create course expected 201, got %d", respStatus)
	}
	return mustGetInt64(body, "id", t)
}

func createStudent(t *testing.T, client *http.Client, baseURL, parentToken string, branchID, parentID int64) int64 {
	respStatus, body, _, err := doJSONRequest(client, "POST", baseURL+"/api/v1/users/students", parentToken, map[string]any{
		"last_name":  "Иванова",
		"first_name": "Анна",
		"parent_id":  parentID,
		"branch_id":  branchID,
		"class_info": "5Б",
		"school":     "Школа №1",
	})
	if err != nil {
		failf(t, "create student failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		failf(t, "create student expected 201, got %d", respStatus)
	}
	return mustGetInt64(body, "id", t)
}

func createContract(t *testing.T, baseURL string, client *http.Client, ownerToken string, studentID, parentID, courseID, branchID int64) int64 {
	start := time.Now().Add(24 * time.Hour).Format("2006-01-02")
	end := time.Now().Add(31 * 24 * time.Hour).Format("2006-01-02")
	respStatus, body, _, err := doJSONRequest(client, "POST", baseURL+"/api/v1/contracts", ownerToken, map[string]any{
		"student_id": studentID,
		"parent_id":  parentID,
		"course_id":  courseID,
		"branch_id":  branchID,
		"amount":     15000.0,
		"start_date": start,
		"end_date":   end,
	})
	if err != nil {
		failf(t, "create contract failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		failf(t, "create contract expected 201, got %d", respStatus)
	}
	return mustGetInt64(body, "id", t)
}

func testAcademicEnrollmentFromContract(t *testing.T, cfg config, client *http.Client, parentToken string, studentID int64) {
	t.Helper()

	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		respStatus, body, _, err := doJSONRequest(client, "GET", cfg.AcademicBase+"/api/v1/academic/enrollments", parentToken, nil)
		if err != nil {
			failf(t, "list enrollments failed: %v", err)
		}
		if respStatus != http.StatusOK {
			failf(t, "list enrollments expected 200, got %d", respStatus)
		}
		bodyMap, ok := body.(map[string]any)
		if !ok {
			failf(t, "list enrollments response is not JSON object")
		}
		items, ok := bodyMap["items"].([]any)
		if !ok {
			failf(t, "list enrollments response missing items")
		}
		for _, item := range items {
			row, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if id, ok := parseNumericID(row["student_id"]); ok && id == studentID {
				reportLog("found enrollment for student %d", studentID)
				return
			}
		}
		reportLog("waiting for academic enrollment for student %d", studentID)
		time.Sleep(1 * time.Second)
	}
	fail(t, "academic enrollment was not created after contract event")
}

func testCRMToNotificationFlow(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	// CRM resolves who to notify about a new application in two steps
	// (see crm-service/internal/handlers/application_handler.go,
	// resolveNotifyTarget): first it looks for a branch_owner of the
	// application's branch; only if none exists does it fall back to
	// "any owner" - and that fallback picks the lowest user_id with
	// role=owner across the *entire* database, which after many runs is
	// some pre-existing real owner, not whatever id we make up here. So
	// instead of seeding a fake "owner" and hoping it wins the fallback,
	// we seed a branch_owner scoped to the branch this run just created
	// (branch ids are unique per run, so this can't collide with another
	// run's leftover data) and use the higher-priority branch_owner path.
	notifyUserID := int64(900000000) + resources.BranchID
	publishUserCreatedEvent(t, cfg.NATSUrl, notifyUserID, "branchowner+load@test.local", "Branch", "Owner", "branch_owner", &resources.BranchID)
	reportLog("seeded branch_owner user.created event for user id %d (branch %d)", notifyUserID, resources.BranchID)
	// Give CRM/Notification subscribers time to process the seeded event.
	time.Sleep(2 * time.Second)

	respStatus, _, _, err := doJSONRequest(client, "POST", cfg.CRMBase+"/api/v1/crm/applications", resources.ParentToken, map[string]any{
		"student_id":       resources.StudentID,
		"subject_interest": "Математика",
		"format":           "online",
	})
	if err != nil {
		failf(t, "crm create application failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		failf(t, "crm create application expected 201, got %d", respStatus)
	}

	notifyToken := makeToken(t, cfg.JWTSecret, notifyUserID, "branch_owner", &resources.BranchID)

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		respStatus, notifyBody, _, err := doJSONRequest(client, "GET", cfg.NotificationBase+"/api/v1/notifications?unread_only=true", notifyToken, nil)
		if err != nil {
			failf(t, "list notifications failed: %v", err)
		}
		if respStatus != http.StatusOK {
			failf(t, "list notifications expected 200, got %d", respStatus)
		}
		notifyMap, ok := notifyBody.(map[string]any)
		if !ok {
			failf(t, "notifications response is not JSON object")
		}
		items, ok := notifyMap["items"].([]any)
		if !ok {
			failf(t, "notifications response missing items")
		}
		for _, item := range items {
			notif, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if typ, ok := notif["type"].(string); ok && typ == "new_application" {
				reportLog("received CRM notification new_application for branch owner %d", notifyUserID)
				return
			}
		}
		reportLog("waiting for notification service to receive CRM event")
		time.Sleep(1 * time.Second)
	}
	fail(t, "notification service did not receive CRM application event")
}

func publishUserCreatedEvent(t *testing.T, natsURL string, userID int64, email, firstName, lastName, role string, branchID *int64) {
	t.Helper()

	nc, err := nats.Connect(natsURL, nats.MaxReconnects(-1), nats.ReconnectWait(2*time.Second))
	if err != nil {
		failf(t, "connect to NATS failed: %v", err)
	}
	defer nc.Close()

	payload := map[string]any{
		"id":         userID,
		"email":      email,
		"first_name": firstName,
		"last_name":  lastName,
		"role":       role,
	}
	if branchID != nil {
		payload["branch_id"] = *branchID
	}
	data, err := json.Marshal(payload)
	if err != nil {
		failf(t, "marshal NATS event failed: %v", err)
	}
	if err := nc.Publish("user.created", data); err != nil {
		failf(t, "publish NATS user.created failed: %v", err)
	}
}

func registerParent(t *testing.T, client *http.Client, baseURL, email, password string) registerResponse {
	t.Helper()
	respStatus, result, _, err := doJSONRequest(client, "POST", baseURL+"/api/v1/auth/register", "", map[string]any{
		"email":      email,
		"password":   password,
		"last_name":  "Петрова",
		"first_name": "Ирина",
	})
	if err != nil {
		failf(t, "register parent failed: %v", err)
	}
	if respStatus != http.StatusOK {
		failf(t, "register parent expected 200, got %d", respStatus)
	}
	var resultObj registerResponse
	decodeJSONMap(result, &resultObj, t)
	if resultObj.UserID == 0 || resultObj.AccessToken == "" {
		failf(t, "unexpected register response: %+v", resultObj)
	}
	return resultObj
}

func makeToken(t *testing.T, secret string, userID int64, role string, branchID *int64) string {
	t.Helper()
	claims := accessClaims{
		UserID:   userID,
		Role:     role,
		BranchID: branchID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "access",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(2 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	jwtToken := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token, err := jwtToken.SignedString([]byte(secret))
	if err != nil {
		failf(t, "failed to sign token: %v", err)
	}
	return token
}

func doJSONRequest(client *http.Client, method, url, token string, body any) (status int, out any, raw []byte, err error) {
	status, out, raw, _, err = doJSONRequestCookie(client, method, url, token, body, nil)
	return
}

// doJSONRequestCookie — то же самое, что doJSONRequest, но дополнительно
// умеет отправить cookie в запросе и возвращает Set-Cookie из ответа.
// Нужен специально для /auth/refresh и /auth/logout: после перехода на
// httpOnly cookie для refresh-токена (см. user-service/internal/handlers/
// cookies.go) он больше не передаётся в JSON-теле. Клиент в этом файле
// намеренно БЕЗ cookiejar на http.Client — сценарии этого файла массово
// логинят разных пользователей на одном общем client конкурентно, и общий
// jar перезаписывал бы cookie одного пользователя другим. Поэтому cookie
// каждого симулированного пользователя явно прокидывается через параметры
// этой функции, а не через встроенный jar.
func doJSONRequestCookie(client *http.Client, method, url, token string, body any, cookie *http.Cookie) (status int, out any, raw []byte, cookies []*http.Cookie, err error) {
	start := time.Now()
	defer func() {
		elapsed := time.Since(start).Round(time.Millisecond)
		if status != 0 {
			reportLog("%s %s -> %d (%s)", method, shortURL(url), status, elapsed)
		} else if err != nil {
			reportLog("%s %s -> error after %s: %v", method, shortURL(url), elapsed, err)
		}
	}()

	var payload io.Reader
	if body != nil {
		rawBody, marshalErr := json.Marshal(body)
		if marshalErr != nil {
			err = marshalErr
			return
		}
		payload = bytes.NewReader(rawBody)
	}

	req, reqErr := http.NewRequestWithContext(context.Background(), method, url, payload)
	if reqErr != nil {
		err = reqErr
		return
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}

	resp, doErr := client.Do(req)
	if doErr != nil {
		err = doErr
		return
	}
	defer resp.Body.Close()
	status = resp.StatusCode
	cookies = resp.Cookies()

	respRaw, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		err = readErr
		return
	}
	raw = respRaw

	if len(raw) == 0 {
		return
	}

	if strings.Contains(resp.Header.Get("Content-Type"), "application/json") {
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		var decoded any
		if decodeErr := dec.Decode(&decoded); decodeErr != nil {
			err = decodeErr
			return
		}
		out = decoded
	} else {
		out = string(raw)
	}
	return
}

// refreshCookieFrom ищет cookie с refresh-токеном (sr_refresh_token) среди
// Set-Cookie заголовков ответа /auth/login или /auth/refresh.
func refreshCookieFrom(cookies []*http.Cookie) *http.Cookie {
	for _, c := range cookies {
		if c.Name == "sr_refresh_token" {
			return c
		}
	}
	return nil
}

// shortURL trims a full request URL down to path+query so log lines in
// report.md stay readable instead of repeating the service base URL on
// every line.
func shortURL(raw string) string {
	if u, parseErr := neturl.Parse(raw); parseErr == nil && u.Path != "" {
		if u.RawQuery != "" {
			return u.Path + "?" + u.RawQuery
		}
		return u.Path
	}
	return raw
}

// expectStatus is a small assertion helper used by the negative-path/RBAC
// scenarios below, where a single scenario checks many different endpoints
// and repeating the same 4-line if-block for each would drown out intent.
func expectStatus(t *testing.T, got, want int, action string) {
	t.Helper()
	if got != want {
		failf(t, "%s: expected status %d, got %d", action, want, got)
	}
}

func decodeJSONMap(source any, dest any, t *testing.T) {
	t.Helper()
	m, ok := source.(map[string]any)
	if !ok {
		failf(t, "expected JSON object, got %T", source)
	}
	raw, err := json.Marshal(m)
	if err != nil {
		failf(t, "marshal JSON object: %v", err)
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		failf(t, "unmarshal into struct failed: %v", err)
	}
}

func mustGetInt64(body any, key string, t *testing.T) int64 {
	t.Helper()
	m, ok := body.(map[string]any)
	if !ok {
		failf(t, "response body is not JSON object: %T", body)
	}
	value, exists := m[key]
	if !exists {
		failf(t, "response missing %q", key)
	}
	id, ok := parseNumericID(value)
	if !ok {
		failf(t, "response %q is not numeric: %#v", key, value)
	}
	return id
}

func parseNumericID(value any) (int64, bool) {
	switch v := value.(type) {
	case float64:
		return int64(v), true
	case int:
		return int64(v), true
	case int64:
		return v, true
	case json.Number:
		if i, err := v.Int64(); err == nil {
			return i, true
		}
		return 0, false
	default:
		return 0, false
	}
}
