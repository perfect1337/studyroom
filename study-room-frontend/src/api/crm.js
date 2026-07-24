import { crmApi } from "./http.js";

// 4.2 Внутренняя заявка «записаться на новый курс» (parent)
export function createInternalApplication({ student_id, subject_interest, format }) {
  return crmApi("/applications", { method: "POST", body: { student_id, subject_interest, format } });
}

// 4.3 Список заявок (owner only)
export function fetchApplications({ status } = {}) {
  return crmApi("/applications", { params: { status } });
}

// 4.4 Обновить статус заявки (owner)
export function updateApplication(id, patch) {
  return crmApi(`/applications/${id}`, { method: "PATCH", body: patch });
}

// 4.5 Удалить заявку (owner)
export function deleteApplication(id) {
  return crmApi(`/applications/${id}`, { method: "DELETE" });
}
