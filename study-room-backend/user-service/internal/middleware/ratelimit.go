package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

type ipBucket struct {
	count       int
	windowStart time.Time
}

type IPRateLimiter struct {
	mu      sync.Mutex
	entries map[string]*ipBucket
	max     int
	window  time.Duration
}

func NewIPRateLimiter(max int, window time.Duration) *IPRateLimiter {
	return &IPRateLimiter{
		entries: make(map[string]*ipBucket),
		max:     max,
		window:  window,
	}
}

func (l *IPRateLimiter) Allow(ip string) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry, ok := l.entries[ip]
	now := time.Now()
	if !ok || now.Sub(entry.windowStart) >= l.window {
		entry = &ipBucket{count: 0, windowStart: now}
		l.entries[ip] = entry
	}

	if entry.count >= l.max {
		return false, 0
	}
	entry.count++
	return true, l.max - entry.count
}

func RateLimit(limiter *IPRateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := remoteIP(r)
			allowed, remaining := limiter.Allow(ip)
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(limiter.max))
			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
			if !allowed {
				w.Header().Set("Retry-After", strconv.Itoa(int(limiter.window.Seconds())))
				writeError(w, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "rate limit exceeded")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
