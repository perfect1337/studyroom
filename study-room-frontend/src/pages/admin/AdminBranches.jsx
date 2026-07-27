import { useEffect, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import ConfirmDeleteModal from "../../components/ui/ConfirmDeleteModal.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchBranches, createBranch, deleteBranch } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const EMPTY_FORM = { name: "", city: "", address: "", phone: "" };

/**
 * Раздел "Филиалы" — только у owner (см. /admin/*). Позволяет посмотреть все
 * филиалы сети, создать новый и удалить существующий. Удаление — необратимая
 * операция (сотрудники и ученики этого филиала не удаляются, но теряют
 * привязку к нему, см. api/users.js:deleteBranch), поэтому защищено
 * двухшаговым подтверждением через ConfirmDeleteModal.
 */
export default function AdminBranches() {
  const { user } = useAuth();

  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addStatus, setAddStatus] = useState("");

  const [branchToDelete, setBranchToDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchBranches();
      setBranches(res?.items ?? []);
    } catch (e) {
      setError(e.message || "Не удалось загрузить список филиалов");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openAddModal() {
    setAddForm(EMPTY_FORM);
    setAddStatus("");
    setShowAddModal(true);
  }

  async function handleAddBranch(e) {
    e.preventDefault();
    if (!addForm.name || !addForm.city) return;
    setAddStatus("saving");
    try {
      const created = await createBranch({
        name: addForm.name,
        city: addForm.city,
        address: addForm.address || undefined,
        phone: addForm.phone || undefined,
      });
      setBranches((list) => [...list, created]);
      setShowAddModal(false);
    } catch (err) {
      setAddStatus(err.message || "Не удалось создать филиал");
    }
  }

  async function handleConfirmDelete() {
    if (!branchToDelete) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteBranch(branchToDelete.id);
      setBranches((list) => list.filter((b) => b.id !== branchToDelete.id));
      setBranchToDelete(null);
    } catch (err) {
      setDeleteError(err.message || "Не удалось удалить филиал");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <DashboardShell
      role="admin"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="mt-4 pb-stack-lg space-y-stack-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-stack-md">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary mb-1">Филиалы</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">Все филиалы сети</p>
          </div>

          <button
            onClick={openAddModal}
            className="bg-primary text-on-primary px-6 py-2.5 rounded-lg font-label-md text-label-md flex items-center gap-2 hover:brightness-110 transition-all active:scale-95 shadow-sm"
          >
            <span className="material-symbols-outlined">add_business</span>
            Добавить филиал
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-surface-container-low text-on-surface-variant border-b border-outline-variant">
                <tr>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Название</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Город</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Адрес</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Телефон</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {!loading && branches.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-on-surface-variant">
                      Филиалов пока нет
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
                {branches.map((b) => (
                  <tr key={b.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-label-md text-label-md font-bold text-on-surface">{b.name}</div>
                      <div className="text-[12px] text-outline">ID: {b.id}</div>
                    </td>
                    <td className="px-6 py-4 text-label-md font-label-md">{b.city}</td>
                    <td className="px-6 py-4 text-label-md font-label-md text-on-surface-variant">{b.address || "—"}</td>
                    <td className="px-6 py-4 text-label-md font-label-md text-on-surface-variant whitespace-nowrap">
                      {b.phone || "—"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => {
                          setDeleteError("");
                          setBranchToDelete(b);
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

      {/* Модалка добавления филиала */}
      {showAddModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAddModal(false)}>
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Добавить филиал</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-surface-container-high rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleAddBranch} className="space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Название *</label>
                <input
                  required
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Например: Study Room на Ленина"
                  className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Город *</label>
                <input
                  required
                  value={addForm.city}
                  onChange={(e) => setAddForm((f) => ({ ...f, city: e.target.value }))}
                  className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Адрес</label>
                <input
                  value={addForm.address}
                  onChange={(e) => setAddForm((f) => ({ ...f, address: e.target.value }))}
                  className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Телефон</label>
                <input
                  value={addForm.phone}
                  onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+7..."
                  className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>

              {addStatus && addStatus !== "saving" && <p className="text-sm text-error">{addStatus}</p>}

              <button
                type="submit"
                disabled={addStatus === "saving"}
                className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
              >
                {addStatus === "saving" ? "Сохранение..." : "Создать филиал"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Удаление филиала — двойное подтверждение (ввод названия + финальный клик) */}
      <ConfirmDeleteModal
        open={!!branchToDelete}
        title="Удалить филиал?"
        itemLabel={branchToDelete?.name}
        description="Сотрудники и ученики этого филиала не удалятся, но потеряют привязку к нему. Расписание, курсы и договоры филиала при этом не переносятся автоматически."
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => (deleteBusy ? null : setBranchToDelete(null))}
        onConfirm={handleConfirmDelete}
      />
    </DashboardShell>
  );
}
