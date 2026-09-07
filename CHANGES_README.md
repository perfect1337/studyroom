# Версия учителя для владельца филиала (branch_owner)

Архив содержит только изменённые/добавленные файлы — структура папок совпадает
со структурой репозитория `studyroom`, просто скопируйте их поверх своей
рабочей копии (или примените как патч).

## Как это работает

1. В настройках (`SettingsPage.jsx`) у владельца филиала появляется тумблер
   «Зарегистрироваться как учитель». Он дёргает новый эндпоинт
   `PATCH /users/me/tutor-mode` в user-service.
2. Эндпоинт выставляет `users.is_tutor = true/false`, при первом включении
   создаёт/активирует `tutor_profiles`, и **сразу перевыпускает JWT**
   (access + refresh), чтобы новые права появились без ожидания
   `/auth/refresh`.
3. `is_tutor` едет в JWT claims. `ProtectedRoute.jsx` на фронте пускает
   владельца филиала с `is_tutor=true` на все маршруты `/tutor/*` — те же
   самые страницы, что видит обычный учитель (никакого дублирования
   компонентов не потребовалось).
4. В сайдбаре внизу (`Sidebar.jsx`) появляется кнопка:
   - «Сменить на версию учителя» — на страницах `/branch/*`, если
     `is_tutor` включён;
   - «Вернуться в панель филиала» — на страницах `/tutor/*`, если реальная
     роль пользователя `branch_owner` (а не настоящий `tutor`).
5. В academic-service три ранее «tutor-only» действия
   (`POST /homework`, `POST /tests`, `PATCH /tests/{id}/grade`) теперь
   разрешены и такому branch_owner — через `RequireTutorCapable()`
   (роль `tutor` ИЛИ `branch_owner` + `is_tutor`). Всё остальное
   (назначение курсов себе, создание уроков) уже было разрешено
   branch_owner без изменений — это выяснилось при разборе кода.
6. Списки заданий/тестов (`GET /homework`, `GET /tests`) для branch_owner
   дополнительно принимают необязательный `?tutor_id=`, сужающий список до
   «только моё» — так же, как это уже работало для уроков и курсов.

Все данные (курсы, ученики, задания, оценки) при включении/выключении
режима не удаляются и не сбрасываются — флаг `is_tutor` только
показывает/прячет функциональность.

## Изменённые файлы

### Backend — user-service
- `internal/migrate/sql/0007_branch_owner_is_tutor.{up,down}.sql` — новая колонка `users.is_tutor`
- `internal/models/models.go` — поле `User.IsTutor`
- `internal/repository/user_repository.go` — колонка в SELECT/scan, `is_tutor` разрешён в `Update()`
- `internal/auth/jwt.go` — `is_tutor` в JWT claims
- `internal/handlers/cookies.go` — `setRefreshCookie` вынесен в свободную функцию (переиспользуется вне `AuthHandler`)
- `internal/handlers/user_handler.go` — новый хендлер `SetTutorMode` (`PATCH /users/me/tutor-mode`)
- `internal/app/app.go` — маршрут + новые зависимости `UserHandler`

### Backend — academic-service
- `internal/auth/jwt.go` — `is_tutor` в claims + `CanActAsTutor()`
- `internal/middleware/auth.go` — `RequireTutorCapable()`
- `internal/app/app.go` — homework/tests create+grade используют `RequireTutorCapable()`
- `internal/handlers/homework_handler.go`, `internal/handlers/test_handler.go` — опциональный `?tutor_id=` для branch_owner в List

### Frontend
- `src/api/auth.js` — `setTutorMode(enabled)`
- `src/context/AuthContext.jsx` — `setTutorMode()` в контексте, обновляет токен и юзера
- `src/utils/userDisplay.js` — `toSidebarUser` теперь прокидывает `role`/`isTutor`
- `src/components/routing/ProtectedRoute.jsx` — пускает branch_owner+is_tutor на маршруты роли `tutor`
- `src/components/layout/Sidebar.jsx` — кнопка переключения вида внизу меню
- `src/pages/settings/SettingsPage.jsx` — тумблер «Зарегистрироваться как учитель»

## Проверено

- `go build ./...` и `go vet ./...` — чисто для `user-service` и `academic-service`
  (единственная ошибка `go vet` в `academic-service/tests/contracts/...` —
  предсуществующая, не связана с этими изменениями, проверено через `git stash`).
- `npm run build` фронтенда проходит без ошибок.

## Не входит в этот патч (при желании можно доделать отдельно)

- Явная кнопка/фильтр «только мои» в самих `TutorHomework.jsx`/`TutorTests.jsx`
  (сейчас `?tutor_id=` поддержан бэкендом, но фронтовые Tutor-страницы его
  ещё не передают — без него branch_owner в режиме учителя увидит
  задания/тесты по всему филиалу, а не только свои; для tutor-only это
  не проблема, т.к. бэкенд и так сам сужает по роли).
- Аналогичные проверки в contracts-service/notification-service/crm-service —
  там не нашлось tutor-only действий, критичных для этого сценария
  (назначение курсов и создание уроков и так не проверяют роль tutor
  для tutor_id).
