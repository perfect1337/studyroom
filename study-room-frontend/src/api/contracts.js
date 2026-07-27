import { contractsApi } from "./http.js";

// База API.contracts уже равна .../api/v1/contracts (см. config.js),
// поэтому здесь пути НЕ повторяют "/contracts" — иначе получится
// .../api/v1/contracts/contracts и 404 (см. contracts-service/internal/app/app.go,
// маршруты зарегистрированы относительно "/api/v1/contracts").

// 3.1 Создать договор (owner)
export function createContract(payload) {
  return contractsApi("", { method: "POST", body: payload });
}

// 3.2 Список договоров (owner only — полные данные с суммой/оплатой)
export function fetchContracts({ branch_id, student_id, status } = {}) {
  return contractsApi("", { params: { branch_id, student_id, status } });
}

// 3.3 Договор по id (owner only)
export function fetchContractById(id) {
  return contractsApi(`/${id}`);
}

// 3.3a Только дата окончания договора (branch_owner / parent)
export function fetchContractExpiry(id) {
  return contractsApi(`/${id}/expiry`);
}

// Список своих договоров (parent only — договоры всех своих детей).
export function fetchMyContracts({ status } = {}) {
  return contractsApi("/mine", { params: { status } });
}

// 3.4 Изменить договор
export function updateContract(id, patch) {
  return contractsApi(`/${id}`, { method: "PATCH", body: patch });
}

// 3.5 Изменить статус договора
export function setContractStatus(id, status) {
  return contractsApi(`/${id}/status`, { method: "PATCH", body: { status } });
}

// 3.6 Отметить оплату вручную
export function setContractPaymentStatus(id, payment_status) {
  return contractsApi(`/${id}/payment-status`, { method: "PATCH", body: { payment_status } });
}

// 3.7 Удалить договор
export function deleteContract(id) {
  return contractsApi(`/${id}`, { method: "DELETE" });
}
