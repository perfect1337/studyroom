import { usersApi } from "./http.js";

// 1.9 Справочник «мои люди» — сервер сам решает, что вернуть, по роли из JWT.
// Всегда приходят ключи children/students/tutors/branch_owners/parents (пустые массивы, если не применимо).
export function fetchMyPeople({ search, branch_id } = {}) {
  return usersApi("/users", { params: { search, branch_id } });
}

// 1.10 Пользователь по id
export function fetchUserById(id) {
  return usersApi(`/users/${id}`);
}

// 1.13 Обновить пользователя (админ-редактирование)
export function updateUser(id, patch) {
  return usersApi(`/users/${id}`, { method: "PATCH", body: patch });
}

// 1.14 Активировать/деактивировать пользователя
export function setUserActive(id, is_active) {
  return usersApi(`/users/${id}/status`, { method: "PATCH", body: { is_active } });
}

// 1.15 Изменить статус репетитора (active|vacation|sick_leave|inactive)
export function setTutorStatus(id, status) {
  return usersApi(`/tutors/${id}/status`, { method: "PATCH", body: { status } });
}

// 1.11 Создать репетитора
export function createTutor(payload) {
  return usersApi("/users/tutors", { method: "POST", body: payload });
}

// 1.12 Создать ученика
export function createStudent(payload) {
  return usersApi("/users/students", { method: "POST", body: payload });
}

// 1.16 Список филиалов (owner)
export function fetchBranches() {
  return usersApi("/branches");
}

// 1.17 Создать филиал (owner)
export function createBranch(payload) {
  return usersApi("/branches", { method: "POST", body: payload });
}

// Удалить филиал (owner). Двойное подтверждение — на фронте (см. AdminBranches.jsx).
// Пользователи филиала не удаляются, они лишь теряют привязку к филиалу (branch_id -> null).
export function deleteBranch(id) {
  return usersApi(`/branches/${id}`, { method: "DELETE" });
}

// 1.18 Дети родителя
export function fetchParentChildren(parentId) {
  return usersApi(`/parents/${parentId}/children`);
}

// Сбросить логин/пароль ученика (owner — любой; parent — только свой ребёнок).
// Возвращает { login, temp_password } — новые данные для входа.
export function resetStudentCredentials(studentId) {
  return usersApi(`/users/${studentId}/reset-credentials`, { method: "POST" });
}
