// Лёгкий кэш GET-запросов по ключу — замена self-written fetch-в-useEffect без
// кэша/дедупликации в 32 файлах. Не тянем @tanstack/react-query ради этого:
// нужны ровно две вещи — не бить по бэку одинаковыми запросами параллельно и
// не перезапрашивать то, что уже свежее staleTime.
//
// Используется на уровне api/*.js: сами fetchBranches/fetchCourses/... оборачиваются
// в cachedQuery(...), так что кэш работает прозрачно для всех вызывающих компонентов —
// правки в 30+ страницах не нужны. Мутации (create/update/delete) вызывают
// invalidateQuery(...), чтобы следующее чтение снова сходило в сеть.

const cache = new Map(); // key(string) -> { data, error, promise, timestamp, listeners: Set<() => void> }

function normalizeKey(key) {
  return Array.isArray(key) ? JSON.stringify(key) : String(key);
}

function getEntry(key) {
  let entry = cache.get(key);
  if (!entry) {
    entry = { data: undefined, error: undefined, promise: null, timestamp: 0, listeners: new Set() };
    cache.set(key, entry);
  }
  return entry;
}

function notify(key) {
  cache.get(key)?.listeners.forEach((listener) => listener());
}

/**
 * cachedQuery(key, fetcher, options?) -> Promise<T>
 *
 * key         — string | array (например ["courses", { tutor_id: 5 }]), сериализуется через JSON.stringify.
 * fetcher     — () => Promise<T>, вызывается только при промахе кэша.
 * staleTime   — мс, в течение которых закэшированные данные считаются свежими (по умолчанию 30с).
 * force       — игнорировать кэш и staleTime, перезапросить принудительно.
 *
 * Если несколько компонентов одновременно запросят один и тот же key (типичный
 * случай — Sidebar и страница дважды грузят один и тот же список курсов), второй
 * и последующие вызовы переиспользуют уже летящий промис вместо нового fetch.
 */
export function cachedQuery(key, fetcher, { staleTime = 30_000, force = false } = {}) {
  const k = normalizeKey(key);
  const entry = getEntry(k);
  const isFresh = entry.timestamp > 0 && Date.now() - entry.timestamp < staleTime;

  if (!force && isFresh && entry.data !== undefined) {
    return Promise.resolve(entry.data);
  }
  if (!force && entry.promise) {
    return entry.promise;
  }

  const promise = Promise.resolve()
    .then(fetcher)
    .then((data) => {
      entry.data = data;
      entry.error = undefined;
      entry.timestamp = Date.now();
      entry.promise = null;
      notify(k);
      return data;
    })
    .catch((err) => {
      entry.error = err;
      entry.promise = null;
      notify(k);
      throw err;
    });

  entry.promise = promise;
  return promise;
}

/**
 * invalidateQuery(keyOrPrefix) — сбросить кэш после мутации.
 * - Точный ключ ("branches" или ["courses", {...}]) — удаляет только его.
 * - Префикс-массив без последнего сегмента, например ["courses"] — удаляет ВСЕ
 *   закэшированные варианты courses-запроса независимо от фильтров (branch_id/subject/tutor_id),
 *   так как после создания/удаления курса неизвестно, под какими фильтрами он "прятался".
 */
export function invalidateQuery(keyOrPrefix) {
  if (Array.isArray(keyOrPrefix) && keyOrPrefix.length === 1 && typeof keyOrPrefix[0] === "string") {
    const prefix = `["${keyOrPrefix[0]}"`;
    for (const k of cache.keys()) {
      if (k.startsWith(prefix)) cache.delete(k);
    }
    return;
  }
  cache.delete(normalizeKey(keyOrPrefix));
}

/** Подписка на изменения конкретного ключа — для useQuery (см. src/hooks/useQuery.js). */
export function subscribeQuery(key, listener) {
  const entry = getEntry(normalizeKey(key));
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

export function getQueryData(key) {
  return cache.get(normalizeKey(key))?.data;
}

/** Полная очистка кэша — вызывается при logout, чтобы данные одного пользователя
 * не "просочились" в кэш после входа под другим аккаунтом. */
export function clearQueryCache() {
  cache.clear();
}
