import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import ConfirmDeleteModal from "../../components/ui/ConfirmDeleteModal.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchBranches, fetchMyPeople } from "../../api/users.js";
import { fetchCourses, createCourse, deleteCourse } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const FORMAT_LABEL = { individual: "Индивидуально", group: "Группа" };

const EMPTY_FORM = { title: "", subject: "", format: "individual", description: "" };

/**
 * Раздел "Курсы" — общий компонент для owner (/admin/courses) и branch_owner
 * (/branch/courses). Бэкенд (academic-service) поддерживает POST/PATCH/DELETE
 * /courses для обеих ролей — для branch_owner branch_id всегда принудительно
 * подставляется/проверяется сервером как его собственный филиал (см.
 * academic-service/internal/handlers/course_handler.go).
 *
 * Важно: у enrollments/lessons внешний ключ на courses настроен
 * ON DELETE CASCADE — удаление курса удалит и связанные записи на курс, и
 * занятия по нему. Поэтому удаление защищено явным предупреждением-подтверждением.
 *
 * Создание курса у owner: у courses в БД branch_id обязателен (один курс =
 * один филиал, см. миграцию 0001_init), поэтому "курс для всех филиалов" на
 * уровне данных — это несколько записей courses с одинаковыми
 * title/subject/format/description, но разными branch_id (по одной на
 * каждый филиал сети) — курс сразу заводится для ВСЕХ филиалов сети без
 * выбора, см. handleAddCourse ниже. У branch_owner филиал всего один, поэтому
 * для него создаётся ровно одна запись — его собственный филиал, без выбора.
 */
export default function CoursesDirectory({ role }) {
  const isOwner = role === "owner";
  const { user } = useAuth();

  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(""); // "" = все филиалы (только owner)
  const [courses, setCourses] = useState([]);
  const [tutors, setTutors] = useState([]); // нужны branch_owner, чтобы показать ФИО преподавателей в таблице
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addStatus, setAddStatus] = useState("");

  const [courseToDelete, setCourseToDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (!isOwner) return;
    fetchBranches()
      .then((res) => setBranches(res?.items ?? []))
      .catch(() => {});
  }, [isOwner]);

  // branch_owner не выбирает филиал — фильтр/список курсов уже ограничен
  // сервером его собственным филиалом (см. course_handler.go List). Тут нам
  // нужны только преподаватели своего филиала, чтобы показать их ФИО в
  // колонке "Преподаватели" (owner получает это иначе — см. ниже).
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

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchCourses(selectedBranch ? { branch_id: Number(selectedBranch) } : {});
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
  }, [selectedBranch]);

  const branchNameById = useMemo(() => {
    const map = {};
    branches.forEach((b) => (map[b.id] = b.name || b.city));
    return map;
  }, [branches]);

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

  // owner: курс создаётся сразу для всех филиалов сети — выбор конкретного
  // филиала убран из формы. На уровне БД branch_id у courses обязателен
  // (один курс = один филиал), поэтому "курс на всю сеть" реализован как
  // по одному POST /courses на каждый филиал из уже загруженного списка
  // branches, с одинаковыми title/subject/format/description.
  // branch_owner: филиал всего один — один POST /courses, branch_id
  // подставляет сам бэкенд из JWT (см. course_handler.go Create).
  async function handleAddCourse(e) {
    e.preventDefault();
    if (!addForm.title || !addForm.subject) return;
    if (isOwner && branches.length === 0) {
      setAddStatus("Список филиалов пуст — сначала добавьте хотя бы один филиал");
      return;
    }
    setAddStatus("saving");
    try {
      const payload = {
        title: addForm.title,
        subject: addForm.subject,
        format: addForm.format,
        description: addForm.description || undefined,
      };

      if (!isOwner) {
        const created = await createCourse(payload);
        if (created) setCourses((list) => [created, ...list]);
        setShowAddModal(false);
        return;
      }

      const results = await Promise.allSettled(
        branches.map((b) => createCourse({ ...payload, branch_id: Number(b.id) }))
      );

      const created = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
      const failed = results.filter((r) => r.status === "rejected");

      if (created.length > 0) {
        // Показываем сразу те из созданных курсов, что попадают в текущий фильтр.
        const toShow = selectedBranch
          ? created.filter((c) => Number(c.branch_id) === Number(selectedBranch))
          : created;
        if (toShow.length > 0) {
          setCourses((list) => [...toShow, ...list]);
        }
      }

      if (failed.length > 0) {
        setAddStatus(
          `Курс создан для ${created.length} из ${branches.length} филиалов. Не удалось создать для ${failed.length} филиал(ов) — попробуйте ещё раз.`
        );
        return;
      }

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
            <p className="font-body-md text-body-md text-on-surface-variant">
              {isOwner ? "Курсы по всей сети филиалов" : "Курсы вашего филиала"}
            </p>
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

        {isOwner && (
          <section className="flex flex-col md:flex-row gap-stack-md md:items-center">
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            >
              <option value="">Все филиалы</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || b.city}
                </option>
              ))}
            </select>
          </section>
        )}

        <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-surface-container-low text-on-surface-variant border-b border-outline-variant">
                <tr>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Курс</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Предмет</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Формат</th>
                  {isOwner && <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Филиал</th>}
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Преподаватели</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {!loading && courses.length === 0 && (
                  <tr>
                    <td colSpan={isOwner ? 6 : 5} className="px-6 py-10 text-center text-on-surface-variant">
                      Курсы не найдены
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={isOwner ? 6 : 5} className="px-6 py-10 text-center text-on-surface-variant">
                      Загрузка...
                    </td>
                  </tr>
                )}
                {courses.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-label-md text-label-md font-bold text-on-surface">{c.title}</div>
                      {isOwner ? (
                        <div className="text-[12px] text-outline">ID: {c.id}</div>
                      ) : (
                        c.description && (
                          <div className="text-[12px] text-on-surface-variant mt-0.5 max-w-xs truncate">{c.description}</div>
                        )
                      )}
                    </td>
                    <td className="px-6 py-4 text-label-md font-label-md">{c.subject}</td>
                    <td className="px-6 py-4">
                      <span className="inline-block whitespace-nowrap bg-primary-fixed text-on-primary-fixed px-3 py-1 rounded-full text-label-md font-medium">
                        {FORMAT_LABEL[c.format] ?? c.format}
                      </span>
                    </td>
                    {isOwner && (
                      <td className="px-6 py-4 text-label-md font-label-md text-on-surface-variant whitespace-nowrap">
                        {branchNameById[c.branch_id] || `Филиал #${c.branch_id}`}
                      </td>
                    )}
                    <td className="px-6 py-4 text-label-md font-label-md text-on-surface-variant">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              {isOwner ? (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-primary-fixed/40 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[18px] text-primary">info</span>
                  <p className="text-[12px] font-label-md text-label-md">
                    Курс будет создан сразу для всех филиалов сети ({branches.length}
                    {branches.length === 1 ? " филиал" : " филиалов"}) — выбирать филиал не нужно.
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-primary-fixed/40 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[18px] text-primary">info</span>
                  <p className="text-[12px] font-label-md text-label-md">
                    Курс будет создан в вашем филиале ({user?.branch_name || `Филиал #${user?.branch_id}`}).
                  </p>
                </div>
              )}
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
