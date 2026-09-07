# Plan: MAX Bot — как Telegram

## Problem
- Notification service не компилируется: отсутствует пакет `ratelimit`
- MAX отключён по умолчанию, нет бота для привязки
- WhatsApp оставляем как есть

## Changes

### 1. Создать `internal/ratelimit/hourly_limiter.go`
Пакет для ограничения SMTP-рассылок (используется в `notifier.go`).

```go
package ratelimit

import (
    "context"
    "sync"
    "time"
)

type HourlyLimiter struct {
    mu          sync.Mutex
    max         int
    window      time.Duration
    used        int
    windowStart time.Time
}

func NewHourlyLimiter(max int, window time.Duration) *HourlyLimiter {
    return &HourlyLimiter{
        max:         max,
        window:      window,
        windowStart: time.Now(),
    }
}

func (l *HourlyLimiter) Used() int {
    l.mu.Lock()
    defer l.mu.Unlock()
    if time.Since(l.windowStart) >= l.window {
        l.used = 0
        l.windowStart = time.Now()
    }
    return l.used
}

func (l *HourlyLimiter) Wait(ctx context.Context) error {
    for {
        used := l.Used()
        if used < l.max {
            l.mu.Lock()
            l.used++
            l.mu.Unlock()
            return nil
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(time.Until(l.windowStart.Add(l.window))):
        }
    }
}
```

### 2. Создать `internal/messenger/max_bot.go` — MAX Bot с polling
Аналог `telegram_bot.go`, но для MAX. Используем официальную библиотеку `github.com/max-messenger/max-bot-api-client-go/v2`.

Polling: `api.Subscriptions.GetUpdates(ctx, marker)`
Команды: `/start` → `UpdateBotStarted`, сообщения → `UpdateMessageCreated`
Отправка: `api.Messages.Send(ctx, msg)` с `SetChat()`, `SetUser()`, `SetText()`

### 3. Создать `internal/repository/maxuser_repository.go`
Аналог `telegramuser_repository.go` для MAX. Таблица `max_users` с полями: `max_chat_id`, `max_user_id`, `user_id`.

### 4. Создать `internal/migrate/sql/0006_max_bind.up.sql`
Миграция для таблицы `max_users`.

### 5. Обновить `internal/models/models.go`
- Добавить `MaxID string` в `UserRef`
- Добавить `MaxUser` struct

### 6. Обновить `internal/repository/userref_repository.go`
Добавить `max_id` в Upsert и запросы.

### 7. Обновить `internal/notifier/notifier.go`
- Убрать import `ratelimit` — создать пакет
- MAX dispatch уже есть, оставить

### 8. Обновить `cmd/api/main.go`
- Запустить MAX Bot polling (как Telegram Bot)

### 9. Обновить `internal/repository/settings_repository.go`
Добавить `MaxEnabled: true` в дефолтные настройки (как `EmailEnabled: true`).

### 10. Обновить `internal/handlers/notification_handler.go`
Добавить `GetMAXStatus` handler для `GET /notifications/max/status`.

### 11. Обновить `internal/handlers/internal_handler.go`
Добавить `max_id` в syncUserRequest.

### 12. Обновить `docker-compose.yml`
Добавить `MAX_BOT_TOKEN: ${MAX_BOT_TOKEN:-}`.

### 13. Обновить `internal/config/config.go`
Добавить `MaxBotToken`.

### 14. Обновить `go.mod`
Добавить `github.com/max-messenger/max-bot-api-client-go/v2`.

### 15. Обновить тесты `tests/contracts/`
Добавить тест для MAX.

## Files to modify
1. `internal/ratelimit/hourly_limiter.go` — **create**
2. `internal/messenger/max_bot.go` — **create**
3. `internal/repository/maxuser_repository.go` — **create**
4. `internal/migrate/sql/0006_max_bind.up.sql` — **create**
5. `internal/models/models.go` — **edit**
6. `internal/repository/userref_repository.go` — **edit**
7. `internal/notifier/notifier.go` — **edit**
8. `cmd/api/main.go` — **edit**
9. `internal/repository/settings_repository.go` — **edit**
10. `internal/handlers/notification_handler.go` — **edit**
11. `internal/handlers/internal_handler.go` — **edit**
12. `docker-compose.yml` — **edit**
13. `internal/config/config.go` — **edit**
14. `tests/contracts/setup_test.go` — **edit**
15. `tests/contracts/internal_contracts_test.go` — **edit**
16. `go.mod` — **edit**

## Verification
- `go build ./...` — компиляция без ошибок
- `go test ./tests/contracts/` — тесты проходят
- MAX Bot работает: `/start` → email → привязка
- Уведомления через MAX отправляются при `max_enabled = true`
