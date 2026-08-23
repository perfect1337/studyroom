// Базовые адреса микросервисов бэкенда (study-room-backend, см. README).
// Все запросы идут через nginx gateway на :80.
export const API = {
  users: import.meta.env.VITE_USERS_API ?? "http://localhost/api/v1",
  academic: import.meta.env.VITE_ACADEMIC_API ?? "http://localhost/api/v1/academic",
  contracts: import.meta.env.VITE_CONTRACTS_API ?? "http://localhost/api/v1/contracts",
  crm: import.meta.env.VITE_CRM_API ?? "http://localhost/api/v1/crm",
  notifications: import.meta.env.VITE_NOTIFICATIONS_API ?? "http://localhost/api/v1/notifications",
};

// USER_KEY — в localStorage кэшируется только не-секретная информация о
// пользователе (id/роль/имя) для мгновенного отображения UI до ответа
// сервера. Сами токены здесь больше не хранятся: access-токен живёт в
// памяти вкладки, refresh-токен — в httpOnly cookie на бэкенде (см. http.js).
export const USER_KEY = "sr_user";
