import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TELEGRAM_BOT_URL } from "../../api/config.js";

const DISMISS_KEY = "sr_telegram_banner_dismissed_until";
const DISMISS_HOURS = 24;

function isDismissed() {
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() < until;
  } catch {
    return false;
  }
}

function dismissForNow() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_HOURS * 60 * 60 * 1000));
  } catch {
    // localStorage может быть недоступен (приватный режим и т.п.) — тогда
    // баннер просто не запомнит закрытие до следующей перезагрузки, не
    // критично.
  }
}

// TelegramConnectBanner — плавающий баннер "Подключите Telegram для
// уведомлений". В отличие от обычных информационных блоков страницы
// (которые лежат в потоке контента сверху), этот всплывает СНИЗУ экрана
// поверх остального содержимого — как тост/snackbar — и не мешает
// работать со страницей, пока не подключишь бота или не закроешь его.
//
// Адаптация под все устройства:
// - Мобильный (<640px): во всю ширину, прижат к низу над нижней панелью
//   навигации (см. MobileBottomNav.jsx — bottom-20 здесь = pb-20 контента
//   в DashboardShell, тот же отступ, чтобы не перекрывать друг друга).
// - Планшет/десктоп (sm+): компактная плавающая карточка в правом нижнем
//   углу, классическое расположение тоста, т.к. нижней навигации там нет.
//
// Показ управляется снаружи через `show` (уже пересчитанный вызывающей
// стороной признак "telegram_enabled=true, но бот не подключён" — см.
// useTelegramConnectPrompt.js). Крестик прячет баннер на 24 часа
// (localStorage) — чтобы не надоедать при каждом переходе по разделам, но
// и не пропасть насовсем, если человек забыл подключить бота.
export default function TelegramConnectBanner({ show }) {
  const [dismissed, setDismissed] = useState(isDismissed);
  const [mounted, setMounted] = useState(false);

  const visible = show && !dismissed;

  useEffect(() => {
    if (!visible) {
      setMounted(false);
      return;
    }
    // Монтируем в "скрытом снизу" состоянии на один кадр, чтобы transition
    // сыграл именно как появление снизу вверх, а не мгновенным скачком.
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [visible]);

  if (!visible) return null;

  function handleDismiss() {
    dismissForNow();
    setMounted(false);
    // Даём анимации доиграть перед тем, как реально снять баннер из DOM.
    setTimeout(() => setDismissed(true), 200);
  }

  // Портал прямо в <body> — иначе на 180мс переходной анимации страницы
  // (.page-fade-in на <main>, см. index.css) `position: fixed` внутри нёс бы
  // "родное" позиционирование относительно <main> с активным transform, а не
  // относительно viewport, и баннер на миг съезжал бы при каждой навигации.
  return createPortal(
    <div
      className={`fixed inset-x-0 bottom-20 sm:bottom-6 z-40 flex justify-center sm:justify-end px-4 sm:px-6 pointer-events-none transition-all duration-300 ease-out ${
        mounted ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      }`}
    >
      <div className="pointer-events-auto w-full sm:w-auto sm:max-w-sm bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-xl p-4 flex items-start gap-3">
        <span className="material-symbols-outlined text-primary text-[22px] mt-0.5 shrink-0">telegram</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="font-label-md text-on-surface font-bold">Подключите Telegram для уведомлений</p>
            <button
              type="button"
              onClick={handleDismiss}
              className="shrink-0 p-1 -mr-1 -mt-1 rounded-full hover:bg-surface-container-high transition-colors"
              aria-label="Скрыть"
            >
              <span className="material-symbols-outlined text-[18px] text-on-surface-variant">close</span>
            </button>
          </div>
          <p className="text-sm text-on-surface-variant mb-3">
            Перейдите в бота <strong>Study Room</strong>, нажмите{" "}
            <code className="bg-surface-container px-1.5 py-0.5 rounded text-xs font-mono">/start</code> и введите ваш
            email.
          </p>
          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-primary text-on-primary px-4 py-2 rounded-lg font-label-md font-bold hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined text-[18px]">open_in_new</span>
            Открыть бота
          </a>
        </div>
      </div>
    </div>,
    document.body
  );
}
