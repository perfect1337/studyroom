import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import EditLessonModal from "../../components/lessons/EditLessonModal.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchLessons, fetchCourses, fetchEnrollments, fetchAttendance, updateLesson } from "../../api/academic.js";
import { fetchMyPeople, fetchUserById } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";
import { subscribeQuery } from "../../api/queryCache.js";

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
function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}
function nowHHMM() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// Занятие считается прошедшим, если его дата раньше сегодняшней, либо это
// сегодняшнее занятие, которое уже закончилось по времени (end_time <= now).
// Такие занятия должны отображаться в календаре как обычно, но не висеть
// вечно в статусе "Ожидание" — визуально это выглядело как зависший/
// "поплывший" статус для уже состоявшихся пар.
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

export default function TutorSchedule() {
  const { user } = useAuth();

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-based

  const [lessons, setLessons] = useState([]);
  const [courses, setCourses] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [studentsById, setStudentsById] = useState({});
  // Список "своих" учеников тьютора (fetchMyPeople) — источник опций для
  // выпадающего фильтра по ученику в расписании.
  const [myStudents, setMyStudents] = useState([]);
  // Ученики, не найденные среди "своих" (fetchMyPeople) — например, сменили
  // филиал и выпали из выборки тьютора, но остаются участником уже созданного
  // занятия. Дотягиваем их профили отдельно по id (см. load() ниже), как это
  // уже делается в ScheduleDirectory.jsx (owner/branch_owner), чтобы в
  // карточке занятия показывалось ФИО, а не "Ученик #id".
  const [extraStudentsById, setExtraStudentsById] = useState({});
  const [attendanceByLesson, setAttendanceByLesson] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState(null); // day number in current month, or null
  // Фильтр по ученику — сужает занятия тьютора до занятий с конкретным
  // учеником среди участников (lesson_participants). Сервер сам ограничивает
  // выборку по tutor_id = свой, student_id лишь дополнительно сужает её
  // (см. academic-service LessonHandler.List, case RoleTutor).
  const [studentFilter, setStudentFilter] = useState("");

  // Занятие, которое сейчас редактируется. Список lessons уже отфильтрован
  // сервером по tutor_id = свой (см. fetchLessons({ tutor_id: user.id, ... })
  // выше), так что репетитор физически не может открыть чужое занятие.
  const [editingLesson, setEditingLesson] = useState(null);

  // Отметка занятия проведённым — единственный способ реально сдвинуть
  // прогресс ученика по курсу (см. progress_pct на бэкенде:
  // EnrollmentRepository.RecalculateProgress считает его по фактическому
  // количеству занятий со status='completed'). Раньше "Выполнено" в этой
  // карточке было чисто визуальным — считалось по прошедшей дате
  // (isLessonPast), но на бэкенде статус занятия оставался 'scheduled'
  // навсегда, и прогресс никогда не менялся. Теперь дата/badge — это лишь
  // подсказка "пора отметить", а фактическое изменение статуса — отдельное
  // явное действие тьютора.
  const [markingCompletedId, setMarkingCompletedId] = useState(null);
  // { lessonId, message } — привязана к конкретному занятию, чтобы ошибка
  // при отметке одного занятия не "размножалась" на все карточки в списке.
  const [markCompletedError, setMarkCompletedError] = useState(null);

  async function handleMarkCompleted(lesson) {
    setMarkingCompletedId(lesson.id);
    setMarkCompletedError(null);
    try {
      const updated = await updateLesson(lesson.id, { status: "completed" });
      setLessons((prev) => prev.map((l) => (l.id === lesson.id ? { ...l, ...(updated ?? { status: "completed" }) } : l)));
      // updateLesson уже инвалидировал кэш "lessons" (см. api/academic.js),
      // на который эта страница подписана (см. subscribeQuery ниже) — та
      // подписка сама перезапросит lessons И enrollments (load() тянет оба
      // сразу), так что progress_pct на карточках учеников обновится без
      // дополнительного кода здесь.
    } catch (err) {
      setMarkCompletedError({ lessonId: lesson.id, message: err.message || "Не удалось отметить занятие проведённым" });
    } finally {
      setMarkingCompletedId(null);
    }
  }

  function handleLessonSaved(updated) {
    setLessons((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
  }
  function handleLessonCancelled(lessonId) {
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, status: "cancelled" } : l)));
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // 0 = Monday

  // requestIdRef защищает от гонки ответов: если пользователь быстро
  // переключает месяцы (или сработал silent-перезапрос из-за инвалидации
  // кэша, пока уже летит обычная загрузка), более старый по времени запуска
  // ответ не должен перезаписать данные более свежим запросом, даже если
  // сеть вернула его позже (аналог предыдущего локального флага `cancelled`,
  // но переживающего вынос load() в переиспользуемый useCallback).
  const requestIdRef = useRef(0);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!user?.id) return;
      const requestId = ++requestIdRef.current;
      if (!silent) setLoading(true);
      setError("");
      try {
        const date_from = toISODate(viewYear, viewMonth, 1);
        const date_to = toISODate(viewYear, viewMonth, daysInMonth);

        const [lessonsRes, coursesRes, enrollRes, peopleRes] = await Promise.all([
          fetchLessons({
            tutor_id: user.id,
            student_id: studentFilter ? Number(studentFilter) : undefined,
            date_from,
            date_to,
          }),
          fetchCourses({ tutor_id: user.id }),
          fetchEnrollments({ tutor_id: user.id }),
          fetchMyPeople(),
        ]);
        if (requestId !== requestIdRef.current) return;

        const lessonItems = lessonsRes?.items ?? [];
        setLessons(lessonItems);
        setCourses(coursesRes?.items ?? []);
        setEnrollments(enrollRes?.items ?? []);
        if (!silent) setSelectedDay(null);

        const byId = {};
        (peopleRes?.students ?? []).forEach((s) => (byId[s.id] = s));
        setStudentsById(byId);
        setMyStudents(peopleRes?.students ?? []);

        // Участники занятий (lesson_participants) — реальные ученики, которым
        // назначено конкретное занятие. У тьютора не все они обязательно
        // входят в fetchMyPeople (см. комментарий у extraStudentsById выше),
        // поэтому недостающих дотягиваем по id, как в ScheduleDirectory.jsx.
        const participantIds = new Set();
        lessonItems.forEach((l) => (l.participant_ids ?? []).forEach((id) => participantIds.add(id)));
        const missingIds = [...participantIds].filter((id) => !byId[id]);
        if (missingIds.length) {
          const fetched = await Promise.all(missingIds.map((id) => fetchUserById(id).catch(() => null)));
          if (requestId !== requestIdRef.current) return;
          const extra = {};
          fetched.forEach((s, i) => {
            if (s) extra[missingIds[i]] = s;
          });
          setExtraStudentsById(extra);
        } else {
          setExtraStudentsById({});
        }

        // Для уже прошедших занятий подтягиваем реальную посещаемость (кто был/отсутствовал).
        const now = nowHHMM();
        const isPastDate = (d) => d < toISODate(today.getFullYear(), today.getMonth(), today.getDate());
        const pastLessons = lessonItems.filter(
          (l) => isPastDate(l.lesson_date) || (l.lesson_date === toISODate(today.getFullYear(), today.getMonth(), today.getDate()) && l.end_time <= now)
        );
        if (pastLessons.length) {
          const results = await Promise.all(pastLessons.map((l) => fetchAttendance(l.id).catch(() => null)));
          if (requestId !== requestIdRef.current) return;
          const map = {};
          pastLessons.forEach((l, i) => {
            if (results[i]) map[l.id] = results[i]?.items ?? [];
          });
          setAttendanceByLesson(map);
        }
      } catch (e) {
        if (requestId === requestIdRef.current) setError(e.message || "Не удалось загрузить расписание");
      } finally {
        if (requestId === requestIdRef.current && !silent) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id, viewYear, viewMonth, daysInMonth, studentFilter]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Раньше единственным способом узнать, что занятие изменилось (отменено
  // тьютором на другой вкладке, изменено администратором и т.п.) была
  // перезагрузка страницы: список lessons жил только в локальном useState
  // этой страницы и ничего не знал о мутациях, произошедших в другом месте.
  // Теперь подписываемся на тот же кэш-ключ, которым fetchLessons(...) выше
  // пользуется внутри cachedQuery: как только где-либо вызывается
  // invalidateQuery(["lessons"]) (создание/изменение/отмена занятия — см.
  // api/academic.js), эта подписка получает reason="invalidate" и тихо
  // перезапрашивает актуальные данные (silent: true — без setLoading(true),
  // без мигания "Загрузка занятий…", старые данные остаются на экране до
  // прихода свежих).
  useEffect(() => {
    if (!user?.id) return;
    const date_from = toISODate(viewYear, viewMonth, 1);
    const date_to = toISODate(viewYear, viewMonth, daysInMonth);
    const key = [
      "lessons",
      {
        tutor_id: user.id,
        student_id: studentFilter ? Number(studentFilter) : undefined,
        branch_id: undefined,
        date_from,
        date_to,
      },
    ];
    const unsubscribe = subscribeQuery(key, (reason) => {
      if (reason === "invalidate") load({ silent: true });
    });
    return unsubscribe;
  }, [user?.id, viewYear, viewMonth, daysInMonth, studentFilter, load]);

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

  // Объединённый справочник учеников: "свои" (fetchMyPeople) + дотянутые
  // отдельно по id участники занятий, которые не входят в fetchMyPeople
  // (см. комментарий у extraStudentsById выше).
  const allStudentsById = useMemo(
    () => ({ ...extraStudentsById, ...studentsById }),
    [studentsById, extraStudentsById]
  );

  // Записи (enrollments) по student_id — нужны только для прогресса
  // (progress_pct) конкретного ученика по курсу занятия, см. ниже.
  const enrollmentByStudentAndCourse = useMemo(() => {
    const map = {};
    enrollments.forEach((e) => {
      map[`${e.student_id}:${e.course_id}`] = e;
    });
    return map;
  }, [enrollments]);

  // Ученики конкретного занятия — берём напрямую из participant_ids, которые
  // отдаёт API вместе с занятием (реальные участники этого занятия, снимок
  // lesson_participants), а НЕ из всех активных записей на курс: у курса
  // может быть много учеников, но конкретное занятие назначено не всем сразу
  // (см. models.Lesson.ParticipantIDs на бэкенде). Раньше здесь ошибочно
  // показывались все активные ученики курса — из-за этого в карточке любого
  // занятия отображался весь список, а не тот ученик, кому оно назначено.
  const studentsForLesson = useMemo(() => {
    const map = {}; // lesson.id -> [{ student, enrollment }, ...]
    lessons.forEach((l) => {
      const ids = [...new Set(l.participant_ids ?? [])];
      map[l.id] = ids.map((id) => {
        const known = allStudentsById[id];
        const enrollment = enrollmentByStudentAndCourse[`${id}:${l.course_id}`];
        if (known) return { id, student: known, enrollment };
        // Нет профиля даже среди дотянутых по id — используем ФИО из
        // participant_names (снапшот имён с бэкенда, см. Lesson.ParticipantNames),
        // и только если даже его нет, показываем "Ученик #id" как последний фолбэк.
        const fallbackName = l.participant_names?.[id];
        return {
          id,
          student: fallbackName ? { id, first_name: fallbackName, last_name: "" } : null,
          enrollment,
        };
      });
    });
    return map;
  }, [lessons, allStudentsById, enrollmentByStudentAndCourse]);

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
      role="tutor"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск по расписанию..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      {/* Фильтр по ученику — сужает занятия до занятий с конкретным учеником
          среди участников. Сервер и так отдаёт только занятия этого тьютора
          (см. LessonHandler.List, case RoleTutor), student_id лишь
          дополнительно сужает выборку внутри его собственных занятий. */}
      <div className="flex flex-wrap items-center gap-3 mt-4">
        <div className="relative">
          <select
            value={studentFilter}
            onChange={(e) => setStudentFilter(e.target.value)}
            className="appearance-none bg-surface-container-lowest border border-outline-variant rounded-lg pl-4 pr-9 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          >
            <option value="">Все ученики</option>
            {myStudents.map((s) => (
              <option key={s.id} value={s.id}>
                {fullName(s)}
              </option>
            ))}
          </select>
        </div>
        {studentFilter && (
          <button
            type="button"
            onClick={() => setStudentFilter("")}
            className="px-4 py-2 rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high transition-colors border border-outline-variant"
          >
            Сбросить фильтр
          </button>
        )}
      </div>

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
                        {coursesById[l.course_id]?.title ?? coursesById[l.course_id]?.subject ?? l.topic}
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
                const color = courseColor[lesson.course_id] ?? "#004ac6";
                const isCancelled = lesson.status === "cancelled";
                const isCompletedInBackend = lesson.status === "completed";
                const isDone =
                  isCompletedInBackend || lesson.status === "conducted" || (!isCancelled && isLessonPast(lesson, today));
                const roster = studentsForLesson[lesson.id] ?? [];
                const attendance = attendanceByLesson[lesson.id] ?? [];
                const attendanceByStudent = {};
                attendance.forEach((r) => (attendanceByStudent[r.student_id] = r));

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
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <StatusBadge status={isCancelled ? "Отменено" : isDone ? "Выполнено" : "Ожидание"} />
                          {!isCancelled && !isCompletedInBackend && (
                            <button
                              type="button"
                              onClick={() => handleMarkCompleted(lesson)}
                              disabled={markingCompletedId === lesson.id}
                              className="flex items-center gap-1 px-3 py-1 rounded-full font-label-md text-[12px] text-primary bg-primary-container/40 hover:bg-primary-container/70 transition-colors disabled:opacity-60"
                            >
                              <span className="material-symbols-outlined text-[14px]">check_circle</span>
                              {markingCompletedId === lesson.id ? "Отмечаем…" : "Отметить проведённым"}
                            </button>
                          )}
                          {!isCancelled && (
                            <button
                              type="button"
                              onClick={() => setEditingLesson(lesson)}
                              className="flex items-center gap-1 px-3 py-1 rounded-full font-label-md text-[12px] text-primary border border-primary hover:bg-primary-container/20 transition-colors"
                            >
                              <span className="material-symbols-outlined text-[14px]">edit</span>
                              Редактировать
                            </button>
                          )}
                        </div>
                      </div>
                      {markCompletedError && markCompletedError.lessonId === lesson.id && (
                        <p className="text-[12px] text-error -mt-2 mb-2">{markCompletedError.message}</p>
                      )}

                      <div className="space-y-4">
                        {/* Карточка преподавателя занятия — по аналогии с карточкой
                            репетитора в StudentSchedule/ParentSchedule. У курса может
                            быть несколько преподавателей (course_tutors), а у
                            конкретного занятия всегда один — lesson.tutor_id; здесь
                            наглядно показываем, кто именно ведёт выбранное занятие. */}
                        <div className="flex items-center gap-3 p-3 bg-surface-container rounded-lg">
                          <div className="w-10 h-10 rounded-full overflow-hidden bg-primary-fixed flex items-center justify-center font-bold text-primary shrink-0">
                            {user?.avatar_url ? (
                              <img src={user.avatar_url} alt={fullName(user)} className="w-full h-full object-cover" />
                            ) : (
                              initials(user)
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-label-md font-bold text-on-surface truncate">
                              {lesson.tutor_id === user?.id ? fullName(user) : `Преподаватель #${lesson.tutor_id}`}
                            </p>
                            <p className="text-[12px] text-on-surface-variant">Преподаватель занятия</p>
                          </div>
                        </div>

                        {/* Ученик(и) занятия — вместо карточки преподавателя (как у ученика/родителя),
                            здесь репетитор видит, кто записан на курс этого занятия. */}
                        <div>
                          <h4 className="font-label-md font-bold text-on-surface mb-2">
                            {lesson.group_type === "group" ? "Ученики группы:" : "Ученик:"}
                          </h4>
                          {roster.length === 0 ? (
                            <p className="font-body-md text-on-surface-variant italic">
                              Участники занятия не найдены.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {roster.map(({ id, student, enrollment }) => {
                                const record = attendanceByStudent[id];
                                return (
                                  <div
                                    key={id}
                                    className="flex items-center gap-3 p-3 bg-surface-container rounded-lg"
                                  >
                                    <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center font-bold text-primary shrink-0">
                                      {initials(student)}
                                    </div>
                                    <div className="flex-1">
                                      <p className="font-label-md font-bold text-on-surface">
                                        {student ? fullName(student) : `Ученик #${id}`}
                                      </p>
                                      <p className="text-[12px] text-on-surface-variant">
                                        Прогресс по курсу: {enrollment?.progress_pct ?? 0}%
                                      </p>
                                    </div>
                                    {record && (
                                      <StatusBadge
                                        status={record.status === "absent" ? "Просрочен" : "Выполнено"}
                                        color={record.status === "absent" ? "red" : "green"}
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

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
                            <h4 className="font-label-md font-bold text-on-surface mb-2">Комментарий:</h4>
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

      <EditLessonModal
        open={!!editingLesson}
        lesson={editingLesson}
        canReassignTutor={false}
        onClose={() => setEditingLesson(null)}
        onSaved={handleLessonSaved}
        onCancelled={handleLessonCancelled}
      />
    </DashboardShell>
  );
}
