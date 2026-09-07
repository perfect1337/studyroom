import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useSearchParams } from "react-router-dom";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
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

function weekBadgeClasses(kind, value) {
  if (kind === "location") {
    return value === "О" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700";
  }
  return "bg-surface-container text-on-surface-variant";
}

// WeekLessonChip — карточка занятия внутри ячейки недельной сетки (десктоп).
// Тот же компонент, что и в расписании управляющего филиалом (см.
// ScheduleDirectory.jsx), но без подсветки "проблемных" занятий — у
// репетитора нет доступа к статусу оплаты договора.
function WeekLessonChip({ info, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border px-2 py-1.5 mb-1.5 last:mb-0 transition-colors ${
        selected ? "border-primary bg-primary-container/40" : "bg-primary-container/60 border-primary/40 hover:brightness-95"
      }`}
    >
      <div className="font-label-md text-[11px] font-bold text-on-surface truncate">{info.subject}</div>
      {info.classes.length > 0 && (
        <div className="text-[10px] text-on-surface-variant truncate">{info.classes.join(", ")}</div>
      )}
      <div className="flex gap-1 mt-1">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${weekBadgeClasses("location", info.location)}`}>
          {info.location}
        </span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${weekBadgeClasses("group", info.format)}`}>
          {info.format}
        </span>
      </div>
    </button>
  );
}

/**
 * Недельный вид расписания — тот же компонент, что и в расписании
 * управляющего филиалом/владельца сети (см. WeekGrid в ScheduleDirectory.jsx):
 * десктоп — сетка "время x день", мобильный — вкладки дней недели сверху и
 * список занятий выбранного дня. Дни, не входящие в текущий месяц (края
 * первой/последней недели), в weekDays приходят как null.
 */
function WeekGrid({ weekDays, weekTimes, lessonsByDay, todayDay, lessonShortInfo, selectedLesson, onSelectLesson }) {
  const [mobileDayIdx, setMobileDayIdx] = useState(0);

  useEffect(() => {
    const todayIdx = todayDay ? weekDays.indexOf(todayDay) : -1;
    if (todayIdx >= 0) {
      setMobileDayIdx(todayIdx);
      return;
    }
    const firstWithLessons = weekDays.findIndex((d) => d && (lessonsByDay[d] ?? []).length > 0);
    setMobileDayIdx(firstWithLessons >= 0 ? firstWithLessons : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekDays]);

  const mobileDay = weekDays[mobileDayIdx];
  const mobileDayLessons = mobileDay
    ? (lessonsByDay[mobileDay] ?? [])
        .slice()
        .sort((a, b) => String(a.start_time ?? "").localeCompare(String(b.start_time ?? "")))
    : [];

  return (
    <div>
      {/* Мобильный вид (включая планшеты, см. комментарий в десктопном виде ниже). */}
      <div className="lg:hidden">
        <div className="grid grid-cols-7 gap-1 mb-3">
          {weekDays.map((day, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => day && setMobileDayIdx(idx)}
              disabled={!day}
              className={`text-center py-2 rounded-lg font-label-md text-[11px] border transition-colors ${
                idx === mobileDayIdx
                  ? "bg-primary text-on-primary border-primary"
                  : day
                    ? "bg-surface-container border-outline-variant text-on-surface-variant"
                    : "bg-surface-container/40 border-outline-variant/30 text-on-surface-variant/40"
              }`}
            >
              <div>{WEEKDAYS[idx]}</div>
              {day && <div className="text-[10px] font-bold mt-0.5">{day}</div>}
            </button>
          ))}
        </div>
        {!mobileDay ? (
          <div className="text-sm text-on-surface-variant py-4 text-center">Нет данных за этот день</div>
        ) : mobileDayLessons.length === 0 ? (
          <div className="text-sm text-on-surface-variant py-4 text-center">Занятий нет</div>
        ) : (
          <div className="space-y-2">
            {mobileDayLessons.map((l) => {
              const info = lessonShortInfo(l);
              const isSelected = selectedLesson?.id === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onSelectLesson(l)}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                    isSelected ? "border-primary bg-primary-container/40" : "bg-primary-container/60 border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-label-md text-[13px] font-bold text-on-surface shrink-0">
                      {l.start_time?.slice(0, 5)}
                      {l.end_time ? `–${l.end_time.slice(0, 5)}` : ""}
                    </span>
                    <span className="text-[12px] text-on-surface-variant truncate">{info.subject}</span>
                  </div>
                  {info.classes.length > 0 && (
                    <div className="text-[11px] text-on-surface-variant mt-0.5">{info.classes.join(", ")}</div>
                  )}
                  <div className="flex gap-1 mt-1.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${weekBadgeClasses("location", info.location)}`}>
                      {info.location}
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${weekBadgeClasses("group", info.format)}`}>
                      {info.format}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Десктопный вид: время x день, как в исходной таблице. */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full border-collapse min-w-[640px] table-fixed">
          <colgroup>
            <col className="w-16" />
            {weekDays.map((_, idx) => (
              <col key={idx} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="w-16" />
              {weekDays.map((day, idx) => (
                <th key={idx} className="text-center pb-2 font-label-md text-label-md text-outline">
                  <div>{WEEKDAYS[idx]}</div>
                  {day && <div className="text-[11px] font-bold text-on-surface-variant">{day}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekTimes.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-10 text-on-surface-variant font-body-md">
                  На этой неделе занятий нет
                </td>
              </tr>
            ) : (
              weekTimes.map((time) => (
                <tr key={time}>
                  <td className="align-top pt-2 pr-2 text-[12px] font-bold text-on-surface-variant whitespace-nowrap">{time}</td>
                  {weekDays.map((day, idx) => {
                    const cellLessons = day
                      ? (lessonsByDay[day] ?? []).filter((l) => l.start_time?.slice(0, 5) === time)
                      : [];
                    return (
                      <td key={idx} className="align-top border border-outline-variant/30 p-1.5 min-w-[100px]">
                        {cellLessons.map((l) => {
                          const info = lessonShortInfo(l);
                          return (
                            <WeekLessonChip
                              key={l.id}
                              info={info}
                              selected={selectedLesson?.id === l.id}
                              onClick={() => onSelectLesson(l)}
                            />
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TutorSchedule() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const deepLinkLessonId = searchParams.get("lesson_id");
  const deepLinkDate = searchParams.get("date");

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
  // Дни месяца, для которых развёрнут полный список занятий (карточка дня в
  // календаре по умолчанию показывает первые 3 занятия — как у управляющего
  // филиалом, см. ScheduleDirectory.jsx).
  const [expandedDays, setExpandedDays] = useState(new Set());
  // viewMode — переключатель "Месяц"/"Неделя", как у управляющего филиалом/
  // владельца сети (см. ScheduleDirectory.jsx). По умолчанию — месяц (как и
  // было раньше), неделя доступна по клику на переключатель.
  const [viewMode, setViewMode] = useState("month");
  // weekIndex — индекс строки календарной сетки месяца (см. monthWeeks
  // ниже), которая сейчас показана как "неделя".
  const [weekIndex, setWeekIndex] = useState(0);
  // selectedLesson — выбранное занятие в недельном виде (клик по карточке
  // занятия в ячейке недели); отдельно от selectedDay, которым оперирует
  // месячный вид.
  const [selectedLesson, setSelectedLesson] = useState(null);
  // Флаг для goToWeek(-1): при переходе на предыдущий месяц нужно встать
  // на его ПОСЛЕДНЮЮ неделю, а эффект ниже по умолчанию поставил бы первую —
  // флаг просит эффект пропустить один раз свой авто-сброс.
  const skipWeekAutoResetRef = useRef(false);
  // Фильтр по ученику — сужает занятия тьютора до занятий с конкретным
  // учеником среди участников (lesson_participants). Сервер сам ограничивает
  // выборку по tutor_id = свой, student_id лишь дополнительно сужает её
  // (см. academic-service LessonHandler.List, case RoleTutor).
  const [studentFilter, setStudentFilter] = useState("");
  // Панель подробностей выбранного дня (справа на десктопе, снизу — на
  // телефонах и планшетах). detailPanelRef + scrollToDetailsOnMobile — тот же
  // приём, что и в расписании управляющего филиалом/владельца сети (см.
  // ScheduleDirectory.jsx): по клику на день/занятие в мобильной раскладке
  // (когда панель уходит под календарь) страницу нужно явно проскроллить
  // вниз, к якорю панели, иначе пользователь не заметит появившиеся детали.
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
  // Кнопка "Назад к расписанию" в панели деталей (видна только на
  // телефонах/планшетах, т.е. пока панель не стоит рядом с календарём, а
  // выводится под ним) — обратный якорь к scrollToDetailsOnMobile: возвращает
  // пользователя вверх к календарю, к которому он прокрутил вниз после клика.
  const calendarTopRef = useRef(null);
  function scrollToScheduleOnMobile() {
    requestAnimationFrame(() => {
      calendarTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // Занятие, которое сейчас редактируется. Список lessons уже отфильтрован
  // сервером по tutor_id = свой (см. fetchLessons({ tutor_id: user.id, ... })
  // выше), так что репетитор физически не может открыть чужое занятие.

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
      setSelectedLesson((prev) => (prev && prev.id === lesson.id ? { ...prev, ...(updated ?? { status: "completed" }) } : prev));
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

  // monthWeeks — строки той же сетки, что рисует месячный календарь: каждая
  // строка — 7 ячеек (Пн..Вс), дни за пределами месяца — null. Недельный вид
  // показывает одну такую строку подробно (по времени).
  const monthWeeks = useMemo(() => {
    const totalCells = firstWeekday + daysInMonth;
    const rows = Math.ceil(totalCells / 7);
    const weeks = [];
    for (let r = 0; r < rows; r++) {
      const week = [];
      for (let c = 0; c < 7; c++) {
        const day = r * 7 + c - firstWeekday + 1;
        week.push(day >= 1 && day <= daysInMonth ? day : null);
      }
      weeks.push(week);
    }
    return weeks;
  }, [firstWeekday, daysInMonth]);

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
  useEffect(() => {
    if (!deepLinkDate) return;
    const [year, month, day] = deepLinkDate.split("-").map(Number);
    if (!year || !month || !day) return;
    if (year !== viewYear || month - 1 !== viewMonth) {
      setViewYear(year);
      setViewMonth(month - 1);
      return;
    }
    setSelectedDay(day);
  }, [deepLinkDate, viewYear, viewMonth]);

  useEffect(() => {
    if (!deepLinkLessonId || !lessons.length || !deepLinkDate) return;
    const lesson = lessons.find((item) => String(item.id) === String(deepLinkLessonId));
    if (!lesson) return;
    const day = Number(String(lesson.lesson_date ?? deepLinkDate).slice(8, 10));
    if (day) setSelectedDay(day);
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-lesson-id="${lesson.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [deepLinkLessonId, deepLinkDate, lessons]);


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
    setSelectedLesson(null);
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

  // При смене месяца (или при первой загрузке) ставим "неделю" на ту строку
  // сетки, где сегодняшний день — если сейчас показан текущий месяц, иначе
  // на первую неделю месяца. skipWeekAutoResetRef позволяет goToWeek(-1)
  // явно выставить последнюю неделю предыдущего месяца, не давая этому
  // эффекту затереть её значением по умолчанию.
  useEffect(() => {
    if (skipWeekAutoResetRef.current) {
      skipWeekAutoResetRef.current = false;
      return;
    }
    if (isCurrentMonthView && todayDay) {
      const row = monthWeeks.findIndex((week) => week.includes(todayDay));
      setWeekIndex(row >= 0 ? row : 0);
    } else {
      setWeekIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewYear, viewMonth]);

  function goToWeek(offset) {
    setSelectedLesson(null);
    const next = weekIndex + offset;
    if (next < 0) {
      skipWeekAutoResetRef.current = true;
      goToMonth(-1);
      const prevMonthDate = new Date(viewYear, viewMonth, 0); // последний день предыдущего месяца
      const prevDaysInMonth = prevMonthDate.getDate();
      const prevFirstWeekday = (new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), 1).getDay() + 6) % 7;
      const rowCount = Math.ceil((prevFirstWeekday + prevDaysInMonth) / 7);
      setWeekIndex(rowCount - 1);
    } else if (next >= monthWeeks.length) {
      skipWeekAutoResetRef.current = true;
      goToMonth(1);
      setWeekIndex(0);
    } else {
      setWeekIndex(next);
    }
  }

  const currentWeek = monthWeeks[Math.min(weekIndex, monthWeeks.length - 1)] ?? [];

  // Время начала занятий этой недели, по возрастанию — строки недельной сетки.
  const weekTimes = useMemo(() => {
    const set = new Set();
    currentWeek.forEach((day) => {
      if (!day) return;
      (lessonsByDay[day] ?? []).forEach((l) => {
        if (l.start_time) set.add(String(l.start_time).slice(0, 5));
      });
    });
    return [...set].sort();
  }, [currentWeek, lessonsByDay]);

  const isWeekMode = viewMode === "week";

  // Список занятий для панели деталей справа: в месячном виде — все занятия
  // выбранного дня (как раньше), в недельном — ровно одно кликнутое занятие.
  const selectedLessons = isWeekMode
    ? selectedLesson
      ? [selectedLesson]
      : []
    : selectedDay
      ? lessonsByDay[selectedDay] ?? []
      : [];

  // Краткая информация по занятию для карточки дня в календаре — тот же
  // формат, что и в расписании управляющего филиалом (ScheduleDirectory.jsx),
  // но без какой-либо логики по статусу оплаты договора: карточка всегда
  // отображается в одном и том же светло-голубом стиле.
  function lessonShortInfo(lesson) {
    const course = coursesById[lesson.course_id];
    const roster = studentsForLesson[lesson.id] ?? [];
    const classes = [...new Set(
      roster
        .map((r) => r.student?.class_info)
        .filter(Boolean)
        .map((c) => {
          const value = String(c).trim();
          return /^\d+$/.test(value) ? `${value}кл` : value;
        })
    )];
    const subject = course?.subject || course?.title || lesson.topic || "Занятие";
    const format = lesson.group_type === "individual" ? "И" : "Г";
    const location = lesson.location_type === "onsite" ? "О" : "Д";
    return { subject, classes, format, location };
  }

  return (
    <DashboardShell
      fullWidth
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
        <div ref={calendarTopRef} className="lg:col-span-9 space-y-stack-lg scroll-mt-24">
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant">
            <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-on-surface">
                  {isWeekMode ? `Неделя ${weekIndex + 1} из ${monthWeeks.length}` : `${MONTH_NAMES[viewMonth]} ${viewYear}`}
                </h3>
                <p className="font-body-md text-body-md text-on-surface-variant">
                  {loading
                    ? "Загрузка занятий…"
                    : isWeekMode
                      ? `${MONTH_NAMES[viewMonth]} ${viewYear}`
                      : `У вас ${lessons.length} занятий в этом месяце`}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Переключатель Неделя/Месяц — та же возможность, что и у
                    управляющего филиалом/владельца сети (см. ScheduleDirectory.jsx). */}
                <div className="flex rounded-full border border-outline-variant p-0.5 bg-surface-container">
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode("week");
                      setSelectedDay(null);
                    }}
                    className={`px-4 py-1.5 rounded-full font-label-md text-label-md transition-colors ${
                      isWeekMode ? "bg-primary text-on-primary" : "text-on-surface-variant"
                    }`}
                  >
                    Неделя
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode("month");
                      setSelectedLesson(null);
                    }}
                    className={`px-4 py-1.5 rounded-full font-label-md text-label-md transition-colors ${
                      !isWeekMode ? "bg-primary text-on-primary" : "text-on-surface-variant"
                    }`}
                  >
                    Месяц
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => (isWeekMode ? goToWeek(-1) : goToMonth(-1))}
                    className="p-2 hover:bg-surface-container rounded-lg transition-colors border border-outline-variant"
                    aria-label={isWeekMode ? "Предыдущая неделя" : "Предыдущий месяц"}
                  >
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  <button
                    onClick={() => (isWeekMode ? goToWeek(1) : goToMonth(1))}
                    className="p-2 hover:bg-surface-container rounded-lg transition-colors border border-outline-variant"
                    aria-label={isWeekMode ? "Следующая неделя" : "Следующий месяц"}
                  >
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>

            {isWeekMode && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4 font-label-md text-[12px] text-on-surface-variant">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" /> О — очно
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" /> Д — дистант
                </span>
                <span>И — индивидуально</span>
                <span>Г — группа</span>
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
                {error}
              </div>
            )}

            {!isWeekMode && (
            <>
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
            </>
            )}

            {isWeekMode && (
              <WeekGrid
                weekDays={currentWeek}
                weekTimes={weekTimes}
                lessonsByDay={lessonsByDay}
                todayDay={todayDay}
                lessonShortInfo={lessonShortInfo}
                selectedLesson={selectedLesson}
                onSelectLesson={(l) => {
                  setSelectedLesson(l);
                  scrollToDetailsOnMobile();
                }}
              />
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div ref={detailPanelRef} className="lg:col-span-3 scroll-mt-24">
          <div className="sticky top-24 space-y-stack-lg">
            {(selectedDay || selectedLesson) && (
              <button
                type="button"
                onClick={scrollToScheduleOnMobile}
                className="lg:hidden w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full border border-outline-variant bg-surface-container-lowest text-on-surface-variant font-label-md text-label-md hover:bg-surface-container transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                Назад к расписанию
              </button>
            )}
            {(isWeekMode ? !selectedLesson : !selectedDay) || selectedLessons.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-xl shadow-xl overflow-hidden border border-outline-variant border-t-8 border-primary">
                <div className="p-6 flex flex-col items-center text-center">
                  <span className="material-symbols-outlined text-4xl mb-2 text-outline">event_busy</span>
                  <p className="font-body-md text-on-surface-variant">
                    {isWeekMode
                      ? "Выберите занятие в расписании, чтобы увидеть детали"
                      : selectedDay
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
                    data-lesson-id={lesson.id}
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


    </DashboardShell>
  );
}
