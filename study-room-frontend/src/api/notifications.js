import { notificationsApi } from "./http.js";

// База API.notifications уже содержит /api/v1/notifications (см. config.js),
// поэтому здесь просто относительные пути: /settings, /{id}/read и т.д.

// 5.1 Список своих уведомлений (для колокольчика в шапке)
export function fetchNotifications({ unread_only } = {}) {
  return notificationsApi("", { params: { unread_only } });
}

// 5.2 Отметить уведомление прочитанным
export function markNotificationRead(id) {
  return notificationsApi(`/${id}/read`, { method: "PATCH" });
}

// 5.3 Настройки каналов уведомлений
export function fetchNotificationSettings() {
  return notificationsApi("/settings");
}

// 5.4 Обновить настройки каналов
export function updateNotificationSettings(patch) {
  return notificationsApi("/settings", { method: "PATCH", body: patch });
}

// 5.5 Проверить статус подключения Telegram
export function fetchTelegramStatus() {
  return notificationsApi("/telegram/status");
}

// 5.6 Отвязать Telegram от аккаунта
export function unlinkTelegram() {
  return notificationsApi("/telegram/link", { method: "DELETE" });
}
