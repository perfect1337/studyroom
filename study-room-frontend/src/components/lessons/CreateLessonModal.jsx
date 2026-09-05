import { useEffect, useMemo, useState } from "react";
import { createLesson, fetchEnrollments } from "../../api/academic.js";
import { fullName } from "../../utils/userDisplay.js";

export default function CreateLessonModal({ open, onClose, onCreated, courses = [], tutors = [], students: peopleStudents = [], branches = [], isOwner = false, defaultDate = "" }) {
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

  useEffect(() => {
    if (!open) return;
    setForm((f) => ({ ...f, lesson_date: defaultDate || f.lesson_date }));
    setError("");
  }, [open, defaultDate]);

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
    () => courses.find((c) => String(c.id) === String(form.course_id)),
    [courses, form.course_id]
  );
  // Тип занятия (индивидуальное/групповое) целиком определяется форматом
  // выбранного курса — отдельного выбора в форме больше нет, т.к. курс уже
  // однозначно индивидуальный либо групповой (см. Course.Format).
  const groupType = selectedCourse?.format === "group" ? "group" : "individual";

  if (!open) return null;

  function update(name, value) {
    setError("");
    setForm((f) => ({ ...f, [name]: value }));
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
    if (groupType === "individual" && !form.student_id) {
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
        student_id: groupType === "individual" ? Number(form.student_id) : undefined,
        lesson_date: form.lesson_date,
        start_time: form.start_time,
        end_time: form.end_time,
        location_type: form.location_type,
        group_type: groupType,
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
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Новое занятие</h3>
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
          <span className="font-label-md text-label-md text-on-surface">Курс</span>
          <select value={form.course_id} onChange={(e) => update("course_id", e.target.value)} className="mt-1.5 w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow">
            <option value="">Выберите курс</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title || c.subject}</option>)}
          </select>
          {selectedCourse && (
            <span className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-label-md text-[11px]">
              <span className="material-symbols-outlined text-[13px]">{groupType === "group" ? "groups" : "person"}</span>
              {groupType === "group" ? "Групповой курс" : "Индивидуальный курс"}
            </span>
          )}
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="font-label-md text-label-md text-on-surface">Преподаватель</span>
            <select value={form.tutor_id} onChange={(e) => update("tutor_id", e.target.value)} className="mt-1.5 w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow">
              <option value="">Без преподавателя</option>
              {tutors.map((t) => <option key={t.id} value={t.id}>{fullName(t)}</option>)}
            </select>
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

        {groupType === "individual" && (
          <label className="block p-3 rounded-lg border border-outline-variant bg-surface-container-low">
            <span className="font-label-md text-label-md text-on-surface">Ученик {loadingStudents ? "(загрузка…)" : ""}</span>
            <select value={form.student_id} onChange={(e) => update("student_id", e.target.value)} className="mt-1.5 w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow" disabled={!form.course_id || loadingStudents}>
              <option value="">Выберите ученика</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}

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
            <input type="time" value={form.end_time} onChange={(e) => update("end_time", e.target.value)} className="mt-1.5 w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow" />
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
