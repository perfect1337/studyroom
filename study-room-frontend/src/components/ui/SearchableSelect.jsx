import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Выпадающий список с поиском по тексту — используется там, где вариантов
 * может быть много (например, список родителей в форме "Добавить договор" —
 * см. FinanceDirectory.jsx, используется и владельцем сети (owner), и
 * руководителем филиала (branch_owner)). В отличие от нативного <select>,
 * позволяет фильтровать варианты по подстроке и всегда показывает список
 * отсортированным по алфавиту (по полю `label`).
 *
 * Props:
 *  - options: [{ value, label }]
 *  - value: текущее выбранное значение (или "")
 *  - onChange(value): вызывается при выборе варианта
 *  - placeholder: текст в поле, когда ничего не выбрано
 *  - searchPlaceholder: текст в поле поиска внутри выпадающего списка
 *  - disabled, required, className
 */
export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Выберите значение",
  searchPlaceholder = "Поиск…",
  disabled = false,
  required = false,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);
  const inputRef = useRef(null);

  // Список всегда отсортирован по алфавиту (locale-aware, важно для кириллицы),
  // чтобы родителя можно было быстро найти глазами даже без поиска.
  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => a.label.localeCompare(b.label, "ru")),
    [options]
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedOptions;
    return sortedOptions.filter((o) => o.label.toLowerCase().includes(q));
  }, [sortedOptions, query]);

  const selected = sortedOptions.find((o) => String(o.value) === String(value));

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (open) {
      // Автофокус на поле поиска при открытии списка.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  function choose(option) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={`relative ${className}`} ref={ref}>
      {/* Скрытый required-input — чтобы форма могла валидировать поле "обязательно"
          так же, как обычный <select required>, не дублируя логику submit-обработчика. */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          className="absolute w-0 h-0 opacity-0 pointer-events-none"
          value={value || ""}
          required
          onChange={() => {}}
        />
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md text-left focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className={`truncate ${selected ? "text-on-surface" : "text-on-surface-variant"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && !disabled && (
        <div className="absolute top-full left-0 mt-1 z-30 w-full bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-outline-variant">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-surface border border-outline-variant rounded-md px-2.5 py-1.5 text-label-md outline-none focus:border-primary"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-label-md text-on-surface-variant">Ничего не найдено</div>
            ) : (
              filteredOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => choose(opt)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-label-md text-left transition-colors ${
                    String(opt.value) === String(value)
                      ? "bg-primary-container/60 text-on-primary-container"
                      : "text-on-surface hover:bg-surface-container-high"
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {String(opt.value) === String(value) && (
                    <span className="material-symbols-outlined text-[16px] text-primary shrink-0">check</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
