package middleware

import (
	"net/http"
	"strings"
	"sync"
)

// AllowedOrigins — allowlist origin'ов (schema://host[:port], без завершающего
// "/"), которым разрешён CORS с credentials.
//
// Раньше CORS отражал ЛЮБОЙ Origin из запроса (echo origin) и всегда добавлял
// Access-Control-Allow-Credentials: true. Для конкретного (не "*")
// Access-Control-Allow-Origin браузер разрешает JS вызывающей страницы читать
// ответ, если она шлёт запрос с credentials: "include" — то есть ЛЮБОЙ сайт,
// на который зашла жертва, мог сходить в API от её имени (используя её
// httpOnly cookie с refresh-токеном, где она есть, либо просто эксплуатируя
// сам факт "any origin принят") и прочитать ответ. Это классический
// CORS-misconfig (reflect-any-origin + credentials:true), не пригодный для
// прода. Теперь Origin отражается ТОЛЬКО если он явно в allowlist.
type AllowedOrigins struct {
	set map[string]struct{}
}

// ParseAllowedOrigins разбирает ALLOWED_ORIGINS из ENV (через запятую),
// например "https://studyroom.example.com,https://admin.studyroom.example.com".
//
// Пустая строка — валидный дефолт "никому не доверяем": браузерные
// cross-origin запросы с credentials не получат нужных CORS-заголовков и
// будут заблокированы браузером. Сервис при этом продолжает работать для
// server-to-server вызовов, curl/Postman и т.п. — у них нет Origin-политики
// браузера, так что это не блокировка доступа к API как таковая, а именно
// блокировка небезопасного "любой сайт в браузере может сходить от лица
// залогиненного пользователя".
func ParseAllowedOrigins(csv string) *AllowedOrigins {
	ao := &AllowedOrigins{set: make(map[string]struct{})}
	for _, raw := range strings.Split(csv, ",") {
		origin := strings.TrimSpace(raw)
		origin = strings.TrimSuffix(origin, "/")
		if origin == "" {
			continue
		}
		ao.set[origin] = struct{}{}
	}
	return ao
}

func (ao *AllowedOrigins) allows(origin string) bool {
	if ao == nil || origin == "" {
		return false
	}
	_, ok := ao.set[origin]
	return ok
}

var (
	allowedOriginsMu sync.RWMutex
	allowedOrigins   *AllowedOrigins // nil/пустой по умолчанию — CORS с credentials не разрешён никому
)

// SetAllowedOrigins задаёт глобальный allowlist origin'ов для CORS. Вызывается
// один раз при старте сервиса (main.go), после config.Load() — аналогично
// SetTrustedProxies в user-service.
func SetAllowedOrigins(ao *AllowedOrigins) {
	allowedOriginsMu.Lock()
	allowedOrigins = ao
	allowedOriginsMu.Unlock()
}

func currentAllowedOrigins() *AllowedOrigins {
	allowedOriginsMu.RLock()
	defer allowedOriginsMu.RUnlock()
	return allowedOrigins
}

// CORS позволяет обращаться к сервису из браузера с фронтенда, который
// раздаётся с другого origin (например, Vite dev-server на localhost:5173,
// либо прод-домен фронтенда) — но ТОЛЬКО если этот origin явно указан в
// ALLOWED_ORIGINS (см. SetAllowedOrigins). Для остальных origin'ов
// CORS-заголовки не выставляются: запрос долетает до сервера (это не
// firewall и не замена аутентификации), но браузер не отдаст JS-коду
// стороннего сайта доступ к ответу.
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if currentAllowedOrigins().allows(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
		w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")
		w.Header().Set("Access-Control-Max-Age", "600")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
