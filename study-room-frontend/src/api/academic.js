import { academicApi } from "./http.js";
import { API } from "./config.js";
import { ACCESS_TOKEN_KEY } from "./config.js";

// 2.1 Список курсов. tutor_id — доп.фильтр "курсы, которые ведёт этот
// преподаватель" (через course_tutors, см. 2.1b). tutor может передать
// только свой собственный id, owner/branch_owner — любой.
export function fetchCourses({ branch_id, subject, tutor_id } = {}) {
  return academicApi("/courses", { params: { branch_id, subject, tutor_id } });
}

// 2.2 Создать курс (owner)
export function createCourse(payload) {
  return academicApi("/courses", { method: "POST", body: payload });
}

// 2.2b Удалить курс (owner). Внимание: у enrollments/lessons на courses стоит
// ON DELETE CASCADE — удаление курса удалит и связанные записи/занятия.
export function deleteCourse(id) {
  return academicApi(`/courses/${id}`, { method: "DELETE" });
}

// 2.1a Список преподавателей курса
export function fetchCourseTutors(courseId) {
  return academicApi(`/courses/${courseId}/tutors`);
}

// 2.1b Назначить преподавателя на курс (owner любой филиал, branch_owner — только свой)
export function assignCourseTutor(courseId, tutorId) {
  return academicApi(`/courses/${courseId}/tutors`, { method: "POST", body: { tutor_id: tutorId } });
}

// 2.1b Снять преподавателя с курса
export function removeCourseTutor(courseId, tutorId) {
  return academicApi(`/courses/${courseId}/tutors/${tutorId}`, { method: "DELETE" });
}

// 2.5 Список записей на курсы
export function fetchEnrollments({ student_id, tutor_id, course_id } = {}) {
  return academicApi("/enrollments", { params: { student_id, tutor_id, course_id } });
}

// 2.6 Обновить прогресс/статус записи
export function updateEnrollment(id, patch) {
  return academicApi(`/enrollments/${id}`, { method: "PATCH", body: patch });
}

// 2.4a Назначить репетитора на запись
export function assignTutorToEnrollment(id, tutor_id) {
  return academicApi(`/enrollments/${id}/assign-tutor`, { method: "PATCH", body: { tutor_id } });
}

// 2.7 Список занятий (расписание)
export function fetchLessons({ tutor_id, student_id, branch_id, date_from, date_to } = {}) {
  return academicApi("/lessons", { params: { tutor_id, student_id, branch_id, date_from, date_to } });
}

// 2.8 Создать занятие
export function createLesson(payload) {
  return academicApi("/lessons", { method: "POST", body: payload });
}

// 2.9 Обновить / отменить занятие
export function updateLesson(id, patch) {
  return academicApi(`/lessons/${id}`, { method: "PATCH", body: patch });
}
export function cancelLesson(id) {
  return academicApi(`/lessons/${id}`, { method: "DELETE" });
}

// 2.10 / 2.11 Посещаемость
export function markAttendance(lessonId, records) {
  return academicApi(`/lessons/${lessonId}/attendance`, { method: "POST", body: { records } });
}
export function fetchAttendance(lessonId) {
  return academicApi(`/lessons/${lessonId}/attendance`);
}

// 2.12 / 2.13 / 2.14 Домашние задания
export function assignHomework({ student_id, link_url }) {
  return academicApi("/homework", { method: "POST", body: { student_id, link_url } });
}
export function fetchHomework({ student_id, status } = {}) {
  return academicApi("/homework", { params: { student_id, status } });
}
// 2.14 Открыть задание — по контракту это 302 redirect на link_url, который заодно
// помечает задание просмотренным на сервере. Мы уже знаем link_url из списка (2.13),
// поэтому открываем его сами через window.open, а этот вызов используем только
// ради побочного эффекта (assigned -> viewed) и не ждём/не парсим ответ как JSON.
export function markHomeworkOpened(id) {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  return fetch(`${API.academic}/homework/${id}/open`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).catch(() => {});
}

export function openHomeworkUrl(id) {
  return academicApi(`/homework/${id}/open`);
}
