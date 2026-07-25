import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import ProgressBar from "../../components/ui/ProgressBar.jsx";
import Pagination from "../../components/ui/Pagination.jsx";
import { usePagination } from "../../utils/usePagination.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchEnrollments, fetchCourses, fetchLessons } from "../../api/academic.js";
import { fetchMyPeople } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const PAGE_SIZE = 10;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

export default function TutorStudents() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [enrollments, setEnrollments] = useState([]);
  const [courses, setCourses] = useState([]);
  const [studentsById, setStudentsById] = useState({});
  const [upcomingLessons, setUpcomingLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [enrollRes, coursesRes, peopleRes, lessonsRes] = await Promise.all([
          fetchEnrollments({ tutor_id: user.id }),
          fetchCourses(),
          fetchMyPeople(),
          fetchLessons({ tutor_id: user.id, date_from: todayISO() }),
        ]);
        if (cancelled) return;

        setEnrollments(enrollRes?.items ?? []);
        setCourses(coursesRes?.items ?? []);
        const byId = {};
        (peopleRes?.students ?? []).forEach((s) => (byId[s.id] = s));
        setStudentsById(byId);
        setUpcomingLessons((lessonsRes?.items ?? []).slice().sort((a, b) => a.lesson_date.localeCompare(b.lesson_date)));
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
  }, [user?.id]);

  const coursesById = useMemo(() => {
    const map = {};
    courses.forEach((c) => (map[c.id] = c));
    return map;
  }, [courses]);

  const nextLessonByStudent = useMemo(() => {
    const map = {};
    for (const l of upcomingLessons) {
      if (!map[l.course_id]) map[l.course_id] = l;
    }
    return map;
  }, [upcomingLessons]);

  const { page, setPage, pageItems: pagedEnrollments } = usePagination(enrollments, PAGE_SIZE);

  return (
    <DashboardShell role="tutor" user={toSidebarUser(user)} searchPlaceholder="Поиск ученика..." userLabel={fullName(user)} avatarUrl={user?.avatar_url}>
      <div className="space-y-stack-md pb-stack-lg mt-4">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-background mb-1">Мои ученики</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Полная сводка по всем закреплённым ученикам и группам.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden overflow-x-auto">
          <table className="w-full text-left min-w-[760px]">
            <thead className="bg-surface-container-low text-on-surface-variant font-label-md">
              <tr>
                <th className="px-6 py-4 font-semibold">Ученик</th>
                <th className="px-6 py-4 font-semibold">Курс / предмет</th>
                <th className="px-6 py-4 font-semibold">Прогресс</th>
                <th className="px-6 py-4 font-semibold">След. занятие</th>
                <th className="px-6 py-4 font-semibold">Статус записи</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-on-surface-variant">Загрузка…</td>
                </tr>
              )}
              {!loading && enrollments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-on-surface-variant">Пока нет закреплённых учеников.</td>
                </tr>
              )}
              {!loading &&
                pagedEnrollments.map((e) => {
                  const student = studentsById[e.student_id];
                  const course = coursesById[e.course_id];
                  const nextLesson = nextLessonByStudent[e.course_id];
                  return (
                    <tr
                      key={e.id}
                      onClick={() => navigate(`/tutor/students/${e.student_id}`)}
                      className="hover:bg-surface-container-low transition-colors cursor-pointer"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center text-on-surface-variant font-bold shrink-0">
                            {initials(student)}
                          </div>
                          <span className="font-bold text-on-surface">
                            {student ? fullName(student) : `Ученик #${e.student_id}`}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-on-surface-variant text-sm">{course?.title ?? course?.subject ?? "—"}</td>
                      <td className="px-6 py-4 w-40">
                        <ProgressBar value={e.progress_pct ?? 0} />
                      </td>
                      <td className="px-6 py-4 text-sm text-on-surface-variant">
                        {nextLesson ? `${nextLesson.lesson_date}, ${nextLesson.start_time}` : "—"}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={e.status === "active" ? "Активен" : e.status} color={e.status === "active" ? "green" : "amber"} />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={enrollments.length} onPageChange={setPage} itemLabel="учеников" />
        </div>
      </div>
    </DashboardShell>
  );
}
