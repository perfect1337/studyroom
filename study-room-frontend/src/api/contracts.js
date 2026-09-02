import { contractsApi } from "./http.js";
import { cachedQuery, invalidateQuery } from "./queryCache.js";

// База API.contracts уже равна .../api/v1/contracts (см. config.js),
// поэтому здесь пути НЕ повторяют "/contracts" — иначе получится
// .../api/v1/contracts/contracts и 404 (см. contracts-service/internal/app/app.go,
// маршруты зарегистрированы относительно "/api/v1/contracts").

// 3.1 Создать договор (owner)
export function createContract(payload) {
  return contractsApi("", { method: "POST", body: payload }).then((res) => {
    invalidateQuery(["contracts"]);
    invalidateQuery(["myContracts"]);
    return res;
  });
}

// 3.2 Список договоров: owner (полные данные с суммой/оплатой, любой филиал);
// branch_owner (только свой филиал — сервер сам подставляет branch_id из JWT,
// в ответе нет amount/payment_status, зато есть status/start_date/end_date).
export function fetchContracts({ branch_id, student_id, status } = {}) {
  return cachedQuery(
    ["contracts", { branch_id, student_id, status }],
    () => contractsApi("", { params: { branch_id, student_id, status } }),
    { staleTime: 10_000 }
  );
}

// Принудительная загрузка списка договоров без клиентского кэша —
// используется финансовой таблицей, где статус должен сразу соответствовать
// фактическому статусу конкретного договора в backend.
export function fetchContractsFresh({ branch_id, student_id, status } = {}) {
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
  return cachedQuery(["myContracts", { status }], () => contractsApi("/mine", { params: { status } }), {
    staleTime: 10_000,
  });
}

// 3.4 Изменить договор
export function updateContract(id, patch) {
  return contractsApi(`/${id}`, { method: "PATCH", body: patch }).then((res) => {
    invalidateQuery(["contracts"]);
    invalidateQuery(["myContracts"]);
    return res;
  });
}

// 3.5 Изменить статус договора
export function setContractStatus(id, status) {
  return contractsApi(`/${id}/status`, { method: "PATCH", body: { status } }).then((res) => {
    invalidateQuery(["contracts"]);
    invalidateQuery(["myContracts"]);
    return res;
  });
}

// 3.6 Отметить оплату вручную
export function setContractPaymentStatus(id, payment_status) {
  return contractsApi(`/${id}/payment-status`, { method: "PATCH", body: { payment_status } }).then((res) => {
    invalidateQuery(["contracts"]);
    invalidateQuery(["myContracts"]);
    return res;
  });
}

// 3.7 Удалить договор
export function deleteContract(id) {
  return contractsApi(`/${id}`, { method: "DELETE" }).then((res) => {
    invalidateQuery(["contracts"]);
    invalidateQuery(["myContracts"]);
    return res;
  });
}
