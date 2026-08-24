import { useEffect, useRef, useState } from "react";

// Цвета точки-индикатора статуса — согласованы с STATUS_COLOR в StatusBadge.jsx,
// чтобы цвет в списке совпадал с цветом бейджа рядом.
const DOT_COLOR = {
  active: "bg-green-500",
  vacation: "bg-amber-500",
  sick_leave: "bg-error",
  inactive: "bg-outline",
};

/**
 * Выпадающий список статуса преподавателя (Активен / В отпуске / На больничном /
 * Неактивен) — вместо голого нативного <select>, который на разных ОС/браузерах
 * выглядит по-разному и выбивается из остального дизайна страницы (ср. со
 * стилизованным селектом "Все филиалы" рядом). Список опций одинаков для owner
 * и branch_owner в части статусов — какие именно статусы доступны для смены,
 * задаётся снаружи через `options` (см. STATUS_OPTIONS_BY_ROLE в
 * TeachersDirectory.jsx: branch_owner не может выставить "Неактивен").
 */
export default function TutorStatusSelect({ value, options, labelMap, disabled, onChange, className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function choose(option) {
    setOpen(false);
    if (option !== value) onChange(option);
  }

  return (
    <div className={`relative shrink-0 ${className}`} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-[12px] font-label-md border border-outline-variant rounded-md pl-2.5 pr-2 py-1 bg-surface-container-lowest hover:bg-surface-container-high transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${DOT_COLOR[value] ?? "bg-outline"}`} />
          <span className="text-on-surface whitespace-nowrap">{labelMap[value] ?? value}</span>
        </span>
        <span className="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 min-w-full w-max bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg overflow-hidden py-1">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => choose(opt)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] font-label-md text-left whitespace-nowrap transition-colors ${
                opt === value
                  ? "bg-primary-container/60 text-on-primary-container"
                  : "text-on-surface hover:bg-surface-container-high"
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${DOT_COLOR[opt] ?? "bg-outline"}`} />
              <span className="flex-1">{labelMap[opt] ?? opt}</span>
              {opt === value && (
                <span className="material-symbols-outlined text-[16px] text-primary">check</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
