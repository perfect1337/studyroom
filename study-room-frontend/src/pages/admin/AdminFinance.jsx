import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import Pagination from "../../components/ui/Pagination.jsx";
import { usePagination } from "../../utils/usePagination.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchContracts, createContract, updateContract, setContractStatus, setContractPaymentStatus } from "../../api/contracts.js";
import { fetchMyPeople, fetchBranches, fetchParentChildren, createStudent } from "../../api/users.js";
import { fetchCourses } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const PAYMENT_STATUS_LABEL = {
  paid: "Оплачено",
  unpaid: "Ожидание",
};

const CONTRACT_STATUS_LABEL = {
  active: "Активен",
  terminated: "Расторгнут",
  completed: "Завершён",
};

const CONTRACTS_PAGE_SIZE = 8;
const UNPAID_PAGE_SIZE = 5;

// Спец-значение в выпадающем списке детей родителя: ребёнка ещё нет в
// системе, и его личный кабинет нужно создать прямо здесь, при оформлении
// договора.
const NO_STUDENT_OPTION = "__new_student__";

const EMPTY_CONTRACT_FORM = {
  parent_id: "",
  student_id: "",
  course_id: "",
  branch_id: "",
  amount: "",
  start_date: "",
  end_date: "",
  // Поля для создания нового ученика, если его ещё нет в списке детей родителя.
  new_student_last_name: "",
  new_student_first_name: "",
  new_student_patronymic: "",
  new_student_school: "",
  new_student_class_info: "",
};

function formatMoney(n) {
  return `₽ ${Number(n ?? 0).toLocaleString("ru-RU")}`;
}

