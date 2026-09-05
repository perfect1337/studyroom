# Study Room — API-контракты по сервисам

Формат каждого метода:
- **Метод и путь**
- Тело запроса
- Тело ответа
- `auth` — нужен ли валидный JWT
- `roles` — кто может вызывать (если пусто — любой аутентифицированный пользователь; для `auth: false` ролей нет)

Общий формат ошибок для всех сервисов (не дублируется в каждом методе):
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "человекочитаемое описание" } }
```

---

# 1. User Service — `/api/v1/users`

## 1.1. Регистрация родителя
`POST /auth/register`

Тело запроса:
```json
{
  "email": "elena@example.com",
  "phone": "+79371234567",
  "password": "min8chars",
  "last_name": "Смирнова",
  "first_name": "Елена",
  "patronymic": "Владимировна"
}
```
Тело ответа:
```json
{ "user_id": 482910, "access_token": "...", "refresh_token": "..." }
```
`auth`: false
`roles`: — (регистрируется всегда как `parent`, других ролей самостоятельная регистрация не создаёт)

## 1.2. Вход
`POST /auth/login`

Тело запроса:
```json
{ "login": "elena@example.com", "password": "min8chars" }
```
Тело ответа:
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "user": { "id": 482910, "role": "parent", "first_name": "Елена", "last_name": "Смирнова" }
}
```
`auth`: false

## 1.3. Обновление access-токена
`POST /auth/refresh`

Тело запроса:
```json
{ "refresh_token": "..." }
```
Тело ответа:
```json
{ "access_token": "...", "refresh_token": "..." }
```
`auth`: false (проверяется валидность refresh-токена, не access)

## 1.4. Запрос на восстановление пароля
`POST /auth/forgot-password`

Тело запроса:
```json
{ "email": "elena@example.com" }
```
Тело ответа: без ответа, код 200 (не показываем, существует ли email — защита от перебора)
`auth`: false

## 1.5. Сброс пароля
`POST /auth/reset-password`

Тело запроса:
```json
{ "reset_token": "...", "new_password": "min8chars" }
```
Тело ответа: без ответа, код 200
`auth`: false

## 1.6. Получить свой профиль
`GET /users/me`

Тело запроса: —
Тело ответа:
```json
{
  "id": 482910, "email": "...", "phone": "...", "role": "parent",
  "last_name": "Смирнова", "first_name": "Елена", "patronymic": "Владимировна",
  "avatar_url": "...", "branch_id": null, "is_active": true
}
```
`auth`: true
`roles`: любая

## 1.7. Обновить свой профиль
`PATCH /users/me`

Тело запроса:
```json
{ "first_name": "Елена", "last_name": "Смирнова", "patronymic": "Владимировна", "avatar_url": "..." }
```
Поля `class_info` (класс) и `school` (школа) допускаются только при `role=student` —
их отправляет сам ученик про себя; для остальных ролей запрос с этими полями
вернёт `403 FORBIDDEN`. Оба поля независимы: можно прислать только одно из них,
второе останется прежним.
```json
{ "class_info": "10А", "school": "Школа №25" }
```
Поле `email` редактируется **для любой роли, включая `student`** (у ученика это
поле одновременно служит логином для входа и адресом для email-уведомлений —
см. 5.3/5.4). Если новое значение `email` отличается от текущего, обязателен
`current_password` — без него или с неверным паролем ответ `400 INVALID_CREDENTIALS`.
При совпадении с уже занятым email/телефоном — `409 ALREADY_EXISTS`.
```json
{ "email": "new@example.com", "current_password": "..." }
```
Тело ответа: обновлённый объект пользователя (как в 1.6)
`auth`: true
`roles`: любая

## 1.8. Сменить пароль
`POST /users/me/change-password`

Тело запроса:
```json
{ "current_password": "...", "new_password": "min8chars" }
```
Тело ответа: без ответа, код 200
`auth`: true
`roles`: любая

## 1.9. Справочник «мои люди» (по роли вызывающего)
`GET /users?search=Иван&branch_id=3`

