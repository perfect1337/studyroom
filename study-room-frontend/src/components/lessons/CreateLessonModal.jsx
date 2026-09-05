import { useEffect, useMemo, useState } from "react";
import { createLesson, fetchEnrollments } from "../../api/academic.js";
import { fullName } from "../../utils/userDisplay.js";

export default function CreateLessonModal({ open, onClose, onCreated, courses = [], tutors = [], students: peopleStudents = [], branches = [], isOwner = false, defaultDate = "" }) {
  const [form, setForm] = useState({
    course_id: "", tutor_id: "", branch_id: "", student_id: "",
    lesson_date: defaultDate, start_time: "", end_time: "",
    location_type: "onsite", group_type: "individual", topic: "", comment: "",
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

  if (!open) return null;

  function update(name, value) {
    setError("");
    setForm((f) => ({ ...f, [name]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.course_id || !form.lesson_date || !form.start_time || !form.end_time || !form.topic.trim()) {
      setError("Заполните курс, тему, дату и время");
      return;
    }
    if (form.end_time <= form.start_time) {
      setError("Время окончания должно быть позже времени начала");
      return;
    }
    if (form.group_type === "individual" && !form.student_id) {
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
        student_id: form.group_type === "individual" ? Number(form.student_id) : undefined,
        lesson_date: form.lesson_date,
        start_time: form.start_time,
        end_time: form.end_time,
        location_type: form.location_type,
        group_type: form.group_type,
        topic: form.topic.trim(),
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={saving ? undefined : onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-headline-sm text-headline-sm text-on-surface">Новое занятие</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-surface-container-high" aria-label="Закрыть">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {error && <div className="p-3 rounded-lg bg-error-container text-on-error-container text-sm">{error}</div>}

        <label className="block">
          <span className="text-xs font-bold text-on-surface-variant">Курс</span>
          <select value={form.course_id} onChange={(e) => update("course_id", e.target.value)} className="mt-1 w-full border border-outline-variant rounded-lg p-2 bg-surface-container-lowest">
            <option value="">Выберите курс</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title || c.subject}</option>)}
          </select>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-bold text-on-surface-variant">Преподаватель</span>
            <select value={form.tutor_id} onChange={(e) => update("tutor_id", e.target.value)} className="mt-1 w-full border border-outline-variant rounded-lg p-2 bg-surface-container-lowest">
              <option value="">Без преподавателя</option>
              {tutors.map((t) => <option key={t.id} value={t.id}>{fullName(t)}</option>)}
            </select>
          </label>
          {isOwner && (
            <label className="block">
              <span className="text-xs font-bold text-on-surface-variant">Филиал</span>
              <select value={form.branch_id} onChange={(e) => update("branch_id", e.target.value)} className="mt-1 w-full border border-outline-variant rounded-lg p-2 bg-surface-container-lowest">
                <option value="">Выберите филиал</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name || b.city}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-bold text-on-surface-variant">Тип занятия</span>
            <select value={form.group_type} onChange={(e) => update("group_type", e.target.value)} className="mt-1 w-full border border-outline-variant rounded-lg p-2 bg-surface-container-lowest">
              <option value="individual">Индивидуальное</option>
              <option value="group">Групповое</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-on-surface-variant">Формат</span>
            <select value={form.location_type} onChange={(e) => update("location_type", e.target.value)} className="mt-1 w-full border border-outline-variant rounded-lg p-2 bg-surface-container-lowest">
              <option value="onsite">Очно</option>
              <option value="remote">Дистанционно</option>
            </select>
          </label>
        </div>

        {form.group_type === "individual" && (
          <label className="block">
            <span className="text-xs font-bold text-on-surface-variant">Ученик {loadingStudents ? "(загрузка…)" : ""}</span>
            <select value={form.student_id} onChange={(e) => update("student_id", e.target.value)} className="mt-1 w-full border border-outline-variant rounded-lg p-2 bg-surface-container-lowest" disabled={!form.course_id || loadingStudents}>
              <option value="">Выберите ученика</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block sm:col-span-1"><span className="text-xs font-bold text-on-surface-variant">Дата</span><input type="date" value={form.lesson_date} onChange={(e) => update("lesson_date", e.target.value)} className="mt-1 w-full border border-outline-variant rounded-lg p-2" /></label>
          <label className="block"><span className="text-xs font-bold text-on-surface-variant">Начало</span><input type="time" value={form.start_time} onChange={(e) => update("start_time", e.target.value)} className="mt-1 w-full border border-outline-variant rounded-lg p-2" /></label>
          <label className="block"><span className="text-xs font-bold text-on-surface-variant">Окончание</span><input type="time" value={form.end_time} onChange={(e) => update("end_time", e.target.value)} className="mt-1 w-full border border-outline-variant rounded-lg p-2" /></label>
        </div>

        <label className="block"><span className="text-xs font-bold text-on-surface-variant">Тема</span><input value={form.topic} onChange={(e) => update("topic", e.target.value)} className="mt-1 w-full border border-outline-variant rounded-lg p-2" placeholder="Например, алгебра" /></label>
        <label className="block"><span className="text-xs font-bold text-on-surface-variant">Комментарий</span><textarea value={form.comment} onChange={(e) => update("comment", e.target.value)} className="mt-1 w-full border border-outline-variant rounded-lg p-2" rows="3" /></label>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-outline-variant">Отмена</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-primary text-on-primary rounded-lg disabled:opacity-50">{saving ? "Создаём…" : "Создать занятие"}</button>
        </div>
      </form>
    </div>
  );
}
