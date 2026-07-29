import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as authApi from "../api/auth.js";
import { clearSession, getStoredUser, setStoredUser, setTokens } from "../api/http.js";
import { clearQueryCache } from "../api/queryCache.js";

const AuthContext = createContext(null);

// Роль из JWT/ответа бэкенда -> базовый маршрут раздела в этом фронте.
// `owner` (владелец сети филиалов) использует раздел /admin,
// `branch_owner` (управляющий одним филиалом) — отдельный раздел /branch.
export const ROLE_HOME_ROUTE = {
  student: "/student",
  tutor: "/tutor",
  parent: "/parent",
  owner: "/admin",
  branch_owner: "/branch",
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [loading, setLoading] = useState(true);

  // При первой загрузке приложения проверяем, жива ли сессия (если есть сохранённый пользователь).
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!getStoredUser()) {
        setLoading(false);
        return;
      }
      try {
        const me = await authApi.fetchMe();
        if (!cancelled) {
          setUser(me);
          setStoredUser(me);
        }
      } catch {
        if (!cancelled) {
          clearSession();
          clearQueryCache();
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (loginValue, password) => {
    clearQueryCache();
    const data = await authApi.login({ login: loginValue, password });
    setTokens(data);
    // POST /auth/login возвращает урезанный объект user (только id/role/first_name/
    // last_name) — без avatar_url, patronymic, email и т.д. Если сохранить его как
    // есть, при повторном входе аватар (и другие поля) "пропадают" из интерфейса,
    // хотя в БД они на самом деле сохранены. Поэтому сразу подтягиваем полный
    // профиль через GET /users/me — так же, как уже делает registerParent ниже.
    let me = data.user;
    try {
      me = await authApi.fetchMe();
    } catch {
      // Если /users/me недоступен (например, временный сбой сети) — не блокируем
      // вход, просто останемся с урезанным объектом из ответа логина.
    }
    setStoredUser(me);
    setUser(me);
    return me;
  }, []);

  const registerParent = useCallback(async (payload) => {
    const data = await authApi.registerParent(payload);
    setTokens(data);
    // /auth/register не возвращает объект user (только user_id) — подтягиваем профиль отдельно.
    const me = await authApi.fetchMe();
    setStoredUser(me);
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    clearQueryCache();
    setUser(null);
  }, []);

  // Локально мержит патч в текущего пользователя (после успешного PATCH /users/me) —
  // чтобы sidebar/topbar сразу отобразили новое имя/аватар без лишнего запроса.
  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      const next = prev ? { ...prev, ...patch } : prev;
      if (next) setStoredUser(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ user, loading, isAuthenticated: !!user, login, registerParent, logout, updateUser }),
    [user, loading, login, registerParent, logout, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth должен использоваться внутри <AuthProvider>");
  return ctx;
}
