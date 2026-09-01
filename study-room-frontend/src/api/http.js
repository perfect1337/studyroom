import { API, USER_KEY } from "./config.js";

// Общий формат ошибок бэкенда: { error: { code, message } } (см. api-contracts.md).
export class ApiError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

// Access-токен живёт ТОЛЬКО в памяти вкладки (обычная JS-переменная модуля),
// а не в localStorage/sessionStorage. Refresh-токен фронту вообще не виден —
// бэкенд кладёт его в httpOnly cookie (см. study-room-backend/user-service/
// internal/handlers/cookies.go), которую браузер сам прикладывает к запросам
// на /auth/refresh и /auth/logout через credentials: "include".
//
// Почему это важно: раньше оба токена лежали в localStorage, и любая XSS
// (dangerouslySetInnerHTML, уязвимый сторонний виджет и т.п.) давала
// атакующему не только текущую сессию, а долгоживущий refresh-токен — то
// есть постоянный захват аккаунта. localStorage читается любым JS на
// странице; httpOnly cookie — не читается вообще никаким JS, даже при XSS.
// Access-токен в памяти по той же причине безопаснее localStorage: он не
// переживает перезагрузку вкладки (это ожидаемо — при перезагрузке первый
// же запрос словит 401 и молча обновится через cookie, см. ниже), зато его
// не может утащить синхронный script, читающий Storage.
let accessToken = null;

function getAccessToken() {
  return accessToken;
}

// getCurrentAccessToken — то же самое, но публично, для редких мест в коде,
// которые вызывают fetch() напрямую в обход request()/usersApi()/... (см.
// markHomeworkOpened в api/academic.js) и раньше читали токен из
// localStorage. Токен теперь только в памяти — им и делимся, ничего в
// Storage больше не пишем и не читаем.
export function getCurrentAccessToken() {
  return accessToken;
}

// data — тело ответа /auth/login, /auth/register или /auth/refresh.
// refresh_token в нём больше нет (это осознанно, см. комментарий выше) —
// параметр здесь принимается только на случай устаревшего/иного бэкенда и
// просто игнорируется, чтобы не хранить его нигде на фронте.
export function setTokens({ access_token }) {
  if (access_token) accessToken = access_token;
}

export function setStoredUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// clearLocalSession — только локальная очистка (память + кэш профиля).
// НЕ отзывает refresh-токен на сервере — для этого есть logout() ниже.
// Используется, когда серверный логаут либо уже не нужен (refresh
// провалился — токен и так недействителен), либо не имеет смысла ждать.
function clearLocalSession() {
  accessToken = null;
  localStorage.removeItem(USER_KEY);
}

// logout — отзывает refresh-токен на бэкенде (DELETE записи в БД + очистка
// cookie) и затем чистит локальное состояние. Обёрнуто в try/catch: даже
// если сеть недоступна, пользователь всё равно выходит из аккаунта локально.
export async function logout() {
  try {
    await fetch(`${API.users}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Сеть недоступна — не блокируем локальный выход.
  } finally {
    clearLocalSession();
  }
}

// Экспортируем под старым именем тоже, чтобы не переписывать все места,
// где раньше был "просто локальный" clearSession (истёкшая сессия и т.п.,
// где отдельный вызов /auth/logout не нужен — refresh-токен и так протух).
export const clearSession = clearLocalSession;

// Чтобы параллельные запросы, упавшие с 401 одновременно, не дёргали /auth/refresh
// каждый по отдельности — держим один общий promise на все.
let refreshPromise = null;

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API.users}/auth/refresh`, {
      method: "POST",
      credentials: "include", // прикладывает httpOnly cookie с refresh-токеном
    })
      .then(async (res) => {
        if (!res.ok) throw new ApiError("Сессия истекла, войдите заново", { status: res.status });
        const data = await res.json();
        setTokens(data);
        return data;
      })
      .catch((e) => {
        if (e instanceof ApiError) throw e;
        // Сеть недоступна или ответ не в формате JSON — не показываем техническую суть.
        throw new ApiError("Сервис временно недоступен. Попробуйте, пожалуйста, позже.", {
          code: "NETWORK_ERROR",
        });
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/**
 * request(serviceBaseUrl, path, options)
 * options: { method, body, params, auth (default true), retry (внутренний флаг) }
 */
export async function request(baseUrl, path, options = {}) {
  const { method = "GET", body, params, auth = true, retry = true } = options;

  let url = `${baseUrl}${path}`;
  if (params && Object.keys(params).length) {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    if (query) url += `?${query}`;
  }

  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      // credentials: "include" нужен здесь только для запросов к user-service
      // (чтобы браузер прислал httpOnly refresh-cookie при 401 → retry ниже
      // фактически идёт через refreshAccessToken(), а не через этот fetch,
      // но включаем везде для единообразия — на другие origin'ы эта cookie
      // всё равно не отправится, т.к. она выставлена доменом user-service).
      credentials: "include",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    // Не показываем пользователю внутренний адрес сервиса — только понятный текст.
    throw new ApiError("Сервис временно недоступен. Попробуйте, пожалуйста, позже.", {
      code: "NETWORK_ERROR",
    });
  }

  // Access-токен истёк (или его вообще нет в памяти — например, после
  // перезагрузки страницы) — пробуем обновить через refresh-cookie один раз
  // и повторить запрос.
  if (res.status === 401 && auth && retry) {
    try {
      await refreshAccessToken();
      return request(baseUrl, path, { ...options, retry: false });
    } catch (e) {
      clearLocalSession();
      throw e;
    }
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Бэкенд/прокси вернул не-JSON (например, страницу ошибки 502/504 отnginx) —
      // сырой HTML/текст пользователю не показываем.
      data = null;
    }
  }

  if (!res.ok) {
    // Серверные и сетевые сбои (в т.ч. проблемы с прокси/шлюзом) — только общий текст.
    if (res.status >= 500 || !data?.error?.message) {
      throw new ApiError("Сервис временно недоступен. Попробуйте, пожалуйста, позже.", {
        code: data?.error?.code,
        status: res.status,
      });
    }
    const messages = {
      CHILD_LIMIT_REACHED: "У этого родителя уже максимальное количество детей — 10.",
      TOO_MANY_REQUESTS: "Слишком много запросов. Попробуйте снова через минуту.",
      RATE_LIMITED: "Слишком много запросов. Попробуйте снова через минуту.",
    };
    const message = messages[data.error.code] ?? data.error.message;
    throw new ApiError(message, { code: data.error.code, status: res.status });
  }

  return data;
}

export const usersApi = (path, options) => request(API.users, path, options);
export const academicApi = (path, options) => request(API.academic, path, options);
export const contractsApi = (path, options) => request(API.contracts, path, options);
export const crmApi = (path, options) => request(API.crm, path, options);
export const notificationsApi = (path, options) => request(API.notifications, path, options);
