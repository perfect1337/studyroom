import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchLessons, fetchCourses } from "../../api/academic.js";
import { fetchMyPeople, fetchBranches, fetchUserById } from "../../api/users.js";
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
function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
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

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // 0 = Monday

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
        setPeople({ students: res?.students ?? [], tutors: res?.tutors ?? [] });
        // Если ранее выбранный преподаватель/ученик больше не входит в список
        // (например, сменили филиал), сбрасываем фильтр.
        setTutorFilter((prev) => (prev && !(res?.tutors ?? []).some((t) => String(t.id) === String(prev)) ? "" : prev));
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

  // Загружаем расписание за текущий месяц с учётом активных фильтров.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
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
        if (cancelled) return;

        const lessonItems = lessonsRes?.items ?? [];
        setLessons(lessonItems);
        setCourses(coursesRes?.items ?? []);
        setSelectedDay(null);
        setDetailPage(0);

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
        if (!cancelled) {
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
  }, [viewYear, viewMonth, tutorFilter, studentFilter, branchFilter, isOwner]);

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
  const studentsForLesson = useMemo(() => {
    const map = {}; // lesson.id -> [student, ...]
    lessons.forEach((l) => {
      const ids = [...new Set(l.participant_ids ?? [])];
      map[l.id] = ids.map((id) => studentsById[id]).filter(Boolean);
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
  const detailPageCount = Math.max(1, Math.ceil(selectedLessons.length / LESSONS_PAGE_SIZE));
  const safeDetailPage = Math.min(detailPage, detailPageCount - 1);
  const paginatedLessons = selectedLessons.slice(
    safeDetailPage * LESSONS_PAGE_SIZE,
    safeDetailPage * LESSONS_PAGE_SIZE + LESSONS_PAGE_SIZE
  );

  return (
    <DashboardShell
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
        {isOwner && (
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          >
            <option value="">Все филиалы</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || b.city}
              </option>
            ))}
          </select>
        )}

        <select
          value={tutorFilter}
          onChange={(e) => setTutorFilter(e.target.value)}
          disabled={peopleLoading}
          className="bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none disabled:opacity-60"
        >
          <option value="">Все преподаватели</option>
          {people.tutors.map((t) => (
            <option key={t.id} value={t.id}>
              {fullName(t)}
            </option>
          ))}
        </select>

        <select
          value={studentFilter}
          onChange={(e) => setStudentFilter(e.target.value)}
          disabled={peopleLoading}
          className="bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none disabled:opacity-60"
        >
          <option value="">Все ученики</option>
          {people.students.map((s) => (
            <option key={s.id} value={s.id}>
              {fullName(s)}
            </option>
          ))}
        </select>

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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-stack-lg">
        {/* Calendar */}
        <div className="lg:col-span-8 space-y-stack-lg">
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-on-surface">
                  {MONTH_NAMES[viewMonth]} {viewYear}
                </h3>
                <p className="font-body-md text-body-md text-on-surface-variant">
                  {loading ? "Загрузка занятий…" : `${lessons.length} занятий в этом месяце`}
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
                    onClick={() => {
                      setSelectedDay(day);
                      setDetailPage(0);
                    }}
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
              <>
              {paginatedLessons.map((lesson) => {
                const course = coursesById[lesson.course_id];
                const tutor = tutorsById[lesson.tutor_id];
                const color = courseColor[lesson.course_id] ?? "#004ac6";
                const isDone = lesson.status === "completed" || lesson.status === "conducted";

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
                        <StatusBadge
                          status={
                            isDone ? "Выполнено" : lesson.status === "cancelled" ? "Просрочен" : "Ожидание"
                          }
                        />
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
                    –{Math.min(selectedLessons.length, safeDetailPage * LESSONS_PAGE_SIZE + LESSONS_PAGE_SIZE)} из{" "}
                    {selectedLessons.length}
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
    </DashboardShell>
  );
}