Один эндпоинт для фронта: сервер сам собирает нужные списки по роли из JWT.
Ключи ответа **всегда** присутствуют (пустой массив, если для роли не применимо).

Тело запроса: query-параметры
- `search` — опционально, фильтр по `last_name` / `first_name` (ILIKE) во всех возвращаемых списках
- `branch_id` — только для `owner`: сузить все списки до одного филиала; для остальных ролей игнорируется

Тело ответа:
```json
{
  "children": [],
  "students": [],
  "tutors": [],
  "branch_owners": [],
  "parents": []
}
```

Что заполняется по ролям:

| Роль | children | students | tutors | branch_owners | parents |
|------|----------|----------|--------|---------------|---------|
| `parent` | свои дети (`parent_student`) | — | — | — | — |
| `tutor` | — | ученики своего филиала* | — | — | — |
| `branch_owner` | — | ученики филиала | репетиторы филиала | — | — |
| `owner` | — | все ученики | все репетиторы | все руководители филиалов | все родители |
| `student` | — | — | — | — | — |

\* User Service по-прежнему отдаёт здесь «всех учеников филиала» — это справочник для форм (например, выбор ученика в модалке), а не «мои реальные ученики». За точным списком «мои ученики» (ученики своего филиала, записанные на курс, который тьютор реально ведёт) фронт идёт в Academic Service: `GET /enrollments` под ролью `tutor` (см. 2.5) — он теперь считается через `course_tutors`, а не через ручное поле `enrollments.tutor_id` на каждой записи (см. 2.1b/2.4a/2.5).

`auth`: true
`roles`: любая (у `student` все списки пустые)

## 1.10. Получить пользователя по id
`GET /users/{id}`

Тело запроса: —
Тело ответа: объект пользователя (как в 1.6) либо `404`
`auth`: true
`roles`: `owner`; `branch_owner` (только если `user.branch_id` совпадает с его собственным — иначе `403`); `tutor` (любой ученик своего филиала, `user.branch_id` совпадает с его собственным — иначе `403`); `parent` (только свой ребёнок); сам пользователь (self)

## 1.11. Создать репетитора
`POST /users/tutors`

Тело запроса:
```json
{
  "email": "petrov@example.com", "phone": "+7...", "last_name": "Петров",
  "first_name": "Иван", "patronymic": "Сергеевич",
  "branch_id": 1, "specialization": "Математика, ЕГЭ"
}
```
Тело ответа: созданный пользователь + временный пароль (для последующей отправки на почту через Notification Service событием `user.created`)
`auth`: true
`roles`: `owner` **только** (branch_owner не может создавать учителей — см. матрицу прав)

## 1.12. Создать ученика (владельцем или родителем через "Добавить ребёнка")
`POST /users/students`

Тело запроса:
```json
{
  "last_name": "Смирнов", "first_name": "Алексей", "patronymic": "Ильич",
  "class_info": "4 Класс", "school": "Школа №1502",
  "branch_id": 1, "parent_id": 482910
}
```
Тело ответа: созданный пользователь-ученик (email/пароль генерируются автоматически, отправляются на почту родителя)
`auth`: true
`roles`: `owner`, `parent` (создаёт только с `parent_id` = собственный id). **`branch_owner` создавать учеников не может.**

## 1.13. Обновить пользователя (админ-редактирование)
`PATCH /users/{id}`

Тело запроса: любое подмножество редактируемых полей пользователя
Тело ответа: обновлённый объект пользователя
`auth`: true
`roles`: `owner`; `branch_owner` (только если `user.branch_id` = его филиал)

## 1.14. Активировать/деактивировать пользователя
`PATCH /users/{id}/status`

Тело запроса:
```json
{ "is_active": false }
```
Тело ответа: без ответа, код 200
`auth`: true
`roles`: `owner`

## 1.15. Изменить статус репетитора (отпуск/больничный/активен/неактивен)
`PATCH /tutors/{id}/status`

Тело запроса:
```json
{ "status": "vacation" }
```
Тело ответа: без ответа, код 200
`auth`: true
`roles`: `owner` (любой филиал, все значения статуса, включая `"inactive"`), `branch_owner` (только репетиторы своего филиала, значения `active|vacation|sick_leave` — установить `"inactive"` не может, сервер отклоняет с `403`)

