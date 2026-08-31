package ratelimit

import (
	"context"
	"testing"
	"time"
)

func TestHourlyLimiter_AllowsUpToMaxImmediately(t *testing.T) {
	l := NewHourlyLimiter(3, time.Hour)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		start := time.Now()
		if err := l.Wait(ctx); err != nil {
			t.Fatalf("unexpected error on send %d: %v", i, err)
		}
		if elapsed := time.Since(start); elapsed > 50*time.Millisecond {
			t.Fatalf("send %d blocked for %v, expected immediate", i, elapsed)
		}
	}
	if used := l.Used(); used != 3 {
		t.Fatalf("expected Used()=3, got %d", used)
	}
}

func TestHourlyLimiter_BlocksAfterMaxUntilWindowFrees(t *testing.T) {
	window := 100 * time.Millisecond
	l := NewHourlyLimiter(1, window)
	ctx := context.Background()

	if err := l.Wait(ctx); err != nil {
		t.Fatalf("first send should not block: %v", err)
	}

	start := time.Now()
	if err := l.Wait(ctx); err != nil {
		t.Fatalf("second send should eventually succeed: %v", err)
	}
	elapsed := time.Since(start)
	if elapsed < window/2 {
		t.Fatalf("second send returned too fast (%v), quota should have queued it until the window freed up", elapsed)
	}
}

func TestHourlyLimiter_RespectsContextCancellation(t *testing.T) {
	l := NewHourlyLimiter(1, time.Hour)
	ctx := context.Background()
	if err := l.Wait(ctx); err != nil {
		t.Fatalf("first send should not block: %v", err)
	}

	cancelCtx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	if err := l.Wait(cancelCtx); err == nil {
		t.Fatalf("expected context deadline error while quota is exhausted, got nil")
	}
}

func TestHourlyLimiter_ZeroMaxMeansUnlimited(t *testing.T) {
	l := NewHourlyLimiter(0, time.Hour)
	ctx := context.Background()
	for i := 0; i < 1000; i++ {
		if err := l.Wait(ctx); err != nil {
			t.Fatalf("send %d: unexpected error with unlimited quota: %v", i, err)
		}
	}
}
