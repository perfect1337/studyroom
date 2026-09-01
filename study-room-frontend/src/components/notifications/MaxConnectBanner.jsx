import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MAX_BOT_URL } from "../../api/config.js";

const DISMISS_KEY = "sr_max_banner_dismissed_until";
const DISMISS_HOURS = 24;
function isDismissed() { try { return Date.now() < Number(localStorage.getItem(DISMISS_KEY) || 0); } catch { return false; } }
export default function MaxConnectBanner({ show }) {
  const [dismissed, setDismissed] = useState(isDismissed);
  const [mounted, setMounted] = useState(false);
  const visible = show && !dismissed;
  useEffect(() => { if (!visible) { setMounted(false); return; } const id = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(id); }, [visible]);
  if (!visible) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_HOURS * 3600000)); } catch {} setMounted(false); setTimeout(() => setDismissed(true), 200); };
  return createPortal(
    <div className={`fixed inset-x-0 bottom-20 sm:bottom-6 z-40 flex justify-center sm:justify-end px-4 sm:px-6 pointer-events-none transition-all duration-300 ${mounted ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}>
      <div className="pointer-events-auto w-full sm:w-auto sm:max-w-sm bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-xl p-4 flex items-start gap-3">
        <span className="material-symbols-outlined text-primary text-[22px]">chat</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1"><p className="font-label-md text-on-surface font-bold">Подключите MAX для уведомлений</p><button type="button" onClick={dismiss} className="p-1 rounded-full hover:bg-surface-container-high" aria-label="Скрыть"><span className="material-symbols-outlined text-[18px]">close</span></button></div>
          <p className="text-sm text-on-surface-variant mb-3">Откройте бота Study Room в MAX, нажмите <strong>Старт</strong> и введите email вашего аккаунта.</p>
          <a href={MAX_BOT_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-primary text-on-primary px-4 py-2 rounded-lg font-label-md font-bold hover:opacity-90">Открыть бота</a>
        </div>
      </div>
    </div>, document.body
  );
}
