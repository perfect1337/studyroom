import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchMyPeople } from "../../api/users.js";
import { fetchCourses, fetchEnrollments } from "../../api/academic.js";
import { fetchContracts } from "../../api/contracts.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const CONTRACT_STATUS_LABEL = {
  active: "Активен",
  terminated: "Расторгнут",
  completed: "Завершён",
};

function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

export default function AdminStudents() {
  const { user } = useAuth();

  const [students, setStudents] = useState([]);
  const [tutors, setTutors] = useState([]);
  const [courses, setCourses] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [peopleRes, coursesRes, enrollRes, contractsRes] = await Promise.all([
          fetchMyPeople(),
          fetchCourses(),
          fetchEnrollments(),
          fetchContracts().catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setStudents(peopleRes?.students ?? []);
        setTutors(peopleRes?.tutors ?? []);
        setCourses(coursesRes?.items ?? []);
        setEnrollments(enrollRes?.items ?? []);
        setContracts(contractsRes?.items ?? []);
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
  }, []);

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

  return (
    <DashboardShell role="admin" user={toSidebarUser(user)} searchPlaceholder="Поиск студентов или учителей...">
      <div className="space-y-10 pb-10 mt-4">
        <div className="flex justify-between items-end">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary mb-2">Академический состав</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">Управление всеми участниками образовательного процесса</p>
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
          <div className="flex items-center justify-between">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Список учеников</h3>
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
                {!loading && students.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-on-surface-variant">Учеников пока нет</td>
                  </tr>
                )}
                {students.map((st) => {
                  const studentEnrollments = enrollmentsByStudent[st.id] ?? [];
                  const avg = studentEnrollments.length
                    ? Math.round(studentEnrollments.reduce((s, e) => s + (e.progress_pct ?? 0), 0) / studentEnrollments.length)
                    : 0;
                  const studentContracts = contractsByStudent[st.id] ?? [];
                  const latestContract = studentContracts[0];
                  return (
                    <tr key={st.id} className="hover:bg-surface-container-low transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center text-primary font-bold">
                            {initials(st)}
                          </div>
                          <div>
                            <div className="font-bold text-on-surface">{fullName(st)}</div>
                            <div className="text-[12px] text-on-surface-variant">ID: {st.id}</div>
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
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
