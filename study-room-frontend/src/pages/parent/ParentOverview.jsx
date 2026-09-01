import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import Avatar from "../../components/ui/Avatar.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchParentChildren } from "../../api/users.js";
import { fetchEnrollments, fetchCourses, fetchLessons, fetchTests } from "../../api/academic.js";
import { fetchMyContracts } from "../../api/contracts.js";
import { createInternalApplication } from "../../api/crm.js";
import { fetchNotificationSettings, updateNotificationSettings, fetchTelegramStatus } from "../../api/notifications.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";
import { sanitizePhoneInput, isValidPhone } from "../../utils/phone.js";
import { useTelegramStatus } from "../../hooks/useTelegramStatus.js";
import { useMaxStatus } from "../../hooks/useMaxStatus.js";
import MaxConnectBanner from "../../components/notifications/MaxConnectBanner.jsx";
import { useMaxConnectPrompt } from "../../hooks/useMaxConnectPrompt.js";
import { TELEGRAM_BOT_URL } from "../../api/config.js";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatMoney(n) {
  return `₽ ${Number(n ?? 0).toLocaleString("ru-RU")}`;
}
function formatDate(dateStr) {
  if (!dateStr) return "—";
  const datePart = String(dateStr).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}
function daysUntil(endDateStr) {
  if (!endDateStr) return null;
  const endDate = new Date(endDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);
  return Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function ParentOverview() {
  const { user } = useAuth();

  const { status: tgStatus, refresh: refreshTg } = useTelegramStatus();
  const { status: maxStatus, refresh: refreshMax } = useMaxStatus();
  const showMaxConnectPrompt = useMaxConnectPrompt();
  const [children, setChildren] = useState([]);
  const [courses, setCourses] = useState([]);
  const [enrollmentsByChild, setEnrollmentsByChild] = useState({});
  const [tests, setTests] = useState([]);
  const [upcomingLessons, setUpcomingLessons] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [notif, setNotif] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [format, setFormat] = useState("group");
  const [applyChildId, setApplyChildId] = useState("");
  const [applyCourseId, setApplyCourseId] = useState("");
  const [applyStatus, setApplyStatus] = useState("");
  // Контакты родителя для заявки — по умолчанию берём из профиля (ФИО, телефон),
  // но даём поправить перед отправкой (например, если удобнее указать другой номер).
  const [applyParentName, setApplyParentName] = useState("");
  const [applyPhone, setApplyPhone] = useState("");

  useEffect(() => {
    if (!user) return;
    setApplyParentName((prev) => prev || fullName(user));
    setApplyPhone((prev) => prev || user.phone || "");
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [childrenRes, coursesRes, settingsRes, contractsRes, testsRes] = await Promise.all([
          fetchParentChildren(user.id).catch(() => ({ items: [] })),
          fetchCourses().catch(() => ({ items: [] })),
          fetchNotificationSettings().catch(() => null),
          fetchMyContracts().catch(() => ({ items: [] })),
          // Бэкенд сам сужает список тестов до детей текущего родителя.
          fetchTests().catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;

        const kids = childrenRes?.items ?? [];
        setChildren(kids);
        setCourses(coursesRes?.items ?? []);
        // Нормализуем ответ бэкенда — он может вернуть старые поля (sms_enabled) или новые
        const normalized = settingsRes ? {
          email_enabled: settingsRes.email_enabled ?? false,
          max_enabled: settingsRes.max_enabled ?? false,
          telegram_enabled: settingsRes.telegram_enabled ?? false,
          whatsapp_enabled: settingsRes.whatsapp_enabled ?? false,
          preferred_messenger: settingsRes.preferred_messenger ?? "email",
        } : {
          email_enabled: true,
          max_enabled: false,
          telegram_enabled: false,
          whatsapp_enabled: false,
          preferred_messenger: "email",
        };
        setNotif(normalized);
        setContracts(contractsRes?.items ?? []);
        setTests(testsRes?.items ?? []);
        if (kids[0]) setApplyChildId(String(kids[0].id));

        if (kids.length) {
          // ВАЖНО: бэкенд для роли parent игнорирует query-параметр
          // student_id в GET /enrollments и GET /lessons и всегда отдаёт
          // записи по ВСЕМ детям родителя разом (см. academic-service
          // EnrollmentHandler.List/LessonHandler.List, case
          // models.RoleParent: filter.StudentIDs = children). Раньше здесь
          // делали отдельный запрос на каждого ребёнка и клали ответ "как
          // есть" под его id — по факту под КАЖДЫМ ребёнком оказывался один
          // и тот же полный список (записи/занятия всех детей), из-за чего
          // прогресс и ближайшие занятия одного ребёнка "утекали" в карточку
          // другого (и наоборот — у ребёнка без занятий показывались занятия
          // первого). Теперь грузим один раз и фильтруем на фронте по
          // конкретному ребёнку: по student_id для enrollments, по
          // participant_ids (с фолбэком на курсы, на которые записан
          // ребёнок) для lessons — тот же приём, что и в ParentSchedule.jsx.
          const enrollRes = await fetchEnrollments().catch(() => ({ items: [] }));
          const allEnrollments = enrollRes?.items ?? [];
          const courseIdsByChild = {};
          if (!cancelled) {
            const map = {};
            kids.forEach((c) => {
              const own = allEnrollments.filter((e) => e.student_id === c.id);
              map[c.id] = own;
              courseIdsByChild[c.id] = new Set(own.map((e) => e.course_id));
            });
            setEnrollmentsByChild(map);
          }

          const lessonsRes = await fetchLessons({ date_from: todayISO() }).catch(() => ({ items: [] }));
          const allLessons = lessonsRes?.items ?? [];
          if (!cancelled) {
            const all = [];
            kids.forEach((c) => {
              const own = allLessons.filter((l) => {
                if (Array.isArray(l.participant_ids) && l.participant_ids.length > 0) {
                  return l.participant_ids.includes(c.id);
                }
                return courseIdsByChild[c.id]?.has(l.course_id) ?? false;
              });
              own.forEach((l) => all.push({ ...l, _childId: c.id, _childName: fullName(c) }));
            });
            all.sort((a, b) => (a.lesson_date + a.start_time).localeCompare(b.lesson_date + b.start_time));
            setUpcomingLessons(all.slice(0, 5));
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось загрузить данные");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const coursesById = useMemo(() => {
    const map = {};
    courses.forEach((c) => (map[c.id] = c));
    return map;
  }, [courses]);

  // Реальные курсы из уже загруженных данных (а не выдуманный статический
  // список) — родитель может подать заявку только на то, что действительно
  // преподаётся в учебном центре. Записываемся конкретно на курс, а не
  // обобщённо на предмет — так менеджер сразу видит, какая именно программа
  // интересует родителя.
  const availableCourses = useMemo(() => {
    return courses
      .filter((c) => (c.title || c.subject || "").trim())
      .slice()
      .sort((a, b) => (a.title || a.subject || "").localeCompare(b.title || b.subject || "", "ru"));
  }, [courses]);

  // Как только курсы подгрузились — выставляем первый курс по умолчанию
  // (пока список не готов, applyCourseId остаётся пустым).
  useEffect(() => {
    if (availableCourses.length && !applyCourseId) {
      setApplyCourseId(String(availableCourses[0].id));
    }
  }, [availableCourses, applyCourseId]);

  const childrenById = useMemo(() => {
    const map = {};
    children.forEach((c) => (map[c.id] = c));
    return map;
  }, [children]);

  // Средний балл ребёнка — среднее арифметическое по всем оценённым тестам;
  // если оценённых тестов ещё нет, используем статический avg_grade профиля.
  const avgGradeByChild = useMemo(() => {
    const map = {};
    tests.forEach((t) => {
      if (t.grade == null) return;
      (map[t.student_id] ??= []).push(t.grade);
    });
    const out = {};
    Object.entries(map).forEach(([childId, grades]) => {
      out[childId] = grades.reduce((s, g) => s + g, 0) / grades.length;
    });
    return out;
  }, [tests]);

  function avgGradeFor(child) {
    return avgGradeByChild[child.id] ?? child.avg_grade ?? null;
  }

  // Договоры, отсортированные так, чтобы скоро истекающие активные договоры
  // были в начале списка — на них родителю нужно обратить внимание в первую очередь.
  const priorityContracts = useMemo(() => {
    return contracts
      .map((c) => ({ ...c, _daysLeft: daysUntil(c.end_date) }))
      .sort((a, b) => {
        const rank = (c) => (c.status === "active" && c._daysLeft != null && c._daysLeft >= 0 ? c._daysLeft : Infinity);
        const diff = rank(a) - rank(b);
        if (diff !== 0) return diff;
        return (a.end_date || "").localeCompare(b.end_date || "");
      })
      .slice(0, 3);
  }, [contracts]);

  const contractsDue = useMemo(
    () => contracts.reduce((sum, c) => sum + (c.payment_status !== "paid" ? Number(c.amount) || 0 : 0), 0),
    [contracts]
  );

  async function toggleNotif(key) {
    if (!notif) return;
    const next = { ...notif, [key]: !notif[key] };
    // При включении/выключении канала — обновляем preferred_messenger
    if (next.telegram_enabled) next.preferred_messenger = "telegram";
    else if (next.whatsapp_enabled) next.preferred_messenger = "whatsapp";
    else if (next.max_enabled) next.preferred_messenger = "max";
    else if (next.email_enabled) next.preferred_messenger = "email";

    setNotif(next);
    try {
      await updateNotificationSettings(next);
      if (key === "telegram_enabled" && next.telegram_enabled) { try { await refreshTg(); } catch {} }
      if (key === "max_enabled" && next.max_enabled) { try { await refreshMax(); } catch {} }
    } catch {
      setNotif(notif); // откатываем при ошибке
    }
  }

  async function handleApply(e) {
    e.preventDefault();
    if (!applyChildId || !applyCourseId) return;
    if (!isValidPhone(applyPhone)) {
      setApplyStatus("Введите телефон в формате из 10-15 цифр (можно с +)");
      return;
    }
    const selectedCourse = coursesById[Number(applyCourseId)];
    // Бэкенд заявок хранит текстовое поле subject_interest (нет отдельного
    // course_id), поэтому передаём туда название конкретного курса — так
    // менеджер видит именно программу, на которую хочет записаться родитель.
    const courseLabel = selectedCourse?.title || selectedCourse?.subject || "";
    setApplyStatus("saving");
    try {
      await createInternalApplication({
        student_id: Number(applyChildId),
        subject_interest: courseLabel,
        format,
        parent_name: applyParentName.trim() || fullName(user),
        phone: applyPhone.trim() || undefined,
      });
      setApplyStatus("done");
    } catch (e) {
      setApplyStatus(e.message || "Не удалось отправить заявку");
    }
  }

  return (
    <DashboardShell role="parent" user={toSidebarUser(user)} searchPlaceholder="Поиск..." userLabel={fullName(user)} avatarUrl={user?.avatar_url}>
      <div className="space-y-stack-lg pb-stack-lg">
        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}
        <div className="relative mt-4">
          {/* Лента-закладка — тот же приём, что и в шапке /student, для
              единого визуального языка "карточки профиля" по всему кабинету. */}
          <div
            className="ribbon-tab absolute -top-2 left-8 z-10 w-9 h-12 bg-gradient-to-b from-tertiary to-tertiary-container shadow-sm flex items-start justify-center pt-2"
            aria-hidden="true"
          >
            <span className="material-symbols-outlined text-on-tertiary text-[18px]">family_restroom</span>
          </div>

          <header className="relative bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant overflow-hidden flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="bg-notebook-grid absolute inset-0 text-tertiary opacity-[0.035] pointer-events-none" aria-hidden="true" />

            <div className="relative flex items-center gap-4 sm:gap-6 z-10 min-w-0 w-full md:w-auto p-4 sm:p-6 pt-10">
              <Avatar
                src={user?.avatar_url}
                name={fullName(user)}
                size="lg"
                className="ring-4 ring-tertiary-fixed shadow-sm"
              />
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-tertiary/70 mb-1">
                  Личный кабинет · Родитель
                </p>
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display-academic text-2xl sm:text-[34px] leading-tight sm:leading-[1.1] font-semibold text-on-surface break-words">
                      {fullName(user)}
                    </h2>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-on-surface-variant">
                  {user?.email && (
                    <span className="inline-flex items-center gap-1.5 font-body-md text-body-md text-sm min-w-0 max-w-full break-all">
                      <span className="material-symbols-outlined text-[16px] shrink-0">mail</span>
                      {user.email}
                    </span>
                  )}
                  {user?.phone && (
                    <span className="inline-flex items-center gap-1.5 font-body-md text-body-md text-sm min-w-0 max-w-full break-all">
                      <span className="material-symbols-outlined text-[16px] shrink-0">call</span>
                      {user.phone}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {!loading && (
              <div className="relative flex gap-4 shrink-0 p-6 pt-2 md:pt-10 z-10">
                {/* Статистика как круглые "печати" — тот же диплом-мотив, что и
                    лента выше, вместо обычных прямоугольных плашек. */}
                <div className="flex flex-col items-center justify-center w-20 h-20 rounded-full border-2 border-dashed border-primary/40 bg-surface-container-lowest shrink-0">
                  <p className="font-headline-sm text-headline-sm text-primary leading-none">{children.length}</p>
                  <p className="text-[9px] uppercase tracking-wide text-on-surface-variant mt-1 text-center leading-tight px-1">
                    {children.length === 1 ? "ребёнок" : "детей"}
                  </p>
                </div>
                {contractsDue > 0 && (
                  <div className="flex flex-col items-center justify-center w-20 h-20 rounded-full border-2 border-dashed border-warning/50 bg-surface-container-lowest shrink-0">
                    <p className="font-headline-sm text-[15px] text-warning leading-none text-center px-1">{formatMoney(contractsDue)}</p>
                    <p className="text-[9px] uppercase tracking-wide text-on-surface-variant mt-1">к оплате</p>
                  </div>
                )}
              </div>
            )}
          </header>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
          <div className="space-y-stack-md lg:col-span-2">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Мои дети и курсы</h3>

            <Link
              to="/parent/children"
              className="bg-surface-container-low border border-dashed border-primary rounded-xl p-6 flex flex-col items-center text-center cursor-pointer hover:bg-surface-container transition-colors group"
            >
              <div className="w-12 h-12 rounded-full bg-primary-container text-primary flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined">add</span>
              </div>
              <h4 className="font-label-md text-label-md text-primary font-bold mb-2">Добавить ребёнка</h4>
              <p className="font-body-md text-body-md text-on-surface-variant text-sm max-w-md">
                При добавлении для ученика будет автоматически создан личный кабинет. Данные для входа будут отправлены на почту родителя.
              </p>
            </Link>

            {loading && <p className="text-on-surface-variant font-body-md">Загрузка…</p>}
            {!loading && children.length === 0 && (
              <p className="text-on-surface-variant font-body-md">У вас пока нет добавленных детей.</p>
            )}

            <div className="space-y-4">
              {children.map((child) => {
                const childEnrollments = enrollmentsByChild[child.id] ?? [];
                const avgProgress = childEnrollments.length
                  ? Math.round(childEnrollments.reduce((s, e) => s + (e.progress_pct ?? 0), 0) / childEnrollments.length)
                  : 0;
                return (
                  <div key={child.id} className="bg-surface-container-lowest rounded-xl p-5 shadow-sm border border-outline-variant flex flex-col gap-5">
                    <div className="flex flex-col md:flex-row gap-5 items-start">
                      <Avatar src={child.avatar_url} name={fullName(child)} size="lg" className="shadow-sm ring-2 ring-tertiary-fixed/60" />
                      <div className="flex-1 w-full min-w-0">
                        <div className="flex justify-between items-center w-full gap-2">
                          <h4 className="min-w-0 flex-1 truncate font-display-academic text-xl font-semibold text-on-surface mb-1">{fullName(child)}</h4>
                          <Link to={`/parent/children/${child.id}`} className="shrink-0 text-primary hover:bg-surface-container-low p-2 rounded-full transition-colors">
                            <span className="material-symbols-outlined">chevron_right</span>
                          </Link>
                        </div>
                        {(child.class_info || child.school) && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {child.class_info && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-container text-xs font-label-md">
                                <span className="material-symbols-outlined text-[14px] text-primary">groups</span>
                                <span className="text-on-surface-variant">Класс:</span>
                                <span className="text-on-surface font-bold">{child.class_info}</span>
                              </span>
                            )}
                            {child.school && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-container text-xs font-label-md">
                                <span className="material-symbols-outlined text-[14px] text-primary">location_city</span>
                                <span className="text-on-surface-variant">Школа:</span>
                                <span className="text-on-surface font-bold">{child.school}</span>
                              </span>
                            )}
                          </div>
                        )}
                        {(avgGradeFor(child) != null || child.attendance_pct != null) && (
                          <div className="flex flex-wrap gap-3 mb-2 text-[12px] text-on-surface-variant">
                            {avgGradeFor(child) != null && <span>Средний балл: <strong className="text-on-surface">{avgGradeFor(child).toFixed(1)}</strong></span>}
                            {child.attendance_pct != null && <span>Посещаемость: <strong className="text-on-surface">{Math.round(child.attendance_pct)}%</strong></span>}
                          </div>
                        )}
                        <div className="space-y-2 mt-3">
                          {childEnrollments.length === 0 && (
                            <p className="text-sm text-on-surface-variant">Пока не записан ни на один курс</p>
                          )}
                          {childEnrollments.map((e) => {
                            const course = coursesById[e.course_id];
                            return (
                              <div key={e.id} className="flex items-center gap-3 bg-surface-container-lowest p-2 rounded border border-outline-variant">
                                <div className="w-8 h-8 rounded bg-surface-tint/10 flex items-center justify-center text-primary">
                                  <span className="material-symbols-outlined text-sm">calculate</span>
                                </div>
                                <span className="font-body-md text-body-md text-sm text-on-surface-variant">
                                  {course?.title ?? course?.subject ?? `Курс #${e.course_id}`}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    {childEnrollments.length > 0 && (
                      <div className="border-t border-outline-variant pt-4 mt-2">
                        <h5 className="font-label-md font-bold text-on-surface mb-3">Статистика</h5>
                        <div className="flex gap-6 mb-4">
                          <div>
                            <span className="text-on-surface-variant text-sm">Средний прогресс:</span>
                            <span className="font-bold text-primary ml-1">{avgProgress}%</span>
                          </div>
                          <div>
                            <span className="text-on-surface-variant text-sm">Активных курсов:</span>
                            <span className="font-bold text-primary ml-1">
                              {childEnrollments.filter((e) => e.status === "active").length}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant mt-8">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">event_upcoming</span>
                Предстоящие занятия
              </h3>
              <div className="space-y-3">
                {!loading && upcomingLessons.length === 0 && (
                  <p className="text-sm text-on-surface-variant">Занятий не запланировано.</p>
                )}
                {upcomingLessons.map((l) => {
                  const course = coursesById[l.course_id];
                  return (
                    <div key={`${l._childId}-${l.id}`} className="flex justify-between items-center gap-3 bg-surface-container-lowest border border-outline-variant p-3 rounded-lg">
                      <div className="min-w-0">
                        <p className="font-label-md text-on-surface font-bold truncate">
                          {course?.title ?? course?.subject ?? l.topic} ({l._childName})
                        </p>
                        <p className="text-sm text-on-surface-variant flex items-center gap-1 mt-1">
                          <span className="material-symbols-outlined text-[16px]">schedule</span> {l.lesson_date}, {l.start_time} - {l.end_time}
                        </p>
                      </div>
                      <span className="shrink-0 material-symbols-outlined text-primary bg-primary-container/10 p-2 rounded-full">
                        {l.location_type === "remote" ? "video_camera_front" : "location_on"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm border border-outline-variant mt-8">
              <h4 className="font-label-md text-label-md font-bold text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-outline">notifications</span>Настройка уведомлений
              </h4>
              <div className="space-y-3">
                {notif ? (
                  [
                    { key: "email_enabled", label: "Почта" },
                    { key: "telegram_enabled", label: "Telegram" },
                    { key: "max_enabled", label: "MAX" },
                  ].map((ch) => (
                    <label key={ch.key} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!notif[ch.key]}
                        onChange={() => toggleNotif(ch.key)}
                        className="w-5 h-5 rounded text-primary focus:ring-primary border-outline-variant"
                      />
                      <span className="text-sm text-on-surface font-medium">{ch.label}</span>
                      {ch.key === "telegram_enabled" && notif.telegram_enabled && tgStatus && (
                        <span className={`ml-auto flex items-center gap-1 text-[11px] font-bold uppercase ${
                          tgStatus.connected ? "text-primary" : "text-warning"
                        }`}>
                          <span className={`w-2 h-2 rounded-full ${tgStatus.connected ? "bg-primary" : "bg-warning"}`}></span>
                          {tgStatus.connected ? "Подключено" : "Не подключено"}
                        </span>
                      )}
                      {ch.key === "max_enabled" && notif.max_enabled && maxStatus && (
                        <span className={`ml-auto flex items-center gap-1 text-[11px] font-bold uppercase ${maxStatus.connected ? "text-primary" : "text-warning"}`}>
                          <span className={`w-2 h-2 rounded-full ${maxStatus.connected ? "bg-primary" : "bg-warning"}`}></span>
                          {maxStatus.connected ? "Подключено" : "Не подключено"}
                        </span>
                      )}
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-on-surface-variant">Загрузка...</p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-stack-md">
            <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">payments</span>
                  Договоры и Оплата
                </h3>
                {contractsDue > 0 && (
                  <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded-full bg-orange-100 text-orange-800">
                    К оплате
                  </span>
                )}
              </div>

              {contractsDue > 0 && (
                <p className="text-sm text-on-surface-variant mb-3">
                  Сумма к оплате по всем детям: <span className="font-bold text-warning">{formatMoney(contractsDue)}</span>
                </p>
              )}

              {loading && <p className="text-sm text-on-surface-variant">Загрузка…</p>}

              {!loading && contracts.length === 0 && (
                <p className="text-sm text-on-surface-variant">
                  Договоров пока нет. Обратитесь к вашему филиалу, чтобы оформить договор на обучение.
                </p>
              )}

              {!loading && contracts.length > 0 && (
                <div className="space-y-2 mb-4">
                  {priorityContracts.map((c) => {
                    const child = childrenById[c.student_id];
                    const course = coursesById[c.course_id];
                    const expiringSoon = c.status === "active" && c._daysLeft != null && c._daysLeft >= 0 && c._daysLeft <= 14;
                    return (
                      <div
                        key={c.id}
                        className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${
                          expiringSoon ? "border-warning/40 bg-warning/5" : "border-outline-variant"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-on-surface truncate">
                            {c.contract_number || `№${c.id}`} · {child ? fullName(child) : `Ученик #${c.student_id}`}
                          </p>
                          <p className="text-[12px] text-on-surface-variant truncate">
                            {course?.title ?? course?.subject ?? `Курс #${c.course_id}`}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-[12px] font-bold ${expiringSoon ? "text-warning" : "text-on-surface-variant"}`}>
                            до {formatDate(c.end_date)}
                          </p>
                          {expiringSoon && (
                            <p className="text-[10px] font-bold uppercase text-warning">
                              {c._daysLeft === 0 ? "Истекает сегодня" : `Осталось ${c._daysLeft} дн.`}
                            </p>
                          )}
                          {c.payment_status === "unpaid" && (
                            <p className="text-[10px] font-bold uppercase text-orange-700">Не оплачено</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <Link
                to="/parent/contracts"
                className="w-full flex items-center justify-center gap-2 bg-primary text-on-primary py-2.5 rounded-lg font-label-md text-label-md hover:bg-primary-container transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">description</span>
                Все договоры
              </Link>
            </div>

            <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">add_task</span>
                Записаться на новый курс
              </h3>
              <form className="space-y-4" onSubmit={handleApply}>
                <div>
                  <label className="block font-label-md text-label-md text-on-surface mb-2">Выберите ребёнка</label>
                  <select
                    value={applyChildId}
                    onChange={(e) => setApplyChildId(e.target.value)}
                    className="w-full rounded-lg border-outline-variant bg-surface-container-lowest text-on-surface focus:ring-primary"
                  >
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>{fullName(c)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-label-md text-label-md text-on-surface mb-2">Курс</label>
                  <select
                    required
                    disabled={!availableCourses.length}
                    value={applyCourseId}
                    onChange={(e) => setApplyCourseId(e.target.value)}
                    className="w-full rounded-lg border-outline-variant bg-surface-container-lowest text-on-surface focus:ring-primary disabled:opacity-60"
                  >
                    {!availableCourses.length && (
                      <option value="">Нет доступных курсов</option>
                    )}
                    {availableCourses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title || c.subject}
                        {c.subject && c.title && c.subject !== c.title ? ` (${c.subject})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-label-md text-label-md text-on-surface mb-2">Контакты родителя</label>
                  <p className="text-xs text-on-surface-variant mb-2">
                    Отправятся вместе с заявкой, чтобы менеджер мог с вами связаться.
                  </p>
                  <input
                    type="text"
                    value={applyParentName}
                    onChange={(e) => setApplyParentName(e.target.value)}
                    placeholder="ФИО родителя"
                    className="w-full rounded-lg border-outline-variant bg-surface-container-lowest text-on-surface focus:ring-primary mb-2"
                  />
                  <input
                    type="tel"
                    value={applyPhone}
                    onChange={(e) => setApplyPhone(sanitizePhoneInput(e.target.value))}
                    placeholder="Телефон для связи"
                    inputMode="tel"
                    pattern="^\+?\d{10,15}$"
                    title="10-15 цифр, можно с ведущим +"
                    maxLength={16}
                    className="w-full rounded-lg border-outline-variant bg-surface-container-lowest text-on-surface focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block font-label-md text-label-md text-on-surface mb-2">Формат обучения</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormat("group")}
                      className={`p-2 border rounded-lg text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${
                        format === "group" ? "border-primary bg-primary-container/10 text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
                      }`}
                    >
                      Группа
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormat("individual")}
                      className={`p-2 border rounded-lg text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${
                        format === "individual" ? "border-primary bg-primary-container/10 text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
                      }`}
                    >
                      Индивидуально
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={!applyChildId || !applyCourseId}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-label-md text-label-md hover:bg-primary-container transition-all mt-2 disabled:opacity-60"
                >
                  Отправить заявку
                </button>
                {applyStatus === "done" && <p className="text-sm text-primary">Заявка отправлена!</p>}
                {applyStatus && applyStatus !== "saving" && applyStatus !== "done" && (
                  <p className="text-sm text-error">{applyStatus}</p>
                )}
              </form>
            </div>
          </div>
        </div>



        {/* Баннер про подключение Telegram — снизу, как и остальные
            уведомления/подсказки о настройках (см. блок "Уведомления" на
            /settings), а не первым делом при входе на страницу. */}
        {notif?.telegram_enabled && tgStatus && !tgStatus.connected && (
          <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 flex items-start gap-3 shadow-sm">
            <div className="flex-1 min-w-0">
              <p className="font-label-md text-on-surface font-bold mb-1">Подключите Telegram для уведомлений</p>
              <p className="text-sm text-on-surface-variant mb-3">
                Перейдите в бота <strong>Study Room</strong>, нажмите <code className="bg-surface-container px-1.5 py-0.5 rounded text-xs font-mono">/start</code> и введите ваш email.
              </p>
              <a
                href={TELEGRAM_BOT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-primary text-on-primary px-4 py-2 rounded-lg font-label-md font-bold hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                Открыть бота
              </a>
            </div>
          </div>
        )}
        <MaxConnectBanner show={showMaxConnectPrompt} />
      </div>
    </DashboardShell>
  );
}
