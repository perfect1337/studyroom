import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Ключ и текущая версия согласия — версию стоит поднять (COOKIE_CONSENT_VERSION += 1),
// если состав/назначение куки на сайте изменится настолько, что старое согласие уже
// не покрывает новую ситуацию: по 152-ФЗ (в ред. 233-ФЗ/266-ФЗ, вступили в силу в 2025)
// согласие должно быть "конкретным" — молча продолжать действовать на изменившийся
// список куки нельзя, нужно спросить заново.
const STORAGE_KEY = "sr_cookie_consent";
const CONSENT_VERSION = 1;

function readConsent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== CONSENT_VERSION) return null;
    return parsed; // { version, choice: "accepted" | "rejected", at }
  } catch {
    return null;
  }
}

function writeConsent(choice) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: CONSENT_VERSION, choice, at: new Date().toISOString() })
    );
  } catch {
    // localStorage недоступен (приватный режим и т.п.) — баннер просто будет
    // появляться заново при каждой перезагрузке, это не критично.
  }
}

// hasCookieConsent / getCookieConsentChoice — читает выбор пользователя из
// localStorage. Используйте перед тем, как включать необязательную
// аналитику/трекеры (например: `if (getCookieConsentChoice() === "accepted") { initYandexMetrika(); }`).
// Куки, строго необходимые для работы сайта (сессия входа/JWT, CSRF-токен) —
// не аналитика и не реклама, их можно и нужно ставить независимо от этого
// согласия: и GDPR (ePrivacy), и 152-ФЗ разрешают "строго необходимые" куки
// без отдельного opt-in. Спрашивать явное согласие обязательно только для
// того, что реально идентифицирует/трекает пользователя сверх этого
// минимума (аналитика, реклама, персонализация).
export function getCookieConsentChoice() {
  return readConsent()?.choice ?? null;
}

export function hasCookieConsent() {
  return getCookieConsentChoice() === "accepted";
}

// CookieConsentBanner — плашка согласия на использование куки. Всплывает
// снизу экрана (тот же паттерн, что и TelegramConnectBanner.jsx — портал в
// <body>, чтобы transition страницы не мешал позиционированию) и держится,
// пока пользователь явно не нажмёт "Принять" или "Отклонить".
//
// Важно по существу (152-ФЗ в ред. 2024–2025, ст. 9 закона "О персональных
// данных"):
// - Нет предустановленных галочек и нет "согласия по умолчанию" — баннер
//   висит, пока не нажата ОДНА из двух кнопок явно.
// - "Отклонить" — полноценная кнопка, а не мелкая ссылка где-то сбоку;
//   выбор "не согласен" сохраняется так же надёжно, как и "согласен", и
//   баннер не показывается повторно (иначе получится по факту принуждение
//   к согласию через повторный показ на каждой странице).
// - Отдельная ссылка на политику обработки персональных данных сразу в
//   тексте баннера, а не только где-то в футере.
export default function CookieConsentBanner() {
  const [consent, setConsent] = useState(readConsent);
  const [mounted, setMounted] = useState(false);

  const visible = consent === null;

  useEffect(() => {
    if (!visible) {
      setMounted(false);
      return;
    }
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [visible]);

  if (!visible) return null;

  function handleChoice(choice) {
    writeConsent(choice);
    setMounted(false);
    setTimeout(() => setConsent(readConsent()), 200);
  }

  return createPortal(
    <div
      className={`fixed inset-x-0 bottom-20 sm:bottom-0 z-50 flex justify-center px-4 pb-0 sm:pb-4 sm:px-6 pointer-events-none transition-all duration-300 ease-out ${
        mounted ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      }`}
    >
      <div className="pointer-events-auto w-full sm:max-w-xl bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <span className="material-symbols-outlined text-primary text-[22px] shrink-0 hidden sm:block">cookie</span>
        <div className="flex-1 min-w-0">
          <p className="font-label-md text-on-surface font-bold mb-1">Мы используем файлы cookie</p>
          <p className="text-sm text-on-surface-variant">
            Study Room использует cookie, чтобы сайт работал (вход в аккаунт, безопасность), а
            также — если вы согласитесь — для аналитики использования сервиса. Подробнее в{" "}
            <a
              href="https://studyroom64.ru/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Политике конфиденциальности
            </a>
            .
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => handleChoice("rejected")}
            className="flex-1 sm:flex-none bg-surface-container text-on-surface px-4 py-2 rounded-lg font-label-md font-bold hover:bg-surface-container-high transition-colors"
          >
            Отклонить
          </button>
          <button
            type="button"
            onClick={() => handleChoice("accepted")}
            className="flex-1 sm:flex-none bg-primary text-on-primary px-4 py-2 rounded-lg font-label-md font-bold hover:opacity-90 transition-opacity"
          >
            Принять
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
