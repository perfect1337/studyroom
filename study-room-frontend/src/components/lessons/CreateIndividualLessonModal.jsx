import { useEffect, useMemo, useRef, useState } from "react";
import { createLesson, fetchEnrollments } from "../../api/academic.js";
import { fullName } from "../../utils/userDisplay.js";
import { addMinutesToTime, DEFAULT_LESSON_DURATION_MINUTES } from "../../utils/time.js";
import SearchableSelect from "../ui/SearchableSelect.jsx";

export default function CreateIndividualLessonModal({ open, onClose, onCreated, courses = [], tutors = [], students: peopleStudents = [], branches = [], isOwner = false, defaultDate = "" }) {
  const [form, setForm] = useState({
    course_id: "", tutor_id: "", branch_id: "", student_id: "",
    lesson_date: defaultDate, start_time: "", end_time: "",
    location_type: "onsite", comment: "",
  });
  const [enrollments, setEnrollments] = useState([]);
  const [students, setStudents] = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const endTimeTouched = useRef(false);

  useEffect(() => {
    if (!open) return;
    setForm((f) => ({ ...f, lesson_date: defaultDate || f.lesson_date }));
    setError("");
    endTimeTouched.current = false;
  }, [open, defaultDate]);

  // Фильтруем только индивидуальные курсы
  const individualCourses = useMemo(
    () => courses.filter((c) => c.format !== "group"),
    [courses]
  );

  // Ограничение для branch_owner: он может назначать занятия только по
  // курсам, которые реально ведёт выбранный преподаватель (course.tutor_ids,
  // таблица course_tutors), и наоборот — выбирать только тех преподавателей,
  // что закреплены за выбранным курсом. Owner (сеть филиалов целиком)
  // видит полный список без ограничений — он управляет назначениями сам.
  const availableCourses = useMemo(() => {
    if (isOwner || !form.tutor_id) return individualCourses;
    return individualCourses.filter((c) =>
      (c.tutor_ids || []).some((id) => String(id) === String(form.tutor_id))
    );
  }, [individualCourses, isOwner, form.tutor_id]);

  const availableTutors = useMemo(() => {
    if (isOwner || !form.course_id) return tutors;
    const course = individualCourses.find((c) => String(c.id) === String(form.course_id));
    if (!course) return tutors;
    const ids = new Set((course.tutor_ids || []).map(String));
    return tutors.filter((t) => ids.has(String(t.id)));
  }, [tutors, isOwner, form.course_id, individualCourses]);

  useEffect(() => {
    if (!open || !form.course_id) {
      setEnrollments([]);
      setStudents([]);
      return;
    }
    let cancelled = false;
    setLoadingStudents(true);
    fetchEnrollments({ course_id: Number(form.course_id) })
      .then((res) => {
        if (!cancelled) {
          const items = res?.items ?? [];
          setEnrollments(items);
          const seen = new Set();
          const list = [];
          for (const e of items) {
            if (seen.has(e.student_id)) continue;
            seen.add(e.student_id);
            const person = peopleStudents.find((p) => String(p.id) === String(e.student_id));
            list.push({ id: e.student_id, name: person ? fullName(person) : `Ученик #${e.student_id}` });
          }
          setStudents(list);
        }
      })
      .catch((e) => !cancelled && setError(e.message || "Не удалось загрузить учеников курса"))
      .finally(() => !cancelled && setLoadingStudents(false));
    return () => { cancelled = true; };
  }, [open, form.course_id]);

  const selectedCourse = useMemo(
    () => individualCourses.find((c) => String(c.id) === String(form.course_id)),
    [individualCourses, form.course_id]
  );

  if (!open) return null;

  function update(name, value) {
    setError("");
    setForm((f) => {
      const next = { ...f, [name]: value };
      if (name === "start_time" && value && !endTimeTouched.current) {
        next.end_time = addMinutesToTime(value, DEFAULT_LESSON_DURATION_MINUTES);
      }
      return next;
    });
  }

  function updateEndTime(value) {
    endTimeTouched.current = true;
    update("end_time", value);
  }

  // Смена курса/преподавателя branch_owner'ом может сделать текущий выбор
  // второго поля невалидным (преподаватель не ведёт новый курс / курс не
  // ведётся новым преподавателем) — в этом случае сбрасываем его, чтобы
  // нельзя было отправить несовместимую пару course_id/tutor_id.
  function updateCourseId(value) {
    setError("");
    setForm((f) => {
      const next = { ...f, course_id: value };
      if (!isOwner && value && f.tutor_id) {
        const course = individualCourses.find((c) => String(c.id) === String(value));
        const ids = new Set((course?.tutor_ids || []).map(String));
        if (!ids.has(String(f.tutor_id))) next.tutor_id = "";
      }
      return next;
    });
  }

  function updateTutorId(value) {
    setError("");
    setForm((f) => {
      const next = { ...f, tutor_id: value };
      if (!isOwner && value && f.course_id) {
        const course = individualCourses.find((c) => String(c.id) === String(f.course_id));
        const ids = new Set((course?.tutor_ids || []).map(String));
        if (!ids.has(String(value))) next.course_id = "";
      }
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.course_id || !form.lesson_date || !form.start_time || !form.end_time) {
      setError("Заполните курс, дату и время");
      return;
    }
    if (form.end_time <= form.start_time) {
      setError("Время окончания должно быть позже времени начала");
      return;
    }
    if (!form.student_id) {
      setError("Для индивидуального занятия выберите ученика");
      return;
    }
    if (!form.tutor_id && !form.branch_id && isOwner) {
      setError("Выберите филиал, если преподаватель не назначен");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        course_id: Number(form.course_id),
        tutor_id: form.tutor_id ? Number(form.tutor_id) : null,
        branch_id: form.branch_id ? Number(form.branch_id) : undefined,
        student_id: Number(form.student_id),
        lesson_date: form.lesson_date,
        start_time: form.start_time,
        end_time: form.end_time,
        location_type: form.location_type,
        group_type: "individual",
        topic: selectedCourse?.title || selectedCourse?.subject || "Занятие",
        comment: form.comment.trim() || null,
      };
      const created = await createLesson(payload);
      onCreated?.(created);
      onClose?.();
    } catch (e) {
      setError(e.message || "Не удалось создать занятие");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4" onClick={saving ? undefined : onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Новое индивидуальное занятие</h3>
            <p className="font-body-md text-[13px] text-on-surface-variant mt-0.5">Заполните детали, чтобы добавить занятие в расписание</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-full hover:bg-surface-container-high transition-colors shrink-0" aria-label="Закрыть">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            {error}
          </div>
        )}

        <label className="block">
          <span className="font-label-md text-label-md text-on-surface">Курс (индивидуальный)</span>
          <div className="mt-1.5">
            <SearchableSelect
              required
              value={form.course_id}
              onChange={updateCourseId}
              options={availableCourses.map((c) => ({ value: c.id, label: c.title || c.subject }))}
              disabled={availableCourses.length === 0}
              placeholder={
                availableCourses.length === 0
                  ? (!isOwner && form.tutor_id ? "У преподавателя нет индивидуальных курсов" : "Нет индивидуальных курсов")
                  : "Выберите курс"
              }
              searchPlaceholder="Поиск курса…"
            />
          </div>
          {selectedCourse && (
            <span className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-label-md text-[11px]">
              <span className="material-symbols-outlined text-[13px]">person</span>
              Индивидуальный курс
            </span>
          )}
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="font-label-md text-label-md text-on-surface">Преподаватель</span>
            <div className="mt-1.5">
              <SearchableSelect
                allowClear
                clearLabel="Без преподавателя"
                value={form.tutor_id}
                onChange={updateTutorId}
                options={availableTutors.map((t) => ({ value: t.id, label: fullName(t) }))}
                placeholder="Без преподавателя"
                searchPlaceholder="Поиск преподавателя…"
              />
            </div>
            {!isOwner && form.course_id && availableTutors.length === 0 && (
              <span className="mt-1 block font-body-md text-[12px] text-error">На этот курс не назначен ни один преподаватель</span>
            )}
          </label>
          {isOwner && (
            <label className="block">
              <span className="font-label-md text-label-md text-on-surface">Филиал</span>
              <select value={form.branch_id} onChange={(e) => update("branch_id", e.target.value)} className="mt-1.5 w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow">
                <option value="">Выберите филиал</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name || b.city}</option>)}
              </select>
            </label>
          )}
        </div>

        <label className="block">
          <span className="font-label-md text-label-md text-on-surface">Формат проведения</span>
          <select value={form.location_type} onChange={(e) => update("location_type", e.target.value)} className="mt-1.5 w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow">
            <option value="onsite">Очно, в филиале</option>
            <option value="remote">Дистанционно (Zoom)</option>
          </select>
        </label>

        <label className="block p-3 rounded-lg border border-outline-variant bg-surface-container-low">
          <span className="font-label-md text-label-md text-on-surface">Ученик {loadingStudents ? "(загрузка…)" : ""}</span>
          <div className="mt-1.5">
            <SearchableSelect
              required
              value={form.student_id}
              onChange={(v) => update("student_id", v)}
              options={students.map((s) => ({ value: s.id, label: s.name }))}
              disabled={!form.course_id || loadingStudents}
              placeholder="Выберите ученика"
              searchPlaceholder="Поиск ученика по ФИО…"
            />
          </div>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block sm:col-span-1">
            <span className="font-label-md text-label-md text-on-surface">Дата</span>
            <input type="date" value={form.lesson_date} onChange={(e) => update("lesson_date", e.target.value)} className="mt-1.5 w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow" />
          </label>
          <label className="block">
            <span className="font-label-md text-label-md text-on-surface">Начало</span>
            <input type="time" value={form.start_time} onChange={(e) => update("start_time", e.target.value)} className="mt-1.5 w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow" />
          </label>
          <label className="block">
            <span className="font-label-md text-label-md text-on-surface">Окончание</span>
            <input type="time" value={form.end_time} onChange={(e) => updateEndTime(e.target.value)} className="mt-1.5 w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow" />
          </label>
        </div>

        <label className="block">
          <span className="font-label-md text-label-md text-on-surface">Комментарий <span className="text-outline-variant font-normal">(необязательно)</span></span>
          <textarea value={form.comment} onChange={(e) => update("comment", e.target.value)} className="mt-1.5 w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none resize-y transition-shadow" rows="3" />
        </label>

        <div className="flex justify-end gap-3 pt-2 border-t border-outline-variant/50">
          <button type="button" onClick={onClose} className="px-6 py-2 rounded-lg font-label-md text-label-md text-primary border border-primary hover:bg-primary-container/20 transition-colors">Отмена</button>
          <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg font-label-md text-label-md bg-primary text-on-primary hover:bg-on-primary-fixed-variant shadow-sm hover:shadow-md transition-all active:scale-95 duration-150 disabled:opacity-60">{saving ? "Создаём…" : "Создать занятие"}</button>
        </div>
      </form>
    </div>
  );
}
