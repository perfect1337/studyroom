import { useEffect, useState } from "react";
import { updateLesson, cancelLesson } from "../../api/academic.js";
import { fullName } from "../../utils/userDisplay.js";

/**
 * Модалка редактирования занятия — используется в трёх местах:
 *  - ScheduleDirectory (owner + branch_owner, /admin/schedule и /branch/schedule)
 *  - TutorSchedule (репетитор, свои занятия)
 *
 * Права проверяются на бэкенде (PATCH/DELETE /lessons/{id}, см. checkLessonAccess
 * в lesson_handler.go), но сама возможность открыть модалку уже ограничена тем,
 * что каждая страница показывает только доступные пользователю занятия:
 *  - owner видит и может редактировать любое занятие,
 *  - branch_owner — только занятия своего филиала (сервер фильтрует список),
 *  - tutor — только свои занятия (сервер фильтрует список).
 *
 * Проп canReassignTutor включает выбор другого репетитора (доступно только
 * owner/branch_owner — сам репетитор себе занятие переназначить не может).
 *
 * Props:
 * - open: bool
 * - lesson: объект занятия (или null)
 * - tutors: [{id, first_name, last_name}] — список для реассайна (может быть пустым)
 * - canReassignTutor: bool
 * - onClose: () => void
 * - onSaved: (updatedLesson) => void — вызывается после успешного PATCH
 * - onCancelled: (lessonId) => void — вызывается после успешного DELETE (отмены)
 */
export default function EditLessonModal({
  open,
  lesson,
  tutors = [],
  canReassignTutor = false,
  onClose,
  onSaved,
  onCancelled,
}) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && lesson) {
      setForm({
        topic: lesson.topic ?? "",
        lesson_date: lesson.lesson_date ?? "",
        start_time: lesson.start_time ?? "",
        end_time: lesson.end_time ?? "",
        location_type: lesson.location_type ?? "remote",
        group_type: lesson.group_type ?? "individual",
        comment: lesson.comment ?? "",
        tutor_id: lesson.tutor_id ?? "",
      });
      setError("");
      setConfirmingCancel(false);
    }
  }, [open, lesson]);

  if (!open || !lesson || !form) return null;

  const isCancelled = lesson.status === "cancelled";

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.topic || !form.lesson_date || !form.start_time || !form.end_time) {
      setError("Заполните тему, дату и время занятия");
      return;
    }
    if (form.end_time <= form.start_time) {
      setError("Время окончания должно быть позже времени начала");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const patch = {
        topic: form.topic,
        lesson_date: form.lesson_date,
        start_time: form.start_time,
        end_time: form.end_time,
        location_type: form.location_type,
        group_type: form.group_type,
        comment: form.comment || null,
      };
      if (canReassignTutor && form.tutor_id) {
        patch.tutor_id = Number(form.tutor_id);
      }
      const updated = await updateLesson(lesson.id, patch);
      onSaved?.(updated ?? { ...lesson, ...patch });
      onClose?.();
    } catch (err) {
      setError(err.message || "Не удалось сохранить изменения");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelLesson() {
    setCancelling(true);
    setError("");
    try {
      await cancelLesson(lesson.id);
      onCancelled?.(lesson.id);
      onClose?.();
    } catch (err) {
      setError(err.message || "Не удалось отменить занятие");
      setCancelling(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={saving || cancelling ? undefined : onClose}
    >
      <div
        className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-3">
          <h3 className="font-headline-sm text-headline-sm text-on-surface">Редактировать занятие</h3>
          {!saving && !cancelling && (
            <button onClick={onClose} className="p-1 hover:bg-surface-container-high rounded-full shrink-0" aria-label="Закрыть">
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>

        {isCancelled && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
            Это занятие уже отменено.
          </div>
        )}

        {!confirmingCancel ? (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="flex flex-col gap-stack-sm">
              <label className="font-label-md text-label-md text-on-surface" htmlFor="edit-topic">
                Тема занятия
              </label>
              <input
                id="edit-topic"
                required
                value={form.topic}
                onChange={(e) => update("topic", e.target.value)}
                className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
              />
            </div>

            {canReassignTutor && tutors.length > 0 && (
              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="edit-tutor">
                  Преподаватель
                </label>
                <select
                  id="edit-tutor"
                  value={form.tutor_id}
                  onChange={(e) => update("tutor_id", e.target.value)}
                  className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                >
                  {tutors.map((t) => (
                    <option key={t.id} value={t.id}>
                      {fullName(t)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="edit-date">
                  Дата
                </label>
                <input
                  id="edit-date"
                  required
                  type="date"
                  value={form.lesson_date}
                  onChange={(e) => update("lesson_date", e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                />
              </div>
              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="edit-start">
                  Начало
                </label>
                <input
                  id="edit-start"
                  required
                  type="time"
                  value={form.start_time}
                  onChange={(e) => update("start_time", e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                />
              </div>
              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="edit-end">
                  Конец
                </label>
                <input
                  id="edit-end"
                  required
                  type="time"
                  value={form.end_time}
                  onChange={(e) => update("end_time", e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="edit-location">
                  Формат проведения
                </label>
                <select
                  id="edit-location"
                  value={form.location_type}
                  onChange={(e) => update("location_type", e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                >
                  <option value="remote">Дистанционно (Zoom)</option>
                  <option value="onsite">Очно, в филиале</option>
                </select>
              </div>
              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="edit-group">
                  Тип занятия
                </label>
                <select
                  id="edit-group"
                  value={form.group_type}
                  onChange={(e) => update("group_type", e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                >
                  <option value="individual">Индивидуальное</option>
                  <option value="group">Групповое</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-stack-sm">
              <label className="font-label-md text-label-md text-on-surface" htmlFor="edit-comment">
                Комментарий <span className="text-outline-variant font-normal">(необязательно)</span>
              </label>
              <textarea
                id="edit-comment"
                rows={3}
                value={form.comment}
                onChange={(e) => update("comment", e.target.value)}
                className="w-full px-4 py-3 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none resize-y"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
                {error}
              </div>
            )}

            <div className="flex flex-wrap justify-between items-center gap-3 pt-2 border-t border-outline-variant/50">
              {!isCancelled ? (
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(true)}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg font-label-md text-label-md text-error border border-error hover:bg-error-container/30 transition-colors disabled:opacity-60"
                >
                  Отменить занятие
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-3 ml-auto">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="px-6 py-2 rounded-lg font-label-md text-label-md text-primary border border-primary hover:bg-primary-container/20 transition-colors disabled:opacity-60"
                >
                  Закрыть
                </button>
                <button
                  type="submit"
                  disabled={saving || isCancelled}
                  className="px-6 py-2 rounded-lg font-label-md text-label-md bg-primary text-on-primary hover:bg-on-primary-fixed-variant shadow-sm hover:shadow-md transition-all active:scale-95 duration-150 disabled:opacity-60"
                >
                  {saving ? "Сохранение…" : "Сохранить"}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
              Точно отменить занятие «{lesson.topic}» {lesson.lesson_date} в {lesson.start_time}? Ученики и родители
              увидят его как отменённое.
            </div>
            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmingCancel(false)}
                disabled={cancelling}
                className="flex-1 border border-outline-variant text-on-surface py-3 rounded-lg font-bold hover:bg-surface-container-high transition-all disabled:opacity-60"
              >
                Назад
              </button>
              <button
                type="button"
                onClick={handleCancelLesson}
                disabled={cancelling}
                className="flex-1 bg-error text-on-error py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
              >
                {cancelling ? "Отмена…" : "Да, отменить занятие"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
