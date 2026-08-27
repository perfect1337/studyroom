import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import Pagination from "../../components/ui/Pagination.jsx";
import { usePagination } from "../../utils/usePagination.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchMyPeople, fetchBranches } from "../../api/users.js";
import { fetchCourses, fetchEnrollments } from "../../api/academic.js";
import { fetchContracts } from "../../api/contracts.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const PAGE_SIZE = 10;

const CONTRACT_STATUS_LABEL = {
  active: "Активен",
  terminated: "Расторгнут",
  completed: "Завершён",
};

function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

/**
 * Общий раздел "Ученики" для двух ролей:
 * - owner (раздел /admin): видит всех учеников сети, есть фильтр и по предмету, и по филиалу.
 * - branch_owner (раздел /branch): видит только учеников своего филиала (сервер сам
 *   ограничивает выборку по branch_id из JWT), доступен только фильтр по предмету.
 */
export default function StudentsDirectory({ role }) {
  const isOwner = role === "owner";
  const { user } = useAuth();
  const navigate = useNavigate();
  // /admin/students/:id для owner, /branch/students/:id для branch_owner —
  // единая карточка ученика (StudentDetail), см. AdminStudentDetail / BranchStudentDetail.
  const studentDetailPath = (id) => (isOwner ? `/admin/students/${id}` : `/branch/students/${id}`);

  const [students, setStudents] = useState([]);
  const [tutors, setTutors] = useState([]);
  const [courses, setCourses] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [subjectFilter, setSubjectFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState(""); // только owner

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [peopleRes, coursesRes, enrollRes, contractsRes, branchesRes] = await Promise.all([
          fetchMyPeople(),
          fetchCourses(),
          fetchEnrollments(),
          fetchContracts().catch(() => ({ items: [] })),
          isOwner ? fetchBranches().catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        ]);
        if (cancelled) return;
        setStudents(peopleRes?.students ?? []);
        setTutors(peopleRes?.tutors ?? []);
        setCourses(coursesRes?.items ?? []);
        setEnrollments(enrollRes?.items ?? []);
        setContracts(contractsRes?.items ?? []);
        setBranches(branchesRes?.items ?? []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось загрузить данные");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

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

  const avgProgress = enrollments.length
    ? Math.round(enrollments.reduce((s, e) => s + (e.progress_pct ?? 0), 0) / enrollments.length)
    : 0;

  const stats = [
    { label: "Всего учеников", value: String(students.length) },
    { label: "Всего учителей", value: String(tutors.length) },
    { label: "Средний прогресс", value: `${avgProgress}%` },
    { label: "Активные курсы", value: String(courses.length) },
  ];

  const subjects = useMemo(() => {
    const set = new Set();
    courses.forEach((c) => c.subject && set.add(c.subject));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [courses]);

  const filteredStudents = useMemo(() => {
    return students.filter((st) => {
      if (isOwner && branchFilter && String(st.branch_id) !== String(branchFilter)) return false;
      if (subjectFilter) {
        const studentEnrollments = enrollmentsByStudent[st.id] ?? [];
        const hasSubject = studentEnrollments.some((e) => coursesById[e.course_id]?.subject === subjectFilter);
        if (!hasSubject) return false;
      }
      return true;
    });
  }, [students, isOwner, branchFilter, subjectFilter, enrollmentsByStudent, coursesById]);

  const { page, setPage, pageItems: pagedStudents } = usePagination(filteredStudents, PAGE_SIZE);

  return (
    <DashboardShell
      role={isOwner ? "admin" : "branch_owner"}
      user={toSidebarUser(user)}
      searchPlaceholder={isOwner ? "Поиск студентов или учителей..." : "Поиск учеников..."}
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="space-y-10 pb-10 mt-4">
        <div className="flex justify-between items-end">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary mb-2">
              {isOwner ? "Академический состав" : "Ученики филиала"}
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              {isOwner
                ? "Управление всеми участниками образовательного процесса"
                : "Ученики, закреплённые за вашим филиалом"}
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {stats.map((s) => (
            <div key={s.label} className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30">
              <p className="text-label-md text-on-surface-variant mb-1">{s.label}</p>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold text-primary">{loading ? "…" : s.value}</span>
              </div>
            </div>
          ))}
        </div>

        <section className="space-y-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-stack-md">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Список учеников</h3>
            <div className="flex flex-wrap gap-3">
              <div className="relative">
                <select
                  value={subjectFilter}
                  onChange={(e) => setSubjectFilter(e.target.value)}
                  className="appearance-none bg-surface-container-lowest border border-outline-variant rounded-lg pl-4 pr-9 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                >
                  <option value="">Все предметы</option>
                  {subjects.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              {/* Фильтр по филиалу — доступен только владельцу сети (видит все филиалы сразу) */}
              {isOwner && (
                <div className="relative">
                  <select
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                    className="appearance-none bg-surface-container-lowest border border-outline-variant rounded-lg pl-4 pr-9 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  >
                    <option value="">Все филиалы</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name || b.city}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] overflow-hidden border border-outline-variant/30 overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-md">
                  <th className="px-6 py-4 font-semibold">Ученик</th>
                  <th className="px-6 py-4 font-semibold">Курсы</th>
                  <th className="px-6 py-4 font-semibold">Срок договора</th>
                  <th className="px-6 py-4 font-semibold">Прогресс</th>
                  <th className="px-6 py-4 font-semibold">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {!loading && filteredStudents.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-on-surface-variant">Учеников не найдено</td>
                  </tr>
                )}
                {pagedStudents.map((st) => {
                  const studentEnrollments = enrollmentsByStudent[st.id] ?? [];
                  const avg = studentEnrollments.length
                    ? Math.round(studentEnrollments.reduce((s, e) => s + (e.progress_pct ?? 0), 0) / studentEnrollments.length)
                    : 0;
                  const studentContracts = contractsByStudent[st.id] ?? [];
                  const latestContract = studentContracts[0];
                  return (
                    <tr
                      key={st.id}
                      onClick={() => navigate(studentDetailPath(st.id))}
                      className="hover:bg-surface-container-low transition-colors group cursor-pointer"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center text-primary font-bold">
                            {initials(st)}
                          </div>
                          <div>
                            <div className="font-bold text-on-surface">{fullName(st)}</div>
                            <div className="text-[12px] text-on-surface-variant">{st.class_info || "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {studentEnrollments.length === 0 && <span className="text-[12px] text-on-surface-variant">—</span>}
                          {studentEnrollments.map((e) => (
                            <span key={e.id} className="px-2 py-1 bg-surface-variant rounded text-[11px] font-bold text-primary">
                              {coursesById[e.course_id]?.title ?? coursesById[e.course_id]?.subject ?? `#${e.course_id}`}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-[13px] text-on-surface">
                          {latestContract ? `${latestContract.start_date} — ${latestContract.end_date}` : "—"}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-on-surface">{avg}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${
                            !latestContract || latestContract.status === "active" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {latestContract ? CONTRACT_STATUS_LABEL[latestContract.status] ?? latestContract.status : "Без договора"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={filteredStudents.length} onPageChange={setPage} itemLabel="учеников" />
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
