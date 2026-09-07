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

  // Владелец филиала (branch_owner), включивший себе "версию учителя"
  // (см. настройки -> тумблер "Зарегистрироваться как учитель", user.is_tutor),
  // пускается на все маршруты роли tutor — так реализовано переключение на
  // "визуальную картину и функционал учителя" без создания отдельного логина
  // или дублирования страниц /tutor/*. Роль в токене/user.role при этом
  // остаётся branch_owner — это временный доступ, а не смена роли.
  const allowedByTutorMode =
    roles?.includes("tutor") && user.role === "branch_owner" && !!user.is_tutor;

  if (roles && roles.length && !roles.includes(user.role) && !allowedByTutorMode) {
    return <Navigate to={ROLE_HOME_ROUTE[user.role] ?? "/login"} replace />;
  }

  return children;
}
