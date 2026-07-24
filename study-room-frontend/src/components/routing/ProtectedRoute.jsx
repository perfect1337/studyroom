import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { ROLE_HOME_ROUTE } from "../../context/AuthContext.jsx";

/**
 * Оборачивает страницу раздела: пускает дальше, только если пользователь
 * аутентифицирован и (если передан список `roles`) его роль в него входит.
 * Иначе — редирект на /login (не авторизован) или на «домашний» маршрут его роли
 * (авторизован, но роль не подходит для этой страницы).
 */
export default function ProtectedRoute({ roles, children }) {
  const { user, loading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-on-surface-variant font-body-md">
        Загрузка…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (roles && roles.length && !roles.includes(user.role)) {
    return <Navigate to={ROLE_HOME_ROUTE[user.role] ?? "/login"} replace />;
  }

  return children;
}
