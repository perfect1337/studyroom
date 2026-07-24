import { notificationsApi } from "./http.js";

// 5.1 Список своих уведомлений (для колокольчика в шапке)
export function fetchNotifications({ unread_only } = {}) {
  return notificationsApi("/notifications", { params: { unread_only } });
}

// 5.2 Отметить уведомление прочитанным
export function markNotificationRead(id) {
  return notificationsApi(`/notifications/${id}/read`, { method: "PATCH" });
}

// 5.3 Настройки каналов уведомлений
export function fetchNotificationSettings() {
  return notificationsApi("/notifications/settings");
}

// 5.4 Обновить настройки каналов
export function updateNotificationSettings(patch) {
  return notificationsApi("/notifications/settings", { method: "PATCH", body: patch });
}
