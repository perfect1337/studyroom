import { useEffect, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import ProgressBar from "../../components/ui/ProgressBar.jsx";
import Avatar from "../../components/ui/Avatar.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchCourses, fetchEnrollments, fetchLessons } from "../../api/academic.js";
import { fetchUserById } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const STATUS_LABEL = {
  "active": "Активен",
};

/**
 * "Курсы ученика" показывает только текущие активные записи.
 * История completed/terminated доступна staff в карточке ученика.
 */
export default function StudentCourses() {
  const { user } = useAuth();

  const [enrollments, setEnrollments] = useState([]);
  const [coursesById, setCoursesById] = useState({});
  const [tutorsById, setTutorsById] = useState({});
  const [courseTutorId, setCourseTutorId] = useState({}); // course_id -> tutor_id, из реально созданных занятий
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

        const enrollItems = (enrollRes?.items ?? [])
          .filter((item) => item.status === "active")
          .map((item) => ({
            ...item,
            status: STATUS_LABEL[item.status] || item.status,
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

  const filtered = enrollments;

  return (
    <DashboardShell
      role="student"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="space-y-stack-lg pb-section-padding">
        {/* Мини-профиль в шапке страницы — раньше здесь не было вообще ни
            одного упоминания, чей это кабинет (в отличие от /student и
            /parent). Не дублируем полную карточку профиля — только
            компактная строка "кто я" над заголовком списка, тем же визуальным
            языком, что и hero-карточка на /student (акцентное ФИО + тонкая
            золотая линия-подчёркивание вместо рамки со всех сторон). */}
        <div className="flex items-center gap-3.5 mt-1 pb-4 border-b-2 border-secondary-container">
          <Avatar src={user?.avatar_url} name={fullName(user)} size="sm" className="ring-2 ring-secondary-container" />
          <div className="min-w-0">
            <p className="font-display-academic text-lg font-semibold text-on-surface truncate leading-tight">
              {fullName(user)}
            </p>
            <p className="text-xs text-on-surface-variant leading-tight mt-0.5">
              {user?.class_info || user?.school ? [user.class_info, user.school].filter(Boolean).join(" · ") : "Ученик"}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <h2 className="font-headline-md text-headline-md text-on-background">Мои курсы</h2>
          <p className="text-sm text-on-surface-variant">Здесь отображаются только активные курсы.</p>
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
            Вы пока не записаны ни на один активный курс
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-stack-md">
            {filtered.map((e) => {
              const course = coursesById[e.course_id];
              const tutor = tutorsById[e.tutor_id || courseTutorId[e.course_id]];
              return (
                <div
                  key={e.id}
                  className="bg-surface-container-lowest rounded-xl p-stack-md shadow-sm border border-outline-variant border-t-2 border-t-primary/40 flex flex-col"
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
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 min-w-0 text-on-surface-variant">
                        {tutor ? (
                          <>
                            <Avatar src={tutor.avatar_url} name={fullName(tutor)} size="xs" />
                            <span className="truncate font-medium text-on-surface">{fullName(tutor)}</span>
                          </>
                        ) : (
                          <span className="italic">Преподаватель не назначен</span>
                        )}
                      </span>
                      <span className="font-bold text-primary shrink-0">
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