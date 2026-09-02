import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import ConfirmDeleteModal from "../../components/ui/ConfirmDeleteModal.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchBranches, createBranch, deleteBranch, createBranchOwner, fetchMyPeople, setUserActive, fetchDeletedBranches } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";
import { sanitizePhoneInput, isValidPhone } from "../../utils/phone.js";
import { usePagination } from "../../utils/usePagination.js";
import Pagination from "../../components/ui/Pagination.jsx";

const EMPTY_FORM = { name: "", city: "", address: "", phone: "" };

const EMPTY_OWNER_FORM = {
  last_name: "",
  first_name: "",
  patronymic: "",
  email: "",
  phone: "",
  branch_id: "",
};

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

  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [ownerForm, setOwnerForm] = useState(EMPTY_OWNER_FORM);
  const [ownerStatus, setOwnerStatus] = useState("");
  const [ownerSuccess, setOwnerSuccess] = useState(null);

  const [branchOwners, setBranchOwners] = useState([]);
  const [ownersLoading, setOwnersLoading] = useState(true);
  const [ownersError, setOwnersError] = useState("");

  const [ownerToDelete, setOwnerToDelete] = useState(null);
  const [ownerDeleteBusy, setOwnerDeleteBusy] = useState(false);
  const [ownerDeleteError, setOwnerDeleteError] = useState("");

  // Раздел "Удалённые филиалы" — филиалы, помеченные deleted_at на бэкенде
  // (см. api/users.js:fetchDeletedBranches). Сам филиал не стирается,
  // поэтому здесь можно развернуть карточку и посмотреть, какие
  // преподаватели и ученики в нём были (руководители филиала к этому
  // моменту уже удалены полностью — см. DeleteBranch на бэкенде).
  const [deletedBranches, setDeletedBranches] = useState([]);
  const [deletedLoading, setDeletedLoading] = useState(true);
  const [deletedError, setDeletedError] = useState("");
  const [expandedDeletedId, setExpandedDeletedId] = useState(null);
  // members[branchId] = { loading, error, tutors: [], students: [] }
  const [deletedMembers, setDeletedMembers] = useState({});

  const { page, setPage, pageItems: pagedBranches } = usePagination(branches, 10);

  async function loadDeletedBranches() {
    setDeletedLoading(true);
    setDeletedError("");
    try {
      const res = await fetchDeletedBranches();
      setDeletedBranches(res?.items ?? []);
    } catch (e) {
      setDeletedError(e.message || "Не удалось загрузить удалённые филиалы");
    } finally {
      setDeletedLoading(false);
    }
  }

  // Преподаватели и ученики удалённого филиала по-прежнему хранят его
  // branch_id (см. комментарий к deleteBranch), поэтому переиспользуем
  // тот же справочник "мои люди" с фильтром по этому филиалу.
  async function toggleDeletedBranch(branchId) {
    if (expandedDeletedId === branchId) {
      setExpandedDeletedId(null);
      return;
    }
    setExpandedDeletedId(branchId);
    if (deletedMembers[branchId]) return;

    setDeletedMembers((m) => ({ ...m, [branchId]: { loading: true, error: "", tutors: [], students: [] } }));
    try {
      const res = await fetchMyPeople({ branch_id: branchId });
      setDeletedMembers((m) => ({
        ...m,
        [branchId]: { loading: false, error: "", tutors: res?.tutors ?? [], students: res?.students ?? [] },
      }));
    } catch (e) {
      setDeletedMembers((m) => ({
        ...m,
        [branchId]: { loading: false, error: e.message || "Не удалось загрузить список", tutors: [], students: [] },
      }));
    }
  }

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

  // Руководители филиалов — берём из общего справочника "мои люди" (см.
  // user-service handlers/user_handler.go:List): для owner без фильтра
  // branch_id приходят руководители всех филиалов сети. Деактивированных
  // (is_active=false) в таблице не показываем — с точки зрения этого экрана
  // они уже "удалены" (см. handleConfirmDeleteOwner).
  async function loadOwners() {
    setOwnersLoading(true);
    setOwnersError("");
    try {
      const res = await fetchMyPeople();
      const list = (res?.branch_owners ?? []).filter((o) => o.is_active !== false);
      setBranchOwners(list);
    } catch (e) {
      setOwnersError(e.message || "Не удалось загрузить список руководителей филиалов");
    } finally {
      setOwnersLoading(false);
    }
  }

  useEffect(() => {
    load();
    loadOwners();
    loadDeletedBranches();
  }, []);

  function openAddModal() {
    setAddForm(EMPTY_FORM);
    setAddStatus("");
    setShowAddModal(true);
  }

  async function handleAddBranch(e) {
    e.preventDefault();
    if (!addForm.name || !addForm.city) return;
    if (!isValidPhone(addForm.phone)) {
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
      setBranches((list) => [...list, created]);
      setShowAddModal(false);
    } catch (err) {
      setAddStatus(err.message || "Не удалось создать филиал");
    }
  }

  function openOwnerModal() {
    setOwnerForm(EMPTY_OWNER_FORM);
    setOwnerStatus("");
    setOwnerSuccess(null);
    setShowOwnerModal(true);
  }

  async function handleAddOwner(e) {
    e.preventDefault();
    if (!ownerForm.last_name || !ownerForm.first_name || !ownerForm.email || !ownerForm.branch_id) return;
    if (!isValidPhone(ownerForm.phone)) {
      setOwnerStatus("Введите телефон в формате из 10-15 цифр (можно с +)");
      return;
    }
    setOwnerStatus("saving");
    try {
      const res = await createBranchOwner({
        last_name: ownerForm.last_name,
        first_name: ownerForm.first_name,
        patronymic: ownerForm.patronymic || undefined,
        email: ownerForm.email,
        phone: ownerForm.phone || undefined,
        branch_id: Number(ownerForm.branch_id),
      });
      setOwnerStatus("");
      // Пароль на сервере не возвращается (уходит только на почту), поэтому
      // подтверждаем создание нейтральным сообщением, без вывода пароля в UI.
      const createdUser = res?.user ?? res;
      setOwnerSuccess({ email: createdUser?.email || ownerForm.email });
      if (createdUser?.id) {
        setBranchOwners((list) => [...list, createdUser]);
      }
    } catch (err) {
      setOwnerStatus(err.message || "Не удалось создать руководителя филиала");
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
      // Руководители удалённого филиала полностью стёрты на бэкенде —
      // обновляем их таблицу, иначе они "зависнут" в списке до перезагрузки.
      loadOwners();
      loadDeletedBranches();
    } catch (err) {
      setDeleteError(err.message || "Не удалось удалить филиал");
    } finally {
      setDeleteBusy(false);
    }
  }

  // "Удаление" руководителя филиала — деактивация аккаунта (is_active=false).
  // Сам пользователь при этом не стирается из базы (история договоров,
  // авторства курсов и т.д. остаётся консистентной), но: 1) все его
  // refresh-токены отзываются на бэкенде (см. SetStatus в user_handler.go),
  // то есть активные сессии сразу обрываются; 2) войти по старому паролю он
  // больше не сможет — учётная запись фактически сброшена. Из этой таблицы
  // он пропадает сразу после подтверждения (см. loadOwners — деактивированных не показываем).
  async function handleConfirmDeleteOwner() {
    if (!ownerToDelete) return;
    setOwnerDeleteBusy(true);
    setOwnerDeleteError("");
    try {
      await setUserActive(ownerToDelete.id, false);
      setBranchOwners((list) => list.filter((o) => o.id !== ownerToDelete.id));
      setOwnerToDelete(null);
    } catch (err) {
      setOwnerDeleteError(err.message || "Не удалось удалить руководителя филиала");
    } finally {
      setOwnerDeleteBusy(false);
    }
  }

  const branchNameById = branches.reduce((acc, b) => {
    acc[b.id] = b.name;
    return acc;
  }, {});

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

          <div className="flex items-center gap-3">
            <button
              onClick={openOwnerModal}
              className="bg-surface-container-lowest border border-outline-variant text-primary px-6 py-2.5 rounded-lg font-label-md text-label-md flex items-center gap-2 hover:bg-surface-container-low transition-all active:scale-95 shadow-sm"
            >
              <span className="material-symbols-outlined">person_add</span>
              Добавить руководителя филиала
            </button>
            <button
              onClick={openAddModal}
              className="bg-primary text-on-primary px-6 py-2.5 rounded-lg font-label-md text-label-md flex items-center gap-2 hover:brightness-110 transition-all active:scale-95 shadow-sm"
            >
              <span className="material-symbols-outlined">add_business</span>
              Добавить филиал
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
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
                {pagedBranches.map((b) => (
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

          <div className="md:hidden divide-y divide-outline-variant">
            {!loading && branches.length === 0 && (
              <div className="px-4 py-10 text-center text-on-surface-variant">Филиалов пока нет</div>
            )}
            {loading && <div className="px-4 py-10 text-center text-on-surface-variant">Загрузка...</div>}
            {pagedBranches.map((b) => (
              <div key={b.id} className="p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-on-surface">{b.name}</div>
                    <div className="text-[12px] text-outline">ID: {b.id} · {b.city}</div>
                  </div>
                  <button
                    onClick={() => {
                      setDeleteError("");
                      setBranchToDelete(b);
                    }}
                    className="shrink-0 p-1.5 -m-1.5 text-error"
                    aria-label="Удалить филиал"
                  >
                    <span className="material-symbols-outlined text-[20px]">delete</span>
                  </button>
                </div>
                <div className="text-[12px] text-on-surface-variant">{b.address || "—"}</div>
                <div className="text-[12px] text-on-surface-variant">{b.phone || "—"}</div>
              </div>
            ))}
          </div>
        </div>
        <Pagination page={page} pageSize={10} total={branches.length} onPageChange={setPage} itemLabel="филиалов" />

        <div>
          <h2 className="font-headline-md text-headline-md text-primary mb-1">Руководители филиалов</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mb-4">
            Учётные записи с ролью «руководитель филиала» по всей сети
          </p>

          {ownersError && (
            <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md mb-4">
              {ownersError}
            </div>
          )}

          <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-surface-container-low text-on-surface-variant border-b border-outline-variant">
                  <tr>
                    <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">ФИО</th>
                    <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Email</th>
                    <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Телефон</th>
                    <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Филиал</th>
                    <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {!ownersLoading && branchOwners.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center text-on-surface-variant">
                        Руководителей филиалов пока нет
                      </td>
                    </tr>
                  )}
                  {ownersLoading && (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center text-on-surface-variant">
                        Загрузка...
                      </td>
                    </tr>
                  )}
                  {branchOwners.map((o) => (
                    <tr key={o.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-label-md text-label-md font-bold text-on-surface">{fullName(o)}</div>
                        <div className="text-[12px] text-outline">ID: {o.id}</div>
                      </td>
                      <td className="px-6 py-4 text-label-md font-label-md text-on-surface-variant">{o.email}</td>
                      <td className="px-6 py-4 text-label-md font-label-md text-on-surface-variant whitespace-nowrap">
                        {o.phone || "—"}
                      </td>
                      <td className="px-6 py-4 text-label-md font-label-md">
                        {branchNameById[o.branch_id] || (o.branch_id ? `Филиал #${o.branch_id}` : "—")}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => {
                            setOwnerDeleteError("");
                            setOwnerToDelete(o);
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

            <div className="md:hidden divide-y divide-outline-variant">
              {!ownersLoading && branchOwners.length === 0 && (
                <div className="px-4 py-10 text-center text-on-surface-variant">Руководителей филиалов пока нет</div>
              )}
              {ownersLoading && <div className="px-4 py-10 text-center text-on-surface-variant">Загрузка...</div>}
              {branchOwners.map((o) => (
                <div key={o.id} className="p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-on-surface truncate">{fullName(o)}</div>
                      <div className="text-[12px] text-outline">ID: {o.id}</div>
                    </div>
                    <button
                      onClick={() => {
                        setOwnerDeleteError("");
                        setOwnerToDelete(o);
                      }}
                      className="shrink-0 p-1.5 -m-1.5 text-error"
                      aria-label="Удалить руководителя"
                    >
                      <span className="material-symbols-outlined text-[20px]">delete</span>
                    </button>
                  </div>
                  <div className="text-[12px] text-on-surface-variant truncate">{o.email}</div>
                  <div className="text-[12px] text-on-surface-variant">{o.phone || "—"}</div>
                  <div className="text-[12px] text-on-surface">
                    {branchNameById[o.branch_id] || (o.branch_id ? `Филиал #${o.branch_id}` : "—")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <h2 className="font-headline-md text-headline-md text-primary mb-1">Удалённые филиалы</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mb-4">
            Филиалы, закрытые ранее. Руководители этих филиалов удалены полностью, но здесь можно
            посмотреть, какие преподаватели и ученики в них были.
          </p>

          {deletedError && (
            <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md mb-4">
              {deletedError}
            </div>
          )}

          <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-surface-container-low text-on-surface-variant border-b border-outline-variant">
                  <tr>
                    <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Название</th>
                    <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Город</th>
                    <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Удалён</th>
                    <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {!deletedLoading && deletedBranches.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-on-surface-variant">
                        Удалённых филиалов нет
                      </td>
                    </tr>
                  )}
                  {deletedLoading && (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-on-surface-variant">
                        Загрузка...
                      </td>
                    </tr>
                  )}
                  {deletedBranches.map((b) => {
                    const isOpen = expandedDeletedId === b.id;
                    const members = deletedMembers[b.id];
                    return (
                      <Fragment key={b.id}>
                        <tr className="hover:bg-surface-container-low transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-label-md text-label-md font-bold text-on-surface">{b.name}</div>
                            <div className="text-[12px] text-outline">ID: {b.id}</div>
                          </td>
                          <td className="px-6 py-4 text-label-md font-label-md">{b.city}</td>
                          <td className="px-6 py-4 text-label-md font-label-md text-on-surface-variant whitespace-nowrap">
                            {b.deleted_at ? new Date(b.deleted_at).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => toggleDeletedBranch(b.id)}
                              className="inline-flex items-center gap-1 text-primary font-bold text-label-md hover:underline"
                            >
                              <span className="material-symbols-outlined text-[18px]">
                                {isOpen ? "expand_less" : "expand_more"}
                              </span>
                              {isOpen ? "Свернуть" : "Посмотреть учителей и учеников"}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={4} className="px-6 pb-6 pt-0 bg-surface-container-low">
                              {members?.loading && (
                                <p className="text-label-md font-label-md text-on-surface-variant py-3">Загрузка...</p>
                              )}
                              {members?.error && <p className="text-label-md font-label-md text-error py-3">{members.error}</p>}
                              {members && !members.loading && !members.error && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3">
                                  <div>
                                    <h4 className="font-label-md text-label-md font-bold text-on-surface mb-2">
                                      Преподаватели ({members.tutors.length})
                                    </h4>
                                    {members.tutors.length === 0 ? (
                                      <p className="text-[13px] text-on-surface-variant">Преподавателей не было</p>
                                    ) : (
                                      <ul className="space-y-1">
                                        {members.tutors.map((t) => (
                                          <li key={t.id}>
                                            <Link
                                              to={`/admin/teachers/${t.id}`}
                                              className="text-[13px] text-primary hover:underline"
                                            >
                                              {fullName(t)} <span className="text-outline">— {t.email}</span>
                                            </Link>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                  <div>
                                    <h4 className="font-label-md text-label-md font-bold text-on-surface mb-2">
                                      Ученики ({members.students.length})
                                    </h4>
                                    {members.students.length === 0 ? (
                                      <p className="text-[13px] text-on-surface-variant">Учеников не было</p>
                                    ) : (
                                      <ul className="space-y-1">
                                        {members.students.map((s) => (
                                          <li key={s.id}>
                                            <Link
                                              to={`/admin/students/${s.id}`}
                                              className="text-[13px] text-primary hover:underline"
                                            >
                                              {fullName(s)} <span className="text-outline">— {s.email}</span>
                                            </Link>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
                  onChange={(e) => setAddForm((f) => ({ ...f, phone: sanitizePhoneInput(e.target.value) }))}
                  placeholder="+7..."
                  inputMode="tel"
                  type="tel"
                  pattern="^\+?\d{10,15}$"
                  title="10-15 цифр, можно с ведущим +"
                  maxLength={16}
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

      {/* Модалка добавления руководителя филиала */}
      {showOwnerModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowOwnerModal(false)}>
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Добавить руководителя филиала</h3>
              <button onClick={() => setShowOwnerModal(false)} className="p-1 hover:bg-surface-container-high rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {ownerSuccess ? (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-primary-container text-on-primary-container font-label-md text-label-md">
                  Руководитель филиала создан. Логин ({ownerSuccess.email}) и временный пароль отправлены на указанную почту.
                </div>
                <button
                  onClick={() => setShowOwnerModal(false)}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all"
                >
                  Готово
                </button>
              </div>
            ) : (
              <form onSubmit={handleAddOwner} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Фамилия *</label>
                    <input
                      required
                      value={ownerForm.last_name}
                      onChange={(e) => setOwnerForm((f) => ({ ...f, last_name: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Имя *</label>
                    <input
                      required
                      value={ownerForm.first_name}
                      onChange={(e) => setOwnerForm((f) => ({ ...f, first_name: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Отчество</label>
                    <input
                      value={ownerForm.patronymic}
                      onChange={(e) => setOwnerForm((f) => ({ ...f, patronymic: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Email *</label>
                    <input
                      required
                      type="email"
                      value={ownerForm.email}
                      onChange={(e) => setOwnerForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="На эту почту придут логин и пароль"
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Телефон</label>
                    <input
                      value={ownerForm.phone}
                      onChange={(e) => setOwnerForm((f) => ({ ...f, phone: sanitizePhoneInput(e.target.value) }))}
                      placeholder="+7..."
                      inputMode="tel"
                      type="tel"
                      pattern="^\+?\d{10,15}$"
                      title="10-15 цифр, можно с ведущим +"
                      maxLength={16}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Филиал *</label>
                  <select
                    required
                    value={ownerForm.branch_id}
                    onChange={(e) => setOwnerForm((f) => ({ ...f, branch_id: e.target.value }))}
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

                <p className="text-[12px] text-on-surface-variant">
                  После создания аккаунта на указанную почту автоматически придёт письмо с логином (email) и временным паролем для входа.
                </p>

                {ownerStatus && ownerStatus !== "saving" && <p className="text-sm text-error">{ownerStatus}</p>}

                <button
                  type="submit"
                  disabled={ownerStatus === "saving"}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
                >
                  {ownerStatus === "saving" ? "Создание..." : "Создать руководителя филиала"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Удаление филиала — двойное подтверждение (ввод названия + финальный клик) */}
      <ConfirmDeleteModal
        open={!!branchToDelete}
        title="Удалить филиал?"
        itemLabel={branchToDelete?.name}
        description="Руководители этого филиала будут удалены полностью, без возможности восстановления. Преподаватели и ученики не удалятся, а сам филиал переместится в раздел «Удалённые филиалы» — там его всегда можно будет посмотреть."
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => (deleteBusy ? null : setBranchToDelete(null))}
        onConfirm={handleConfirmDelete}
      />

      {/* Удаление руководителя филиала — по факту деактивация аккаунта:
          логин/пароль перестают работать, активные сессии обрываются
          (см. handleConfirmDeleteOwner). Двойное подтверждение — та же
          защита, что и для филиалов, т.к. действие тоже затрагивает доступ
          живого человека к системе. */}
      <ConfirmDeleteModal
        open={!!ownerToDelete}
        title="Удалить руководителя филиала?"
        itemLabel={ownerToDelete ? fullName(ownerToDelete) : ""}
        description="Учётная запись будет деактивирована: логин и пароль перестанут работать, все активные сессии этого пользователя будут завершены."
        busy={ownerDeleteBusy}
        error={ownerDeleteError}
        onCancel={() => (ownerDeleteBusy ? null : setOwnerToDelete(null))}
        onConfirm={handleConfirmDeleteOwner}
      />
    </DashboardShell>
  );
}
