import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import TutorStatusSelect from "../../components/ui/TutorStatusSelect.jsx";
import Pagination from "../../components/ui/Pagination.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchMyPeople, fetchBranches, setTutorStatus, setUserActive } from "../../api/users.js";
import { fetchEnrollments, fetchCourses, fetchLessons, fetchTests, assignCourseTutor, removeCourseTutor } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const WEEKDAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const TUTOR_STATUS_LABEL = {
  active: "Активен",
  vacation: "В отпуске",
  sick_leave: "На больничном",
  inactive: "Неактивен",
};

// Владелец сети может выставить любой статус, управляющий филиалом —
// только active|vacation|sick_leave (см. api-contracts.md, 1.15). "Уволить"
// (полная блокировка входа, is_active=false) — отдельное действие, доступное
// только owner (см. app.go: /users/{id}/status в группе RequireRoles(owner)).
const STATUS_OPTIONS_BY_ROLE = {
  owner: ["active", "vacation", "sick_leave", "inactive"],
  branch_owner: ["active", "vacation", "sick_leave"],
};

function pad(n) {
  return String(n).padStart(2, "0");
}
function toISODate(year, monthIndex, day) {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}
function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

// Единая карточка "профиль преподавателя" для owner и branch_owner:
// - owner: /admin/teachers/:teacherId — виден любой преподаватель сети,
//   доступны все статусы и увольнение (is_active=false).
// - branch_owner: /branch/teachers/:teacherId — только преподаватель своего
//   филиала (сервер сам ограничивает выборку в GET /users), увольнение
//   доступно так же, как у owner, но только для преподавателей своего
//   филиала (проверяется на бэкенде, см. user-service UserHandler.SetStatus).
const ROLE_CONFIG = {
  owner: {
    sidebarRole: "admin",
    homePath: "/admin",
    homeLabel: "Главная",
    listPath: "/admin/teachers",
    listLabel: "Преподаватели",
    searchPlaceholder: "Поиск студентов или учителей...",
    canFire: true,
  },
  branch_owner: {
    sidebarRole: "branch_owner",
    homePath: "/branch",
    homeLabel: "Главная",
    listPath: "/branch/teachers",
    listLabel: "Преподаватели",
    searchPlaceholder: "Поиск преподавателя...",
    canFire: true,
  },
};

