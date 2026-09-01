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
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 8;

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

  useEffect(() => {
    setPage(1);
  }, [search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedParents = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto">
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
                {!loading && pagedParents.map((parent) => {
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
                          <button onClick={() => toggleBan(parent)} disabled={busy} className={`px-3 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 ${active ? "bg-error-container text-error hover:brightness-95" : "bg-primary-container text-on-primary-container hover:brightness-95"}`}>
                            {busy ? "..." : active ? "Заблокировать" : "Разблокировать"}
                          </button>
                          <button onClick={() => { setDeleteError(""); setParentToDelete(parent); }} className="px-3 py-2 rounded-lg bg-error text-on-error text-sm font-bold hover:brightness-110 transition-all">
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

          {/* Mobile: cards with actions always visible — no horizontal scrolling */}
          <div className="md:hidden divide-y divide-outline-variant">
            {loading && <div className="px-4 py-10 text-center text-on-surface-variant">Загрузка...</div>}
            {!loading && filtered.length === 0 && <div className="px-4 py-10 text-center text-on-surface-variant">Родители не найдены</div>}
            {!loading && pagedParents.map((parent) => {
              const active = parent.is_active !== false;
              const busy = busyId === parent.id;
              return (
                <div key={parent.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-on-surface truncate">{fullName(parent)}</div>
                      <div className="text-xs text-on-surface-variant">ID: {parent.id}</div>
                    </div>
                    <span className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${active ? "bg-green-100 text-green-700" : "bg-error-container text-error"}`}>
                      {active ? "Активен" : "Заблокирован"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-1 text-sm text-on-surface-variant">
                    {parent.email && <div className="truncate">{parent.email}</div>}
                    {parent.phone && <div>{parent.phone}</div>}
                    <div className="text-on-surface">Детей: {childrenCount[parent.id] == null ? "—" : childrenCount[parent.id]}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button onClick={() => toggleBan(parent)} disabled={busy} className={`min-h-11 px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-50 ${active ? "bg-error-container text-error" : "bg-primary-container text-on-primary-container"}`}>
                      {busy ? "..." : active ? "Заблокировать" : "Разблокировать"}
                    </button>
                    <button onClick={() => { setDeleteError(""); setParentToDelete(parent); }} className="min-h-11 px-3 py-2 rounded-lg bg-error text-on-error text-xs font-bold">
                      Удалить
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {filtered.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-outline-variant">
              <div className="text-xs text-on-surface-variant">
                Показано {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} из {filtered.length}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="min-w-10 min-h-10 rounded-lg border border-outline-variant text-sm disabled:opacity-40">
                  ←
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).slice(Math.max(0, safePage - 3), Math.min(pageCount, safePage + 2)).map((n) => (
                  <button key={n} type="button" onClick={() => setPage(n)} className={`min-w-10 min-h-10 rounded-lg text-sm font-bold ${n === safePage ? "bg-primary text-on-primary" : "border border-outline-variant text-on-surface"}`}>
                    {n}
                  </button>
                ))}
                <button type="button" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage === pageCount} className="min-w-10 min-h-10 rounded-lg border border-outline-variant text-sm disabled:opacity-40">
                  →
                </button>
              </div>
            </div>
          )}
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
