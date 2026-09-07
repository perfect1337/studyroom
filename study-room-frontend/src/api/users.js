import { usersApi } from "./http.js";
import { cachedQuery, invalidateQuery } from "./queryCache.js";

// 1.9 Справочник «мои люди» — сервер сам решает, что вернуть, по роли из JWT.
// Всегда приходят ключи children/students/tutors/branch_owners/parents (пустые массивы, если не применимо).
// Кэшируется по (search, branch_id): один и тот же фильтр в пределах 20с не бьёт
// в бэк повторно (например, при быстром переключении вкладок/возврате назад).
export function fetchMyPeople({ search, branch_id } = {}) {
  return cachedQuery(["myPeople", { search, branch_id }], () => usersApi("/users", { params: { search, branch_id } }), {
    staleTime: 20_000,
  });
}

// 1.10 Пользователь по id — часто запрашивается повторно из разных компонентов
// одного экрана (карточка тьютора в списке + в сайдбаре и т.п.), профиль меняется
// редко, поэтому staleTime длиннее обычного.
export function fetchUserById(id) {
  return cachedQuery(["userById", id], () => usersApi(`/users/${id}`), { staleTime: 60_000 });
}

// 1.13 Обновить пользователя (админ-редактирование)
export function updateUser(id, patch) {
  return usersApi(`/users/${id}`, { method: "PATCH", body: patch }).then((res) => {
    invalidateQuery(["userById", id]);
    invalidateQuery(["myPeople"]);
    return res;
  });
}

// 1.14 Активировать/деактивировать пользователя
export function setUserActive(id, is_active) {
  return usersApi(`/users/${id}/status`, { method: "PATCH", body: { is_active } }).then((res) => {
    invalidateQuery(["userById", id]);
    invalidateQuery(["myPeople"]);
    return res;
  });
}

// Полностью удалить аккаунт родителя вместе со всеми его детьми.
// Доступ разрешён только owner; User Service выполняет каскад атомарно.
export function deleteUser(id) {
  return usersApi(`/users/${id}`, { method: "DELETE" }).then((res) => {
    invalidateQuery(["userById", id]);
    invalidateQuery(["myPeople"]);
    invalidateQuery(["parentChildren"]);
    return res;
  });
}

// 1.15 Изменить статус репетитора (active|vacation|sick_leave|inactive)
export function setTutorStatus(id, status) {
  return usersApi(`/tutors/${id}/status`, { method: "PATCH", body: { status } }).then((res) => {
    invalidateQuery(["userById", id]);
    invalidateQuery(["myPeople"]);
    return res;
  });
}

// 1.11 Создать репетитора
export function createTutor(payload) {
  return usersApi("/users/tutors", { method: "POST", body: payload }).then((res) => {
    invalidateQuery(["myPeople"]);
    return res;
  });
}

// 1.12 Создать ученика
export function createStudent(payload) {
  return usersApi("/users/students", { method: "POST", body: payload }).then((res) => {
    invalidateQuery(["myPeople"]);
    return res;
  });
}

// Создать руководителя филиала (owner). На почту уходит логин (email) и
// временный пароль для входа — см. user-service handlers/user_handler.go:CreateBranchOwner.
export function createBranchOwner(payload) {
  return usersApi("/users/branch-owners", { method: "POST", body: payload }).then((res) => {
    invalidateQuery(["myPeople"]);
    return res;
  });
}

// 1.16 Список филиалов (owner) — меняется редко (создание/удаление филиала —
// нечастое административное действие), поэтому кэшируем на 5 минут и явно
// сбрасываем кэш в createBranch/deleteBranch ниже.
export function fetchBranches() {
  return cachedQuery(["branches"], () => usersApi("/branches"), { staleTime: 5 * 60_000 });
}

// 1.17 Создать филиал (owner)
export function createBranch(payload) {
  return usersApi("/branches", { method: "POST", body: payload }).then((res) => {
    invalidateQuery(["branches"]);
    return res;
  });
}

// Удалить филиал (owner). Двойное подтверждение — на фронте (см. AdminBranches.jsx).
// Мягкое удаление на бэкенде (см. user-service handlers/user_handler.go:DeleteBranch):
// сам филиал не стирается, а помечается deleted_at и переезжает в
// GET /branches/deleted ("Удалённые"). Руководители филиала (branch_owner)
// удаляются полностью; преподаватели и ученики остаются с тем же branch_id.
export function deleteBranch(id) {
  return usersApi(`/branches/${id}`, { method: "DELETE" }).then((res) => {
    invalidateQuery(["branches"]);
    invalidateQuery(["deletedBranches"]);
    invalidateQuery(["myPeople"]);
    return res;
  });
}

// Список удалённых филиалов ("корзина" на вкладке "Филиалы", owner). Чтобы
// посмотреть преподавателей/учеников конкретного удалённого филиала,
// используем тот же fetchMyPeople({ branch_id }) — их branch_id никуда не
// делся, изменился только сам филиал.
export function fetchDeletedBranches() {
  return cachedQuery(["deletedBranches"], () => usersApi("/branches/deleted"), { staleTime: 60_000 });
}

// 1.18 Дети родителя
export function fetchParentChildren(parentId) {
  return cachedQuery(["parentChildren", parentId], () => usersApi(`/parents/${parentId}/children`), {
    staleTime: 30_000,
  });
}

// Сбросить логин/пароль ученика (owner — любой; parent — только свой ребёнок).
// Возвращает { login, temp_password } — новые данные для входа.
export function resetStudentCredentials(studentId) {
  return usersApi(`/users/${studentId}/reset-credentials`, { method: "POST" });
}