// Приводит дату из формата "YYYY-MM-DD" (или ISO со временем) к виду "12.05.2026",
// без указания времени, независимо от системной локали/часового пояса.
function formatDate(dateStr) {
  if (!dateStr) return "";
  const datePart = String(dateStr).slice(0, 10); // отрезаем время, если оно есть
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
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
  const [addFormError, setAddFormError] = useState("");
  const [parentChildren, setParentChildren] = useState([]);
  const [loadingChildren, setLoadingChildren] = useState(false);

  const [search, setSearch] = useState(""); // поиск по ФИО ученика/родителя или номеру договора
  const [showOnlyUnpaid, setShowOnlyUnpaid] = useState(false); // фильтр по клику на карточку "Ожидают оплаты"

  const [editContract, setEditContract] = useState(null); // выбранный договор для редактирования
  const [editForm, setEditForm] = useState(null);
  const [editStatus, setEditStatus] = useState("");

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

  const filteredContracts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const base = showOnlyUnpaid ? contracts.filter((c) => c.payment_status !== "paid") : contracts;
    if (!query) return base;
    return base.filter((c) => {
      const student = studentsById[c.student_id];
      const parent = parentsById[c.parent_id];
      const studentName = student ? fullName(student).toLowerCase() : "";
      const parentName = parent ? fullName(parent).toLowerCase() : "";
      const contractNo = String(c.id ?? "").toLowerCase();
      return (
        studentName.includes(query) ||
        parentName.includes(query) ||
        contractNo.includes(query) ||
        `№${contractNo}`.includes(query)
      );
    });
  }, [contracts, search, showOnlyUnpaid, studentsById, parentsById]);

  const { page: contractsPage, setPage: setContractsPage, pageItems: pagedContracts } = usePagination(
    filteredContracts,
    CONTRACTS_PAGE_SIZE
  );
  const { page: unpaidPage, setPage: setUnpaidPage, pageItems: pagedUnpaid } = usePagination(
    unpaidContracts,
    UNPAID_PAGE_SIZE
  );

  function openAddModal() {
    setAddForm(EMPTY_CONTRACT_FORM);
    setAddStatus("");
    setAddFormError("");
    setParentChildren([]);
    setShowAddModal(true);
  }

  async function handleParentChange(parentId) {
    setAddForm((f) => ({ ...f, parent_id: parentId, student_id: "" }));
    setParentChildren([]);
    if (!parentId) return;
    setLoadingChildren(true);
    try {
      const res = await fetchParentChildren(parentId);
      setParentChildren(res?.items ?? []);
    } catch {
      // Список детей не загрузился — админ всё равно сможет завести нового ученика.
      setParentChildren([]);
    } finally {
      setLoadingChildren(false);
    }
  }

  function openEditModal(contract) {
    setEditContract(contract);
    setEditForm({
      amount: contract.amount ?? "",
      end_date: contract.end_date ?? "",
      status: contract.status ?? "active",
      payment_status: contract.payment_status ?? "unpaid",
    });
    setEditStatus("");
  }

  function closeEditModal() {
    setEditContract(null);
    setEditForm(null);
    setEditStatus("");
  }

  async function handleEditContract(e) {
    e.preventDefault();
    if (!editContract || !editForm) return;
    if (editContract.start_date && editForm.end_date < editContract.start_date) {
      setEditStatus("Дата окончания договора не может быть раньше даты начала.");
      return;
    }
    setEditStatus("saving");
    try {
      const tasks = [];
      if (Number(editForm.amount) !== Number(editContract.amount) || editForm.end_date !== editContract.end_date) {
        tasks.push(updateContract(editContract.id, { amount: Number(editForm.amount), end_date: editForm.end_date }));
      }
      if (editForm.status !== editContract.status) {
        tasks.push(setContractStatus(editContract.id, editForm.status));
      }
      if (editForm.payment_status !== editContract.payment_status) {
        tasks.push(setContractPaymentStatus(editContract.id, editForm.payment_status));
      }
      await Promise.all(tasks);
      setEditStatus("done");
      await load(); // подтягиваем свежие данные по договорам
    } catch (err) {
      setEditStatus(err.message || "Не удалось сохранить изменения");
    }
  }

  async function handleAddContract(e) {
    e.preventDefault();
    setAddFormError("");
    const {
      student_id, parent_id, course_id, branch_id, amount, start_date, end_date,
      new_student_last_name, new_student_first_name, new_student_patronymic,
      new_student_school, new_student_class_info,
    } = addForm;

    const creatingNewStudent = student_id === NO_STUDENT_OPTION;

    if (!parent_id || !student_id || !course_id || !branch_id || !amount || !start_date || !end_date) {
      setAddFormError("Заполните все обязательные поля.");
      return;
    }
    if (creatingNewStudent && (!new_student_last_name.trim() || !new_student_first_name.trim())) {
      setAddFormError("Укажите фамилию и имя нового ученика.");
      return;
    }
    if (end_date < start_date) {
      setAddFormError("Дата окончания договора не может быть раньше даты начала.");
      return;
    }

    setAddStatus("saving");
    try {
      let studentId = Number(student_id);
      if (creatingNewStudent) {
        const created = await createStudent({
          last_name: new_student_last_name.trim(),
          first_name: new_student_first_name.trim(),
          patronymic: new_student_patronymic.trim() || undefined,
          school: new_student_school.trim() || undefined,
          class_info: new_student_class_info.trim() || undefined,
          branch_id: Number(branch_id),
          parent_id: Number(parent_id),
        });
        studentId = created?.id ?? created?.user?.id;
      }

      await createContract({
        student_id: studentId,
        parent_id: Number(parent_id),
        course_id: Number(course_id),
        branch_id: Number(branch_id),
        amount: Number(amount),
        start_date,
        end_date,
      });
      setAddStatus("done");
      await load(); // подтягиваем свежий список договоров (в т.ч. нового ученика)
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

          <button
            type="button"
            onClick={() => setShowOnlyUnpaid((v) => !v)}
            className={`text-left bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border relative overflow-hidden group transition-colors ${
              showOnlyUnpaid ? "border-error ring-2 ring-error/30" : "border-surface-container-high hover:border-error/50"
            }`}
          >
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl text-error">warning</span>
            </div>
            <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-2">Ожидают оплаты</p>
            <div className="flex items-center gap-2 mt-4 text-error font-bold">
              <span className="material-symbols-outlined">priority_high</span>
              <span className="text-sm">{loading ? "…" : `${unpaidContracts.length} договоров требуют внимания`}</span>
            </div>
            {showOnlyUnpaid && (
              <p className="text-xs text-error mt-2 font-normal">Фильтр активен — показаны только неоплаченные. Нажмите ещё раз, чтобы сбросить.</p>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high overflow-hidden">
            <div className="p-6 border-b border-surface-container-high flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-headline-sm text-headline-sm text-on-surface">Все договоры</h4>
                {showOnlyUnpaid && (
                  <button
                    type="button"
                    onClick={() => setShowOnlyUnpaid(false)}
                    className="flex items-center gap-1 text-xs font-bold text-error bg-error-container/40 px-2 py-1 rounded-full hover:bg-error-container/70 transition-colors"
                  >
                    Только неоплаченные
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
                  search
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по ФИО или № договора..."
                  className="bg-surface border border-outline-variant rounded-lg pl-9 pr-4 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none w-full md:w-72"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low/50">
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">№</th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Ученик / Родитель</th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Период</th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Сумма</th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Оплата</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-high">
                  {!loading && filteredContracts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-on-surface-variant">
                        {contracts.length === 0 ? "Договоров пока нет" : "Ничего не найдено"}
                      </td>
                    </tr>
                  )}
                  {pagedContracts.map((c) => {
                    const student = studentsById[c.student_id];
                    const parent = parentsById[c.parent_id];
                    return (
                      <tr
                        key={c.id}
                        onClick={() => openEditModal(c)}
                        className="hover:bg-surface-container-low/30 transition-colors cursor-pointer"
                      >
                        <td className="px-6 py-4 font-body-md text-body-md text-on-surface-variant">№{c.id}</td>
                        <td className="px-6 py-4">
                          <div className="font-label-md text-label-md font-bold text-on-surface">
                            {student ? fullName(student) : `Ученик #${c.student_id}`}
                          </div>
                          <div className="text-xs text-on-surface-variant">{parent ? fullName(parent) : `Родитель #${c.parent_id}`}</div>
                        </td>
                        <td className="px-6 py-4 font-body-md text-body-md text-on-surface-variant">{formatDate(c.start_date)} — {formatDate(c.end_date)}</td>
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
              total={filteredContracts.length}
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
                  <div
                  key={c.id}
                  onClick={() => openEditModal(c)}
                  className="p-4 rounded-xl border border-surface-container-high hover:border-primary-fixed transition-all group cursor-pointer"
                >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="font-label-md text-label-md font-bold text-on-surface">Договор №{c.id}</span>
                        <p className="text-xs text-on-surface-variant">до {formatDate(c.end_date)}</p>
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
                  {addForm.student_id === NO_STUDENT_OPTION && (
                    <>
                      {" "}Создан новый личный кабинет ученика, данные для входа отправлены родителю на электронную почту.
                    </>
                  )}
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
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Родитель *</label>
                    <select
                      required
                      value={addForm.parent_id}
                      onChange={(e) => handleParentChange(e.target.value)}
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
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Ученик *</label>
                    <select
                      required
                      disabled={!addForm.parent_id || loadingChildren}
                      value={addForm.student_id}
                      onChange={(e) => setAddForm((f) => ({ ...f, student_id: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none disabled:opacity-60"
                    >
                      <option value="">
                        {!addForm.parent_id
                          ? "Сначала выберите родителя"
                          : loadingChildren
                          ? "Загрузка детей…"
                          : "Выберите ученика"}
                      </option>
                      {parentChildren.map((s) => (
                        <option key={s.id} value={s.id}>
                          {fullName(s)}
                        </option>
                      ))}
                      {addForm.parent_id && (
                        <option value={NO_STUDENT_OPTION}>Нет ученика (создать нового)</option>
                      )}
                    </select>
                  </div>

                  {addForm.student_id === NO_STUDENT_OPTION && (
                    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 p-3 rounded-lg bg-surface-container-low/50 border border-outline-variant">
                      <div className="md:col-span-2">
                        <p className="text-[12px] font-bold text-on-surface-variant mb-1">
                          Новый ученик — личный кабинет будет создан автоматически, а данные для входа отправлены родителю на почту.
                        </p>
                      </div>
                      <div>
                        <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Фамилия *</label>
                        <input
                          required
                          type="text"
                          value={addForm.new_student_last_name}
                          onChange={(e) => setAddForm((f) => ({ ...f, new_student_last_name: e.target.value }))}
                          className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Имя *</label>
                        <input
                          required
                          type="text"
                          value={addForm.new_student_first_name}
                          onChange={(e) => setAddForm((f) => ({ ...f, new_student_first_name: e.target.value }))}
                          className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Отчество</label>
                        <input
                          type="text"
                          value={addForm.new_student_patronymic}
                          onChange={(e) => setAddForm((f) => ({ ...f, new_student_patronymic: e.target.value }))}
                          className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Школа</label>
                        <input
                          type="text"
                          value={addForm.new_student_school}
                          onChange={(e) => setAddForm((f) => ({ ...f, new_student_school: e.target.value }))}
                          className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Класс</label>
                        <input
                          type="text"
                          value={addForm.new_student_class_info}
                          onChange={(e) => setAddForm((f) => ({ ...f, new_student_class_info: e.target.value }))}
                          className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                        />
                      </div>
                    </div>
                  )}

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
                      min={addForm.start_date || undefined}
                      value={addForm.end_date}
                      onChange={(e) => setAddForm((f) => ({ ...f, end_date: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                    {addForm.start_date && addForm.end_date && addForm.end_date < addForm.start_date && (
                      <p className="text-xs text-error mt-1">Дата окончания не может быть раньше даты начала.</p>
                    )}
                  </div>
                </div>

                {addFormError && (
                  <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
                    {addFormError}
                  </div>
                )}

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

      {editContract && editForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={closeEditModal}>
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Договор №{editContract.id}</h3>
              <button onClick={closeEditModal} className="p-1 hover:bg-surface-container-high rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="text-sm text-on-surface-variant">
              <div>
                <span className="font-semibold text-on-surface">
                  {studentsById[editContract.student_id] ? fullName(studentsById[editContract.student_id]) : `Ученик #${editContract.student_id}`}
                </span>
              </div>
              <div>
                {parentsById[editContract.parent_id] ? fullName(parentsById[editContract.parent_id]) : `Родитель #${editContract.parent_id}`}
              </div>
            </div>

            {editStatus === "done" ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-green-100 text-green-800 font-label-md text-label-md">
                  Договор обновлён.
                </div>
                <button
                  onClick={closeEditModal}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all"
                >
                  Готово
                </button>
              </div>
            ) : (
              <form onSubmit={handleEditContract} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Дата начала</label>
                    <div className="w-full bg-surface-variant/40 border border-outline-variant rounded-lg px-3 py-2 text-label-md text-on-surface-variant">
                      {formatDate(editContract.start_date)}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Дата окончания *</label>
                    <input
                      required
                      type="date"
                      min={editContract.start_date || undefined}
                      value={editForm.end_date}
                      onChange={(e) => setEditForm((f) => ({ ...f, end_date: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                    {editContract.start_date && editForm.end_date && editForm.end_date < editContract.start_date && (
                      <p className="text-xs text-error mt-1">Дата окончания не может быть раньше даты начала.</p>
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Сумма, ₽ *</label>
                    <input
                      required
                      type="number"
                      min="0"
                      step="1"
                      value={editForm.amount}
                      onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Статус договора</label>
                    <select
                      value={editForm.status}
                      onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    >
                      {Object.entries(CONTRACT_STATUS_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Оплата</label>
                    <select
                      value={editForm.payment_status}
                      onChange={(e) => setEditForm((f) => ({ ...f, payment_status: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    >
                      {Object.entries(PAYMENT_STATUS_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {editStatus && editStatus !== "saving" && editStatus !== "done" && (
                  <p className="text-sm text-error">{editStatus}</p>
                )}

                <button
                  type="submit"
                  disabled={editStatus === "saving"}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
                >
                  {editStatus === "saving" ? "Сохранение…" : "Сохранить изменения"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
