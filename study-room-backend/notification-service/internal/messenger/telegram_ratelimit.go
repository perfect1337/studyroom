package messenger

import (
	"container/list"
	"sync"
	"time"
)

// Ниже — чисто in-memory реализация без внешних зависимостей (в частности
// без golang.org/x/time/rate — тянуть новый модуль через go-proxy в этом
// окружении негде) и без Redis. Notification Service работает в единственном
// экземпляре (см. docker-compose*.yml — ни у одного сервиса не задан
// replicas/scale), поэтому состояние в памяти одного процесса — это не
// "костыль ради простоты", а вполне достаточное решение: реплик, между
// которыми лимит нужно было бы синхронизировать, просто нет. Если сервис
// когда-нибудь станет масштабироваться горизонтально — тогда и имеет смысл
// выносить состояние во внешний стор.

// chatRateLimiter — фиксированное окно (fixed window) попыток на chat_id.
// Используется, чтобы не дать одному Telegram-чату долбить бота попытками
// подобрать email (перебор регистрации) или иным спамом команд.
//
// LRU поверх map — по той же причине, что и в user-service/internal/
// middleware/ratelimit.go: не хотим неограниченно копить записи по всем
// когда-либо писавшим боту chat_id.
type chatRateLimiter struct {
	mu       sync.Mutex
	items    map[int64]*list.Element
	order    *list.List
	capacity int
	max      int
	window   time.Duration
}

type chatLimiterEntry struct {
	chatID    int64
	count     int
	windowEnd time.Time
}

func newChatRateLimiter(max int, window time.Duration, capacity int) *chatRateLimiter {
	if max <= 0 {
		max = 1
	}
	if capacity <= 0 {
		capacity = 5000
	}
	return &chatRateLimiter{
		items:    make(map[int64]*list.Element),
		order:    list.New(),
		capacity: capacity,
		max:      max,
		window:   window,
	}
}

// Allow сообщает, разрешена ли очередная попытка от данного chat_id.
func (l *chatRateLimiter) Allow(chatID int64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()

	if el, ok := l.items[chatID]; ok {
		l.order.MoveToFront(el)
		entry := el.Value.(*chatLimiterEntry)
		if now.After(entry.windowEnd) {
			entry.count = 0
			entry.windowEnd = now.Add(l.window)
		}
		entry.count++
		return entry.count <= l.max
	}

	entry := &chatLimiterEntry{chatID: chatID, count: 1, windowEnd: now.Add(l.window)}
	el := l.order.PushFront(entry)
	l.items[chatID] = el

	if l.order.Len() > l.capacity {
		tail := l.order.Back()
		if tail != nil {
			l.order.Remove(tail)
			delete(l.items, tail.Value.(*chatLimiterEntry).chatID)
		}
	}

	return true
}

// globalRateLimiter — простой общий (не per-chat) счётчик попыток за окно.
// Защищает не конкретный чат, а систему целиком: Telegram-аккаунты создаются
// бесплатно и в неограниченном количестве, поэтому одного per-chat лимита
// недостаточно против массового перебора email с разных ботов/чатов —
// нужен ещё и общий потолок на "сколько email-запросов в минуту вообще
// обрабатывает бот".
type globalRateLimiter struct {
	mu        sync.Mutex
	count     int
	windowEnd time.Time
	max       int
	window    time.Duration
}

func newGlobalRateLimiter(max int, window time.Duration) *globalRateLimiter {
	if max <= 0 {
		max = 1
	}
	return &globalRateLimiter{max: max, window: window}
}

func (l *globalRateLimiter) Allow() bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	if now.After(l.windowEnd) {
		l.count = 0
		l.windowEnd = now.Add(l.window)
	}
	l.count++
	return l.count <= l.max
}
