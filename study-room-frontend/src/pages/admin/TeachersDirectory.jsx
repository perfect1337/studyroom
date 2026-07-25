import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchMyPeople, fetchBranches, createTutor, setTutorStatus } from "../../api/users.js";
import { fetchEnrollments } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const TUTOR_STATUS_LABEL = {
  active: "Активен",
  vacation: "В отпуске",
  sick_leave: "На больничном",
  inactive: "Неактивен",
};

// Владелец сети может выставить любой статус (включая "Неактивен"),
// управляющий филиалом — только active|vacation|sick_leave (см. api-contracts.md, 1.15).
const STATUS_OPTIONS_BY_ROLE = {
  owner: ["active", "vacation", "sick_leave", "inactive"],
  branch_owner: ["active", "vacation", "sick_leave"],
};

function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

const EMPTY_FORM = {
  last_name: "",
  first_name: "",
  patronymic: "",
  email: "",
  phone: "",
  branch_id: "",
  specialization: "",
};

/**
 * Общий раздел "Преподаватели" для двух ролей:
 * - owner (раздел /admin): видит всех учителей сети, может выбрать филиал для просмотра
 *   и добавить нового учителя (создание учителей — право только owner, см. п.1.11 контракта).
 * - branch_owner (раздел /branch): видит только учителей своего филиала (сервер сам
 *   ограничивает выборку по branch_id из JWT), кнопки добавления учителя нет вообще.
 */
