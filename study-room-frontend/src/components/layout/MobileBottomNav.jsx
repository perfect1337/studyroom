import { NavLink } from "react-router-dom";
import { NAV_ITEMS } from "./Sidebar.jsx";
import { preloadRoute } from "../../routes/routeComponents.js";

const linkClasses = ({ isActive }) =>
  `flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors ${
    isActive ? "text-primary" : "text-on-surface-variant"
  }`;

/**
 * Нижняя панель навигации для мобильных экранов (< md).
 * Показывает первые 4 пункта меню роли — этого достаточно для основных разделов,
 * остальное (настройки, выход, смена аккаунта) доступно через гамбургер-меню в TopBar.
 */
export default function MobileBottomNav({ role }) {
  const items = (NAV_ITEMS[role] ?? []).slice(0, 4);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface-container-lowest border-t border-outline-variant flex z-30 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={linkClasses}
          onTouchStart={() => preloadRoute(item.to)}
        >
          <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
          <span className="text-[10px] font-medium">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
