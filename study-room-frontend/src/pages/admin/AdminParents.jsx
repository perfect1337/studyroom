import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import ConfirmDeleteModal from "../../components/ui/ConfirmDeleteModal.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { deleteUser, fetchMyPeople, fetchParentChildren, setUserActive } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

export default function AdminParents() {
  const { user } = useAuth();
  const [parents, setParents] = useState([]);
  const [childrenCount, setChildrenCount] = useState({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [parentToDelete, setParentToDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchMyPeople();
      const list = res?.parents ?? [];
      setParents(list);
      const counts = {};
      await Promise.all(
        list.map(async (parent) => {
          try {
            const children = await fetchParentChildren(parent.id);
            counts[parent.id] = children?.length ?? children?.items?.length ?? 0;
          } catch {
            counts[parent.id] = null;
          }
        })
      );
      setChildrenCount(counts);
    } catch (e) {
      setError(e.message || "Не удалось загрузить родителей");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user?.id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parents.filter((p) => !q || `${fullName(p)} ${p.email ?? ""} ${p.phone ?? ""}`.toLowerCase().includes(q));
  }, [parents, search]);

  async function toggleBan(parent) {
    setBusyId(parent.id);
    setError("");
    try {
      await setUserActive(parent.id, !parent.is_active);
      // Backend changes the parent and all linked children together.
      await load();
    } catch (e) {
      setError(e.message || "Не удалось изменить статус семьи");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!parentToDelete) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteUser(parentToDelete.id);
      setParentToDelete(null);
      await load();
    } catch (e) {
      setDeleteError(e.message || "Не удалось удалить аккаунт");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <DashboardShell
      role="admin"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск родителей..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="space-y-8 pb-10 mt-4">
        <div>
          <h2 className="font-headline-md text-headline-md text-primary mb-2">Родители</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Управление аккаунтами родителей. Бан или восстановление применяется ко всей семье, удаление — к родителю и его детям.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по ФИО, email или телефону..."
            className="w-full max-w-xl bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {error && <div className="p-3 rounded-lg bg-error-container text-on-error-container">{error}</div>}

        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-surface-container text-on-surface-variant text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-4">Родитель</th>
                  <th className="px-5 py-4">Контакты</th>
                  <th className="px-5 py-4">Дети</th>
                  <th className="px-5 py-4">Статус</th>
                  <th className="px-5 py-4 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {loading && (
                  <tr><td colSpan="5" className="px-5 py-10 text-center text-on-surface-variant">Загрузка...</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan="5" className="px-5 py-10 text-center text-on-surface-variant">Родители не найдены</td></tr>
                )}
                {!loading && filtered.map((parent) => {
                  const active = parent.is_active !== false;
                  const busy = busyId === parent.id;
                  return (
                    <tr key={parent.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-bold text-on-surface">{fullName(parent)}</div>
                        <div className="text-xs text-on-surface-variant">ID: {parent.id}</div>
                      </td>
                      <td className="px-5 py-4 text-sm text-on-surface-variant">
                        <div>{parent.email || "—"}</div>
                        <div>{parent.phone || "—"}</div>
                      </td>
                      <td className="px-5 py-4 text-sm text-on-surface">
                        {childrenCount[parent.id] == null ? "—" : childrenCount[parent.id]}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${active ? "bg-green-100 text-green-700" : "bg-error-container text-error"}`}>
                          {active ? "Активен" : "Заблокирован"}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => toggleBan(parent)}
                            disabled={busy}
                            className={`px-3 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 ${active ? "bg-error-container text-error hover:brightness-95" : "bg-primary-container text-on-primary-container hover:brightness-95"}`}
                          >
                            {busy ? "..." : active ? "Заблокировать" : "Разблокировать"}
                          </button>
                          <button
                            onClick={() => { setDeleteError(""); setParentToDelete(parent); }}
                            className="px-3 py-2 rounded-lg bg-error text-on-error text-sm font-bold hover:brightness-110 transition-all"
                          >
                            Удалить
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmDeleteModal
        open={!!parentToDelete}
        title="Удалить аккаунт родителя?"
        itemLabel={parentToDelete ? fullName(parentToDelete) : ""}
        description="Будет безвозвратно удалён аккаунт родителя и все связанные с ним аккаунты детей. Действие необратимо."
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => (deleteBusy ? null : setParentToDelete(null))}
        onConfirm={handleDelete}
      />
    </DashboardShell>
  );
}
