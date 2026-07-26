import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import Pagination from "../../components/ui/Pagination.jsx";
import { usePagination } from "../../utils/usePagination.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchContracts, createContract } from "../../api/contracts.js";
import { fetchMyPeople, fetchBranches } from "../../api/users.js";
import { fetchCourses } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const PAYMENT_STATUS_LABEL = {
  paid: "Оплачено",
  unpaid: "Ожидание",
};

const CONTRACTS_PAGE_SIZE = 8;
const UNPAID_PAGE_SIZE = 5;

const EMPTY_CONTRACT_FORM = {
  student_id: "",
  parent_id: "",
  course_id: "",
  branch_id: "",
  amount: "",
  start_date: "",
  end_date: "",
};

function formatMoney(n) {
  return `₽ ${Number(n ?? 0).toLocaleString("ru-RU")}`;
}

export default function AdminFinance() {
  const { user } = useAuth();

  const [contracts, setContracts] = useState([]);
  const [studentsById, setStudentsById] = useState({});
  const [parentsById, setParentsById] = useState({});
  const [people, setPeople] = useState({ students: [], parents: [] });
  const [branches, setBranches] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_CONTRACT_FORM);
  const [addStatus, setAddStatus] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [contractsRes, peopleRes, branchesRes, coursesRes] = await Promise.all([
        fetchContracts(),
        fetchMyPeople(),
        fetchBranches().catch(() => ({ items: [] })),
        fetchCourses().catch(() => ({ items: [] })),
      ]);
      setContracts(contractsRes?.items ?? []);
      setPeople({ students: peopleRes?.students ?? [], parents: peopleRes?.parents ?? [] });
      setBranches(branchesRes?.items ?? []);
      setCourses(coursesRes?.items ?? []);
      const sMap = {};
      (peopleRes?.students ?? []).forEach((s) => (sMap[s.id] = s));
      setStudentsById(sMap);
      const pMap = {};
      (peopleRes?.parents ?? []).forEach((p) => (pMap[p.id] = p));
      setParentsById(pMap);
    } catch (e) {
      setError(e.message || "Не удалось загрузить финансовые данные");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalRevenue = useMemo(
    () => contracts.reduce((sum, c) => sum + (c.payment_status === "paid" ? Number(c.amount) || 0 : 0), 0),
    [contracts]
  );
  const unpaidContracts = useMemo(() => contracts.filter((c) => c.payment_status !== "paid"), [contracts]);

  const { page: contractsPage, setPage: setContractsPage, pageItems: pagedContracts } = usePagination(
    contracts,
    CONTRACTS_PAGE_SIZE
  );
  const { page: unpaidPage, setPage: setUnpaidPage, pageItems: pagedUnpaid } = usePagination(
    unpaidContracts,
    UNPAID_PAGE_SIZE
  );

  function openAddModal() {
    setAddForm(EMPTY_CONTRACT_FORM);
    setAddStatus("");
    setShowAddModal(true);
  }

  async function handleAddContract(e) {
    e.preventDefault();
    const { student_id, parent_id, course_id, branch_id, amount, start_date, end_date } = addForm;
    if (!student_id || !parent_id || !course_id || !branch_id || !amount || !start_date || !end_date) return;
    setAddStatus("saving");
    try {
      await createContract({
        student_id: Number(student_id),
        parent_id: Number(parent_id),
        course_id: Number(course_id),
        branch_id: Number(branch_id),
        amount: Number(amount),
        start_date,
        end_date,
      });
      setAddStatus("done");
      await load(); // подтягиваем свежий список договоров
    } catch (err) {
      setAddStatus(err.message || "Не удалось создать договор");
    }
  }

  return (
    <DashboardShell role="admin" user={toSidebarUser(user)} searchPlaceholder="Поиск по договорам..." userLabel={fullName(user)} avatarUrl={user?.avatar_url}>
      <div className="mt-4 pb-stack-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-stack-md mb-8">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary mb-1">Финансовый обзор</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Управление доходами и договорами учебного центра.
            </p>
          </div>
          <button
            onClick={openAddModal}
            className="bg-primary text-on-primary px-6 py-2.5 rounded-lg font-label-md text-label-md flex items-center gap-2 hover:brightness-110 transition-all active:scale-95 shadow-sm"
          >
            <span className="material-symbols-outlined">add</span>
            Добавить договор
          </button>
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
                  {pagedContracts.map((c) => {
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
            <Pagination
              page={contractsPage}
              pageSize={CONTRACTS_PAGE_SIZE}
              total={contracts.length}
              onPageChange={setContractsPage}
              itemLabel="договоров"
            />
          </div>

          <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high flex flex-col h-full">
            <div className="p-6 border-b border-surface-container-high flex justify-between items-center">
              <h4 className="font-headline-sm text-headline-sm text-on-surface">Ожидают оплаты</h4>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {unpaidContracts.length === 0 && (
                <p className="text-sm text-on-surface-variant p-2">Все договоры оплачены.</p>
              )}
              {pagedUnpaid.map((c) => {
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
            <Pagination
              page={unpaidPage}
              pageSize={UNPAID_PAGE_SIZE}
              total={unpaidContracts.length}
              onPageChange={setUnpaidPage}
              itemLabel="договоров"
            />
          </div>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAddModal(false)}>
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Добавить договор</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-surface-container-high rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {addStatus === "done" ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-green-100 text-green-800 font-label-md text-label-md">
                  Договор создан.
                </div>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all"
                >
                  Готово
                </button>
              </div>
            ) : (
              <form onSubmit={handleAddContract} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Ученик *</label>
                    <select
                      required
                      value={addForm.student_id}
                      onChange={(e) => setAddForm((f) => ({ ...f, student_id: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    >
                      <option value="">Выберите ученика</option>
                      {people.students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {fullName(s)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Родитель *</label>
                    <select
                      required
                      value={addForm.parent_id}
                      onChange={(e) => setAddForm((f) => ({ ...f, parent_id: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    >
                      <option value="">Выберите родителя</option>
                      {people.parents.map((p) => (
                        <option key={p.id} value={p.id}>
                          {fullName(p)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Курс *</label>
                    <select
                      required
                      value={addForm.course_id}
                      onChange={(e) => setAddForm((f) => ({ ...f, course_id: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    >
                      <option value="">Выберите курс</option>
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.subject ?? c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Филиал *</label>
                    <select
                      required
                      value={addForm.branch_id}
                      onChange={(e) => setAddForm((f) => ({ ...f, branch_id: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    >
                      <option value="">Выберите филиал</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name || b.city}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Сумма, ₽ *</label>
                    <input
                      required
                      type="number"
                      min="0"
                      step="1"
                      value={addForm.amount}
                      onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Дата начала *</label>
                    <input
                      required
                      type="date"
                      value={addForm.start_date}
                      onChange={(e) => setAddForm((f) => ({ ...f, start_date: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Дата окончания *</label>
                    <input
                      required
                      type="date"
                      value={addForm.end_date}
                      onChange={(e) => setAddForm((f) => ({ ...f, end_date: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                </div>

                {addStatus && addStatus !== "saving" && addStatus !== "done" && (
                  <p className="text-sm text-error">{addStatus}</p>
                )}

                <button
                  type="submit"
                  disabled={addStatus === "saving"}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
                >
                  {addStatus === "saving" ? "Сохранение…" : "Добавить договор"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
