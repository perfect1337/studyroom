import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchLessons, fetchCourses, fetchHomework } from "../../api/academic.js";
import { fetchUserById } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
// Циклическая палитра для разных курсов на календаре (курсов может быть больше, чем цветов).
const COURSE_COLORS = ["#004ac6", "#22c55e", "#ab0b1c", "#a855f7", "#0891b2", "#ea580c"];

function pad(n) {
  return String(n).padStart(2, "0");
}
function toISODate(year, monthIndex, day) {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}
function nowHHMM() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// Занятие считается прошедшим, если его дата раньше сегодняшней, либо это
// сегодняшнее занятие, которое уже закончилось по времени (end_time <= now).
// Такие занятия должны отображаться в календаре как обычно, но не висеть
// вечно в статусе "Ожидание".
function isLessonPast(lesson, today) {
  const todayISO = toISODate(today.getFullYear(), today.getMonth(), today.getDate());
  if (!lesson.lesson_date) return false;
  if (lesson.lesson_date < todayISO) return true;
  if (lesson.lesson_date > todayISO) return false;
  return (lesson.end_time ?? "23:59") <= nowHHMM();
}

export default function StudentSchedule() {
  const { user } = useAuth();

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-based

  const [lessons, setLessons] = useState([]);
  const [courses, setCourses] = useState([]);
  const [tutorsById, setTutorsById] = useState({});
  const [homework, setHomework] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState(null); // day number in current month, or null

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // 0 = Monday

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const date_from = toISODate(viewYear, viewMonth, 1);
        const date_to = toISODate(viewYear, viewMonth, daysInMonth);

        const [lessonsRes, coursesRes, homeworkRes] = await Promise.all([
          fetchLessons({ student_id: user.id, date_from, date_to }),
          fetchCourses(),
          fetchHomework({ student_id: user.id }),
        ]);
        if (cancelled) return;

        const lessonItems = lessonsRes?.items ?? [];
        setLessons(lessonItems);
        setCourses(coursesRes?.items ?? []);
        setHomework(homeworkRes?.items ?? []);

        // Подтягиваем имена репетиторов по уникальным tutor_id (контракт 1.10 — GET /users/{id}).
        const uniqueTutorIds = [...new Set(lessonItems.map((l) => l.tutor_id).filter(Boolean))];
        const missing = uniqueTutorIds.filter((id) => !tutorsById[id]);
        if (missing.length) {
          const fetched = await Promise.all(
            missing.map((id) => fetchUserById(id).catch(() => null))
          );
          if (!cancelled) {
            setTutorsById((prev) => {
              const next = { ...prev };
              fetched.forEach((t, i) => {
                if (t) next[missing[i]] = t;
              });
              return next;
            });
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось загрузить расписание");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, viewYear, viewMonth]);

  const coursesById = useMemo(() => {
    const map = {};
    courses.forEach((c) => (map[c.id] = c));
    return map;
  }, [courses]);

  const courseColor = useMemo(() => {
    const map = {};
    courses.forEach((c, i) => (map[c.id] = COURSE_COLORS[i % COURSE_COLORS.length]));
    return map;
  }, [courses]);

  const lessonsByDay = useMemo(() => {
    const map = {};
    for (const lesson of lessons) {
      const day = Number(lesson.lesson_date?.slice(8, 10));
      if (!day) continue;
      (map[day] ??= []).push(lesson);
    }
    return map;
  }, [lessons]);

  const isCurrentMonthView = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  const todayDay = isCurrentMonthView ? today.getDate() : null;

  function goToMonth(offset) {
    setSelectedDay(null);
    let m = viewMonth + offset;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  }

  const selectedLessons = selectedDay ? lessonsByDay[selectedDay] ?? [] : [];

  return (
    <DashboardShell
      role="student"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск по расписанию..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-stack-lg mt-4">
        {/* Calendar */}
        <div className="lg:col-span-8 space-y-stack-lg">
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-on-surface">
                  {MONTH_NAMES[viewMonth]} {viewYear}
                </h3>
                <p className="font-body-md text-body-md text-on-surface-variant">
                  {loading ? "Загрузка занятий…" : `У вас ${lessons.length} занятий в этом месяце`}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => goToMonth(-1)}
                  className="p-2 hover:bg-surface-container rounded-lg transition-colors border border-outline-variant"
                  aria-label="Предыдущий месяц"
                >
                  <span className="material-symbols-outlined">chevron_left</span>
                </button>
                <button
                  onClick={() => goToMonth(1)}
                  className="p-2 hover:bg-surface-container rounded-lg transition-colors border border-outline-variant"
                  aria-label="Следующий месяц"
                >
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
                {error}
              </div>
            )}

            <div className="grid grid-cols-7 text-center mb-4 border-b border-outline-variant/30 pb-2">
              {WEEKDAYS.map((d) => (
                <div key={d} className="font-label-md text-label-md text-outline">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstWeekday }).map((_, i) => (
                <div key={`pad-${i}`} className="h-20 sm:h-24" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayLessons = lessonsByDay[day] ?? [];
                const isToday = day === todayDay;
                const isSelected = day === selectedDay;
                const firstLesson = dayLessons[0];
                const color = firstLesson ? courseColor[firstLesson.course_id] ?? "#004ac6" : null;

                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDay(day)}
                    className={`text-left h-20 sm:h-24 p-2 rounded-lg font-label-md transition-all relative border
                      ${dayLessons.length ? "text-white" : "text-on-surface-variant bg-surface-container hover:brightness-95"}
                      ${isSelected ? "ring-2 ring-primary scale-[1.02] z-10 shadow-md" : ""}
                      ${isToday ? "border-4" : "border-outline-variant"}
                    `}
                    style={dayLessons.length ? { backgroundColor: color, borderColor: color } : undefined}
                  >
                    {isToday && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-secondary-container text-on-secondary-container text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter z-20">
                        Сегодня
                      </span>
                    )}
                    <span className="font-bold">{day}</span>
                    {dayLessons.slice(0, 1).map((l) => (
                      <div
                        key={l.id}
                        className="mt-1 hidden sm:block overflow-hidden text-ellipsis whitespace-nowrap text-[10px] bg-white rounded px-1"
                        style={{ color }}
                      >
                        {coursesById[l.course_id]?.subject ?? coursesById[l.course_id]?.title ?? l.topic}
                      </div>
                    ))}
                    {dayLessons.length > 1 && (
                      <div className="text-[9px] mt-0.5 opacity-90">+{dayLessons.length - 1} ещё</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Homework list (не привязаны к конкретному занятию в API — показываем отдельным списком) */}
          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-6">
            <h4 className="font-label-md font-bold mb-4">Домашние задания</h4>
            {homework.length === 0 && (
              <p className="text-on-surface-variant font-body-md text-body-md">Заданий пока нет</p>
            )}
            <div className="space-y-2">
              {homework.map((hw) => (
                <div key={hw.id} className="flex items-center justify-between gap-3 p-2 hover:bg-surface-container rounded transition-all">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="material-symbols-outlined text-primary shrink-0">link</span>
                    <span className="font-label-md text-on-surface-variant truncate">{hw.link_url}</span>
                  </div>
                  <StatusBadge status={hw.status === "viewed" ? "Выполнено" : "Ожидание"} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-4">
          <div className="sticky top-24 space-y-stack-lg">
            {!selectedDay || selectedLessons.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-xl shadow-xl overflow-hidden border border-outline-variant border-t-8 border-primary">
                <div className="p-6 flex flex-col items-center text-center">
                  <span className="material-symbols-outlined text-4xl mb-2 text-outline">event_busy</span>
                  <p className="font-body-md text-on-surface-variant">
                    {selectedDay
                      ? `На ${selectedDay} ${MONTH_NAMES[viewMonth].toLowerCase()} занятий не запланировано`
                      : "Выберите день в календаре, чтобы увидеть детали"}
                  </p>
                </div>
              </div>
            ) : (
              selectedLessons.map((lesson) => {
                const course = coursesById[lesson.course_id];
                const tutor = tutorsById[lesson.tutor_id];
                const color = courseColor[lesson.course_id] ?? "#004ac6";
                const isCancelled = lesson.status === "cancelled";
                const isDone =
                  lesson.status === "completed" || lesson.status === "conducted" || (!isCancelled && isLessonPast(lesson, today));

                return (
                  <div
                    key={lesson.id}
                    className="bg-surface-container-lowest rounded-xl shadow-xl overflow-hidden border border-outline-variant border-t-8"
                    style={{ borderTopColor: color }}
                  >
                    <div className="p-6">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <span className="inline-block px-3 py-1 bg-primary/10 text-primary rounded-full font-label-md text-[12px] font-bold mb-2">
                            ЗАНЯТИЕ
                          </span>
                          <h3 className="font-headline-sm text-headline-sm text-on-surface">
                            {course?.subject ?? course?.title ?? lesson.topic}
                          </h3>
                        </div>
                        <StatusBadge status={isCancelled ? "Отменено" : isDone ? "Выполнено" : "Ожидание"} />
                      </div>

                      <div className="space-y-4">
                        {tutor && (
                          <div className="flex items-center gap-4 p-3 bg-surface-container rounded-lg">
                            <div className="w-12 h-12 rounded-full bg-primary-fixed flex items-center justify-center font-bold text-primary shrink-0">
                              {tutor.first_name?.[0]}
                              {tutor.last_name?.[0]}
                            </div>
                            <div>
                              <p className="font-label-md font-bold text-on-surface">
                                {tutor.last_name} {tutor.first_name}
                              </p>
                              <p className="text-[12px] text-on-surface-variant">Преподаватель</p>
                            </div>
                          </div>
                        )}

                        <div className="space-y-3 py-4 border-y border-outline-variant/30">
                          <div className="flex items-center gap-3 text-on-surface-variant">
                            <span className="material-symbols-outlined text-primary">schedule</span>
                            <span className="font-body-md">
                              {lesson.start_time} - {lesson.end_time}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-on-surface-variant">
                            <span className="material-symbols-outlined text-primary">location_on</span>
                            <span className="font-body-md">
                              {lesson.location_type === "remote" ? "Дистанционно (Zoom)" : "Очно, в филиале"}
                            </span>
                          </div>
                        </div>

                        {lesson.comment && (
                          <div className="pt-2">
                            <h4 className="font-label-md font-bold text-on-surface mb-2">Комментарий репетитора:</h4>
                            <div className="p-4 bg-surface-container-low rounded-lg border-l-4 border-secondary-container">
                              <p className="font-body-md text-on-surface-variant italic">{lesson.comment}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
