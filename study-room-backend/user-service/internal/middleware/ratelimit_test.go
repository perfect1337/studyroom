package middleware

import (
	"fmt"
	"testing"
	"time"
)

// TestIPRateLimiter_LRUEvictsOldEntries — регрессия на утечку памяти:
// раньше map с лимитерами на IP росла бесконечно и никогда не чистилась.
// Теперь при превышении capacity должны вытесняться наименее давно
// использовавшиеся записи, так что число хранимых лимитеров никогда не
// превышает capacity, сколько бы уникальных IP ни обратилось за всё время
// жизни процесса.
func TestIPRateLimiter_LRUEvictsOldEntries(t *testing.T) {
	limiter := NewIPRateLimiter(5, time.Minute)
	limiter.capacity = 100 // маленький размер, чтобы тест был быстрым

	total := limiter.capacity * 3
	for i := 0; i < total; i++ {
		ip := fmt.Sprintf("203.0.113.%d", i)
		limiter.Allow(ip)

		limiter.mu.Lock()
		size := len(limiter.items)
		listLen := limiter.order.Len()
		limiter.mu.Unlock()

		if size > limiter.capacity {
			t.Fatalf("after %d unique IPs: map size=%d exceeds capacity=%d — memory leak regression", i+1, size, limiter.capacity)
		}
		if listLen > limiter.capacity {
			t.Fatalf("after %d unique IPs: LRU list size=%d exceeds capacity=%d", i+1, listLen, limiter.capacity)
		}
	}

	limiter.mu.Lock()
	finalSize := len(limiter.items)
	limiter.mu.Unlock()
	if finalSize != limiter.capacity {
		t.Fatalf("expected LRU to stay filled at capacity=%d after %d unique IPs, got size=%d", limiter.capacity, total, finalSize)
	}

	// Самый первый IP давно вытеснен из кэша.
	limiter.mu.Lock()
	_, stillTracked := limiter.items["203.0.113.0"]
	limiter.mu.Unlock()
	if stillTracked {
		t.Fatal("expected the very first IP to have been evicted from the LRU cache")
	}
}

// TestIPRateLimiter_RecentlyUsedIPSurvivesEviction — обращение к IP должно
// поднимать его в LRU наверх и защищать от вытеснения, пока к нему
// продолжают обращаться (стандартное свойство LRU-кэша).
func TestIPRateLimiter_RecentlyUsedIPSurvivesEviction(t *testing.T) {
	limiter := NewIPRateLimiter(100, time.Minute)
	limiter.capacity = 10

	hotIP := "198.51.100.1"
	limiter.Allow(hotIP)

	for i := 0; i < limiter.capacity*5; i++ {
		limiter.Allow(hotIP) // держим hotIP "горячим"
		limiter.Allow(fmt.Sprintf("198.51.100.%d", 100+i))
	}

	limiter.mu.Lock()
	_, tracked := limiter.items[hotIP]
	limiter.mu.Unlock()
	if !tracked {
		t.Fatal("expected frequently used IP to survive LRU eviction")
	}
}
