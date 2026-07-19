# Study Room — Backend

## Запуск (всё через Docker, вручную ничего создавать не нужно)

```bash
cp .env.example .env    # при желании поменяйте пароли/секрет
docker compose up --build
```

Это поднимет:
- `postgres-users` / `postgres-notifications` / `postgres-academic` — БД каждого сервиса (создаются Docker-ом автоматически из переменных `POSTGRES_*`)
- `user-service` — `:8081`
- `notification-service` — `:8085`
- `academic-service` — `:8082`
- `nats` — брокер событий на `:4222`, связывает сервисы (`user.*`, `contract.created`, `lesson.created`, `attendance.marked_absent`)

Каждый сервис при старте **сам применяет свои миграции** (см. `internal/migrate` в каждом сервисе) — никакого отдельного `psql`/`golang-migrate` шага не требуется.

Проверить, что сервисы живы:
```bash
curl http://localhost:8081/healthz  # user-service
curl http://localhost:8085/healthz  # notification-service
curl http://localhost:8082/healthz  # academic-service
```

Зарегистрировать первого пользователя (родителя):
```bash
curl -X POST http://localhost:8081/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"parent@example.com","password":"password123","last_name":"Смирнова","first_name":"Елена","patronymic":"Владимировна"}'
```

## Почему миграции не через golang-migrate CLI

В `internal/migrate/migrate.go` каждого сервиса — самодельный минималистичный раннер: SQL-файлы вшиты в бинарник через `go:embed`, при каждом старте контейнера сервис сам проверяет таблицу `schema_migrations` и накатывает то, чего не хватает. Это осознанный выбор ради простоты (`docker compose up` — и всё, без лишних шагов и внешних тулов) и того, чтобы контейнер был самодостаточным. Если позже понадобится более серьёзный инструмент миграций (down-миграции "боевым" способом, dry-run, и т.п.) — можно перейти на `golang-migrate` как библиотеку, схема файлов (`0001_init.up.sql`/`.down.sql`) для этого уже совместима.

## Остановить и снести данные (например, чтобы начать с чистой БД)

```bash
docker compose down -v
```

## Сервисы

| Сервис | Порт | БД | Контракты |
|---|---|---|---|
| user-service | 8081 | study_room_users | api-contracts.md, раздел 1 |
| notification-service | 8085 | study_room_notifications | api-contracts.md, раздел (Notification) |
| academic-service | 8082 | study_room_academic | api-contracts.md, раздел 2 |

## Дальше по плану (см. microservices-plan.md, раздел 3)

Реализованы User Service, Notification Service и Academic Service. Следующие
по очереди — Contracts Service и CRM Service — добавляются в этот же
`docker-compose.yml` по мере реализации, каждый — со своей БД и в той же сети
`studyroom-network`. Contracts Service — источник события `contract.created`,
которое Academic Service уже готов слушать (см.
`academic-service/internal/events/subscriber.go`) для автоматического
наполнения записей на курсы.
