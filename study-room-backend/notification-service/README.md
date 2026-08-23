# Notification Service

Сервис отправки уведомлений. Поддерживает email (SMTP) и мессенджеры (Telegram, WhatsApp, MAX).

## Архитектура

```
Событие из NATS → Subscriber → Notifier → [email|telegram|whatsapp|max]
```

- Каждое событие создаёт **отдельную запись в БД** для каждого включённого канала
- Отправка асинхронная — через channel-queue (128 jobs, 4 воркера)
- Статус доставки: `pending` → `sent` / `failed`

## Мессенджеры

### Telegram
- Используем Telegram Bot API
- Токен от @BotFather
- `users_ref.telegram_id` — chat_id получателя

### WhatsApp
- Используем WhatsApp Cloud API (Meta)
- Phone Number ID + Access Token из Meta Developer Console
- `users_ref.phone` — номер в формате E.164 (+79XXXXXXXXX)

### MAX
- Используем MAX REST API (MaxCore Solutions)
- API URL + App Token от администратора MAX
- `users_ref.phone` — номер для отправки

## Настройка

### 1. Базовые переменные

```bash
DATABASE_URL=postgres://notification_service:password@postgres-notifications:5432/study_room_notifications?sslmode=disable
JWT_SECRET=your_jwt_secret
SERVICE_TOKEN=your_service_token
NATS_URL=nats://nats:4222
```

### 2. Email (SMTP)

```bash
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_USER=no-reply@yourdomain.ru
SMTP_PASSWORD=your_app_password
```

### 3. Мессенджеры

См. `MESSENGER_KEYS_GUIDE.md` для инструкций по получению ключей.

```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
MAX_API_URL=https://max.company.com/api/v1
MAX_APP_TOKEN=your_max_app_token
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 4. Контакты пользователей

Мессенджеры резолвятся через `users_ref`:
- `telegram_id` — chat_id для Telegram
- `phone` — номер для WhatsApp и MAX
- `whatsapp_id` — альтернативный идентификатор для WhatsApp

## API

### Пользовательские эндпоинты (JWT)

```
GET    /api/v1/notifications?unread_only=true  # Список уведомлений
PATCH  /api/v1/notifications/{id}/read         # Прочитать
GET    /api/v1/notifications/settings           # Настройки
PATCH  /api/v1/notifications/settings           # Обновить настройки
```

### Настройки

```json
{
  "email_enabled": true,
  "max_enabled": false,
  "telegram_enabled": true,
  "whatsapp_enabled": false,
  "preferred_messenger": "telegram"
}
```

### Внутренние эндпоинты (Service Token)

```
POST /api/v1/internal/notifications/send  # Отправить уведомление
POST /api/v1/internal/users/sync          # Синхронизировать пользователя
```

## Миграции

```
0001_init.up.sql — базовая схема (users_ref, notification_settings, notifications)
0002_users_ref_parent_id.up.sql — parent_id для учеников
0003_messenger_channels.up.sql — замена sms_enabled на max/telegram/whatsapp
0004_contact_fields.up.sql — telegram_id, phone, whatsapp_id
```

Миграции применяются автоматически при запуске контейнера.

## Тестирование

```bash
# Запуск тестов
cd notification-service
go test ./...

# Локальный запуск (без Docker)
go run ./cmd/api/main.go
```
