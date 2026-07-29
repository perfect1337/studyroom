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
 * key: string | array | null|false — falsy отключает запрос (см. enabled).
 * fetcher: () => Promise<T> — обычно уже существующая api/*.js функция.
 *
 * Пример:
 *   const { data, loading, error, refetch } = useQuery(
 *     ["branches"],
 *     fetchBranches,
 *   );
 */
export function useQuery(key, fetcher, { staleTime, enabled = true } = {}) {
  const active = enabled && !!key;
  const [data, setData] = useState(() => (active ? getQueryData(key) : undefined));
  const [loading, setLoading] = useState(active && getQueryData(key) === undefined);
  const [error, setError] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const keyStr = active ? (Array.isArray(key) ? JSON.stringify(key) : key) : null;

  const load = useCallback(
    (force = false) => {
      if (!active) return Promise.resolve();
      setLoading(true);
      return cachedQuery(key, () => fetcherRef.current(), { staleTime, force })
        .then(() => setError(null))
        .catch((e) => setError(e))
        .finally(() => setLoading(false));
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

  return { data, loading, error, refetch: () => load(true) };
}
