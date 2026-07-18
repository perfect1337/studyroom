# Notification Service

Отправка email-уведомлений через SMTP Яндекс.Почты. См. также
`service-info/service-5-notifications.mermaid` (ERD) и
`service-info/api-contracts.md` (раздел 5).

## Настройка Яндекс SMTP

1. Заведите почтовый ящик на Яндексе (или используйте домен, подключённый к Яндекс 360).
2. Если включена двухфакторная аутентификация — зайдите в **Яндекс ID → Безопасность →
   Пароли приложений** и создайте пароль приложения с типом "Почта". Обычный
   пароль от аккаунта для SMTP не подойдёт.
3. Если 2FA выключена, отдельно включите доступ по протоколу SMTP в настройках
   почты (**Все настройки → Почтовые программы → разрешить доступ**).
4. Заполните переменные окружения (в `.env` рядом с `docker-compose.yml` в
   `study-room-backend`):

```
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_USER=no-reply@yourdomain.ru
SMTP_PASSWORD=xxxxxxxxxxxxxxxx   # пароль приложения, не обычный пароль
SMTP_FROM=no-reply@yourdomain.ru # можно опустить — по умолчанию = SMTP_USER
```

Порт 465 — SMTPS (implicit TLS), рекомендуемый Яндексом способ. Порт 587
(STARTTLS) тоже поддерживается — просто смените `SMTP_PORT=587`.

## Service-to-service токен

`/internal/*` эндпоинты защищены заголовком `X-Service-Token`, значение
берётся из `SERVICE_TOKEN` (переменная `NOTIFICATIONS_SERVICE_TOKEN` в
корневом `docker-compose.yml`). Другие сервисы должны знать этот токен,
чтобы вызывать `POST /internal/notifications/send`.

## users_ref и откуда берётся email получателя

Сервис не хранит полные данные пользователей — только `users_ref (id, email)`,
локальную копию. Она наполняется:

- событиями `user.created` / `user.updated` из NATS (`internal/events`), когда
  User Service начнёт их публиковать;
- вручную через `POST /internal/users/sync` (временный способ для разработки);
- или через необязательное поле `email` в `POST /internal/notifications/send`
  (переопределяет users_ref для конкретной отправки) — это отклонение от
  `api-contracts.md` 5.5, добавлено, чтобы письма можно было слать уже сейчас,
  не дожидаясь публикации событий из User Service.

## Локальный запуск

```
cd study-room-backend
docker compose up --build notification-service
```

Не забудьте прогнать `go mod tidy` внутри `notification-service/` — `go.sum`
в этой заготовке ещё не сгенерирован (нет доступа в интернет из среды, где
писался код).

## Что дальше (не сделано в этой заготовке)

- SMS и messenger-каналы — только email реализован.
- User Service пока не публикует `user.created`/`user.updated` в NATS —
  подписчик в `internal/events` готов их слушать, но события никто не шлёт.
- Contracts/Academic/CRM Service ещё не существуют, соответственно
  `contract.expiring_soon`, `lesson.created`, `attendance.marked_absent`,
  `application.received` тоже никто не публикует.
