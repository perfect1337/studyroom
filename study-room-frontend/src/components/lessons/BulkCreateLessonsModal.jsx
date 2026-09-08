import { useEffect, useMemo, useRef, useState } from "react";
import {
  createLesson,
  fetchEnrollments,
  fetchSubgroups,
  createSubgroup,
  updateSubgroup,
} from "../../api/academic.js";
import { fullName } from "../../utils/userDisplay.js";
import { addMinutesToTime, DEFAULT_LESSON_DURATION_MINUTES } from "../../utils/time.js";

const WEEKDAYS = [
  [1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"], [0, "Вс"],
];

function pad(n) { return String(n).padStart(2, "0"); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function monthStart() { const d = new Date(); return isoDate(new Date(d.getFullYear(), d.getMonth(), 1)); }
function monthEnd() { const d = new Date(); return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }

export default function BulkCreateLessonsModal({
  open,
  courses = [],
  tutors = [],
  students: peopleStudents = [],
  onClose,
  onCreated,
  canManageSubgroups = false,
}) {
  const [form, setForm] = useState(null);
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  // endTimeTouched — см. CreateLessonModal.jsx: пока пользователь сам не
  // поменял время окончания, оно пересчитывается от времени начала
  // (+105 минут) в update(); после ручного изменения автоподстановка для
  // этой формы отключается.
  const endTimeTouched = useRef(false);

  const [courseEnrollments, setCourseEnrollments] = useState([]);
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [subgroups, setSubgroups] = useState([]);
  const [loadingSubgroups, setLoadingSubgroups] = useState(false);
  const [selectedSubgroupId, setSelectedSubgroupId] = useState("");
  const [creatingSubgroup, setCreatingSubgroup] = useState(false);
  const [newSubgroupName, setNewSubgroupName] = useState("");
  const [newSubgroupStudentIds, setNewSubgroupStudentIds] = useState([]);
  const [newSubgroupStudentQuery, setNewSubgroupStudentQuery] = useState("");
  const [subgroupError, setSubgroupError] = useState("");
  const [subgroupSubmitting, setSubgroupSubmitting] = useState(false);
  const [editingSubgroup, setEditingSubgroup] = useState(null);
  const [editSubgroupName, setEditSubgroupName] = useState("");
  const [editSubgroupStudentIds, setEditSubgroupStudentIds] = useState([]);
  const [editSubgroupStudentQuery, setEditSubgroupStudentQuery] = useState("");
  const [editSubgroupError, setEditSubgroupError] = useState("");
  const [editSubgroupSubmitting, setEditSubgroupSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const startTime = "10:00";
    setForm({
      course_id: courses[0]?.id ? String(courses[0].id) : "",
      tutor_id: tutors[0]?.id ? String(tutors[0].id) : "",
      lesson_date_from: monthStart(),
      lesson_date_to: monthEnd(),
      start_time: startTime,
      end_time: addMinutesToTime(startTime, DEFAULT_LESSON_DURATION_MINUTES),
      location_type: "onsite",
      student_id: "",
    });
    setDays([1, 2, 3, 4, 5]);
    setError("");
    setProgress("");
    endTimeTouched.current = false;
    setCourseEnrollments([]);
    setSubgroups([]);
    setSelectedSubgroupId("");
    setCreatingSubgroup(false);
    setNewSubgroupName("");
    setNewSubgroupStudentIds([]);
    setNewSubgroupStudentQuery("");
    setSubgroupError("");
    setEditingSubgroup(null);
    setEditSubgroupName("");
    setEditSubgroupStudentIds([]);
    setEditSubgroupStudentQuery("");
    setEditSubgroupError("");
  }, [open]);

  const selectedCourse = form
    ? courses.find((c) => String(c.id) === String(form.course_id))
    : undefined;
  const groupType = selectedCourse?.format === "group" ? "group" : "individual";
  const filteredStudents = peopleStudents;
  const selectedDays = new Set(days);

  useEffect(() => {
    if (!open || !form?.course_id) {
      setCourseEnrollments([]);
      setSubgroups([]);
      return;
    }
    let cancelled = false;
    setLoadingEnrollments(true);
    fetchEnrollments({ course_id: Number(form.course_id) })
      .then((res) => {
        if (!cancelled) setCourseEnrollments(res?.items ?? []);
      })
      .catch((e) => !cancelled && setError(e.message || "Не удалось загрузить учеников курса"))
      .finally(() => !cancelled && setLoadingEnrollments(false));
    return () => { cancelled = true; };
  }, [open, form?.course_id]);

  useEffect(() => {
    if (!open || !canManageSubgroups || !form?.course_id || !form?.tutor_id || groupType !== "group") {
      setSubgroups([]);
      return;
    }
    let cancelled = false;
    setLoadingSubgroups(true);
    fetchSubgroups({ course_id: Number(form.course_id), tutor_id: Number(form.tutor_id) })
      .then((res) => { if (!cancelled) setSubgroups(res?.items ?? []); })
      .catch(() => { if (!cancelled) setSubgroups([]); })
      .finally(() => { if (!cancelled) setLoadingSubgroups(false); });
    return () => { cancelled = true; };
  }, [open, canManageSubgroups, form?.course_id, form?.tutor_id, groupType]);

  const courseStudents = useMemo(() => {
    const map = new Map();
    courseEnrollments.filter((e) => e.status === "active").forEach((e) => {
      if (!map.has(e.student_id)) {
        const person = peopleStudents.find((p) => String(p.id) === String(e.student_id));
        map.set(e.student_id, { id: e.student_id, name: person ? fullName(person) : `Ученик #${e.student_id}` });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [courseEnrollments, peopleStudents]);

  const selectedSubgroup = useMemo(() =>
    subgroups.find((sg) => String(sg.id) === String(selectedSubgroupId)) ?? null,
    [subgroups, selectedSubgroupId]
  );
  const selectedSubgroupStudents = useMemo(() =>
    selectedSubgroup ? (selectedSubgroup.student_ids ?? []).map((id) => {
      const person = peopleStudents.find((p) => String(p.id) === String(id));
      return { id, name: person ? fullName(person) : `Ученик #${id}` };
    }) : [], [selectedSubgroup, peopleStudents]
  );
  const newSubgroupFilteredStudents = useMemo(() => {
    const q = newSubgroupStudentQuery.trim().toLowerCase();
    return q ? courseStudents.filter((s) => s.name.toLowerCase().includes(q)) : courseStudents;
  }, [courseStudents, newSubgroupStudentQuery]);
  const editSubgroupFilteredStudents = useMemo(() => {
    const q = editSubgroupStudentQuery.trim().toLowerCase();
    return q ? courseStudents.filter((s) => s.name.toLowerCase().includes(q)) : courseStudents;
  }, [courseStudents, editSubgroupStudentQuery]);

  if (!open || !form) return null;

  function update(field, value) {
    setError("");
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === "start_time" && value && !endTimeTouched.current) {
        next.end_time = addMinutesToTime(value, DEFAULT_LESSON_DURATION_MINUTES);
      }
      return next;
    });
  }

  function updateEndTime(value) {
    endTimeTouched.current = true;
    update("end_time", value);
  }

  function toggleDay(day) {
    setDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b));
  }

  function updateTutor(value) {
    update("tutor_id", value);
    setForm((f) => ({ ...f, course_id: "" }));
    setSelectedSubgroupId("");
    setCreatingSubgroup(false);
    setEditingSubgroup(null);
  }

  function toggleNewSubgroupStudent(studentId) {
    setNewSubgroupStudentIds((prev) => prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]);
  }

  async function handleCreateSubgroup() {
    setSubgroupError("");
    if (!newSubgroupName.trim()) return setSubgroupError("Введите название подгруппы");
    if (!newSubgroupStudentIds.length) return setSubgroupError("Выберите хотя бы одного ученика");
    setSubgroupSubmitting(true);
    try {
      const sg = await createSubgroup({
        course_id: Number(form.course_id),
        tutor_id: Number(form.tutor_id),
        name: newSubgroupName.trim(),
        student_ids: newSubgroupStudentIds.map(Number),
      });
      setSubgroups((prev) => [...prev, sg].sort((a, b) => a.name.localeCompare(b.name, "ru")));
      setSelectedSubgroupId(sg.id);
      setCreatingSubgroup(false);
      setNewSubgroupName("");
      setNewSubgroupStudentIds([]);
      setNewSubgroupStudentQuery("");
    } catch (e) {
      setSubgroupError(e.message || "Не удалось создать подгруппу");
    } finally { setSubgroupSubmitting(false); }
  }

  function openEditSubgroup() {
    if (!selectedSubgroup) return;
    setEditingSubgroup(selectedSubgroup);
    setEditSubgroupName(selectedSubgroup.name ?? "");
    setEditSubgroupStudentIds((selectedSubgroup.student_ids ?? []).map(Number));
    setEditSubgroupStudentQuery("");
    setEditSubgroupError("");
  }

  function toggleEditSubgroupStudent(studentId) {
    setEditSubgroupStudentIds((prev) => prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]);
  }

  async function handleUpdateSubgroup() {
    setEditSubgroupError("");
    if (!editingSubgroup) return;
    if (!editSubgroupName.trim()) return setEditSubgroupError("Введите название подгруппы");
    if (!editSubgroupStudentIds.length) return setEditSubgroupError("Выберите хотя бы одного ученика");
    setEditSubgroupSubmitting(true);
    try {
      const updated = await updateSubgroup(editingSubgroup.id, {
        name: editSubgroupName.trim(),
        student_ids: editSubgroupStudentIds.map(Number),
      });
      const id = updated?.id ?? editingSubgroup.id;
      setSubgroups((prev) => prev.map((sg) => String(sg.id) === String(id) ? { ...sg, ...(updated ?? {}) } : sg).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ru")));
      setSelectedSubgroupId(id);
      setEditingSubgroup(null);
      setEditSubgroupStudentQuery("");
    } catch (e) {
      setEditSubgroupError(e.message || "Не удалось обновить подгруппу");
    } finally { setEditSubgroupSubmitting(false); }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.course_id || !form.tutor_id || !form.lesson_date_from || !form.lesson_date_to || !form.start_time || !form.end_time) {
      setError("Заполните курс, преподавателя, период и время."); return;
    }
    if (!days.length) { setError("Выберите хотя бы один день недели."); return; }
    if (form.end_time <= form.start_time) { setError("Время окончания должно быть позже времени начала."); return; }
    if (groupType === "individual" && !form.student_id) { setError("Для индивидуальных занятий выберите ученика."); return; }
    if (groupType === "group" && canManageSubgroups && !selectedSubgroupId) { setError("Для групповых занятий выберите подгруппу или создайте новую."); return; }
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
            ...(groupType === "group" && canManageSubgroups ? { subgroup_id: Number(selectedSubgroupId) } : {}),
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

          {groupType === "group" && canManageSubgroups && form.course_id && form.tutor_id && (
            <div className="flex flex-col gap-2 p-3 rounded-lg border border-outline-variant bg-surface-container-low">
              <span className="font-label-md text-label-md text-on-surface">Подгруппа</span>
              {loadingSubgroups || loadingEnrollments ? (
                <p className="font-body-md text-body-md text-on-surface-variant">Загрузка групп…</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {subgroups.map((sg) => (
                    <button key={sg.id} type="button" onClick={() => { setSelectedSubgroupId(sg.id); setCreatingSubgroup(false); }} className={`px-4 py-2 rounded-lg border font-label-md text-label-md transition-colors ${String(sg.id) === String(selectedSubgroupId) ? "bg-primary text-on-primary border-primary" : "border-outline-variant text-on-surface hover:bg-surface-container"}`}>
                      {sg.name} <span className="opacity-70">({sg.student_ids?.length ?? 0})</span>
                    </button>
                  ))}
                  <button type="button" onClick={() => { setCreatingSubgroup((v) => !v); setSelectedSubgroupId(""); }} className="px-4 py-2 rounded-lg border border-dashed border-primary text-primary font-label-md text-label-md hover:bg-primary-container/20 transition-colors flex items-center gap-1">
                    <span className="material-symbols-outlined text-[18px]">add</span>Новая подгруппа
                  </button>
                </div>
              )}

              {selectedSubgroup && !creatingSubgroup && (
                <div className="mt-1 p-3 bg-surface rounded-lg border border-outline-variant flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-label-md font-bold text-on-surface">Информация о подгруппе</p><p className="font-body-md text-on-surface-variant mt-1">{selectedSubgroup.name} · {selectedSubgroupStudents.length} {selectedSubgroupStudents.length === 1 ? "ученик" : selectedSubgroupStudents.length < 5 ? "ученика" : "учеников"}</p></div>
                    <button type="button" onClick={openEditSubgroup} className="shrink-0 px-3 py-2 rounded-lg border border-primary text-primary font-label-md text-[12px] hover:bg-primary-container/20 transition-colors flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">edit</span>Редактировать</button>
                  </div>
                  <div className="flex flex-wrap gap-2">{selectedSubgroupStudents.map((student) => <span key={student.id} className="px-2.5 py-1 rounded-full bg-surface-container text-on-surface font-body-md text-[12px] border border-outline-variant">{student.name}</span>)}</div>
                </div>
              )}

              {editingSubgroup && (
                <div className="mt-1 p-3 bg-surface rounded-lg flex flex-col gap-2 border border-primary/30">
                  <div className="flex items-center justify-between"><p className="font-label-md font-bold text-on-surface">Редактирование подгруппы</p><button type="button" onClick={() => setEditingSubgroup(null)} className="p-1 hover:bg-surface-container rounded"><span className="material-symbols-outlined text-[18px]">close</span></button></div>
                  <input type="text" value={editSubgroupName} onChange={(e) => setEditSubgroupName(e.target.value)} placeholder="Название подгруппы" className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none" />
                  <input type="text" value={editSubgroupStudentQuery} onChange={(e) => setEditSubgroupStudentQuery(e.target.value)} placeholder="Поиск ученика по ФИО…" className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md outline-none" />
                  <div className="flex items-center justify-between px-1"><span className="font-body-md text-[12px] text-on-surface-variant">Выбрано: {editSubgroupStudentIds.length}</span>{editSubgroupStudentIds.length > 0 && <button type="button" onClick={() => setEditSubgroupStudentIds([])} className="font-body-md text-[12px] text-primary hover:underline">Снять выбор</button>}</div>
                  <div className="flex flex-col gap-1 max-h-48 overflow-y-auto border border-outline-variant rounded-lg p-2">{editSubgroupFilteredStudents.length ? editSubgroupFilteredStudents.map((student) => <label key={student.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface-container cursor-pointer"><input type="checkbox" checked={editSubgroupStudentIds.includes(student.id)} onChange={() => toggleEditSubgroupStudent(student.id)} className="accent-primary" /><span className="font-body-md text-body-md text-on-surface">{student.name}</span></label>) : <p className="font-body-md text-body-md text-on-surface-variant italic px-2 py-1">Никто не найден</p>}</div>
                  {editSubgroupError && <p className="font-body-md text-[12px] text-error">{editSubgroupError}</p>}
                  <div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingSubgroup(null)} className="px-4 py-2 rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container">Отмена</button><button type="button" disabled={editSubgroupSubmitting} onClick={handleUpdateSubgroup} className="px-4 py-2 rounded-lg font-label-md text-label-md bg-primary text-on-primary disabled:opacity-60">{editSubgroupSubmitting ? "Сохраняем…" : "Сохранить"}</button></div>
                </div>
              )}

              {creatingSubgroup && (
                <div className="mt-1 p-3 bg-surface rounded-lg flex flex-col gap-2">
                  <input type="text" placeholder="Название подгруппы, например «Вторник 16:00»" value={newSubgroupName} onChange={(e) => setNewSubgroupName(e.target.value)} className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none" />
                  <input type="text" value={newSubgroupStudentQuery} onChange={(e) => setNewSubgroupStudentQuery(e.target.value)} placeholder="Поиск ученика по ФИО…" className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md outline-none" />
                  <div className="flex items-center justify-between px-1"><span className="font-body-md text-[12px] text-on-surface-variant">Выбрано: {newSubgroupStudentIds.length}</span>{newSubgroupStudentIds.length > 0 && <button type="button" onClick={() => setNewSubgroupStudentIds([])} className="font-body-md text-[12px] text-primary hover:underline">Снять выбор</button>}</div>
                  <div className="flex flex-col gap-1 max-h-48 overflow-y-auto border border-outline-variant rounded-lg p-2">{newSubgroupFilteredStudents.length ? newSubgroupFilteredStudents.map((student) => <label key={student.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface-container cursor-pointer"><input type="checkbox" checked={newSubgroupStudentIds.includes(student.id)} onChange={() => toggleNewSubgroupStudent(student.id)} className="accent-primary" /><span className="font-body-md text-body-md text-on-surface">{student.name}</span></label>) : <p className="font-body-md text-body-md text-on-surface-variant italic px-2 py-1">На этом курсе нет учеников с активной записью</p>}</div>
                  {subgroupError && <p className="font-body-md text-[12px] text-error">{subgroupError}</p>}
                  <div className="flex justify-end gap-2"><button type="button" onClick={() => setCreatingSubgroup(false)} className="px-4 py-2 rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container">Отмена</button><button type="button" disabled={subgroupSubmitting} onClick={handleCreateSubgroup} className="px-4 py-2 rounded-lg font-label-md text-label-md bg-primary text-on-primary disabled:opacity-60">{subgroupSubmitting ? "Создание…" : "Создать и выбрать"}</button></div>
                </div>
              )}
            </div>
          )}

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
            <label className="flex flex-col gap-1.5 font-label-md text-label-md text-on-surface">Конец<input type="time" value={form.end_time} onChange={(e) => updateEndTime(e.target.value)} className="px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow" /></label>
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
