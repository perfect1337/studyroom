import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchUserById, resetStudentCredentials, fetchMyPeople } from "../../api/users.js";
import { fetchEnrollments, fetchCourses, fetchHomework, fetchLessons, fetchTests } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";
import CourseTag from "../../components/ui/CourseTag.jsx";

const WEEKDAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

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

// Статусы записи на курс для staff-профиля ученика: здесь показываем
// историю active/completed/terminated, а для parent backend отдаёт только active.
const ENROLLMENT_STATUS_LABEL = {
  active: "Активен",
  paused: "Приостановлен",
  completed: "Завершён",
  terminated: "Расторгнут",
};
const ENROLLMENT_STATUS_COLOR = {
  active: "green",
  paused: "amber",
  completed: "secondary",
  terminated: "red",
};

const ROLE_CONFIG = {
  parent: {
    sidebarRole: "parent",
    homePath: "/parent",
    homeLabel: "Главная",
    listPath: "/parent/children",
    listLabel: "Мои дети",
    searchPlaceholder: "Поиск по кабинету...",
  },
  tutor: {
    sidebarRole: "tutor",
    homePath: "/tutor",
    homeLabel: "Главная",
    listPath: "/tutor/students",
    listLabel: "Мои ученики",
    searchPlaceholder: "Поиск ученика...",
  },
  owner: {
    sidebarRole: "admin",
    homePath: "/admin",
    homeLabel: "Главная",
    listPath: "/admin/students",
    listLabel: "Академический состав",
    searchPlaceholder: "Поиск студентов или учителей...",
  },
  branch_owner: {
    sidebarRole: "branch_owner",
    homePath: "/branch",
    homeLabel: "Главная",
    listPath: "/branch/students",
    listLabel: "Ученики филиала",
    searchPlaceholder: "Поиск учеников...",
  },
};

