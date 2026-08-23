import { crmApi } from "./http.js";
import { cachedQuery, invalidateQuery } from "./queryCache.js";

// 4.2 Внутренняя заявка «записаться на новый курс» (parent)
// parent_name/phone — контактные данные родителя, оформляющего заявку,
// чтобы менеджер видел их сразу в заявке в CRM, не уходя за ними в User Service.
export function createInternalApplication({ student_id, subject_interest, format, parent_name, phone }) {
  return crmApi("/applications", {
    method: "POST",
    body: { student_id, subject_interest, format, parent_name, phone },
  }).then((res) => {
    invalidateQuery(["applications"]);
    return res;
  });
}

// 4.3 Список заявок (owner only)
export function fetchApplications({ status } = {}) {
  return cachedQuery(["applications", { status }], () => crmApi("/applications", { params: { status } }), {
    staleTime: 10_000,
  });
}

// 4.4 Обновить статус заявки (owner)
export function updateApplication(id, patch) {
  return crmApi(`/applications/${id}`, { method: "PATCH", body: patch }).then((res) => {
    invalidateQuery(["applications"]);
    return res;
  });
}

// 4.5 Удалить заявку (owner)
export function deleteApplication(id) {
  return crmApi(`/applications/${id}`, { method: "DELETE" }).then((res) => {
    invalidateQuery(["applications"]);
    return res;
  });
}
