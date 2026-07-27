import { crmApi } from "./http.js";

// 4.2 Внутренняя заявка «записаться на новый курс» (parent)
// parent_name/phone — контактные данные родителя, оформляющего заявку,
// чтобы менеджер видел их сразу в заявке в CRM, не уходя за ними в User Service.
export function createInternalApplication({ student_id, subject_interest, format, parent_name, phone }) {
  return crmApi("/applications", {
    method: "POST",
    body: { student_id, subject_interest, format, parent_name, phone },
  });
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
