import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchMyPeople } from "../../api/users.js";
import { fetchCourses, fetchEnrollments } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const SUBJECT_ICONS = {
  Математика: "functions",
  "Английский язык": "language",
  Английский: "language",
  Физика: "science",
  Естествознание: "science",
  Биология: "biology",
  Химия: "experiment",
};

const TUTOR_STATUS_LABEL = {
  active: "Активен",
  vacation: "В отпуске",
  sick_leave: "На больничном",
  inactive: "Неактивен",
};

export default function BranchOverview() {
  const { user } = useAuth();

  const [people, setPeople] = useState({ students: [], tutors: [] });
  const [courses, setCourses] = useState([]);
  const [enrollmentCounts, setEnrollmentCounts] = useState({}); // course_id -> count
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        // GET /users — для branch_owner сервер сам возвращает students/tutors только его филиала.
        const [peopleRes, coursesRes] = await Promise.all([fetchMyPeople(), fetchCourses()]);
        if (cancelled) return;
        setPeople({ students: peopleRes?.students ?? [], tutors: peopleRes?.tutors ?? [] });
        const courseItems = coursesRes?.items ?? [];
        setCourses(courseItems);

        // Число записей на курс — для разбивки по предметам (2.5 GET /enrollments?course_id=).
        const counts = await Promise.all(
          courseItems.map((c) =>
            fetchEnrollments({ course_id: c.id })
              .then((r) => r?.items?.length ?? 0)
              .catch(() => 0)
          )
        );
        if (!cancelled) {
          const map = {};
          courseItems.forEach((c, i) => (map[c.id] = counts[i]));
          setEnrollmentCounts(map);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось загрузить данные филиала");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const subjectBreakdown = useMemo(() => {
    const map = {};
    for (const course of courses) {
      const subject = course.subject || "Прочие курсы";
      if (!map[subject]) map[subject] = { subject, groups: 0, students: 0 };
      map[subject].groups += 1;
      map[subject].students += enrollmentCounts[course.id] ?? 0;
    }
    return Object.values(map).sort((a, b) => b.students - a.students);
  }, [courses, enrollmentCounts]);

  const topTutors = useMemo(() => {
    return [...people.tutors].slice(0, 5);
  }, [people.tutors]);

  return (
    <DashboardShell
      role="branch_owner"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск по филиалу..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="space-y-stack-lg mt-4">
        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
            {error}
          </div>
        )}

        {/* Hero Summary Section (Bento Style) */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border-t-4 border-primary transition-transform hover:-translate-y-1">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 bg-primary-fixed rounded-lg flex items-center justify-center">
                <span className="material-symbols-outlined text-primary text-3xl">group</span>
              </div>
            </div>
            <h3 className="text-on-surface-variant font-label-md uppercase tracking-wide">Всего студентов</h3>
            <p className="font-display-lg text-display-lg text-primary mt-1">
              {loading ? "…" : people.students.length}
            </p>
            <div className="mt-4 flex items-center gap-2 text-on-surface-variant text-label-md">
              <span className="material-symbols-outlined text-sm">group</span>
              <span>В вашем филиале</span>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border-t-4 border-secondary-container transition-transform hover:-translate-y-1">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 bg-secondary-fixed rounded-lg flex items-center justify-center">
                <span className="material-symbols-outlined text-secondary text-3xl">history_edu</span>
              </div>
            </div>
            <h3 className="text-on-surface-variant font-label-md uppercase tracking-wide">Всего учителей</h3>
            <p className="font-display-lg text-display-lg text-secondary mt-1">
              {loading ? "…" : people.tutors.length}
            </p>
            <div className="mt-4 flex items-center gap-2 text-on-surface-variant text-label-md">
              <span className="material-symbols-outlined text-sm">verified</span>
              <span>
                {people.tutors.filter((t) => (t.tutor_status ?? "active") === "active").length} активны сейчас
              </span>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border-t-4 border-tertiary transition-transform hover:-translate-y-1">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 bg-tertiary-fixed rounded-lg flex items-center justify-center">
                <span className="material-symbols-outlined text-tertiary text-3xl">school</span>
              </div>
            </div>
            <h3 className="text-on-surface-variant font-label-md uppercase tracking-wide">Всего курсов</h3>
            <p className="font-display-lg text-display-lg text-tertiary mt-1">{loading ? "…" : courses.length}</p>
            <div className="mt-4 flex items-center gap-2 text-on-surface-variant text-label-md">
              <span className="material-symbols-outlined text-sm">menu_book</span>
              <span>{subjectBreakdown.length} направлений</span>
            </div>
          </div>
        </section>

        {/* Detailed Breakdowns */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Subjects list */}
          <div className="lg:col-span-8 space-y-6">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Курсы по предметам</h3>
            {subjectBreakdown.length === 0 && !loading && (
              <p className="text-on-surface-variant font-body-md">Курсов пока нет</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {subjectBreakdown.map((s, i) => (
                <div
                  key={s.subject}
                  className="bg-surface-container-lowest p-5 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border-l-4 flex items-center justify-between"
                  style={{ borderLeftColor: ["#fed01b", "#004ac6", "#ab0b1c", "#737686"][i % 4] }}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center">
                      <span className="material-symbols-outlined text-on-surface">
                        {SUBJECT_ICONS[s.subject] ?? "psychology"}
                      </span>
                    </div>
                    <div>
                      <p className="font-label-md text-on-surface">{s.subject}</p>
                      <p className="text-[12px] text-on-surface-variant">
                        {s.groups} {s.groups === 1 ? "курс" : "курса"} • {s.students} студентов
                      </p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Teachers */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)]">
              <h3 className="font-headline-sm text-on-surface mb-6">Преподаватели филиала</h3>
              {topTutors.length === 0 && !loading && (
                <p className="text-on-surface-variant font-body-md text-body-md">Учителя пока не добавлены</p>
              )}
              <div className="space-y-6">
                {topTutors.map((t) => (
                  <div key={t.id} className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary-fixed flex items-center justify-center font-bold text-primary shrink-0">
                      {t.first_name?.[0]}
                      {t.last_name?.[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-label-md text-on-surface truncate">
                        {t.last_name} {t.first_name}
                      </p>
                      <p className="text-[12px] text-on-surface-variant truncate">
                        {t.specialization || "Специализация не указана"}
                      </p>
                    </div>
                    <StatusBadge status={TUTOR_STATUS_LABEL[t.tutor_status] ?? "Активен"} />
                  </div>
                ))}
              </div>
              <Link
                to="/branch/teachers"
                className="w-full mt-8 py-3 border border-outline text-primary font-bold rounded-lg hover:bg-primary-fixed/30 transition-colors duration-200 flex items-center justify-center"
              >
                Все преподаватели
              </Link>
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
