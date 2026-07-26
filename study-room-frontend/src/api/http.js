import { API, ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY } from "./config.js";

// Общий формат ошибок бэкенда: { error: { code, message } } (см. api-contracts.md).
export class ApiError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens({ access_token, refresh_token }) {
  if (access_token) localStorage.setItem(ACCESS_TOKEN_KEY, access_token);
  if (refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, refresh_token);
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

export function clearSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// Чтобы параллельные запросы, упавшие с 401 одновременно, не дёргали /auth/refresh
// каждый по отдельности — держим один общий promise на все.
let refreshPromise = null;

async function refreshAccessToken() {
  const refresh_token = getRefreshToken();
  if (!refresh_token) throw new ApiError("Сессия истекла, войдите заново", { status: 401 });

  if (!refreshPromise) {
    refreshPromise = fetch(`${API.users}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token }),
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
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    // Не показываем пользователю внутренний адрес сервиса — только понятный текст.
    throw new ApiError("Сервис временно недоступен. Попробуйте, пожалуйста, позже.", {
      code: "NETWORK_ERROR",
    });
  }

  // Access-токен истёк — пробуем обновить один раз и повторить запрос.
  if (res.status === 401 && auth && retry) {
    try {
      await refreshAccessToken();
      return request(baseUrl, path, { ...options, retry: false });
    } catch (e) {
      clearSession();
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
    throw new ApiError(data.error.message, { code: data.error.code, status: res.status });
  }

  return data;
}

export const usersApi = (path, options) => request(API.users, path, options);
export const academicApi = (path, options) => request(API.academic, path, options);
export const contractsApi = (path, options) => request(API.contracts, path, options);
export const crmApi = (path, options) => request(API.crm, path, options);
export const notificationsApi = (path, options) => request(API.notifications, path, options);
