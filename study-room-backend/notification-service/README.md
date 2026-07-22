# Notification Service

Отправка email-уведомлений через SMTP Яндекс.Почты. См. также
`service-info/service-5-notifications.mermaid` (ERD) и
`service-info/api-contracts.md` (раздел 5 + события NATS).

## Связь с User Service

User Service публикует в NATS:

| Subject | Что делает NS |
|---------|----------------|
| `user.created` | upsert `users_ref` + welcome / credentials email |
| `user.updated` | upsert `users_ref` |
| `password_reset_requested` | письмо со ссылкой сброса |

Оба сервиса в compose подключены к `nats://nats:4222`. Notification Service теперь подписывается в очередь `notification-service` —
это означает, что при горизонтальном масштабировании только один экземпляр обрабатывает каждое событие.
Нужен один и тот же `JWT_SECRET`.

## Настройка Яндекс SMTP

1. Заведите почтовый ящик на Яндексе (или домен Яндекс 360).
2. При 2FA — **Яндекс ID → Безопасность → Пароли приложений** (тип «Почта»).
3. В `.env` рядом с `docker-compose.yml`:

```
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_USER=no-reply@yourdomain.ru
SMTP_PASSWORD=xxxxxxxxxxxxxxxx
SMTP_FROM=no-reply@yourdomain.ru
JWT_SECRET=change-me-in-production
NOTIFICATIONS_SERVICE_TOKEN=change-me-service-token
APP_PUBLIC_URL=http://localhost:3000
```

## Локальный запуск

```
cd study-room-backend
docker compose up --build nats user-service notification-service
```

Проверка: зарегистрировать родителя → welcome-письмо; forgot-password → письмо со ссылкой;
создать tutor (owner) → письмо с временным паролем.

## Документация

Notification Service теперь публикует Swagger UI на `/docs` и OpenAPI спецификацию на `/openapi.yaml`.
Эти страницы доступны без аутентификации и помогают понять схему внешних и внутренних API.

## Что ещё не сделано

- SMS / messenger
- JetStream + QueueGroup (сейчас core NATS)
- Contracts/Academic/CRM ещё не публикуют свои события
