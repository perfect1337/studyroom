# Study Room — схема событий (NATS)

Реестр всех событий, которыми сервисы обмениваются через брокер. Это
источник истины для payload'а — как `api-contracts.md` для REST. Если
меняете поля события, сначала правите этот файл, потом код всех
публикующих/подписанных сервисов.

Формат на каждое событие: **имя subject'а**, **версия**, кто публикует, кто
подписан, JSON-схема payload'а, статус по факту в коде.

Статусы:
- ✅ **implemented** — публикующая и подписанная сторона реализованы и
  совпадают по полям.
- ⚠️ **mismatch** — обе стороны реализованы, но payload не совпадает
  (баг, не архитектурное решение) — исправить как можно раньше.
- 🚧 **planned** — подписчик уже написан под ожидаемую форму события,
  публикующий сервис ещё не реализован (см. `microservices-plan.md`, п.3).
  Форма ниже — это то, под что уже закладывается подписчик, а не
  зафиксированный контракт; сверить с реальным сервисом, когда его напишут.

---

## v1.user.created

**Версия:** v1
**Публикует:** User Service, `internal/events/publisher.go` → `SubjectUserCreated`
**Подписаны:** Academic Service (наполняет `user_refs`), CRM Service (наполняет `user_refs`), Notification Service (шлёт welcome/credentials, наполняет `users_ref`)
**Статус:** ✅ implemented

```json
{
  "id": 42,
  "email": "student@example.com",
  "first_name": "Иван",
  "last_name": "Петров",
  "role": "student",
  "branch_id": 1,
  "temp_password": "x7K9pQ2m",
  "notify_email": "parent@example.com",
  "parent_id": 41
}
```

| Поле | Тип | Обязательное | Заметка |
|---|---|---|---|
| `id` | int64 | да | user_id |
| `email` | string | да | |
| `first_name` | string | да | |
| `last_name` | string | да | |
| `role` | string | да | `owner`\|`branch_owner`\|`tutor`\|`parent`\|`student` |
| `branch_id` | int64\|null | нет | omitempty — отсутствует, если ещё не назначен на филиал |
| `temp_password` | string | нет | только когда роль tutor/student — для письма с учётными данными |
| `notify_email` | string | нет | только для role=student — email родителя, куда слать credentials |
| `parent_id` | int64\|null | нет | только для role=student — id родителя (`parent_student.parent_id`). Добавлено, чтобы Notification Service резолвил `student_id → parent_id` локально через `users_ref`, без синхронного вызова User Service (см. `attendance.marked_absent` ниже) |

Подписчики читают только нужное им подмножество полей (Academic Service —
`id/first_name/last_name/role/branch_id`, без `email`/паролей) — это
нормально, JSON-структуры не обязаны совпадать 1:1, лишние поля просто
игнорируются `encoding/json`.

---

## v1.user.updated

**Версия:** v1
**Публикует:** User Service, `internal/events/publisher.go` → `SubjectUserUpdated`
**Подписаны:** Academic Service, Notification Service
**Статус:** ✅ implemented

Тот же payload, что `user.created`, но `temp_password`/`notify_email` всегда
пустые (обновление профиля не переиздаёт пароль).

```json
{
  "id": 42,
  "email": "student@example.com",
  "first_name": "Иван",
  "last_name": "Петров",
  "role": "student",
  "branch_id": 1
}
```

---

## v1.password_reset_requested

**Версия:** v1
**Публикует:** User Service, `internal/events/publisher.go` → `SubjectPasswordResetRequested`
**Подписаны:** Notification Service
**Статус:** ✅ implemented — поля совпадают 1:1 на обеих сторонах.

```json
{
  "user_id": 42,
  "email": "student@example.com",
  "reset_token": "a1b2c3...",
  "reset_url": "https://studyroom.app/reset?token=a1b2c3...",
  "expires_at": "2026-07-20T12:00:00Z"
}
```

| Поле | Тип | Обязательное |
|---|---|---|
| `user_id` | int64 | да |
| `email` | string | да |
| `reset_token` | string | да |
| `reset_url` | string | да |
| `expires_at` | string (RFC3339, UTC) | да |

---

## v1.lesson.created — ✅ исправлен (был MISMATCH)

**Версия:** v1
**Публикует:** Academic Service, `internal/events/publisher.go`, subject `lesson.created`
**Подписаны:** Notification Service, `internal/events/subscriber.go` → `handleLessonReminder`
**Статус:** ✅ **implemented** (вариант А). Раньше обе стороны были
реализованы по разным схемам, ни одно поле не совпадало по имени — из-за
этого уведомление никогда не отправлялось (`user_id` десериализовался в
`0`). Исправлено: `handleLessonReminder` переписан под реальный payload
Academic Service, текст сообщения собирается на стороне Notification
Service.

Academic Service публикует (по одному событию на каждого участника занятия):
```json
{
  "lesson_id": 501,
  "tutor_id": 15,
  "student_id": 100,
  "topic": "Циклы",
  "lesson_date": "2026-08-01",
  "start_time": "10:00"
}
```

| Поле | Тип | Обязательное |
|---|---|---|
| `lesson_id` | int64 | да |
| `tutor_id` | int64 | да |
| `student_id` | int64 | да — получатель уведомления |
| `topic` | string | да |
| `lesson_date` | string (YYYY-MM-DD) | да |
| `start_time` | string (HH:MM) | да |

---

## v1.attendance.marked_absent — ✅ исправлен (был MISMATCH)

