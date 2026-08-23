import { useEffect, useState } from "react";
import { fetchTelegramStatus } from "../api/notifications.js";

export function useTelegramStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await fetchTelegramStatus();
      setStatus(data);
      setError("");
    } catch (e) {
      setStatus({ connected: false });
      setError(e.message || "Не удалось проверить статус");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    load();
    return () => { cancelled = true; };
  }, []);

  return { status, loading, error, refresh: load };
}