export default function TeachersDirectory({ role }) {
  const { user } = useAuth();
  const isOwner = role === "owner";

  const [tutors, setTutors] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(""); // "" = все филиалы (только owner)
  const [enrollments, setEnrollments] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rowUpdating, setRowUpdating] = useState(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addStatus, setAddStatus] = useState("");
  const [createdCreds, setCreatedCreds] = useState(null);

  // Список филиалов — нужен только owner, чтобы выбрать, какой филиал смотреть, и в форме добавления.
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    fetchBranches()
      .then((res) => {
        if (!cancelled) setBranches(res?.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        // branch_id учитывается сервером только для owner — для branch_owner сервер
        // всегда возвращает учителей только его собственного филиала.
        const params = { search: search || undefined };
        if (isOwner && selectedBranch) params.branch_id = Number(selectedBranch);

        const [peopleRes, enrollRes] = await Promise.all([
          fetchMyPeople(params),
          fetchEnrollments().catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setTutors(peopleRes?.tutors ?? []);
        setEnrollments(enrollRes?.items ?? []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось загрузить список преподавателей");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    // Небольшой дебаунс на поиск, чтобы не дёргать API на каждый символ.
    const t = setTimeout(load, search ? 350 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isOwner, selectedBranch, search]);

  const activeStudentsByTutor = useMemo(() => {
    const map = {};
    enrollments.forEach((e) => {
      if (!e.tutor_id) return;
      (map[e.tutor_id] ??= new Set()).add(e.student_id);
    });
    return map;
  }, [enrollments]);

  const branchNameById = useMemo(() => {
    const map = {};
    branches.forEach((b) => (map[b.id] = b.name || b.city));
    return map;
  }, [branches]);

  const visibleTutors = useMemo(() => {
    if (statusFilter === "all") return tutors;
    return tutors.filter((t) => (t.tutor_status ?? "active") === statusFilter);
  }, [tutors, statusFilter]);

  const statusOptions = STATUS_OPTIONS_BY_ROLE[role] ?? STATUS_OPTIONS_BY_ROLE.branch_owner;

  async function handleStatusChange(tutorId, newStatus) {
    setRowUpdating(tutorId);
    const prev = tutors;
    setTutors((list) => list.map((t) => (t.id === tutorId ? { ...t, tutor_status: newStatus } : t)));
    try {
      await setTutorStatus(tutorId, newStatus);
    } catch (e) {
      setTutors(prev);
      setError(e.message || "Не удалось изменить статус преподавателя");
    } finally {
      setRowUpdating(null);
    }
  }

  function openAddModal() {
    setAddForm(EMPTY_FORM);
    setAddStatus("");
    setCreatedCreds(null);
    setShowAddModal(true);
  }

  async function handleAddTeacher(e) {
    e.preventDefault();
    if (!addForm.last_name || !addForm.first_name || !addForm.email || !addForm.branch_id) return;
    setAddStatus("saving");
    try {
      const res = await createTutor({
        email: addForm.email,
        phone: addForm.phone || undefined,
        last_name: addForm.last_name,
        first_name: addForm.first_name,
        patronymic: addForm.patronymic || undefined,
        branch_id: Number(addForm.branch_id),
        specialization: addForm.specialization || undefined,
      });
      setAddStatus("done");
      setCreatedCreds({
        email: addForm.email,
        temp_password: res?.temp_password ?? res?.temporary_password ?? res?.password ?? null,
      });
      // Обновляем список, если новый учитель попадает в текущий фильтр по филиалу.
      if (!isOwner || !selectedBranch || Number(selectedBranch) === Number(addForm.branch_id)) {
        setTutors((list) => [res?.user ?? res, ...list]);
      }
    } catch (e) {
      setAddStatus(e.message || "Не удалось создать преподавателя");
    }
  }

  return (
    <DashboardShell
      role={isOwner ? "admin" : "branch_owner"}
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск преподавателя..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="mt-4 pb-stack-lg space-y-stack-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-stack-md">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary mb-1">Преподаватели</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              {isOwner
                ? "Список преподавателей по всей сети филиалов"
                : "Список преподавателей вашего филиала"}
            </p>
          </div>

          {/* Кнопка добавления учителя — только у owner. branch_owner создавать учителей не может (см. 1.11). */}
          {isOwner && (
            <button
              onClick={openAddModal}
              className="bg-primary text-on-primary px-6 py-2.5 rounded-lg font-label-md text-label-md flex items-center gap-2 hover:brightness-110 transition-all active:scale-95 shadow-sm"
            >
              <span className="material-symbols-outlined">person_add</span>
              Добавить преподавателя
            </button>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        {/* Фильтры */}
        <section className="flex flex-col md:flex-row gap-stack-md md:items-center">
          <div className="relative w-full md:max-w-xs">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[20px]">
              search
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Имя или фамилия..."
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-full pl-10 pr-4 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0">
            {["all", "active", "vacation", "sick_leave", "inactive"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-4 py-2 rounded-full font-label-md text-label-md whitespace-nowrap transition-all ${
                  statusFilter === s
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-highest text-on-surface-variant hover:bg-primary-container hover:text-on-primary-container"
                }`}
              >
                {s === "all" ? "Все" : TUTOR_STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          {/* Выбор филиала — только у owner. branch_owner всегда видит только свой филиал. */}
          {isOwner && (
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none md:ml-auto"
            >
              <option value="">Все филиалы</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || b.city}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* Таблица преподавателей */}
        <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container-low text-on-surface-variant border-b border-outline-variant">
              <tr>
                <th className="px-6 py-4 font-label-md text-label-md">ФИО Преподавателя</th>
                <th className="px-6 py-4 font-label-md text-label-md">Специализация</th>
                {isOwner && <th className="px-6 py-4 font-label-md text-label-md">Филиал</th>}
                <th className="px-6 py-4 font-label-md text-label-md">Активные ученики</th>
                <th className="px-6 py-4 font-label-md text-label-md">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {!loading && visibleTutors.length === 0 && (
                <tr>
                  <td colSpan={isOwner ? 5 : 4} className="px-6 py-10 text-center text-on-surface-variant">
                    Преподаватели не найдены
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={isOwner ? 5 : 4} className="px-6 py-10 text-center text-on-surface-variant">
                    Загрузка...
                  </td>
                </tr>
              )}
              {visibleTutors.map((t) => {
                const studentCount = activeStudentsByTutor[t.id]?.size ?? 0;
                const status = t.tutor_status ?? "active";
                return (
                  <tr key={t.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className="h-11 w-11 rounded-lg bg-primary-fixed flex items-center justify-center font-bold text-primary">
                          {initials(t)}
                        </div>
                        <div>
                          <div className="font-body-md text-body-md font-bold text-on-surface">{fullName(t)}</div>
                          <div className="text-label-md text-on-surface-variant text-[12px]">ID: {t.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="bg-primary-fixed text-on-primary-fixed px-3 py-1 rounded-full text-label-md font-medium">
                        {t.specialization || "—"}
                      </span>
                    </td>
                    {isOwner && (
                      <td className="px-6 py-4 text-label-md font-label-md text-on-surface-variant">
                        {branchNameById[t.branch_id] || (t.branch_id ? `Филиал #${t.branch_id}` : "—")}
                      </td>
                    )}
                    <td className="px-6 py-4 font-bold text-on-surface">{studentCount}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={TUTOR_STATUS_LABEL[status] ?? status} />
                        <select
                          value={status}
                          disabled={rowUpdating === t.id}
                          onChange={(e) => handleStatusChange(t.id, e.target.value)}
                          className="text-[12px] border border-outline-variant rounded-md px-2 py-1 bg-surface-container-lowest disabled:opacity-50"
                        >
                          {statusOptions.map((s) => (
                            <option key={s} value={s}>
                              {TUTOR_STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-6 py-4 bg-surface-container-low border-t border-outline-variant flex justify-between items-center">
            <span className="text-label-md text-on-surface-variant">
              {loading ? "Загрузка..." : `Показано ${visibleTutors.length} из ${tutors.length}`}
            </span>
          </div>
        </div>
      </div>

      {/* Модалка добавления преподавателя — доступна только owner */}
      {isOwner && showAddModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAddModal(false)}>
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Добавить преподавателя</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-surface-container-high rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {createdCreds ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-green-100 text-green-800 font-label-md text-label-md">
                  Преподаватель создан. Данные для входа отправлены на почту{createdCreds.temp_password ? " и приведены ниже" : ""}.
                </div>
                <div className="text-label-md text-on-surface-variant space-y-1">
                  <div>Email: <span className="font-bold text-on-surface">{createdCreds.email}</span></div>
                  {createdCreds.temp_password && (
                    <div>Временный пароль: <span className="font-bold text-on-surface">{createdCreds.temp_password}</span></div>
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
              <form onSubmit={handleAddTeacher} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Фамилия *</label>
                    <input
                      required
                      value={addForm.last_name}
                      onChange={(e) => setAddForm((f) => ({ ...f, last_name: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Имя *</label>
                    <input
                      required
                      value={addForm.first_name}
                      onChange={(e) => setAddForm((f) => ({ ...f, first_name: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Отчество</label>
                  <input
                    value={addForm.patronymic}
                    onChange={(e) => setAddForm((f) => ({ ...f, patronymic: e.target.value }))}
                    className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Email *</label>
                    <input
                      required
                      type="email"
                      value={addForm.email}
                      onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Телефон</label>
                    <input
                      value={addForm.phone}
                      onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="+7..."
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
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
                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Специализация</label>
                  <input
                    value={addForm.specialization}
                    onChange={(e) => setAddForm((f) => ({ ...f, specialization: e.target.value }))}
                    placeholder="Например: Математика, ЕГЭ"
                    className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>

                {addStatus && addStatus !== "saving" && addStatus !== "done" && (
                  <p className="text-sm text-error">{addStatus}</p>
                )}

                <button
                  type="submit"
                  disabled={addStatus === "saving"}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
                >
                  {addStatus === "saving" ? "Сохранение..." : "Создать преподавателя"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
