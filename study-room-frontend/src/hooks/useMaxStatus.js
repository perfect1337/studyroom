import { useEffect, useState } from "react";
import { fetchMaxStatus } from "../api/notifications.js";

export function useMaxStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await fetchMaxStatus();
      setStatus(data);
      setError("");
      return data;
    } catch (e) {
      setStatus({ connected: false });
      setError(e.message || "Не удалось проверить статус MAX");
      throw e;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load().catch(() => {}); }, []);
  return { status, loading, error, refresh: load };
}
