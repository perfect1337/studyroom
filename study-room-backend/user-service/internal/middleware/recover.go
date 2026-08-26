package middleware

import (
	"net/http"
	"runtime/debug"
)

// Recoverer перехватывает панику в любом хендлере/middleware ниже по цепочке
// и превращает её в обычный 500 вместо падения всего процесса. Без этого
// один неожиданный nil pointer dereference (или паника в любой сторонней
// зависимости) убивал бы весь сервис — Docker его перезапустит
// (restart: unless-stopped), но все запросы "в полёте" на момент паники
// оборвутся с обрывом соединения, и это тривиальный вектор DoS одним
// некорректным запросом. Логируем через ту же structured-JSON логику, что
// и остальные ошибки (см. logging.go), чтобы паника не терялась молча.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				requestID, _ := r.Context().Value(requestIDKey(RequestIDHeader)).(string)
				logJSON(map[string]any{
					"level":      "error",
					"event":      "panic_recovered",
					"panic":      fmtPanic(rec),
					"stack":      string(debug.Stack()),
					"path":       r.URL.Path,
					"method":     r.Method,
					"request_id": requestID,
					"remote_ip":  remoteIP(r),
				})
				writeError(w, http.StatusInternalServerError, "INTERNAL", "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func fmtPanic(rec any) string {
	if err, ok := rec.(error); ok {
		return err.Error()
	}
	if s, ok := rec.(string); ok {
		return s
	}
	return "unknown panic"
}
