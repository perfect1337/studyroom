package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

type requestIDKey string

const RequestIDHeader = "X-Request-ID"

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get(RequestIDHeader)
		if requestID == "" {
			requestID = generateRequestID()
		}
		w.Header().Set(RequestIDHeader, requestID)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey(RequestIDHeader), requestID)))
	})
}

func generateRequestID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "req-" + time.Now().UTC().Format("20060102T150405.000000000Z")
	}
	return hex.EncodeToString(b)
}

type responseLogger struct {
	http.ResponseWriter
	status int
	size   int
}

func (rl *responseLogger) WriteHeader(status int) {
	if rl.status == 0 {
		rl.status = status
	}
	rl.ResponseWriter.WriteHeader(status)
}

func (rl *responseLogger) Write(b []byte) (int, error) {
	if rl.status == 0 {
		rl.status = http.StatusOK
	}
	n, err := rl.ResponseWriter.Write(b)
	rl.size += n
	return n, err
}

func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rl := &responseLogger{ResponseWriter: w}
		next.ServeHTTP(rl, r)
		if rl.status == 0 {
			rl.status = http.StatusOK
		}
		requestID, _ := r.Context().Value(requestIDKey(RequestIDHeader)).(string)
		logJSON(map[string]any{
			"level":       "info",
			"timestamp":   time.Now().UTC().Format(time.RFC3339Nano),
			"method":      r.Method,
			"path":        r.URL.Path,
			"query":       r.URL.RawQuery,
			"status":      rl.status,
			"bytes":       rl.size,
			"duration_ms": time.Since(start).Milliseconds(),
			"request_id":  requestID,
			"remote_ip":   remoteIP(r),
		})
	})
}

func logJSON(entry map[string]any) {
	data, err := json.Marshal(entry)
	if err != nil {
		log.Printf("failed to marshal log entry: %v", err)
		return
	}
	log.Println(string(data))
}

// remoteIP — обёртка над clientIP (см. clientip.go) для обратной
// совместимости с существующими вызовами в этом пакете (логирование,
// rate limit). Логика доверия X-Forwarded-For вынесена в clientip.go.
func remoteIP(r *http.Request) string {
	return clientIP(r)
}
