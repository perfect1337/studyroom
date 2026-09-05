import { useEffect, useState } from "react";
import { createLesson } from "../../api/academic.js";
import { fullName } from "../../utils/userDisplay.js";

const WEEKDAYS = [
  [1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"], [0, "Вс"],
];

function pad(n) { return String(n).padStart(2, "0"); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function monthStart() { const d = new Date(); return isoDate(new Date(d.getFullYear(), d.getMonth(), 1)); }
function monthEnd() { const d = new Date(); return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }

export default function BulkCreateLessonsModal({ open, courses = [], tutors = [], students = [], onClose, onCreated }) {
  const [form, setForm] = useState(null);
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm({
      course_id: courses[0]?.id ? String(courses[0].id) : "",
      tutor_id: tutors[0]?.id ? String(tutors[0].id) : "",
      topic: courses[0]?.title ?? courses[0]?.subject ?? "",
      lesson_date_from: monthStart(),
      lesson_date_to: monthEnd(),
      start_time: "10:00",
      end_time: "11:00",
      location_type: "onsite",
      group_type: "group",
      student_id: "",
    });
    setDays([1, 2, 3, 4, 5]);
    setError("");
    setProgress("");
  }, [open]);

  if (!open || !form) return null;

  const selectedCourse = courses.find((c) => String(c.id) === String(form.course_id));
  const filteredStudents = students;
  const selectedDays = new Set(days);

  function update(field, value) {
    setError("");
    setForm((f) => ({ ...f, [field]: value }));
  }

  function toggleDay(day) {
    setDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.course_id || !form.tutor_id || !form.lesson_date_from || !form.lesson_date_to || !form.start_time || !form.end_time) {
      setError("Заполните курс, преподавателя, период и время."); return;
    }
    if (!days.length) { setError("Выберите хотя бы один день недели."); return; }
    if (form.end_time <= form.start_time) { setError("Время окончания должно быть позже времени начала."); return; }
    if (form.group_type === "individual" && !form.student_id) { setError("Для индивидуальных занятий выберите ученика."); return; }
    if (form.lesson_date_from > form.lesson_date_to) { setError("Начало периода не может быть позже конца."); return; }

    const dates = [];
    const from = new Date(`${form.lesson_date_from}T12:00:00`);
    const to = new Date(`${form.lesson_date_to}T12:00:00`);
    for (let d = from; d <= to; d.setDate(d.getDate() + 1)) {
      if (selectedDays.has(d.getDay() === 0 ? 0 : d.getDay())) dates.push(isoDate(d));
    }
    if (!dates.length) { setError("В выбранном периоде нет подходящих дней."); return; }

    setSaving(true); setError("");
    let created = 0; const failed = [];
    try {
      for (let i = 0; i < dates.length; i += 1) {
        setProgress(`Создание ${i + 1} из ${dates.length}…`);
        try {
          await createLesson({
            course_id: Number(form.course_id),
            tutor_id: Number(form.tutor_id),
            topic: form.topic || selectedCourse?.title || selectedCourse?.subject || "Занятие",
            lesson_date: dates[i],
            start_time: form.start_time,
            end_time: form.end_time,
            location_type: form.location_type,
            group_type: form.group_type,
            ...(form.group_type === "individual" ? { student_id: Number(form.student_id) } : {}),
          });
          created += 1;
        } catch (e2) {
          failed.push(`${dates[i]} — ${e2.message || "ошибка"}`);
        }
      }
      if (failed.length) {
        setError(`Создано ${created} из ${dates.length}. Ошибок: ${failed.length}. ${failed.slice(0, 2).join("; ")}`);
      } else {
        onCreated?.(); onClose?.();
      }
    } finally {
      setSaving(false); setProgress("");
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3 sm:p-4" onClick={saving ? undefined : onClose}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-4 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Быстро создать занятия на месяц</h3>
            <p className="text-[13px] text-on-surface-variant mt-1">Одно правило создаст занятия сразу на все выбранные даты.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="p-2 rounded-lg hover:bg-surface-container disabled:opacity-40"><span className="material-symbols-outlined">close</span></button>
        </div>
        {error && <div className="mb-4 p-3 rounded-lg bg-error-container text-on-error-container text-[13px]">{error}</div>}
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px]">Курс
              <select value={form.course_id} onChange={(e) => { const c = courses.find((x) => String(x.id) === e.target.value); setForm((f) => ({ ...f, course_id: e.target.value, topic: c?.title ?? c?.subject ?? f.topic })); }} className="px-3 py-2 bg-surface border border-outline-variant rounded-lg">
                <option value="">Выберите курс</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title ?? c.subject ?? `Курс #${c.id}`}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px]">Преподаватель
              <select value={form.tutor_id} onChange={(e) => update("tutor_id", e.target.value)} className="px-3 py-2 bg-surface border border-outline-variant rounded-lg">
                <option value="">Выберите преподавателя</option>{tutors.map((t) => <option key={t.id} value={t.id}>{fullName(t)}</option>)}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[13px]">Тема
            <input value={form.topic} onChange={(e) => update("topic", e.target.value)} className="px-3 py-2 bg-surface border border-outline-variant rounded-lg" placeholder="Например, Математика" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px]">С
              <input type="date" value={form.lesson_date_from} onChange={(e) => update("lesson_date_from", e.target.value)} className="px-3 py-2 bg-surface border border-outline-variant rounded-lg" />
            </label>
            <label className="flex flex-col gap-1 text-[13px]">По
              <input type="date" value={form.lesson_date_to} onChange={(e) => update("lesson_date_to", e.target.value)} className="px-3 py-2 bg-surface border border-outline-variant rounded-lg" />
            </label>
          </div>
          <div>
            <p className="text-[13px] font-semibold mb-2">Дни недели</p>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">{WEEKDAYS.map(([day, label]) => <button key={day} type="button" onClick={() => toggleDay(day)} className={`py-2 rounded-lg border text-[13px] font-semibold ${days.includes(day) ? "border-primary bg-primary/10 text-primary" : "border-outline-variant text-on-surface-variant"}`}>{label}</button>)}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px]">Начало<input type="time" value={form.start_time} onChange={(e) => update("start_time", e.target.value)} className="px-3 py-2 bg-surface border border-outline-variant rounded-lg" /></label>
            <label className="flex flex-col gap-1 text-[13px]">Конец<input type="time" value={form.end_time} onChange={(e) => update("end_time", e.target.value)} className="px-3 py-2 bg-surface border border-outline-variant rounded-lg" /></label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px]">Формат<select value={form.location_type} onChange={(e) => update("location_type", e.target.value)} className="px-3 py-2 bg-surface border border-outline-variant rounded-lg"><option value="onsite">Очно</option><option value="remote">Дистанционно</option></select></label>
            <label className="flex flex-col gap-1 text-[13px]">Тип<select value={form.group_type} onChange={(e) => update("group_type", e.target.value)} className="px-3 py-2 bg-surface border border-outline-variant rounded-lg"><option value="group">Групповое</option><option value="individual">Индивидуальное</option></select></label>
          </div>
          {form.group_type === "individual" && <label className="flex flex-col gap-1 text-[13px]">Ученик
            <select value={form.student_id} onChange={(e) => update("student_id", e.target.value)} className="px-3 py-2 bg-surface border border-outline-variant rounded-lg"><option value="">Выберите ученика</option>{filteredStudents.map((s) => <option key={s.id} value={s.id}>{fullName(s)}{s.class_info ? ` · ${s.class_info}` : ""}</option>)}</select>
          </label>}
          {progress && <p className="text-[13px] text-primary">{progress}</p>}
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2"><button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-outline-variant">Отмена</button><button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-50">{saving ? "Создаём…" : "Создать на месяц"}</button></div>
        </form>
      </div>
    </div>
  );
}
