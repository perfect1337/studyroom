import { useEffect, useMemo, useState } from "react";
import { updateLesson, cancelLesson, fetchSubgroups, fetchEnrollments } from "../../api/academic.js";
import { fetchMyPeople } from "../../api/users.js";
import { fullName } from "../../utils/userDisplay.js";

function normalizeDateForInput(value) {
  if (!value) return "";
  // API can return either YYYY-MM-DD or an ISO timestamp.
  // <input type="date"> accepts только последний.
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function sortedIds(ids) {
  return [...new Set((ids ?? []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}
function sameIds(a, b) {
  const x = sortedIds(a);
  const y = sortedIds(b);
  return x.length === y.length && x.every((id, i) => id === y[i]);
}

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

  // Состав группового занятия — подгружается отдельно от остальной формы,
  // только когда занятие (или форма после переключения "Тип занятия") имеет
  // group_type === "group". Позволяет тьютору сменить подгруппу/набор
  // учеников прямо в этой модалке, не пересоздавая занятие (см. PATCH
  // /lessons/{id} с subgroup_id/participant_ids, LessonHandler.Update).
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [courseSubgroups, setCourseSubgroups] = useState([]);
  const [courseRoster, setCourseRoster] = useState([]); // [{id, student}] — активные записи на курс этого занятия
  const [participantsMode, setParticipantsMode] = useState("custom"); // "custom" | id подгруппы (строка)
  const [manualParticipantIds, setManualParticipantIds] = useState([]);
  const [manualStudentQuery, setManualStudentQuery] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");

  useEffect(() => {
    if (open && lesson) {
      setForm({
        topic: lesson.topic ?? "",
        lesson_date: normalizeDateForInput(lesson.lesson_date),
        start_time: lesson.start_time ?? "",
        end_time: lesson.end_time ?? "",
        location_type: lesson.location_type ?? "remote",
        group_type: lesson.group_type ?? "individual",
        comment: lesson.comment ?? "",
        tutor_id: lesson.tutor_id ?? "",
      });
      setError("");
      setConfirmingCancel(false);
      setCourseSubgroups([]);
      setCourseRoster([]);
      setRosterError("");
      setParticipantsMode("custom");
      setManualParticipantIds(sortedIds(lesson.participant_ids));
      setManualStudentQuery("");
      setSelectedStudentId(String(sortedIds(lesson.participant_ids)[0] ?? ""));
    }
  }, [open, lesson]);

  // Подгружаем подгруппы курса и активный состав курса (для ручного выбора
  // учеников), только когда занятие реально групповое — не тратим лишний
  // запрос на индивидуальные занятия.
  useEffect(() => {
    if (!open || !lesson) return;
    let cancelled = false;
    setRosterLoading(true);
    setRosterError("");
    Promise.all([
      form?.group_type === "group"
        ? fetchSubgroups({ course_id: lesson.course_id, tutor_id: lesson.tutor_id })
        : Promise.resolve({ items: [] }),
      fetchEnrollments({ course_id: lesson.course_id }),
      fetchMyPeople().catch(() => null),
    ])
      .then(([subgroupsRes, enrollRes, peopleRes]) => {
        if (cancelled) return;
        const studentsById = {};
        (peopleRes?.students ?? []).forEach((s) => (studentsById[s.id] = s));
        (lesson.participant_names ? Object.entries(lesson.participant_names) : []).forEach(([id, name]) => {
          if (!studentsById[id]) studentsById[id] = { id: Number(id), first_name: name, last_name: "" };
        });

        const activeStudentIds = (enrollRes?.items ?? []).map((e) => e.student_id);
        const roster = sortedIds(activeStudentIds)
          .map((id) => ({ id, student: studentsById[id] ?? null }))
          .sort((a, b) => {
            const nameA = a.student ? fullName(a.student) : `Ученик #${a.id}`;
            const nameB = b.student ? fullName(b.student) : `Ученик #${b.id}`;
            return nameA.localeCompare(nameB, "ru");
          });
        setCourseRoster(roster);

        const subgroups = subgroupsRes?.items ?? [];
        setCourseSubgroups(subgroups);

        // Пытаемся угадать, с какой подгруппой сейчас связано занятие: по
        // совпадению набора участников занятия с составом подгруппы (у
        // занятия нет собственного subgroup_id — см. комментарий в
        // TutorSubgroupsCard.jsx). Если совпадений нет — считаем, что состав
        // редактировался вручную, и открываем ручной список учеников.
        const currentIds = sortedIds(lesson.participant_ids);
        const matched = subgroups.find((sg) => sameIds(sg.student_ids, currentIds));
        setParticipantsMode(matched ? String(matched.id) : "custom");
        setManualParticipantIds(currentIds);
      })
      .catch((e) => {
        if (!cancelled) setRosterError(e.message || "Не удалось загрузить состав курса");
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lesson?.id, lesson?.tutor_id, form?.group_type]);

  const selectedSubgroup = useMemo(
    () => courseSubgroups.find((sg) => String(sg.id) === String(participantsMode)) ?? null,
    [courseSubgroups, participantsMode]
  );
  // Эффективный состав участников для выбранной подгруппы — пересечение с
  // активным составом курса (courseRoster), как и на бэкенде (см.
  // LessonHandler.Update): если кто-то из подгруппы уже не активен на курсе,
  // он всё равно не попадёт в занятие.
  const subgroupEffectiveIds = useMemo(() => {
    if (!selectedSubgroup) return [];
    const activeIds = new Set(courseRoster.map((r) => r.id));
    return sortedIds((selectedSubgroup.student_ids ?? []).filter((id) => activeIds.has(id)));
  }, [selectedSubgroup, courseRoster]);

  // Отфильтрованный по поиску ФИО состав курса для ручного набора учеников.
  // courseRoster уже отсортирован по алфавиту, filter сохраняет порядок.
  const filteredCourseRoster = useMemo(() => {
    const q = manualStudentQuery.trim().toLowerCase();
    if (!q) return courseRoster;
    return courseRoster.filter(({ id, student }) => {
      const name = student ? fullName(student) : `Ученик #${id}`;
      return name.toLowerCase().includes(q);
    });
  }, [courseRoster, manualStudentQuery]);

  function toggleManualStudent(studentId) {
    setManualParticipantIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId].sort((a, b) => a - b)
    );
  }

  if (!open || !lesson || !form) return null;

  const isCancelled = lesson.status === "cancelled";

  function update(field, value) {
    // После неудачного переноса пользователь остаётся в этой же модалке и
    // может сразу выбрать допустимую дату/время и повторить сохранение.
    // Ошибка не должна блокировать дальнейшее редактирование формы.
    setError("");
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
    // Для группового занятия состав должен быть непустым — иначе PATCH
    // отклонит запрос на бэкенде (см. LessonHandler.Update), но лучше
    // сообщить об этом сразу в форме, не дожидаясь ответа сервера.
    if (form.group_type === "individual" && (!selectedStudentId || Number.isNaN(Number(selectedStudentId)))) {
      setError("Выберите ученика для индивидуального занятия");
      return;
    }
    if (form.group_type === "group" && !rosterLoading && !rosterError) {
      const effectiveIds = selectedSubgroup ? subgroupEffectiveIds : manualParticipantIds;
      if (effectiveIds.length === 0) {
        setError(
          selectedSubgroup
            ? "В выбранной подгруппе не осталось активных учеников — выберите другую подгруппу или свой набор."
            : "Выберите хотя бы одного ученика для группового занятия."
        );
        return;
      }
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
      if (form.group_type === "individual" && selectedStudentId) {
        const currentStudentId = sortedIds(lesson.participant_ids)[0];
        if (Number(selectedStudentId) !== currentStudentId || lesson.group_type !== "individual") {
          patch.student_id = Number(selectedStudentId);
        }
      }
      // Меняем состав участников только если занятие групповое и состав
      // реально отличается от текущего — не отправляем subgroup_id/
      // participant_ids на индивидуальных занятиях и не дёргаем лишний раз
      // пересчёт прогресса, если тьютор просто открыл и закрыл выбор состава,
      // ничего не поменяв.
      if (form.group_type === "group" && !rosterLoading && !rosterError) {
        if (selectedSubgroup) {
          if (!sameIds(subgroupEffectiveIds, lesson.participant_ids)) {
            patch.subgroup_id = Number(selectedSubgroup.id);
          }
        } else if (!sameIds(manualParticipantIds, lesson.participant_ids)) {
          patch.participant_ids = manualParticipantIds;
        }
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

        {error && (
          <div
            className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md"
            role="alert"
            aria-live="polite"
          >
            {error}
          </div>
        )}

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

            {form.group_type === "individual" && (
              <div className="flex flex-col gap-stack-sm p-3 rounded-lg border border-outline-variant bg-surface-container-low">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="edit-student">Ученик</label>
                {rosterLoading ? (
                  <p className="text-[13px] text-on-surface-variant">Загрузка учеников…</p>
                ) : rosterError ? (
                  <p className="text-[13px] text-error">{rosterError}</p>
                ) : (
                  <select
                    id="edit-student"
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="">Выберите ученика</option>
                    {courseRoster.map(({ id, student }) => (
                      <option key={id} value={id}>
                        {student ? fullName(student) : `Ученик #${id}`}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {form.group_type === "group" && (
              <div className="flex flex-col gap-stack-sm p-3 rounded-lg border border-outline-variant bg-surface-container-low">
                <span className="font-label-md text-label-md text-on-surface">Состав группы</span>

                {rosterLoading && (
                  <p className="font-body-md text-[13px] text-on-surface-variant">Загрузка состава курса…</p>
                )}
                {rosterError && (
                  <p className="font-body-md text-[13px] text-error">{rosterError}</p>
                )}

                {!rosterLoading && !rosterError && (
                  <>
                    <select
                      value={participantsMode}
                      onChange={(e) => setParticipantsMode(e.target.value)}
                      className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      <option value="custom">Свой набор учеников (выбрать вручную)</option>
                      {courseSubgroups.map((sg) => (
                        <option key={sg.id} value={sg.id}>
                          Подгруппа «{sg.name}»
                        </option>
                      ))}
                    </select>

                    {selectedSubgroup ? (
                      <div className="text-[13px] text-on-surface-variant">
                        {subgroupEffectiveIds.length === 0 ? (
                          <span className="text-error">В этой подгруппе не осталось активных на курсе учеников.</span>
                        ) : (
                          <>
                            {subgroupEffectiveIds.length} {subgroupEffectiveIds.length === 1 ? "ученик" : subgroupEffectiveIds.length < 5 ? "ученика" : "учеников"}:{" "}
                            {subgroupEffectiveIds
                              .map((id) => {
                                const known = courseRoster.find((r) => r.id === id)?.student;
                                return known ? fullName(known) : `Ученик #${id}`;
                              })
                              .join(", ")}
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {courseRoster.length === 0 ? (
                          <p className="font-body-md text-[13px] text-on-surface-variant italic">
                            На этом курсе нет активных учеников.
                          </p>
                        ) : (
                          <>
                            <div className="relative">
                              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant pointer-events-none">
                                search
                              </span>
                              <input
                                type="text"
                                value={manualStudentQuery}
                                onChange={(e) => setManualStudentQuery(e.target.value)}
                                placeholder="Поиск ученика по ФИО…"
                                className="w-full pl-8 pr-3 py-1.5 bg-surface border border-outline-variant rounded-lg font-body-md text-[13px] focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                              />
                            </div>
                            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1 mt-1">
                              {filteredCourseRoster.length === 0 ? (
                                <p className="font-body-md text-[13px] text-on-surface-variant italic">
                                  Никто не найден по запросу «{manualStudentQuery}»
                                </p>
                              ) : (
                                filteredCourseRoster.map(({ id, student }) => (
                                  <label key={id} className="flex items-center gap-2 text-[13px] text-on-surface">
                                    <input
                                      type="checkbox"
                                      checked={manualParticipantIds.includes(id)}
                                      onChange={() => toggleManualStudent(id)}
                                    />
                                    {student ? fullName(student) : `Ученик #${id}`}
                                  </label>
                                ))
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

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
