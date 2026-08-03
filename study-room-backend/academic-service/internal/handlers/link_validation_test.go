package handlers

import (
	"os"
	"testing"
)

func TestValidateLinkURL_RejectsBadSchemes(t *testing.T) {
	bad := []string{
		"",
		"javascript:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"file:///etc/passwd",
		"ftp://files.example.com/x",
		"//evil.com/homework", // scheme-relative, u.Scheme == ""
		"not a url at all with spaces",
	}
	for _, raw := range bad {
		if err := validateLinkURL(raw); err == nil {
			t.Errorf("expected error for %q, got nil", raw)
		}
	}
}

func TestValidateLinkURL_RejectsInternalHosts(t *testing.T) {
	bad := []string{
		"http://localhost/x",
		"http://127.0.0.1/x",
		"http://169.254.169.254/latest/meta-data/",
		"http://10.0.0.5:8080/internal",
		"http://192.168.1.5/internal",
	}
	for _, raw := range bad {
		if err := validateLinkURL(raw); err == nil {
			t.Errorf("expected error for internal host %q, got nil", raw)
		}
	}
}

func TestValidateLinkURL_RejectsUserinfo(t *testing.T) {
	if err := validateLinkURL("https://legit-looking:pass@evil.example.com/homework"); err == nil {
		t.Error("expected error for URL with userinfo, got nil")
	}
}

func TestValidateLinkURL_AcceptsOrdinaryHTTPS(t *testing.T) {
	good := []string{
		"https://zoom.us/j/1234567890",
		"https://docs.google.com/document/d/abc",
		"https://example.com/homework/1",
	}
	for _, raw := range good {
		if err := validateLinkURL(raw); err != nil {
			t.Errorf("expected no error for %q, got %v", raw, err)
		}
	}
}

func TestValidateLinkURL_AllowList(t *testing.T) {
	t.Setenv("ALLOWED_LINK_HOSTS", "zoom.us,docs.google.com")
	defer os.Unsetenv("ALLOWED_LINK_HOSTS")

	if err := validateLinkURL("https://zoom.us/j/123"); err != nil {
		t.Errorf("expected zoom.us to be allowed, got %v", err)
	}
	if err := validateLinkURL("https://sub.docs.google.com/x"); err != nil {
		t.Errorf("expected subdomain of allow-listed host to be allowed, got %v", err)
	}
	if err := validateLinkURL("https://z00m.us-login.example.com/j/123"); err == nil {
		t.Error("expected lookalike domain to be rejected when allow-list is set")
	}
}
