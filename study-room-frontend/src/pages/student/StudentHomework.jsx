import { useEffect, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchHomework, markHomeworkOpened } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const FILTERS = ["Все", "Сделано ", "Не сделано"];


function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function StudentHomework() {
  const { user } = useAuth();
  const [filter, setFilter] = useState("Все");
  const [homework, setHomework] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    fetchHomework({ student_id: user.id })
      .then((res) => !cancelled && setHomework(res?.items ?? []))
      .catch((e) => !cancelled && setError(e.message || "Не удалось загрузить задания"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const items = homework.filter((hw) => {
    if (filter === "Все") return true;
    if (filter === "Не сделано") return hw.status !== "viewed";
    return hw.status === "viewed";
  });

  function handleOpen(hw) {
    window.open(hw.link_url, "_blank", "noopener");
    if (hw.status !== "viewed") {
      markHomeworkOpened(hw.id);
      setHomework((prev) =>
        prev.map((item) => (item.id === hw.id ? { ...item, status: "viewed", viewed_at: new Date().toISOString() } : item))
      );
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
          <h2 className="font-headline-md text-headline-md text-on-background mb-1">Домашние задания</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Ссылки на задания, которые выдали ваши репетиторы.
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
          <table className="w-full text-left min-w-[640px]">
            <thead className="bg-surface-container text-on-surface-variant text-label-md font-bold uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">Задание</th>
                <th className="px-6 py-4">Статус</th>
                <th className="px-6 py-4">Выдано</th>
                <th className="px-6 py-4 text-right">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {loading && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-on-surface-variant">
                    Загрузка…
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((hw) => {
                  const isViewed = hw.status === "viewed";
                  return (
                    <tr key={hw.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-1.5 bg-primary/10 text-primary rounded shrink-0">
                            <span className="material-symbols-outlined text-[18px]">link</span>
                          </div>
                          <span className="font-label-md text-on-surface truncate max-w-xs">{hw.link_url}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <span className={`flex items-center gap-1.5 font-bold text-[13px] ${isViewed ? "text-primary" : "text-secondary"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isViewed ? "bg-primary" : "bg-secondary"}`} />
                          {isViewed ? `Сделано ${formatDate(hw.viewed_at)}` : "Не сделано"}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-on-surface-variant font-body-md">{formatDate(hw.created_at)}</td>
                      <td className="px-6 py-5 text-right">
                        <button
                          onClick={() => handleOpen(hw)}
                          className="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-container transition-colors"
                        >
                          Открыть
                        </button>
                      </td>
                    </tr>
                  );
                })}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-on-surface-variant">
                    Нет заданий с таким статусом.
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