## 1.16. Список филиалов
`GET /branches`

Тело запроса: —
Тело ответа:
```json
{ "items": [ { "id": 1, "name": "Саратов", "city": "Саратов", "address": "...", "phone": "..." } ] }
```
`auth`: true
`roles`: `owner` **только** — полный список филиалов сети.  
`branch_owner` свой филиал уже знает из JWT / `GET /users/me` (`branch_id`), отдельный список ему не нужен.

## 1.17. Создать филиал
`POST /branches`

Тело запроса:
```json
{ "name": "Энгельс", "city": "Энгельс", "address": "...", "phone": "..." }
```
Тело ответа: созданный филиал
`auth`: true
`roles`: `owner`

## 1.18. Привязать/посмотреть детей родителя
`GET /parents/{parentId}/children`

Тело запроса: —
Тело ответа:
```json
{ "items": [ { "id": 4588201, "first_name": "Алексей", "last_name": "Смирнов", "class_info": "4 Класс" } ] }
```
`auth`: true
`roles`: `parent` (только `parentId` = свой id), `owner`, `branch_owner` (свой филиал)

---

# 2. Academic Service — `/api/v1/academic`

## 2.1. Список курсов
`GET /courses?branch_id=1&subject=Математика&tutor_id=15`

Тело ответа:
```json
{ "items": [ { "id": 1, "title": "Математика - Подготовка к ЕГЭ", "subject": "Математика", "format": "individual", "branch_id": 1, "tutor_ids": [15, 22] } ] }
```
`tutor_ids` — id всех преподавателей, ведущих курс (см. 2.1b, таблица `course_tutors`). Пусто, если курсу ещё никого не назначили.

`tutor_id` в query — доп. фильтр «курсы, которые ведёт этот преподаватель» («Мои курсы»). `tutor` может передать только свой собственный id (иначе `403`); `owner`/`branch_owner` — любой.

`auth`: true
`roles`: любая (фильтр по `branch_id` обязателен для `branch_owner`, `tutor`, `student`, `parent`; **`owner` не ограничен — видит курсы и записи учеников во всех филиалах без фильтра**)

## 2.1a. Список преподавателей курса
`GET /courses/{id}/tutors`

Тело ответа:
```json
{ "tutor_ids": [15, 22] }
```
`auth`: true
`roles`: любая

## 2.1b. Назначить / снять преподавателя с курса
`POST /courses/{id}/tutors` · `DELETE /courses/{id}/tutors/{tutorId}`

Тело запроса (POST):
```json
{ "tutor_id": 15 }
```
Тело ответа (POST): обновлённый курс (с новым `tutor_ids`) / (DELETE): без ответа, код 200

Это и есть связь «какой преподаватель ведёт какой курс» (таблица `course_tutors`, many-to-many: курс может вести несколько преподавателей — например, разные группы одного курса; преподаватель может вести несколько курсов). Именно она определяет:
- «Мои курсы» у `tutor` (2.1, `?tutor_id=`)
- «Мои ученики» у `tutor` (2.5) — ученики его филиала, записанные на курс из этого списка
- кого можно назначить личным тьютором на конкретную запись (2.4a) — только того, кто уже в `course_tutors` этого курса

`auth`: true
`roles`: `owner` (любой филиал), `branch_owner` (курс и преподаватель обязаны быть из его собственного филиала — иначе `403`)

## 2.2. Создать курс
`POST /courses`

Тело запроса:
```json
{ "title": "Английский язык (B2)", "subject": "Английский", "format": "group", "description": "...", "branch_id": 1 }
```
Тело ответа: созданный курс (`tutor_ids: []` — преподаватели назначаются отдельным вызовом, см. 2.1b)
`auth`: true
`roles`: `owner` **только**

## 2.3. Обновить / удалить курс
`PATCH /courses/{id}` · `DELETE /courses/{id}`

