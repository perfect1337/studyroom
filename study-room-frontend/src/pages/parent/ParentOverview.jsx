import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchParentChildren } from "../../api/users.js";
import { fetchEnrollments, fetchCourses, fetchLessons } from "../../api/academic.js";
import { createInternalApplication } from "../../api/crm.js";
import { fetchNotificationSettings, updateNotificationSettings } from "../../api/notifications.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const SUBJECT_OPTIONS = ["Математика", "Физика", "Английский язык", "Информатика", "Русский язык", "История"];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

export default function ParentOverview() {
  const { user } = useAuth();

  const [children, setChildren] = useState([]);
  const [courses, setCourses] = useState([]);
  const [enrollmentsByChild, setEnrollmentsByChild] = useState({});
  const [upcomingLessons, setUpcomingLessons] = useState([]);
  const [notif, setNotif] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [format, setFormat] = useState("group");
  const [applyChildId, setApplyChildId] = useState("");
  const [applySubject, setApplySubject] = useState(SUBJECT_OPTIONS[0]);
  const [applyStatus, setApplyStatus] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [childrenRes, coursesRes, settingsRes] = await Promise.all([
          fetchParentChildren(user.id),
          fetchCourses(),
          fetchNotificationSettings().catch(() => null),
        ]);
        if (cancelled) return;

        const kids = childrenRes?.items ?? [];
        setChildren(kids);
        setCourses(coursesRes?.items ?? []);
        setNotif(settingsRes ?? { email_enabled: true, sms_enabled: false, messenger_enabled: true });
        if (kids[0]) setApplyChildId(String(kids[0].id));

        if (kids.length) {
          const enrollResults = await Promise.all(
            kids.map((c) => fetchEnrollments({ student_id: c.id }).catch(() => ({ items: [] })))
          );
          if (!cancelled) {
            const map = {};
            kids.forEach((c, i) => (map[c.id] = enrollResults[i]?.items ?? []));
            setEnrollmentsByChild(map);
          }

          const lessonResults = await Promise.all(
            kids.map((c) => fetchLessons({ student_id: c.id, date_from: todayISO() }).catch(() => ({ items: [] })))
          );
          if (!cancelled) {
            const all = kids.flatMap((c, i) =>
              (lessonResults[i]?.items ?? []).map((l) => ({ ...l, _childId: c.id, _childName: fullName(c) }))
            );
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

  async function toggleNotif(key) {
    const next = { ...notif, [key]: !notif[key] };
    setNotif(next);
    try {
      await updateNotificationSettings(next);
    } catch {
      setNotif(notif); // откатываем при ошибке
    }
  }

  async function handleApply(e) {
    e.preventDefault();
    if (!applyChildId) return;
    setApplyStatus("saving");
    try {
      await createInternalApplication({
        student_id: Number(applyChildId),
        subject_interest: applySubject,
        format,
      });
      setApplyStatus("done");
    } catch (e) {
      setApplyStatus(e.message || "Не удалось отправить заявку");
    }
  }

  return (
    <DashboardShell role="parent" user={toSidebarUser(user)} searchPlaceholder="Поиск..." userLabel={fullName(user)} avatarUrl={user?.avatar_url}>
      <div className="space-y-stack-lg pb-stack-lg">
        <header className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant flex flex-col md:flex-row items-center md:items-start justify-between gap-6 mt-4">
          <div className="flex items-center gap-6 z-10">
            <div className="w-24 h-24 rounded-full bg-primary-fixed flex items-center justify-center text-primary font-headline-md font-bold border-4 border-surface shadow-sm shrink-0">
              {initials(user)}
            </div>
            <div>
              <h2 className="font-headline-md text-headline-md text-on-surface">{fullName(user)}</h2>
              <p className="font-body-md text-body-md text-on-surface-variant">{user?.email}</p>
              <p className="font-body-md text-body-md text-on-surface-variant opacity-70 mt-1">ID: {user?.id}</p>
            </div>
          </div>
        </header>

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
                      <div className="w-16 h-16 rounded-lg bg-primary-fixed flex items-center justify-center text-primary font-bold shadow-sm shrink-0">
                        {initials(child)}
                      </div>
                      <div className="flex-1 w-full">
                        <div className="flex justify-between items-center w-full">
                          <h4 className="font-label-md text-label-md font-bold text-on-surface text-lg mb-1">{fullName(child)}</h4>
                          <Link to={`/parent/children/${child.id}`} className="text-primary hover:bg-surface-container-low p-2 rounded-full transition-colors">
                            <span className="material-symbols-outlined">chevron_right</span>
                          </Link>
                        </div>
                        {child.class_info && <p className="text-sm text-on-surface-variant mb-2">{child.class_info}</p>}
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
                    <div key={l.id} className="flex justify-between items-center bg-surface-container-lowest border border-outline-variant p-3 rounded-lg">
                      <div>
                        <p className="font-label-md text-on-surface font-bold">
                          {course?.title ?? course?.subject ?? l.topic} ({l._childName})
                        </p>
                        <p className="text-sm text-on-surface-variant flex items-center gap-1 mt-1">
                          <span className="material-symbols-outlined text-[16px]">schedule</span> {l.lesson_date}, {l.start_time} - {l.end_time}
                        </p>
                      </div>
                      <span className="material-symbols-outlined text-primary bg-primary-container/10 p-2 rounded-full">
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
              <p className="text-sm text-on-surface-variant mb-3">Каналы для получения уведомлений:</p>
              <div className="space-y-3">
                {notif &&
                  [
                    { key: "email_enabled", label: "Почта" },
                    { key: "sms_enabled", label: "SMS" },
                    { key: "messenger_enabled", label: "Мессенджеры" },
                  ].map((ch) => (
                    <label key={ch.key} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!notif[ch.key]}
                        onChange={() => toggleNotif(ch.key)}
                        className="w-5 h-5 rounded text-primary focus:ring-primary border-outline-variant"
                      />
                      <span className="text-sm text-on-surface font-medium">{ch.label}</span>
                    </label>
                  ))}
              </div>
            </div>
          </div>

          <div className="space-y-stack-md">
            <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">payments</span>
                Договоры и Оплата
              </h3>
              <p className="text-sm text-on-surface-variant">
                Подробная информация о договорах, суммах и статусе оплаты доступна администрации учебного центра.
                Обратитесь к вашему филиалу, чтобы получить актуальные данные по договору ребёнка.
              </p>
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
                  <label className="block font-label-md text-label-md text-on-surface mb-2">Предмет</label>
                  <select
                    value={applySubject}
                    onChange={(e) => setApplySubject(e.target.value)}
                    className="w-full rounded-lg border-outline-variant bg-surface-container-lowest text-on-surface focus:ring-primary"
                  >
                    {SUBJECT_OPTIONS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-label-md text-label-md text-on-surface mb-2">Формат обучения</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormat("group")}
                      className={`p-2 border rounded-lg text-sm font-medium ${
                        format === "group" ? "border-primary bg-primary-container/10 text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
                      }`}
                    >
                      Группа
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormat("individual")}
                      className={`p-2 border rounded-lg text-sm font-medium ${
                        format === "individual" ? "border-primary bg-primary-container/10 text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
                      }`}
                    >
                      Индивидуально
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={!applyChildId}
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
      </div>
    </DashboardShell>
  );
}
