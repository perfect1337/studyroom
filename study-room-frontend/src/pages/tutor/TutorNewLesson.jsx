import { useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { currentTutor } from "../../data/mockData.js";

export default function TutorNewLesson() {
  const navigate = useNavigate();
  const t = currentTutor;
  const [form, setForm] = useState({
    student: "",
    topic: "",
    date: "",
    startTime: "",
    endTime: "",
    lessonType: "offline",
    lessonFormat: "individual",
    comment: "",
  });

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    // В боевой версии — POST /api/v1/lessons, затем редирект в расписание.
    navigate("/tutor");
  }

  return (
    <DashboardShell role="tutor" user={t} searchPlaceholder="Поиск..." userLabel={t.name} avatarUrl={t.avatarUrl}>
      <div className="flex-1 flex justify-center py-4">
        <div className="w-full max-w-3xl bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] p-stack-lg border border-outline-variant/30">
          <div className="mb-stack-lg pb-stack-md border-b border-outline-variant/50 flex items-center justify-between">
            <div>
              <h2 className="font-headline-md text-headline-md text-on-background">Добавление нового занятия</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-2">Заполните детали для планирования урока.</p>
            </div>
            <span className="material-symbols-outlined text-primary text-4xl">event_note</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-stack-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md">
              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="student-select">
                  Выбор ученика/группы <span className="text-error">*</span>
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
                  <input
                    id="student-select"
                    required
                    type="text"
                    placeholder="Поиск ученика..."
                    value={form.student}
                    onChange={(e) => update("student", e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                  />
                </div>
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
                className="px-6 py-2 rounded-lg font-label-md text-label-md bg-primary text-on-primary hover:bg-on-primary-fixed-variant shadow-sm hover:shadow-md transition-all active:scale-95 duration-150 flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-sm">check</span>
                Создать занятие
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
