import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import ConfirmDeleteModal from "../../components/ui/ConfirmDeleteModal.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchMyPeople } from "../../api/users.js";
import { fetchCourses, createCourse, updateCourse, deleteCourse } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";
import { usePagination } from "../../utils/usePagination.js";
import Pagination from "../../components/ui/Pagination.jsx";

const FORMAT_LABEL = { individual: "Индивидуально", group: "Группа" };

const EMPTY_FORM = { title: "", subject: "", format: "individual", description: "" };

/**
 * Раздел "Курсы" — общий компонент для owner (/admin/courses) и branch_owner
 * (/branch/courses). Курсы НЕ привязаны к филиалу — единый каталог курсов на
 * всю сеть, виден одинаково из любого филиала. Управлять курсами (создавать,
 * редактировать, удалять) может только owner — branch_owner видит список
 * курсов, но кнопок "Добавить курс"/"Редактировать"/"Удалить" у него нет
 * (сервер и так отклонит эти запросы с 403, см.
 * academic-service/internal/handlers/course_handler.go, но незачем ему даже
 * показывать элементы управления, которыми нельзя воспользоваться).
 *
 * Важно: у enrollments/lessons внешний ключ на courses настроен
 * ON DELETE CASCADE — удаление курса удалит и связанные записи на курс, и
 * занятия по нему. Поэтому удаление защищено явным предупреждением-подтверждением.
 */
