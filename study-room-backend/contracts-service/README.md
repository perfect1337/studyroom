# Contracts Service

Договоры на обучение: создание, продление, отслеживание оплаты и срока
действия. См. `service-info/api-contracts.md` (раздел 3) — источник истины
по контракту; здесь только заметки по реализации.

## Своя БД

`study_room_contracts` — отдельная база, ничего общего с User/Academic/CRM
Service. Ссылки на пользователей и курсы (`student_id`, `parent_id`,
`course_id`, `branch_id`) — просто числа, без настоящего foreign key на
чужую базу.

- **`user_refs`** — облегчённая локальная копия (id, ФИО, роль, `branch_id`),
  наполняется событиями `user.created`/`user.updated` из NATS. Используется
  **только для мягкой валидации** при создании договора — если `student_id`/
  `parent_id` уже встречались в `user.*` и роль не совпадает (например,
  `student_id` на самом деле tutor), запрос отклоняется. Если записи ещё нет
  (событие не дошло) — не блокируем создание договора, это eventual
  consistency, а не гарантия.

## Связь с другими сервисами

| Subject/вызов | Направление | Что происходит |
|---|---|---|
| `user.created` / `user.updated` (NATS) | User Service → Contracts | upsert `user_refs` |
| `contract.created` (NATS) | Contracts → Academic Service | основной путь наполнения `enrollments` (см. `academic-service/internal/events/subscriber.go`, `handleContractCreated`) |
| `contract.expiring_soon` (NATS) | Contracts → Notification Service | см. ниже, "Фоновая джоба" |
| `GET /parents/{id}/children` (HTTP) | Contracts → User Service | единственный синхронный вызов, только для `GET /contracts/{id}/expiry` с `role=parent` (см. `internal/userclient`) |

`tutor_id` в `contract.created` всегда `null` — `POST /contracts` не
принимает `tutor_id` (см. `api-contracts.md`, 3.1), назначение репетитора на
`enrollment` — отдельное действие уже в Academic Service
(`PATCH /enrollments/{id}/assign-tutor`).

## Права доступа

- `POST/GET/PATCH/DELETE /contracts*` (3.1–3.2, 3.4–3.7) — `owner`; `branch_owner` — только договоры своего филиала. Удаление мягкое: запись сохраняется для статистики.
- `GET /contracts/{id}` (3.3) — `owner` и `branch_owner` (только свой филиал), полный объект договора.
- `GET /contracts/stats` — только `owner`, агрегированная статистика, включая удалённые договоры.
- `GET /contracts/{id}/expiry` (3.3a) — облегчённая версия (только
  `contract_id`/`end_date`, без суммы и статуса оплаты) для:
  - `branch_owner` — только договоры своего филиала (`claims.branch_id ==
    contract.branch_id`, без похода куда-либо);
  - `parent` — только договоры своих детей, резолвится через
    `internal/userclient` (`GET /parents/{id}/children`), тот же паттерн,
    что в `academic-service`.

## Фоновая джоба: `contract.expiring_soon`

Ни `api-contracts.md`, ни `event-schema.md` не описывают, **чем** триггерится
это событие — только его форму (`user_id`, `contract_number`, `end_date`).
Реализовано как периодическая проверка в `cmd/api/main.go`:

- раз в 24 часа (плюс сразу при старте) выбираются договоры со статусом
  `active`, у которых `end_date` наступает в ближайшие 14 дней и уведомление
  ещё не отправлялось (`expiry_notified_at IS NULL`);
- получатель (`user_id` в событии) — `parent_id` самого договора (он уже
  известен с момента создания, отдельный запрос в User Service не нужен);
- после публикации помечается `expiry_notified_at = now()`, чтобы не слать
  повторно каждые сутки.

Если понадобится другой триггер (например, честный cron вместо тикера
внутри процесса, либо уведомление ещё и `owner`/`branch_owner`, не только
`parent`) — это решение стоит сначала отразить здесь и в `event-schema.md`,
а не менять код молча.

## Локальный запуск

```bash
cd study-room-backend
docker compose up --build nats user-service postgres-contracts contracts-service
```

Проверка:
```bash
curl http://localhost:8083/healthz
```

API docs:
```
curl http://localhost:8083/openapi.yaml
```
Open in browser:
```
http://localhost:8083/docs
```

## Тесты

```bash
cd contracts-service
docker compose up -d postgres-contracts   # из корня репозитория
make test        # контрактные тесты, HTTP + реальный Postgres на :5437
make test-unit   # auth/middleware, без БД
```

## Что ещё не сделано

- `contract_number` генерируется как `SR-{год start_date}-{id}` — формат
  придуман (нигде не задокументирован точно), проверьте перед реальной
  интеграцией с любой внешней системой, которая может парсить этот номер
- Нет проверки, что `course_id` при создании договора существует в Academic
  Service — Contracts Service его не резолвит вообще (ни синхронно, ни через
  кэш), просто передаёт дальше в `contract.created`
- `contract.expiring_soon` уведомляет только `parent_id` — `owner`/
  `branch_owner` не получают напоминание о продлении, хотя по логике бизнеса
  это тоже может быть нужно (см. "Фоновая джоба" выше)
- Повторная генерация `contract.created`, если Academic Service был недоступен
  в момент публикации (NATS at-most-once без персистентного стрима) — событие
  безвозвратно теряется, `enrollment` придётся создавать вручную через
  `POST /enrollments` (см. `academic-service/README.md`)
