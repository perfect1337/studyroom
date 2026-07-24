import { contractsApi } from "./http.js";

// 3.1 Создать договор (owner)
export function createContract(payload) {
  return contractsApi("/contracts", { method: "POST", body: payload });
}

// 3.2 Список договоров (owner only — полные данные с суммой/оплатой)
export function fetchContracts({ branch_id, student_id, status } = {}) {
  return contractsApi("/contracts", { params: { branch_id, student_id, status } });
}

// 3.3 Договор по id (owner only)
export function fetchContractById(id) {
  return contractsApi(`/contracts/${id}`);
}

// 3.3a Только дата окончания договора (branch_owner / parent)
export function fetchContractExpiry(id) {
  return contractsApi(`/contracts/${id}/expiry`);
}

// 3.4 Изменить договор
export function updateContract(id, patch) {
  return contractsApi(`/contracts/${id}`, { method: "PATCH", body: patch });
}

// 3.5 Изменить статус договора
export function setContractStatus(id, status) {
  return contractsApi(`/contracts/${id}/status`, { method: "PATCH", body: { status } });
}

// 3.6 Отметить оплату вручную
export function setContractPaymentStatus(id, payment_status) {
  return contractsApi(`/contracts/${id}/payment-status`, { method: "PATCH", body: { payment_status } });
}

// 3.7 Удалить договор
export function deleteContract(id) {
  return contractsApi(`/contracts/${id}`, { method: "DELETE" });
}
