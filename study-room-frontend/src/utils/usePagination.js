import { useEffect, useMemo, useState } from "react";

// Режет массив на страницы и сбрасывает текущую страницу на 1, когда меняется длина
// исходного списка (например, после применения нового фильтра/поиска).
export function usePagination(items, pageSize = 10) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [items.length, pageSize]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  return { page: safePage, setPage, pageItems, totalPages };
}
