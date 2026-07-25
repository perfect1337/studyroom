import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchUserById } from "../../api/users.js";
import { fetchEnrollments, fetchCourses, fetchHomework, fetchLessons } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

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

// Единая страница "карточка ученика" для всех ролей, у кого есть доступ к его данным:
// - parent (role="parent"): свой ребёнок, /parent/children/:childId
// - tutor (role="tutor"): ученик своего филиала, /tutor/students/:studentId
// - owner (role="owner"): любой ученик сети, /admin/students/:studentId
// - branch_owner (role="branch_owner"): ученик своего филиала, /branch/students/:studentId
// Авторизация (может ли конкретная роль смотреть конкретного ученика) уже проверяется
// на бэкенде в GET /users/{id} (см. canViewUser в user_handler.go) — фронт просто
// показывает то, что вернул сервер, и красиво выводит 403/404 через error-блок.
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
  // Разные роуты используют разное имя параметра (:childId у родителя,
  // :studentId у остальных) — подхватываем любое из них.
  const params = useParams();
  const childId = params.studentId ?? params.childId;
  const { user } = useAuth();

  const [child, setChild] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [courses, setCourses] = useState([]);
  const [homework, setHomework] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const today = new Date();
  const viewYear = today.getFullYear();
  const viewMonth = today.getMonth();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;

  useEffect(() => {
    if (!childId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const date_from = toISODate(viewYear, viewMonth, 1);
        const date_to = toISODate(viewYear, viewMonth, daysInMonth);
        const [childRes, enrollRes, coursesRes, homeworkRes, lessonsRes] = await Promise.all([
          fetchUserById(childId),
          fetchEnrollments({ student_id: childId }),
          fetchCourses(),
          fetchHomework({ student_id: childId }),
          fetchLessons({ student_id: childId, date_from, date_to }),
        ]);
        if (cancelled) return;
        setChild(childRes);
        setEnrollments(enrollRes?.items ?? []);
        setCourses(coursesRes?.items ?? []);
        setHomework(homeworkRes?.items ?? []);
        setLessons(lessonsRes?.items ?? []);
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
  }, [childId]);

  const coursesById = useMemo(() => {
    const map = {};
    courses.forEach((c) => (map[c.id] = c));
    return map;
  }, [courses]);

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

  const todayDay = today.getDate();
  const upcomingDaily = lessons
    .filter((l) => l.lesson_date >= toISODate(viewYear, viewMonth, todayDay))
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
        <nav className="flex items-center gap-2 text-label-md text-on-surface-variant mt-4">
          <Link to={config.homePath} className="hover:text-primary">{config.homeLabel}</Link>
          <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          <Link to={config.listPath} className="hover:text-primary">{config.listLabel}</Link>
          <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          <span className="text-on-surface font-bold">{child ? fullName(child) : "—"}</span>
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
                <span className="text-on-surface-variant font-label-md mb-1.5 opacity-60">ID: {child?.id}</span>
              </div>
              <p className="text-on-surface-variant font-body-md mb-4">{child?.class_info ?? "—"}</p>
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
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-gutter">
          <section className="col-span-12 lg:col-span-8 space-y-stack-md">
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Курсы ученика</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md">
              {enrollments.length === 0 && (
                <p className="text-on-surface-variant font-body-md">Ученик пока не записан ни на один курс.</p>
              )}
              {enrollments.map((e) => {
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
                        <span className="bg-green-100 text-green-700 text-[12px] font-bold px-2 py-0.5 rounded-full uppercase">
                          {e.status === "active" ? "Активен" : e.status}
                        </span>
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

            <div className="pt-stack-lg">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-stack-md">Домашние задания</h3>
              <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 overflow-hidden">
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
                              {isViewed ? "Открыто" : "Не открыто"}
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
            </div>
          </section>

          <aside className="col-span-12 lg:col-span-4 space-y-stack-lg">
            <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 p-4">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-bold text-on-surface">{MONTH_NAMES[viewMonth]} {viewYear}</h4>
              </div>
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
                  const isToday = day === todayDay;
                  return (
                    <div
                      key={day}
                      className={`text-label-md py-1 rounded-lg relative flex justify-center items-center ${
                        isToday ? "font-bold bg-primary text-white" : "text-on-surface hover:bg-primary/10"
                      }`}
                    >
                      {day}
                      {hasLessons && !isToday && <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 pt-4 border-t border-outline-variant space-y-3">
                {upcomingDaily.length === 0 && (
                  <p className="text-sm text-on-surface-variant">Занятий в этом месяце не запланировано.</p>
                )}
                {upcomingDaily.map((l) => {
                  const course = coursesById[l.course_id];
                  return (
                    <div key={l.id} className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold bg-primary/10 text-primary">
                        {Number(l.lesson_date.slice(8, 10))}
                      </div>
                      <div className="flex-1">
                        <p className="text-label-md font-bold leading-tight">
                          {l.start_time} - {course?.subject ?? course?.title ?? l.topic}
                        </p>
                        <p className="text-[12px] text-on-surface-variant">
                          {l.location_type === "remote" ? "Дистанционно" : "Очно"}
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
    </DashboardShell>
  );
}
