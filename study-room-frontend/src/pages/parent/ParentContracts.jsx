import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchMyContracts } from "../../api/contracts.js";
import { fetchUserById } from "../../api/users.js";
import { fetchCourses } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const PAYMENT_STATUS_LABEL = {
  paid: "Оплачено",
  unpaid: "Ожидание оплаты",
};

const PAYMENT_STATUS_COLORS = {
  paid: "bg-green-100 text-green-800",
  unpaid: "bg-orange-100 text-orange-800",
};

const CONTRACT_STATUS_LABEL = {
  active: "Активен",
  terminated: "Расторгнут",
  completed: "Завершён",
};

const CONTRACT_STATUS_COLORS = {
  active: "bg-green-100 text-green-800",
  terminated: "bg-red-100 text-red-800",
  completed: "bg-blue-100 text-blue-800",
};

function formatMoney(n) {
  return `₽ ${Number(n ?? 0).toLocaleString("ru-RU")}`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const datePart = String(dateStr).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}

function isExpiringSoon(endDateStr, daysThreshold = 14) {
  if (!endDateStr) return false;
  const endDate = new Date(endDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= daysThreshold;
}

// Родитель: список своих договоров (все дети). Только просмотр —
// создание/редактирование/удаление договоров доступно только owner
// (см. api-contracts.md 3.1-3.7). Данные приходят с GET /contracts/mine.
export default function ParentContracts() {
  const { user } = useAuth();

  const [contracts, setContracts] = useState([]);
  const [childrenById, setChildrenById] = useState({});
  const [coursesById, setCoursesById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [childFilter, setChildFilter] = useState("all");
  const [expiringOnly, setExpiringOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [contractsRes, coursesRes] = await Promise.all([
          fetchMyContracts(),
          fetchCourses().catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;

        const items = contractsRes?.items ?? [];
        setContracts(items);

        const cMap = {};
        (coursesRes?.items ?? []).forEach((c) => (cMap[c.id] = c));
        setCoursesById(cMap);

        const studentIds = [...new Set(items.map((c) => c.student_id))];
        const studentResults = await Promise.all(
          studentIds.map((id) => fetchUserById(id).catch(() => null))
        );
        if (cancelled) return;
        const sMap = {};
        studentResults.forEach((s, i) => {
          if (s) sMap[studentIds[i]] = s;
        });
        setChildrenById(sMap);
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось загрузить договоры");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalPaid = useMemo(
    () => contracts.reduce((sum, c) => sum + (c.payment_status === "paid" ? Number(c.amount) || 0 : 0), 0),
    [contracts]
  );
  const totalDue = useMemo(
    () => contracts.reduce((sum, c) => sum + (c.payment_status !== "paid" ? Number(c.amount) || 0 : 0), 0),
    [contracts]
  );

  const childrenOptions = useMemo(
    () => Object.values(childrenById).sort((a, b) => fullName(a).localeCompare(fullName(b), "ru")),
    [childrenById]
  );

  const filteredContracts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contracts
      .filter((c) => {
        if (statusFilter !== "all" && c.status !== statusFilter) return false;
        if (paymentFilter !== "all" && c.payment_status !== paymentFilter) return false;
        if (childFilter !== "all" && String(c.student_id) !== childFilter) return false;
        if (expiringOnly && !(isExpiringSoon(c.end_date) && c.status !== "terminated")) return false;
        if (q) {
          const child = childrenById[c.student_id];
          const course = coursesById[c.course_id];
          const haystack = [
            c.contract_number,
            `№${c.id}`,
            child ? fullName(child) : "",
            course?.title,
            course?.subject,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aExpiring = isExpiringSoon(a.end_date) && a.status !== "terminated";
        const bExpiring = isExpiringSoon(b.end_date) && b.status !== "terminated";
        if (aExpiring !== bExpiring) return aExpiring ? -1 : 1;
        return (a.end_date || "").localeCompare(b.end_date || "");
      });
  }, [contracts, search, statusFilter, paymentFilter, childFilter, expiringOnly, childrenById, coursesById]);

  const filtersActive = search.trim() !== "" || statusFilter !== "all" || paymentFilter !== "all" || childFilter !== "all" || expiringOnly;

  const expiringCount = useMemo(
    () => contracts.filter((c) => isExpiringSoon(c.end_date) && c.status !== "terminated").length,
    [contracts]
  );

  function resetFilters() {
    setSearch("");
    setStatusFilter("all");
    setPaymentFilter("all");
    setChildFilter("all");
    setExpiringOnly(false);
  }

  return (
    <DashboardShell role="parent" user={toSidebarUser(user)} searchPlaceholder="Поиск по кабинету..." userLabel={fullName(user)} avatarUrl={user?.avatar_url}>
      <div className="mt-4 pb-stack-lg space-y-stack-lg">
        <div>
          <h2 className="font-headline-md text-headline-md text-primary mb-1">Мои договоры</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Договоры на обучение всех ваших детей.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined">task_alt</span>
            </div>
            <div className="min-w-0">
              <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-1">Оплачено</p>
              <h3 className="font-headline-sm text-headline-sm text-on-surface truncate">{loading ? "…" : formatMoney(totalPaid)}</h3>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined">pending_actions</span>
            </div>
            <div className="min-w-0">
              <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-1">К оплате</p>
              <h3 className="font-headline-sm text-headline-sm text-on-surface truncate">{loading ? "…" : formatMoney(totalDue)}</h3>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                expiringCount > 0 ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500"
              }`}
            >
              <span className="material-symbols-outlined">event_upcoming</span>
            </div>
            <div className="min-w-0">
              <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-1">Истекают скоро</p>
              <h3 className="font-headline-sm text-headline-sm text-on-surface truncate">
                {loading ? "…" : expiringCount}
              </h3>
            </div>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high p-4 md:p-5">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">search</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по № договора, ребёнку или курсу..."
                className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-outline-variant bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-md text-body-md text-on-surface"
              />
            </div>

            {childrenOptions.length > 1 && (
              <div className="relative">
                <select
                  value={childFilter}
                  onChange={(e) => setChildFilter(e.target.value)}
                  className="appearance-none pl-3 pr-9 py-2.5 rounded-lg border border-outline-variant bg-surface font-label-md text-label-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="all">Все дети</option>
                  {childrenOptions.map((c) => (
                    <option key={c.id} value={String(c.id)}>{fullName(c)}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="appearance-none pl-3 pr-9 py-2.5 rounded-lg border border-outline-variant bg-surface font-label-md text-label-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="all">Любой статус</option>
                <option value="active">Активен</option>
                <option value="completed">Завершён</option>
                <option value="terminated">Расторгнут</option>
              </select>
            </div>

            <div className="relative">
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="appearance-none pl-3 pr-9 py-2.5 rounded-lg border border-outline-variant bg-surface font-label-md text-label-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="all">Любая оплата</option>
                <option value="paid">Оплачено</option>
                <option value="unpaid">Ожидание оплаты</option>
              </select>
            </div>

            <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-outline-variant bg-surface cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={expiringOnly}
                onChange={(e) => setExpiringOnly(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant"
              />
              <span className="font-label-md text-label-md text-on-surface">Скоро истекают</span>
            </label>

            {filtersActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-3 py-2.5 rounded-lg text-primary font-label-md text-label-md hover:bg-surface-container-low transition-colors whitespace-nowrap"
              >
                Сбросить фильтры
              </button>
            )}
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high overflow-hidden">
          <div className="p-6 border-b border-surface-container-high flex items-center justify-between">
            <h4 className="font-headline-sm text-headline-sm text-on-surface">Все договоры</h4>
            <span className="text-sm text-on-surface-variant">
              {loading ? "…" : `Показано ${filteredContracts.length} из ${contracts.length}`}
            </span>
          </div>
          <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container text-on-surface-variant text-label-md font-bold uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">№ договора</th>
                <th className="px-6 py-4">Ребёнок</th>
                <th className="px-6 py-4">Курс</th>
                <th className="px-6 py-4">Сумма</th>
                <th className="px-6 py-4">Оплата</th>
                <th className="px-6 py-4">Статус</th>
                <th className="px-6 py-4 text-right">Срок действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-on-surface-variant">Загрузка…</td>
                </tr>
              )}
              {!loading && contracts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-on-surface-variant">Договоров пока нет</td>
                </tr>
              )}
              {!loading && contracts.length > 0 && filteredContracts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-on-surface-variant">
                    Ничего не найдено по заданным фильтрам.{" "}
                    <button type="button" onClick={resetFilters} className="text-primary hover:underline font-bold">
                      Сбросить фильтры
                    </button>
                  </td>
                </tr>
              )}
              {!loading && filteredContracts.map((c, idx) => {
                const child = childrenById[c.student_id];
                const course = coursesById[c.course_id];
                const expiring = isExpiringSoon(c.end_date) && c.status !== "terminated";
                return (
                  <tr
                    key={c.id}
                    className={`transition-colors hover:bg-surface-container-low ${
                      expiring ? "bg-warning/5" : idx % 2 === 1 ? "bg-surface-container-lowest" : "bg-surface"
                    }`}
                  >
                    <td className="px-6 py-5 font-label-md font-bold text-on-surface">
                      <div className="flex items-center gap-2">
                        {expiring && <span className="material-symbols-outlined text-warning text-[18px]">warning</span>}
                        {c.contract_number || `№${c.id}`}
                      </div>
                    </td>
                    <td className="px-6 py-5 font-label-md text-on-surface">{child ? fullName(child) : `#${c.student_id}`}</td>
                    <td className="px-6 py-5 font-label-md text-on-surface-variant">{course?.title ?? course?.subject ?? `Курс #${c.course_id}`}</td>
                    <td className="px-6 py-5 font-label-md font-bold text-on-surface">{formatMoney(c.amount)}</td>
                    <td className="px-6 py-5">
                      <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full uppercase ${PAYMENT_STATUS_COLORS[c.payment_status] ?? "bg-surface-container text-on-surface-variant"}`}>
                        {PAYMENT_STATUS_LABEL[c.payment_status] ?? c.payment_status}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full uppercase ${CONTRACT_STATUS_COLORS[c.status] ?? "bg-surface-container text-on-surface-variant"}`}>
                        {CONTRACT_STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <span className={`font-label-md font-bold ${expiring ? "text-warning" : "text-on-surface-variant"}`}>
                        {formatDate(c.end_date)}
                      </span>
                      {expiring && (
                        <div className="text-[11px] text-warning font-bold uppercase mt-0.5">Скоро истекает</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          {/* Мобильные карточки */}
          <div className="md:hidden divide-y divide-outline-variant/30">
            {loading && <div className="px-4 py-8 text-center text-on-surface-variant">Загрузка…</div>}
            {!loading && contracts.length === 0 && (
              <div className="px-4 py-8 text-center text-on-surface-variant">Договоров пока нет</div>
            )}
            {!loading && contracts.length > 0 && filteredContracts.length === 0 && (
              <div className="px-4 py-8 text-center text-on-surface-variant">
                Ничего не найдено по заданным фильтрам.{" "}
                <button type="button" onClick={resetFilters} className="text-primary hover:underline font-bold">
                  Сбросить фильтры
                </button>
              </div>
            )}
            {!loading && filteredContracts.map((c) => {
              const child = childrenById[c.student_id];
              const course = coursesById[c.course_id];
              const expiring = isExpiringSoon(c.end_date) && c.status !== "terminated";
              return (
                <div key={c.id} className={`p-4 flex flex-col gap-2 ${expiring ? "bg-warning/5" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-on-surface">
                      {expiring && <span className="material-symbols-outlined text-warning text-[16px]">warning</span>}
                      {c.contract_number || `№${c.id}`}
                    </div>
                    <span className={`font-bold text-[13px] ${expiring ? "text-warning" : "text-on-surface-variant"}`}>
                      {formatDate(c.end_date)}
                    </span>
                  </div>
                  <div className="text-[13px] text-on-surface">{child ? fullName(child) : `#${c.student_id}`}</div>
                  <div className="text-[13px] text-on-surface-variant">{course?.title ?? course?.subject ?? `Курс #${c.course_id}`}</div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="font-bold text-on-surface">{formatMoney(c.amount)}</span>
                    <div className="flex gap-1.5">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full uppercase ${PAYMENT_STATUS_COLORS[c.payment_status] ?? "bg-surface-container text-on-surface-variant"}`}>
                        {PAYMENT_STATUS_LABEL[c.payment_status] ?? c.payment_status}
                      </span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full uppercase ${CONTRACT_STATUS_COLORS[c.status] ?? "bg-surface-container text-on-surface-variant"}`}>
                        {CONTRACT_STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="pt-6 text-center border-t border-outline-variant/30 text-on-surface-variant text-[13px] opacity-60">
          © 2026 Study Room Education Portal. Все права защищены.
        </footer>
      </div>
    </DashboardShell>
  );
}
