import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import Pagination from "../../components/ui/Pagination.jsx";
import { usePagination } from "../../utils/usePagination.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchMyPeople, fetchBranches, createStudent } from "../../api/users.js";
import { fetchCourses, fetchEnrollments, fetchLessons, fetchTests } from "../../api/academic.js";
import { fetchContracts } from "../../api/contracts.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const PAGE_SIZE = 10;

const CONTRACT_STATUS_LABEL = {
  active: "Активен",
  terminated: "Расторгнут",
  completed: "Завершён",
};

const EMPTY_CHILD_FORM = {
  last_name: "",
  first_name: "",
  patronymic: "",
  branch_id: "",
};

function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

/**
 * Единый раздел "Мои ученики / Мои дети" для всех четырёх ролей иерархии
 * (см. GET /users в api-contracts.md, п.1.9 — сервер сам решает, кого вернуть):
 *  - parent (role="parent", /parent/children): видит только своих детей,
 *    может добавить нового ребёнка (создаётся личный кабинет ученика).
 *  - tutor (role="tutor", /tutor/students): видит только тех учеников,
 *    которым он лично создал занятие (фильтр по participant_ids из своих
 *    lessons), а не всех учеников филиала/курса — enrollments тут не при
 *    делах, т.к. запись на курс ещё не означает, что занятие проведено.
 *  - branch_owner (role="branch_owner", /branch/students): видит учеников
 *    своего филиала (сервер сам ограничивает выборку по branch_id из JWT).
 *  - owner (role="owner", /admin/students): видит всех учеников сети,
 *    с фильтром по филиалу.
 *
 * Карточка ребёнка/ученика ведёт на соответствующий per-role detail-роут.
 */
