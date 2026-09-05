import { academicApi, getCurrentAccessToken } from "./http.js";
import { API } from "./config.js";
import { cachedQuery, invalidateQuery } from "./queryCache.js";

// 2.1 Список курсов. tutor_id — доп.фильтр "курсы, которые ведёт этот
// преподаватель" (через course_tutors, см. 2.1b). tutor может передать
// только свой собственный id, owner/branch_owner — любой.
//
// Кэшируется по (branch_id, subject, tutor_id) на 60с: список курсов запрашивают
// параллельно и Sidebar (карточка тьютора), и сама страница, и фильтры на нескольких
// admin-страницах — без кэша это дублирующиеся сетевые запросы при каждой навигации.
export function fetchCourses({ branch_id, subject, tutor_id } = {}) {
  return cachedQuery(
    ["courses", { branch_id, subject, tutor_id }],
    () => academicApi("/courses", { params: { branch_id, subject, tutor_id } }),
    { staleTime: 60_000 }
  );
}

// 2.2 Создать курс (owner)
export function createCourse(payload) {
  return academicApi("/courses", { method: "POST", body: payload }).then((res) => {
    invalidateQuery(["courses"]);
    return res;
  });
}

// 2.2b Удалить курс (owner). Внимание: у enrollments/lessons на courses стоит
// ON DELETE CASCADE — удаление курса удалит и связанные записи/занятия.
export function deleteCourse(id) {
  return academicApi(`/courses/${id}`, { method: "DELETE" }).then((res) => {
    invalidateQuery(["courses"]);
    invalidateQuery(["enrollments"]);
    invalidateQuery(["lessons"]);
    return res;
  });
}

// 2.1a Список преподавателей курса
export function fetchCourseTutors(courseId) {
  return academicApi(`/courses/${courseId}/tutors`);
}

// 2.1b Назначить преподавателя на курс (owner любой филиал, branch_owner — только свой)
export function assignCourseTutor(courseId, tutorId) {
  return academicApi(`/courses/${courseId}/tutors`, { method: "POST", body: { tutor_id: tutorId } }).then((res) => {
    invalidateQuery(["courses"]);
    return res;
  });
}

// 2.1b Снять преподавателя с курса
export function removeCourseTutor(courseId, tutorId) {
  return academicApi(`/courses/${courseId}/tutors/${tutorId}`, { method: "DELETE" }).then((res) => {
    invalidateQuery(["courses"]);
    return res;
  });
}

// 2.5 Список записей на курсы. Короткий staleTime (не для "кэша ради кэша", а
// чтобы дедуплицировать параллельные запросы одного и того же списка от
// нескольких компонентов на одном экране) — прогресс/статус записи меняется
// достаточно часто, поэтому не держим его в кэше дольше нескольких секунд.
export function fetchEnrollments({ student_id, tutor_id, course_id } = {}) {
  return cachedQuery(
    ["enrollments", { student_id, tutor_id, course_id }],
    () => academicApi("/enrollments", { params: { student_id, tutor_id, course_id } }),
    { staleTime: 5_000 }
  );
}

// 2.6 Обновить прогресс/статус записи
export function updateEnrollment(id, patch) {
  return academicApi(`/enrollments/${id}`, { method: "PATCH", body: patch }).then((res) => {
    invalidateQuery(["enrollments"]);
    return res;
  });
}

// 2.4a Назначить репетитора на запись
export function assignTutorToEnrollment(id, tutor_id) {
  return academicApi(`/enrollments/${id}/assign-tutor`, { method: "PATCH", body: { tutor_id } }).then((res) => {
    invalidateQuery(["enrollments"]);
    return res;
  });
}

// 2.7 Список занятий (расписание) — тот же принцип, что и enrollments выше:
// короткоживущий кэш ради дедупликации одновременных запросов, а не "устаревания".
export function fetchLessons({ tutor_id, student_id, branch_id, date_from, date_to } = {}) {
  return cachedQuery(
    ["lessons", { tutor_id, student_id, branch_id, date_from, date_to }],
    () => academicApi("/lessons", { params: { tutor_id, student_id, branch_id, date_from, date_to } }),
    { staleTime: 5_000 }
  );
}

// 2.8 Создать занятие
//
// ВАЖНО: создание занятия — это ещё и новый знаменатель прогресса ученика по
// курсу (бэкенд сам пересчитывает progress_pct участников, см.
// academic-service LessonHandler.Create -> recalculateProgress), но раньше
// здесь инвалидировался только кэш "lessons" — кэш "enrollments" (где как
// раз лежит progress_pct) оставался старым до истечения его собственного
// staleTime. Из-за этого после создания занятия карточка ученика могла ещё
// какое-то время показывать прежний процент прогресса.
export function createLesson(payload) {
  return academicApi("/lessons", { method: "POST", body: payload }).then((res) => {
    invalidateQuery(["lessons"]);
    invalidateQuery(["enrollments"]);
    return res;
  });
}