Тело запроса (PATCH): подмножество полей курса (title/subject/format/description — можно менять любые из них, в том числе все сразу)
Тело ответа: обновлённый курс / без ответа, код 200
`auth`: true
`roles`: `owner` **только** — и для `PATCH`, и для `DELETE`. `branch_owner` курсы не редактирует и не удаляет, только просматривает (см. 2.1, `GET /courses` доступен любой роли).

## 2.4. Записать ученика на курс (ручной способ, без договора)
`POST /enrollments`

Тело запроса:
```json
{ "student_id": 4588201, "course_id": 1 }
```
Тело ответа: созданная запись (`status: "active"`, `progress_pct: 0`, `tutor_id: null`)
`auth`: true
`roles`: `owner` **только**

> **Основной способ создания записи — не этот метод, а автоматика.** Когда владелец создаёт договор (`POST /contracts`, п. 3.1) с `student_id` + `course_id`, Contracts Service публикует событие `contract.created`, на которое подписан Academic Service — он сам создаёт запись `ENROLLMENTS`, без отдельного вызова этого метода. `POST /enrollments` нужен только для редких ручных случаев (например, пробное занятие без договора).

## 2.4a. Назначить репетитора на запись
`PATCH /enrollments/{id}/assign-tutor`

Тело запроса:
```json
{ "tutor_id": 15 }
```
Тело ответа: обновлённая запись

Это **личное** назначение репетитора конкретному ученику на конкретной записи (например, если курс групповой, но с этим учеником отдельно занимается определённый человек) — отдельно от того, кого вообще пускают вести курс (2.1b). `tutor_id` обязан уже быть среди `course_tutors` этого курса, иначе `400 BAD_REQUEST`. Это поле необязательно для того, чтобы преподаватель увидел ученика в «моих учениках» (2.5) — для этого достаточно вести курс.

`auth`: true
`roles`: `owner` (любой филиал), `branch_owner` (только записи своего филиала)

## 2.5. Список записей на курсы
`GET /enrollments?student_id=&tutor_id=&course_id=`

Тело ответа:
```json
{ "items": [ { "id": 1, "student_id": 4588201, "course_id": 1, "tutor_id": 15, "progress_pct": 75, "status": "active" } ] }
```
`auth`: true
`roles`: любая, с обязательной фильтрацией — `parent`/`student` только свои/детские, `branch_owner` только свой филиал, `owner` без ограничений (query как есть).

`tutor` — **не** фильтр по `enrollments.tutor_id`. Сервер сам вычисляет «мои ученики»: активные и неактивные записи на курсы, где тьютор указан в `course_tutors` (2.1b), **и** курс относится к тому же филиалу, что и сам тьютор. `?course_id=` можно передать, чтобы сузить до одного курса; `?tutor_id=` для роли `tutor` игнорируется (сервер всегда подставляет себя).

## 2.6. Обновить статус записи (прогресс — автоматически)
`PATCH /enrollments/{id}`

Тело запроса:
```json
{ "status": "active" }
```
Тело ответа: обновлённая запись
`auth`: true
`roles`: `owner`, `branch_owner`(свой филиал), `tutor` — свои ученики: либо личное назначение на эту запись (`enrollments.tutor_id`, см. 2.4a), либо он вообще ведёт курс этой записи (`course_tutors`, см. 2.1b). Любого из двух условий достаточно.

> **`progress_pct` через этот метод больше не задаётся вручную.** Прогресс ученика по курсу считается автоматически, по факту занятий, которые реально ставит и проводит преподаватель: `progress_pct = round(100 * завершённые_занятия / все_неотменённые_занятия)` по конкретной паре ученик+курс (`lessons` + `lesson_participants`, `status <> 'cancelled'` в знаменателе, `status = 'completed'` в числителе). Если по курсу ещё не было ни одного занятия — `progress_pct = 0`. Пересчёт происходит автоматически при создании занятия (`POST /lessons`, 2.8), смене его статуса, включая отметку «проведено» (`PATCH /lessons/{id}`, 2.9), и при отмене занятия (`DELETE /lessons/{id}`, 2.9). Если `progress_pct` всё же передать в теле этого запроса — оно молча игнорируется.

## 2.7. Список занятий (расписание)
`GET /lessons?tutor_id=&student_id=&branch_id=&date_from=&date_to=`

