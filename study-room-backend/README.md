# Study Room — Backend

## Запуск (всё через Docker, вручную ничего создавать не нужно)

```bash
cp .env.example .env    # при желании поменяйте пароли/секрет
docker compose up --build
```

Это поднимет:
- `postgres-users` — база User Service (создаётся Docker-ом автоматически из переменных `POSTGRES_*`)
- `user-service` — сам сервис на `:8081`, при старте **сам применяет миграции** (см. `internal/migrate`) — никакого отдельного `psql`/`golang-migrate` шага не требуется
- `nats` — брокер событий на `:4222`, под будущие сервисы

Проверить, что сервис жив:
```bash
curl http://localhost:8081/healthz
```

Зарегистрировать первого пользователя (родителя):
```bash
curl -X POST http://localhost:8081/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"parent@example.com","password":"password123","last_name":"Смирнова","first_name":"Елена","patronymic":"Владимировна"}'
```

## Почему миграции не через golang-migrate CLI

В `internal/migrate/migrate.go` — самодельный минималистичный раннер: SQL-файлы вшиты в бинарник через `go:embed`, при каждом старте контейнера сервис сам проверяет таблицу `schema_migrations` и накатывает то, чего не хватает. Это осознанный выбор ради простоты (`docker compose up` — и всё, без лишних шагов и внешних тулов) и того, чтобы контейнер был самодостаточным. Если позже понадобится более серьёзный инструмент миграций (down-миграции "боевым" способом, dry-run, и т.п.) — можно перейти на `golang-migrate` как библиотеку, схема файлов (`0001_init.up.sql`/`.down.sql`) для этого уже совместима.

## Остановить и снести данные (например, чтобы начать с чистой БД)

```bash
docker compose down -v
```

## Дальше по плану (см. microservices-plan.md, раздел 3)

Сейчас поднят только User Service. Следующие по очереди — Academic Service,
Contracts Service, CRM Service, Notification Service — добавляются в этот же
`docker-compose.yml` (заготовки уже закомментированы внизу файла) по мере
реализации, каждый — со своей БД и в той же сети `studyroom-network`.
