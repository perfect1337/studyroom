# Fix: учитель не может войти после «Уволить → Восстановить в штат»

## Что внутри

Структура папок совпадает со структурой репозитория `studyroom` — можно
просто распаковать архив поверх корня репозитория и подтвердить перезапись
изменённых файлов (или применить `fix-teacher-reinstate.patch`, если удобнее
через git).

```
study-room-backend/
  user-service/
    internal/handlers/user_handler.go        (изменён)
    tests/contracts/users_contracts_test.go  (изменён)
    tests/contracts/repro_fire_reinstate_test.go  (новый файл)
study-room-frontend/
  src/pages/admin/TeacherDetail.jsx          (изменён)
fix-teacher-reinstate.patch                  (тот же diff в виде git-патча)
```

## Причина бага

При увольнении (`fireTutorOrDeactivate`) менялись два поля:
`users.is_active = false` **и** `tutor_profiles.status = inactive`.

При восстановлении (кнопка «Восстановить в штат») менялось только
`users.is_active = true` — `tutor_profiles.status` так и оставался
`inactive`. Карточка учителя продолжала показывать «Неактивен» рядом с
отдельным выпадающим списком статуса, который всегда был виден (даже для
уволенных) и дёргал **другой** эндпоинт (`PATCH /tutors/{id}/status`),
не трогающий `is_active`. Админ, видя «Неактивен», часто переключал именно
этот дропдаун вместо кнопки «Восстановить в штат» — бейдж менялся на
«Активен», а `is_active` оставался `false`, и вход был по-прежнему заблокирован.

## Что исправлено

1. `user_handler.go` — новая функция `reinstateTutorOrActivate`,
   симметричная `fireTutorOrDeactivate`: восстановление теперь синхронно
   возвращает и `is_active=true`, и `tutor_profiles.status=active`.
2. `TeacherDetail.jsx` — выпадающий список статуса скрыт, пока преподаватель
   уволен (виден только когда `isFired === false`). Единственный способ
   восстановить доступ — кнопка «Восстановить в штат».
3. `users_contracts_test.go` — исправлен ранее битый тест
   `TestContract_1_14_SetStatus_OwnerOnly` (ошибочно ожидал 403 там, где код
   и так корректно разрешал branch_owner восстанавливать учителя своего
   филиала); переименован в `TestContract_1_14_SetStatus_BranchScoped` с
   более полным набором проверок.
4. `repro_fire_reinstate_test.go` — новый регрессионный тест, гоняющий
   весь сценарий увольнение → блокировка логина → восстановление → логин
   снова работает, отдельно для owner и для branch_owner.

Все тесты проверены на реальном Postgres (не только компиляция).

## Деплой

Нужно пересобрать и передеплоить:
- `user-service` (бэкенд, Go)
- `study-room-frontend`

## Разовая правка для уже "зависших" записей в БД

Если в проде уже есть учителя, которых уволили и восстановили ДО этого
фикса — у них `is_active=true`, но `tutor_profiles.status` всё ещё
`inactive`. Разовый SQL, чтобы починить только их (без повторного клика по
кнопке):

```sql
UPDATE tutor_profiles
SET status = 'active'
FROM users
WHERE tutor_profiles.user_id = users.id
  AND users.is_active = true
  AND tutor_profiles.status = 'inactive';
```
