import { NavLink, useNavigate } from "react-router-dom";

// Пункты меню для каждой роли. `end: true` — пункт активен только на точном совпадении пути
// (иначе, например, "/admin" подсвечивался бы активным на "/admin/finance").
// Первые 4 пункта каждой роли также используются в мобильной нижней навигации (MobileBottomNav).
export const NAV_ITEMS = {
  student: [
    { to: "/student", icon: "dashboard", label: "Обзор", end: true },
    { to: "/student/schedule", icon: "calendar_today", label: "Расписание" },
    { to: "/student/courses", icon: "school", label: "Курсы" },
    { to: "/student/homework", icon: "assignment", label: "Задания" },
    { to: "/student/profile", icon: "person", label: "Профиль" },
    { to: "/student/settings", icon: "settings", label: "Настройки" },
  ],
  tutor: [
    { to: "/tutor", icon: "dashboard", label: "Обзор", end: true },
    { to: "/tutor/students", icon: "group", label: "Ученики" },
    { to: "/tutor/schedule", icon: "calendar_today", label: "Расписание" },
    { to: "/tutor/homework", icon: "assignment", label: "Задания" },
    { to: "/tutor/settings", icon: "settings", label: "Настройки" },
  ],
  parent: [
    { to: "/parent", icon: "dashboard", label: "Обзор", end: true },
    { to: "/parent/children", icon: "family_restroom", label: "Дети" },
    { to: "/parent/schedule", icon: "calendar_month", label: "Расписание" },
    { to: "/parent/contracts", icon: "description", label: "Договоры" },
    { to: "/parent/settings", icon: "settings", label: "Настройки" },
  ],
  admin: [
    { to: "/admin", icon: "dashboard", label: "Обзор", end: true },
    { to: "/admin/students", icon: "group", label: "Ученики" },
    { to: "/admin/teachers", icon: "school", label: "Учителя" },
    { to: "/admin/schedule", icon: "calendar_month", label: "Расписание" },
    { to: "/admin/finance", icon: "payments", label: "Финансы" },
    { to: "/admin/branches", icon: "store", label: "Филиалы" },
    { to: "/admin/courses", icon: "menu_book", label: "Курсы" },
    { to: "/admin/settings", icon: "settings", label: "Настройки" },
  ],
  branch_owner: [
    { to: "/branch", icon: "dashboard", label: "Обзор", end: true },
    { to: "/branch/students", icon: "group", label: "Студенты" },
    { to: "/branch/teachers", icon: "school", label: "Учителя" },
    { to: "/branch/schedule", icon: "calendar_month", label: "Расписание" },
    { to: "/branch/settings", icon: "settings", label: "Настройки" },
  ],
};

const linkClasses = ({ isActive }) =>
  [
    "flex items-center gap-3 px-4 py-3 rounded-lg font-label-md text-label-md transition-all duration-200",
    isActive
      ? "bg-primary-container text-on-primary-container font-bold"
      : "text-on-surface-variant hover:bg-surface-container-high hover:translate-x-1",
  ].join(" ");