Тело ответа:
```json
{ "items": [ { "id": 501, "course_id": 1, "tutor_id": 15, "topic": "Алгебра - Функции", "lesson_date": "2026-07-14", "start_time": "10:00", "end_time": "11:30", "status": "scheduled" } ] }
```
`auth`: true
`roles`: `owner` (без ограничений); `branch_owner` (только свой филиал — сервер подставляет фильтр принудительно); `tutor` (только свои занятия по умолчанию); `parent`/`student` (только свои/детские)

## 2.8. Создать занятие
`POST /lessons`

Тело запроса:
```json
{
  "course_id": 1, "tutor_id": 15, "student_id": 4588201, "topic": "Введение в алгебру",
  "lesson_date": "2026-07-20", "start_time": "16:00", "end_time": "17:30",
  "location_type": "remote", "group_type": "individual", "comment": "..."
}
```
`student_id` — опционален. Если передан, участником занятия становится
только этот ученик (после проверки, что у него есть активная запись на
`course_id`); если нет — участниками становятся все ученики с активной
записью на курс (реально групповое занятие на весь курс сразу). Фронт
всегда передаёт `student_id`, так как форма создания занятия требует
явного выбора ученика ещё до выбора курса.

Тело ответа: созданное занятие (`created_by` заполняется из JWT автоматически)
`auth`: true
`roles`: `tutor` (только `tutor_id` = свой), `owner` (любой `tutor_id`), `branch_owner` (`tutor_id` только из своего филиала)

## 2.9. Обновить / отменить занятие
`PATCH /lessons/{id}` · `DELETE /lessons/{id}` · `DELETE /lessons/{id}/hard-delete`

Тело запроса (PATCH): подмножество полей занятия
Тело ответа: обновлённое занятие / без ответа, код 200
`DELETE /lessons/{id}/hard-delete` физически удаляет занятие вместе с `lesson_participants` и `attendance`; доступен только `owner` и `branch_owner` в пределах их области доступа.
`auth`: true
`roles`: те же, что 2.8, плюс проверка, что занятие принадлежит доступной репетитору/филиалу области

## 2.10. Отметить посещаемость
`POST /lessons/{id}/attendance`

Тело запроса:
```json
{ "records": [ { "student_id": 4588201, "status": "absent", "absence_reason": "По болезни (справка предоставлена)" } ] }
```
Тело ответа: без ответа, код 200
`auth`: true
`roles`: `tutor` (только своё занятие), `owner`, `branch_owner`(свой филиал)

## 2.11. Получить посещаемость по занятию
`GET /lessons/{id}/attendance`

Тело ответа:
```json
{ "items": [ { "student_id": 4588201, "status": "absent", "absence_reason": "..." } ] }
```
`auth`: true
`roles`: `tutor`(своё занятие), `owner`, `branch_owner`(свой филиал), `parent`(если участвует его ребёнок), `student`(если участвует сам)

## 2.12. Выдать домашнее задание
`POST /homework`

Тело запроса:
```json
{ "student_id": 4588201, "link_url": "https://example.com/hw/45" }
```
Тело ответа: созданное задание (`status: "assigned"`, `viewed_at: null`)
`auth`: true
`roles`: `tutor`

> Никаких `title`/`description`/срока сдачи — задание это просто ссылка на внешний ресурс, который репетитор вставляет в текстовое поле. Сдачи и оценки как таковых нет.

## 2.13. Список домашних заданий
`GET /homework?student_id=&status=`

Тело ответа:
```json
{ "items": [ { "id": 90, "link_url": "https://example.com/hw/45", "status": "viewed", "viewed_at": "2026-07-14T10:32:00Z", "created_at": "..." } ] }
```
`auth`: true
`roles`: `tutor`(свои выданные), `student`(свои), `parent`(детские), `owner`/`branch_owner`(в рамках доступной области)

## 2.14. Открыть задание (переход по ссылке учеником)
`GET /homework/{id}/open`

