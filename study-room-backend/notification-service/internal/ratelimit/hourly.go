// Package ratelimit — простой sliding-window лимитер "не более N событий за
// последний час", без внешних зависимостей (в отличие от
// user-service/internal/middleware/ratelimit.go, который использует
// golang.org/x/time/rate — здесь эта зависимость намеренно не добавлена,
// чтобы не тянуть новый модуль ради одного счётчика).
//
// Нужен для SMTP-квоты (mail.ru отдаёт не больше 500 писем в час на
// аккаунт): часть уведомлений — ежедневный дайджест занятий (9:00 МСК) и
// напоминания об истекающих договорах — рассылается пачками и может сама
// по себе упереться в лимит. HourlyLimiter используется, чтобы отдать под
// эти два типа не более 400 писем в час, оставив гарантированный запас
// (100) на остальные уведомления (см. notifier.Notifier.emailQuota).
package ratelimit

import (
	"context"
	"sync"
	"time"
)

// HourlyLimiter — не более max событий за скользящее окно window (обычно
// time.Hour). Реализация — sliding window log: храним временные метки
// последних разрешённых событий, при каждом обращении отбрасываем те, что
// вышли за пределы окна.
//
// Важная оговорка, как и у IPRateLimiter в user-service: состояние чисто
// in-memory, при нескольких репликах notification-service лимит фактически
// делится между ними и общий расход SMTP-квоты может превысить max*N — это
// не проблема для однорепличного деплоя (см. docker-compose.yml), но для
// горизонтального масштабирования потребует вынести счётчик во внешнее
// хранилище (Redis).
type HourlyLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	sent   []time.Time // временные метки в пределах текущего окна, по возрастанию
}

// NewHourlyLimiter создаёт лимитер на max событий за window. max<=0
// трактуется как "лимита нет" (Wait возвращается немедленно) — так проще
// отключить троттлинг конфигом (SMTP_BATCH_HOURLY_LIMIT=0), не меняя код.
func NewHourlyLimiter(max int, window time.Duration) *HourlyLimiter {
	if window <= 0 {
		window = time.Hour
	}
	return &HourlyLimiter{max: max, window: window}
}

// Wait блокируется, пока не появится свободное "место" в окне, затем сразу
// резервирует его (записывает текущее время в sent) и возвращает nil —
// вызывающему после этого разрешено сразу слать письмо. Если ctx отменяется
// раньше, чем освобождается место, возвращает ctx.Err() без резервирования.
//
// Именно эта блокировка и даёт эффект "очереди": воркер notifier'а, вызвавший
// Wait для письма из дайджеста/напоминания об истечении договора, просто
// не продолжает выполнение, пока лимит не обновится — новое место
// освобождается ровно тогда, когда самой старой отправке из окна
// исполняется window (см. sleepUntilSlot).
func (l *HourlyLimiter) Wait(ctx context.Context) error {
	if l.max <= 0 {
		return nil
	}
	for {
		wait, ok := l.tryReserve()
		if ok {
			return nil
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
			// Место, скорее всего, освободилось — идём на следующую
			// попытку резервирования. Пишем "скорее всего", а не
			// гарантированно, потому что за время сна могли успеть
			// зарезервировать место конкурентные вызовы Wait — тогда
			// tryReserve на следующем витке просто снова вернёт wait>0
			// и мы поспим ещё раз.
		}
	}
}

// tryReserve — если в окне есть свободное место прямо сейчас, резервирует
// его и возвращает (0, true). Иначе возвращает (сколько ждать до
// освобождения самого старого места, false).
func (l *HourlyLimiter) tryReserve() (time.Duration, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-l.window)

	// Отбрасываем протухшие метки с начала слайса (он всегда отсортирован
	// по возрастанию, т.к. время монотонно и мы всегда добавляем в конец).
	i := 0
	for i < len(l.sent) && l.sent[i].Before(cutoff) {
		i++
	}
	l.sent = l.sent[i:]

	if len(l.sent) < l.max {
		l.sent = append(l.sent, now)
		return 0, true
	}

	// Свободное место появится, когда самой старой метке в окне исполнится
	// ровно window.
	wait := l.sent[0].Add(l.window).Sub(now)
	if wait < 0 {
		wait = 0
	}
	return wait, false
}

// Used — сколько событий засчитано в текущем окне прямо сейчас (для
// логов/метрик, вызывающий код в этом сервисе может использовать это в
// health-эндпоинте или просто в log.Printf при старте очереди).
func (l *HourlyLimiter) Used() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-l.window)
	i := 0
	for i < len(l.sent) && l.sent[i].Before(cutoff) {
		i++
	}
	l.sent = l.sent[i:]
	return len(l.sent)
}
