import { notificationsApi } from "./http.js";

// База API.notifications уже равна .../api/v1/notifications (см. config.js),
// поэтому здесь пути НЕ повторяют "/notifications" — иначе получится
// .../api/v1/notifications/notifications и 404 (см.
// notification-service/internal/app/app.go, маршруты зарегистрированы
// относительно "/api/v1", а не "/api/v1/notifications").

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
