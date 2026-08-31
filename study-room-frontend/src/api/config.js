// Базовые адреса микросервисов бэкенда (study-room-backend, см. README).
// Все запросы идут через nginx gateway на :443 (HTTPS).
//
// ВАЖНО про дефолты: раньше здесь было "https://localhost/api/v1/...".
// Это работало только если открывать сайт буквально по адресу localhost.
// На реальном домене (например, https://mestudyroom64.ru) браузер честно
// слал бы запросы на https://localhost/... — то есть на машину самого
// пользователя, а не на прод-сервер — и всё приложение переставало бы
// работать полностью (ни один запрос к API не проходил бы). Файл
// .env.prod с правильным доменом Vite при этом НЕ подхватывает
// автоматически (сборка триггерится через `vite build`, а Vite сам
// грузит только .env / .env.production, но не .env.prod — опечатка в
// названии файла).
// Дефолт теперь — относительный путь. Он самодостаточен и работает на
// любом домене без какой-либо сборочной конфигурации: и фронтенд, и
// проксируемое /api/v1/* отдаются одним и тем же nginx на одном и том
// же домене (см. study-room-backend/nginx/nginx.conf), так что
// относительный путь всегда резолвится в текущий домен браузера.
// VITE_*_API по-прежнему можно задать явно, если API живёт на другом
// хосте, чем сам фронтенд.
//
// API.users = "/api/v1", БЕЗ суффикса "/users" — user-service отдаёт под
// этим префиксом сразу несколько групп путей (/auth/login, /users/me,
// /branches, /parents/... — см. user-service/internal/app/app.go), и
// вызовы в api/auth.js, api/users.js уже сами добавляют нужный сегмент
// (usersApi("/auth/login"), usersApi("/users/me") и т.д.). Суффикс
// "/users" здесь — гарантированный 404 на /auth/*, /branches, /parents/*.
export const API = {
  users: import.meta.env.VITE_USERS_API ?? "/api/v1",
  academic: import.meta.env.VITE_ACADEMIC_API ?? "/api/v1/academic",
  contracts: import.meta.env.VITE_CONTRACTS_API ?? "/api/v1/contracts",
  crm: import.meta.env.VITE_CRM_API ?? "/api/v1/crm",
  notifications: import.meta.env.VITE_NOTIFICATIONS_API ?? "/api/v1/notifications",
};

// TELEGRAM_BOT_USERNAME — username бота (без "@"), на который ведут все
// ссылки "Открыть бота" (SettingsPage.jsx, ParentOverview.jsx,
// TelegramConnectBanner.jsx). Раньше строка "StudyRoomNotificationBot" была
// захардкожена в каждом из этих трёх мест по отдельности и никак не
// проверялась на соответствие реальному боту, привязанному к
// TELEGRAM_BOT_TOKEN на бэкенде (notification-service) — эти два значения
// вообще ничем не связаны. Если у бота в BotFather другой username, чем
// "StudyRoomNotificationBot" — ссылка ведёт на несуществующий/чужой чат, и
// Telegram просто не открывает окно с диалогом (то, что выглядит как "окно
// не показывается"). Задайте VITE_TELEGRAM_BOT_USERNAME в .env / .env.prod
// строго тем username'ом, который реально показывает BotFather для вашего
// TELEGRAM_BOT_TOKEN (Telegram -> @BotFather -> /mybots -> ваш бот).
export const TELEGRAM_BOT_USERNAME =
  import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? "StudyRoomNotificationBot";
export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;

// USER_KEY — в localStorage кэшируется только не-секретная информация о
// пользователе (id/роль/имя) для мгновенного отображения UI до ответа
// сервера. Сами токены здесь больше не хранятся: access-токен живёт в
// памяти вкладки, refresh-токен — в httpOnly cookie на бэкенде (см. http.js).
export const USER_KEY = "sr_user";
