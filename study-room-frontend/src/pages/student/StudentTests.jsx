import { useEffect, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchTests, submitTest } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const FILTERS = ["Все", "Сдан", "Не сдан"];

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function StudentTests() {
  const { user } = useAuth();
  const [filter, setFilter] = useState("Все");
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submittingId, setSubmittingId] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    fetchTests({ student_id: user.id })
      .then((res) => !cancelled && setTests(res?.items ?? []))
      .catch((e) => !cancelled && setError(e.message || "Не удалось загрузить тесты"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const items = tests.filter((t) => {
    if (filter === "Все") return true;
    if (filter === "Не сдан") return t.status !== "submitted";
    return t.status === "submitted";
  });

  async function handleSubmit(t) {
    if (t.status === "submitted") return;
    setSubmittingId(t.id);
    try {
      const updated = await submitTest(t.id);
      setTests((prev) => prev.map((item) => (item.id === t.id ? { ...item, ...updated } : item)));
    } catch (e) {
      setError(e.message || "Не удалось отметить тест сданным");
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <DashboardShell
      role="student"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="space-y-stack-md pb-stack-lg mt-4">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-background mb-1">Тесты</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Тесты, которые выдали ваши репетиторы. Оценка появляется после проверки в разделе «Успеваемость».
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-full text-sm font-label-md font-medium border transition-colors ${
                filter === f
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:bg-surface-container-low"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden overflow-x-auto">
          <table className="w-full text-left min-w-[720px]">
            <thead className="bg-surface-container text-on-surface-variant text-label-md font-bold uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">Тест</th>
                <th className="px-6 py-4">Статус</th>
                <th className="px-6 py-4">Оценка</th>
                <th className="px-6 py-4">Выдан</th>
                <th className="px-6 py-4 text-right">Действие</th>
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
              {!loading &&
                items.map((t) => {
                  const isSubmitted = t.status === "submitted";
                  return (
                    <tr key={t.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-1.5 bg-primary/10 text-primary rounded shrink-0">
                            <span className="material-symbols-outlined text-[18px]">quiz</span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-label-md text-on-surface truncate max-w-xs">{t.title}</p>
                            <a
                              href={t.link_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-primary hover:underline break-all"
                            >
                              {t.link_url}
                            </a>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <span className={`flex items-center gap-1.5 font-bold text-[13px] ${isSubmitted ? "text-primary" : "text-secondary"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isSubmitted ? "bg-primary" : "bg-secondary"}`} />
                          {isSubmitted ? `Сдан ${formatDate(t.submitted_at)}` : "Не сдан"}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        {t.grade ? (
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary font-bold">
                            {t.grade}
                          </span>
                        ) : (
                          <span className="text-on-surface-variant text-sm">—</span>
                        )}
                      </td>
                      <td className="px-6 py-5 text-on-surface-variant font-body-md">{formatDate(t.created_at)}</td>
                      <td className="px-6 py-5 text-right">
                        <button
                          onClick={() => handleSubmit(t)}
                          disabled={isSubmitted || submittingId === t.id}
                          className="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-container transition-colors disabled:opacity-50"
                        >
                          {isSubmitted ? "Сдан" : submittingId === t.id ? "Отправка..." : "Отметить сданным"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-on-surface-variant">
                    Нет тестов с таким статусом.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
