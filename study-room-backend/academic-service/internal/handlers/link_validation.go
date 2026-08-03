package handlers

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
)

// validateLinkURL защищает Homework/Test от использования как открытого
// редиректора (open redirect) в фишинговых атаках: репетитор (в т.ч.
// скомпрометированный аккаунт или инсайдер) указывает link_url при
// создании задания, а ученик открывает его по адресу вида
// ".../homework/{id}/open" — то есть по ссылке *нашего* домена, которой
// доверяет, и сервер делает 302 на link_url без каких-либо проверок.
//
// Правила:
//  1. Ссылка должна быть абсолютным URL со схемой http/https — никаких
//     javascript:, data:, vbscript:, file: и т.п. (XSS/локальный доступ).
//  2. Host обязателен и не должен резолвиться в приватный/loopback/
//     link-local адрес (защита от SSRF-подобных трюков через редирект,
//     напр. http://169.254.169.254/... или http://localhost:...).
//  3. Если задан allow-list доменов (ALLOWED_LINK_HOSTS), host должен
//     совпадать с одним из них (точное совпадение или поддомен). Это
//     самая сильная защита от фишинга: если задания реально всегда
//     ведут на 2-3 доверенных сервиса (видеозвонки, LMS, Google Docs),
//     стоит включить allow-list — тогда скомпрометированный аккаунт
//     репетитора физически не сможет подставить чужой домен.
func validateLinkURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fmt.Errorf("link_url is required")
	}

	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("link_url is not a valid URL")
	}

	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("link_url must use http or https")
	}
	if u.Host == "" {
		return fmt.Errorf("link_url must be an absolute URL with a host")
	}
	// User-info в URL (https://user:pass@evil.com/) — классический трюк,
	// чтобы визуально спрятать реальный хост; запрещаем.
	if u.User != nil {
		return fmt.Errorf("link_url must not contain userinfo")
	}

	host := u.Hostname()
	if isDisallowedHost(host) {
		return fmt.Errorf("link_url host is not allowed")
	}

	if allow := allowedLinkHosts(); len(allow) > 0 && !hostAllowed(host, allow) {
		return fmt.Errorf("link_url domain is not in the allow-list")
	}

	return nil
}

// isDisallowedHost блокирует loopback/private/link-local адреса и очевидные
// внутренние имена — задание ученику не должно вести внутрь инфраструктуры.
func isDisallowedHost(host string) bool {
	lower := strings.ToLower(host)
	if lower == "localhost" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return true
		}
	}
	return false
}

// allowedLinkHosts читает опциональный allow-list доменов из окружения,
// например: ALLOWED_LINK_HOSTS="zoom.us,docs.google.com,drive.google.com"
// Пусто/не задано — allow-list выключен (остаются проверки схемы/хоста выше).
func allowedLinkHosts() []string {
	raw := os.Getenv("ALLOWED_LINK_HOSTS")
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.ToLower(strings.TrimSpace(p))
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func hostAllowed(host string, allow []string) bool {
	host = strings.ToLower(host)
	for _, a := range allow {
		if host == a || strings.HasSuffix(host, "."+a) {
			return true
		}
	}
	return false
}
