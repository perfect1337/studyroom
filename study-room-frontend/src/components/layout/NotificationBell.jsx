import { useCallback, useEffect, useRef, useState } from "react";
import { fetchNotifications, markNotificationRead } from "../../api/notifications.js";

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * Реальный колокольчик уведомлений (см. api-contracts.md, раздел 5):
 * GET /notifications, PATCH /notifications/{id}/read.
 * Опрашивает список каждые 30с, показывает бейдж с числом непрочитанных,
 * по клику на уведомление отмечает его прочитанным.
 */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const containerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchNotifications({ unread_only: false });
      setItems(data?.items ?? []);
      setError("");
    } catch (err) {
      setError(err.message || "Не удалось загрузить уведомления");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    function onClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const unreadCount = items.filter((n) => !n.is_read).length;

  async function handleItemClick(n) {
    if (n.is_read) return;
    setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, is_read: true } : it)));
    try {
      await markNotificationRead(n.id);
    } catch {
      // откатываем оптимистичное обновление, если запрос не прошёл
      setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, is_read: false } : it)));
    }
  }

  async function handleCopy(text, id, e) {
    e.stopPropagation(); // Предотвращаем срабатывание handleItemClick
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000); // Сбрасываем состояние через 2 секунды
    } catch (err) {
      console.error("Не удалось скопировать текст:", err);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-full hover:bg-surface-container text-on-surface-variant relative"
        aria-label="Уведомления"
      >
        <span className="material-symbols-outlined">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-error text-white text-[10px] leading-4 text-center font-bold">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed left-3 right-3 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 max-w-none sm:max-w-[90vw] bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-outline-variant flex items-center justify-between">
            <span className="font-label-md text-on-surface font-bold">Уведомления</span>
            {unreadCount > 0 && <span className="text-[12px] text-on-surface-variant">{unreadCount} новых</span>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading && <div className="p-4 text-sm text-on-surface-variant">Загрузка…</div>}
            {!loading && error && <div className="p-4 text-sm text-error">{error}</div>}
            {!loading && !error && items.length === 0 && (
              <div className="p-4 text-sm text-on-surface-variant">Пока нет уведомлений</div>
            )}
            {!loading &&
              !error &&
              items.map((n) => (
                <div
                  key={n.id}
                  className={`w-full border-b border-outline-variant last:border-0 hover:bg-surface-container transition-colors ${
                    n.is_read ? "" : "bg-primary-fixed/10"
                  }`}
                >
                  <button
                    onClick={() => handleItemClick(n)}
                    className="w-full text-left px-4 py-3"
                  >
                    <div className="flex items-start gap-2">
                      {!n.is_read && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-on-surface break-words select-text">{n.message}</p>
                        <p className="text-[11px] text-on-surface-variant mt-1">{formatTime(n.created_at)}</p>
                      </div>
                    </div>
                  </button>
                  <div className="px-4 pb-2 flex justify-end">
                    <button
                      onClick={(e) => handleCopy(n.message, n.id, e)}
                      className="text-[11px] text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1"
                      title="Копировать текст уведомления"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {copiedId === n.id ? "check" : "content_copy"}
                      </span>
                      {copiedId === n.id ? "Скопировано" : "Копировать"}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}