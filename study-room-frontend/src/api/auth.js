import { usersApi, logout as httpLogout } from "./http.js";

// 1.2 Вход — POST /auth/login
export function login({ login, password }) {
  return usersApi("/auth/login", { method: "POST", auth: false, body: { login, password } });
}

// 1.1 Регистрация родителя — POST /auth/register (регистрирует всегда как parent)
export function registerParent({ email, phone, password, last_name, first_name, patronymic }) {
  return usersApi("/auth/register", {
    method: "POST",
    auth: false,
    body: { email, phone, password, last_name, first_name, patronymic },
  });
}

// Выход — POST /auth/logout. Отзывает refresh-токен на сервере (по
// httpOnly cookie, тело запроса не нужно) и чистит локальное состояние
// (память + кэш профиля). См. api/http.js.
export function logout() {
  return httpLogout();
}

// 1.4 Запрос на восстановление пароля
export function forgotPassword({ email }) {
  return usersApi("/auth/forgot-password", { method: "POST", auth: false, body: { email } });
}

// 1.5 Сброс пароля
export function resetPassword({ reset_token, new_password }) {
  return usersApi("/auth/reset-password", { method: "POST", auth: false, body: { reset_token, new_password } });
}

// 1.6 Получить свой профиль
export function fetchMe() {
  return usersApi("/users/me");
}

// 1.7 Обновить свой профиль (имя/фамилия/отчество/аватар; class_info/school — только для ученика)
export function updateMe(patch) {
  return usersApi("/users/me", { method: "PATCH", body: patch });
}

// 1.8 Сменить пароль
export function changePassword({ current_password, new_password }) {
  return usersApi("/users/me/change-password", { method: "POST", body: { current_password, new_password } });
}
