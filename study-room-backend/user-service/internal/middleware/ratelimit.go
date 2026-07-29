package middleware

import (
	"container/list"
	"net/http"
	"strconv"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// maxTrackedIPs — верхняя граница числа одновременно отслеживаемых IP.
//
// Раньше (см. историю) лимитер держал map[string]*ipBucket, куда запись на
// каждый уникальный IP добавлялась и никогда не удалялась — классическая
// медленная утечка памяти при сканах ботов по /auth/* со случайных IP.
// Теперь состояние хранится в LRU-кэше фиксированного размера: как только
// число уникальных IP превышает capacity, вытесняется наименее давно
// использовавшийся — память лимитера больше не может расти бесконечно.
const maxTrackedIPs = 20000

// limiterEntry — то, что реально лежит в LRU: IP (нужен для вытеснения по
// ключу из map) и сам token-bucket лимитер на этот IP.
type limiterEntry struct {
	ip      string
	limiter *rate.Limiter
}

// IPRateLimiter — rate-limiter на основе token bucket (golang.org/x/time/rate)
// с обёрткой в виде LRU-кэша ограниченного размера поверх лимитеров на IP.
//
// Публичный API (NewIPRateLimiter/Allow) намеренно оставлен таким же, как
// был у старой in-memory реализации на map — это не ломает вызывающий код
// в internal/app/app.go и существующие тесты в auth_test.go.
//
// Важная оговорка: это по-прежнему чисто in-memory состояние процесса.
// LRU-кэш решает проблему утечки памяти, но НЕ решает проблему с
// горизонтальным масштабированием — при нескольких репликах сервиса за
// балансировщиком лимит фактически делится между репликами и его легче
// обойти. Если это станет актуально, лимитер нужно вынести во внешнее
// общее хранилище (например Redis: INCR + EXPIRE по ключу "ratelimit:{ip}"
// или пакет go-redis/redis_rate) — это уже отдельная инфраструктурная
// задача с добавлением зависимости от Redis, здесь сознательно не делаем.
type IPRateLimiter struct {
	mu       sync.Mutex
	items    map[string]*list.Element // ip -> элемент order-списка, O(1) доступ
	order    *list.List               // голова = недавно использованные, хвост = кандидаты на вытеснение
	capacity int

	rateLimit rate.Limit // скорость пополнения токенов
	burst     int        // ёмкость bucket'а = max запросов "залпом"

	max    int
	window time.Duration
}

// NewIPRateLimiter создаёт лимитер: не более max запросов за window на IP
// (реализовано как token bucket с burst=max и равномерным пополнением
// max токенов за window — по нагрузке эквивалентно старому "max за
// скользящее окно", но без накопления состояния на каждый IP навсегда).
func NewIPRateLimiter(max int, window time.Duration) *IPRateLimiter {
	if max <= 0 {
		max = 1
	}
	return &IPRateLimiter{
		items:     make(map[string]*list.Element),
		order:     list.New(),
		capacity:  maxTrackedIPs,
		rateLimit: rate.Every(window / time.Duration(max)),
		burst:     max,
		max:       max,
		window:    window,
	}
}

// getLimiter возвращает *rate.Limiter для IP, создавая новый при первом
// обращении, и помечает запись как недавно использованную (перемещает в
// голову LRU-списка). При превышении capacity вытесняет самую "холодную"
// запись из хвоста — именно это и не давало утечь памяти.
func (l *IPRateLimiter) getLimiter(ip string) *rate.Limiter {
	l.mu.Lock()
	defer l.mu.Unlock()

	if el, ok := l.items[ip]; ok {
		l.order.MoveToFront(el)
		return el.Value.(*limiterEntry).limiter
	}

	entry := &limiterEntry{ip: ip, limiter: rate.NewLimiter(l.rateLimit, l.burst)}
	el := l.order.PushFront(entry)
	l.items[ip] = el

	if l.order.Len() > l.capacity {
		tail := l.order.Back()
		if tail != nil {
			l.order.Remove(tail)
			delete(l.items, tail.Value.(*limiterEntry).ip)
		}
	}

	return entry.limiter
}

// Allow сообщает, разрешён ли очередной запрос с данного IP, и сколько
// запросов останется доступно "прямо сейчас" (используется для заголовка
// X-RateLimit-Remaining).
func (l *IPRateLimiter) Allow(ip string) (bool, int) {
	limiter := l.getLimiter(ip)

	now := time.Now()
	if !limiter.AllowN(now, 1) {
		return false, 0
	}

	remaining := int(limiter.TokensAt(now))
	if remaining < 0 {
		remaining = 0
	}
	if remaining > l.max {
		remaining = l.max
	}
	return true, remaining
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
