import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchTests } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";
import CourseTag from "../../components/ui/CourseTag.jsx";

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

/**
 * "Успеваемость" — оценки ученика за тесты. Средний балл считается как
 * простая арифметическая средняя по всем оценённым тестам (см. ТЗ:
 * "если тестов пройдено было несколько, берётся средняя арифметическая").
 * Ниже — разбивка по каждому отдельному тесту.
 */
export default function StudentGrades() {
  const { user } = useAuth();
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    fetchTests({ student_id: user.id })
      .then((res) => !cancelled && setTests(res?.items ?? []))
      .catch((e) => !cancelled && setError(e.message || "Не удалось загрузить успеваемость"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const sorted = useMemo(
    () => tests.slice().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [tests]
  );
  const graded = sorted.filter((t) => t.grade != null);
  const avgGrade = graded.length ? graded.reduce((s, t) => s + t.grade, 0) / graded.length : null;

  return (
    <DashboardShell
      role="student"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="space-y-stack-lg pb-stack-lg mt-4">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-background mb-1">Успеваемость</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Оценки за тесты, которые проверили ваши репетиторы.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
            {error}
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-3 gap-stack-md">
          <div className="bg-surface-container-lowest rounded-xl p-stack-lg shadow-sm border border-outline-variant flex items-center gap-stack-md">
            <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                grade
              </span>
            </div>
            <div>
              <p className="text-xs text-on-surface-variant uppercase tracking-wide mb-1">Средний балл</p>
              <h3 className="font-headline-md text-headline-md text-primary">
                {loading ? "…" : avgGrade != null ? avgGrade.toFixed(2) : "—"}
              </h3>
            </div>
          </div>
          <div className="bg-surface-container-lowest rounded-xl p-stack-lg shadow-sm border border-outline-variant flex items-center gap-stack-md">
            <div className="w-16 h-16 rounded-full bg-surface-container text-on-surface-variant flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-2xl">quiz</span>
            </div>
            <div>
              <p className="text-xs text-on-surface-variant uppercase tracking-wide mb-1">Тестов оценено</p>
              <h3 className="font-headline-md text-headline-md text-on-background">{loading ? "…" : graded.length}</h3>
            </div>
          </div>
          <div className="bg-surface-container-lowest rounded-xl p-stack-lg shadow-sm border border-outline-variant flex items-center gap-stack-md">
            <div className="w-16 h-16 rounded-full bg-surface-container text-on-surface-variant flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-2xl">pending_actions</span>
            </div>
            <div>
              <p className="text-xs text-on-surface-variant uppercase tracking-wide mb-1">Ждут оценки/сдачи</p>
              <h3 className="font-headline-md text-headline-md text-on-background">
                {loading ? "…" : sorted.length - graded.length}
              </h3>
            </div>
          </div>
        </section>

        <section className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden overflow-x-auto">
          <div className="p-stack-md border-b border-outline-variant">
            <h3 className="font-headline-sm text-headline-sm text-on-background">Оценки по каждому тесту</h3>
          </div>
          <table className="w-full text-left min-w-[640px]">
            <thead className="bg-surface-container text-on-surface-variant text-label-md font-bold uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">Тест</th>
                <th className="px-6 py-4">Курс / предмет</th>
                <th className="px-6 py-4">Статус</th>
                <th className="px-6 py-4">Оценка</th>
                <th className="px-6 py-4 text-right">Дата</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-on-surface-variant">
                    Загрузка…
                  </td>
                </tr>
              )}
              {!loading && sorted.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-on-surface-variant">
                    Тестов пока не было.
                  </td>
                </tr>
              )}
              {!loading &&
                sorted.map((t) => {
                  const isSubmitted = t.status === "submitted";
                  return (
                    <tr key={t.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="px-6 py-5 font-label-md text-on-background">{t.title}</td>
                      <td className="px-6 py-5">
                        <CourseTag title={t.course_title} subject={t.course_subject} />
                      </td>
                      <td className="px-6 py-5">
                        <span className={`flex items-center gap-1.5 font-bold text-[13px] ${isSubmitted ? "text-primary" : "text-secondary"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isSubmitted ? "bg-primary" : "bg-secondary"}`} />
                          {isSubmitted ? "Сдан" : "Не сдан"}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        {t.grade != null ? (
                          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary font-bold">
                            {t.grade}
                          </span>
                        ) : (
                          <span className="text-on-surface-variant text-sm">—</span>
                        )}
                      </td>
                      <td className="px-6 py-5 text-right text-on-surface-variant font-body-md">
                        {formatDate(t.graded_at || t.submitted_at || t.created_at)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
      </div>
    </DashboardShell>
  );
}
