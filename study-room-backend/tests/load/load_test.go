package load

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

type registerResponse struct {
	UserID       int64  `json:"user_id"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

type loginResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	User         struct {
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
		t.Fatalf("cross-service tests cannot run because services are not available: %s", loadReport.StartupError)
	}

	runScenario(t, "HealthzAndDocs", func(t *testing.T) {
		testHealthzAndDocs(t, cfg, client)
	})

	resources := workflowResources{ParentEmail: fmt.Sprintf("parent+%d@test.local", time.Now().UnixNano()), ParentPassword: "Password123!"}
	runScenario(t, "InitialSetup", func(t *testing.T) {
		resources = setupUserWorkflow(t, cfg, client, resources.ParentEmail, resources.ParentPassword)
	})

	runScenario(t, "UserAuthenticationAndDirectory", func(t *testing.T) {
		testUserAuthenticationAndDirectory(t, cfg, client, resources)
	})

	runScenario(t, "ContractsLifecycle", func(t *testing.T) {
		testContractsLifecycle(t, cfg, client, resources)
	})

	runScenario(t, "AcademicLessonAndAttendance", func(t *testing.T) {
		testAcademicLessonAndAttendance(t, cfg, client, resources)
	})

	runScenario(t, "NotificationSettingsAndRead", func(t *testing.T) {
		testNotificationSettingsAndRead(t, cfg, client, resources)
	})

	runScenario(t, "AcademicEnrollmentFromContract", func(t *testing.T) {
		testAcademicEnrollmentFromContract(t, cfg, client, resources.OwnerToken, resources.ParentToken, resources.StudentID)
	})

	runScenario(t, "CRMToNotificationFlow", func(t *testing.T) {
		testCRMToNotificationFlow(t, cfg, client, resources.OwnerToken, resources.ParentToken, resources.StudentID)
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
	b.WriteString(fmt.Sprintf("- jwt-secret: %s\n\n", jwtSecretNote))
	if loadReport.Skipped {
		b.WriteString(fmt.Sprintf("## Skipped\n\n%s\n\n", loadReport.SkipReason))
	}
	if loadReport.StartupError != "" {
		b.WriteString("## Service availability check failed\n\n")
		b.WriteString(fmt.Sprintf("%s\n\n", loadReport.StartupError))
	}
	b.WriteString("## Scenario results\n\n")
	for _, scenario := range loadReport.Scenarios {
		b.WriteString(fmt.Sprintf("### %s\n\n", scenario.Name))
		b.WriteString(fmt.Sprintf("- status: %s\n", scenario.Status))
		b.WriteString(fmt.Sprintf("- duration: %s\n", scenario.Duration))
		if len(scenario.Notes) > 0 {
			b.WriteString("- notes:\n")
			for _, note := range scenario.Notes {
				b.WriteString(fmt.Sprintf("  - %s\n", note))
			}
		}
		if len(scenario.Logs) > 0 {
			b.WriteString("- details:\n")
			for _, log := range scenario.Logs {
				b.WriteString(fmt.Sprintf("  - %s\n", log))
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
				t.Fatalf("%s failed %s: %v", service, endpoint, err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("%s %s returned %d", service, endpoint, resp.StatusCode)
			}
			reportLog("OK %s %s", service, endpoint)
		}
	}
}

func testUserAuthenticationAndDirectory(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	loginResp := loginParent(t, client, cfg.UserBase, resources.ParentEmail, resources.ParentPassword)
	if loginResp.User.ID != resources.ParentID {
		t.Fatalf("logged-in user id=%d does not match created parent id=%d", loginResp.User.ID, resources.ParentID)
	}
	reportLog("parent login success for user %d", loginResp.User.ID)

	refreshResp := refreshToken(t, client, cfg.UserBase, loginResp.RefreshToken)
	reportLog("refresh token returned new access token")

	respStatus, meBody, _, err := doJSONRequest(client, "GET", cfg.UserBase+"/api/v1/users/me", refreshResp.AccessToken, nil)
	if err != nil {
		t.Fatalf("fetch me failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("fetch me expected 200, got %d", respStatus)
	}
	meMap, ok := meBody.(map[string]any)
	if !ok {
		t.Fatalf("users/me response is not JSON object")
	}
	if id, ok := parseNumericID(meMap["id"]); !ok || id != resources.ParentID {
		t.Fatalf("users/me returned wrong id: %#v", meMap["id"])
	}
	reportLog("users/me returned parent profile for id %d", resources.ParentID)

	newName := "Ирина"
	respStatus, updatedBody, _, err := doJSONRequest(client, "PATCH", cfg.UserBase+"/api/v1/users/me", refreshResp.AccessToken, map[string]any{"first_name": newName})
	if err != nil {
		t.Fatalf("update me failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("update me expected 200, got %d", respStatus)
	}
	updatedMap, ok := updatedBody.(map[string]any)
	if !ok {
		t.Fatalf("update me response is not JSON object")
	}
	if name, ok := updatedMap["first_name"].(string); !ok || name != newName {
		t.Fatalf("expected first_name %q, got %#v", newName, updatedMap["first_name"])
	}
	reportLog("updated parent first_name to %s", newName)

	respStatus, childrenBody, _, err := doJSONRequest(client, "GET", cfg.UserBase+fmt.Sprintf("/api/v1/parents/%d/children", resources.ParentID), resources.ParentToken, nil)
	if err != nil {
		t.Fatalf("list children failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("list children expected 200, got %d", respStatus)
	}
	childrenMap, ok := childrenBody.(map[string]any)
	if !ok {
		t.Fatalf("list children response is not JSON object")
	}
	children, ok := childrenMap["items"].([]any)
	if !ok {
		t.Fatalf("list children response missing items")
	}
	if len(children) == 0 {
		t.Fatal("expected at least one child for parent")
	}
	reportLog("parent has %d child(ren)", len(children))
}

// testContractsLifecycle exercises reading a single contract, listing contracts
// scoped to a parent/student, and moving a contract through its sign transition.
func testContractsLifecycle(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	respStatus, body, _, err := doJSONRequest(client, "GET", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d", resources.ContractID), resources.OwnerToken, nil)
	if err != nil {
		t.Fatalf("get contract failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("get contract expected 200, got %d", respStatus)
	}
	contractMap, ok := body.(map[string]any)
	if !ok {
		t.Fatalf("get contract response is not JSON object")
	}
	if id, ok := parseNumericID(contractMap["id"]); !ok || id != resources.ContractID {
		t.Fatalf("get contract returned wrong id: %#v", contractMap["id"])
	}
	reportLog("fetched contract %d", resources.ContractID)

	respStatus, listBody, _, err := doJSONRequest(client, "GET", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts?student_id=%d", resources.StudentID), resources.ParentToken, nil)
	if err != nil {
		t.Fatalf("list contracts failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("list contracts expected 200, got %d", respStatus)
	}
	listMap, ok := listBody.(map[string]any)
	if !ok {
		t.Fatalf("list contracts response is not JSON object")
	}
	items, ok := listMap["items"].([]any)
	if !ok {
		t.Fatalf("list contracts response missing items")
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
		t.Fatalf("contract %d not found in student's contract list", resources.ContractID)
	}
	reportLog("parent can see contract %d in contract list", resources.ContractID)

	respStatus, signedBody, _, err := doJSONRequest(client, "PATCH", cfg.ContractsBase+fmt.Sprintf("/api/v1/contracts/%d/sign", resources.ContractID), resources.ParentToken, nil)
	if err != nil {
		t.Fatalf("sign contract failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("sign contract expected 200, got %d", respStatus)
	}
	signedMap, ok := signedBody.(map[string]any)
	if !ok {
		t.Fatalf("sign contract response is not JSON object")
	}
	status, _ := signedMap["status"].(string)
	if status != "active" && status != "signed" {
		t.Fatalf("expected contract status to be active/signed after signing, got %q", status)
	}
	reportLog("contract %d transitioned to status %q after signing", resources.ContractID, status)
}

// testAcademicLessonAndAttendance creates a lesson for the course used in the
// workflow, marks a student present, and verifies the attendance record is readable.
func testAcademicLessonAndAttendance(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	lessonStart := time.Now().Add(48 * time.Hour).Format(time.RFC3339)
	respStatus, body, _, err := doJSONRequest(client, "POST", cfg.AcademicBase+"/api/v1/academic/lessons", resources.OwnerToken, map[string]any{
		"course_id":        resources.CourseID,
		"topic":            "Load Test Lesson",
		"starts_at":        lessonStart,
		"duration_minutes": 45,
	})
	if err != nil {
		t.Fatalf("create lesson failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		t.Fatalf("create lesson expected 201, got %d", respStatus)
	}
	lessonID := mustGetInt64(body, "id", t)
	reportLog("created lesson %d for course %d", lessonID, resources.CourseID)

	respStatus, _, _, err = doJSONRequest(client, "POST", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/lessons/%d/attendance", lessonID), resources.OwnerToken, map[string]any{
		"student_id": resources.StudentID,
		"status":     "present",
	})
	if err != nil {
		t.Fatalf("mark attendance failed: %v", err)
	}
	if respStatus != http.StatusCreated && respStatus != http.StatusOK {
		t.Fatalf("mark attendance expected 200/201, got %d", respStatus)
	}
	reportLog("marked attendance present for student %d on lesson %d", resources.StudentID, lessonID)

	respStatus, listBody, _, err := doJSONRequest(client, "GET", cfg.AcademicBase+fmt.Sprintf("/api/v1/academic/lessons/%d/attendance", lessonID), resources.ParentToken, nil)
	if err != nil {
		t.Fatalf("list attendance failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("list attendance expected 200, got %d", respStatus)
	}
	listMap, ok := listBody.(map[string]any)
	if !ok {
		t.Fatalf("list attendance response is not JSON object")
	}
	items, ok := listMap["items"].([]any)
	if !ok {
		t.Fatalf("list attendance response missing items")
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
		t.Fatalf("expected attendance record with status present for student %d on lesson %d", resources.StudentID, lessonID)
	}
	reportLog("verified attendance record for student %d on lesson %d", resources.StudentID, lessonID)
}

// testNotificationSettingsAndRead reads and updates a parent's notification
// preferences, then verifies an unread notification can be marked as read.
func testNotificationSettingsAndRead(t *testing.T, cfg config, client *http.Client, resources workflowResources) {
	t.Helper()

	respStatus, body, _, err := doJSONRequest(client, "GET", cfg.NotificationBase+"/api/v1/notifications/settings", resources.ParentToken, nil)
	if err != nil {
		t.Fatalf("get notification settings failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("get notification settings expected 200, got %d", respStatus)
	}
	var settings notificationSettingsResponse
	decodeJSONMap(body, &settings, t)
	reportLog("fetched notification settings: email=%v sms=%v messenger=%v", settings.EmailEnabled, settings.SMSEnabled, settings.MessengerEnabled)

	respStatus, updatedBody, _, err := doJSONRequest(client, "PATCH", cfg.NotificationBase+"/api/v1/notifications/settings", resources.ParentToken, map[string]any{
		"sms_enabled": !settings.SMSEnabled,
	})
	if err != nil {
		t.Fatalf("update notification settings failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("update notification settings expected 200, got %d", respStatus)
	}
	var updatedSettings notificationSettingsResponse
	decodeJSONMap(updatedBody, &updatedSettings, t)
	if updatedSettings.SMSEnabled == settings.SMSEnabled {
		t.Fatalf("expected sms_enabled to toggle from %v", settings.SMSEnabled)
	}
	reportLog("toggled sms_enabled from %v to %v", settings.SMSEnabled, updatedSettings.SMSEnabled)

	respStatus, listBody, _, err := doJSONRequest(client, "GET", cfg.NotificationBase+"/api/v1/notifications?unread_only=true", resources.ParentToken, nil)
	if err != nil {
		t.Fatalf("list notifications failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("list notifications expected 200, got %d", respStatus)
	}
	listMap, ok := listBody.(map[string]any)
	if !ok {
		t.Fatalf("list notifications response is not JSON object")
	}
	items, _ := listMap["items"].([]any)
	if len(items) == 0 {
		reportNote("no unread notifications present for parent yet; skipping mark-as-read verification")
		return
	}
	first, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("notification item is not JSON object")
	}
	notifID, ok := parseNumericID(first["id"])
	if !ok {
		t.Fatalf("notification item missing numeric id")
	}

	respStatus, _, _, err = doJSONRequest(client, "PATCH", cfg.NotificationBase+fmt.Sprintf("/api/v1/notifications/%d/read", notifID), resources.ParentToken, nil)
	if err != nil {
		t.Fatalf("mark notification read failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("mark notification read expected 200, got %d", respStatus)
	}
	reportLog("marked notification %d as read", notifID)

	respStatus, unreadBody, _, err := doJSONRequest(client, "GET", cfg.NotificationBase+"/api/v1/notifications?unread_only=true", resources.ParentToken, nil)
	if err != nil {
		t.Fatalf("list unread notifications after read failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("list unread notifications after read expected 200, got %d", respStatus)
	}
	unreadMap, ok := unreadBody.(map[string]any)
	if !ok {
		t.Fatalf("list unread notifications response is not JSON object")
	}
	unreadItems, _ := unreadMap["items"].([]any)
	for _, item := range unreadItems {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if id, ok := parseNumericID(row["id"]); ok && id == notifID {
			t.Fatalf("notification %d still present in unread list after marking read", notifID)
		}
	}
	reportLog("confirmed notification %d no longer present in unread list", notifID)
}

func loginParent(t *testing.T, client *http.Client, baseURL, email, password string) loginResponse {
	t.Helper()

	respStatus, body, _, err := doJSONRequest(client, "POST", baseURL+"/api/v1/auth/login", "", map[string]any{"login": email, "password": password})
	if err != nil {
		t.Fatalf("login failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("login expected 200, got %d", respStatus)
	}
	var result loginResponse
	decodeJSONMap(body, &result, t)
	return result
}

func refreshToken(t *testing.T, client *http.Client, baseURL, refreshToken string) loginResponse {
	t.Helper()

	respStatus, body, _, err := doJSONRequest(client, "POST", baseURL+"/api/v1/auth/refresh", "", map[string]any{"refresh_token": refreshToken})
	if err != nil {
		t.Fatalf("token refresh failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("token refresh expected 200, got %d", respStatus)
	}
	var result loginResponse
	decodeJSONMap(body, &result, t)
	return result
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
		t.Fatalf("create branch failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		t.Fatalf("create branch expected 201, got %d", respStatus)
	}
	return mustGetInt64(body, "id", t)
}

func createCourse(t *testing.T, client *http.Client, baseURL, ownerToken string, branchID int64) int64 {
	respStatus, body, _, err := doJSONRequest(client, "POST", baseURL+"/api/v1/academic/courses", ownerToken, map[string]any{
		"title":     "Load Test Mathematics",
		"subject":   "Mathematics",
		"format":    "individual",
		"branch_id": branchID,
	})
	if err != nil {
		t.Fatalf("create course failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		t.Fatalf("create course expected 201, got %d", respStatus)
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
		t.Fatalf("create student failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		t.Fatalf("create student expected 201, got %d", respStatus)
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
		t.Fatalf("create contract failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		t.Fatalf("create contract expected 201, got %d", respStatus)
	}
	return mustGetInt64(body, "id", t)
}

func testAcademicEnrollmentFromContract(t *testing.T, cfg config, client *http.Client, ownerToken, parentToken string, studentID int64) {
	t.Helper()

	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		respStatus, body, _, err := doJSONRequest(client, "GET", cfg.AcademicBase+"/api/v1/academic/enrollments", parentToken, nil)
		if err != nil {
			t.Fatalf("list enrollments failed: %v", err)
		}
		if respStatus != http.StatusOK {
			t.Fatalf("list enrollments expected 200, got %d", respStatus)
		}
		bodyMap, ok := body.(map[string]any)
		if !ok {
			t.Fatalf("list enrollments response is not JSON object")
		}
		items, ok := bodyMap["items"].([]any)
		if !ok {
			t.Fatalf("list enrollments response missing items")
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
	t.Fatal("academic enrollment was not created after contract event")
}

func testCRMToNotificationFlow(t *testing.T, cfg config, client *http.Client, ownerToken, parentToken string, studentID int64) {
	t.Helper()

	ownerUserID := int64(9999)
	publishUserCreatedEvent(t, cfg.NATSUrl, ownerUserID, "owner@test.local", "Owner", "Service", "owner", nil)
	reportLog("seeded owner user.created event for user id %d", ownerUserID)
	// Give CRM/Notification subscribers time to process the seeded owner event.
	time.Sleep(2 * time.Second)

	respStatus, _, _, err := doJSONRequest(client, "POST", cfg.CRMBase+"/api/v1/crm/applications", parentToken, map[string]any{
		"student_id":       studentID,
		"subject_interest": "Математика",
		"format":           "online",
	})
	if err != nil {
		t.Fatalf("crm create application failed: %v", err)
	}
	if respStatus != http.StatusCreated {
		t.Fatalf("crm create application expected 201, got %d", respStatus)
	}

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		respStatus, notifyBody, _, err := doJSONRequest(client, "GET", cfg.NotificationBase+"/api/v1/notifications?unread_only=true", ownerToken, nil)
		if err != nil {
			t.Fatalf("list notifications failed: %v", err)
		}
		if respStatus != http.StatusOK {
			t.Fatalf("list notifications expected 200, got %d", respStatus)
		}
		notifyMap, ok := notifyBody.(map[string]any)
		if !ok {
			t.Fatalf("notifications response is not JSON object")
		}
		items, ok := notifyMap["items"].([]any)
		if !ok {
			t.Fatalf("notifications response missing items")
		}
		for _, item := range items {
			notif, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if typ, ok := notif["type"].(string); ok && typ == "new_application" {
				reportLog("received CRM notification new_application for owner %d", ownerUserID)
				return
			}
		}
		reportLog("waiting for notification service to receive CRM event")
		time.Sleep(1 * time.Second)
	}
	t.Fatal("notification service did not receive CRM application event")
}

func publishUserCreatedEvent(t *testing.T, natsURL string, userID int64, email, firstName, lastName, role string, branchID *int64) {
	t.Helper()

	nc, err := nats.Connect(natsURL, nats.MaxReconnects(-1), nats.ReconnectWait(2*time.Second))
	if err != nil {
		t.Fatalf("connect to NATS failed: %v", err)
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
		t.Fatalf("marshal NATS event failed: %v", err)
	}
	if err := nc.Publish("user.created", data); err != nil {
		t.Fatalf("publish NATS user.created failed: %v", err)
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
		t.Fatalf("register parent failed: %v", err)
	}
	if respStatus != http.StatusOK {
		t.Fatalf("register parent expected 200, got %d", respStatus)
	}
	var resultObj registerResponse
	decodeJSONMap(result, &resultObj, t)
	if resultObj.UserID == 0 || resultObj.AccessToken == "" || resultObj.RefreshToken == "" {
		t.Fatalf("unexpected register response: %+v", resultObj)
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
		t.Fatalf("failed to sign token: %v", err)
	}
	return token
}

func doJSONRequest(client *http.Client, method, url, token string, body any) (int, any, []byte, error) {
	var payload io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return 0, nil, nil, err
		}
		payload = bytes.NewReader(raw)
	}

	req, err := http.NewRequestWithContext(context.Background(), method, url, payload)
	if err != nil {
		return 0, nil, nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, nil, err
	}

	if len(raw) == 0 {
		return resp.StatusCode, nil, raw, nil
	}

	var out any
	if strings.Contains(resp.Header.Get("Content-Type"), "application/json") {
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		if err := dec.Decode(&out); err != nil {
			return resp.StatusCode, nil, raw, err
		}
	} else {
		out = string(raw)
	}
	return resp.StatusCode, out, raw, nil
}

func decodeJSONMap(source any, dest any, t *testing.T) {
	t.Helper()
	m, ok := source.(map[string]any)
	if !ok {
		t.Fatalf("expected JSON object, got %T", source)
	}
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal JSON object: %v", err)
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		t.Fatalf("unmarshal into struct failed: %v", err)
	}
}

func mustGetInt64(body any, key string, t *testing.T) int64 {
	t.Helper()
	m, ok := body.(map[string]any)
	if !ok {
		t.Fatalf("response body is not JSON object: %T", body)
	}
	value, exists := m[key]
	if !exists {
		t.Fatalf("response missing %q", key)
	}
	id, ok := parseNumericID(value)
	if !ok {
		t.Fatalf("response %q is not numeric: %#v", key, value)
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