export default function TeacherDetail({ role = "owner" }) {
  const config = ROLE_CONFIG[role] ?? ROLE_CONFIG.owner;
  const { teacherId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isOwner = role === "owner";

  const [teacher, setTeacher] = useState(null);
  const [students, setStudents] = useState([]); // все студенты в области видимости (для имён)
  const [enrollments, setEnrollments] = useState([]); // только его записи (tutor_id=teacherId)
  const [courses, setCourses] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [tests, setTests] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [statusUpdating, setStatusUpdating] = useState(false);
  const [showFireModal, setShowFireModal] = useState(false);
  const [fireStatus, setFireStatus] = useState("");
  const [courseTutorBusyId, setCourseTutorBusyId] = useState(null);
  const [courseTutorError, setCourseTutorError] = useState("");

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(null);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
    setSelectedDay(null);
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
    setSelectedDay(null);
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const date_from = toISODate(viewYear, viewMonth, 1);
      const date_to = toISODate(viewYear, viewMonth, daysInMonth);
      const [peopleRes, coursesRes, lessonsRes, branchesRes, testsRes] = await Promise.all([
        fetchMyPeople(),
        fetchCourses(),
        fetchLessons({ tutor_id: teacherId, date_from, date_to }),
        isOwner ? fetchBranches().catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        // Область видимости сужается на бэкенде по роли (owner — всё, branch_owner — свой филиал).
        fetchTests().catch(() => ({ items: [] })),
      ]);

      const foundTeacher = (peopleRes?.tutors ?? []).find((t) => String(t.id) === String(teacherId));
      const allCourses = coursesRes?.items ?? [];
      setTeacher(foundTeacher ?? null);
      setStudents(peopleRes?.students ?? []);
      setCourses(allCourses);
      setLessons(lessonsRes?.items ?? []);
      setBranches(branchesRes?.items ?? []);
      setTests(testsRes?.items ?? []);

      if (!foundTeacher) {
        setError("Преподаватель не найден или у вас нет доступа к его профилю.");
        setEnrollments([]);
        return;
      }

      // "Ученики преподавателя" = записи на курсы, которые он реально ведёт
      // (course_tutors, см. api-contracts.md 2.1b) — те же ученики, которых
      // видит сам преподаватель на /tutor/students (2.5, ListForTutor) — плюс
      // записи, где его вручную назначили личным тьютором (enrollments.tutor_id,
      // см. 2.4a). Один только фильтр по enrollments.tutor_id (как было раньше)
      // пропускал учеников, к которым преподавателя формально не прикрепляли,
      // но курс которых он ведёт.
      const teacherIdNum = Number(teacherId);
      const taughtCourseIds = allCourses
        .filter((c) => (c.tutor_ids ?? []).includes(teacherIdNum))
        .map((c) => c.id);

      const [byCourseResults, personalRes] = await Promise.all([
        Promise.all(
          taughtCourseIds.map((courseId) => fetchEnrollments({ course_id: courseId }).catch(() => ({ items: [] })))
        ),
        fetchEnrollments({ tutor_id: teacherIdNum }).catch(() => ({ items: [] })),
      ]);

      const merged = new Map();
      byCourseResults.forEach((res) => (res?.items ?? []).forEach((e) => merged.set(e.id, e)));
      (personalRes?.items ?? []).forEach((e) => merged.set(e.id, e));
      setEnrollments(Array.from(merged.values()));
    } catch (e) {
      setError(e.message || "Не удалось загрузить данные преподавателя");
    } finally {
      setLoading(false);
    }
  }

  // Назначить/снять преподавателя с курса своего филиала (2.1b). После смены
  // набора курсов пересчитываем и список "моих учеников" — он напрямую
  // зависит от course_tutors.
  async function handleToggleCourseTutor(courseId, isAssigned) {
    setCourseTutorBusyId(courseId);
    setCourseTutorError("");
    try {
      if (isAssigned) {
        await removeCourseTutor(courseId, Number(teacherId));
      } else {
        await assignCourseTutor(courseId, Number(teacherId));
      }
      await load();
    } catch (e) {
      setCourseTutorError(e.message || "Не удалось обновить курсы преподавателя");
    } finally {
      setCourseTutorBusyId(null);
    }
  }

  useEffect(() => {
    if (!teacherId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId, viewYear, viewMonth]);

  const studentsById = useMemo(() => {
    const map = {};
    students.forEach((s) => (map[s.id] = s));
    return map;
  }, [students]);

  // Средний балл ученика — среднее арифметическое по всем его оценённым
  // тестам в области видимости (owner/branch_owner), а не статичное поле профиля.
  const avgGradeByStudent = useMemo(() => {
    const map = {};
    tests.forEach((t) => {
      if (t.grade == null) return;
      (map[t.student_id] ??= []).push(t.grade);
    });
    const out = {};
    Object.entries(map).forEach(([studentId, grades]) => {
      out[studentId] = grades.reduce((s, g) => s + g, 0) / grades.length;
    });
    return out;
  }, [tests]);

  function avgGradeForStudent(student) {
    return avgGradeByStudent[student.id] ?? student.avg_grade ?? null;
  }

  const coursesById = useMemo(() => {
    const map = {};
    courses.forEach((c) => (map[c.id] = c));
    return map;
  }, [courses]);

  const branchNameById = useMemo(() => {
    const map = {};
    branches.forEach((b) => (map[b.id] = b.name || b.city));
    return map;
  }, [branches]);

  // Курсы — база для карточки "Курсы преподавателя" (назначение/снятие через
  // course_tutors, см. 2.1b). Курсы не привязаны к филиалу — общий каталог
  // курсов всей сети доступен для назначения любому преподавателю.
  const branchCourses = useMemo(() => {
    if (!teacher) return [];
    return [...courses].sort((a, b) => (a.title || a.subject).localeCompare(b.title || b.subject, "ru"));
  }, [courses, teacher]);

  const taughtCourseIds = useMemo(() => {
    const teacherIdNum = Number(teacherId);
    return new Set(courses.filter((c) => (c.tutor_ids ?? []).includes(teacherIdNum)).map((c) => c.id));
  }, [courses, teacherId]);

  // Уникальные ученики, реально записанные к этому преподавателю (по enrollments).
  const myStudents = useMemo(() => {
    const seen = new Map();
    enrollments.forEach((e) => {
      if (!seen.has(e.student_id)) {
        seen.set(e.student_id, { student: studentsById[e.student_id] ?? { id: e.student_id }, enrollments: [] });
      }
      seen.get(e.student_id).enrollments.push(e);
    });
    return Array.from(seen.values());
  }, [enrollments, studentsById]);

  // Пагинация списка учеников этого преподавателя — на клиенте, поверх уже
  // загруженного массива (тот же паттерн, что и Pagination в других списках,
  // см. components/ui/Pagination.jsx).
  const STUDENTS_PAGE_SIZE = 10;
  const [studentsPage, setStudentsPage] = useState(1);
  useEffect(() => {
    setStudentsPage(1);
  }, [myStudents.length]);
  const pagedStudents = useMemo(
    () => myStudents.slice((studentsPage - 1) * STUDENTS_PAGE_SIZE, studentsPage * STUDENTS_PAGE_SIZE),
    [myStudents, studentsPage]
  );

  const avgProgress = enrollments.length
    ? Math.round(enrollments.reduce((s, e) => s + (e.progress_pct ?? 0), 0) / enrollments.length)
    : 0;

  const activeCoursesCount = useMemo(() => {
    const set = new Set(enrollments.filter((e) => e.status === "active").map((e) => e.course_id));
    return set.size;
  }, [enrollments]);

  const lessonsByDay = useMemo(() => {
    const map = {};
    for (const l of lessons) {
      const day = Number(l.lesson_date?.slice(8, 10));
      if (!day) continue;
      (map[day] ??= []).push(l);
    }
    return map;
  }, [lessons]);

  const todayDay = today.getDate();
  const upcomingLessons = lessons
    .filter((l) => l.lesson_date >= toISODate(viewYear, viewMonth, 1))
    .sort((a, b) => (a.lesson_date + a.start_time).localeCompare(b.lesson_date + b.start_time));
  const selectedDayLessons = selectedDay ? (lessonsByDay[selectedDay] ?? []) : [];

  const statusOptions = STATUS_OPTIONS_BY_ROLE[role] ?? STATUS_OPTIONS_BY_ROLE.branch_owner;
  const tutorStatus = teacher?.tutor_status ?? "active";
  const isFired = teacher && teacher.is_active === false;

  async function handleStatusChange(newStatus) {
    setStatusUpdating(true);
    const prev = teacher;
    setTeacher((t) => (t ? { ...t, tutor_status: newStatus } : t));
    try {
      await setTutorStatus(teacherId, newStatus);
    } catch (e) {
      setTeacher(prev);
      setError(e.message || "Не удалось изменить статус преподавателя");
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleFireConfirm() {
    setFireStatus("saving");
    try {
      await setUserActive(teacherId, false);
      // Увольнение на бэкенде (см. user-service SetStatus) дополнительно
      // переводит tutor_status в inactive и асинхронно каскадно зачищает
      // преподавателя в Academic Service (событие user.updated): снимает
      // привязку к курсам/enrollments И физически удаляет все его lessons
      // (со всеми участниками/посещаемостью) — см.
      // academic-service/internal/events/subscriber.go, detachTutor.
      // Перезагружаем карточку целиком, чтобы не показывать устаревший
      // статус и список учеников/занятий, которых уже нет на бэкенде.
      await load();
      setFireStatus("done");
    } catch (e) {
      setFireStatus(e.message || "Не удалось уволить преподавателя");
    }
  }

  async function handleReinstate() {
    setFireStatus("saving-reinstate");
    try {
      await setUserActive(teacherId, true);
      setTeacher((t) => (t ? { ...t, is_active: true } : t));
      setFireStatus("");
    } catch (e) {
      setError(e.message || "Не удалось восстановить преподавателя");
      setFireStatus("");
    }
  }

  if (loading) {
    return (
      <DashboardShell role={config.sidebarRole} user={toSidebarUser(user)} searchPlaceholder={config.searchPlaceholder} userLabel={fullName(user)} avatarUrl={user?.avatar_url}>
        <p className="mt-8 text-on-surface-variant font-body-md">Загрузка…</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell role={config.sidebarRole} user={toSidebarUser(user)} searchPlaceholder={config.searchPlaceholder} userLabel={fullName(user)} avatarUrl={user?.avatar_url}>
      <div className="space-y-stack-lg pb-stack-lg">
        <nav className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-label-md text-on-surface-variant mt-4">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <Link to={config.homePath} className="hover:text-primary shrink-0">{config.homeLabel}</Link>
            <span className="material-symbols-outlined text-[16px] shrink-0">chevron_right</span>
            <Link to={config.listPath} className="hover:text-primary shrink-0">{config.listLabel}</Link>
            <span className="material-symbols-outlined text-[16px] shrink-0">chevron_right</span>
            <span className="text-on-surface font-bold truncate">{teacher ? fullName(teacher) : "—"}</span>
          </div>

          {config.canFire && teacher && (
            isFired ? (
              <button
                onClick={handleReinstate}
                disabled={fireStatus === "saving-reinstate"}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low hover:text-primary transition-colors text-label-md font-label-md disabled:opacity-60 w-full sm:w-auto"
              >
                <span className="material-symbols-outlined text-[18px]">person_check</span>
                {fireStatus === "saving-reinstate" ? "Восстановление…" : "Восстановить в штат"}
              </button>
            ) : (
              <button
                onClick={() => {
                  setFireStatus("");
                  setShowFireModal(true);
                }}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors text-label-md font-label-md w-full sm:w-auto"
              >
                <span className="material-symbols-outlined text-[18px]">person_remove</span>
                Уволить
              </button>
            )
          )}
        </nav>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        {teacher && (
          <>
            <div className="bg-surface-container-lowest p-stack-lg rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30">
              <div className="flex flex-col md:flex-row items-center gap-gutter">
                <div className="relative">
                  <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-primary/10 bg-primary-fixed flex items-center justify-center text-primary font-headline-md font-bold text-3xl">
                    {teacher.avatar_url ? (
                      <img src={teacher.avatar_url} alt={fullName(teacher)} className="w-full h-full object-cover" />
                    ) : (
                      initials(teacher)
                    )}
                  </div>
                </div>
                <div className="flex-1 text-center md:text-left">
                  <div className="flex flex-col md:flex-row md:items-end gap-2 mb-1 justify-center md:justify-start">
                    <h2 className="font-headline-md text-headline-md text-on-surface">{fullName(teacher)}</h2>
                    <span className="text-on-surface-variant font-label-md mb-1.5 opacity-60">ID: {teacher.id}</span>
                    {isFired && <StatusBadge status="Уволен" color="red" />}
                  </div>
                  <p className="text-on-surface-variant font-body-md mb-1">
                    {teacher.specialization || "Специализация не указана"}
                    {teacher.branch_id ? ` · ${branchNameById[teacher.branch_id] || `Филиал #${teacher.branch_id}`}` : ""}
                  </p>
                  <p className="text-on-surface-variant font-body-md mb-4 text-[13px]">
                    {teacher.email && <span className="mr-4">{teacher.email}</span>}
                    {teacher.phone && <span>{teacher.phone}</span>}
                  </p>

                  <div className="flex flex-wrap justify-center md:justify-start items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg">
                      <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>groups</span>
                      <span className="font-label-md text-on-surface">
                        Учеников: <strong className="text-primary">{myStudents.length}</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg">
                      <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>school</span>
                      <span className="font-label-md text-on-surface">
                        Активные курсы: <strong className="text-primary">{activeCoursesCount}</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg">
                      <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                      <span className="font-label-md text-on-surface">
                        Средний прогресс учеников: <strong className="text-primary">{avgProgress}%</strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-2 ml-0 md:ml-2">
                      <StatusBadge status={TUTOR_STATUS_LABEL[tutorStatus] ?? tutorStatus} />
                      {/* Пока преподаватель уволен (isFired, is_active=false), этот
                          дропдаун (active|vacation|sick_leave|inactive) скрываем —
                          он меняет ТОЛЬКО tutor_profiles.status через отдельный
                          endpoint PATCH /tutors/{id}/status и никак не влияет на
                          users.is_active, от которого реально зависит вход в
                          систему. Раньше дропдаун был виден всегда, и было легко
                          по ошибке переключить его на "Активен", решив, что это
                          и есть восстановление — бейдж менялся, а вход всё равно
                          оставался заблокирован, потому что настоящий is_active
                          так и не трогался. Единственный способ вернуть доступ —
                          кнопка "Восстановить в штат" в шапке (handleReinstate),
                          которая теперь синхронно чинит оба поля на бэкенде (см.
                          UserHandler.reinstateTutorOrActivate). */}
                      {!isFired && (
                        <TutorStatusSelect
                          value={tutorStatus}
                          options={statusOptions}
                          labelMap={TUTOR_STATUS_LABEL}
                          disabled={statusUpdating}
                          onChange={handleStatusChange}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-gutter">
              <section className="col-span-12 lg:col-span-8 space-y-stack-md">
                <div className="flex justify-between items-center">
                  <h3 className="font-headline-sm text-headline-sm text-on-surface">Ученики преподавателя</h3>
                </div>

                <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 overflow-hidden">
                  <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[720px]">
                    <thead>
                      <tr className="bg-surface-container-low text-on-surface-variant font-label-md">
                        <th className="px-6 py-4 font-semibold">Ученик</th>
                        <th className="px-6 py-4 font-semibold">Курсы</th>
                        <th className="px-6 py-4 font-semibold">Прогресс</th>
                        <th className="px-6 py-4 font-semibold">Успеваемость</th>
                        <th className="px-6 py-4 font-semibold">Статус</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/20">
                      {myStudents.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-6 py-8 text-center text-on-surface-variant">
                            К этому преподавателю пока не записан ни один ученик
                          </td>
                        </tr>
                      )}
                      {pagedStudents.map(({ student, enrollments: sEnrollments }) => {
                        const avg = sEnrollments.length
                          ? Math.round(sEnrollments.reduce((s, e) => s + (e.progress_pct ?? 0), 0) / sEnrollments.length)
                          : 0;
                        return (
                          <tr
                            key={student.id}
                            onClick={() => navigate(isOwner ? `/admin/students/${student.id}` : `/branch/students/${student.id}`)}
                            className="hover:bg-surface-container-low transition-colors cursor-pointer group"
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center text-primary font-bold">
                                  {initials(student)}
                                </div>
                                <div>
                                  <div className="font-bold text-on-surface">{fullName(student) || "Ученик"}</div>
                                  <div className="text-[12px] text-on-surface-variant">
                                    {[student.class_info, student.school].filter(Boolean).join(" · ") || "—"}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-wrap gap-1">
                                {sEnrollments.map((e) => (
                                  <span key={e.id} className="px-2 py-1 bg-surface-variant rounded text-[11px] font-bold text-primary">
                                    {coursesById[e.course_id]?.title ?? coursesById[e.course_id]?.subject ?? `#${e.course_id}`}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-6 py-4 font-bold text-on-surface">{avg}%</td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-0.5 text-[12px]">
                                <span className="text-on-surface">
                                  {avgGradeForStudent(student) != null ? `Балл: ${avgGradeForStudent(student).toFixed(1)}` : "—"}
                                </span>
                                <span className="text-on-surface-variant">
                                  {student.attendance_pct != null ? `Посещаемость: ${Math.round(student.attendance_pct)}%` : ""}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold uppercase bg-green-100 text-green-700">
                                {sEnrollments.some((e) => e.status === "active") ? "Активен" : "—"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>

                  <div className="md:hidden divide-y divide-outline-variant/20">
                    {myStudents.length === 0 && (
                      <div className="px-4 py-8 text-center text-on-surface-variant">
                        К этому преподавателю пока не записан ни один ученик
                      </div>
                    )}
                    {pagedStudents.map(({ student, enrollments: sEnrollments }) => {
                      const avg = sEnrollments.length
                        ? Math.round(sEnrollments.reduce((s, e) => s + (e.progress_pct ?? 0), 0) / sEnrollments.length)
                        : 0;
                      return (
                        <div
                          key={student.id}
                          onClick={() => navigate(isOwner ? `/admin/students/${student.id}` : `/branch/students/${student.id}`)}
                          className="p-4 flex flex-col gap-3 active:bg-surface-container-low cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 shrink-0 rounded-full bg-primary-container/20 flex items-center justify-center text-primary font-bold">
                              {initials(student)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-bold text-on-surface truncate">{fullName(student) || "Ученик"}</div>
                              <div className="text-[12px] text-on-surface-variant truncate">
                                {[student.class_info, student.school].filter(Boolean).join(" · ") || "—"}
                              </div>
                            </div>
                            <span className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase bg-green-100 text-green-700">
                              {sEnrollments.some((e) => e.status === "active") ? "Активен" : "—"}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {sEnrollments.map((e) => (
                              <span key={e.id} className="px-2 py-1 bg-surface-variant rounded text-[11px] font-bold text-primary">
                                {coursesById[e.course_id]?.title ?? coursesById[e.course_id]?.subject ?? `#${e.course_id}`}
                              </span>
                            ))}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[12px] pt-2 border-t border-outline-variant/20">
                            <div>
                              <span className="text-on-surface-variant block">Прогресс</span>
                              <span className="font-bold text-on-surface">{avg}%</span>
                            </div>
                            <div>
                              <span className="text-on-surface-variant block">Успеваемость</span>
                              <span className="text-on-surface">
                                {avgGradeForStudent(student) != null ? avgGradeForStudent(student).toFixed(1) : "—"}
                                {student.attendance_pct != null ? ` · ${Math.round(student.attendance_pct)}%` : ""}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <Pagination
                    page={studentsPage}
                    pageSize={STUDENTS_PAGE_SIZE}
                    total={myStudents.length}
                    onPageChange={setStudentsPage}
                    itemLabel="учеников"
                  />
                </div>

                <div className="pt-stack-lg">
                  <h3 className="font-headline-sm text-headline-sm text-on-surface mb-stack-md">Все занятия за месяц</h3>
                  <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 overflow-hidden">
                    <div className="hidden md:block">
                    <table className="w-full text-left">
                      <thead className="bg-surface-container text-on-surface-variant text-label-md font-bold uppercase tracking-wider">
                        <tr>
                          <th className="px-6 py-4">Дата / время</th>
                          <th className="px-6 py-4">Тема / курс</th>
                          <th className="px-6 py-4">Формат</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/30">
                        {upcomingLessons.length === 0 && (
                          <tr>
                            <td colSpan={3} className="px-6 py-8 text-center text-on-surface-variant">Занятий в этом месяце не запланировано</td>
                          </tr>
                        )}
                        {upcomingLessons.map((l) => {
                          const course = coursesById[l.course_id];
                          return (
                            <tr key={l.id} className="hover:bg-surface-container-low transition-colors">
                              <td className="px-6 py-5 font-label-md text-on-surface">
                                {new Date(l.lesson_date).toLocaleDateString("ru-RU")} · {l.start_time}–{l.end_time}
                              </td>
                              <td className="px-6 py-5">
                                <p className="font-label-md text-on-surface">{l.topic || course?.title || course?.subject || `Курс #${l.course_id}`}</p>
                              </td>
                              <td className="px-6 py-5 text-[13px] text-on-surface-variant">
                                {l.location_type === "remote" ? "Дистанционно" : "Очно"} · {l.lesson_format === "group" ? "Группа" : "Индивидуально"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>

                    <div className="md:hidden divide-y divide-outline-variant/30">
                      {upcomingLessons.length === 0 && (
                        <div className="px-4 py-8 text-center text-on-surface-variant">Занятий в этом месяце не запланировано</div>
                      )}
                      {upcomingLessons.map((l) => {
                        const course = coursesById[l.course_id];
                        return (
                          <div key={l.id} className="p-4 flex flex-col gap-1">
                            <p className="font-label-md text-on-surface">{l.topic || course?.title || course?.subject || `Курс #${l.course_id}`}</p>
                            <div className="flex items-center justify-between text-[12px]">
                              <span className="text-on-surface-variant">
                                {new Date(l.lesson_date).toLocaleDateString("ru-RU")} · {l.start_time}–{l.end_time}
                              </span>
                              <span className="text-on-surface-variant">
                                {l.location_type === "remote" ? "Дистанционно" : "Очно"} · {l.lesson_format === "group" ? "Группа" : "Индивидуально"}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              <aside className="col-span-12 lg:col-span-4 space-y-stack-lg">
                <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 p-4">
                  <div className="flex justify-between items-center mb-4">
                    <button
                      onClick={prevMonth}
                      className="p-1 hover:bg-surface-container rounded-full text-on-surface-variant"
                    >
                      <span className="material-symbols-outlined">chevron_left</span>
                    </button>
                    <h4 className="font-bold text-on-surface">{MONTH_NAMES[viewMonth]} {viewYear}</h4>
                    <button
                      onClick={nextMonth}
                      className="p-1 hover:bg-surface-container rounded-full text-on-surface-variant"
                    >
                      <span className="material-symbols-outlined">chevron_right</span>
                    </button>
                  </div>

                  {selectedDay && (
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-primary font-bold">
                        Выбрано: {selectedDay} {MONTH_NAMES[viewMonth].toLowerCase().slice(0, 3)}
                      </span>
                      <button
                        onClick={() => setSelectedDay(null)}
                        className="text-xs text-primary hover:underline"
                      >
                        Сбросить
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-7 gap-1 text-center text-on-surface-variant font-bold text-[11px] mb-1">
                    {WEEKDAYS.map((d) => (
                      <div key={d}>{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {Array.from({ length: firstWeekday }).map((_, i) => (
                      <div key={`pad-${i}`} />
                    ))}
                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1;
                      const hasLessons = (lessonsByDay[day] ?? []).length > 0;
                      const isToday = isCurrentMonth && day === todayDay;
                      const isSelected = day === selectedDay;
                      return (
                        <button
                          key={day}
                          onClick={() => setSelectedDay(isSelected ? null : day)}
                          disabled={!hasLessons}
                          className={`text-label-md py-1 rounded-lg relative flex justify-center items-center transition-colors ${
                            isSelected
                              ? "font-bold bg-primary text-white"
                              : isToday
                              ? "font-bold bg-primary/20 text-primary ring-2 ring-primary"
                              : hasLessons
                              ? "text-on-surface hover:bg-primary/10 cursor-pointer"
                              : "text-on-surface-variant/40 cursor-default"
                          }`}
                        >
                          {day}
                          {hasLessons && !isToday && !isSelected && (
                            <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4 pt-4 border-t border-outline-variant space-y-3">
                    {(selectedDay ? selectedDayLessons : upcomingLessons).length === 0 && (
                      <p className="text-sm text-on-surface-variant">
                        {selectedDay ? "Занятий в этот день нет." : "Занятий в этом месяце не запланировано."}
                      </p>
                    )}
                    {(selectedDay ? selectedDayLessons : upcomingLessons).slice(0, 5).map((l) => {
                      const course = coursesById[l.course_id];
                      return (
                        <div key={l.id} className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold bg-primary/10 text-primary">
                            {Number(l.lesson_date.slice(8, 10))}
                          </div>
                          <div className="flex-1">
                            <p className="text-label-md font-bold leading-tight">
                              {l.start_time} - {course?.title ?? course?.subject ?? l.topic}
                            </p>
                            <p className="text-[12px] text-on-surface-variant">
                              {l.location_type === "remote" ? "Дистанционно" : "Очно"}
                            </p>
                            <p className="text-[12px] text-primary font-bold truncate">
                              {(l.participant_ids ?? []).length > 0
                                ? l.participant_ids
                                    .map((sid) => studentsById[sid] ? fullName(studentsById[sid]) : (l.participant_names?.[sid] ?? `Ученик #${sid}`))
                                    .join(", ")
                                : "Ученики не назначены"}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>menu_book</span>
                    <h4 className="font-bold text-on-surface">Курсы преподавателя</h4>
                  </div>
                  <p className="text-[12px] text-on-surface-variant mb-3">
                    Отметьте курсы своего филиала, которые ведёт {fullName(teacher)}. Именно эта связь определяет,
                    каких учеников он видит в разделе «Мои ученики».
                  </p>

                  {courseTutorError && (
                    <div className="mb-3 p-2.5 rounded-lg bg-error-container text-on-error-container text-[12px] font-label-md">
                      {courseTutorError}
                    </div>
                  )}

                  <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
                    {branchCourses.length === 0 && (
                      <p className="text-sm text-on-surface-variant">В филиале пока нет курсов.</p>
                    )}
                    {branchCourses.map((c) => {
                      const isAssigned = taughtCourseIds.has(c.id);
                      const busy = courseTutorBusyId === c.id;
                      return (
                        <div
                          key={c.id}
                          className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors ${
                            isAssigned ? "border-primary/30 bg-primary-container/10" : "border-outline-variant/40"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-label-md font-bold text-on-surface truncate">{c.title || c.subject}</p>
                            <p className="text-[11px] text-on-surface-variant truncate">
                              {c.subject} · {c.format === "group" ? "Группа" : "Индивидуально"} · {(c.tutor_ids ?? []).length} преп.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleToggleCourseTutor(c.id, isAssigned)}
                            disabled={busy}
                            className={`shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-bold uppercase tracking-wide transition-all disabled:opacity-60 ${
                              isAssigned
                                ? "bg-primary text-on-primary hover:brightness-110"
                                : "border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
                            }`}
                          >
                            {busy ? "…" : isAssigned ? "Ведёт" : "Назначить"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}

        <footer className="pt-6 text-center border-t border-outline-variant/30 text-on-surface-variant text-[13px] opacity-60">
          © 2026 Study Room Education Portal. Все права защищены.
        </footer>
      </div>

      {showFireModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowFireModal(false)}>
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Уволить преподавателя</h3>
              <button onClick={() => setShowFireModal(false)} className="p-1 hover:bg-surface-container-high rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {fireStatus === "done" ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-green-100 text-green-800 font-label-md text-label-md">
                  {fullName(teacher)} уволен(а). Доступ к личному кабинету заблокирован, все активные сессии
                  отозваны, все его занятия и привязки к курсам удалены из системы безвозвратно.
                </div>
                <button
                  onClick={() => setShowFireModal(false)}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all"
                >
                  Готово
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-label-md text-on-surface-variant">
                  Аккаунт {fullName(teacher)} будет деактивирован: вход в систему станет невозможен, все текущие
                  сессии отзываются, привязка к курсам снимается.
                </p>
                <p className="text-label-md font-bold text-error">
                  Все его занятия (в том числе будущие) будут безвозвратно удалены из базы данных и пропадут из
                  расписаний — вместе со списками участников и посещаемостью по этим занятиям. Это действие
                  необратимо: восстановление в штат вернёт доступ к аккаунту, но удалённые занятия не
                  восстановятся.
                </p>
                {fireStatus && fireStatus !== "saving" && (
                  <p className="text-sm text-error">{fireStatus}</p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowFireModal(false)}
                    className="flex-1 border border-outline-variant text-on-surface py-3 rounded-lg font-bold hover:bg-surface-container-low transition-all"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={handleFireConfirm}
                    disabled={fireStatus === "saving"}
                    className="flex-1 bg-slate-800 text-white py-3 rounded-lg font-bold hover:bg-slate-900 transition-all disabled:opacity-60"
                  >
                    {fireStatus === "saving" ? "Увольнение…" : "Уволить"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