export default function StudentDetail({ role = "parent" }) {
  const config = ROLE_CONFIG[role] ?? ROLE_CONFIG.parent;
  const params = useParams();
  const childId = params.studentId ?? params.childId;
  const { user } = useAuth();

  const [child, setChild] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [showCourseHistory, setShowCourseHistory] = useState(false);
  const [courses, setCourses] = useState([]);
  const [homework, setHomework] = useState([]);
  const [tests, setTests] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [tutors, setTutors] = useState([]); // для отображения имени преподавателя в мини-календаре
  // extraTutors — тьюторы, которых не было в fetchMyPeople(), но которые
  // ведут занятия ребёнка (tutor_id из lessons). Нужно для роли parent:
  // GET /users (1.9) для parent отдаёт только children, tutors там всегда
  // пустой массив (см. user-service UserHandler.List, case RoleParent) — в
  // отличие от owner/branch_owner/tutor, где tutors в этом ответе есть.
  // Без этого фолбэка в календаре ребёнка вместо ФИО репетитора показывался
  // "Преподаватель #<id>". Подгружаются точечно через GET /users/{id}
  // (1.10) — родителю доступ к карточке репетитора своего ребёнка разрешён
  // отдельным правилом на бэкенде (см. canViewUser), тот же приём уже
  // используется в ParentSchedule.jsx.
  const [extraTutors, setExtraTutors] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState(null);

  // Состояние для календаря
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const canResetCredentials = role === "parent" || role === "owner";
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetStatus, setResetStatus] = useState("");
  const [resetResult, setResetResult] = useState(null);

  async function handleResetCredentials() {
    setResetStatus("saving");
    try {
      const res = await resetStudentCredentials(childId);
      setResetResult(res);
      setResetStatus("done");
    } catch (e) {
      setResetStatus(e.message || "Не удалось сбросить данные для входа");
    }
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const todayDay = today.getDate();
  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();

  // Переключение месяцев
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

  useEffect(() => {
    if (!childId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const date_from = toISODate(viewYear, viewMonth, 1);
        const date_to = toISODate(viewYear, viewMonth, daysInMonth);
        const [childRes, enrollRes, coursesRes, homeworkRes, lessonsRes, peopleRes, testsRes] = await Promise.all([
          fetchUserById(childId),
          fetchEnrollments({ student_id: childId }),
          fetchCourses(),
          fetchHomework({ student_id: childId }),
          fetchLessons({ student_id: childId, date_from, date_to }),
          fetchMyPeople().catch(() => ({ tutors: [] })),
          fetchTests({ student_id: childId }).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setChild(childRes);
        const childIdNum = Number(childId);
        const childEnrollments = (enrollRes?.items ?? [])
          .filter((e) => e.student_id === childIdNum)
          .filter((e) => role !== "parent" || e.status === "active");
        setEnrollments(childEnrollments);
        setCourses(coursesRes?.items ?? []);

        // ВАЖНО: query-параметр student_id, который мы передаём в
        // fetchHomework/fetchLessons/fetchTests выше, бэкенд честно
        // учитывает только для owner/branch_owner. Для parent он игнорируется
        // целиком (см. academic-service *_handler.go, case models.RoleParent:
        // filter.StudentIDs = <все дети родителя>), а для tutor фильтрует по
        // created_by/tutor_id, а не по ученику (case models.RoleTutor) —
        // в обоих случаях в ответе прилетают записи ПО ВСЕМ ученикам
        // родителя/тьютора, а не только по этому childId. Раньше это
        // складывали в state как есть, из-за чего при открытии карточки
        // одного ребёнка/ученика показывались занятия, домашки и тесты
        // другого (и наоборот — заходишь к ребёнку без занятий, а видишь
        // расписание первого). Поэтому здесь дополнительно фильтруем на
        // фронте по конкретному childId — безопасно и для ролей, где
        // бэкенд и так фильтрует правильно (owner/branch_owner): фильтр
        // просто ничего не отбросит лишнего.
        setHomework((homeworkRes?.items ?? []).filter((h) => h.student_id === childIdNum));
        setTests((testsRes?.items ?? []).filter((t) => t.student_id === childIdNum));

        // Курсы, на которые записан именно этот ребёнок/ученик — фолбэк для
        // занятий без participant_ids (не должно происходить в норме, см.
        // LessonHandler.Create, но подстрахуемся, как и в ParentSchedule.jsx).
        const ownCourseIds = new Set(childEnrollments.map((e) => e.course_id));
        const lessonItems = (lessonsRes?.items ?? []).filter((l) => {
          if (Array.isArray(l.participant_ids) && l.participant_ids.length > 0) {
            return l.participant_ids.includes(childIdNum);
          }
          return ownCourseIds.has(l.course_id);
        });
        setLessons(lessonItems);
        const myPeopleTutors = peopleRes?.tutors ?? [];
        setTutors(myPeopleTutors);

        // Подтягиваем ФИО для tutor_id, которых не было в fetchMyPeople()
        // (см. комментарий у extraTutors выше) — актуально прежде всего для
        // parent, но фолбэк безопасен и для остальных ролей.
        const knownTutorIds = new Set(myPeopleTutors.map((t) => t.id));
        const missingTutorIds = [...new Set(lessonItems.map((l) => l.tutor_id).filter(Boolean))].filter(
          (id) => !knownTutorIds.has(id)
        );
        if (missingTutorIds.length) {
          const fetched = await Promise.all(missingTutorIds.map((id) => fetchUserById(id).catch(() => null)));
          if (!cancelled) {
            setExtraTutors((prev) => {
              const next = { ...prev };
              fetched.forEach((t, i) => {
                if (t) next[missingTutorIds[i]] = t;
              });
              return next;
            });
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось загрузить данные ребёнка");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId, viewYear, viewMonth]);

  const coursesById = useMemo(() => {
    const map = {};
    courses.forEach((c) => (map[c.id] = c));
    return map;
  }, [courses]);

  const currentEnrollments = useMemo(
    () => enrollments.filter((e) => e.status === "active" || e.status === "paused"),
    [enrollments]
  );

  const archivedEnrollments = useMemo(
    () => enrollments.filter((e) => e.status === "completed" || e.status === "terminated"),
    [enrollments]
  );

  const tutorsById = useMemo(() => {
    const map = {};
    tutors.forEach((t) => (map[t.id] = t));
    // extraTutors — фолбэк для parent (см. объявление extraTutors выше);
    // не должны перетирать более полные записи из fetchMyPeople(), если id
    // почему-то пересечётся.
    Object.entries(extraTutors).forEach(([id, t]) => {
      if (!map[id]) map[id] = t;
    });
    return map;
  }, [tutors, extraTutors]);

  const lessonsByDay = useMemo(() => {
    const map = {};
    for (const l of lessons) {
      const day = Number(l.lesson_date?.slice(8, 10));
      if (!day) continue;
      (map[day] ??= []).push(l);
    }
    return map;
  }, [lessons]);

  const avgProgress = enrollments.length
    ? Math.round(enrollments.reduce((s, e) => s + (e.progress_pct ?? 0), 0) / enrollments.length)
    : 0;
  const homeworkDone = homework.filter((h) => h.status === "viewed").length;

  // Средний балл — среднее арифметическое по всем оценённым тестам ученика.
  // Если тестов с оценкой ещё нет, показываем статический avg_grade из
  // профиля (student_profiles), если он был задан вручную.
  const gradedTests = tests.filter((t) => t.grade != null);
  const avgGrade = gradedTests.length
    ? gradedTests.reduce((s, t) => s + t.grade, 0) / gradedTests.length
    : child?.avg_grade ?? null;

  // Занятия для выбранного дня
  const selectedDayLessons = selectedDay ? (lessonsByDay[selectedDay] ?? []) : [];

  // Ближайшие занятия (для отображения по умолчанию)
  const upcomingDaily = lessons
    .filter((l) => l.lesson_date >= toISODate(viewYear, viewMonth, 1))
    .sort((a, b) => (a.lesson_date + a.start_time).localeCompare(b.lesson_date + b.start_time))
    .slice(0, 5);

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
            <span className="text-on-surface font-bold truncate">{child ? fullName(child) : "—"}</span>
          </div>
          {canResetCredentials && child && (
            <button
              onClick={() => {
                setResetStatus("");
                setResetResult(null);
                setShowResetModal(true);
              }}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low hover:text-primary transition-colors text-label-md font-label-md w-full sm:w-auto"
            >
              <span className="material-symbols-outlined text-[18px]">lock_reset</span>
              Сбросить данные для входа
            </button>
          )}
        </nav>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        <div className="bg-surface-container-lowest p-stack-lg rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30">
          <div className="flex flex-col md:flex-row items-center gap-gutter">
            <div className="relative">
              <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-primary/10 bg-primary-fixed flex items-center justify-center text-primary font-headline-md font-bold text-3xl">
                {child?.avatar_url ? (
                  <img src={child.avatar_url} alt={fullName(child)} className="w-full h-full object-cover" />
                ) : (
                  initials(child)
                )}
              </div>
            </div>
            <div className="flex-1 text-center md:text-left">
              <div className="flex flex-col md:flex-row md:items-end gap-2 mb-1">
                <h2 className="font-headline-md text-headline-md text-on-surface">{child ? fullName(child) : "—"}</h2>
              </div>
              <p className="text-on-surface-variant font-body-md mb-4">
                {[
                  child?.school ? `Школа: ${child.school}` : null,
                  child?.class_info ? `Класс: ${child.class_info}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </p>
              <div className="flex flex-wrap justify-center md:justify-start gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg">
                  <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                  <span className="font-label-md text-on-surface">
                    Средний прогресс: <strong className="text-primary">{avgProgress}%</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg">
                  <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>assignment_turned_in</span>
                  <span className="font-label-md text-on-surface">
                    Заданий выполнено: <strong className="text-primary">{homeworkDone}/{homework.length}</strong>
                  </span>
                </div>
                {avgGrade != null && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg">
                    <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>grade</span>
                    <span className="font-label-md text-on-surface">
                      Средний балл: <strong className="text-primary">{avgGrade.toFixed(1)}</strong>
                      {gradedTests.length > 0 && <span className="text-on-surface-variant"> ({gradedTests.length} {gradedTests.length === 1 ? "тест" : "тестов"})</span>}
                    </span>
                  </div>
                )}
                {child?.attendance_pct != null && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg">
                    <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>event_available</span>
                    <span className="font-label-md text-on-surface">
                      Посещаемость: <strong className="text-primary">{Math.round(child.attendance_pct)}%</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-gutter">
          <section className="col-span-12 lg:col-span-8 space-y-stack-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-on-surface">Курсы ученика</h3>
                <p className="text-[13px] text-on-surface-variant mt-1">
                  {currentEnrollments.length > 0
                    ? `${currentEnrollments.length} ${currentEnrollments.length === 1 ? "текущий курс" : "текущих курса"}`
                    : "Сейчас нет активных курсов"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md">
              {currentEnrollments.length === 0 && (
                <div className="md:col-span-2 rounded-xl border border-dashed border-outline-variant bg-surface-container-low p-6 text-center">
                  <span className="material-symbols-outlined text-[28px] text-on-surface-variant mb-2">school</span>
                  <p className="text-on-surface font-label-md">Нет текущих курсов</p>
                  <p className="text-[13px] text-on-surface-variant mt-1">Завершённые и расторгнутые договоры находятся в истории ниже.</p>
                </div>
              )}
              {currentEnrollments.map((e) => {
                const course = coursesById[e.course_id];
                return (
                  <div
                    key={e.id}
                    className="bg-surface-container-lowest p-stack-md rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 flex flex-col justify-between group hover:border-primary/50 transition-colors"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-4">
                        <div className="p-2 bg-primary/10 text-primary rounded-lg">
                          <span className="material-symbols-outlined">calculate</span>
                        </div>
                        <StatusBadge
                          status={ENROLLMENT_STATUS_LABEL[e.status] ?? e.status}
                          color={ENROLLMENT_STATUS_COLOR[e.status] ?? "secondary"}
                        />
                      </div>
                      <h4 className="font-headline-sm text-[20px] mb-1">{course?.title ?? course?.subject ?? `Курс #${e.course_id}`}</h4>
                      <div className="w-full bg-surface-container-high h-2 rounded-full mb-2">
                        <div className="bg-primary h-2 rounded-full" style={{ width: `${e.progress_pct ?? 0}%` }} />
                      </div>
                      <div className="flex justify-between text-[12px] text-on-surface-variant font-bold mb-4">
                        <span>ПРОГРЕСС</span>
                        <span>{e.progress_pct ?? 0}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {archivedEnrollments.length > 0 && (
              <div className="mt-2 rounded-xl border border-outline-variant/50 bg-surface-container-low overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowCourseHistory((value) => !value)}
                  className="w-full flex items-center justify-between gap-4 px-4 py-3.5 text-left hover:bg-surface-container transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[19px] text-on-surface-variant">history</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-label-md text-on-surface">История курсов</p>
                      <p className="text-[12px] text-on-surface-variant mt-0.5">
                        {archivedEnrollments.length} {archivedEnrollments.length === 1 ? "завершённый или расторгнутый курс" : "завершённых и расторгнутых курса"}
                      </p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-on-surface-variant">
                    {showCourseHistory ? "expand_less" : "expand_more"}
                  </span>
                </button>

                {showCourseHistory && (
                  <div className="border-t border-outline-variant/50 divide-y divide-outline-variant/40">
                    {archivedEnrollments.map((e) => {
                      const course = coursesById[e.course_id];
                      return (
                        <div key={e.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                          <div className="min-w-0">
                            <p className="font-label-md text-on-surface truncate">
                              {course?.title ?? course?.subject ?? `Курс #${e.course_id}`}
                            </p>
                            <p className="text-[12px] text-on-surface-variant mt-0.5">
                              Прогресс: {e.progress_pct ?? 0}%
                            </p>
                          </div>
                          <StatusBadge
                            status={ENROLLMENT_STATUS_LABEL[e.status] ?? e.status}
                            color={ENROLLMENT_STATUS_COLOR[e.status] ?? "secondary"}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="pt-stack-lg">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-stack-md">Домашние задания</h3>
              <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 overflow-hidden">
                <div className="hidden md:block">
                <table className="w-full text-left">
                  <thead className="bg-surface-container text-on-surface-variant text-label-md font-bold uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-4">Задание</th>
                      <th className="px-6 py-4">Статус</th>
                      <th className="px-6 py-4 text-right">Выдано</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {homework.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-6 py-8 text-center text-on-surface-variant">Заданий пока нет</td>
                      </tr>
                    )}
                    {homework.map((hw) => {
                      const isViewed = hw.status === "viewed";
                      return (
                        <tr key={hw.id} className="hover:bg-surface-container-low transition-colors">
                          <td className="px-6 py-5">
                            <p className="font-label-md text-on-surface max-w-xs truncate">{hw.link_url}</p>
                          </td>
                          <td className="px-6 py-5">
                            <span className={`flex items-center gap-1.5 font-bold text-[13px] ${isViewed ? "text-green-600" : "text-orange-600"}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${isViewed ? "bg-green-600" : "bg-orange-600"}`} />
                              {isViewed ? "Сделано" : "Не сделано"}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-right font-bold text-on-surface-variant text-label-md">
                            {hw.created_at ? new Date(hw.created_at).toLocaleDateString("ru-RU") : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>

                <div className="md:hidden divide-y divide-outline-variant/30">
                  {homework.length === 0 && (
                    <div className="px-4 py-8 text-center text-on-surface-variant">Заданий пока нет</div>
                  )}
                  {homework.map((hw) => {
                    const isViewed = hw.status === "viewed";
                    return (
                      <div key={hw.id} className="p-4 flex flex-col gap-1.5">
                        <p className="font-label-md text-on-surface truncate">{hw.link_url}</p>
                        <div className="flex items-center justify-between">
                          <span className={`flex items-center gap-1.5 font-bold text-[13px] ${isViewed ? "text-green-600" : "text-orange-600"}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isViewed ? "bg-green-600" : "bg-orange-600"}`} />
                            {isViewed ? "Сделано" : "Не сделано"}
                          </span>
                          <span className="text-[12px] text-on-surface-variant font-bold">
                            {hw.created_at ? new Date(hw.created_at).toLocaleDateString("ru-RU") : "—"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pt-stack-lg">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-stack-md">Тесты и оценки</h3>
              <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 overflow-hidden">
                <div className="hidden md:block">
                <table className="w-full text-left">
                  <thead className="bg-surface-container text-on-surface-variant text-label-md font-bold uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-4">Тест</th>
                      <th className="px-6 py-4">Курс / предмет</th>
                      <th className="px-6 py-4">Статус</th>
                      <th className="px-6 py-4">Оценка</th>
                      <th className="px-6 py-4 text-right">Выдан</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {tests.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-on-surface-variant">Тестов пока нет</td>
                      </tr>
                    )}
                    {tests
                      .slice()
                      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
                      .map((t) => {
                        const isSubmitted = t.status === "submitted";
                        return (
                          <tr key={t.id} className="hover:bg-surface-container-low transition-colors">
                            <td className="px-6 py-5 max-w-xs">
                              <p className="font-label-md text-on-surface truncate">{t.title}</p>
                              <a href={t.link_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline break-all">
                                {t.link_url}
                              </a>
                            </td>
                            <td className="px-6 py-5">
                              <CourseTag title={t.course_title} subject={t.course_subject} />
                            </td>
                            <td className="px-6 py-5">
                              <span className={`flex items-center gap-1.5 font-bold text-[13px] ${isSubmitted ? "text-green-600" : "text-orange-600"}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${isSubmitted ? "bg-green-600" : "bg-orange-600"}`} />
                                {isSubmitted ? "Сдан" : "Не сдан"}
                              </span>
                            </td>
                            <td className="px-6 py-5 font-bold text-on-surface">
                              {t.grade != null ? t.grade : <span className="text-on-surface-variant font-normal">—</span>}
                            </td>
                            <td className="px-6 py-5 text-right font-bold text-on-surface-variant text-label-md">
                              {t.created_at ? new Date(t.created_at).toLocaleDateString("ru-RU") : "—"}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                </div>

                <div className="md:hidden divide-y divide-outline-variant/30">
                  {tests.length === 0 && (
                    <div className="px-4 py-8 text-center text-on-surface-variant">Тестов пока нет</div>
                  )}
                  {tests
                    .slice()
                    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
                    .map((t) => {
                      const isSubmitted = t.status === "submitted";
                      return (
                        <div key={t.id} className="p-4 flex flex-col gap-2">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-label-md text-on-surface truncate min-w-0">{t.title}</p>
                            <span className="shrink-0 font-bold text-on-surface">
                              {t.grade != null ? t.grade : <span className="text-on-surface-variant font-normal">—</span>}
                            </span>
                          </div>
                          <CourseTag title={t.course_title} subject={t.course_subject} />
                          <div className="flex items-center justify-between">
                            <span className={`flex items-center gap-1.5 font-bold text-[13px] ${isSubmitted ? "text-green-600" : "text-orange-600"}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${isSubmitted ? "bg-green-600" : "bg-orange-600"}`} />
                              {isSubmitted ? "Сдан" : "Не сдан"}
                            </span>
                            <span className="text-[12px] text-on-surface-variant font-bold">
                              {t.created_at ? new Date(t.created_at).toLocaleDateString("ru-RU") : "—"}
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
                {/* Показываем занятия для выбранного дня или ближайшие */}
                {(selectedDay ? selectedDayLessons : upcomingDaily).length === 0 && (
                  <p className="text-sm text-on-surface-variant">
                    {selectedDay ? "Занятий в этот день нет." : "Занятий в этом месяце не запланировано."}
                  </p>
                )}
                {(selectedDay ? selectedDayLessons : upcomingDaily).map((l) => {
                  const course = coursesById[l.course_id];
                  const tutor = tutorsById[l.tutor_id];
                  const lessonDay = Number(l.lesson_date.slice(8, 10));
                  return (
                    <div key={l.id} className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold bg-primary/10 text-primary shrink-0">
                        {lessonDay}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-label-md font-bold leading-tight">
                          {l.start_time?.slice(0, 5)} - {l.end_time?.slice(0, 5)}
                        </p>
                        <p className="text-[13px] text-on-surface truncate">
                          {course?.title ?? course?.subject ?? l.topic}
                        </p>
                        <p className="text-[12px] text-on-surface-variant truncate">
                          {l.location_type === "remote" ? "Дистанционно" : "Очно"}
                          {l.topic && <span> · {l.topic}</span>}
                        </p>
                        <p className="text-[12px] text-primary font-bold truncate">
                          {tutor ? fullName(tutor) : l.tutor_id ? `Преподаватель #${l.tutor_id}` : "Преподаватель не назначен"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>

        <footer className="pt-6 text-center border-t border-outline-variant/30 text-on-surface-variant text-[13px] opacity-60">
          © 2026 Study Room Education Portal. Все права защищены.
        </footer>
      </div>

      {showResetModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowResetModal(false)}>
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Сбросить данные для входа</h3>
              <button onClick={() => setShowResetModal(false)} className="p-1 hover:bg-surface-container-high rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {resetStatus === "done" && resetResult ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-green-100 text-green-800 font-label-md text-label-md">
                  Пароль обновлён. Новые данные для входа также отправлены на почту родителя.
                </div>
                <div className="text-label-md text-on-surface-variant space-y-1">
                  <div>Логин: <span className="font-bold text-on-surface">{resetResult.login}</span></div>
                  <div>Временный пароль: <span className="font-bold text-on-surface">{resetResult.temp_password}</span></div>
                </div>
                <button
                  onClick={() => setShowResetModal(false)}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all"
                >
                  Готово
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-label-md text-on-surface-variant">
                  Текущий пароль {fullName(child)} перестанет действовать, будет выпущен новый временный пароль.
                  Логин при этом не меняется. Продолжить?
                </p>
                {resetStatus && resetStatus !== "saving" && (
                  <p className="text-sm text-error">{resetStatus}</p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowResetModal(false)}
                    className="flex-1 border border-outline-variant text-on-surface py-3 rounded-lg font-bold hover:bg-surface-container-low transition-all"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={handleResetCredentials}
                    disabled={resetStatus === "saving"}
                    className="flex-1 bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
                  >
                    {resetStatus === "saving" ? "Сброс…" : "Сбросить пароль"}
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