# Academic Service

Курсы, записи на них (enrollments), занятия, посещаемость и домашние задания.
См. `service-info/service-2-academic.mermaid` (ERD) и `service-info/api-contracts.md`
(раздел 2) — это источник истины для контракта; здесь только заметки по реализации.

## Своя БД

`study_room_academic` — ничего общего с БД User Service. Ссылки на
пользователей (`student_id`, `tutor_id`, `created_by`, `branch_id`) — это
просто числа, без настоящего foreign key на чужую базу (разные процессы,
разные СУБД-транзакции). Консистентность обеспечивается двумя механизмами:

1. **`user_refs`** — облегчённая локальная копия нужных полей пользователя
   (роль, филиал), наполняется событиями `user.created`/`user.updated` из
   NATS. Позволяет проверять права (например, "tutor_id принадлежит моему
   филиалу") без синхронного похода в User Service на каждый запрос.
2. **`internal/userclient`** — единственное исключение: чтобы отфильтровать
   "покажи мне только записи/занятия/домашку моих детей" для роли `parent`,
   сервис синхронно спрашивает User Service (`GET /parents/{id}/children`),
   потому что связь parent↔student физически хранится там, а дублировать её
   локально смысла нет.

## Связь с другими сервисами (NATS)

| Subject | Направление | Что происходит |
|---|---|---|
| `user.created` / `user.updated` | User Service → AS | upsert `user_refs` |
| `contract.created` | Contracts Service → AS | автосоздание `enrollments` (основной путь; `POST /enrollments` — ручной, для случаев без договора) |
| `lesson.created` | AS → Notification Service | по одному событию на участника занятия |
| `attendance.marked_absent` | AS → Notification Service | только для статуса `absent` |

Contracts Service в этом репозитории ещё не реализован (следующий пункт
плана) — форма события `contract.created` в `internal/events/subscriber.go`
реконструирована из контракта `POST /contracts` и может потребовать
корректировки, когда сервис появится.

## Локальный запуск

```bash
cd study-room-backend
docker compose up --build nats user-service postgres-academic academic-service
```

Проверка:
```bash
curl http://localhost:8082/healthz
```

## Документация

Academic Service теперь публикует Swagger UI на `/docs` и OpenAPI спецификацию на `/openapi.yaml`.
Это позволяет быстрее понять, какие API доступны и какие параметры ожидаются.

## Тесты

```bash
cd academic-service
make test-unit   # auth/middleware, без БД
docker compose up -d postgres-academic   # из корня репозитория
make test        # контрактные тесты, HTTP + реальный Postgres на :5435
```

## Что ещё не сделано

- Contracts Service не существует — `contract.created` можно проверить только
  вручную (например, опубликовав сообщение в NATS руками) до его появления
- Notification Service пока не подписан на `lesson.created`/`attendance.marked_absent`
  (эти subject'ы Academic Service уже публикует и ждут своего слушателя)
- Нет прав "branch_owner видит домашку своего филиала" оптимизированным SQL —
  сейчас фильтруется в памяти после выборки (см. `HomeworkHandler.filterByOwnBranch`),
  приемлемо для MVP-объёмов данных, но не масштабируется на десятки тысяч записей