Тело запроса: —
Тело ответа: HTTP `302 Redirect` на `link_url`. Побочный эффект на сервере: если это первый переход — `status` меняется `assigned → viewed`, `viewed_at` проставляется текущим временем.
`auth`: true
`roles`: `student` **только**, и только по своему заданию (`homework.student_id` = id вызывающего)

---

# 3. Contracts Service — `/api/v1/contracts`

## 3.1. Создать договор
`POST /contracts`

Тело запроса:
```json
{
  "student_id": 4588201, "parent_id": 482910, "course_id": 1, "branch_id": 1,
  "amount": 4500, "start_date": "2026-08-01", "end_date": "2027-01-31"
}
```
Тело ответа: созданный договор (`status: "active"`, `payment_status: "unpaid"` по умолчанию)
`auth`: true
`roles`: `owner` **только**

## 3.2. Список договоров
`GET /contracts?branch_id=&student_id=&status=`

Тело ответа:
```json
{ "items": [ { "id": 284, "student_id": 4588201, "amount": 4500, "payment_status": "unpaid", "status": "active", "start_date": "...", "end_date": "..." } ] }
```
`auth`: true
`roles`: `owner` (полные данные — сумма, статус оплаты, даты, любой филиал через `?branch_id=`); `branch_owner` (только договоры своего филиала — `branch_id` принудительно подставляется из JWT и не берётся из query; в ответе только `id`, `student_id`, `course_id`, `branch_id`, `status`, `start_date`, `end_date` — **без `amount`/`payment_status`**, эти финансовые поля видит только owner).

## 3.3. Получить договор по id
`GET /contracts/{id}`

Тело ответа: объект договора (как в 3.2) либо `404`
`auth`: true
`roles`: `owner` **только**

## 3.3a. Дата окончания договора (облегчённая версия для остальных ролей)
`GET /contracts/{id}/expiry`

Тело ответа:
```json
{ "contract_id": 284, "end_date": "2027-01-31" }
```
`auth`: true
`roles`: `branch_owner` (только договоры своего филиала), `parent` (только договоры своих детей) — **никаких других полей (сумма, статус оплаты) в ответе нет**

## 3.4. Изменить договор (продлить/сумма/даты)
`PATCH /contracts/{id}`

Тело запроса:
```json
{ "end_date": "2027-06-30", "amount": 5000 }
```
Тело ответа: обновлённый договор
`auth`: true
`roles`: `owner` **только**

## 3.5. Изменить статус договора (завершить/расторгнуть)
`PATCH /contracts/{id}/status`

Тело запроса:
```json
{ "status": "terminated" }
```
Тело ответа: без ответа, код 200
`auth`: true
`roles`: `owner` **только**

Расторжение (`status: "terminated"`) публикует событие `contract.terminated`
(см. `event-schema.md`), на которое подписан Academic Service: у ученика
отменяются все ещё не проведённые занятия по этому курсу, а сама запись
на курс (`enrollments`) переводится в `status: "terminated"`. Уже
проведённые занятия и полная история прогресса не трогаются.

## 3.6. Отметить оплату вручную
`PATCH /contracts/{id}/payment-status`

Тело запроса:
```json
{ "payment_status": "paid" }
```
Тело ответа: без ответа, код 200
`auth`: true
`roles`: `owner` **только**

## 3.7. Удалить договор
`DELETE /contracts/{id}`

Тело запроса: —
Тело ответа: без ответа, код 200
`auth`: true
`roles`: `owner` **только**

---

# 4. CRM Service — `/api/v1/crm`

## 4.1. Приём заявки с сайта (webhook Tilda)
`POST /applications/webhook`

Тело запроса:
```json
{ "name": "Кирилл Д.", "age": 7, "phone": "+7...", "subject_interest": "Английский с нуля", "parent_name": "Елена Д." }
```
Тело ответа: без ответа, код 200
`auth`: false (вместо JWT — проверка подписи webhook по секретному ключу в заголовке `X-Tilda-Signature`)
`roles`: —

## 4.2. Внутренняя заявка (форма "Записаться на новый курс" в ЛК родителя)
`POST /applications`

Тело запроса:
```json
{ "student_id": 4588201, "subject_interest": "Физика", "format": "group" }
```
Тело ответа: созданная заявка (`source: "internal"`, `status: "new"`)
`auth`: true
`roles`: `parent`