export function copyLessonsMonth({ source_year, source_month, target_year, target_month, branch_id } = {}) {
  return academicApi("/lessons/copy-month", {
    method: "POST",
    body: { source_year, source_month, target_year, target_month, branch_id },
  }).then((res) => {
    invalidateQuery(["lessons"]);
    invalidateQuery(["enrollments"]);
    return res;
  });
}

// Подгруппы — сохранённый набор учеников на групповом курсе, чтобы не
// выбирать участников заново при каждом занятии (см. академик-сервис
// SubgroupHandler). course_id обязателен для List, чтобы не тянуть все
// подгруппы тьютора сразу при выборе курса в форме занятия.
export function fetchSubgroups({ course_id, tutor_id } = {}) {
  return academicApi("/subgroups", { params: { course_id, tutor_id } });
}

export function createSubgroup(payload) {
  return academicApi("/subgroups", { method: "POST", body: payload }).then((res) => {
    invalidateQuery(["subgroups"]);
    return res;
  });
}

export function updateSubgroup(id, patch) {
  return academicApi(`/subgroups/${id}`, { method: "PATCH", body: patch }).then((res) => {
    invalidateQuery(["subgroups"]);
    return res;
  });
}

export function deleteSubgroup(id) {
  return academicApi(`/subgroups/${id}`, { method: "DELETE" }).then((res) => {
    invalidateQuery(["subgroups"]);
    return res;
  });
}

// 2.9 Обновить / отменить занятие
//
// ВАЖНО: то же самое для смены статуса занятия — в первую очередь для
// отметки "проведено" (status='completed'), которая на бэкенде сразу
// пересчитывает progress_pct (см. LessonHandler.Update). Без инвалидации
// "enrollments" здесь тьютор мог нажать "Отметить проведённым", занятие
// в календаре переходило в "Выполнено", а процент прогресса на карточке
// ученика при этом визуально не менялся, пока не истечёт кэш enrollments
// или не будет сделан полный релоад страницы — выглядело так, будто
// прогресс "не считается" даже для явно проведённых занятий.
export function updateLesson(id, patch) {
  return academicApi(`/lessons/${id}`, { method: "PATCH", body: patch }).then((res) => {
    invalidateQuery(["lessons"]);
    invalidateQuery(["enrollments"]);
    return res;
  });
}
export function cancelLesson(id) {
  return academicApi(`/lessons/${id}`, { method: "DELETE" }).then((res) => {
    invalidateQuery(["lessons"]);
    invalidateQuery(["enrollments"]);
    return res;
  });
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
  return academicApi("/homework", { method: "POST", body: { student_id, link_url } }).then((res) => {
    invalidateQuery(["homework"]);
    return res;
  });
}
export function fetchHomework({ student_id, status } = {}) {
  return cachedQuery(
    ["homework", { student_id, status }],
    () => academicApi("/homework", { params: { student_id, status } }),
    { staleTime: 5_000 }
  );
}
// 2.14 Открыть задание — по контракту это 302 redirect на link_url, который заодно
// помечает задание просмотренным на сервере. Мы уже знаем link_url из списка (2.13),
// поэтому открываем его сами через window.open, а этот вызов используем только
// ради побочного эффекта (assigned -> viewed) и не ждём/не парсим ответ как JSON.
export function markHomeworkOpened(id) {
  const token = getCurrentAccessToken();
  invalidateQuery(["homework"]);
  return fetch(`${API.academic}/homework/${id}/open`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).catch(() => {});
}

export function openHomeworkUrl(id) {
  return academicApi(`/homework/${id}/open`).then((res) => {
    invalidateQuery(["homework"]);
    return res;
  });
}

// 2.19 Тесты: тьютор выдаёт ученику ссылку на тест, после сдачи выставляет
// оценку (1..5). Область видимости списка сужается на бэкенде по роли
// (см. test_handler.go: tutor — свои выданные, student — свои, parent —
// детей, branch_owner — свой филиал, owner — всё/по фильтру).
export function assignTest({ student_id, title, link_url, course_id }) {
  return academicApi("/tests", { method: "POST", body: { student_id, title, link_url, course_id } }).then((res) => {
    invalidateQuery(["tests"]);
    return res;
  });
}
export function fetchTests({ student_id, status } = {}) {
  return cachedQuery(
    ["tests", { student_id, status }],
    () => academicApi("/tests", { params: { student_id, status } }),
    { staleTime: 5_000 }
  );
}
// Ученик отмечает тест сданным (assigned -> submitted).
export function submitTest(id) {
  return academicApi(`/tests/${id}/submit`, { method: "POST" }).then((res) => {
    invalidateQuery(["tests"]);
    return res;
  });
}
// Тьютор выставляет/меняет оценку за сданный тест.
export function gradeTest(id, grade) {
  return academicApi(`/tests/${id}/grade`, { method: "PATCH", body: { grade } }).then((res) => {
    invalidateQuery(["tests"]);
    return res;
  });
}
