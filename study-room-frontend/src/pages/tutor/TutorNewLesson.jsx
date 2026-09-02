import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchEnrollments, fetchCourses, createLesson, fetchSubgroups, createSubgroup } from "../../api/academic.js";
import { fetchMyPeople } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

// Занятие всё ещё требует end_time на бэке (см. createLessonRequest в
// lesson_handler.go — там это обязательное поле), но в этом UI блок
// "время окончания" убран по просьбе продукта, поэтому длительность
// занятия считаем сами: старт + фиксированная длительность.
const DEFAULT_DURATION_MINUTES = 105;

function pad(n) {
  return String(n).padStart(2, "0");
}
function toISODate(year, monthIndex, day) {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}
function formatDateRU(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

export default function TutorNewLesson() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [enrollments, setEnrollments] = useState([]);
  const [courses, setCourses] = useState([]);
  const [studentsById, setStudentsById] = useState({});
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // --- ученик: поиск по ФИО + выпадающий список ---
  const [studentQuery, setStudentQuery] = useState("");
  const [studentDropdownOpen, setStudentDropdownOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const studentFieldRef = useRef(null);

  // --- курс ---
  const [selectedCourseId, setSelectedCourseId] = useState("");

  // --- режим участников: один ученик или сохранённая подгруппа ---
  // Подгруппа доступна только на курсах с format === 'group' — на
  // индивидуальном курсе всегда ровно один ученик, группировать нечего.
  const [participantMode, setParticipantMode] = useState("student"); // "student" | "group"
  const [subgroups, setSubgroups] = useState([]);
  const [loadingSubgroups, setLoadingSubgroups] = useState(false);
  const [selectedSubgroupId, setSelectedSubgroupId] = useState("");
  const [creatingSubgroup, setCreatingSubgroup] = useState(false);
  const [newSubgroupName, setNewSubgroupName] = useState("");
  const [newSubgroupStudentIds, setNewSubgroupStudentIds] = useState([]);
  const [subgroupError, setSubgroupError] = useState("");
  const [subgroupSubmitting, setSubgroupSubmitting] = useState(false);

  // --- даты занятия: мини-календарь с множественным выбором ---
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDates, setSelectedDates] = useState([]); // массив ISO-строк, в порядке выбора

  const [form, setForm] = useState({
    startTime: "",
    lessonType: "offline",
    lessonFormat: "individual",
    comment: "",
  });

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    async function load() {
      setLoadingOptions(true);
      try {
        const [enrollRes, coursesRes, peopleRes] = await Promise.all([
          fetchEnrollments({ tutor_id: user.id }),
          fetchCourses({ tutor_id: user.id }),
          fetchMyPeople(),
        ]);
        if (cancelled) return;
        setEnrollments(enrollRes?.items ?? []);
        setCourses(coursesRes?.items ?? []);
        const byId = {};
        (peopleRes?.students ?? []).forEach((s) => (byId[s.id] = s));
        setStudentsById(byId);
      } catch (e) {
        if (!cancelled) setSubmitError(e.message || "Не удалось загрузить список учеников");
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Закрывать выпадающий список ученика при клике вне поля.
  useEffect(() => {
    function onDocClick(e) {
      if (studentFieldRef.current && !studentFieldRef.current.contains(e.target)) {
        setStudentDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const coursesById = useMemo(() => Object.fromEntries(courses.map((c) => [c.id, c])), [courses]);

  // Уникальные ученики репетитора, выведенные из активных записей на курсы.
  const students = useMemo(() => {
    const map = new Map();
    enrollments
      .filter((e) => e.status === "active")
      .forEach((e) => {
        if (!map.has(e.student_id)) {
          const person = studentsById[e.student_id];
          map.set(e.student_id, {
            id: e.student_id,
            name: person ? fullName(person) : `Ученик #${e.student_id}`,
          });
        }
      });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [enrollments, studentsById]);

  const filteredStudents = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q));
  }, [students, studentQuery]);

  // Курсы, доступные выбранному ученику (активная запись у этого репетитора).
  const availableCourses = useMemo(() => {
    if (!selectedStudentId) return [];
    const courseIds = new Set(
      enrollments
        .filter((e) => e.status === "active" && String(e.student_id) === String(selectedStudentId))
        .map((e) => e.course_id)
    );
    return courses.filter((c) => courseIds.has(c.id));
  }, [enrollments, courses, selectedStudentId]);

  // Курсы с групповым форматом — только на них имеет смысл подгруппа.
  const groupCourses = useMemo(() => courses.filter((c) => c.format === "group"), [courses]);

  // Ученики с активной записью именно на выбранный (в режиме "группа") курс —
  // пул, из которого можно набирать новую подгруппу.
  const courseStudents = useMemo(() => {
    if (!selectedCourseId) return [];
    const map = new Map();
    enrollments
      .filter((e) => e.status === "active" && String(e.course_id) === String(selectedCourseId))
      .forEach((e) => {
        if (!map.has(e.student_id)) {
          const person = studentsById[e.student_id];
          map.set(e.student_id, {
            id: e.student_id,
            name: person ? fullName(person) : `Ученик #${e.student_id}`,
          });
        }
      });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [enrollments, studentsById, selectedCourseId]);

  // Подгрупп конкретного курса загружаем лениво, только когда реально выбран
  // курс в режиме "группа" — не тянуть все подгруппы тьютора сразу.
  useEffect(() => {
    if (participantMode !== "group" || !selectedCourseId || !user?.id) {
      setSubgroups([]);
      return;
    }
    let cancelled = false;
    setLoadingSubgroups(true);
    fetchSubgroups({ course_id: selectedCourseId, tutor_id: user.id })
      .then(async (res) => {
        if (cancelled) return;
        const items = res?.items ?? [];
        setSubgroups(items);

        // Не запрашиваем /api/v1/users/{id}: у tutor этот endpoint недоступен (404),
        // а зависимость эффекта от studentsById приводила к повторным запросам и
        // вечной загрузке подгрупп. Имена уже приходят из fetchMyPeople; если
        // конкретного ученика там нет, безопасно оставляем fallback "Ученик #id".
      })
      .catch(() => {
        if (!cancelled) setSubgroups([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSubgroups(false);
      });
    return () => {
      cancelled = true;
    };
  }, [participantMode, selectedCourseId, user?.id]);

  function switchParticipantMode(mode) {
    setParticipantMode(mode);
    setSelectedCourseId("");
    setSelectedStudentId("");
    setStudentQuery("");
    setSelectedSubgroupId("");
    setCreatingSubgroup(false);
    setNewSubgroupName("");
    setNewSubgroupStudentIds([]);
    setSubgroupError("");
  }

  function toggleNewSubgroupStudent(studentId) {
    setNewSubgroupStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  }

  async function handleCreateSubgroup() {
    setSubgroupError("");
    if (!newSubgroupName.trim()) {
      setSubgroupError("Введите название группы");
      return;
    }
    if (newSubgroupStudentIds.length === 0) {
      setSubgroupError("Выберите хотя бы одного ученика");
      return;
    }
    setSubgroupSubmitting(true);
    try {
      const sg = await createSubgroup({
        course_id: Number(selectedCourseId),
        tutor_id: user.id,
        name: newSubgroupName.trim(),
        student_ids: newSubgroupStudentIds.map(Number),
      });
      setSubgroups((prev) => [...prev, sg].sort((a, b) => a.name.localeCompare(b.name, "ru")));
      setSelectedSubgroupId(sg.id);
      setCreatingSubgroup(false);
      setNewSubgroupName("");
      setNewSubgroupStudentIds([]);
    } catch (e) {
      setSubgroupError(e.message || "Не удалось создать группу");
    } finally {
      setSubgroupSubmitting(false);
    }
  }

  function selectStudent(student) {
    setSelectedStudentId(student.id);
    setStudentQuery(student.name);
    setStudentDropdownOpen(false);
    // Если ранее выбранный курс не относится к новому ученику — сбрасываем.
    setSelectedCourseId((prev) => {
      const stillValid = enrollments.some(
        (e) => e.status === "active" && String(e.student_id) === String(student.id) && String(e.course_id) === String(prev)
      );
      return stillValid ? prev : "";
    });
  }

  function handleStudentQueryChange(value) {
    setStudentQuery(value);
    setStudentDropdownOpen(true);
    if (selectedStudentId) {
      const current = students.find((s) => String(s.id) === String(selectedStudentId));
      if (!current || current.name !== value) {
        setSelectedStudentId("");
        setSelectedCourseId("");
      }
    }
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // 0 = Пн
  const isCurrentMonthView = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  const todayDay = isCurrentMonthView ? today.getDate() : null;
  const todayISO = toISODate(today.getFullYear(), today.getMonth(), today.getDate());

  function goToMonth(offset) {
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

  function toggleDate(iso) {
    if (iso < todayISO) return; // прошедшие дни выбрать нельзя
    setSelectedDates((prev) =>
      prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort()
    );
  }

  function removeDate(iso) {
    setSelectedDates((prev) => prev.filter((d) => d !== iso));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");

    if (participantMode === "student" && !selectedStudentId) {
      setSubmitError("Выберите ученика из списка");
      return;
    }
    if (participantMode === "group" && !selectedSubgroupId) {
      setSubmitError("Выберите группу или создайте новую");
      return;
    }
    if (!selectedCourseId) {
      setSubmitError("Выберите курс");
      return;
    }
    if (selectedDates.length === 0) {
      setSubmitError("Выберите хотя бы одну дату занятия в календаре");
      return;
    }
    if (!form.startTime) {
      setSubmitError("Укажите время начала занятия");
      return;
    }

    const course = coursesById[selectedCourseId];
    // Темы у занятия больше нет — бэк всё ещё требует непустой topic,
    // поэтому туда передаётся название курса, но никакого отдельного
    // поля/ввода темы в UI нет и пользователь его не задаёт.
    const topic = course?.title ?? course?.subject ?? "";
    const endTime = addMinutes(form.startTime, DEFAULT_DURATION_MINUTES);

    setSubmitting(true);
    try {
      const results = await Promise.allSettled(
        selectedDates.map((date) =>
          createLesson({
            course_id: course.id,
            tutor_id: user.id,
            ...(participantMode === "group"
              ? { subgroup_id: Number(selectedSubgroupId) }
              : { student_id: Number(selectedStudentId) }),
            topic,
            lesson_date: date,
            start_time: form.startTime,
            end_time: endTime,
            location_type: form.lessonType === "online" ? "remote" : "onsite",
            group_type: participantMode === "group" ? "group" : form.lessonFormat,
            comment: form.comment || undefined,
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        setSubmitError(
          failed.length === results.length
            ? failed[0].reason?.message || "Не удалось создать занятия"
            : `Создано ${results.length - failed.length} из ${results.length} занятий. Часть дат не удалось сохранить.`
        );
        if (failed.length < results.length) {
          navigate("/tutor");
        }
        return;
      }
      navigate("/tutor");
    } catch (e) {
      setSubmitError(e.message || "Не удалось создать занятие");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DashboardShell role="tutor" user={toSidebarUser(user)} searchPlaceholder="Поиск..." userLabel={fullName(user)} avatarUrl={user?.avatar_url}>
      <div className="flex-1 flex justify-center py-4">
        <div className="w-full max-w-3xl bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] p-stack-lg border border-outline-variant/30">
          <div className="mb-stack-lg pb-stack-md border-b border-outline-variant/50 flex items-center justify-between">
            <div>
              <h2 className="font-headline-md text-headline-md text-on-background">Добавление нового занятия</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-2">Заполните детали для планирования урока.</p>
            </div>
            <span className="material-symbols-outlined text-primary text-4xl">event_note</span>
          </div>

          {submitError && (
            <div className="mb-4 p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{submitError}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-stack-lg">
            <div className="flex flex-col gap-stack-sm">
              <span className="font-label-md text-label-md text-on-surface">Кому назначить занятие</span>
              <div className="flex bg-surface-container p-1 rounded-lg w-fit">
                {[
                  { value: "student", label: "Ученик" },
                  { value: "group", label: "Группа" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => switchParticipantMode(opt.value)}
                    className={`px-6 py-2 rounded-md font-label-md text-label-md transition-colors ${
                      participantMode === opt.value ? "bg-primary text-on-primary" : "text-on-surface-variant"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {participantMode === "student" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md">
                <div className="flex flex-col gap-stack-sm relative" ref={studentFieldRef}>
                  <label className="font-label-md text-label-md text-on-surface" htmlFor="student-search">
                    Ученик <span className="text-error">*</span>
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[20px]">
                      search
                    </span>
                    <input
                      id="student-search"
                      autoComplete="off"
                      placeholder={loadingOptions ? "Загрузка…" : "Поиск ученика..."}
                      value={studentQuery}
                      onFocus={() => setStudentDropdownOpen(true)}
                      onChange={(e) => handleStudentQueryChange(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                    />
                  </div>
                  {studentDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg max-h-56 overflow-y-auto">
                      {filteredStudents.length === 0 ? (
                        <div className="px-4 py-3 font-body-md text-body-md text-on-surface-variant italic">
                          {loadingOptions ? "Загрузка…" : "Ученики не найдены"}
                        </div>
                      ) : (
                        filteredStudents.map((s) => (
                          <button
                            type="button"
                            key={s.id}
                            onClick={() => selectStudent(s)}
                            className={`w-full text-left px-4 py-2 font-body-md text-body-md hover:bg-surface-container transition-colors ${
                              String(s.id) === String(selectedStudentId) ? "bg-primary-container/40 text-primary" : "text-on-surface"
                            }`}
                          >
                            {s.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-stack-sm">
                  <label className="font-label-md text-label-md text-on-surface" htmlFor="course-select">
                    Курс <span className="text-error">*</span>
                  </label>
                  <select
                    id="course-select"
                    required
                    disabled={!selectedStudentId}
                    value={selectedCourseId}
                    onChange={(e) => setSelectedCourseId(e.target.value)}
                    className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="">
                      {!selectedStudentId
                        ? "Сначала выберите ученика"
                        : availableCourses.length === 0
                        ? "Нет доступных курсов"
                        : "Выберите курс"}
                    </option>
                    {availableCourses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title ?? c.subject}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-stack-md">
                <div className="flex flex-col gap-stack-sm">
                  <label className="font-label-md text-label-md text-on-surface" htmlFor="group-course-select">
                    Курс (групповой) <span className="text-error">*</span>
                  </label>
                  <select
                    id="group-course-select"
                    required
                    value={selectedCourseId}
                    onChange={(e) => {
                      setSelectedCourseId(e.target.value);
                      setSelectedSubgroupId("");
                      setCreatingSubgroup(false);
                    }}
                    className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                  >
                    <option value="">
                      {groupCourses.length === 0 ? "Нет групповых курсов" : "Выберите курс"}
                    </option>
                    {groupCourses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title ?? c.subject}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedCourseId && (
                  <div className="flex flex-col gap-stack-sm">
                    <label className="font-label-md text-label-md text-on-surface">
                      Подгруппа <span className="text-error">*</span>
                    </label>

                    {loadingSubgroups ? (
                      <p className="font-body-md text-body-md text-on-surface-variant">Загрузка групп…</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {subgroups.map((sg) => (
                          <button
                            type="button"
                            key={sg.id}
                            onClick={() => {
                              setSelectedSubgroupId(sg.id);
                              setCreatingSubgroup(false);
                            }}
                            className={`px-4 py-2 rounded-lg border font-label-md text-label-md transition-colors ${
                              String(sg.id) === String(selectedSubgroupId)
                                ? "bg-primary text-on-primary border-primary"
                                : "border-outline-variant text-on-surface hover:bg-surface-container"
                            }`}
                          >
                            {sg.name} <span className="opacity-70">({sg.student_ids?.length ?? 0})</span>
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setCreatingSubgroup((v) => !v);
                            setSelectedSubgroupId("");
                          }}
                          className="px-4 py-2 rounded-lg border border-dashed border-primary text-primary font-label-md text-label-md hover:bg-primary-container/20 transition-colors flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[18px]">add</span>
                          Новая подгруппа
                        </button>
                      </div>
                    )}

                    {creatingSubgroup && (
                      <div className="mt-2 p-stack-md bg-surface-container-low rounded-lg flex flex-col gap-stack-sm">
                        <input
                          type="text"
                          placeholder="Название подгруппы, например «Вторник 16:00»"
                          value={newSubgroupName}
                          onChange={(e) => setNewSubgroupName(e.target.value)}
                          className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                        />
                        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto border border-outline-variant rounded-lg p-2">
                          {courseStudents.length === 0 ? (
                            <p className="font-body-md text-body-md text-on-surface-variant italic px-2 py-1">
                              На этом курсе нет учеников с активной записью
                            </p>
                          ) : (
                            courseStudents.map((s) => (
                              <label
                                key={s.id}
                                className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface-container cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={newSubgroupStudentIds.includes(s.id)}
                                  onChange={() => toggleNewSubgroupStudent(s.id)}
                                  className="accent-primary"
                                />
                                <span className="font-body-md text-body-md text-on-surface">{s.name}</span>
                              </label>
                            ))
                          )}
                        </div>
                        {subgroupError && (
                          <p className="font-body-md text-[12px] text-error">{subgroupError}</p>
                        )}
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setCreatingSubgroup(false)}
                            className="px-4 py-2 rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors"
                          >
                            Отмена
                          </button>
                          <button
                            type="button"
                            disabled={subgroupSubmitting}
                            onClick={handleCreateSubgroup}
                            className="px-4 py-2 rounded-lg font-label-md text-label-md bg-primary text-on-primary hover:bg-on-primary-fixed-variant transition-colors disabled:opacity-60"
                          >
                            {subgroupSubmitting ? "Создание…" : "Создать и выбрать"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md bg-surface-container-low p-stack-md rounded-lg">
              <div className="flex flex-col gap-stack-sm">
                <div className="flex items-center justify-between">
                  <label className="font-label-md text-label-md text-on-surface">
                    Дата(ы) занятия <span className="text-error">*</span>
                  </label>
                  <span className="font-body-md text-[12px] text-on-surface-variant">
                    {selectedDates.length > 0 ? `Выбрано: ${selectedDates.length}` : "Кликните по дням"}
                  </span>
                </div>

                <div className="bg-surface border border-outline-variant rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-label-md text-label-md text-on-surface">
                      {MONTH_NAMES[viewMonth]} {viewYear}
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => goToMonth(-1)}
                        className="p-1 hover:bg-surface-container rounded transition-colors border border-outline-variant"
                        aria-label="Предыдущий месяц"
                      >
                        <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => goToMonth(1)}
                        className="p-1 hover:bg-surface-container rounded transition-colors border border-outline-variant"
                        aria-label="Следующий месяц"
                      >
                        <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 text-center mb-1">
                    {WEEKDAYS.map((d) => (
                      <div key={d} className="font-label-md text-[10px] text-outline">
                        {d}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: firstWeekday }).map((_, i) => (
                      <div key={`pad-${i}`} className="h-8" />
                    ))}
                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1;
                      const iso = toISODate(viewYear, viewMonth, day);
                      const isSelected = selectedDates.includes(iso);
                      const isToday = day === todayDay;
                      const isPast = iso < todayISO;
                      return (
                        <button
                          type="button"
                          key={day}
                          disabled={isPast}
                          onClick={() => toggleDate(iso)}
                          className={`h-8 rounded-md font-label-md text-[12px] transition-all border
                            ${isPast ? "text-outline-variant cursor-not-allowed" : "text-on-surface hover:bg-primary-container/30"}
                            ${isSelected ? "bg-primary text-on-primary border-primary" : "border-transparent"}
                            ${isToday && !isSelected ? "border-primary" : ""}
                          `}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedDates.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {selectedDates.map((iso) => (
                      <span
                        key={iso}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary-container/40 text-primary font-label-md text-[12px]"
                      >
                        {formatDateRU(iso)}
                        <button
                          type="button"
                          onClick={() => removeDate(iso)}
                          className="material-symbols-outlined text-[14px] hover:text-error"
                          aria-label={`Убрать дату ${formatDateRU(iso)}`}
                        >
                          close
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="lesson-time-start">
                  Время начала <span className="text-error">*</span>
                </label>
                <input
                  id="lesson-time-start"
                  required
                  type="time"
                  value={form.startTime}
                  onChange={(e) => update("startTime", e.target.value)}
                  className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                />
                <p className="font-body-md text-[12px] text-on-surface-variant">
                  Занятие будет создано {selectedDates.length > 1 ? "на все выбранные даты" : "на выбранную дату"}, длительность — {DEFAULT_DURATION_MINUTES} мин (1 ч 45 мин) с момента начала.
                </p>
              </div>
            </div>

            <div className={`grid grid-cols-1 gap-stack-md ${participantMode === "group" ? "" : "md:grid-cols-2"}`}>
              <SegmentedControl
                label="Тип занятия"
                name="lesson_type"
                value={form.lessonType}
                onChange={(v) => update("lessonType", v)}
                options={[
                  { value: "offline", label: "Очное" },
                  { value: "online", label: "Дистанционное" },
                ]}
              />
              {participantMode !== "group" && (
                <SegmentedControl
                  label="Формат занятия"
                  name="lesson_format"
                  value={form.lessonFormat}
                  onChange={(v) => update("lessonFormat", v)}
                  options={[
                    { value: "individual", label: "Индивидуальное" },
                    { value: "group", label: "Групповое" },
                  ]}
                />
              )}
            </div>

            <div className="flex flex-col gap-stack-sm">
              <label className="font-label-md text-label-md text-on-surface" htmlFor="lesson-comment">
                Комментарий к занятию <span className="text-outline-variant font-normal">(необязательно)</span>
              </label>
              <textarea
                id="lesson-comment"
                rows={3}
                placeholder="Дополнительная информация для ученика..."
                value={form.comment}
                onChange={(e) => update("comment", e.target.value)}
                className="w-full px-4 py-3 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none resize-y"
              />
            </div>

            <div className="pt-stack-md border-t border-outline-variant/50 flex justify-end gap-4 mt-stack-lg">
              <button
                type="button"
                onClick={() => navigate("/tutor")}
                className="px-6 py-2 rounded-lg font-label-md text-label-md text-primary border border-primary hover:bg-primary-container/20 transition-colors"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2 rounded-lg font-label-md text-label-md bg-primary text-on-primary hover:bg-on-primary-fixed-variant shadow-sm hover:shadow-md transition-all active:scale-95 duration-150 flex items-center gap-2 disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-sm">check</span>
                {submitting
                  ? "Создание…"
                  : selectedDates.length > 1
                  ? `Создать занятия (${selectedDates.length})`
                  : "Создать занятие"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </DashboardShell>
  );
}

function SegmentedControl({ label, name, value, onChange, options }) {
  return (
    <div className="flex flex-col gap-stack-sm">
      <label className="font-label-md text-label-md text-on-surface">{label} <span className="text-error">*</span></label>
      <div className="flex bg-surface-container p-1 rounded-lg">
        {options.map((opt) => (
          <label key={opt.value} className="flex-1 text-center cursor-pointer">
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="peer sr-only"
            />
            <div
              className={`py-2 rounded-md font-label-md text-label-md transition-colors ${
                value === opt.value ? "bg-primary text-on-primary" : "text-on-surface-variant"
              }`}
            >
              {opt.label}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
