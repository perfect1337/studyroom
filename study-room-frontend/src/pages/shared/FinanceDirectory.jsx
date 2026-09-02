import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
// FinanceDirectory — раздел "Финансы" (список и управление договорами).
// Общий компонент для owner (/admin/finance) и branch_owner (/branch/finance):
// у руководителя филиала — тот же функционал (просмотр, создание, изменение
// договоров, статусов и оплаты), но только в рамках своего собственного
// филиала. GET /contracts сервер сам ограничивает branch_owner его филиалом
// (см. contracts-service/ContractHandler.List), а создание/изменение/удаление
// договоров чужого филиала возвращает 403 (см. ContractHandler.checkBranchOwnerAccess) —
// поэтому здесь достаточно скрыть выбор филиала и подставить свой branch_id.
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import SearchableSelect from "../../components/ui/SearchableSelect.jsx";
import Pagination from "../../components/ui/Pagination.jsx";
import { usePagination } from "../../utils/usePagination.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchContractsFresh, fetchContractById, createContract, updateContract, setContractStatus, setContractPaymentStatus } from "../../api/contracts.js";
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

// Цвета для статусов договора
const CONTRACT_STATUS_COLORS = {
  active: "bg-green-100 text-green-800",
  terminated: "bg-red-100 text-red-800",
  completed: "bg-blue-100 text-blue-800",
};

const CONTRACTS_PAGE_SIZE = 8;
const UNPAID_PAGE_SIZE = 5;
const EXPIRING_DAYS_THRESHOLD = 5;

const NO_STUDENT_OPTION = "__new_student__";

const EMPTY_CONTRACT_FORM = {
  parent_id: "",
  student_id: "",
  course_id: "",
  branch_id: "",
  amount: "",
  start_date: "",
  end_date: "",
  new_student_last_name: "",
  new_student_first_name: "",
  new_student_patronymic: "",
  new_student_school: "",
  new_student_class_info: "",
};

function formatMoney(n) {
  return `₽ ${Number(n ?? 0).toLocaleString("ru-RU")}`;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const datePart = String(dateStr).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}

function toInputDate(dateStr) {
  if (!dateStr) return "";
  return String(dateStr).slice(0, 10);
}

// Функция для проверки, истекает ли договор в ближайшие N дней
function isExpiringSoon(endDateStr, daysThreshold = EXPIRING_DAYS_THRESHOLD) {
  if (!endDateStr) return false;
  const endDate = new Date(endDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);
  
  const diffTime = endDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays >= 0 && diffDays <= daysThreshold;
}

