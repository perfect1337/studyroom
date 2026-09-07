import { useEffect, useMemo, useRef, useState } from "react";
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
  // Бэкенд отдаёт lesson_date как полный timestamp (например, "2024-01-15T00:00:00Z"),
  // а не как "YYYY-MM-DD". Сравнивать такую строку напрямую с todayISO нельзя: из-за
  // суффикса "T00:00:00Z" строка с датой всегда оказывалась "больше" todayISO, и
  // сегодняшние занятия никогда не помечались прошедшими. Берём только дату (первые
  // 10 символов), как это уже делается в календаре (см. lesson.lesson_date?.slice(8, 10)).
  const lessonDateOnly = String(lesson.lesson_date).slice(0, 10);
  if (lessonDateOnly < todayISO) return true;
  if (lessonDateOnly > todayISO) return false;
  // end_time может приходить как "HH:MM:SS" (из Postgres TIME) — приводим к "HH:MM",
  // чтобы корректно сравнивать с nowHHMM() и не залипать на последней минуте занятия.
  const endTime = String(lesson.end_time ?? "23:59").slice(0, 5);
  return endTime <= nowHHMM();
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
  // Панель подробностей выбранного дня (справа на десктопе, снизу — на
  // телефонах и планшетах). detailPanelRef + scrollToDetailsOnMobile — тот же
  // приём, что и в расписании управляющего филиалом/владельца сети (см.
  // ScheduleDirectory.jsx): по клику на день в мобильной раскладке (когда
  // панель уходит под календарь) страницу нужно явно проскроллить вниз, к
  // якорю панели, иначе пользователь не заметит появившиеся детали.
  const detailPanelRef = useRef(null);
  function scrollToDetailsOnMobile() {
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 1023px)").matches) return;
    requestAnimationFrame(() => {
      detailPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  function selectDay(day) {
    setSelectedDay(day);
    scrollToDetailsOnMobile();
  }
  // Дни месяца, для которых развёрнут полный список занятий (карточка дня в
  // календаре по умолчанию показывает первые 3 занятия — как у управляющего
  // филиалом, см. ScheduleDirectory.jsx).
  const [expandedDays, setExpandedDays] = useState(new Set());

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

  // Краткая информация по занятию для карточки дня в календаре — тот же
  // формат, что и в расписании управляющего филиалом (ScheduleDirectory.jsx),
  // но без какой-либо логики по статусу оплаты договора: карточка всегда
  // отображается в одном и том же светло-голубом стиле.
  function lessonShortInfo(lesson) {
    const course = coursesById[lesson.course_id];
    const subject = course?.subject || course?.title || lesson.topic || "Занятие";
    const format = lesson.group_type === "individual" ? "И" : "Г";
    const location = lesson.location_type === "onsite" ? "О" : "Д";
    return { subject, classes: [], format, location };
  }

  return (
    <DashboardShell
      fullWidth
      role="student"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск по расписанию..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-stack-lg mt-4">
        {/* Calendar */}
        <div className="lg:col-span-9 space-y-stack-lg">
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

            {/* Мобильный/планшетный вид: карточки дней (как у управляющего
                филиалом, см. ScheduleDirectory.jsx) — тесная сетка 7 колонок
                неудобна не только на телефонах, но и на планшетах (с учётом
                постоянной боковой панели DashboardShell реальной ширины для
                неё не хватает вплоть до lg), поэтому показываем расписание
                карточками по дням: одна колонка на телефоне, две — на планшете. */}
            <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-2">
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayLessons = lessonsByDay[day] ?? [];
                const isToday = day === todayDay;
                const isSelected = day === selectedDay;
                const isExpanded = expandedDays.has(day);
                const dayStateClass = dayLessons.length
                  ? "bg-primary-container/60 border-primary/40"
                  : "bg-surface-container border-outline-variant/40";

                return (
                  <button
                    key={`mobile-day-${day}`}
                    onClick={() => selectDay(day)}
                    className={`w-full text-left p-3 rounded-xl border ${dayStateClass} ${isSelected ? "ring-2 ring-primary ring-offset-1" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base font-bold text-on-surface shrink-0">{day}</span>
                        <span className="text-sm font-semibold text-on-surface-variant shrink-0">
                          {WEEKDAYS[(firstWeekday + day - 1) % 7]}
                        </span>
                        {isToday && (
                          <span className="bg-primary text-on-primary text-[10px] px-2 py-0.5 rounded-full font-bold uppercase shrink-0">
                            Сегодня
                          </span>
                        )}
                      </div>
                    </div>
                    {dayLessons.length === 0 ? (
                      <div className="text-sm text-on-surface-variant">Занятий нет</div>
                    ) : (
                      <div className="space-y-2">
                        {(isExpanded ? dayLessons : dayLessons.slice(0, 6)).map((l) => {
                          const info = lessonShortInfo(l);
                          return (
                            <div
                              key={l.id}
                              className="rounded-lg bg-white/80 text-on-surface px-3 py-2"
                            >
                              <div className="text-sm font-bold leading-snug break-words">{info.subject}</div>
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs font-semibold text-on-surface-variant">
                                <span>
                                  {l.start_time?.slice(0, 5) || "—"}
                                  {l.end_time ? `–${l.end_time.slice(0, 5)}` : ""}
                                </span>
                                {info.classes.length > 0 && <span>{info.classes.join(", ")}</span>}
                                <span>{info.format}</span>
                                <span>{info.location}</span>
                              </div>
                            </div>
                          );
                        })}
                        {dayLessons.length > 6 && (
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedDays((prev) => {
                                const next = new Set(prev);
                                if (next.has(day)) next.delete(day);
                                else next.add(day);
                                return next;
                              });
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                setExpandedDays((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(day)) next.delete(day);
                                  else next.add(day);
                                  return next;
                                });
                              }
                            }}
                            className="text-sm font-bold text-primary cursor-pointer hover:underline"
                          >
                            {isExpanded ? "Свернуть" : `+ ещё ${dayLessons.length - 6}`}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="hidden lg:grid lg:grid-cols-7 text-center mb-4 border-b border-outline-variant/30 pb-2">
              {WEEKDAYS.map((d) => (
                <div key={d} className="font-label-md text-label-md text-outline">
                  {d}
                </div>
              ))}
            </div>

            <div className="hidden lg:grid lg:grid-cols-7 gap-1.5">
              {Array.from({ length: firstWeekday }).map((_, i) => (
                <div key={`pad-${i}`} className="h-24" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayLessons = lessonsByDay[day] ?? [];
                const isToday = day === todayDay;
                const isSelected = day === selectedDay;
                const isExpanded = expandedDays.has(day);
                const hasLessons = dayLessons.length > 0;
                // Карточка дня всегда одного и того же светло-голубого цвета,
                // если в этот день есть занятия — без учёта статуса оплаты
                // договора (в отличие от расписания управляющего филиалом,
                // где проблемные дни подсвечиваются красным).
                const dayStateClass = hasLessons
                  ? "bg-primary-container text-on-primary-container border-primary"
                  : "text-on-surface-variant bg-surface-container border-outline-variant/40 hover:bg-surface-container-high hover:border-outline-variant";

                return (
                  <button
                    key={day}
                    onClick={() => selectDay(day)}
                    className={`text-left min-h-28 p-2 rounded-xl font-label-md transition-all duration-150 relative border flex flex-col ${dayStateClass} ${isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-surface-container-lowest scale-[1.03] z-10 shadow-lg" : hasLessons ? "shadow-sm hover:shadow-md hover:brightness-[1.03]" : ""} ${isToday ? "ring-2 ring-primary/50 ring-inset" : ""}`}
                  >
                    {isToday && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary text-on-primary text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter z-20 shadow-sm">
                        Сегодня
                      </span>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[13px]">{day}</span>
                    </div>
                    <div className="mt-1 space-y-1 overflow-hidden flex-1">
                      {(isExpanded ? dayLessons : dayLessons.slice(0, 3)).map((l) => {
                        const info = lessonShortInfo(l);
                        return (
                          <div
                            key={l.id}
                            className="rounded-md bg-white/80 text-on-surface px-1.5 py-1 text-[10px] leading-tight shadow-[0_1px_1px_rgba(0,0,0,0.04)] flex items-start gap-1"
                          >
                            <span className="shrink-0 text-[9px] font-semibold opacity-70 pt-px">
                              {l.start_time?.slice(0, 5) || "—"}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="font-bold truncate">{info.subject}</div>
                              <div className="flex flex-wrap gap-x-1.5 gap-y-0.5 font-semibold opacity-80">
                                {info.classes.length > 0 && <span>{info.classes.join(", ")}</span>}
                                <span>{info.format}</span>
                                <span>{info.location}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {dayLessons.length > 3 && (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedDays((prev) => {
                              const next = new Set(prev);
                              if (next.has(day)) next.delete(day);
                              else next.add(day);
                              return next;
                            });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              setExpandedDays((prev) => {
                                const next = new Set(prev);
                                if (next.has(day)) next.delete(day);
                                else next.add(day);
                                return next;
                              });
                            }
                          }}
                          className="text-[9px] font-bold text-primary cursor-pointer hover:underline"
                        >
                          {isExpanded ? "Свернуть" : `+ ещё ${dayLessons.length - 3}`}
                        </div>
                      )}
                    </div>
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
        <div ref={detailPanelRef} className="lg:col-span-3 scroll-mt-24">
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
                            {course?.title ?? course?.subject ?? lesson.topic}
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