Анти-спам: не чаще одной заявки в минуту на одного и того же `student_id`
(двойной клик/повторное нажатие "Отправить" не плодит дубликаты в CRM).
При превышении — `429` с `{ "error": { "code": "RATE_LIMITED", "message": "..." } }`.

## 4.3. Список заявок
`GET /applications?status=`

Тело ответа:
```json
{ "items": [ { "id": 1, "name": "Кирилл Д.", "age": 7, "status": "new", "branch_id": 1, "created_at": "..." } ] }
```
`auth`: true
`roles`: `owner` **только**

## 4.4. Обновить статус заявки
`PATCH /applications/{id}`

Тело запроса:
```json
{ "status": "converted", "handled_by": 5 }
```
Тело ответа: обновлённая заявка
`auth`: true
`roles`: `owner` **только**

## 4.5. Удалить заявку
`DELETE /applications/{id}`

Тело запроса: —
Тело ответа: без ответа, код 200
`auth`: true
`roles`: `owner`

---

# 5. Notification Service — `/api/v1/notifications`

## 5.1. Список своих уведомлений (колокольчик в шапке)
`GET /notifications?unread_only=true`

Тело ответа:
```json
{ "items": [ { "id": 1, "type": "lesson_reminder", "message": "Завтра в 15:00 занятие по математике", "status": "sent", "created_at": "..." } ] }
```
`auth`: true
`roles`: любая (только свои)

## 5.2. Отметить уведомление прочитанным
`PATCH /notifications/{id}/read`

Тело запроса: —
Тело ответа: без ответа, код 200
`auth`: true
`roles`: любая (только своё уведомление)

## 5.3. Получить настройки каналов уведомлений
`GET /notifications/settings`

Тело ответа:
```json
{ "email_enabled": true, "sms_enabled": false, "messenger_enabled": true }
```
`auth`: true
`roles`: любая (только свои настройки)

## 5.4. Обновить настройки каналов
`PATCH /notifications/settings`

Тело запроса:
```json
{ "email_enabled": true, "sms_enabled": true, "messenger_enabled": false }
```
Тело ответа: обновлённые настройки
`auth`: true
`roles`: любая (только свои)

## 5.5. Отправить уведомление (внутренний, сервис-сервис)
`POST /internal/notifications/send`

Тело запроса:
```json
{ "user_id": 482910, "type": "contract_expiring", "message": "Договор №284-М истекает через 7 дней" }
```
Тело ответа: без ответа, код 200
`auth`: **отдельный service-to-service токен** (не пользовательский JWT — вызывается только другими сервисами, например Contracts Service по событию `contract.expiring_soon`)
`roles`: — (недоступен пользователям вообще, только межсервисным вызовам)

---

## События NATS (User Service → Notification Service)

User Service публикует (best-effort после успешного commit в БД). Notification Service подписан.

### `user.created` / `user.updated`
```json
{
  "id": 482910,
  "email": "elena@example.com",
  "first_name": "Елена",
  "last_name": "Смирнова",
  "role": "parent",
  "branch_id": null,
  "temp_password": "Ab12cd34ef56",
  "notify_email": "parent@example.com"
}
```
- `temp_password` / `notify_email` — только при создании tutor/student.
- NS: upsert `users_ref`; для `user.created` дополнительно письмо:
  - `parent` → welcome
  - `tutor` → credentials на email tutor’а
  - `student` → credentials на `notify_email` (родитель)

### `password_reset_requested`
```json
{
  "user_id": 482910,
  "email": "elena@example.com",
  "reset_token": "...",
  "reset_url": "http://localhost:3000/reset-password?token=...",
  "expires_at": "2026-07-18T18:00:00Z"
}
```
NS отправляет письмо со ссылкой (`type: password_reset`).

---

# Сводка по количеству методов

| Сервис | Методов |
|---|---|
| User Service | 18 |
| Academic Service | 15 |
| Contracts Service | 8 |
| CRM Service | 5 |
| Notification Service | 5 |
| **Итого** | **51** |
