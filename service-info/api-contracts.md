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

\* Пока Academic Service не отдаёт enrollments в User Service, у `tutor` в `students` — ученики с тем же `branch_id`. После появления связки enrollment это сузится до «только мои ученики».

`auth`: true
`roles`: любая (у `student` все списки пустые)

## 1.10. Получить пользователя по id
`GET /users/{id}`

Тело запроса: —
Тело ответа: объект пользователя (как в 1.6) либо `404`
`auth`: true
`roles`: `owner`; `branch_owner` (только если `user.branch_id` совпадает с его собственным — иначе `403`); `tutor` (только если `id` — его собственный ученик, проверяется через Academic Service или локальный `user_refs`); `parent` (только свой ребёнок); сам пользователь (self)

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
`GET /courses?branch_id=1&subject=Математика`

Тело ответа:
```json
{ "items": [ { "id": 1, "title": "Математика - Подготовка к ЕГЭ", "subject": "Математика", "format": "individual", "branch_id": 1 } ] }
```
`auth`: true
`roles`: любая (фильтр по `branch_id` обязателен для `branch_owner`, `tutor`, `student`, `parent`; **`owner` не ограничен — видит курсы и записи учеников во всех филиалах без фильтра**)

## 2.2. Создать курс
`POST /courses`

Тело запроса:
```json
{ "title": "Английский язык (B2)", "subject": "Английский", "format": "group", "description": "...", "branch_id": 1 }
```
Тело ответа: созданный курс
`auth`: true
`roles`: `owner` **только**

## 2.3. Обновить / удалить курс
`PATCH /courses/{id}` · `DELETE /courses/{id}`

Тело запроса (PATCH): подмножество полей курса
Тело ответа: обновлённый курс / без ответа, код 200
`auth`: true
`roles`: `owner` **только** (и для PATCH, и для DELETE — `branch_owner` курсы не редактирует)

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
`auth`: true
`roles`: `owner` (любой филиал), `branch_owner` (только записи своего филиала)

## 2.5. Список записей на курсы
`GET /enrollments?student_id=&tutor_id=&course_id=`

Тело ответа:
```json
{ "items": [ { "id": 1, "student_id": 4588201, "course_id": 1, "tutor_id": 15, "progress_pct": 75, "status": "active" } ] }
```
`auth`: true
`roles`: любая, с обязательной фильтрацией — `tutor` видит только свои, `parent`/`student` только свои/детские, `branch_owner` только свой филиал

## 2.6. Обновить прогресс/статус записи
`PATCH /enrollments/{id}`

Тело запроса:
```json
{ "progress_pct": 80, "status": "active" }
```
Тело ответа: обновлённая запись
`auth`: true
`roles`: `tutor` (свои ученики), `owner`, `branch_owner`(свой филиал)

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
  "course_id": 1, "tutor_id": 15, "topic": "Введение в алгебру",
  "lesson_date": "2026-07-20", "start_time": "16:00", "end_time": "17:30",
  "location_type": "remote", "group_type": "individual", "comment": "..."
}
```
Тело ответа: созданное занятие (`created_by` заполняется из JWT автоматически)
`auth`: true
`roles`: `tutor` (только `tutor_id` = свой), `owner` (любой `tutor_id`), `branch_owner` (`tutor_id` только из своего филиала)

## 2.9. Обновить / отменить занятие
`PATCH /lessons/{id}` · `DELETE /lessons/{id}`

Тело запроса (PATCH): подмножество полей занятия
Тело ответа: обновлённое занятие / без ответа, код 200
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
`roles`: `owner` **только**. Полный объект договора (сумма, статус оплаты, даты) больше никому, кроме владельца, не отдаётся — см. 3.3a для остальных ролей.

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

# Сводка по количеству методов

| Сервис | Методов |
|---|---|
| User Service | 18 |
| Academic Service | 15 |
| Contracts Service | 8 |
| CRM Service | 5 |
| Notification Service | 5 |
| **Итого** | **51** |
