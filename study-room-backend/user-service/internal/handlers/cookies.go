package handlers

import (
	"net/http"
	"strings"
	"time"
)

// refreshCookieName — имя httpOnly cookie с refresh-токеном.
//
// Раньше refresh-токен возвращался в JSON-теле /auth/login,/register,/refresh
// и хранился на фронте в localStorage — при любой XSS-уязвимости это давало
// не разовый, а постоянный захват аккаунта (долгоживущий refresh-токен,
// а не только текущий access-токен). Теперь refresh-токен кладётся в
// httpOnly cookie: JS-код на странице не может его прочитать вообще, даже
// при XSS — сама браузерная модель безопасности cookie этого не позволяет.
const refreshCookieName = "sr_refresh_token"

// refreshCookiePath — cookie отправляется браузером на все запросы к API.
const refreshCookiePath = "/"

// cookieSettings — параметры cookie, приходят из config.Config (см. main.go).
type cookieSettings struct {
	secure   bool
	sameSite http.SameSite
	domain   string
}

func parseSameSite(v string) http.SameSite {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "strict":
		return http.SameSiteStrictMode
	case "none":
		return http.SameSiteNoneMode
	default:
		return http.SameSiteLaxMode
	}
}

func (h *AuthHandler) setRefreshCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    token,
		Path:     refreshCookiePath,
		Domain:   h.cookies.domain,
		Expires:  expires,
		HttpOnly: true, // недоступно из JS (document.cookie) — защита от XSS
		Secure:   h.cookies.secure,
		SameSite: h.cookies.sameSite,
	})
}

// clearRefreshCookie удаляет cookie на клиенте (logout / компрометация).
func (h *AuthHandler) clearRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     refreshCookiePath,
		Domain:   h.cookies.domain,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.cookies.secure,
		SameSite: h.cookies.sameSite,
	})
}

// readRefreshCookie возвращает значение cookie или "", если её нет.
func readRefreshCookie(r *http.Request) string {
	c, err := r.Cookie(refreshCookieName)
	if err != nil {
		return ""
	}
	return c.Value
}
