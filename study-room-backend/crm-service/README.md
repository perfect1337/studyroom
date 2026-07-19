# CRM Service

Заявки с сайта (вебхук Tilda) и внутренние заявки на новый курс из ЛК
родителя. См. `service-info/api-contracts.md` (раздел 4) — источник истины
по контракту; здесь только заметки по реализации.

## Своя БД

`study_room_crm` — отдельная база, ничего общего с User/Academic Service.
Ссылки на пользователей (`student_id`, `branch_id`, `handled_by`) — просто
числа, без настоящего foreign key на чужую базу. Консистентность:

- **`user_refs`** — облегчённая локальная копия (id, ФИО, роль, `branch_id`),
  наполняется событиями `user.created`/`user.updated` из NATS. Нужна, чтобы
  резолвить, кому из owner/branch_owner отправить уведомление о новой заявке,
  без синхронного похода в User Service на каждую заявку.

## Связь с другими сервисами (NATS)

| Subject | Направление | Что происходит |
|---|---|---|
| `user.created` / `user.updated` | User Service → CRM | upsert `user_refs` |
| `application.received` | CRM → Notification Service | после создания заявки (оба источника) |

## Резолв получателя `application.received`

Приоритет при выборе `owner_user_id` в событии:
1. `branch_owner` того же `branch_id`, что и заявка (если известен);
2. любой `owner` (сеть филиалов целиком) — фолбэк для заявок без `branch_id`
   (вебхук Tilda не знает филиал) или пока `user_refs` ещё не наполнен.

Если ни один получатель не резолвится (кэш `user_refs` пуст — например,
сервис только что поднялся и ещё не получил ни одного `user.created`),
событие не публикуется вовсе — лучше молча пропустить уведомление, чем
отправить его с пустым `owner_user_id` и переложить проблему на
Notification Service.

## Подпись вебхука Tilda

`POST /api/v1/crm/applications/webhook` не требует JWT — вместо этого
проверяется заголовок `X-Tilda-Signature`: HMAC-SHA256 от сырого тела
запроса, ключ — `TILDA_WEBHOOK_SECRET`, в hex.

**Важно**: в `api-contracts.md` сказано только "проверка подписи по
секретному ключу", без указания алгоритма — реальную схему подписи Tilda
нужно свериться с их документацией на вебхуки при реальной интеграции.
Если `TILDA_WEBHOOK_SECRET` не задан, проверка подписи пропускается
(только для локальной разработки — сервис при старте пишет в лог warning).

## Локальный запуск

```bash
cd study-room-backend
docker compose up --build nats user-service postgres-crm crm-service
```

Проверка:
```bash
curl http://localhost:8084/healthz
```

## Тесты

```bash
cd crm-service
docker compose up -d postgres-crm   # из корня репозитория
make test        # контрактные тесты, HTTP + реальный Postgres на :5436
```

## Что ещё не сделано

- Contracts Service не существует — событие `contract.created` CRM Service
  не касается, оно идёт напрямую Academic Service; но связь CRM → Academic
  (конвертация заявки в реального студента) в контракте не описана и здесь
  не реализована — по `api-contracts.md` CRM Service ограничивается статусом
  `converted`, дальнейшее создание пользователя/зачисление — вне этого сервиса
- Проверка "родитель может подать заявку только на своего ребёнка"
  (`student_id` действительно принадлежит вызывающему parent) не реализована —
  потребовала бы либо синхронного похода в User Service (`GET
  /parents/{id}/children`, как это делает Academic Service), либо расширения
  `user.*` событий связью parent↔student в `user_refs`. Оставлено как заметный
  пробел, а не тихое допущение
- Дедупликация повторных вебхуков от Tilda (retry с тем же телом создаст
  вторую заявку) не реализована — нет естественного idempotency-key в
  контракте вебхука