export default function FinanceDirectory({ role }) {
  const isOwner = role === "owner";
  const { user } = useAuth();

  const [contracts, setContracts] = useState([]);
  const [studentsById, setStudentsById] = useState({});
  const [parentsById, setParentsById] = useState({});
  const [branchesById, setBranchesById] = useState({});
  const [coursesById, setCoursesById] = useState({});
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

  const [search, setSearch] = useState("");
  const [showExpiringSoon, setShowExpiringSoon] = useState(false);
  // Фильтр по филиалу в списке договоров — доступен только owner (у
  // branch_owner все договоры и так относятся к его единственному филиалу,
  // сервер сам это гарантирует, поэтому фильтр ему не нужен).
  const [branchFilter, setBranchFilter] = useState("");

  const [editContract, setEditContract] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editStatus, setEditStatus] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [contractsRes, peopleRes, coursesRes] = await Promise.all([
        fetchContractsFresh(),
        fetchMyPeople(),
        fetchCourses().catch(() => ({ items: [] })),
      ]);
      // Владелец сети сам выбирает филиал из полного списка сети (GET /branches,
      // доступен только owner). Руководитель филиала работает только в рамках
      // своего собственного филиала — берём его из профиля (user.branch_id/
      // branch_name), отдельный запрос к /branches ему не нужен и недоступен.
      const branchesRes = isOwner
        ? await fetchBranches().catch(() => ({ items: [] }))
        : {
            items: user?.branch_id
              ? [{ id: user.branch_id, name: user.branch_name || `Филиал #${user.branch_id}` }]
              : [],
          };
      setContracts(contractsRes?.items ?? []);
      setPeople({ students: peopleRes?.students ?? [], parents: peopleRes?.parents ?? [] });
      setBranches(branchesRes?.items ?? []);
      setCourses(coursesRes?.items ?? []);
      const cMap = {};
      (coursesRes?.items ?? []).forEach((course) => (cMap[course.id] = course));
      setCoursesById(cMap);
      const sMap = {};
      (peopleRes?.students ?? []).forEach((s) => (sMap[s.id] = s));
      setStudentsById(sMap);
      const pMap = {};
      (peopleRes?.parents ?? []).forEach((p) => (pMap[p.id] = p));
      setParentsById(pMap);
      const bMap = {};
      (branchesRes?.items ?? []).forEach((b) => (bMap[b.id] = b));
      setBranchesById(bMap);
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
  
  const expiringContracts = useMemo(
    () => contracts.filter((c) => 
      isExpiringSoon(c.end_date, EXPIRING_DAYS_THRESHOLD) && 
      c.status !== "terminated"
    ),
    [contracts]
  );

  // Название филиала договора: сперва пробуем список филиалов (owner —
  // полный список сети через /branches), иначе — то, что уже пришло в
  // самом договоре (branch_owner видит только свой филиал), иначе — заглушка.
  function branchNameFor(c) {
    return branchesById[c.branch_id]?.name ?? c.branch_name ?? (c.branch_id ? `Филиал #${c.branch_id}` : "—");
  }

  function courseNameFor(c) {
    const course = coursesById[c.course_id];
    return course?.title ?? course?.subject ?? c.course_name ?? (c.course_id ? `Курс #${c.course_id}` : "—");
  }

  const filteredContracts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const base = showExpiringSoon ? expiringContracts : contracts;
    const byBranch =
      isOwner && branchFilter
        ? base.filter((c) => String(c.branch_id) === String(branchFilter))
        : base;
    if (!query) return byBranch;
    return byBranch.filter((c) => {
      const student = studentsById[c.student_id];
      const parent = parentsById[c.parent_id];
      const studentName = student ? fullName(student).toLowerCase() : "";
      const parentName = parent ? fullName(parent).toLowerCase() : "";
      const contractNo = String(c.id ?? "").toLowerCase();
      const courseName = courseNameFor(c).toLowerCase();
      return (
        studentName.includes(query) ||
        parentName.includes(query) ||
        courseName.includes(query) ||
        contractNo.includes(query) ||
        `№${contractNo}`.includes(query)
      );
    });
  }, [contracts, expiringContracts, search, showExpiringSoon, studentsById, parentsById, isOwner, branchFilter, branchesById]);

  const { page: contractsPage, setPage: setContractsPage, pageItems: pagedContracts } = usePagination(
    filteredContracts,
    CONTRACTS_PAGE_SIZE
  );
  const { page: unpaidPage, setPage: setUnpaidPage, pageItems: pagedUnpaid } = usePagination(
    unpaidContracts,
    UNPAID_PAGE_SIZE
  );

  // При изменении поиска/фильтров всегда возвращаемся на первую страницу,
  // чтобы не попадать на пустую страницу после сужения списка.
  useEffect(() => {
    setContractsPage(1);
  }, [search, showExpiringSoon, branchFilter, setContractsPage]);

  function openAddModal() {
    setAddForm(
      isOwner ? EMPTY_CONTRACT_FORM : { ...EMPTY_CONTRACT_FORM, branch_id: user?.branch_id ? String(user.branch_id) : "" }
    );
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
      setParentChildren([]);
    } finally {
      setLoadingChildren(false);
    }
  }

  async function openEditModal(contract) {
    // Статус договора — источник истины backend. Перед открытием карточки
    // повторно читаем конкретный договор по id, чтобы старый cached row не
    // мог показывать "Завершён", когда сам договор уже "Расторгнут".
    let fresh = contract;
    try {
      fresh = (await fetchContractById(contract.id)) ?? contract;
    } catch {
      // Если точечный запрос временно не удался, не блокируем интерфейс —
      // откроем последнюю известную строку.
    }
    setEditContract(fresh);
    // Синхронизируем строку таблицы с той же свежей записью, чтобы после
    // открытия договора исправленный статус был виден и в самой таблице,
    // а не только внутри карточки.
    if (fresh !== contract || fresh.status !== contract.status) {
      setContracts((prev) => prev.map((c) => (c.id === fresh.id ? { ...c, ...fresh } : c)));
    }
    setEditForm({
      amount: fresh.amount ?? "",
      start_date: toInputDate(fresh.start_date),
      end_date: toInputDate(fresh.end_date),
      status: fresh.status ?? "active",
      payment_status: fresh.payment_status ?? "unpaid",
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
    
    if (editForm.start_date && editForm.end_date && editForm.end_date < editForm.start_date) {
      setEditStatus("Дата окончания договора не может быть раньше даты начала.");
      return;
    }
    
    setEditStatus("saving");
    try {
      const tasks = [];
      if (
        Number(editForm.amount) !== Number(editContract.amount) || 
        editForm.start_date !== toInputDate(editContract.start_date) ||
        editForm.end_date !== toInputDate(editContract.end_date)
      ) {
        tasks.push(updateContract(editContract.id, { 
          amount: Number(editForm.amount), 
          start_date: editForm.start_date,
          end_date: editForm.end_date 
        }));
      }
      if (editForm.status !== editContract.status) {
        tasks.push(setContractStatus(editContract.id, editForm.status));
      }
      if (editForm.payment_status !== editContract.payment_status) {
        tasks.push(setContractPaymentStatus(editContract.id, editForm.payment_status));
      }
      await Promise.all(tasks);
      setEditStatus("done");
      await load();
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
    if (creatingNewStudent && !new_student_class_info) {
      setAddFormError("Укажите класс ученика.");
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
          class_info: new_student_class_info,
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
      await load();
    } catch (err) {
      setAddStatus(err.message || "Не удалось создать договор");
    }
  }

  return (
    <DashboardShell fullWidth role={isOwner ? "admin" : role} user={toSidebarUser(user)} searchPlaceholder="Поиск по договорам..." userLabel={fullName(user)} avatarUrl={user?.avatar_url}>
      <div className="mt-4 pb-stack-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-stack-md mb-8">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary mb-1">Финансовый обзор</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              {isOwner ? "Управление доходами и договорами учебного центра." : "Управление доходами и договорами вашего филиала."}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-6 mb-10 ${isOwner ? "xl:grid-cols-3" : ""}`}>
          {/* Выручку видит только owner (сеть в целом) — у branch_owner карточка
              скрыта, т.к. эти цифры относятся к финансам компании, а не филиала. */}
          {isOwner && (
            <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <span className="material-symbols-outlined text-6xl text-primary">account_balance_wallet</span>
              </div>
              <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-2">Общая выручка (оплачено)</p>
              <h3 className="font-display-lg text-display-lg text-on-surface">{loading ? "…" : formatMoney(totalRevenue)}</h3>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowExpiringSoon((v) => !v)}
            className={`text-left bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border relative overflow-hidden group transition-colors ${
              showExpiringSoon ? "border-warning ring-2 ring-warning/30" : "border-surface-container-high hover:border-warning/50"
            }`}
          >
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl text-warning">schedule</span>
            </div>
            <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-2">Истекают через {EXPIRING_DAYS_THRESHOLD} дней</p>
            <div className="flex items-center gap-2 mt-4 text-warning font-bold">
              <span className="material-symbols-outlined">priority_high</span>
              <span className="text-sm">{loading ? "…" : `${expiringContracts.length} договоров требуют внимания`}</span>
            </div>
            {showExpiringSoon && (
              <p className="text-xs text-warning mt-2 font-normal">Фильтр активен — показаны договоры, истекающие в ближайшие {EXPIRING_DAYS_THRESHOLD} дней. Нажмите ещё раз, чтобы сбросить.</p>
            )}
          </button>

          {/* Занимает оставшуюся колонку сетки карточек (третью у owner, вторую
              у branch_owner) — раньше кнопка стояла отдельно в шапке страницы,
              теперь она просто перенесена сюда, стиль кнопки не менялся. */}
          <div className="flex items-center justify-center">
            <button
              onClick={openAddModal}
              className="bg-primary text-on-primary px-4 py-2 sm:px-6 sm:py-2.5 lg:px-8 lg:py-3.5 rounded-lg font-label-md text-label-md lg:text-base flex items-center gap-1.5 sm:gap-2 lg:gap-2.5 hover:brightness-110 transition-all active:scale-95 shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px] sm:text-[20px] lg:text-[24px]">add</span>
              Добавить договор
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Основная таблица со всеми договорами */}
          <div className="xl:col-span-2 bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high overflow-hidden">
            <div className="p-6 border-b border-surface-container-high flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-headline-sm text-headline-sm text-on-surface">Все договоры</h4>
                {showExpiringSoon && (
                  <button
                    type="button"
                    onClick={() => setShowExpiringSoon(false)}
                    className="flex items-center gap-1 text-xs font-bold text-warning bg-warning/20 px-2 py-1 rounded-full hover:bg-warning/30 transition-colors"
                  >
                    Истекают через {EXPIRING_DAYS_THRESHOLD} дней
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
                {/* Фильтр по филиалу — только у owner: у него один список
                    договоров на всю сеть, поэтому нужен способ сузить его
                    до конкретного филиала. У branch_owner фильтр скрыт —
                    в его списке и так только договоры своего филиала. */}
                {isOwner && (
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px] pointer-events-none">
                      storefront
                    </span>
                    <select
                      value={branchFilter}
                      onChange={(e) => setBranchFilter(e.target.value)}
                      className="appearance-none bg-surface border border-outline-variant rounded-lg pl-9 pr-8 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none w-full sm:w-48"
                      style={{ appearance: "none", WebkitAppearance: "none", MozAppearance: "none", backgroundImage: "none" }}
                    >
                      <option value="">Все филиалы</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px] pointer-events-none">
                      expand_more
                    </span>
                  </div>
                )}
                <div className="relative w-full sm:w-auto">
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
            </div>
            {/* Полная таблица показывается только там, где реально хватает
                ширины на 6 колонок (широкий десктоп, тот же порог, что и у
                разбивки на 2 колонки выше) — на iPad и других планшетах,
                где сайдбар уже занимает часть экрана, вместо горизонтального
                скролла показываются карточки, как на телефоне. */}
            <div className="hidden xl:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low/50">
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">№</th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Ученик / Родитель</th>
                    {isOwner && (
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Филиал</th>
                    )}
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Курс</th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Период</th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Сумма</th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Статус</th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">Оплата</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-high">
                  {!loading && filteredContracts.length === 0 && (
                    <tr>
                      <td colSpan={isOwner ? 8 : 7} className="px-6 py-8 text-center text-on-surface-variant">
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
                        {isOwner && (
                          <td className="px-6 py-4 font-body-md text-body-md text-on-surface-variant">{branchNameFor(c)}</td>
                        )}
                        <td className="px-6 py-4 font-body-md text-body-md text-on-surface-variant">{courseNameFor(c)}</td>
                        <td className="px-6 py-4 font-body-md text-body-md text-on-surface-variant">{formatDate(c.start_date)} — {formatDate(c.end_date)}</td>
                        <td className="px-6 py-4 font-body-md text-body-md font-semibold text-on-surface">{formatMoney(c.amount)}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${CONTRACT_STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-800"}`}>
                            {CONTRACT_STATUS_LABEL[c.status] ?? c.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge status={PAYMENT_STATUS_LABEL[c.payment_status] ?? c.payment_status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Карточки — телефоны и планшеты (до xl включительно) */}
            <div className="xl:hidden divide-y divide-surface-container-high">
              {!loading && filteredContracts.length === 0 && (
                <div className="px-4 py-8 text-center text-on-surface-variant">
                  {contracts.length === 0 ? "Договоров пока нет" : "Ничего не найдено"}
                </div>
              )}
              {pagedContracts.map((c) => {
                const student = studentsById[c.student_id];
                const parent = parentsById[c.parent_id];
                return (
                  <div key={c.id} onClick={() => openEditModal(c)} className="p-4 flex flex-col gap-2 active:bg-surface-container-low/30 cursor-pointer">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-on-surface truncate">
                          {student ? fullName(student) : `Ученик #${c.student_id}`}
                        </div>
                        <div className="text-xs text-on-surface-variant truncate">{parent ? fullName(parent) : `Родитель #${c.parent_id}`}</div>
                      </div>
                      <span className="shrink-0 text-xs text-on-surface-variant">№{c.id}</span>
                    </div>
                    {isOwner && (
                      <div className="flex items-center gap-1 text-[12px] text-on-surface-variant">
                        <span className="material-symbols-outlined text-[14px]">storefront</span>
                        <span className="truncate">{branchNameFor(c)}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-[12px] text-on-surface-variant">
                      <span className="material-symbols-outlined text-[14px]">menu_book</span>
                      <span className="truncate">{courseNameFor(c)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-on-surface-variant">{formatDate(c.start_date)} — {formatDate(c.end_date)}</span>
                      <span className="font-semibold text-on-surface">{formatMoney(c.amount)}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${CONTRACT_STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-800"}`}>
                        {CONTRACT_STATUS_LABEL[c.status] ?? c.status}
                      </span>
                      <StatusBadge status={PAYMENT_STATUS_LABEL[c.payment_status] ?? c.payment_status} />
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openEditModal(c); }}
                      className="w-full min-h-11 mt-1 rounded-lg bg-primary text-on-primary text-sm font-bold active:brightness-95"
                    >
                      Открыть договор
                    </button>
                  </div>
                );
              })}
            </div>
            <Pagination
              page={contractsPage}
              pageSize={CONTRACTS_PAGE_SIZE}
              total={filteredContracts.length}
              onPageChange={setContractsPage}
              itemLabel="договоров"
            />
          </div>

          {/* Правая панель - Ожидают оплаты */}
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
                  className="p-4 rounded-xl border border-surface-container-high hover:border-error transition-all group cursor-pointer"
                >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="font-label-md text-label-md font-bold text-on-surface">Договор №{c.id}</span>
                        <p className="text-xs text-on-surface-variant">до {formatDate(c.end_date)}</p>
                      </div>
                      <span className="text-primary font-bold text-sm">{formatMoney(c.amount)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center text-error">
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

      {/* Модальное окно добавления договора */}
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
                    <SearchableSelect
                      required
                      value={addForm.parent_id}
                      onChange={handleParentChange}
                      options={people.parents.map((p) => ({ value: p.id, label: fullName(p) }))}
                      placeholder="Выберите родителя"
                      searchPlaceholder="Поиск по ФИО родителя…"
                    />
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
                        <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Класс *</label>
                        <div className="relative">
                          <select
                            required
                            value={addForm.new_student_class_info}
                            onChange={(e) => setAddForm((f) => ({ ...f, new_student_class_info: e.target.value }))}
                            className="w-full appearance-none bg-surface border border-outline-variant rounded-lg pl-3 pr-9 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                          >
                            <option value="" disabled>Выберите класс</option>
                            {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
                              <option key={n} value={String(n)}>{n} класс</option>
                            ))}
                          </select>
                        </div>
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
                          {c.title ?? c.subject}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Филиал *</label>
                    {isOwner ? (
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
                    ) : (
                      <div className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-label-md text-on-surface-variant">
                        {user?.branch_name || `Филиал #${user?.branch_id}`}
                      </div>
                    )}
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

      {/* Модальное окно редактирования договора */}
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
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Дата начала *</label>
                    <input
                      required
                      type="date"
                      value={editForm.start_date}
                      onChange={(e) => setEditForm((f) => ({ ...f, start_date: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Дата окончания *</label>
                    <input
                      required
                      type="date"
                      min={editForm.start_date || undefined}
                      value={editForm.end_date}
                      onChange={(e) => setEditForm((f) => ({ ...f, end_date: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                    {editForm.start_date && editForm.end_date && editForm.end_date < editForm.start_date && (
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