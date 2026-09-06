import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as authApi from "../api/auth.js";
import { clearSession, getStoredUser, setStoredUser, setTokens } from "../api/http.js";
import { clearQueryCache, invalidateAllQueries } from "../api/queryCache.js";

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

  const logout = useCallback(async () => {
    // authApi.logout() сам ловит сетевые ошибки и в любом случае чистит
    // локальное состояние (память + кэш профиля) — здесь просто ждём его,
    // чтобы не выйти "визуально" раньше, чем отзовётся токен на сервере.
    await authApi.logout();
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

  // Включает/выключает "версию учителя" для branch_owner (настройки ->
  // тумблер "Зарегистрироваться как учитель", см. SettingsPage.jsx).
  // PATCH /users/me/tutor-mode меняет is_tutor на бэкенде и тут же
  // перевыпускает access_token — сохраняем его через setTokens(), иначе
  // право пользоваться /tutor/* появится только после следующего
  // /auth/refresh (а до этого ProtectedRoute будет пускать по старому,
  // ещё не обновлённому токену).
  const setTutorMode = useCallback(async (enabled) => {
    const data = await authApi.setTutorMode(enabled);
    setTokens(data);
    setStoredUser(data.user);
    setUser(data.user);
    // Раньше здесь кэш не трогали: GET /users (fetchMyPeople) кэшируется на
    // 20с по ключу ["myPeople", {...}] и именно из него берут список
    // преподавателей и TeachersDirectory.jsx (раздел "Учителя" — включённый
    // is_tutor должен добавить/убрать самого branch_owner из списка), и
    // ScheduleDirectory.jsx (тьютор в фильтре и в выпадающих списках формы
    // создания занятия). Ни та, ни другая страница не подписаны на
    // invalidateQuery для "myPeople" (только грузят его при монтировании), а
    // сам тумблер лежит в /settings — отдельном маршруте, так что после
    // переключения и перехода на "Учителя"/"Расписание" эти страницы
    // монтируются заново и просто забирают ещё не протухший кэш, то есть
    // показывают состояние ДО переключения, пока не истечёт staleTime или
    // пользователь не нажмёт F5 (что сбрасывает кэш целиком вместе со всем
    // приложением). invalidateAllQueries() решает это так же, как и кнопка
    // переключения версии в Sidebar.jsx: помечает весь кэш устаревшим, не
    // трогая уже показанные данные — следующий заход на любую страницу (и
    // любой уже смонтированный виджет, подписанный на инвалидацию) тихо
    // подтянет актуальный список сам, без видимой перезагрузки.
    invalidateAllQueries();
    return data.user;
  }, []);

  const value = useMemo(
    () => ({ user, loading, isAuthenticated: !!user, login, registerParent, logout, updateUser, setTutorMode }),
    [user, loading, login, registerParent, logout, updateUser, setTutorMode]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth должен использоваться внутри <AuthProvider>");
  return ctx;
}
