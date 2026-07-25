import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchContracts } from "../../api/contracts.js";
import { fetchMyPeople } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const PAYMENT_STATUS_LABEL = {
  paid: "Оплачено",
  unpaid: "Ожидание",
};

function formatMoney(n) {
  return `₽ ${Number(n ?? 0).toLocaleString("ru-RU")}`;
}

export default function AdminFinance() {
  const { user } = useAuth();

  const [contracts, setContracts] = useState([]);
  const [studentsById, setStudentsById] = useState({});
  const [parentsById, setParentsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [contractsRes, peopleRes] = await Promise.all([fetchContracts(), fetchMyPeople()]);
        if (cancelled) return;
        setContracts(contractsRes?.items ?? []);
        const sMap = {};
        (peopleRes?.students ?? []).forEach((s) => (sMap[s.id] = s));
        setStudentsById(sMap);
        const pMap = {};
        (peopleRes?.parents ?? []).forEach((p) => (pMap[p.id] = p));
        setParentsById(pMap);
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось загрузить финансовые данные");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalRevenue = useMemo(
    () => contracts.reduce((sum, c) => sum + (c.payment_status === "paid" ? Number(c.amount) || 0 : 0), 0),
    [contracts]
  );
  const unpaidContracts = useMemo(() => contracts.filter((c) => c.payment_status !== "paid"), [contracts]);

  return (
    <DashboardShell role="admin" user={toSidebarUser(user)} searchPlaceholder="Поиск по договорам..." userLabel={fullName(user)} avatarUrl={user?.avatar_url}>
      <div className="mt-4 pb-stack-lg">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary mb-1">Финансовый обзор</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Управление доходами и договорами учебного центра.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl text-primary">account_balance_wallet</span>
            </div>
            <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-2">Общая выручка (оплачено)</p>
            <h3 className="font-display-lg text-display-lg text-on-surface">{loading ? "…" : formatMoney(totalRevenue)}</h3>
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl text-error">warning</span>
            </div>
            <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-2">Ожидают оплаты</p>
            <div className="flex items-center gap-2 mt-4 text-error font-bold">
              <span className="material-symbols-outlined">priority_high</span>
              <span className="text-sm">{loading ? "…" : `${unpaidContracts.length} договоров требуют внимания`}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high overflow-hidden">
            <div className="p-6 border-b border-surface-container-high flex justify-between items-center">
              <h4 className="font-headline-sm text-headline-sm text-on-surface">Все договоры</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low/50">
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Ученик / Родитель</th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Период</th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Сумма</th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Оплата</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-high">
                  {!loading && contracts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-on-surface-variant">Договоров пока нет</td>
                    </tr>
                  )}
                  {contracts.map((c) => {
                    const student = studentsById[c.student_id];
                    const parent = parentsById[c.parent_id];
                    return (
                      <tr key={c.id} className="hover:bg-surface-container-low/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-label-md text-label-md font-bold text-on-surface">
                            {student ? fullName(student) : `Ученик #${c.student_id}`}
                          </div>
                          <div className="text-xs text-on-surface-variant">{parent ? fullName(parent) : `Родитель #${c.parent_id}`}</div>
                        </td>
                        <td className="px-6 py-4 font-body-md text-body-md text-on-surface-variant">{c.start_date} — {c.end_date}</td>
                        <td className="px-6 py-4 font-body-md text-body-md font-semibold text-on-surface">{formatMoney(c.amount)}</td>
                        <td className="px-6 py-4">
                          <StatusBadge status={PAYMENT_STATUS_LABEL[c.payment_status] ?? c.payment_status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high flex flex-col h-full">
            <div className="p-6 border-b border-surface-container-high flex justify-between items-center">
              <h4 className="font-headline-sm text-headline-sm text-on-surface">Ожидают оплаты</h4>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {unpaidContracts.length === 0 && (
                <p className="text-sm text-on-surface-variant p-2">Все договоры оплачены.</p>
              )}
              {unpaidContracts.map((c) => {
                const student = studentsById[c.student_id];
                return (
                  <div key={c.id} className="p-4 rounded-xl border border-surface-container-high hover:border-primary-fixed transition-all group">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="font-label-md text-label-md font-bold text-on-surface">Договор №{c.id}</span>
                        <p className="text-xs text-on-surface-variant">до {c.end_date}</p>
                      </div>
                      <span className="text-primary font-bold text-sm">{formatMoney(c.amount)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center text-primary">
                        <span className="material-symbols-outlined text-sm">person</span>
                      </div>
                      <span className="text-sm font-medium">{student ? fullName(student) : `Ученик #${c.student_id}`}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
