import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import Pagination from "../../components/ui/Pagination.jsx";
import { usePagination } from "../../utils/usePagination.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchMyPeople } from "../../api/users.js";
import { fetchApplications, updateApplication } from "../../api/crm.js";
import { fetchContracts } from "../../api/contracts.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const TEACHERS_PAGE_SIZE = 5;
const APPLICATIONS_PAGE_SIZE = 5;

const TUTOR_STATUS_LABEL = {
  active: "Активен",
  vacation: "В отпуске",
  sick_leave: "На больничном",
  inactive: "Неактивен",
};

function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

// OverviewDirectory — раздел "Обзор" (сводка + новые заявки + преподаватели).
// Общий компонент для owner (/admin) и branch_owner (/branch): у руководителя
// филиала — тот же функционал (выручка, новые заявки CRM, таблица
// преподавателей), но данные уже ограничены его филиалом на бэкенде
// (см. crm-service ApplicationHandler.List, contracts-service ContractHandler.List,
// user-service UserHandler.List).
export default function OverviewDirectory({ role }) {
  const isOwner = role === "owner";
  const base = isOwner ? "/admin" : "/branch";
  const { user } = useAuth();
  const navigate = useNavigate();

  const [students, setStudents] = useState([]);
  const [tutors, setTutors] = useState([]);
  const [applications, setApplications] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [applicationSearch, setApplicationSearch] = useState("");
  const [peopleSearch, setPeopleSearch] = useState("");

  const [selectedApplication, setSelectedApplication] = useState(null);
  const [applicationActionStatus, setApplicationActionStatus] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [peopleRes, applicationsRes, contractsRes] = await Promise.all([
        fetchMyPeople(),
        fetchApplications({ status: "new" }).catch(() => ({ items: [] })),
        fetchContracts().catch(() => ({ items: [] })),
      ]);
      setStudents(peopleRes?.students ?? []);
      setTutors(peopleRes?.tutors ?? []);
      setApplications(applicationsRes?.items ?? []);
      setContracts(contractsRes?.items ?? []);
    } catch (e) {
      setError(e.message || "Не удалось загрузить данные");
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

  const statsOwner = [
    { label: "Всего учеников", value: String(students.length), icon: "school" },
    { label: "Всего репетиторов", value: String(tutors.length), icon: "person_pin" },
    { label: "Выручка (оплачено)", value: `₽${totalRevenue.toLocaleString("ru-RU")}`, icon: "trending_up" },
    { label: "Новые заявки", value: String(applications.length), icon: "assignment_ind" },
  ];

   const statsBranchOwner = [
    { label: "Всего учеников", value: String(students.length), icon: "school" },
    { label: "Всего репетиторов", value: String(tutors.length), icon: "person_pin" },
    { label: "Новые заявки", value: String(applications.length), icon: "assignment_ind" },
  ];

  // Поиск по алфавиту среди заявок — фильтр по имени + сортировка А-Я.
  const visibleApplications = useMemo(() => {
    const q = applicationSearch.trim().toLowerCase();
    const filtered = q ? applications.filter((a) => (a.name ?? "").toLowerCase().includes(q)) : applications;
    return [...filtered].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ru"));
  }, [applications, applicationSearch]);

  function openApplicationModal(app) {
    setSelectedApplication(app);
    setApplicationActionStatus("");
  }

  function closeApplicationModal() {
    setSelectedApplication(null);
    setApplicationActionStatus("");
  }

  async function handleApplicationDecision(status) {
    if (!selectedApplication) return;
    setApplicationActionStatus("saving");
    try {
      await updateApplication(selectedApplication.id, { status });
      setApplicationActionStatus("done");
      await load(); // заявка уйдёт из списка "new" сама, т.к. статус сменился
    } catch (err) {
      setApplicationActionStatus(err.message || "Не удалось обновить заявку");
    }
  }

  const { page: teachersPage, setPage: setTeachersPage, pageItems: pagedTutors } = usePagination(tutors, TEACHERS_PAGE_SIZE);
  const { page: applicationsPage, setPage: setApplicationsPage, pageItems: pagedApplications } = usePagination(
    visibleApplications,
    APPLICATIONS_PAGE_SIZE
  );

  // Поиск по ученикам и учителям сразу — объединяем оба списка и фильтруем по имени.
  const peopleResults = useMemo(() => {
    const q = peopleSearch.trim().toLowerCase();
    if (!q) return [];
    const matchedStudents = students
      .filter((s) => fullName(s).toLowerCase().includes(q))
      .map((s) => ({ ...s, __kind: "student" }));
    const matchedTutors = tutors
      .filter((t) => fullName(t).toLowerCase().includes(q))
      .map((t) => ({ ...t, __kind: "tutor" }));
    return [...matchedStudents, ...matchedTutors].sort((a, b) => fullName(a).localeCompare(fullName(b), "ru"));
  }, [students, tutors, peopleSearch]);

  return (
    <DashboardShell role={isOwner ? "admin" : role} user={toSidebarUser(user)} searchPlaceholder="Поиск учеников или учителей...">
      {error && (
        <div className="mt-4 p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
      )}

      <section className="mt-4">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-[20px]">
            search
          </span>
          <input
            value={peopleSearch}
            onChange={(e) => setPeopleSearch(e.target.value)}
            placeholder="Поиск учеников или учителей..."
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-full pl-11 pr-4 py-3 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all shadow-sm"
          />
        </div>

        {peopleSearch.trim() && (
          <div className="mt-2 bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm divide-y divide-outline-variant overflow-hidden">
            {peopleResults.length === 0 && (
              <p className="px-4 py-4 text-sm text-on-surface-variant">Ничего не найдено.</p>
            )}
            {peopleResults.map((p) => (
              <Link
                key={`${p.__kind}-${p.id}`}
                to={p.__kind === "student" ? `${base}/students/${p.id}` : `${base}/teachers/${p.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface-container-low transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-primary-fixed flex items-center justify-center font-bold text-primary text-sm shrink-0">
                  {initials(p)}
                </div>
                <div className="min-w-0">
                  <p className="font-label-md text-label-md font-bold truncate">{fullName(p)}</p>
                  <p className="text-[12px] text-outline">
                    {p.__kind === "student" ? "Ученик" : `Учитель · ID: ${p.id}`}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-stack-md mb-stack-lg mt-4">
  {isOwner
    ? statsOwner.map((s) => (
        <div
          key={s.label}
          className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant flex items-center gap-4 hover:-translate-y-1 transition-transform"
        >
          <div className="w-12 h-12 bg-primary-container rounded-lg flex items-center justify-center text-on-primary-container">
            <span className="material-symbols-outlined">{s.icon}</span>
          </div>
          <div>
            <p className="text-on-surface-variant font-label-md text-label-md">{s.label}</p>
            <p className="text-headline-sm font-headline-sm text-primary">{loading ? "…" : s.value}</p>
          </div>
        </div>
      ))
    : statsBranchOwner.map((s) => (
        <div
          key={s.label}
          className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant flex items-center gap-4 hover:-translate-y-1 transition-transform"
        >
          <div className="w-12 h-12 bg-primary-container rounded-lg flex items-center justify-center text-on-primary-container">
            <span className="material-symbols-outlined">{s.icon}</span>
          </div>
          <div>
            <p className="text-on-surface-variant font-label-md text-label-md">{s.label}</p>
            <p className="text-headline-sm font-headline-sm text-primary">{loading ? "…" : s.value}</p>
          </div>
        </div>
      ))}
</section>

      <div className="pb-stack-lg">
        <section className="flex flex-col gap-stack-md">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3">
            <div>
              <h2 className="text-headline-sm font-headline-sm text-on-surface">Управление преподавателями</h2>
              <p className="text-on-surface-variant text-label-md font-label-md">
                {isOwner ? "Список репетиторов и их текущий статус" : "Список преподавателей вашего филиала и их текущий статус"}
              </p>
            </div>
            <Link
              to={`${base}/teachers`}
              className="shrink-0 bg-primary text-on-primary px-6 py-2 rounded-lg font-label-md text-label-md flex items-center justify-center gap-2 hover:bg-on-primary-fixed-variant transition-colors active:scale-95 w-full sm:w-auto"
            >
              <span className="material-symbols-outlined">person_add</span>
              Добавить учителя
            </Link>
          </div>

          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left min-w-[640px]">
              <thead className="bg-surface-container-low border-b border-outline-variant">
                <tr>
                  <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">ФИО Преподавателя</th>
                  <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Специализация</th>
                  <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {!loading && tutors.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-on-surface-variant">Репетиторов пока нет</td>
                  </tr>
                )}
                {pagedTutors.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => navigate(`${base}/teachers/${t.id}`)}
                    className="hover:bg-surface-container-low transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center font-bold text-primary">
                          {initials(t)}
                        </div>
                        <div>
                          <p className="font-label-md text-label-md font-bold">{fullName(t)}</p>
                          <p className="text-[12px] text-outline">ID: {t.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-label-md font-label-md">{t.specialization ?? "—"}</td>
                    <td className="px-6 py-4">
                      <StatusBadge status={TUTOR_STATUS_LABEL[t.tutor_status] ?? "Активен"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            <div className="md:hidden divide-y divide-outline-variant">
              {!loading && tutors.length === 0 && (
                <div className="px-4 py-8 text-center text-on-surface-variant">Репетиторов пока нет</div>
              )}
              {pagedTutors.map((t) => (
                <div
                  key={t.id}
                  onClick={() => navigate(`${base}/teachers/${t.id}`)}
                  className="p-4 flex items-center gap-3 active:bg-surface-container-low cursor-pointer"
                >
                  <div className="w-10 h-10 shrink-0 rounded-full bg-primary-fixed flex items-center justify-center font-bold text-primary">
                    {initials(t)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold truncate">{fullName(t)}</p>
                    <p className="text-[12px] text-outline">{t.specialization ?? "—"}</p>
                  </div>
                  <StatusBadge status={TUTOR_STATUS_LABEL[t.tutor_status] ?? "Активен"} />
                </div>
              ))}
            </div>

            <Pagination
              page={teachersPage}
              pageSize={TEACHERS_PAGE_SIZE}
              total={tutors.length}
              onPageChange={setTeachersPage}
              itemLabel="преподавателей"
            />
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-headline-sm text-headline-sm">Новые заявки</h3>
              <span className="bg-error text-white text-[10px] px-2 py-0.5 rounded-full">{applications.length} новых</span>
            </div>

            <div className="relative mb-4">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
                search
              </span>
              <input
                value={applicationSearch}
                onChange={(e) => setApplicationSearch(e.target.value)}
                placeholder="Поиск по имени (А-Я)..."
                className="w-full bg-surface border border-outline-variant rounded-full pl-9 pr-4 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              />
            </div>

            <div className="space-y-4">
              {visibleApplications.length === 0 && (
                <p className="text-sm text-on-surface-variant">
                  {applicationSearch ? "Ничего не найдено." : "Новых заявок нет."}
                </p>
              )}
              {pagedApplications.map((a) => (
                <div
                  key={a.id}
                  onClick={() => openApplicationModal(a)}
                  className="p-3 border border-outline-variant rounded-xl hover:bg-surface-container-low hover:border-primary/40 transition-colors cursor-pointer"
                >
                  <div className="flex justify-between items-start mb-1 gap-2">
                    <p className="min-w-0 flex-1 truncate font-bold text-label-md">{a.name} {a.age ? `(${a.age} лет)` : ""}</p>
                    <span className="shrink-0 text-[10px] text-outline whitespace-nowrap">
                      {a.created_at ? new Date(a.created_at).toLocaleDateString("ru-RU") : ""}
                    </span>
                  </div>
                  <p className="text-[12px] text-on-surface-variant truncate">
                    Интерес: {a.subject_interest ?? a.course ?? "—"}
                    {a.class_info ? ` · ${a.class_info} класс` : ""}
                  </p>
                </div>
              ))}
            </div>

            <Pagination
              page={applicationsPage}
              pageSize={APPLICATIONS_PAGE_SIZE}
              total={visibleApplications.length}
              onPageChange={setApplicationsPage}
              itemLabel="заявок"
            />
          </div>
        </section>
      </div>

      {selectedApplication && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={closeApplicationModal}>
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Заявка</h3>
              <button onClick={closeApplicationModal} className="p-1 hover:bg-surface-container-high rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {applicationActionStatus === "done" ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-green-100 text-green-800 font-label-md text-label-md">
                  Заявка обработана.
                </div>
                <button
                  onClick={closeApplicationModal}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all"
                >
                  Готово
                </button>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div>
                    <p className="text-[12px] font-bold text-on-surface-variant uppercase tracking-wide mb-0.5">Ребёнок</p>
                    <p className="text-label-md font-bold text-on-surface">
                      {selectedApplication.name || "—"}{selectedApplication.age ? `, ${selectedApplication.age} лет` : ""}
                    </p>
                  </div>
                  {selectedApplication.class_info && (
                    <div>
                      <p className="text-[12px] font-bold text-on-surface-variant uppercase tracking-wide mb-0.5">Класс</p>
                      <p className="text-label-md text-on-surface">{selectedApplication.class_info} класс</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[12px] font-bold text-on-surface-variant uppercase tracking-wide mb-0.5">Родитель</p>
                    <p className="text-label-md text-on-surface">{selectedApplication.parent_name || "Не указан"}</p>
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-on-surface-variant uppercase tracking-wide mb-0.5">Предмет</p>
                    <p className="text-label-md text-on-surface">
                      {selectedApplication.subject_interest ?? selectedApplication.course ?? "Не указан"}
                    </p>
                  </div>
                  {selectedApplication.phone && (
                    <div>
                      <p className="text-[12px] font-bold text-on-surface-variant uppercase tracking-wide mb-0.5">Телефон</p>
                      <p className="text-label-md text-on-surface">{selectedApplication.phone}</p>
                    </div>
                  )}
                  {selectedApplication.format && (
                    <div>
                      <p className="text-[12px] font-bold text-on-surface-variant uppercase tracking-wide mb-0.5">Формат</p>
                      <p className="text-label-md text-on-surface">
                        {selectedApplication.format === "individual" ? "Индивидуально" : selectedApplication.format === "group" ? "Группа" : selectedApplication.format}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-[12px] font-bold text-on-surface-variant uppercase tracking-wide mb-0.5">Дата заявки</p>
                    <p className="text-label-md text-on-surface">
                      {selectedApplication.created_at ? new Date(selectedApplication.created_at).toLocaleDateString("ru-RU") : "—"}
                    </p>
                  </div>
                </div>

                {applicationActionStatus && applicationActionStatus !== "saving" && (
                  <p className="text-sm text-error">{applicationActionStatus}</p>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => handleApplicationDecision("rejected")}
                    disabled={applicationActionStatus === "saving"}
                    className="flex-1 border border-error text-error py-3 rounded-lg font-bold hover:bg-error-container transition-all disabled:opacity-60"
                  >
                    {applicationActionStatus === "saving" ? "…" : "Отклонить"}
                  </button>
                  <button
                    onClick={() => handleApplicationDecision("converted")}
                    disabled={applicationActionStatus === "saving"}
                    className="flex-1 bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
                  >
                    {applicationActionStatus === "saving" ? "…" : "Принять заявку"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
