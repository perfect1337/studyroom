import { useEffect, useState } from "react";

/**
 * Модалка удаления с двойной проверкой — специально для необратимых операций
 * (например, удаление филиала). Два независимых шага защиты:
 *   1) нужно набрать точное название сущности, чтобы разблокировать кнопку "Продолжить";
 *   2) на втором экране нужно отдельно подтвердить финальным кликом "Да, удалить".
 *
 * Props:
 * - open: bool — показывать модалку
 * - title: string — заголовок ("Удалить филиал?")
 * - itemLabel: string — то, что нужно ввести для подтверждения (например, название филиала)
 * - description: string — доп. предупреждение (например, про необратимость / последствия)
 * - busy: bool — идёт запрос на удаление (блокирует кнопки, меняет текст)
 * - error: string — текст ошибки, если удаление не удалось
 * - onCancel: () => void
 * - onConfirm: () => void — вызывается только после прохождения обоих шагов
 */
export default function ConfirmDeleteModal({
  open,
  title = "Удалить?",
  itemLabel,
  description,
  busy = false,
  error = "",
  onCancel,
  onConfirm,
}) {
  const [step, setStep] = useState(1);
  const [typedValue, setTypedValue] = useState("");

  // Сбрасываем состояние шагов при каждом открытии модалки — иначе при повторном
  // открытии для другого элемента останется "разблокированное" состояние от прошлого.
  useEffect(() => {
    if (open) {
      setStep(1);
      setTypedValue("");
    }
  }, [open]);

  if (!open) return null;

  const matches = typedValue.trim() === (itemLabel ?? "").trim() && typedValue.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : onCancel}>
      <div
        className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-error">warning</span>
            </div>
            <h3 className="font-headline-sm text-headline-sm text-on-surface">{title}</h3>
          </div>
          {!busy && (
            <button onClick={onCancel} className="p-1 hover:bg-surface-container-high rounded-full shrink-0">
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>

        {description && <p className="text-label-md text-on-surface-variant">{description}</p>}

        {step === 1 ? (
          <>
            <div className="space-y-stack-sm">
              <label className="font-label-md text-on-surface-variant ml-1">
                Чтобы продолжить, введите <span className="font-bold text-on-surface">«{itemLabel}»</span>
              </label>
              <input
                autoFocus
                value={typedValue}
                onChange={(e) => setTypedValue(e.target.value)}
                placeholder={itemLabel}
                className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 focus:ring-2 focus:ring-error/20 focus:border-error transition-all outline-none text-on-surface"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 border border-outline-variant text-on-surface py-3 rounded-lg font-bold hover:bg-surface-container-high transition-all"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!matches}
                onClick={() => setStep(2)}
                className="flex-1 bg-error text-on-error py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Продолжить
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="p-4 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
              Это действие необратимо. Точно удалить «{itemLabel}»?
            </div>
            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={busy}
                className="flex-1 border border-outline-variant text-on-surface py-3 rounded-lg font-bold hover:bg-surface-container-high transition-all disabled:opacity-60"
              >
                Назад
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="flex-1 bg-error text-on-error py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
              >
                {busy ? "Удаление..." : "Да, удалить"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
