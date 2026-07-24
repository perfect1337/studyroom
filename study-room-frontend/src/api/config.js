// Базовые адреса микросервисов бэкенда (study-room-backend, см. README).
// Каждый сервис слушает свой порт по умолчанию (docker-compose.yml):
//   user-service          -> 8081  /api/v1/users
//   academic-service       -> 8082  /api/v1/academic
//   contracts-service      -> 8083  /api/v1/contracts
//   crm-service            -> 8084  /api/v1/crm
//   notification-service   -> 8085  /api/v1/notifications
//
// В проде за этими адресами обычно стоит общий gateway — тогда просто
// пропишите один и тот же домен с нужными префиксами в .env (см. .env.example).
export const API = {
  users: import.meta.env.VITE_USERS_API ?? "http://localhost:8081/api/v1",
  academic: import.meta.env.VITE_ACADEMIC_API ?? "http://localhost:8082/api/v1/academic",
  contracts: import.meta.env.VITE_CONTRACTS_API ?? "http://localhost:8083/api/v1/contracts",
  crm: import.meta.env.VITE_CRM_API ?? "http://localhost:8084/api/v1/crm",
  notifications: import.meta.env.VITE_NOTIFICATIONS_API ?? "http://localhost:8085/api/v1/notifications",
};

export const ACCESS_TOKEN_KEY = "sr_access_token";
export const REFRESH_TOKEN_KEY = "sr_refresh_token";
export const USER_KEY = "sr_user";
