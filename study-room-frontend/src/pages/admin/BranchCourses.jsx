import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchMyPeople } from "../../api/users.js";
import { fetchCourses } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const FORMAT_LABEL = { individual: "Индивидуально", group: "Группа" };

/**
 * Раздел "Курсы" для branch_owner (см. /branch/*).
 *
 * В отличие от AdminCourses (owner, /admin/courses), эта страница
 * только для просмотра: branch_owner видит курсы своего филиала, но
 * не может создавать, редактировать или удалять курсы — на бэкенде
 * POST/PATCH/DELETE /courses защищены RequireRoles(owner) (см.
 * academic-service/internal/app/app.go), поэтому кнопок добавления,
 * редактирования и удаления здесь нет намеренно, а не просто скрыты.
 *
 * GET /courses для branch_owner сервер сам ограничивает его филиалом
 * (courseHandler.List подставляет claims.BranchID), поэтому фильтр по
 * филиалу на фронте не нужен — в отличие от AdminCourses, где owner
 * выбирает филиал вручную.
 */
export default function BranchCourses() {
  const { user } = useAuth();

  const [courses, setCourses] = useState([]);
  const [tutors, setTutors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [coursesRes, peopleRes] = await Promise.all([fetchCourses(), fetchMyPeople()]);
        if (cancelled) return;
        setCourses(coursesRes?.items ?? []);
        setTutors(peopleRes?.tutors ?? []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось загрузить список курсов");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const tutorNameById = useMemo(() => {
    const map = {};
    tutors.forEach((t) => (map[t.id] = `${t.last_name ?? ""} ${t.first_name ?? ""}`.trim() || `#${t.id}`));
    return map;
  }, [tutors]);

  return (
    <DashboardShell
      role="branch_owner"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="mt-4 pb-stack-lg space-y-stack-lg">
        <div>
          <h2 className="font-headline-md text-headline-md text-primary mb-1">Курсы</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Курсы вашего филиала. Добавление, изменение и удаление курсов доступно только владельцу сети.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-surface-container-low text-on-surface-variant border-b border-outline-variant">
                <tr>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Курс</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Предмет</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Формат</th>
                  <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Преподаватели</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {!loading && courses.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-10 text-center text-on-surface-variant">
                      Курсы не найдены
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={4} className="px-6 py-10 text-center text-on-surface-variant">
                      Загрузка...
                    </td>
                  </tr>
                )}
                {courses.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-label-md text-label-md font-bold text-on-surface">{c.title}</div>
                      {c.description && (
                        <div className="text-[12px] text-on-surface-variant mt-0.5 max-w-xs truncate">{c.description}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-label-md font-label-md">{c.subject}</td>
                    <td className="px-6 py-4">
                      <span className="inline-block whitespace-nowrap bg-primary-fixed text-on-primary-fixed px-3 py-1 rounded-full text-label-md font-medium">
                        {FORMAT_LABEL[c.format] ?? c.format}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-label-md font-label-md text-on-surface-variant">
                      {c.tutor_ids?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {c.tutor_ids.map((id) => (
                            <span
                              key={id}
                              className="inline-block whitespace-nowrap bg-surface-container-high px-2 py-0.5 rounded-full text-[12px]"
                            >
                              {tutorNameById[id] || `#${id}`}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-outline">Не назначены</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
