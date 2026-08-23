// Общий компонент пагинации для таблиц/списков (ученики, преподаватели, заявки и т.д.).
// Работает поверх уже загруженного массива на клиенте — контракт бэкенда не описывает
// параметры page/limit для списков людей, поэтому режем массив на страницы в UI.
export default function Pagination({ page, pageSize, total, onPageChange, itemLabel = "элементов" }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(total, safePage * pageSize);

  if (total === 0) return null;

  function pageNumbers() {
    const pages = [];
    const window = 1;
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= safePage - window && p <= safePage + window)) {
        pages.push(p);
      } else if (pages[pages.length - 1] !== "...") {
        pages.push("...");
      }
    }
    return pages;
  }

  return (
    <div className="px-6 py-4 bg-surface-container-low border-t border-outline-variant flex flex-col sm:flex-row justify-between items-center gap-3">
      <span className="text-label-md text-on-surface-variant">
        Показано {from}–{to} из {total} {itemLabel}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={safePage === 1}
            onClick={() => onPageChange(safePage - 1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            aria-label="Предыдущая страница"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_left</span>
          </button>
          {pageNumbers().map((p, i) =>
            p === "..." ? (
              <span key={`ellipsis-${i}`} className="w-8 h-8 flex items-center justify-center text-on-surface-variant text-label-md">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                className={`w-8 h-8 flex items-center justify-center rounded-lg text-label-md font-bold transition-colors ${
                  p === safePage
                    ? "bg-primary text-on-primary"
                    : "text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            type="button"
            disabled={safePage === totalPages}
            onClick={() => onPageChange(safePage + 1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            aria-label="Следующая страница"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_right</span>
          </button>
        </div>
      )}
    </div>
  );
}
