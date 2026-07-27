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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high">
            <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-2">Оплачено</p>
            <h3 className="font-display-lg text-display-lg text-on-surface">{loading ? "…" : formatMoney(totalPaid)}</h3>
          </div>
          <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high">
            <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-2">К оплате</p>
            <h3 className="font-display-lg text-display-lg text-warning">{loading ? "…" : formatMoney(totalDue)}</h3>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high overflow-hidden">
          <div className="p-6 border-b border-surface-container-high">
            <h4 className="font-headline-sm text-headline-sm text-on-surface">Все договоры</h4>
          </div>
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
              {!loading && contracts.map((c) => {
                const child = childrenById[c.student_id];
                const course = coursesById[c.course_id];
                const expiring = isExpiringSoon(c.end_date) && c.status !== "terminated";
                return (
                  <tr key={c.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-6 py-5 font-label-md font-bold text-on-surface">{c.contract_number || `№${c.id}`}</td>
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

        <footer className="pt-6 text-center border-t border-outline-variant/30 text-on-surface-variant text-[13px] opacity-60">
          © 2026 Study Room Education Portal. Все права защищены.
        </footer>
      </div>
    </DashboardShell>
  );
}