export default function CoursesDirectory({ role }) {
  const isOwner = role === "owner";
  const { user } = useAuth();

  const [courses, setCourses] = useState([]);
  const [tutors, setTutors] = useState([]); // нужны, чтобы показать ФИО преподавателей в таблице
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addStatus, setAddStatus] = useState("");

  const [courseToEdit, setCourseToEdit] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editStatus, setEditStatus] = useState("");

  const [courseToDelete, setCourseToDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Список преподавателей — нужен только для отображения ФИО в колонке
  // "Преподаватели" у branch_owner (owner получает это иначе — см. ниже).
  useEffect(() => {
    if (isOwner) return;
    let cancelled = false;
    fetchMyPeople()
      .then((res) => {
        if (!cancelled) setTutors(res?.tutors ?? []);
      })
      .catch(() => {
        if (!cancelled) setTutors([]);
      });
  return () => {
      cancelled = true;
    };
  }, [isOwner]);

  const { page, setPage, pageItems: pagedCourses } = usePagination(courses, 10);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchCourses({});
      setCourses(res?.items ?? []);
    } catch (e) {
      setError(e.message || "Не удалось загрузить список курсов");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tutorNameById = useMemo(() => {
    const map = {};
    tutors.forEach((t) => (map[t.id] = `${t.last_name ?? ""} ${t.first_name ?? ""}`.trim() || `#${t.id}`));
    return map;
  }, [tutors]);

  function openAddModal() {
    setAddForm(EMPTY_FORM);
    setAddStatus("");
    setShowAddModal(true);
  }

  // Курс общий для всей сети — создаётся одним POST /courses, без выбора
  // и без привязки к филиалу.
  async function handleAddCourse(e) {
    e.preventDefault();
    if (!addForm.title || !addForm.subject) return;
    setAddStatus("saving");
    try {
      const payload = {
        title: addForm.title,
        subject: addForm.subject,
        format: addForm.format,
        description: addForm.description || undefined,
      };
      const created = await createCourse(payload);
      if (created) setCourses((list) => [created, ...list]);
      setShowAddModal(false);
    } catch (err) {
      setAddStatus(err.message || "Не удалось создать курс");
    }
  }

  async function handleConfirmDelete() {
    if (!courseToDelete) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteCourse(courseToDelete.id);
      setCourses((list) => list.filter((c) => c.id !== courseToDelete.id));
      setCourseToDelete(null);
    } catch (err) {
      setDeleteError(err.message || "Не удалось удалить курс");
    } finally {
      setDeleteBusy(false);
    }
  }

  // Открыть модалку редактирования — предзаполняем форму текущими значениями
  // курса, чтобы менять можно было как одно поле, так и сразу все.
  function openEditModal(course) {
    setEditForm({
      title: course.title ?? "",
      subject: course.subject ?? "",
      format: course.format ?? "individual",
      description: course.description ?? "",
    });
    setEditStatus("");
    setCourseToEdit(course);
  }

  async function handleEditCourse(e) {
    e.preventDefault();
    if (!courseToEdit || !editForm.title || !editForm.subject) return;
    setEditStatus("saving");
    try {
      const payload = {
        title: editForm.title,
        subject: editForm.subject,
        format: editForm.format,
        // Всегда шлём строкой (даже пустой), а не null/undefined: PATCH
        // различает "поле не передано" (не трогать) и "поле передано" —
        // это единственный способ явно очистить описание через этот
        // эндпоинт, см. updateCourseRequest на бэке (*string).
        description: editForm.description ?? "",
      };
      const updated = await updateCourse(courseToEdit.id, payload);
      setCourses((list) => list.map((c) => (c.id === courseToEdit.id ? { ...c, ...updated } : c)));
      setCourseToEdit(null);
    } catch (err) {
      setEditStatus(err.message || "Не удалось сохранить изменения");
    }
  }

  return (
    <DashboardShell
      role={isOwner ? "admin" : role}
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="mt-4 pb-stack-lg space-y-stack-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-stack-md">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary mb-1">Курсы</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">Курсы по всей сети</p>
          </div>

          {isOwner && (
            <button
              onClick={openAddModal}
              className="bg-primary text-on-primary px-6 py-2.5 rounded-lg font-label-md text-label-md flex items-center gap-2 hover:brightness-110 transition-all active:scale-95 shadow-sm"
            >
              <span className="material-symbols-outlined">add</span>
              Добавить курс
            </button>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-surface-container-low text-on-surface-variant border-b border-outline-variant">
                <tr>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Курс</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Предмет</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Формат</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Преподаватели</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {!loading && courses.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-on-surface-variant">
                      Курсы не найдены
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-on-surface-variant">
                      Загрузка...
                    </td>
                  </tr>
                )}
                {!loading &&
                  pagedCourses.map((c) => (
                    <tr key={c.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-bold text-on-surface">{c.title}</div>
                        {isOwner ? (
                          <div className="text-[12px] text-outline">ID: {c.id}</div>
                        ) : (
                          c.description && (
                            <div className="text-[12px] text-on-surface-variant mt-0.5 line-clamp-1">{c.description}</div>
                          )
                        )}
                      </td>
                      <td className="px-6 py-4 text-on-surface-variant">{c.subject}</td>
                      <td className="px-6 py-4">
                        <span className="inline-block whitespace-nowrap bg-primary-fixed text-on-primary-fixed px-2.5 py-1 rounded-full text-[12px] font-medium">
                          {FORMAT_LABEL[c.format] ?? c.format}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {isOwner ? (
                          <span className="font-bold text-on-surface">{c.tutor_ids?.length ?? 0}</span>
                        ) : c.tutor_ids?.length ? (
                          <div className="flex flex-wrap gap-1">
                            {c.tutor_ids.map((id) => (
                              <span
                                key={id}
                                className="inline-block whitespace-nowrap bg-surface-container-high px-2 py-0.5 rounded-full text-[12px]"
                              >
                                {tutorNameById[id] || `#${id}`}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-outline">Не назначены</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {isOwner ? (
                          <div className="flex items-center justify-end gap-4">
                            <button
                              onClick={() => openEditModal(c)}
                              className="inline-flex items-center gap-1 text-primary font-bold text-label-md hover:underline"
                            >
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                              Редактировать
                            </button>
                            <button
                              onClick={() => {
                                setDeleteError("");
                                setCourseToDelete(c);
                              }}
                              className="inline-flex items-center gap-1 text-error font-bold text-label-md hover:underline"
                            >
                              <span className="material-symbols-outlined text-[18px]">delete</span>
                              Удалить
                            </button>
                          </div>
                        ) : (
                          <span className="text-outline text-label-md">Только просмотр</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Мобильные карточки */}
          <div className="md:hidden divide-y divide-outline-variant">
            {!loading && courses.length === 0 && (
              <div className="px-4 py-10 text-center text-on-surface-variant">Курсы не найдены</div>
            )}
            {loading && <div className="px-4 py-10 text-center text-on-surface-variant">Загрузка...</div>}
            {pagedCourses.map((c) => (
              <div key={c.id} className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-on-surface truncate">{c.title}</div>
                    {isOwner ? (
                      <div className="text-[12px] text-outline">ID: {c.id}</div>
                    ) : (
                      c.description && <div className="text-[12px] text-on-surface-variant mt-0.5 line-clamp-2">{c.description}</div>
                    )}
                  </div>
                  {isOwner && (
                    <div className="shrink-0 flex items-center gap-1">
                      <button
                        onClick={() => openEditModal(c)}
                        className="p-1.5 -m-1.5 text-primary"
                        aria-label="Редактировать курс"
                      >
                        <span className="material-symbols-outlined text-[20px]">edit</span>
                      </button>
                      <button
                        onClick={() => {
                          setDeleteError("");
                          setCourseToDelete(c);
                        }}
                        className="p-1.5 -m-1.5 text-error"
                        aria-label="Удалить курс"
                      >
                        <span className="material-symbols-outlined text-[20px]">delete</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="text-[12px] font-bold text-on-surface bg-surface-variant px-2 py-1 rounded">{c.subject}</span>
                  <span className="inline-block whitespace-nowrap bg-primary-fixed text-on-primary-fixed px-2.5 py-1 rounded-full text-[11px] font-medium">
                    {FORMAT_LABEL[c.format] ?? c.format}
                  </span>
                </div>

                <div className="text-[12px] text-on-surface-variant border-t border-outline-variant/40 pt-2">
                  <span className="block mb-1">Преподаватели{isOwner ? ` (${c.tutor_ids?.length ?? 0})` : ""}</span>
                  {!isOwner &&
                    (c.tutor_ids?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {c.tutor_ids.map((id) => (
                          <span key={id} className="inline-block whitespace-nowrap bg-surface-container-high px-2 py-0.5 rounded-full text-[12px]">
                            {tutorNameById[id] || `#${id}`}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-outline">Не назначены</span>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Модалка добавления курса */}
      {showAddModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAddModal(false)}>
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Добавить курс</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-surface-container-high rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleAddCourse} className="space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Название *</label>
                <input
                  required
                  value={addForm.title}
                  onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Например: Математика, подготовка к ЕГЭ"
                  className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Предмет *</label>
                  <input
                    required
                    value={addForm.subject}
                    onChange={(e) => setAddForm((f) => ({ ...f, subject: e.target.value }))}
                    placeholder="Математика"
                    className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Формат</label>
                  <select
                    value={addForm.format}
                    onChange={(e) => setAddForm((f) => ({ ...f, format: e.target.value }))}
                    className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  >
                    <option value="individual">Индивидуально</option>
                    <option value="group">Группа</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Описание</label>
                <textarea
                  value={addForm.description}
                  onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none"
                />
              </div>

              {addStatus && addStatus !== "saving" && <p className="text-sm text-error">{addStatus}</p>}

              <button
                type="submit"
                disabled={addStatus === "saving"}
                className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
              >
                {addStatus === "saving" ? "Сохранение..." : "Создать курс"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Модалка редактирования курса — доступна только owner (см.
          api-contracts.md 2.3, PATCH /courses/{id} — owner ТОЛЬКО).
          Можно менять любое поле по отдельности или все сразу. */}
      {courseToEdit && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setCourseToEdit(null)}>
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Редактировать курс</h3>
              <button onClick={() => setCourseToEdit(null)} className="p-1 hover:bg-surface-container-high rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleEditCourse} className="space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Название *</label>
                <input
                  required
                  value={editForm.title}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Предмет *</label>
                  <input
                    required
                    value={editForm.subject}
                    onChange={(e) => setEditForm((f) => ({ ...f, subject: e.target.value }))}
                    className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Формат</label>
                  <select
                    value={editForm.format}
                    onChange={(e) => setEditForm((f) => ({ ...f, format: e.target.value }))}
                    className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  >
                    <option value="individual">Индивидуально</option>
                    <option value="group">Группа</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Описание</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none"
                />
              </div>

              {editStatus && editStatus !== "saving" && <p className="text-sm text-error">{editStatus}</p>}

              <button
                type="submit"
                disabled={editStatus === "saving"}
                className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
              >
                {editStatus === "saving" ? "Сохранение..." : "Сохранить изменения"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Удаление курса — предупреждаем про каскадное удаление записей/занятий */}
      <ConfirmDeleteModal
        open={!!courseToDelete}
        title="Удалить курс?"
        itemLabel={courseToDelete?.title}
        description="Вместе с курсом удалятся все записи учеников на него и все занятия по этому курсу. Это действие необратимо."
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => (deleteBusy ? null : setCourseToDelete(null))}
        onConfirm={handleConfirmDelete}
      />
    </DashboardShell>
  );
}
