import { useEffect, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchBranches, createBranch } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";
import { sanitizePhoneInput, isValidPhone } from "../../utils/phone.js";

const EMPTY_FORM = { name: "", city: "", address: "", phone: "" };

/**
 * Раздел "Филиалы" — доступен только owner (см. api-contracts.md, 1.16/1.17).
 * Список всех филиалов сети + форма добавления нового.
 */
export default function AdminBranches() {
  const { user } = useAuth();

  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addStatus, setAddStatus] = useState("");

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

  function closeAddModal() {
    setShowAddModal(false);
  }

  async function handleAddBranch(e) {
    e.preventDefault();
    if (!addForm.name || !addForm.city) return;
    if (addForm.phone && !isValidPhone(addForm.phone)) {
      setAddStatus("Введите телефон в формате из 10-15 цифр (можно с +)");
      return;
    }
    setAddStatus("saving");
    try {
      const created = await createBranch({
        name: addForm.name,
        city: addForm.city,
        address: addForm.address || undefined,
        phone: addForm.phone || undefined,
      });
      setBranches((list) => [created?.branch ?? created, ...list]);
      setAddStatus("done");
    } catch (e) {
      setAddStatus(e.message || "Не удалось создать филиал");
    }
  }

  return (
    <DashboardShell role="admin" user={toSidebarUser(user)} userLabel={fullName(user)}>
      <div className="flex justify-between items-end mt-4 mb-stack-lg">
        <div>
          <h2 className="text-headline-sm font-headline-sm text-on-surface">Филиалы</h2>
          <p className="text-on-surface-variant text-label-md font-label-md">Все филиалы сети Study Room</p>
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
        <div className="mb-4 p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-on-surface-variant text-label-md">Загрузка...</p>
      ) : branches.length === 0 ? (
        <div className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant shadow-sm text-center text-on-surface-variant">
          Филиалов пока нет. Добавьте первый филиал сети.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-stack-md">
          {branches.map((b) => (
            <div
              key={b.id}
              className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant shadow-sm flex flex-col gap-3 hover:-translate-y-1 transition-transform"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-primary-container rounded-lg flex items-center justify-center text-on-primary-container shrink-0">
                  <span className="material-symbols-outlined">storefront</span>
                </div>
                <div className="min-w-0">
                  <p className="font-headline-sm text-headline-sm text-on-surface truncate">{b.name}</p>
                  <p className="text-[12px] text-outline">ID: {b.id}</p>
                </div>
              </div>
              <div className="space-y-1 text-label-md font-label-md text-on-surface-variant">
                <p className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">location_city</span>
                  {b.city || "—"}
                </p>
                <p className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">home_pin</span>
                  {b.address || "Адрес не указан"}
                </p>
                <p className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">call</span>
                  {b.phone || "Телефон не указан"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={closeAddModal}>
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Новый филиал</h3>
              <button onClick={closeAddModal} className="p-1 hover:bg-surface-container-high rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {addStatus === "done" ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-green-100 text-green-800 font-label-md text-label-md">
                  Филиал «{addForm.name}» успешно добавлен.
                </div>
                <button
                  onClick={closeAddModal}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all"
                >
                  Готово
                </button>
              </div>
            ) : (
              <form onSubmit={handleAddBranch} className="space-y-4">
                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Название *</label>
                  <input
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Например, Энгельс"
                    required
                    className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Город *</label>
                  <input
                    value={addForm.city}
                    onChange={(e) => setAddForm((f) => ({ ...f, city: e.target.value }))}
                    placeholder="Город"
                    required
                    className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Адрес</label>
                  <input
                    value={addForm.address}
                    onChange={(e) => setAddForm((f) => ({ ...f, address: e.target.value }))}
                    placeholder="Улица, дом"
                    className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Телефон</label>
                  <input
                    value={addForm.phone}
                    onChange={(e) => setAddForm((f) => ({ ...f, phone: sanitizePhoneInput(e.target.value) }))}
                    placeholder="+7 900 000-00-00"
                    className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>

                {addStatus && addStatus !== "saving" && (
                  <p className="text-sm text-error">{addStatus}</p>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeAddModal}
                    className="flex-1 border border-outline-variant text-on-surface py-3 rounded-lg font-bold hover:bg-surface-container-high transition-all"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={addStatus === "saving"}
                    className="flex-1 bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
                  >
                    {addStatus === "saving" ? "…" : "Добавить филиал"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
