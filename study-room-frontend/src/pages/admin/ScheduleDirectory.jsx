import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import EditLessonModal from "../../components/lessons/EditLessonModal.jsx";
import BulkCreateLessonsModal from "../../components/lessons/BulkCreateLessonsModal.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchLessons, fetchCourses } from "../../api/academic.js";
import { fetchMyPeople, fetchBranches, fetchUserById } from "../../api/users.js";
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

// Переводит "HH:MM" или "HH:MM:SS" в минуты от начала суток. Возвращает
// null для пустого/некорректного значения — такие занятия просто
// исключаются из расчёта пересечений (см. computeRoomOverlaps ниже).
function timeToMinutes(value) {
  if (!value) return null;
  const [h, m] = String(value).split(":");
  const hh = Number(h);
  const mm = Number(m);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}
function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad(h)}:${pad(m)}`;
}

// Реальная нагрузка на аудитории филиала за день: сколько ОЧНЫХ
// (location_type === "onsite") и не отменённых занятий идут ОДНОВРЕМЕННО —
// то есть их временные интервалы пересекаются, — а не просто общее число
// очных занятий за день. Раньше бейдж "Занято N" в календаре складывал все
// очные занятия дня, даже если они шли друг за другом в разное время (например,
// 9:00-10:00 и 15:00-16:00), из-за чего нагрузка на кабинеты филиала выглядела
// завышенной, хотя реального конфликта по аудиториям не было.
//
// Считаем отдельно по каждому филиалу (branch_id занятия): два очных занятия
// в РАЗНЫХ филиалах в одно и то же время друг другу не мешают и не должны
// суммироваться в один счётчик.
//
// Возвращает отсортированные по времени начала непересекающиеся отрезки
// {start, end, count} (в минутах от полуночи), где count — сколько очных
// занятий идёт одновременно в этом отрезке. В результат попадают только
// отрезки с count >= 2 (когда фактически два и более занятия делят
// аудитории в одно время) — если очное занятие в дне одно, показывать
// "нагрузку" незачем.
function computeRoomOverlaps(dayLessons) {
  const byBranch = new Map();
  dayLessons
    .filter((l) => l.location_type === "onsite" && l.status !== "cancelled")
    .forEach((l) => {
      const start = timeToMinutes(l.start_time);
      const end = timeToMinutes(l.end_time);
      if (start === null || end === null || end <= start) return;
      const key = l.branch_id ?? "unknown";
      if (!byBranch.has(key)) byBranch.set(key, []);
      byBranch.get(key).push({ start, end });
    });

  const segments = [];
  byBranch.forEach((intervals) => {
    if (intervals.length < 2) return;
    // Классический sweep-line: берём все уникальные границы интервалов,
    // на каждом получившемся под-отрезке между двумя соседними границами
    // подсчёт занятий, покрывающих этот под-отрезок целиком, постоянен.
    const points = [...new Set(intervals.flatMap((iv) => [iv.start, iv.end]))].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const segStart = points[i];
      const segEnd = points[i + 1];
      if (segEnd <= segStart) continue;
      const count = intervals.filter((iv) => iv.start <= segStart && iv.end >= segEnd).length;
      if (count >= 2) segments.push({ start: segStart, end: segEnd, count });
    }
  });
  segments.sort((a, b) => a.start - b.start);

  // Склеиваем соседние отрезки с одинаковой нагрузкой в один — например,
  // 10:00-10:30 и 10:30-11:00 с одинаковым count=2 по сути одно и то же
  // "окно" пересечения, показывать его двумя отдельными бейджами не нужно.
  const merged = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.count === seg.count && last.end === seg.start) {
      last.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function weekBadgeClasses(kind, value) {
  if (kind === "location") {
    return value === "О" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700";
  }
  return "bg-surface-container text-on-surface-variant";
}

// Занятие считается "проблемным" (нет преподавателя или расхождение по
// договору) — та же логика, что уже подсвечивает дни красным в месячном
// виде (см. hasProblem/dayStateClass ниже). В недельном виде подсвечиваем
// так же, но каждое занятие по отдельности, а не весь день целиком.
function isLessonProblem(lesson) {
  return Boolean(lesson.contract_issue || !lesson.tutor_id);
}

// WeekLessonChip — карточка занятия внутри ячейки недельной сетки (десктоп).
// Специально БЕЗ имени ученика — только предмет, класс(ы) и бейджи
// И/Г, О/Д. Имя появляется в панели деталей справа после клика (см.
// selectedLesson/onSelectLesson в ScheduleDirectory). Цвет карточки —
// синий (обычное занятие) или красный (проблемное), как и в месячной сетке.
function WeekLessonChip({ info, problem, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border px-2 py-1.5 mb-1.5 last:mb-0 transition-colors ${
        selected
          ? "border-primary bg-primary-container/40"
          : problem
            ? "bg-error-container/60 border-error/50 hover:brightness-95"
            : "bg-primary-container/60 border-primary/40 hover:brightness-95"
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
 * Недельный вид расписания (owner/branch_owner). Десктоп — сетка "время x
 * день", как в исходной таблице-первоисточнике (время слева, дни сверху,
 * несколько занятий в ячейке — стопкой). Мобильный — вкладки дней недели
 * сверху и вертикальный список занятий выбранного дня, время видно сразу
 * (как и просили — "как на ПК"), а имя ученика — только после клика по
 * занятию (открывает ту же панель деталей, что и десктоп).
 *
 * Дни, не входящие в текущий месяц (края первой/последней недели), в
 * weekDays приходят как null — просто показываем пустую колонку без даты.
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
      {/* Мобильный вид */}
      <div className="sm:hidden">
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
              const problem = isLessonProblem(l);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onSelectLesson(l)}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                    isSelected
                      ? "border-primary bg-primary-container/40"
                      : problem
                        ? "bg-error-container/60 border-error/50"
                        : "bg-primary-container/60 border-primary/40"
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

      {/* Десктопный вид: время x день, как в исходной таблице */}
      <div className="hidden sm:block overflow-x-auto">
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
                              problem={isLessonProblem(l)}
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

/**
 * Общий раздел "Расписание" для двух ролей:
 * - owner (раздел /admin/schedule): видит занятия по всей сети, доступны фильтры
 *   по филиалу, преподавателю и ученику.
 * - branch_owner (раздел /branch/schedule): видит занятия только своего филиала
 *   (сервер сам ограничивает выборку по branch_id из JWT — см. 2.7 в api-contracts.md),
 *   фильтра по филиалу нет, но остаются фильтры по преподавателю и ученику.
 *
 * Вид календаря — тот же, что и на странице родителя (ParentSchedule): месяц-сетка
 * слева, клик по дню показывает подробности справа.
 */
export default function ScheduleDirectory({ role }) {
  const isOwner = role === "owner";
  const { user } = useAuth();
  const navigate = useNavigate();

  const tutorDetailPath = (id) => (isOwner ? `/admin/teachers/${id}` : `/branch/teachers/${id}`);
  const studentDetailPath = (id) => (isOwner ? `/admin/students/${id}` : `/branch/students/${id}`);

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-based

  const [branches, setBranches] = useState([]);
  const [branchFilter, setBranchFilter] = useState(""); // только owner
  const [tutorFilter, setTutorFilter] = useState("");
  const [studentFilter, setStudentFilter] = useState("");

  const [people, setPeople] = useState({ students: [], tutors: [] });
  const [peopleLoading, setPeopleLoading] = useState(true);

  const [lessons, setLessons] = useState([]);
  const [courses, setCourses] = useState([]);
  const [tutorsById, setTutorsById] = useState({});
  const [extraStudentsById, setExtraStudentsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState(null); // day number in current month, or null
  const [detailPage, setDetailPage] = useState(0); // пагинация занятий выбранного дня
  const LESSONS_PAGE_SIZE = 2;

  // viewMode — переключатель "Месяц"/"Неделя" (см. кнопки в шапке ниже).
  // Только для owner/branch_owner (эта страница им и так ограничена — см.
  // AdminSchedule.jsx/BranchSchedule.jsx); у tutor/student/parent — свои
  // отдельные компоненты расписания, их этот переключатель не касается.
  const [viewMode, setViewMode] = useState("week");
  // weekIndex — индекс строки календарной сетки месяца (см. monthWeeks
  // ниже), которая сейчас показана как "неделя". Недель получается 4-6 в
  // зависимости от того, на какой день недели падает 1-е число и сколько
  // дней в месяце — само распределяется, отдельно хардкодить 4/5 не нужно.
  const [weekIndex, setWeekIndex] = useState(0);
  // selectedLesson — выбранное занятие в недельном виде (клик по карточке
  // занятия в ячейке недели). В отличие от месячного вида, где кликают на
  // весь день (см. selectedDay) и видят все его занятия списком, в
  // недельном виде каждая ячейка уже содержит одно конкретное занятие —
  // имя ученика в самой ячейке не показывается (см. WeekLessonChip ниже),
  // оно появляется только в этой подробной карточке после клика.
  const [selectedLesson, setSelectedLesson] = useState(null);
  const detailPanelRef = useRef(null);
  const [expandedMonthDays, setExpandedMonthDays] = useState(() => new Set());
  // Флаг для goToWeek(-1): при переходе на предыдущий месяц нужно встать
  // на его ПОСЛЕДНЮЮ неделю, а эффект ниже по умолчанию поставил бы первую
  // (или неделю с сегодняшним днём) — флаг просит эффект пропустить один раз
  // свой авто-сброс, чтобы не затереть explicit-значение из goToWeek.
  const skipWeekAutoResetRef = useRef(false);

  // Занятие, которое сейчас редактируется (owner — любое, branch_owner — только
  // своего филиала; но список lessons уже отфильтрован сервером по этой области,
  // так что доступные для открытия модалки занятия и так ограничены правами).
  const [editingLesson, setEditingLesson] = useState(null);
  const [bulkCreateOpen, setBulkCreateOpen] = useState(false);

  // При PATCH обновляем занятие локально, не дожидаясь перезагрузки месяца —
  // отзывчивее для пользователя.
  //
  // ВАЖНО: помимо списка lessons, нужно синхронизировать и selectedLesson —
  // отдельное состояние, которое хранит недельный вид (см. WeekGrid/
  // detailLessons выше) для карточки занятия в правой панели. Модалка
  // редактирования открывается из этой самой карточки (кнопка
  // "Редактировать" внутри detailLessons), поэтому lesson, который сейчас
  // редактируют/удаляют, почти всегда совпадает с selectedLesson.
  //
  // Раньше эти хендлеры трогали только `lessons`, а selectedLesson оставался
  // прежним объектом. В месячном виде это было незаметно, потому что
  // detailLessons там берётся заново из lessonsByDay[selectedDay] (то есть
  // из актуального `lessons`). А в недельном виде detailLessons — это ровно
  // `[selectedLesson]`, так что после удаления занятия карточка с ним
  // никуда не девалась: занятие пропадало из сетки недели, но "призрак"
  // старой карточки с кнопкой "Редактировать" оставался в панели справа.
  // Повторное открытие такой карточки открывало модалку с уже
  // несуществующим (или уже гружёным как cancelled) занятием, и следующее
  // нажатие "Удалить"/"Отменить"/"Сохранить" падало с ошибкой
  // "занятие не найдено" — выглядело так, будто удаление занятий не работает.
  function handleLessonSaved(updated) {
    setLessons((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
    setSelectedLesson((prev) => (prev && updated?.id === prev.id ? { ...prev, ...updated } : prev));
  }
  function handleLessonCancelled(lessonId) {
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, status: "cancelled" } : l)));
    setSelectedLesson((prev) => (prev && prev.id === lessonId ? { ...prev, status: "cancelled" } : prev));
  }
  function selectLesson(lesson) {
    setSelectedLesson(lesson);
    setDetailPage(0);
  }

  function scrollToDetailsOnMobile() {
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 1023px)").matches) return;
    requestAnimationFrame(() => {
      detailPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function handleMobileLessonClick(lesson, event) {
    event?.stopPropagation();
    setSelectedDay(Number(String(lesson.lesson_date ?? "").slice(8, 10)) || null);
    selectLesson(lesson);
    scrollToDetailsOnMobile();
  }

  function handleLessonDeleted(lessonId) {
    setLessons((prev) => prev.filter((l) => l.id !== lessonId));
    setEditingLesson(null);
    setSelectedLesson((prev) => (prev && prev.id === lessonId ? null : prev));
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // 0 = Monday

  // Варианты для фильтра "выбрать конкретный месяц" — год назад / год вперёд
  // от текущего года, плюс сам текущий год. Этого достаточно для выбора
  // произвольного месяца одним кликом, не листая стрелками.
  const monthOptions = useMemo(() => {
    const options = [];
    const baseYear = today.getFullYear();
    for (let y = baseYear - 1; y <= baseYear + 1; y++) {
      for (let m = 0; m < 12; m++) {
        options.push({ year: y, month: m });
      }
    }
    return options;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectMonth(year, month) {
    setSelectedDay(null);
    setSelectedLesson(null);
    setViewYear(year);
    setViewMonth(month);
  }

  // Список филиалов — нужен только owner, для фильтра.
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    fetchBranches()
      .then((res) => {
        if (!cancelled) setBranches(res?.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  // Списки учеников и преподавателей для выпадающих фильтров.
  // Для owner ограничиваем выбранным филиалом (если он выбран), для branch_owner
  // сервер сам возвращает только людей его филиала.
  useEffect(() => {
    let cancelled = false;
    async function loadPeople() {
      setPeopleLoading(true);
      try {
        const params = isOwner && branchFilter ? { branch_id: Number(branchFilter) } : {};
        const res = await fetchMyPeople(params);
        if (cancelled) return;
        const activeTutors = (res?.tutors ?? []).filter((t) => t && t.is_active === true);
        setPeople({ students: res?.students ?? [], tutors: activeTutors });
        // Если ранее выбранный преподаватель/ученик больше не входит в список
        // (например, сменили филиал или преподавателя уволили), сбрасываем фильтр.
        setTutorFilter((prev) => (prev && !activeTutors.some((t) => String(t.id) === String(prev)) ? "" : prev));
        setStudentFilter((prev) => (prev && !(res?.students ?? []).some((s) => String(s.id) === String(prev)) ? "" : prev));
      } catch {
        if (!cancelled) setPeople({ students: [], tutors: [] });
      } finally {
        if (!cancelled) setPeopleLoading(false);
      }
    }
    loadPeople();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, branchFilter]);

  // requestIdRef — защита от гонки ответов (аналог прежнего локального
  // флага `cancelled`, но переживающего вынос load() в переиспользуемый
  // useCallback, который дёргается и из обычного эффекта, и из подписки
  // на инвалидацию кэша).
  const requestIdRef = useRef(0);

  // Загружаем расписание за текущий месяц с учётом активных фильтров.
  //
  // silent=true используется при фоновом перезапросе из-за invalidateQuery
  // (см. подписку ниже) — тогда НЕ трогаем loading/selectedDay/detailPage,
  // чтобы не сбрасывать уже открытую пользователем панель дня и не мигать
  // спиннером поверх уже показанных данных.
  const load = useCallback(
    async ({ silent = false } = {}) => {
      const requestId = ++requestIdRef.current;
      if (!silent) setLoading(true);
      setError("");
      try {
        const date_from = toISODate(viewYear, viewMonth, 1);
        const date_to = toISODate(viewYear, viewMonth, daysInMonth);

        const [lessonsRes, coursesRes] = await Promise.all([
          fetchLessons({
            tutor_id: tutorFilter ? Number(tutorFilter) : undefined,
            student_id: studentFilter ? Number(studentFilter) : undefined,
            branch_id: isOwner && branchFilter ? Number(branchFilter) : undefined,
            date_from,
            date_to,
          }),
          fetchCourses(),
        ]);
        if (requestId !== requestIdRef.current) return;

        const lessonItems = lessonsRes?.items ?? [];
        setLessons(lessonItems);
        setCourses(coursesRes?.items ?? []);
        if (!silent) {
          setSelectedDay(null);
          setDetailPage(0);
        }

        // Подтягиваем имена репетиторов — сперва из уже загруженного списка людей,
        // недостающих (например, если фильтр по филиалу не совпадает) — по одному.
        const uniqueTutorIds = [...new Set(lessonItems.map((l) => l.tutor_id).filter(Boolean))];
        const knownTutorsById = {};
        people.tutors.forEach((t) => (knownTutorsById[t.id] = t));
        const missingTutorIds = uniqueTutorIds.filter((id) => !knownTutorsById[id]);

        // Ученики каждого занятия — из participant_ids, которые отдаёт API вместе
        // с занятием (снимок реальных участников на момент создания занятия, см.
        // lesson_participants на бэкенде). Раньше здесь пытались вычислить участников
        // через enrollments с тем же course_id+tutor_id, но это пропускало учеников,
        // записанных на курс без личного tutor_id (см. тот же нюанс в TeacherDetail.jsx).
        const knownStudentsById = {};
        people.students.forEach((s) => (knownStudentsById[s.id] = s));
        const lessonStudentIds = new Set();
        lessonItems.forEach((l) => {
          (l.participant_ids ?? []).forEach((id) => lessonStudentIds.add(id));
        });
        const missingStudentIds = [...lessonStudentIds].filter((id) => !knownStudentsById[id]);

        const [fetchedTutors, fetchedStudents] = await Promise.all([
          Promise.all(missingTutorIds.map((id) => fetchUserById(id).catch(() => null))),
          Promise.all(missingStudentIds.map((id) => fetchUserById(id).catch(() => null))),
        ]);
        if (requestId !== requestIdRef.current) return;
        const tutorMap = { ...knownTutorsById };
        fetchedTutors.forEach((t, i) => {
          if (t) tutorMap[missingTutorIds[i]] = t;
        });
        setTutorsById(tutorMap);

        const studentMap = {};
        fetchedStudents.forEach((s, i) => {
          if (s) studentMap[missingStudentIds[i]] = s;
        });
        setExtraStudentsById(studentMap);
      } catch (e) {
        if (requestId === requestIdRef.current) setError(e.message || "Не удалось загрузить расписание");
      } finally {
        if (requestId === requestIdRef.current && !silent) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewYear, viewMonth, daysInMonth, tutorFilter, studentFilter, branchFilter, isOwner]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Раньше отмена/изменение занятия отражались в этом списке только через
  // ручные локальные патчи (handleLessonSaved/handleLessonCancelled ниже) —
  // если занятие менялось откуда-то ещё (например, тьютор отменил его на
  // своей странице расписания в соседней вкладке), здесь это не было видно
  // без F5. Теперь подписываемся на тот же кэш-ключ, которым fetchLessons(...)
  // пользуется внутри cachedQuery, и тихо перезапрашиваем при invalidateQuery(["lessons"]).
  useEffect(() => {
    const date_from = toISODate(viewYear, viewMonth, 1);
    const date_to = toISODate(viewYear, viewMonth, daysInMonth);
    const key = [
      "lessons",
      {
        tutor_id: tutorFilter ? Number(tutorFilter) : undefined,
        student_id: studentFilter ? Number(studentFilter) : undefined,
        branch_id: isOwner && branchFilter ? Number(branchFilter) : undefined,
        date_from,
        date_to,
      },
    ];
    const unsubscribe = subscribeQuery(key, (reason) => {
      if (reason === "invalidate") load({ silent: true });
    });
    return unsubscribe;
  }, [viewYear, viewMonth, daysInMonth, tutorFilter, studentFilter, branchFilter, isOwner, load]);

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

  const studentsById = useMemo(() => {
    const map = { ...extraStudentsById };
    people.students.forEach((s) => (map[s.id] = s));
    return map;
  }, [people.students, extraStudentsById]);

  // Ученики, у которых сейчас конкретное занятие — берём напрямую из
  // participant_ids занятия (реальные участники, а не вычисленные по enrollments).
  // Если профиль ученика недоступен во fetched-справочниках (напр. поменял
  // филиал и выпал из выборки, а fetchUserById по каким-то причинам не смог
  // его вернуть) — раньше такой ученик тихо пропадал из списка (.filter(Boolean)),
  // занятие выглядело так, будто у него меньше участников, чем есть на самом
  // деле. Теперь для нерезолвленных id подставляем ФИО из l.participant_names —
  // снапшот имён с бэкенда специально для этого случая (см. Lesson.ParticipantNames
  // в academic-service/internal/models/models.go) — и только если даже его нет,
  // показываем "Ученик #id" как последний фолбэк.
  const studentsForLesson = useMemo(() => {
    const map = {}; // lesson.id -> [student, ...]
    lessons.forEach((l) => {
      const ids = [...new Set(l.participant_ids ?? [])];
      map[l.id] = ids.map((id) => {
        if (studentsById[id]) return studentsById[id];
        const fallbackName = l.participant_names?.[id] ?? `Ученик #${id}`;
        return { id, first_name: fallbackName, last_name: "", _isFallback: true };
      });
    });
    return map;
  }, [lessons, studentsById]);

  const lessonsByDay = useMemo(() => {
    const map = {};
    for (const lesson of lessons) {
      const day = Number(lesson.lesson_date?.slice(8, 10));
      if (!day) continue;
      (map[day] ??= []).push(lesson);
    }
    // Сортируем занятия каждого дня по времени начала (раньше -> позже) —
    // и в мини-карточках месячного вида, и в недельной сетке (там порядок
    // внутри одной ячейки времени не важен, но остальным местам, где
    // используется этот же map, порядок нужен).
    Object.values(map).forEach((dayLessons) => {
      dayLessons.sort((a, b) => String(a.start_time ?? "").localeCompare(String(b.start_time ?? "")));
    });
    return map;
  }, [lessons]);

  const isCurrentMonthView = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  const todayDay = isCurrentMonthView ? today.getDate() : null;

  // monthWeeks — строки той же сетки, что рисует месячный календарь: каждая
  // строка — 7 ячеек (Пн..Вс), где значение — число месяца либо null для
  // дней соседнего месяца (те же "пустые" ячейки, что и в сетке месяца).
  // Недельный вид — это одна такая строка, показанная подробно (по времени),
  // поэтому количество недель само получается 4/5/6 в зависимости от того,
  // на какой день недели пришлось 1-е число и сколько дней в месяце —
  // отдельно хардкодить не нужно.
  const monthWeeks = useMemo(() => {
    const totalCells = firstWeekday + daysInMonth;
    const rowCount = Math.ceil(totalCells / 7);
    const weeks = [];
    for (let r = 0; r < rowCount; r++) {
      const week = [];
      for (let c = 0; c < 7; c++) {
        const day = r * 7 + c - firstWeekday + 1;
        week.push(day >= 1 && day <= daysInMonth ? day : null);
      }
      weeks.push(week);
    }
    return weeks;
  }, [firstWeekday, daysInMonth]);

  // При смене месяца выставляем неделю, которая содержит сегодняшний день
  // (если смотрим текущий месяц), иначе — первую неделю месяца.
  useEffect(() => {
    setSelectedLesson(null);
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

  function goToMonth(offset) {
    setSelectedDay(null);
    setSelectedLesson(null);
    setExpandedMonthDays(new Set());
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

  // Переключение недель внутри месяца. На границах месяца (первая/последняя
  // неделя) переходим в соседний месяц и встаём на его первую/последнюю
  // неделю — так пролистывание недель работает бесшовно, а не упирается в
  // границу месяца.
  function goToWeek(offset) {
    // Переключение недели меняет высоту контента (разное число занятий/
    // строк-времени на разных неделях), и если новая неделя короче текущей
    // прокрутки страницы, браузер сам подтягивает scroll наверх — визуально
    // это выглядит как "перекинуло страницу". Запоминаем текущую позицию
    // и восстанавливаем её сразу после того, как React применит обновление
    // DOM (requestAnimationFrame гарантированно срабатывает уже после
    // коммита, но до следующей отрисовки — скачка не видно).
    const scrollY = window.scrollY;
    setSelectedLesson(null);
    const next = weekIndex + offset;
    if (next < 0) {
      skipWeekAutoResetRef.current = true;
      goToMonth(-1);
      // Хотим встать на ПОСЛЕДНЮЮ неделю предыдущего месяца — считаем её
      // отдельно, зная, каким будет предыдущий месяц.
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
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
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
  // Список занятий для панели деталей справа: в месячном виде — все
  // занятия выбранного дня (как раньше), в недельном — ровно одно кликнутое
  // занятие (см. selectedLesson) — там имя ученика видно только тут.
  const detailLessons = isWeekMode
    ? selectedLesson
      ? [selectedLesson]
      : []
    : selectedLesson
      ? [selectedLesson]
      : selectedDay
        ? lessonsByDay[selectedDay] ?? []
        : [];
  const detailPageCount = Math.max(1, Math.ceil(detailLessons.length / LESSONS_PAGE_SIZE));
  const safeDetailPage = Math.min(detailPage, detailPageCount - 1);
  const paginatedLessons = detailLessons.slice(
    safeDetailPage * LESSONS_PAGE_SIZE,
    safeDetailPage * LESSONS_PAGE_SIZE + LESSONS_PAGE_SIZE
  );

  function lessonShortInfo(lesson) {
    const course = coursesById[lesson.course_id];
    const students = studentsForLesson[lesson.id] ?? [];
    const classes = [...new Set(students.map((s) => s.class_info).filter(Boolean).map((c) => {
      const value = String(c).trim();
      return /^\d+$/.test(value) ? `${value}кл` : value;
    }))];
    const subject = course?.subject || course?.title || lesson.topic || "Занятие";
    const format = lesson.group_type === "individual" ? "И" : "Г";
    const location = lesson.location_type === "onsite" ? "О" : "Д";
    return { subject, classes, format, location };
  }

  return (
    <DashboardShell
      fullWidth
      role={isOwner ? "admin" : "branch_owner"}
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск по расписанию..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="mt-4 mb-2">
        <h2 className="font-headline-md text-headline-md text-on-background mb-1">Расписание</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">
          {isOwner ? "Занятия по всей сети филиалов" : "Занятия вашего филиала"}, с фильтрами по{" "}
          {isOwner ? "филиалу, " : ""}преподавателю и ученику.
        </p>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative">
          <select
            value={`${viewYear}-${viewMonth}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              selectMonth(y, m);
            }}
            className="appearance-none bg-surface-container-lowest border border-outline-variant rounded-lg pl-4 pr-9 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          >
            {monthOptions.map(({ year, month }) => (
              <option key={`${year}-${month}`} value={`${year}-${month}`}>
                {MONTH_NAMES[month]} {year}
              </option>
            ))}
          </select>
        </div>

        {isOwner && (
          <div className="relative">
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="appearance-none bg-surface-container-lowest border border-outline-variant rounded-lg pl-4 pr-9 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            >
              <option value="">Все филиалы</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || b.city}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="relative">
          <select
            value={tutorFilter}
            onChange={(e) => setTutorFilter(e.target.value)}
            disabled={peopleLoading}
            className="appearance-none bg-surface-container-lowest border border-outline-variant rounded-lg pl-4 pr-9 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none disabled:opacity-60"
          >
            <option value="">Все преподаватели</option>
            {people.tutors.map((t) => (
              <option key={t.id} value={t.id}>
                {fullName(t)}
              </option>
            ))}
          </select>
        </div>

        <div className="relative">
          <select
            value={studentFilter}
            onChange={(e) => setStudentFilter(e.target.value)}
            disabled={peopleLoading}
            className="appearance-none bg-surface-container-lowest border border-outline-variant rounded-lg pl-4 pr-9 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none disabled:opacity-60"
          >
            <option value="">Все ученики</option>
            {people.students.map((s) => (
              <option key={s.id} value={s.id}>
                {fullName(s)}
              </option>
            ))}
          </select>
        </div>

        {(branchFilter || tutorFilter || studentFilter) && (
          <button
            onClick={() => {
              setBranchFilter("");
              setTutorFilter("");
              setStudentFilter("");
            }}
            className="px-4 py-2 rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high transition-colors border border-outline-variant"
          >
            Сбросить фильтры
          </button>
        )}
      </div>

      <div className="flex justify-end mb-4">
        <button
          type="button"
          onClick={() => setBulkCreateOpen(true)}
          className="group w-full sm:w-auto inline-flex items-center justify-center gap-2.5 pl-3.5 pr-5 py-2.5 rounded-full bg-primary text-on-primary font-label-md text-label-md shadow-sm hover:shadow-md hover:bg-on-primary-fixed-variant active:scale-[0.98] transition-all duration-150"
        >
          <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0 group-hover:rotate-90 transition-transform duration-200">
            <span className="material-symbols-outlined text-[16px]">add</span>
          </span>
          Быстро создать занятия на месяц
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-stack-lg">
        {/* Calendar */}
        <div className="lg:col-span-9 space-y-stack-lg">
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-on-surface">
                  {isWeekMode ? `Неделя ${weekIndex + 1} из ${monthWeeks.length}` : `${MONTH_NAMES[viewMonth]} ${viewYear}`}
                </h3>
                <p className="font-body-md text-body-md text-on-surface-variant">
                  {loading
                    ? "Загрузка занятий…"
                    : isWeekMode
                      ? `${MONTH_NAMES[viewMonth]} ${viewYear}`
                      : `${lessons.length} занятий в этом месяце`}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Переключатель Неделя/Месяц — только владельцу и владельцу
                    филиала; у преподавателя/ученика — прежнее расписание.
                    По умолчанию открывается текущая неделя (см. viewMode),
                    отсюда можно переключиться на месяц. */}
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
            <div className="pb-1">
            <div className="sm:hidden space-y-2">
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayLessons = lessonsByDay[day] ?? [];
                const isToday = day === todayDay;
                const isSelected = day === selectedDay;
                const isExpanded = expandedMonthDays.has(day);
                const hasProblem = dayLessons.some((l) => l.contract_issue || !l.tutor_id);
                const roomOverlaps = computeRoomOverlaps(dayLessons);
                const peakOverlap = roomOverlaps.reduce(
                  (max, seg) => (!max || seg.count > max.count ? seg : max),
                  null
                );
                const dayStateClass = hasProblem
                  ? "bg-error-container/60 border-error/50"
                  : dayLessons.length
                    ? "bg-primary-container/60 border-primary/40"
                    : "bg-surface-container border-outline-variant/40";

                return (
                  <button
                    key={`mobile-day-${day}`}
                    onClick={() => { setSelectedDay(day); setSelectedLesson(null); setDetailPage(0); }}
                    className={`w-full text-left p-3 rounded-xl border ${dayStateClass} ${isSelected ? "ring-2 ring-primary ring-offset-1" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base font-bold text-on-surface shrink-0">{day}</span>
                        <span className="text-sm font-semibold text-on-surface-variant shrink-0">{WEEKDAYS[(firstWeekday + day - 1) % 7]}</span>
                        {isToday && (
                          <span className="bg-primary text-on-primary text-[10px] px-2 py-0.5 rounded-full font-bold uppercase shrink-0">Сегодня</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {peakOverlap && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-white/80 text-on-surface text-[10px] font-bold leading-none border border-outline-variant/40"
                            title={`Одновременно ${peakOverlap.count} очных занятия в филиале, в ${minutesToHHMM(peakOverlap.start)}`}
                          >
                            <span className="material-symbols-outlined text-[11px]">meeting_room</span>
                            {peakOverlap.count} в {minutesToHHMM(peakOverlap.start)}
                          </span>
                        )}
                        {dayLessons.length > 0 && (
                          <span className="text-xs font-bold text-on-surface-variant">{dayLessons.length} {dayLessons.length === 1 ? "занятие" : dayLessons.length < 5 ? "занятия" : "занятий"}</span>
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
                              role="button"
                              tabIndex={0}
                              onClick={(event) => handleMobileLessonClick(l, event)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") handleMobileLessonClick(l, event);
                              }}
                              className={`rounded-lg bg-white/80 text-on-surface px-3 py-2 cursor-pointer hover:bg-white transition-colors ${selectedLesson?.id === l.id ? "ring-2 ring-primary" : ""}`}
                            >
                              <div className="text-sm font-bold leading-snug break-words">{info.subject}</div>
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs font-semibold text-on-surface-variant">
                                <span>{l.start_time?.slice(0, 5) || "—"}{l.end_time ? `–${l.end_time.slice(0, 5)}` : ""}</span>
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
                              setExpandedMonthDays((prev) => {
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
                                setExpandedMonthDays((prev) => {
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

            <div className="hidden sm:grid sm:grid-cols-7 text-center mb-4 border-b border-outline-variant/30 pb-2">
              {WEEKDAYS.map((d) => (
                <div key={d} className="font-label-md text-label-md text-outline">
                  {d}
                </div>
              ))}
            </div>

            <div className="hidden sm:grid sm:grid-cols-7 gap-1.5">
              {Array.from({ length: firstWeekday }).map((_, i) => (
                <div key={`pad-${i}`} className="h-20 sm:h-24" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayLessons = lessonsByDay[day] ?? [];
                const isToday = day === todayDay;
                const isSelected = day === selectedDay;
                const isExpanded = expandedMonthDays.has(day);
                const hasProblem = dayLessons.some((l) => l.contract_issue || !l.tutor_id);
                const hasLessons = dayLessons.length > 0;
                // Пересечения очных занятий этого дня по времени (см.
                // computeRoomOverlaps) — сколько занятий реально делят
                // аудитории филиала ОДНОВРЕМЕННО, а не просто сумма очных
                // занятий за весь день.
                const roomOverlaps = computeRoomOverlaps(dayLessons);
                const peakOverlap = roomOverlaps.reduce(
                  (max, seg) => (!max || seg.count > max.count ? seg : max),
                  null
                );
                const dayStateClass = hasLessons
                  ? hasProblem
                    ? "bg-error-container text-on-error-container border-error"
                    : "bg-primary-container text-on-primary-container border-primary"
                  : "text-on-surface-variant bg-surface-container border-outline-variant/40 hover:bg-surface-container-high hover:border-outline-variant";

                return (
                  <button
                    key={day}
                    onClick={() => { setSelectedDay(day); setSelectedLesson(null); setDetailPage(0); }}
                    className={`text-left min-h-24 sm:min-h-28 p-2 rounded-xl font-label-md transition-all duration-150 relative border flex flex-col ${dayStateClass} ${isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-surface-container-lowest scale-[1.03] z-10 shadow-lg" : hasLessons ? "shadow-sm hover:shadow-md hover:brightness-[1.03]" : ""} ${isToday ? "ring-2 ring-primary/50 ring-inset" : ""}`}
                  >
                    {isToday && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary text-on-primary text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter z-20 shadow-sm">
                        Сегодня
                      </span>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[13px]">{day}</span>
                      {peakOverlap && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-white/70 text-on-surface text-[8px] sm:text-[9px] font-bold leading-none"
                          title={`Одновременно ${peakOverlap.count} очных занятия в филиале, в ${minutesToHHMM(peakOverlap.start)}${roomOverlaps.length > 1 ? " (и в другое время тоже есть пересечения)" : ""}`}
                        >
                          <span className="material-symbols-outlined text-[10px] sm:text-[11px]">meeting_room</span>
                          {peakOverlap.count} в {minutesToHHMM(peakOverlap.start)}
                          {roomOverlaps.length > 1 && ` +${roomOverlaps.length - 1}`}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 space-y-1 overflow-hidden flex-1">
                      {(isExpanded ? dayLessons : dayLessons.slice(0, 3)).map((l) => {
                        const info = lessonShortInfo(l);
                        return (
                          <div key={l.id} className="rounded-md bg-white/80 text-on-surface px-1.5 py-1 text-[9px] sm:text-[10px] leading-tight shadow-[0_1px_1px_rgba(0,0,0,0.04)] flex items-start gap-1">
                            <span className="shrink-0 text-[8px] sm:text-[9px] font-semibold opacity-70 pt-px">
                              {l.start_time?.slice(0, 5) || "—"}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="font-bold truncate">{info.subject}</div>
                              <div className="flex flex-wrap gap-x-1.5 gap-y-0.5 font-semibold opacity-80">
                                {info.classes.length > 0 && <span>{info.classes.join(", ")}</span>}
                                <span>{info.format}</span><span>{info.location}</span>
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
                            setExpandedMonthDays((prev) => {
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
                              setExpandedMonthDays((prev) => {
                                const next = new Set(prev);
                                if (next.has(day)) next.delete(day);
                                else next.add(day);
                                return next;
                              });
                            }
                          }}
                          className="text-[9px] font-bold text-center rounded-md bg-white/50 py-0.5 cursor-pointer hover:bg-white/70"
                        >
                          {isExpanded ? "Свернуть" : `+${dayLessons.length - 3} ещё`}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            </div>
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
                  selectLesson(l);
                  scrollToDetailsOnMobile();
                }}
              />
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div ref={detailPanelRef} className="lg:col-span-3 scroll-mt-24">
          <div className="sticky top-24 space-y-stack-lg">
            {detailLessons.length === 0 ? (
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
              <>
              {paginatedLessons.map((lesson) => {
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
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <StatusBadge status={isCancelled ? "Отменено" : isDone ? "Выполнено" : "Ожидание"} />
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

                      <div className="space-y-4">
                        {tutor && (
                          <button
                            type="button"
                            onClick={() => navigate(tutorDetailPath(tutor.id))}
                            className="w-full flex items-center gap-4 p-3 bg-surface-container rounded-lg hover:bg-surface-container-high transition-colors text-left"
                          >
                            <div className="w-12 h-12 rounded-full bg-primary-fixed flex items-center justify-center font-bold text-primary shrink-0">
                              {initials(tutor)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-label-md font-bold text-on-surface truncate">{fullName(tutor)}</p>
                              <p className="text-[12px] text-on-surface-variant">Преподаватель</p>
                            </div>
                            <span className="material-symbols-outlined text-outline ml-auto shrink-0">chevron_right</span>
                          </button>
                        )}

                        {(studentsForLesson[lesson.id] ?? []).map((student) => (
                          <button
                            type="button"
                            key={student.id}
                            onClick={() => navigate(studentDetailPath(student.id))}
                            className="w-full flex items-center gap-4 p-3 bg-surface-container rounded-lg hover:bg-surface-container-high transition-colors text-left"
                          >
                            <div className="w-12 h-12 rounded-full bg-secondary-fixed flex items-center justify-center font-bold text-secondary shrink-0">
                              {initials(student)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-label-md font-bold text-on-surface truncate">{fullName(student)}</p>
                              <p className="text-[12px] text-on-surface-variant truncate">
                                Ученик{student.class_info ? ` · ${student.class_info}` : ""}
                              </p>
                            </div>
                            <span className="material-symbols-outlined text-outline ml-auto shrink-0">chevron_right</span>
                          </button>
                        ))}

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
              })}

              {detailPageCount > 1 && (
                <div className="flex items-center justify-between bg-surface-container-lowest rounded-xl px-4 py-3 shadow-sm border border-outline-variant">
                  <button
                    type="button"
                    onClick={() => setDetailPage((p) => Math.max(0, p - 1))}
                    disabled={safeDetailPage === 0}
                    className="p-2 rounded-lg hover:bg-surface-container transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Предыдущие занятия"
                  >
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  <span className="font-label-md text-label-md text-on-surface-variant">
                    Занятия {safeDetailPage * LESSONS_PAGE_SIZE + 1}
                    –{Math.min(detailLessons.length, safeDetailPage * LESSONS_PAGE_SIZE + LESSONS_PAGE_SIZE)} из{" "}
                    {detailLessons.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDetailPage((p) => Math.min(detailPageCount - 1, p + 1))}
                    disabled={safeDetailPage >= detailPageCount - 1}
                    className="p-2 rounded-lg hover:bg-surface-container transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Следующие занятия"
                  >
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                </div>
              )}
              </>
            )}
          </div>
        </div>
      </div>

      <BulkCreateLessonsModal
        open={bulkCreateOpen}
        courses={courses}
        tutors={people.tutors}
        students={people.students}
        onClose={() => setBulkCreateOpen(false)}
        onCreated={() => load({ silent: true })}
      />

      <EditLessonModal
        open={!!editingLesson}
        lesson={editingLesson}
        tutors={people.tutors}
        courses={courses}
        canReassignTutor
        onClose={() => setEditingLesson(null)}
        onSaved={handleLessonSaved}
        onCancelled={handleLessonCancelled}
        onDeleted={handleLessonDeleted}
      />
    </DashboardShell>
  );
}
