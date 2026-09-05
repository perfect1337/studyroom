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
      lesson_date_from: monthStart(),
      lesson_date_to: monthEnd(),
      start_time: "10:00",
      end_time: "11:00",
      location_type: "onsite",
      student_id: "",
    });
    setDays([1, 2, 3, 4, 5]);
    setError("");
    setProgress("");
  }, [open]);

  if (!open || !form) return null;

  const selectedCourse = courses.find((c) => String(c.id) === String(form.course_id));
  // Тип занятия целиком определяется форматом выбранного курса.
  const groupType = selectedCourse?.format === "group" ? "group" : "individual";
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
    if (groupType === "individual" && !form.student_id) { setError("Для индивидуальных занятий выберите ученика."); return; }
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
            topic: selectedCourse?.title || selectedCourse?.subject || "Занятие",
            lesson_date: dates[i],
            start_time: form.start_time,
            end_time: form.end_time,
            location_type: form.location_type,
            group_type: groupType,
            ...(groupType === "individual" ? { student_id: Number(form.student_id) } : {}),
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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-3 sm:p-4" onClick={saving ? undefined : onClose}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-4 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container text-on-primary-container flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined">event_repeat</span>
            </div>
            <div>
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Быстро создать занятия на месяц</h3>
              <p className="font-body-md text-[13px] text-on-surface-variant mt-1">Одно правило создаст занятия сразу на все выбранные даты.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="p-2 rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-40 shrink-0"><span className="material-symbols-outlined">close</span></button>
        </div>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-[13px] flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            {error}
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 font-label-md text-label-md text-on-surface">Курс
              <select value={form.course_id} onChange={(e) => update("course_id", e.target.value)} className="px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow">
                <option value="">Выберите курс</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title ?? c.subject ?? `Курс #${c.id}`}</option>)}
              </select>
              {selectedCourse && (
                <span className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-label-md text-[11px] w-fit">
                  <span className="material-symbols-outlined text-[13px]">{groupType === "group" ? "groups" : "person"}</span>
                  {groupType === "group" ? "Групповой курс" : "Индивидуальный курс"}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1.5 font-label-md text-label-md text-on-surface">Преподаватель
              <select value={form.tutor_id} onChange={(e) => update("tutor_id", e.target.value)} className="px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow">
                <option value="">Выберите преподавателя</option>{tutors.map((t) => <option key={t.id} value={t.id}>{fullName(t)}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 font-label-md text-label-md text-on-surface">С
              <input type="date" value={form.lesson_date_from} onChange={(e) => update("lesson_date_from", e.target.value)} className="px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow" />
            </label>
            <label className="flex flex-col gap-1.5 font-label-md text-label-md text-on-surface">По
              <input type="date" value={form.lesson_date_to} onChange={(e) => update("lesson_date_to", e.target.value)} className="px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow" />
            </label>
          </div>
          <div>
            <p className="font-label-md text-label-md text-on-surface mb-2">Дни недели</p>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">{WEEKDAYS.map(([day, label]) => <button key={day} type="button" onClick={() => toggleDay(day)} className={`py-2 rounded-lg border font-label-md text-[13px] font-semibold transition-colors ${days.includes(day) ? "border-primary bg-primary text-on-primary shadow-sm" : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high"}`}>{label}</button>)}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 font-label-md text-label-md text-on-surface">Начало<input type="time" value={form.start_time} onChange={(e) => update("start_time", e.target.value)} className="px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow" /></label>
            <label className="flex flex-col gap-1.5 font-label-md text-label-md text-on-surface">Конец<input type="time" value={form.end_time} onChange={(e) => update("end_time", e.target.value)} className="px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow" /></label>
          </div>
          <label className="flex flex-col gap-1.5 font-label-md text-label-md text-on-surface">Формат проведения
            <select value={form.location_type} onChange={(e) => update("location_type", e.target.value)} className="px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow"><option value="onsite">Очно, в филиале</option><option value="remote">Дистанционно (Zoom)</option></select>
          </label>
          {groupType === "individual" && (
            <label className="flex flex-col gap-1.5 font-label-md text-label-md text-on-surface p-3 rounded-lg border border-outline-variant bg-surface-container-low">Ученик
              <select value={form.student_id} onChange={(e) => update("student_id", e.target.value)} className="px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow"><option value="">Выберите ученика</option>{filteredStudents.map((s) => <option key={s.id} value={s.id}>{fullName(s)}{s.class_info ? ` · ${s.class_info}` : ""}</option>)}</select>
            </label>
          )}
          {progress && (
            <p className="font-label-md text-[13px] text-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
              {progress}
            </p>
          )}
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-3 border-t border-outline-variant/50">
            <button type="button" onClick={onClose} disabled={saving} className="px-6 py-2 rounded-lg font-label-md text-label-md text-primary border border-primary hover:bg-primary-container/20 transition-colors disabled:opacity-60">Отмена</button>
            <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg font-label-md text-label-md bg-primary text-on-primary hover:bg-on-primary-fixed-variant shadow-sm hover:shadow-md transition-all active:scale-95 duration-150 disabled:opacity-60">{saving ? "Создаём…" : "Создать на месяц"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
