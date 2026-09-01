import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchLessons, fetchEnrollments, fetchCourses, fetchAttendance, assignHomework } from "../../api/academic.js";
import { fetchMyPeople } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";
import TelegramConnectBanner from "../../components/notifications/TelegramConnectBanner.jsx";
import { useTelegramConnectPrompt } from "../../hooks/useTelegramConnectPrompt.js";

function pad(n) {
  return String(n).padStart(2, "0");
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nowHHMM() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

export default function TutorOverview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const showTelegramPrompt = useTelegramConnectPrompt();

  const [todayLessons, setTodayLessons] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [courses, setCourses] = useState([]);
  const [studentsById, setStudentsById] = useState({});
  const [attendanceByLesson, setAttendanceByLesson] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [hwStudentId, setHwStudentId] = useState("");
  const [hwLink, setHwLink] = useState("");
  const [hwStatus, setHwStatus] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const today = todayISO();
        const [lessonsRes, enrollRes, coursesRes, peopleRes] = await Promise.all([
          fetchLessons({ tutor_id: user.id, date_from: today, date_to: today }),
          fetchEnrollments({ tutor_id: user.id }),
          fetchCourses({ tutor_id: user.id }),
          fetchMyPeople(),
        ]);
        if (cancelled) return;

        const lessonItems = (lessonsRes?.items ?? []).slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
        setTodayLessons(lessonItems);
        setEnrollments(enrollRes?.items ?? []);
        setCourses(coursesRes?.items ?? []);

        const byId = {};
        (peopleRes?.students ?? []).forEach((s) => (byId[s.id] = s));
        setStudentsById(byId);

        // Для прошедших сегодняшних занятий подтягиваем посещаемость, чтобы показать отсутствующих.
        const now = nowHHMM();
        const pastLessons = lessonItems.filter((l) => l.end_time && l.end_time <= now);
        if (pastLessons.length) {
          const results = await Promise.all(pastLessons.map((l) => fetchAttendance(l.id).catch(() => null)));
          if (!cancelled) {
            const map = {};
            pastLessons.forEach((l, i) => {
              if (results[i]) map[l.id] = results[i]?.items ?? [];
            });
            setAttendanceByLesson(map);
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

  const activeEnrollments = useMemo(
    () => enrollments.filter((e) => e.status === "active"),
    [enrollments]
  );

  const now = nowHHMM();

  async function handleAssignHomework(e) {
    e.preventDefault();
    if (!hwStudentId || !hwLink) return;
    setHwStatus("saving");
    try {
      await assignHomework({ student_id: Number(hwStudentId), link_url: hwLink });
      setHwStatus("done");
      setHwLink("");
    } catch (e) {
      setHwStatus(e.message || "Ошибка");
    }
  }

  return (
    <DashboardShell role="tutor" user={toSidebarUser(user)} searchPlaceholder="Поиск..." userLabel={fullName(user)} avatarUrl={user?.avatar_url}>
      <div className="mb-stack-lg mt-4">
        <h1 className="font-headline-md text-headline-md text-on-background mb-2">Панель управления репетитора</h1>
        <p className="font-body-lg text-body-lg text-on-surface-variant">Добро пожаловать, {user?.first_name}. Вот сводка вашей активности.</p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-stack-lg pb-stack-lg">
        <section className="lg:col-span-2 bg-surface-container-lowest rounded-xl p-6 shadow-[0px_10px_30px_rgba(0,0,0,0.05)]">
          <div className="flex flex-wrap justify-between items-center gap-2 mb-6">
            <h2 className="font-headline-sm text-headline-sm text-on-background flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">calendar_month</span>
              Расписание на сегодня
            </h2>
            <Link to="/tutor/schedule" className="text-primary font-label-md text-label-md hover:underline">
              Весь календарь
            </Link>
          </div>

          <div className="flex flex-col gap-4">
            {loading && <p className="text-on-surface-variant font-body-md">Загрузка…</p>}
            {!loading && todayLessons.length === 0 && (
              <p className="text-on-surface-variant font-body-md">На сегодня занятий не запланировано.</p>
            )}
            {todayLessons.map((lesson, idx) => {
              const isPast = lesson.end_time <= now;
              const isLast = idx === todayLessons.length - 1;
              const course = coursesById[lesson.course_id];
              const records = attendanceByLesson[lesson.id] ?? [];
              const absentRecords = records.filter((r) => r.status === "absent");

              return (
                <div
                  key={lesson.id}
                  className={`flex flex-col sm:flex-row rounded-lg border border-outline-variant p-4 gap-4 items-start sm:items-center relative overflow-hidden ${
                    isPast ? "bg-surface-container-low opacity-80" : "bg-surface hover:shadow-md transition-shadow"
                  }`}
                >
                  {isLast && (
                    <div className="absolute top-0 right-0 bg-tertiary-container text-on-tertiary-container px-3 py-1 rounded-bl-lg font-label-md text-[10px] font-bold uppercase tracking-wider">
                      Последнее занятие
                    </div>
                  )}
                  <div className="flex flex-col min-w-[120px]">
                    <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">{lesson.start_time}</span>
                    <span className="font-label-md text-label-md text-on-surface-variant">{lesson.end_time}</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="bg-primary-container text-on-primary-container px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">
                        {course?.title ?? course?.subject ?? "—"}
                      </span>
                      <span className="bg-surface-variant text-on-surface-variant px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">
                        {lesson.group_type === "group" ? "Групповое" : "Индивидуально"} / {lesson.location_type === "remote" ? "Дистанционно" : "Очно"}
                      </span>
                      {isPast && (
                        <span className="bg-surface-variant text-on-surface-variant px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">Прошедшее</span>
                      )}
                    </div>
                    <h3 className="font-body-lg text-body-lg text-on-surface font-medium">{lesson.topic}</h3>
                    {isPast && absentRecords.length > 0 && (
                      <div className="mt-2 flex flex-col gap-2">
                        {absentRecords.map((r) => (
                          <div key={r.student_id}>
                            <div className="flex items-center gap-2 text-error font-medium text-label-md">
                              <span className="material-symbols-outlined text-body-md">person_off</span>
                              Отсутствовал: {studentsById[r.student_id] ? fullName(studentsById[r.student_id]) : `Ученик #${r.student_id}`}
                            </div>
                            {r.absence_reason && (
                              <div className="text-label-md text-on-surface-variant italic">Причина отсутствия: {r.absence_reason}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    {isPast ? (
                      <Link to="/tutor/schedule" className="text-primary font-label-md text-label-md hover:underline">Отчёт</Link>
                    ) : (
                      <Link to="/tutor/schedule" className="border border-primary text-primary px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-surface-container transition-colors">
                        Детали
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex flex-col gap-stack-lg">
          <section className="bg-surface-container-lowest rounded-xl p-6 shadow-[0px_10px_30px_rgba(0,0,0,0.05)]">
            <h2 className="font-headline-sm text-headline-sm text-on-background flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-primary">person_search</span>
              Все ученики
            </h2>
            <div className="flex flex-col gap-3">
              {!loading && activeEnrollments.length === 0 && (
                <p className="text-on-surface-variant font-body-md text-sm">Пока нет активных учеников.</p>
              )}
              {activeEnrollments.slice(0, 6).map((e) => {
                const student = studentsById[e.student_id];
                const course = coursesById[e.course_id];
                return (
                  <div
                    key={e.id}
                    onClick={() => navigate(`/tutor/students/${e.student_id}`)}
                    className="flex items-center gap-3 p-2 hover:bg-surface-container rounded-lg cursor-pointer transition-colors"
                  >
                    <div className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center text-on-surface-variant font-bold">
                      {initials(student)}
                    </div>
                    <div className="flex-1">
                      <div className="font-body-md text-body-md font-medium text-on-surface">
                        {student ? fullName(student) : `Ученик #${e.student_id}`}
                      </div>
                      <div className="font-label-md text-label-md text-on-surface-variant">{course?.title ?? course?.subject ?? "—"}</div>
                    </div>
                    <div className="w-12 bg-surface-container-high rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${(e.progress_pct ?? 0) >= 60 ? "bg-primary" : "bg-secondary-container"}`}
                        style={{ width: `${e.progress_pct ?? 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <Link to="/tutor/students" className="mt-4 w-full block text-center text-primary font-label-md text-label-md hover:underline">
              Смотреть весь список
            </Link>
          </section>

          
        </div>
      </div>

      <TelegramConnectBanner show={showTelegramPrompt} />
    </DashboardShell>
  );
}
