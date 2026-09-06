/**
 * Лёгкая модалка подтверждения "Да/Нет" в один шаг — для действий, которые
 * не такие разрушительные, чтобы требовать набора текста (как
 * ConfirmDeleteModal), но всё равно должны подтверждаться явным вторым
 * кликом, а не одним касанием тумблера (например, включение/выключение
 * режима преподавателя у branch_owner — см. SettingsPage.jsx).
 *
 * Props:
 * - open: bool — показывать модалку
 * - title: string — заголовок
 * - description: string | ReactNode — текст-пояснение/предупреждение
 * - confirmLabel / cancelLabel: string — подписи кнопок
 * - danger: bool — если true, кнопка подтверждения и акцент окрашены в
 *   error-цвета (для необратимых последствий), иначе — обычный primary
 * - busy: bool — идёт запрос (блокирует кнопки, меняет текст подтверждения)
 * - error: string — текст ошибки, если действие не удалось
 * - onCancel: () => void
 * - onConfirm: () => void
 */
export default function ConfirmToggleModal({
  open,
  title = "Подтвердите действие",
  description,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  danger = false,
  busy = false,
  error = "",
  onCancel,
  onConfirm,
}) {
  if (!open) return null;

  const accentIcon = danger ? "warning" : "help";
  const accentIconWrap = danger ? "bg-error-container" : "bg-primary-fixed";
  const accentIconColor = danger ? "text-error" : "text-primary";
  const confirmBtnClasses = danger
    ? "bg-error text-on-error hover:brightness-110"
    : "bg-primary text-on-primary hover:opacity-90";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full ${accentIconWrap} flex items-center justify-center shrink-0`}>
              <span className={`material-symbols-outlined ${accentIconColor}`}>{accentIcon}</span>
            </div>
            <h3 className="font-headline-sm text-headline-sm text-on-surface">{title}</h3>
          </div>
          {!busy && (
            <button
              type="button"
              onClick={onCancel}
              className="p-1 hover:bg-surface-container-high rounded-full shrink-0"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>

        {description && (
          <div className="text-label-md text-on-surface-variant whitespace-pre-line">{description}</div>
        )}

        {error && <p className="text-sm text-error">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 border border-outline-variant text-on-surface py-3 rounded-lg font-bold hover:bg-surface-container-high transition-all disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 py-3 rounded-lg font-bold transition-all disabled:opacity-60 ${confirmBtnClasses}`}
          >
            {busy ? "Подождите..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
