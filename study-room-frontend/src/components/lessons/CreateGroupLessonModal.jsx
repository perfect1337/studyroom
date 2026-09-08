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
import SearchableSelect from "../ui/SearchableSelect.jsx";

// Максимум учеников в одной группе (см. maxSubgroupSize в SubgroupHandler на бэкенде).
const MAX_GROUP_SIZE = 7;

// CreateGroupLessonModal — модалка создания группового занятия для
// owner/branch_owner. Оболочка (шапка, дата/время, формат, комментарий,
// кнопки) — та же, что и в CreateLessonModal.jsx, а блок выбора участников
// — тот же визуал и функционал "подгрупп", что уже есть в TutorNewLesson.jsx
// у репетитора (выбор сохранённой подгруппы курса, создание новой,
// редактирование существующей). В отличие от CreateLessonModal, здесь:
//  - курс сразу ограничен групповым форматом (format === "group");
//  - преподаватель обязателен (без него нельзя ни выбрать/создать
//    подгруппу — см. SubgroupHandler.Create, где для owner/branch_owner
//    tutor_id обязателен, — ни определить филиал занятия на бэке).
export default function CreateGroupLessonModal({
  open,
  onClose,
  onCreated,
  courses = [],
  tutors = [],
  students: peopleStudents = [],
  isOwner = false,
  defaultDate = "",
}) {
  const [form, setForm] = useState({
    tutor_id: "",
    course_id: "",
    lesson_date: defaultDate,
    start_time: "",
    end_time: "",
    location_type: "onsite",
    comment: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const endTimeTouched = useRef(false);

  // Активные записи выбранного курса — нужны, чтобы знать, кого вообще
  // можно добавить в подгруппу (см. courseStudents ниже), точно так же,
  // как в TutorNewLesson.jsx.
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
    setForm({
      tutor_id: "",
      course_id: "",
      lesson_date: defaultDate,
      start_time: "",
      end_time: "",
      location_type: "onsite",
      comment: "",
    });
    setError("");
    endTimeTouched.current = false;
    setSubgroups([]);
    setSelectedSubgroupId("");
    setCreatingSubgroup(false);
    setNewSubgroupName("");
    setNewSubgroupStudentIds([]);
    setNewSubgroupStudentQuery("");
    setSubgroupError("");
    setEditingSubgroup(null);
  }, [open, defaultDate]);

  // Только групповые курсы — на индивидуальном подгруппы не имеют смысла.
  const groupCourses = useMemo(() => courses.filter((c) => c.format === "group"), [courses]);

  // Ограничение для branch_owner: после выбора преподавателя показываем
  // только те групповые курсы, что реально закреплены за ним
  // (course.tutor_ids, таблица course_tutors) — назначить занятие по
  // чужому курсу нельзя. Owner видит все групповые курсы без ограничений.
  const availableGroupCourses = useMemo(() => {
    if (isOwner || !form.tutor_id) return groupCourses;
    return groupCourses.filter((c) =>
      (c.tutor_ids || []).some((id) => String(id) === String(form.tutor_id))
    );
  }, [groupCourses, isOwner, form.tutor_id]);

  const selectedCourse = useMemo(
    () => groupCourses.find((c) => String(c.id) === String(form.course_id)),
    [groupCourses, form.course_id]
  );

  // Активные ученики выбранного курса — пул для создания/редактирования подгруппы.
  useEffect(() => {
    if (!open || !form.course_id) {
      setCourseEnrollments([]);
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
    return () => {
      cancelled = true;
    };
  }, [open, form.course_id]);

  const courseStudents = useMemo(() => {
    const map = new Map();
    courseEnrollments
      .filter((e) => e.status === "active")
      .forEach((e) => {
        if (!map.has(e.student_id)) {
          const person = peopleStudents.find((p) => String(p.id) === String(e.student_id));
          map.set(e.student_id, {
            id: e.student_id,
            name: person ? fullName(person) : `Ученик #${e.student_id}`,
          });
        }
      });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [courseEnrollments, peopleStudents]);

  const newSubgroupFilteredStudents = useMemo(() => {
    const q = newSubgroupStudentQuery.trim().toLowerCase();
    if (!q) return courseStudents;
    return courseStudents.filter((s) => s.name.toLowerCase().includes(q));
  }, [courseStudents, newSubgroupStudentQuery]);

  const editSubgroupFilteredStudents = useMemo(() => {
    const q = editSubgroupStudentQuery.trim().toLowerCase();
    if (!q) return courseStudents;
    return courseStudents.filter((s) => s.name.toLowerCase().includes(q));
  }, [courseStudents, editSubgroupStudentQuery]);

  // Подгруппы курса грузим лениво, только когда выбраны и преподаватель, и
  // курс — subgroups.List принудительно фильтрует по tutor_id для
  // owner/branch_owner (см. SubgroupHandler.List), без него список будет
  // "все подгруппы всех тьюторов на курсе", что нам не нужно.
  useEffect(() => {
    if (!open || !form.course_id || !form.tutor_id) {
      setSubgroups([]);
      return;
    }
    let cancelled = false;
    setLoadingSubgroups(true);
    fetchSubgroups({ course_id: Number(form.course_id), tutor_id: Number(form.tutor_id) })
      .then((res) => {
        if (!cancelled) setSubgroups(res?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setSubgroups([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSubgroups(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, form.course_id, form.tutor_id]);

  const selectedSubgroup = useMemo(
    () => subgroups.find((sg) => String(sg.id) === String(selectedSubgroupId)) ?? null,
    [subgroups, selectedSubgroupId]
  );

  const selectedSubgroupStudents = useMemo(() => {
    if (!selectedSubgroup) return [];
    return (selectedSubgroup.student_ids ?? []).map((studentId) => {
      const person = peopleStudents.find((p) => String(p.id) === String(studentId));
      return { id: studentId, name: person ? fullName(person) : `Ученик #${studentId}` };
    });
  }, [selectedSubgroup, peopleStudents]);

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

  function updateTutor(value) {
    update("tutor_id", value);
    // Смена преподавателя обнуляет курс/подгруппу — подгруппы принадлежат
    // конкретному тьютору (см. SubgroupHandler.canManage), выбор для
    // прежнего тьютора для нового не подходит.
    setForm((f) => ({ ...f, course_id: "" }));
    setSelectedSubgroupId("");
    setCreatingSubgroup(false);
    setEditingSubgroup(null);
  }

  function updateCourse(value) {
    setForm((f) => ({ ...f, course_id: value }));
    setSelectedSubgroupId("");
    setCreatingSubgroup(false);
    setEditingSubgroup(null);
  }

  function toggleNewSubgroupStudent(studentId) {
    setNewSubgroupStudentIds((prev) => {
      if (prev.includes(studentId)) return prev.filter((id) => id !== studentId);
      if (prev.length >= MAX_GROUP_SIZE) {
        setSubgroupError(`В группе не может быть больше ${MAX_GROUP_SIZE} учеников`);
        return prev;
      }
      return [...prev, studentId];
    });
  }

  async function handleCreateSubgroup() {
    setSubgroupError("");
    if (!newSubgroupName.trim()) {
      setSubgroupError("Введите название группы");
      return;
    }
    if (newSubgroupStudentIds.length === 0) {
      setSubgroupError("Выберите хотя бы одного ученика");
      return;
    }
    if (newSubgroupStudentIds.length > MAX_GROUP_SIZE) {
      setSubgroupError(`В группе не может быть больше ${MAX_GROUP_SIZE} учеников`);
      return;
    }
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
      setSubgroupError(e.message || "Не удалось создать группу");
    } finally {
      setSubgroupSubmitting(false);
    }
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
    setEditSubgroupStudentIds((prev) => {
      if (prev.includes(studentId)) return prev.filter((id) => id !== studentId);
      if (prev.length >= MAX_GROUP_SIZE) {
        setEditSubgroupError(`В группе не может быть больше ${MAX_GROUP_SIZE} учеников`);
        return prev;
      }
      return [...prev, studentId];
    });
  }

  async function handleUpdateSubgroup() {
    setEditSubgroupError("");
    if (!editingSubgroup) return;
    if (!editSubgroupName.trim()) {
      setEditSubgroupError("Введите название группы");
      return;
    }
    if (editSubgroupStudentIds.length === 0) {
      setEditSubgroupError("Выберите хотя бы одного ученика");
      return;
    }
    if (editSubgroupStudentIds.length > MAX_GROUP_SIZE) {
      setEditSubgroupError(`В группе не может быть больше ${MAX_GROUP_SIZE} учеников`);
      return;
    }
    setEditSubgroupSubmitting(true);
    try {
      const updated = await updateSubgroup(editingSubgroup.id, {
        name: editSubgroupName.trim(),
        student_ids: editSubgroupStudentIds.map(Number),
      });
      setSubgroups((prev) =>
        prev
          .map((sg) => (String(sg.id) === String(updated?.id ?? editingSubgroup.id) ? { ...sg, ...(updated ?? {}) } : sg))
          .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ru"))
      );
      setSelectedSubgroupId(updated?.id ?? editingSubgroup.id);
      setEditingSubgroup(null);
      setEditSubgroupStudentQuery("");
    } catch (e) {
      setEditSubgroupError(e.message || "Не удалось обновить группу");
    } finally {
      setEditSubgroupSubmitting(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.tutor_id) {
      setError("Выберите преподавателя");
      return;
    }
    if (!form.course_id) {
      setError("Выберите групповой курс");
      return;
    }
    if (!selectedSubgroupId) {
      setError("Выберите группу или создайте новую");
      return;
    }
    if (!form.lesson_date || !form.start_time || !form.end_time) {
      setError("Заполните дату и время");
      return;
    }
    if (form.end_time <= form.start_time) {
      setError("Время окончания должно быть позже времени начала");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        course_id: Number(form.course_id),
        tutor_id: Number(form.tutor_id),
        subgroup_id: Number(selectedSubgroupId),
        lesson_date: form.lesson_date,
        start_time: form.start_time,
        end_time: form.end_time,
        location_type: form.location_type,
        group_type: "group",
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
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Новое групповое занятие</h3>
            <p className="font-body-md text-[13px] text-on-surface-variant mt-0.5">
              Выберите преподавателя, групповой курс и группу учеников
            </p>
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
          <span className="font-label-md text-label-md text-on-surface">Преподаватель</span>
          <div className="mt-1.5">
            <SearchableSelect
              required
              value={form.tutor_id}
              onChange={updateTutor}
              options={tutors.map((t) => ({ value: t.id, label: fullName(t) }))}
              placeholder="Выберите преподавателя"
              searchPlaceholder="Поиск преподавателя…"
            />
          </div>
        </label>

        <label className="block">
          <span className="font-label-md text-label-md text-on-surface">Курс (групповой)</span>
          <div className="mt-1.5">
            <SearchableSelect
              required
              value={form.course_id}
              onChange={updateCourse}
              options={availableGroupCourses.map((c) => ({ value: c.id, label: c.title || c.subject }))}
              disabled={!form.tutor_id || availableGroupCourses.length === 0}
              placeholder={
                !form.tutor_id
                  ? "Сначала выберите преподавателя"
                  : availableGroupCourses.length === 0
                  ? (!isOwner ? "У преподавателя нет групповых курсов" : "Нет групповых курсов")
                  : "Выберите курс"
              }
              searchPlaceholder="Поиск курса…"
            />
          </div>
        </label>

        {form.course_id && (
          <div className="flex flex-col gap-2 p-3 rounded-lg border border-outline-variant bg-surface-container-low">
            <span className="font-label-md text-label-md text-on-surface">Группа</span>

            {loadingSubgroups || loadingEnrollments ? (
              <p className="font-body-md text-body-md text-on-surface-variant">Загрузка групп…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {subgroups.map((sg) => (
                  <button
                    type="button"
                    key={sg.id}
                    onClick={() => {
                      setSelectedSubgroupId(sg.id);
                      setCreatingSubgroup(false);
                    }}
                    className={`px-4 py-2 rounded-lg border font-label-md text-label-md transition-colors ${
                      String(sg.id) === String(selectedSubgroupId)
                        ? "bg-primary text-on-primary border-primary"
                        : "border-outline-variant text-on-surface hover:bg-surface-container"
                    }`}
                  >
                    {sg.name} <span className="opacity-70">({sg.student_ids?.length ?? 0})</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setCreatingSubgroup((v) => !v);
                    setSelectedSubgroupId("");
                  }}
                  className="px-4 py-2 rounded-lg border border-dashed border-primary text-primary font-label-md text-label-md hover:bg-primary-container/20 transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[18px]">add</span>
                  Новая группа
                </button>
              </div>
            )}

            {selectedSubgroup && !creatingSubgroup && (
              <div className="mt-1 p-3 bg-surface rounded-lg border border-outline-variant flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-label-md font-bold text-on-surface">Информация о группе</p>
                    <p className="font-body-md text-on-surface-variant mt-1">
                      {selectedSubgroup.name} · {selectedSubgroupStudents.length}{" "}
                      {selectedSubgroupStudents.length === 1 ? "ученик" : selectedSubgroupStudents.length < 5 ? "ученика" : "учеников"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openEditSubgroup}
                    className="shrink-0 px-3 py-2 rounded-lg border border-primary text-primary font-label-md text-[12px] hover:bg-primary-container/20 transition-colors flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                    Редактировать
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedSubgroupStudents.map((student) => (
                    <span key={student.id} className="px-2.5 py-1 rounded-full bg-surface-container text-on-surface font-body-md text-[12px] border border-outline-variant">
                      {student.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {editingSubgroup && (
              <div className="mt-1 p-3 bg-surface rounded-lg flex flex-col gap-2 border border-primary/30">
                <div className="flex items-center justify-between">
                  <p className="font-label-md font-bold text-on-surface">Редактирование группы</p>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSubgroup(null);
                      setEditSubgroupStudentQuery("");
                    }}
                    className="p-1 hover:bg-surface-container rounded"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={editSubgroupName}
                  onChange={(e) => setEditSubgroupName(e.target.value)}
                  placeholder="Название группы"
                  className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                />
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant pointer-events-none">
                    search
                  </span>
                  <input
                    type="text"
                    value={editSubgroupStudentQuery}
                    onChange={(e) => setEditSubgroupStudentQuery(e.target.value)}
                    placeholder="Поиск ученика по ФИО…"
                    className="w-full pl-9 pr-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                  />
                </div>
                <div className="flex items-center justify-between px-1">
                  <span className="font-body-md text-[12px] text-on-surface-variant">
                    Выбрано: {editSubgroupStudentIds.length}/{MAX_GROUP_SIZE}
                  </span>
                  {editSubgroupStudentIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setEditSubgroupStudentIds([])}
                      className="font-body-md text-[12px] text-primary hover:underline"
                    >
                      Снять выбор
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto border border-outline-variant rounded-lg p-2">
                  {editSubgroupFilteredStudents.length === 0 ? (
                    <p className="font-body-md text-body-md text-on-surface-variant italic px-2 py-1">
                      Никто не найден по запросу «{editSubgroupStudentQuery}»
                    </p>
                  ) : (
                    editSubgroupFilteredStudents.map((student) => {
                      const isChecked = editSubgroupStudentIds.includes(student.id);
                      const isDisabled = !isChecked && editSubgroupStudentIds.length >= MAX_GROUP_SIZE;
                      return (
                        <label
                          key={student.id}
                          className={`flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface-container ${isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isDisabled}
                            onChange={() => toggleEditSubgroupStudent(student.id)}
                            className="accent-primary"
                          />
                          <span className="font-body-md text-body-md text-on-surface">{student.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
                {editSubgroupError && <p className="font-body-md text-[12px] text-error">{editSubgroupError}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setEditingSubgroup(null)} className="px-4 py-2 rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors">
                    Отмена
                  </button>
                  <button
                    type="button"
                    disabled={editSubgroupSubmitting}
                    onClick={handleUpdateSubgroup}
                    className="px-4 py-2 rounded-lg font-label-md text-label-md bg-primary text-on-primary hover:bg-on-primary-fixed-variant transition-colors disabled:opacity-60"
                  >
                    {editSubgroupSubmitting ? "Сохраняем…" : "Сохранить"}
                  </button>
                </div>
              </div>
            )}

            {creatingSubgroup && (
              <div className="mt-1 p-3 bg-surface rounded-lg flex flex-col gap-2">
                <input
                  type="text"
                  placeholder="Название группы, например «Вторник 16:00»"
                  value={newSubgroupName}
                  onChange={(e) => setNewSubgroupName(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                />
                {courseStudents.length > 0 && (
                  <>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant pointer-events-none">
                        search
                      </span>
                      <input
                        type="text"
                        value={newSubgroupStudentQuery}
                        onChange={(e) => setNewSubgroupStudentQuery(e.target.value)}
                        placeholder="Поиск ученика по ФИО…"
                        className="w-full pl-9 pr-3 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                      />
                    </div>
                    <div className="flex items-center justify-between px-1">
                      <span className="font-body-md text-[12px] text-on-surface-variant">
                        Выбрано: {newSubgroupStudentIds.length}/{MAX_GROUP_SIZE}
                      </span>
                      {newSubgroupStudentIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setNewSubgroupStudentIds([])}
                          className="font-body-md text-[12px] text-primary hover:underline"
                        >
                          Снять выбор
                        </button>
                      )}
                    </div>
                  </>
                )}
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto border border-outline-variant rounded-lg p-2">
                  {courseStudents.length === 0 ? (
                    <p className="font-body-md text-body-md text-on-surface-variant italic px-2 py-1">
                      На этом курсе нет учеников с активной записью
                    </p>
                  ) : newSubgroupFilteredStudents.length === 0 ? (
                    <p className="font-body-md text-body-md text-on-surface-variant italic px-2 py-1">
                      Никто не найден по запросу «{newSubgroupStudentQuery}»
                    </p>
                  ) : (
                    newSubgroupFilteredStudents.map((s) => {
                      const isChecked = newSubgroupStudentIds.includes(s.id);
                      const isDisabled = !isChecked && newSubgroupStudentIds.length >= MAX_GROUP_SIZE;
                      return (
                        <label
                          key={s.id}
                          className={`flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface-container ${isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isDisabled}
                            onChange={() => toggleNewSubgroupStudent(s.id)}
                            className="accent-primary"
                          />
                          <span className="font-body-md text-body-md text-on-surface">{s.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
                {subgroupError && <p className="font-body-md text-[12px] text-error">{subgroupError}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingSubgroup(false);
                      setNewSubgroupStudentQuery("");
                    }}
                    className="px-4 py-2 rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container transition-colors"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    disabled={subgroupSubmitting}
                    onClick={handleCreateSubgroup}
                    className="px-4 py-2 rounded-lg font-label-md text-label-md bg-primary text-on-primary hover:bg-on-primary-fixed-variant transition-colors disabled:opacity-60"
                  >
                    {subgroupSubmitting ? "Создание…" : "Создать и выбрать"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <label className="block">
          <span className="font-label-md text-label-md text-on-surface">Формат проведения</span>
          <select
            value={form.location_type}
            onChange={(e) => update("location_type", e.target.value)}
            className="mt-1.5 w-full px-3 py-2.5 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-shadow"
          >
            <option value="onsite">Очно, в филиале</option>
            <option value="remote">Дистанционно (Zoom)</option>
          </select>
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
          <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg font-label-md text-label-md bg-primary text-on-primary hover:bg-on-primary-fixed-variant shadow-sm hover:shadow-md transition-all active:scale-95 duration-150 disabled:opacity-60">{saving ? "Создаём…" : "Создать групповое занятие"}</button>
        </div>
      </form>
    </div>
  );
}
