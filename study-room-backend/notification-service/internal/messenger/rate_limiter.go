package messenger

import (
	"context"
	"sync"
	"time"
)

// RateLimiter enforces an independent global budget and, optionally, a
// per-recipient budget. Both budgets are enforced before an API call.
type RateLimiter struct {
	globalInterval time.Duration
	globalMu       sync.Mutex
	nextGlobal     time.Time

	perKeyInterval time.Duration
	perKeyMu       sync.Mutex
	perKeyNext     map[string]time.Time
}

func NewRateLimiter(globalPerSecond int, perKeyPerSecond int) *RateLimiter {
	if globalPerSecond <= 0 {
		globalPerSecond = 30
	}
	if perKeyPerSecond < 0 {
		perKeyPerSecond = 0
	}

	globalInterval := ceilInterval(globalPerSecond)
	perKeyInterval := time.Duration(0)
	if perKeyPerSecond > 0 {
		perKeyInterval = ceilInterval(perKeyPerSecond)
	}

	return &RateLimiter{
		globalInterval: globalInterval,
		perKeyInterval: perKeyInterval,
		perKeyNext:     make(map[string]time.Time),
	}
}

func ceilInterval(perSecond int) time.Duration {
	const oneSecond = int64(time.Second)
	interval := time.Duration(oneSecond / int64(perSecond))
	if interval*time.Duration(perSecond) < time.Second {
		interval++
	}
	return interval
}

// Wait blocks until the global provider budget is available and then, if
// configured, until the per-recipient budget is available.
func (l *RateLimiter) Wait(ctx context.Context, key string) error {
	if err := waitUntil(ctx, l.reserveGlobal()); err != nil {
		return err
	}
	if l.perKeyInterval > 0 && key != "" {
		if err := waitUntil(ctx, l.reserveKey(key)); err != nil {
			return err
		}
	}
	return nil
}

func (l *RateLimiter) reserveGlobal() time.Duration {
	now := time.Now()
	l.globalMu.Lock()
	defer l.globalMu.Unlock()

	at := now
	if l.nextGlobal.After(at) {
		at = l.nextGlobal
	}
	l.nextGlobal = at.Add(l.globalInterval)
	if at.After(now) {
		return at.Sub(now)
	}
	return 0
}

func (l *RateLimiter) reserveKey(key string) time.Duration {
	now := time.Now()
	l.perKeyMu.Lock()
	defer l.perKeyMu.Unlock()

	at := now
	if next, ok := l.perKeyNext[key]; ok && next.After(at) {
		at = next
	}
	l.perKeyNext[key] = at.Add(l.perKeyInterval)
	if at.After(now) {
		return at.Sub(now)
	}
	return 0
}

func waitUntil(ctx context.Context, wait time.Duration) error {
	if wait <= 0 {
		return nil
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
