import { useEffect, useState } from "react";
import { fetchNotificationSettings } from "../api/notifications.js";
import { useMaxStatus } from "./useMaxStatus.js";

export function useMaxConnectPrompt() {
  const { status } = useMaxStatus();
  const [maxEnabled, setMaxEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchNotificationSettings().then((s) => {
      if (!cancelled) setMaxEnabled(!!s?.max_enabled);
    }).catch(() => { if (!cancelled) setMaxEnabled(false); });
    return () => { cancelled = true; };
  }, []);
  return maxEnabled && !!status && !status.connected;
}