function NavList({ role, onNavigate }) {
  const items = NAV_ITEMS[role] ?? [];
  return (
    <nav className="flex-1 flex flex-col gap-1 overflow-y-auto">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={linkClasses} onClick={onNavigate}>
          <span className="material-symbols-outlined">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function FooterLinks({ showSwitchAccount = true }) {
  const navigate = useNavigate();
  return (
    <div className="mt-auto pt-4 border-t border-outline-variant flex flex-col gap-1">
      {showSwitchAccount && (
        <button
          onClick={() => navigate("/login")}
          className="flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-all text-left font-label-md text-label-md"
        >
          <span className="material-symbols-outlined">swap_horiz</span>
          <span>Сменить аккаунт</span>
        </button>
      )}
      <button
        onClick={() => navigate("/login")}
        className="flex items-center gap-3 px-4 py-3 text-error hover:bg-error-container hover:text-on-error-container rounded-lg transition-all text-left font-label-md text-label-md"
      >
        <span className="material-symbols-outlined">logout</span>
        <span>Выйти</span>
      </button>
    </div>
  );
}

function SidebarHeader({ role, user }) {
  if (role === "student") {
    return (
      <div className="px-2 mb-4">
        <h1 className="font-headline-md text-headline-md font-bold text-primary">Study Room</h1>
        <p className="font-label-md text-label-md text-on-surface-variant">Ученик</p>
      </div>
    );
  }
  if (role === "tutor") {
    return (
      <div className="flex flex-col gap-4">
        <div className="font-headline-sm text-headline-sm text-primary font-bold px-2">Study Room</div>
        <div className="flex items-center gap-3 bg-surface-container rounded-lg p-3">
          <img src={user?.avatarUrl} alt={user?.name} className="w-12 h-12 rounded-full object-cover" />
          <div>
            <div className="font-label-md text-label-md font-bold text-on-surface">{user?.name}</div>
          </div>
        </div>
        <NavLink
          to="/tutor/schedule/new"
          className="w-full bg-primary text-on-primary font-label-md text-label-md py-2 rounded-lg shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          Новое занятие
        </NavLink>
      </div>
    );
  }
  if (role === "parent") {
    return (
      <div className="px-2 mb-2">
        <h1 className="font-headline-sm text-headline-sm font-bold text-primary">Study Room Родитель</h1>
      </div>
    );
  }
  if (role === "branch_owner") {
    return (
      <div className="flex items-center gap-stack-sm mb-stack-lg px-2">
        <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center text-on-primary">
          <span className="material-symbols-outlined">school</span>
        </div>
        <div>
          <h1 className="font-headline-sm text-on-surface leading-tight">Филиал</h1>
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">Панель управления</p>
        </div>
      </div>
    );
  }
  if (role === "admin") {
    return (
      <div className="flex items-center gap-3 px-2 py-2 mb-2">
        <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center text-on-primary">
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
            school
          </span>
        </div>
        <div>
          <h1 className="font-headline-sm text-headline-sm font-bold text-primary leading-none">Study Room</h1>
          <p className="text-[10px] uppercase tracking-wider text-outline">Admin Panel</p>
        </div>
      </div>
    );
  }
  return null;
}

/**
 * Боковое меню. На md+ экранах — статичная колонка слева.
 * На мобильных — выезжающий drawer поверх контента с затемнением фона,
 * открывается через гамбургер-кнопку в TopBar (см. DashboardShell).
 */
export default function Sidebar({ role, user, mobileOpen = false, onClose = () => {} }) {
  return (
    <>
      {/* Затемнение фона на мобильных, когда меню открыто */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`flex flex-col h-screen w-64 fixed left-0 top-0 bg-surface-container-low border-r border-outline-variant p-4 gap-stack-lg z-50
          transition-transform duration-300 ease-in-out
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
      >
        <button
          onClick={onClose}
          className="md:hidden self-end text-on-surface-variant hover:text-primary p-1 -mt-1 -mr-1"
          aria-label="Закрыть меню"
        >
          <span className="material-symbols-outlined">close</span>
        </button>

        <SidebarHeader role={role} user={user} />
        <NavList role={role} onNavigate={onClose} />

        {(role === "admin" || role === "branch_owner") && user && (
          <div className="flex items-center gap-3 px-2 py-2 border-t border-outline-variant pt-4">
            <img src={user.avatarUrl} alt={user.name} className="w-10 h-10 rounded-full border-2 border-primary object-cover" />
            <div className="flex flex-col">
              <span className="font-label-md text-label-md font-bold">{user.name}</span>
            </div>
          </div>
        )}

        <FooterLinks showSwitchAccount={role !== "student"} />
      </aside>
    </>
  );
}
