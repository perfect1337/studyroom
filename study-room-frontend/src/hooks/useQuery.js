import { useCallback, useEffect, useRef, useState } from "react";
import { cachedQuery, subscribeQuery, getQueryData } from "../api/queryCache.js";

/**
 * useQuery(key, fetcher, options?) — хук для GET-запросов с кэшем по ключу.
 *
 * В отличие от голого `fetch` в useEffect (было в 32 файлах):
 * - при повторном заходе на страницу в пределах staleTime данные берутся из кэша
 *   мгновенно, без похода в сеть и без "мигания" пустого состояния;
 * - если несколько компонентов на экране одновременно запросят один и тот же key
 *   (например, список филиалов в сайдбаре и в фильтре страницы), реальный HTTP-запрос
 *   уйдёт только один раз;
 * - компоненты, подписанные на один key, синхронизированы: обновление в одном
 *   месте (через refetch) видно во всех остальных.
 *
 * loading vs isRefetching:
 * - `loading` становится true только тогда, когда для этого key ещё нет вообще
 *   никаких данных (самая первая загрузка) — именно в этот момент уместно
 *   показать скелетон/спиннер вместо виджета.
 * - `isRefetching` — true во время любого повторного запроса (в т.ч. фоновое
 *   автообновление по refetchInterval или ручной refetch()), пока на экране
 *   остаются уже показанные ранее данные. UI может, например, показать тонкий
 *   индикатор в углу карточки, но НЕ обязан прятать сам виджет — так автообновление
 *   остаётся незаметным и не выглядит как перезагрузка страницы.
 *
 * refetchInterval: мс — если задан, данные тихо обновляются в фоне с этим
 * интервалом, пока компонент смонтирован (полезно для виджетов, которые должны
 * сами обновляться, не дожидаясь действий пользователя).
 *
 * key: string | array | null|false — falsy отключает запрос (см. enabled).
 * fetcher: () => Promise<T> — обычно уже существующая api/*.js функция.
 *
 * Пример:
 *   const { data, loading, isRefetching, error, refetch } = useQuery(
 *     ["branches"],
 *     fetchBranches,
 *     { refetchInterval: 30_000 },
 *   );
 */
export function useQuery(key, fetcher, { staleTime, enabled = true, refetchInterval } = {}) {
  const active = enabled && !!key;
  const [data, setData] = useState(() => (active ? getQueryData(key) : undefined));
  const [loading, setLoading] = useState(active && getQueryData(key) === undefined);
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const keyStr = active ? (Array.isArray(key) ? JSON.stringify(key) : key) : null;

  const load = useCallback(
    (force = false) => {
      if (!active) return Promise.resolve();
      // Показываем блокирующий loading только пока для этого ключа вообще нет
      // данных. Если данные уже есть (из кэша или с прошлой загрузки), это
      // фоновое обновление — виджет остаётся на экране как есть.
      const hasData = getQueryData(key) !== undefined;
      if (hasData) {
        setIsRefetching(true);
      } else {
        setLoading(true);
      }
      return cachedQuery(key, () => fetcherRef.current(), { staleTime, force })
        .then(() => setError(null))
        .catch((e) => setError(e))
        .finally(() => {
          setLoading(false);
          setIsRefetching(false);
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyStr, active, staleTime]
  );

  useEffect(() => {
    if (!active) return;
    const unsubscribe = subscribeQuery(key, () => setData(getQueryData(key)));
    load();
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyStr, active]);

  // Тихое автообновление: не трогает `loading`, поэтому пользователь не видит
  // ни перезагрузки страницы, ни мигания виджета — только незаметно обновлённые
  // значения (data) после ответа сервера.
  useEffect(() => {
    if (!active || !refetchInterval) return;
    const id = setInterval(() => load(true), refetchInterval);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyStr, active, refetchInterval]);

  return { data, loading, isRefetching, error, refetch: () => load(true) };
}