**Версия:** v1
**Публикует:** Academic Service, `internal/events/publisher.go`, subject `attendance.marked_absent`
**Подписаны:** Notification Service, `internal/events/subscriber.go` → `handleAttendanceAbsent`
**Статус:** ✅ **implemented** (вариант А). Раньше та же проблема, что у
`lesson.created` — `parent_user_id` всегда `0`, уведомление молча не
отправлялось. Дополнительная сложность: Academic Service физически не знает
`parent_id` (эта связь хранится только в User Service, `parent_student`).

**Как исправлено:** User Service теперь передаёт `parent_id` в событиях
`user.created`/`user.updated` (см. секцию `v1.user.created` ниже).
Notification Service хранит его в `users_ref.parent_id` и резолвит
`student_id → parent_id` локально в `handleAttendanceAbsent`, без
синхронного похода в User Service на каждое событие.

Academic Service публикует:
```json
{
  "lesson_id": 501,
  "student_id": 100,
  "absence_reason": "болен"
}
```

| Поле | Тип | Обязательное |
|---|---|---|
| `lesson_id` | int64 | да |
| `student_id` | int64 | да |
| `absence_reason` | string\|null | нет |

Если `student_id` ещё не встречался в `users_ref` (событие `user.created`
не дошло) либо у него не заполнен `parent_id` — уведомление тихо
пропускается (залогировано), а не падает с ошибкой.

---

## v1.contract.created

**Версия:** v1
**Публикует:** Contracts Service — 🚧 **сервис ещё не реализован**
**Подписаны:** Academic Service, `internal/events/subscriber.go` → `handleContractCreated` (основной путь наполнения `enrollments`)
**Статус:** 🚧 planned — форма ниже реконструирована Academic Service из
`POST /contracts` (см. `api-contracts.md`, 3.1), не подтверждена реальным
publisher'ом. Когда Contracts Service будет писаться — **сначала сверить
это событие с этим файлом**, а не с REST-телом `POST /contracts` заново.

```json
{
  "id": 77,
  "student_id": 100,
  "course_id": 12,
  "tutor_id": 15,
  "start_date": "2026-09-01",
  "end_date": "2027-05-31"
}
```

| Поле | Тип | Обязательное |
|---|---|---|
| `id` | int64 | да — id договора |
| `student_id` | int64 | да |
| `course_id` | int64 | да |
| `tutor_id` | int64\|null | нет |
| `start_date` | string (YYYY-MM-DD)\|null | нет |
| `end_date` | string (YYYY-MM-DD)\|null | нет |

Обработчик в Academic Service намеренно нестрогий (не роняет подписку при
несовпадении полей) — но это защита на время, пока контракта нет, а не
повод не задавать здесь окончательную форму.

---

## v1.contract.expiring_soon

**Версия:** v1
**Публикует:** Contracts Service — 🚧 не реализован
**Подписаны:** Notification Service, `internal/events/subscriber.go` → `handleContractExpiring`
**Статус:** 🚧 planned — форма реконструирована из уже написанного
подписчика (обратный порядок от идеального — Contracts Service должен
публиковать ровно это).

```json
{
  "user_id": 300,
  "contract_number": "SR-2026-0077",
  "end_date": "2027-05-31"
}
```

| Поле | Тип | Обязательное | Заметка |
|---|---|---|---|
| `user_id` | int64 | да | получатель уведомления (обычно родитель/владелец) |
| `contract_number` | string | да | |
| `end_date` | string (YYYY-MM-DD) | да | |

---

## v1.application.received

**Версия:** v1
**Публикует:** CRM Service, `internal/events/publisher.go` → `ApplicationReceived` — ✅ реализован
**Подписаны:** Notification Service, `internal/events/subscriber.go` → `handleApplicationReceived`
**Статус:** ✅ implemented — payload совпадает по обеим сторонам без изменений.

```json
{
  "owner_user_id": 1,
  "source": "tilda",
  "name": "Мария Сидорова"
}
```

| Поле | Тип | Обязательное | Заметка |
|---|---|---|---|
| `owner_user_id` | int64 | да | кому уведомление — owner/branch_owner филиала |
| `source` | string | да | `tilda` \| `internal` и т.п. |
| `name` | string | да | имя заявителя |

---

## Правила на будущее

1. **Любое новое событие или изменение существующего — сначала правка этого
   файла**, потом код. PR с новым `nc.Publish(...)`/`nc.Subscribe(...)` без
   соответствующей секции здесь не должен проходить ревью.
2. **Версия в имени subject'а, а не только в этом файле**, как только
   появится первое breaking-изменение: например `lesson.created.v2`, а не
   молчаливая замена полей в `lesson.created`. Пока все события v1 и это
   не форсировалось — исторически.
3. **Совпадение полей проверяется здесь, а не в рантайме.** `encoding/json`
   в Go не упадёт на лишних/недостающих полях — несовпадение выглядит как
   "тихо ничего не произошло", а не как ошибка. Два случая выше
   (`lesson.created`, `attendance.marked_absent`) — ровно такой сценарий.
4. Контрактные/интеграционные тесты каждого сервиса гоняют события через
   `NoopPublisher`/локальные фейки (см. `academic-service/tests/contracts`)
   и **не проверяют** реальную сериализацию на другой стороне брокера —
   несовпадение схемы, как найденное выше, не ловится текущими тестами.
   Нужен отдельный контрактный тест на уровне payload'а (например: взять
   реальный JSON, который публикует Academic Service, и попытаться
   unmarshal'ить его в структуру-приёмник Notification Service).
