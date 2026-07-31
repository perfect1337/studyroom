import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchEnrollments } from "../../api/academic.js";
import { fetchCourses, fetchLessons, fetchHomework } from "../../api/academic.js";
import { fetchUserById } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const SUBJECT_ICONS = {
  Математика: "functions",
  Физика: "science",
  "Английский язык": "language",
  Английский: "language",
  Биология: "biology",
  Химия: "experiment",
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "2026-12-25T00:00:00Z" + "13:00:00" -> "25.12.2026 13:00"
function formatLessonDateTime(lessonDate, startTime) {
  if (!lessonDate) return "";
  const d = new Date(lessonDate);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const datePart = `${dd}.${mm}.${yyyy}`;
  const timePart = startTime ? startTime.slice(0, 5) : "";
  return timePart ? `${datePart} ${timePart}` : datePart;
}

export default function StudentOverview() {
  const { user } = useAuth();

  const [enrollments, setEnrollments] = useState([]);
  const [courses, setCourses] = useState([]);
  const [upcomingLessons, setUpcomingLessons] = useState([]);
  const [homework, setHomework] = useState([]);
  const [tutorsById, setTutorsById] = useState({});
  const [courseTutorId, setCourseTutorId] = useState({}); // course_id -> tutor_id, из реально созданных занятий
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // true, пока для этого пользователя ещё ни разу не пришли данные. Спиннер
  // ("Загрузка…") имеет смысл показывать только один раз, на самом первом
  // заходе — все последующие обновления (тихий автообновление раз в минуту,
  // повторный вызов после смены курса и т.п.) не должны прятать уже
  // отрисованные виджеты, иначе это выглядит как перезагрузка страницы.
  const isFirstLoadRef = useRef(true);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function load() {
      if (isFirstLoadRef.current) setLoading(true);
      setError("");
      try {
        const [enrollRes, coursesRes, lessonsRes, homeworkRes, allLessonsRes] = await Promise.all([
          fetchEnrollments({ student_id: user.id }),
          fetchCourses(),
          fetchLessons({ student_id: user.id, date_from: todayISO() }),
          fetchHomework({ student_id: user.id }),
          // enrollments.tutor_id часто пустой — реальный препод по курсу виден
          // по тому, кто создал занятие (lessons.tutor_id), без ограничения по дате.
          fetchLessons({ student_id: user.id }).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;

        const enrollItems = enrollRes?.items ?? [];
        setEnrollments(enrollItems);
        setCourses(coursesRes?.items ?? []);
        setUpcomingLessons((lessonsRes?.items ?? []).slice().sort((a, b) => a.lesson_date.localeCompare(b.lesson_date)));
        setHomework(homeworkRes?.items ?? []);

        const allLessonItems = (allLessonsRes?.items ?? [])
          .slice()
          .sort((a, b) => (a.lesson_date + a.start_time).localeCompare(b.lesson_date + b.start_time));
        const cTutorMap = {};
        allLessonItems.forEach((l) => {
          if (l.tutor_id) cTutorMap[l.course_id] = l.tutor_id;
        });
        setCourseTutorId(cTutorMap);

        const tutorIds = [
          ...new Set(
            enrollItems
              .map((e) => e.tutor_id || cTutorMap[e.course_id])
              .filter(Boolean)
          ),
        ];
        if (tutorIds.length) {
          const fetched = await Promise.all(tutorIds.map((id) => fetchUserById(id).catch(() => null)));
          if (!cancelled) {
            const map = {};
            fetched.forEach((t, i) => t && (map[tutorIds[i]] = t));
            setTutorsById(map);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось загрузить данные");
      } finally {
        if (!cancelled) {
          isFirstLoadRef.current = false;
          setLoading(false);
        }
      }
    }

    load();
    // Тихое автообновление виджетов раз в минуту: новые записи/расписание/ДЗ
    // подтянутся сами, без действий пользователя и без перезагрузки страницы —
    // load() выше уже не включает спиннер после первого захода.
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.id]);

  const coursesById = useMemo(() => {
    const map = {};
    courses.forEach((c) => (map[c.id] = c));
    return map;
  }, [courses]);

  const nextLessonByCourse = useMemo(() => {
    const map = {};
    for (const l of upcomingLessons) {
      if (!map[l.course_id]) map[l.course_id] = l;
    }
    return map;
  }, [upcomingLessons]);

  return (
    <DashboardShell
      role="student"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="space-y-section-padding pb-section-padding">
        {error && (
          <div className="mt-4 p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
            {error}
          </div>
        )}

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-gutter mt-4">
          <div className="col-span-1 lg:col-span-2 bg-surface-container-lowest rounded-xl p-stack-lg shadow-sm border border-outline-variant flex items-center gap-stack-lg">
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-4 border-surface shadow-sm shrink-0 bg-primary-fixed flex items-center justify-center text-primary font-headline-md font-bold">
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt={fullName(user)} className="w-full h-full object-cover" />
              ) : (
                <span>
                  {user?.first_name?.[0]}
                  {user?.last_name?.[0]}
                </span>
              )}
            </div>
            <div>
              <h2 className="font-headline-md text-headline-md text-on-background mb-1">
                Привет, {user?.first_name}! 👋
              </h2>
              <p className="font-body-lg text-body-lg text-on-surface-variant">
                {loading ? "Загрузка…" : `Активных курсов: ${enrollments.filter((e) => e.status === "active").length}`}
              </p>
            </div>
          </div>

          <div className="col-span-1 grid grid-cols-1 gap-stack-md">
            {!loading && enrollments.length === 0 && (
              <div className="bg-surface-container-lowest rounded-xl p-stack-md shadow-sm border border-outline-variant text-on-surface-variant font-body-md">
                Вы пока не записаны ни на один курс
              </div>
            )}
            {enrollments.slice(0, 3).map((e) => {
              const course = coursesById[e.course_id];
              return (
                <div
                  key={e.id}
                  className="bg-surface-container-lowest rounded-xl p-stack-md shadow-sm border border-outline-variant flex items-center justify-between"
                >
                  <div>
                    <p className="font-label-md text-label-md font-bold text-on-surface-variant mb-3">
                      {course?.subject ?? course?.title ?? `Курс #${e.course_id}`}
                    </p>
                    <div className="flex gap-6">
                      <div>
                        <p className="text-xs text-on-surface-variant mb-1 uppercase tracking-wide">Прогресс</p>
                        <h3 className="font-headline-sm text-headline-sm text-primary">{e.progress_pct ?? 0}%</h3>
                      </div>
                      <div>
                        <p className="text-xs text-on-surface-variant mb-1 uppercase tracking-wide">Статус</p>
                        <h3 className="font-headline-sm text-headline-sm text-secondary-container">
                          {e.status === "active" ? "Активен" : e.status}
                        </h3>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-gutter">
          <div className="xl:col-span-2 space-y-stack-md">
            <div className="flex items-center justify-between">
              <h3 className="font-headline-sm text-headline-sm text-on-background">Текущие курсы</h3>
              <Link
                to="/student/courses"
                className="text-primary hover:text-primary-container font-label-md text-label-md flex items-center gap-1 transition-colors"
              >
                Все курсы <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md">
              {enrollments.map((e) => {
                const course = coursesById[e.course_id];
                const tutor = tutorsById[e.tutor_id || courseTutorId[e.course_id]];
                const nextLesson = nextLessonByCourse[e.course_id];
                return (
                  <div
                    key={e.id}
                    className="bg-surface-container-lowest rounded-xl p-stack-md shadow-sm border border-outline-variant hover:shadow-md transition-shadow duration-300 flex flex-col group relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 w-2 h-full bg-primary group-hover:w-3 transition-all duration-300" />
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-surface-container text-primary">
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                          {SUBJECT_ICONS[course?.subject] ?? "menu_book"}
                        </span>
                      </div>
                      <span className="bg-surface-container-highest px-2 py-1 rounded text-xs font-label-md text-on-surface-variant">
                        {course?.format === "individual" ? "Индивидуально" : "Группа"}
                      </span>
                    </div>
                    <h4 className="font-body-lg text-body-lg font-bold text-on-background mb-1">
                      {course?.title ?? `Курс #${e.course_id}`}
                    </h4>
                    {course?.description && (
                      <p className="font-body-md text-body-md text-on-surface-variant mb-4 line-clamp-2">
                        {course.description}
                      </p>
                    )}
                    <div className="mt-auto space-y-3">
                      <div className="flex items-center gap-2 text-sm text-on-surface-variant">
                        <span className="material-symbols-outlined text-[16px]">person</span>
                        <span className="font-body-md text-body-md text-sm">
                          Преп: {tutor ? `${tutor.last_name} ${tutor.first_name}` : "не назначен"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-primary">
                        <span className="material-symbols-outlined text-[16px]">event</span>
                        <span className="font-body-md text-body-md text-sm font-medium">
                          {nextLesson
                            ? `След. урок: ${formatLessonDateTime(nextLesson.lesson_date, nextLesson.start_time)}`
                            : "Занятий не запланировано"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="xl:col-span-1 space-y-stack-md">
            <div className="flex items-center justify-between">
              <h3 className="font-headline-sm text-headline-sm text-on-background">Домашние задания</h3>
              <Link
                to="/student/homework"
                className="text-primary hover:text-primary-container font-label-md text-label-md flex items-center gap-1 transition-colors"
              >
                Все <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </Link>
            </div>
            <div className="bg-surface-container-lowest rounded-xl p-stack-md shadow-sm border border-outline-variant h-full max-h-[420px] overflow-y-auto">
              {homework.length === 0 ? (
                <p className="text-on-surface-variant font-body-md p-3">Заданий пока нет</p>
              ) : (
                <ul className="space-y-4">
                  {homework.map((hw) => {
                    const isViewed = hw.status === "viewed";
                    return (
                      <li key={hw.id} className="flex gap-4 items-start p-3 hover:bg-surface-container-low rounded-lg transition-colors">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 mt-1 ${
                            isViewed ? "bg-surface-container-highest text-primary" : "bg-secondary-fixed text-on-secondary-container"
                          }`}
                        >
                          <span className="material-symbols-outlined text-sm">
                            {isViewed ? "check_circle" : "edit_document"}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h5 className="font-label-md text-label-md font-bold text-on-background mb-0.5 truncate">
                            {hw.link_url}
                          </h5>
                          <span className="text-xs font-medium flex items-center gap-1 text-on-surface-variant">
                            {isViewed ? "Сделано" : "Не сделано"}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