export default function PeopleDirectory({ role }) {
  const isOwner = role === "owner";
  const isBranchOwner = role === "branch_owner";
  const isTutor = role === "tutor";
  const isParent = role === "parent";
  const showContracts = isOwner || isBranchOwner;

  const { user } = useAuth();
  const navigate = useNavigate();

  const detailPath = (id) => {
    if (isParent) return `/parent/children/${id}`;
    if (isTutor) return `/tutor/students/${id}`;
    if (isBranchOwner) return `/branch/students/${id}`;
    return `/admin/students/${id}`;
  };

  const [people, setPeople] = useState([]);
  const [courses, setCourses] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [lessons, setLessons] = useState([]); // только для tutor — источник "своих" учеников
  const [tests, setTests] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [subjectFilter, setSubjectFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState(""); // только owner
  const [search, setSearch] = useState(""); // поиск по ФИО

  // Родитель: модалка добавления ребёнка.
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_CHILD_FORM);
  const [addStatus, setAddStatus] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const enrollParams = isTutor ? { tutor_id: user.id } : {};
      const coursesParams = isTutor ? { tutor_id: user.id } : {};
      const lessonParams = isTutor ? { tutor_id: user.id } : null;
      const [peopleRes, coursesRes, enrollRes, lessonsRes, contractsRes, branchesRes, testsRes] = await Promise.all([
        fetchMyPeople(),
        fetchCourses(coursesParams),
        fetchEnrollments(enrollParams).catch(() => ({ items: [] })),
        isTutor ? fetchLessons(lessonParams).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        showContracts ? fetchContracts().catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        isOwner || isParent ? fetchBranches().catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        // Тесты уже приходят отфильтрованными по роли на бэкенде (см. TestHandler.List) —
        // репетитору только свои выданные, родителю только тесты его детей и т.д.
        fetchTests().catch(() => ({ items: [] })),
      ]);

      const enrollItems = enrollRes?.items ?? [];
      const lessonItems = lessonsRes?.items ?? [];
      setEnrollments(enrollItems);
      setLessons(lessonItems);
      setCourses(coursesRes?.items ?? []);
      setContracts(contractsRes?.items ?? []);
      setBranches(branchesRes?.items ?? []);
      setTests(testsRes?.items ?? []);

      if (isParent) {
        setPeople(peopleRes?.children ?? []);
      } else if (isTutor) {
        // "Мои ученики" у репетитора — это только те, кому он лично создал
        // занятие (participant_ids из его lessons), а не все, кто записан
        // на курс (enrollments/course_tutors — более широкий список, там
        // может быть ученик, с которым занятие ещё ни разу не проводилось).
        const byId = {};
        (peopleRes?.students ?? []).forEach((s) => (byId[s.id] = s));
        const seen = new Map();
        lessonItems.forEach((l) => {
          (l.participant_ids ?? []).forEach((studentId) => {
            if (!seen.has(studentId)) {
              seen.set(studentId, byId[studentId] ?? { id: studentId });
            }
          });
        });
        setPeople(Array.from(seen.values()));
      } else {
        setPeople(peopleRes?.students ?? []);
      }
    } catch (e) {
      setError(e.message || "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.id) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, role]);

  const coursesById = useMemo(() => {
    const map = {};
    courses.forEach((c) => (map[c.id] = c));
    return map;
  }, [courses]);

  const enrollmentsByStudent = useMemo(() => {
    const map = {};
    enrollments.forEach((e) => (map[e.student_id] ??= []).push(e));
    return map;
  }, [enrollments]);

  const contractsByStudent = useMemo(() => {
    const map = {};
    contracts.forEach((c) => (map[c.student_id] ??= []).push(c));
    return map;
  }, [contracts]);

  const testsByStudent = useMemo(() => {
    const map = {};
    tests.forEach((t) => (map[t.student_id] ??= []).push(t));
    return map;
  }, [tests]);

  const subjects = useMemo(() => {
    const set = new Set();
    courses.forEach((c) => c.subject && set.add(c.subject));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [courses]);

  const filteredPeople = useMemo(() => {
    const query = search.trim().toLowerCase();
    return people.filter((p) => {
      if (isOwner && branchFilter && String(p.branch_id) !== String(branchFilter)) return false;
      if (subjectFilter) {
        const pEnrollments = enrollmentsByStudent[p.id] ?? [];
        const hasSubject = pEnrollments.some((e) => coursesById[e.course_id]?.subject === subjectFilter);
        if (!hasSubject) return false;
      }
      if (query && !fullName(p).toLowerCase().includes(query)) return false;
      return true;
    });
  }, [people, isOwner, branchFilter, subjectFilter, search, enrollmentsByStudent, coursesById]);

  const { page, setPage, pageItems: pagedPeople } = usePagination(filteredPeople, PAGE_SIZE);

  const avgProgress = enrollments.length
    ? Math.round(enrollments.reduce((s, e) => s + (e.progress_pct ?? 0), 0) / enrollments.length)
    : 0;

  const stats = isParent
    ? null
    : [
        { label: isTutor ? "Мои ученики" : "Всего учеников", value: String(people.length) },
        { label: "Средний прогресс", value: `${avgProgress}%` },
        { label: "Активные курсы", value: String(courses.length) },
      ];

  function openAddModal() {
    setAddForm(EMPTY_CHILD_FORM);
    setAddStatus("");
    setShowAddModal(true);
  }

  async function handleAddChild(e) {
    e.preventDefault();
    if (!addForm.last_name || !addForm.first_name || !addForm.branch_id) return;
    setAddStatus("saving");
    try {
      await createStudent({
        last_name: addForm.last_name,
        first_name: addForm.first_name,
        patronymic: addForm.patronymic || undefined,
        branch_id: Number(addForm.branch_id),
        parent_id: user.id,
      });
      setAddStatus("done");
      await load(); // подтягиваем свежий список детей
    } catch (err) {
      setAddStatus(err.message || "Не удалось добавить ребёнка");
    }
  }

  const titles = {
    parent: { h: "Мои дети", sub: "Личные кабинеты ваших детей и их успеваемость", search: "Поиск ребёнка..." },
    tutor: { h: "Мои ученики", sub: "Полная сводка по всем закреплённым ученикам", search: "Поиск ученика..." },
    branch_owner: { h: "Ученики филиала", sub: "Ученики, закреплённые за вашим филиалом", search: "Поиск учеников..." },
    owner: { h: "Академический состав", sub: "Управление всеми учениками сети", search: "Поиск учеников..." },
  }[role] ?? { h: "Ученики", sub: "", search: "Поиск..." };

  return (
    <DashboardShell
      role={isOwner ? "admin" : role}
      user={toSidebarUser(user)}
      searchPlaceholder={titles.search}
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="space-y-10 pb-10 mt-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-stack-md">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary mb-2">{titles.h}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">{titles.sub}</p>
          </div>

          {isParent && (
            <button
              onClick={openAddModal}
              className="bg-primary text-on-primary px-6 py-2.5 rounded-lg font-label-md text-label-md flex items-center gap-2 hover:brightness-110 transition-all active:scale-95 shadow-sm"
            >
              <span className="material-symbols-outlined">person_add</span>
              Добавить ребёнка
            </button>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {stats.map((s) => (
              <div key={s.label} className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30">
                <p className="text-label-md text-on-surface-variant mb-1">{s.label}</p>
                <span className="text-3xl font-bold text-primary">{loading ? "…" : s.value}</span>
              </div>
            ))}
          </div>
        )}

        <section className="space-y-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-stack-md">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">
              {isParent ? "Список детей" : "Список учеников"}
            </h3>
            <div className="flex flex-wrap gap-3">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
                  search
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по ФИО..."
                  className="bg-surface-container-lowest border border-outline-variant rounded-lg pl-9 pr-4 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none w-full sm:w-56"
                />
              </div>
              <select
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
              >
                <option value="">Все предметы</option>
                {subjects.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {isOwner && (
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                >
                  <option value="">Все филиалы</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name || b.city}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-2xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] overflow-hidden border border-outline-variant/30 overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[820px]">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-md">
                  <th className="px-6 py-4 font-semibold">{isParent ? "Ребёнок" : "Ученик"}</th>
                  <th className="px-6 py-4 font-semibold">Курсы</th>
                  {showContracts && <th className="px-6 py-4 font-semibold">Срок договора</th>}
                  <th className="px-6 py-4 font-semibold">Прогресс</th>
                  <th className="px-6 py-4 font-semibold">Успеваемость</th>
                  <th className="px-6 py-4 font-semibold">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {loading && (
                  <tr>
                    <td colSpan={showContracts ? 6 : 5} className="px-6 py-10 text-center text-on-surface-variant">Загрузка…</td>
                  </tr>
                )}
                {!loading && filteredPeople.length === 0 && (
                  <tr>
                    <td colSpan={showContracts ? 6 : 5} className="px-6 py-8 text-center text-on-surface-variant">
                      {isParent ? "У вас пока нет добавленных детей." : "Учеников не найдено"}
                    </td>
                  </tr>
                )}
                {pagedPeople.map((p) => {
                  const pEnrollments = enrollmentsByStudent[p.id] ?? [];
                  const avg = pEnrollments.length
                    ? Math.round(pEnrollments.reduce((s, e) => s + (e.progress_pct ?? 0), 0) / pEnrollments.length)
                    : 0;
                  const pContracts = contractsByStudent[p.id] ?? [];
                  const latestContract = pContracts[0];
                  const pTests = testsByStudent[p.id] ?? [];
                  const gradedTests = pTests.filter((t) => t.grade != null);
                  const avgGrade = gradedTests.length
                    ? gradedTests.reduce((s, t) => s + t.grade, 0) / gradedTests.length
                    : null;
                  const courseNames = pEnrollments
                    .map((e) => coursesById[e.course_id]?.title ?? coursesById[e.course_id]?.subject)
                    .filter(Boolean);
                  return (
                    <tr
                      key={p.id}
                      onClick={() => navigate(detailPath(p.id))}
                      className="hover:bg-surface-container-low transition-colors group cursor-pointer"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center text-primary font-bold">
                            {initials(p)}
                          </div>
                          <div>
                            <div className="font-bold text-on-surface">{fullName(p) || "Ученик"}</div>
                            <div className="text-[12px] text-on-surface-variant">
                              {[p.class_info, p.school].filter(Boolean).join(" · ") || "—"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {pEnrollments.length === 0 && <span className="text-[12px] text-on-surface-variant">—</span>}
                          {pEnrollments.map((e) => (
                            <span key={e.id} className="px-2 py-1 bg-surface-variant rounded text-[11px] font-bold text-primary">
                              {coursesById[e.course_id]?.title ?? coursesById[e.course_id]?.subject ?? `#${e.course_id}`}
                            </span>
                          ))}
                        </div>
                      </td>
                      {showContracts && (
                        <td className="px-6 py-4">
                          <div className="text-[13px] text-on-surface">
                            {latestContract ? `${latestContract.start_date} — ${latestContract.end_date}` : "—"}
                          </div>
                        </td>
                      )}
                      <td className="px-6 py-4">
                        <span className="font-bold text-on-surface">{avg}%</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-0.5 text-[12px] max-w-[180px]">
                          <span className="text-on-surface font-bold truncate" title={courseNames.join(", ")}>
                            {courseNames.length ? courseNames.join(", ") : "Курс не назначен"}
                          </span>
                          <span className={avgGrade != null ? "text-primary font-bold" : "text-on-surface-variant"}>
                            {avgGrade != null ? `Средний балл за тесты: ${avgGrade.toFixed(1)}` : "Нет оценок за тесты"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {showContracts ? (
                          <span
                            className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${
                              !latestContract || latestContract.status === "active" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {latestContract ? CONTRACT_STATUS_LABEL[latestContract.status] ?? latestContract.status : "Без договора"}
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold uppercase bg-green-100 text-green-700">
                            {pEnrollments.some((e) => e.status === "active") ? "Активен" : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={filteredPeople.length} onPageChange={setPage} itemLabel={isParent ? "детей" : "учеников"} />
          </div>
        </section>
      </div>

      {isParent && showAddModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAddModal(false)}>
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Добавить ребёнка</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-surface-container-high rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {addStatus === "done" ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-green-100 text-green-800 font-label-md text-label-md">
                  Ребёнок добавлен. Личный кабинет создан, данные для входа отправлены на вашу почту ({user?.email}).
                </div>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all"
                >
                  Готово
                </button>
              </div>
            ) : (
              <form onSubmit={handleAddChild} className="space-y-4">
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
                  <div className="md:col-span-2">
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Отчество</label>
                    <input
                      value={addForm.patronymic}
                      onChange={(e) => setAddForm((f) => ({ ...f, patronymic: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                  <div className="md:col-span-2">
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
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-on-surface-variant">
                      Ребёнок появится в списках только тех репетиторов и руководителей, которые относятся к этому филиалу.
                    </p>
                  </div>
                </div>

                {addStatus && addStatus !== "saving" && addStatus !== "done" && (
                  <p className="text-sm text-error">{addStatus}</p>
                )}

                <button
                  type="submit"
                  disabled={addStatus === "saving" || !addForm.last_name || !addForm.first_name || !addForm.branch_id}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
                >
                  {addStatus === "saving" ? "Сохранение…" : "Добавить ребёнка"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
