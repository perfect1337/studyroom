import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchEnrollments, fetchCourses, createLesson } from "../../api/academic.js";
import { fetchMyPeople } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

export default function TutorNewLesson() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [enrollments, setEnrollments] = useState([]);
  const [courses, setCourses] = useState([]);
  const [studentsById, setStudentsById] = useState({});
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    enrollmentId: "",
    topic: "",
    date: "",
    startTime: "",
    endTime: "",
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

  const coursesById = Object.fromEntries(courses.map((c) => [c.id, c]));

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    const enrollment = enrollments.find((en) => String(en.id) === String(form.enrollmentId));
    if (!enrollment) {
      setSubmitError("Выберите ученика/группу из списка");
      return;
    }
    setSubmitting(true);
    try {
      await createLesson({
        course_id: enrollment.course_id,
        tutor_id: user.id,
        topic: form.topic,
        lesson_date: form.date,
        start_time: form.startTime,
        end_time: form.endTime,
        location_type: form.lessonType === "online" ? "remote" : "offline",
        group_type: form.lessonFormat,
        comment: form.comment || undefined,
      });
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md">
              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="enrollment-select">
                  Выбор ученика/курса <span className="text-error">*</span>
                </label>
                <select
                  id="enrollment-select"
                  required
                  value={form.enrollmentId}
                  onChange={(e) => update("enrollmentId", e.target.value)}
                  className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                >
                  <option value="">{loadingOptions ? "Загрузка…" : "Выберите ученика и курс"}</option>
                  {enrollments.map((e) => {
                    const student = studentsById[e.student_id];
                    const course = coursesById[e.course_id];
                    return (
                      <option key={e.id} value={e.id}>
                        {(student ? fullName(student) : `Ученик #${e.student_id}`)} — {course?.title ?? course?.subject ?? `Курс #${e.course_id}`}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="lesson-topic">
                  Тема занятия <span className="text-error">*</span>
                </label>
                <input
                  id="lesson-topic"
                  required
                  type="text"
                  placeholder="Например: Введение в алгебру"
                  value={form.topic}
                  onChange={(e) => update("topic", e.target.value)}
                  className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-stack-md bg-surface-container-low p-stack-md rounded-lg">
              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="lesson-date">
                  Дата занятия <span className="text-error">*</span>
                </label>
                <input
                  id="lesson-date"
                  required
                  type="date"
                  value={form.date}
                  onChange={(e) => update("date", e.target.value)}
                  className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                />
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
              </div>
              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="lesson-time-end">
                  Время окончания <span className="text-error">*</span>
                </label>
                <input
                  id="lesson-time-end"
                  required
                  type="time"
                  value={form.endTime}
                  onChange={(e) => update("endTime", e.target.value)}
                  className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md">
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
                {submitting ? "Создание…" : "Создать занятие"}
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
