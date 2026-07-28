import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import ProgressBar from "../../components/ui/ProgressBar.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchCourses, fetchEnrollments, fetchLessons } from "../../api/academic.js";
import { fetchUserById } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const STATUS_LABEL = {
  "active": "Активен",
  "completed": "Завершён",
  "paused": "На паузе",
};

/**
 * "Курсы ученика" — полный список записей ученика на курсы (см.
 * api-contracts.md 2.1 GET /courses, 2.5 GET /enrollments?student_id=).
 */
export default function StudentCourses() {
  const { user } = useAuth();

  const [enrollments, setEnrollments] = useState([]);
  const [coursesById, setCoursesById] = useState({});
  const [tutorsById, setTutorsById] = useState({});
  const [courseTutorId, setCourseTutorId] = useState({}); // course_id -> tutor_id, из реально созданных занятий
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [enrollRes, coursesRes, lessonsRes] = await Promise.all([
          fetchEnrollments({ student_id: user.id }),
          fetchCourses(),
          // enrollments.tutor_id часто пустой (проставляется вручную/по договору) —
          // реальный препод по курсу виден по тому, кто создал занятие (lessons.tutor_id).
          fetchLessons({ student_id: user.id }).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;

        const enrollItems = (enrollRes?.items ?? []).map(item => ({
          ...item,
          // Заменяем статус на русский сразу при получении
          status: STATUS_LABEL[item.status] || item.status
        }));
        
        setEnrollments(enrollItems);

        const cMap = {};
        (coursesRes?.items ?? []).forEach((c) => (cMap[c.id] = c));
        setCoursesById(cMap);

        // Самое свежее занятие по курсу определяет преподавателя, если в
        // enrollment он не проставлен.
        const lessonItems = (lessonsRes?.items ?? [])
          .slice()
          .sort((a, b) => (a.lesson_date + a.start_time).localeCompare(b.lesson_date + b.start_time));
        const cTutorMap = {};
        lessonItems.forEach((l) => {
          if (l.tutor_id) cTutorMap[l.course_id] = l.tutor_id;
        });
        setCourseTutorId(cTutorMap);

        const tutorIds = [
          ...new Set(
            enrollItems
              .map((e) => e.tutor_id || cTutorMap[e.course_id])
              .filter(Boolean)
          ),
        ];
        if (tutorIds.length) {
          const fetched = await Promise.all(tutorIds.map((id) => fetchUserById(id).catch(() => null)));
          if (!cancelled) {
            const tMap = {};
            fetched.forEach((t, i) => t && (tMap[tutorIds[i]] = t));
            setTutorsById(tMap);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось загрузить курсы");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const filtered = useMemo(
    () => {
      if (statusFilter === "all") return enrollments;
      // Фильтруем по русскому статусу
      return enrollments.filter((e) => e.status === statusFilter);
    },
    [enrollments, statusFilter]
  );

  return (
    <DashboardShell
      role="student"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="space-y-stack-lg pb-section-padding">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h2 className="font-headline-md text-headline-md text-on-background">Мои курсы</h2>
          <div className="flex gap-2">
            {[
              ["all", "Все"],
              ["Активен", "Активные"],
              ["На паузе", "На паузе"],
              ["Завершён", "Завершённые"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                className={`px-4 py-2 rounded-full text-sm font-label-md transition-colors ${
                  statusFilter === value
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-on-surface-variant font-body-md">Загрузка…</p>
        ) : filtered.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-xl p-stack-lg shadow-sm border border-outline-variant text-on-surface-variant font-body-md text-center">
            {statusFilter === "all" ? "Вы пока не записаны ни на один курс" : "Нет курсов с этим статусом"}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-stack-md">
            {filtered.map((e) => {
              const course = coursesById[e.course_id];
              const tutor = tutorsById[e.tutor_id || courseTutorId[e.course_id]];
              return (
                <div
                  key={e.id}
                  className="bg-surface-container-lowest rounded-xl p-stack-md shadow-sm border border-outline-variant flex flex-col"
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-headline-sm text-headline-sm text-on-background">
                      {course?.title ?? `Курс #${e.course_id}`}
                    </h3>
                    <span className="text-xs font-bold px-2 py-1 rounded bg-surface-container-highest text-on-surface-variant shrink-0">
                      {course?.format === "individual" ? "Индивидуально" : "Группа"}
                    </span>
                  </div>
                  <p className="text-sm text-on-surface-variant mb-1">{course?.subject}</p>
                  {course?.description && (
                    <p className="text-sm text-on-surface-variant mb-4 line-clamp-2">{course.description}</p>
                  )}
                  <div className="mt-auto space-y-3">
                    <div>
                      <div className="flex items-center justify-between text-xs text-on-surface-variant mb-1">
                        <span>Прогресс</span>
                        <span>{e.progress_pct ?? 0}%</span>
                      </div>
                      <ProgressBar value={e.progress_pct ?? 0} />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-on-surface-variant">
                        Преп: {tutor ? fullName(tutor) : "не назначен"}
                      </span>
                      <span className="font-bold text-primary">
                        {e.status}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}