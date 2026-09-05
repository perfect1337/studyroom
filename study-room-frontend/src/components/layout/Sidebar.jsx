import { NavLink, useNavigate } from "react-router-dom";
import { academicApi } from "../../api/http.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { preloadRoute } from "../../routes/routeComponents.js";
import { useQuery } from "../../hooks/useQuery.js";
import Avatar from "../ui/Avatar.jsx";

// Пункты меню для каждой роли. `end: true` — пункт активен только на точном совпадении пути
// (иначе, например, "/admin" подсвечивался бы активным на "/admin/finance").
// Первые 4 пункта каждой роли также используются в мобильной нижней навигации (MobileBottomNav).
export const NAV_ITEMS = {
  student: [
    { to: "/student", icon: "dashboard", label: "Обзор", end: true },
    { to: "/student/schedule", icon: "calendar_today", label: "Расписание" },
    { to: "/student/courses", icon: "school", label: "Курсы" },
    { to: "/student/homework", icon: "assignment", label: "Задания" },
    { to: "/student/tests", icon: "quiz", label: "Тесты" },
    { to: "/student/grades", icon: "grade", label: "Оценки" },
    { to: "/student/profile", icon: "person", label: "Профиль" },
    { to: "/student/settings", icon: "settings", label: "Настройки", end: true },
  ],
  tutor: [
    { to: "/tutor", icon: "dashboard", label: "Обзор", end: true },
    { to: "/tutor/students", icon: "group", label: "Ученики" },
    { to: "/tutor/schedule", icon: "calendar_today", label: "Расписание" },
    { to: "/tutor/homework", icon: "assignment", label: "Задания" },
    { to: "/tutor/tests", icon: "quiz", label: "Тесты" },
    { to: "/tutor/settings", icon: "settings", label: "Настройки", end: true },
  ],
  parent: [
    { to: "/parent", icon: "dashboard", label: "Обзор", end: true },
    { to: "/parent/children", icon: "family_restroom", label: "Дети" },
    { to: "/parent/schedule", icon: "calendar_month", label: "Расписание" },
    { to: "/parent/contracts", icon: "description", label: "Договоры" },
    { to: "/parent/settings", icon: "settings", label: "Настройки", end: true },
  ],
  admin: [
    { to: "/admin", icon: "dashboard", label: "Обзор", end: true },
    { to: "/admin/students", icon: "group", label: "Ученики" },
    { to: "/admin/parents", icon: "family_restroom", label: "Родители" },
    { to: "/admin/teachers", icon: "school", label: "Учителя" },
    { to: "/admin/schedule", icon: "calendar_month", label: "Расписание" },
    { to: "/admin/finance", icon: "payments", label: "Финансы" },
    { to: "/admin/branches", icon: "store", label: "Филиалы" },
    { to: "/admin/courses", icon: "menu_book", label: "Курсы" },
    { to: "/admin/settings", icon: "settings", label: "Настройки", end: true },
  ],
  branch_owner: [
    { to: "/branch", icon: "dashboard", label: "Обзор", end: true },
    { to: "/branch/students", icon: "group", label: "Студенты" },
    { to: "/branch/teachers", icon: "school", label: "Учителя" },
    { to: "/branch/courses", icon: "menu_book", label: "Курсы" },
    { to: "/branch/schedule", icon: "calendar_month", label: "Расписание" },
    { to: "/branch/finance", icon: "payments", label: "Финансы" },
    { to: "/branch/settings", icon: "settings", label: "Настройки", end: true },
  ],
};

const linkClasses = ({ isActive }) =>
  [
    "flex items-center gap-3 px-4 py-3 rounded-lg font-label-md text-label-md transition-colors duration-200",
    isActive
      ? "bg-primary-container text-on-primary-container font-bold"
      : "text-on-surface-variant hover:bg-surface-container-high",
  ].join(" ");

function NavList({ role, onNavigate }) {
  const items = NAV_ITEMS[role] ?? [];
  return (
    <nav className="flex-1 flex flex-col gap-1 overflow-y-auto overflow-x-hidden">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={linkClasses}
          onClick={onNavigate}
          onMouseEnter={() => preloadRoute(item.to)}
          onFocus={() => preloadRoute(item.to)}
          onTouchStart={() => preloadRoute(item.to)}
        >
          <span className="material-symbols-outlined">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function FooterLinks({ showSwitchAccount = true }) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  // Раньше кнопка просто делала navigate("/login"), не вызывая реальный
  // logout — сессия (refresh-токен) оставалась действительной на сервере.
  // Теперь дожидаемся отзыва токена и только потом уходим на /login.
  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate("/login");
    }
  };

  return (
    <div className="mt-auto pt-4 border-t border-outline-variant flex flex-col gap-1">
      {showSwitchAccount && (
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-all text-left font-label-md text-label-md"
        >
          <span className="material-symbols-outlined">swap_horiz</span>
          <span>Сменить аккаунт</span>
        </button>
      )}
      <button
        onClick={handleLogout}
        className="flex items-center gap-3 px-4 py-3 text-error hover:bg-error-container hover:text-on-error-container rounded-lg transition-all text-left font-label-md text-label-md"
      >
        <span className="material-symbols-outlined">logout</span>
        <span>Выйти</span>
      </button>
    </div>
  );
}

// Курсы, которые реально ведёт репетитор (через course_tutors, см. 2.1
// api-contracts.md) — для мини-карточки профиля в сайдбаре, под аватаркой.
//
// Раньше здесь был голый fetch в useEffect с локальным useState: Sidebar —
// часть общего layout'а (DashboardShell) и НЕ размонтируется при переходах
// между страницами, поэтому если список курсов тьютора менялся где-то ещё
// (например, admin/branch_owner переназначил курс на другого репетитора),
// эта карточка не знала об этом вообще никогда за всю сессию — не помогала
// даже смена страницы, только полная перезагрузка (F5), которая заново
// монтирует Sidebar с нуля. useQuery подписан на кэш ["courses", ...] и
// тихо перезапрашивает данные, как только где-либо вызывается
// invalidateQuery(["courses"]) (см. api/academic.js — это происходит при
// любой мутации курса), без мигания и без явной перезагрузки.
function useTutorCourses(tutorId) {
  // ВАЖНО: fetchCourses() сама уже оборачивает запрос в cachedQuery() с тем
  // же ключом ["courses", {tutor_id}]. Если передать её сюда как fetcher,
  // useQuery() вызовет cachedQuery(key, () => fetchCourses(...)) — и внутри
  // fetchCourses() снова попадёт в cachedQuery(тот же key), которая увидит,
  // что entry.promise уже занят (тем самым промисом, что сейчас исполняется)
  // и просто вернёт его обратно — получается замкнутый цикл промисов, который
  // никогда не резолвится, а реальный fetch() к /academic/courses не
  // происходит вообще ни разу. Поэтому здесь дергаем academicApi напрямую —
  // единственный слой кэширования для этого ключа остаётся за useQuery.
  const { data } = useQuery(
    tutorId ? ["courses", { tutor_id: tutorId }] : null,
    () => academicApi("/courses", { params: { tutor_id: tutorId } }),
  );
  return data?.items ?? [];
}

function TutorProfileCard({ user }) {
  const courses = useTutorCourses(user?.id);

  return (
    <div className="flex items-center gap-3 bg-surface-container rounded-lg p-3 hover:bg-surface-container-high transition-colors">
      <Avatar src={user?.avatarUrl} name={user?.name} size="md" />
      <div className="min-w-0">
        <div className="font-label-md text-label-md font-bold text-on-surface truncate">{user?.name}</div>

        <div className="flex items-center gap-1 text-on-surface-variant mt-0.5">
          <span className="material-symbols-outlined text-[14px]">store</span>
          <span className="font-label-md text-[11px] truncate">{user?.branchName || "Филиал не назначен"}</span>
        </div>

        <div className="flex items-start gap-1 text-on-surface-variant mt-0.5">
          <span className="material-symbols-outlined text-[14px] mt-[1px]">menu_book</span>
          <span className="font-label-md text-[11px] leading-snug line-clamp-2">
            {courses.length > 0
              ? courses.map((c) => c.title ?? c.subject).join(", ")
              : "Нет назначенных курсов"}
          </span>
        </div>
      </div>
    </div>
  );
}

// Мини-карточка профиля ученика в сайдбаре — до этого у роли "student" здесь
// вообще не было ни ФИО, ни аватара (только статичная подпись "Ученик"),
// в отличие от tutor/admin/branch_owner. См. StudentOverview/StudentProfile —
// тот же визуальный язык (аватар с инициалами + имя), но в компактном виде.
function StudentProfileCard({ user }) {
  if (!user) return null;
  return (
    <div className="flex items-center gap-3 bg-surface-container rounded-lg p-3">
      <Avatar src={user.avatarUrl} name={user.name} size="md" />
      <div className="min-w-0">
        <div className="font-label-md text-label-md font-bold text-on-surface truncate">{user.name}</div>
        <div className="flex items-center gap-1 text-on-surface-variant mt-0.5">
          <span className="material-symbols-outlined text-[14px]">store</span>
          <span className="font-label-md text-[11px] truncate">{user.branchName || "Филиал не назначен"}</span>
        </div>
      </div>
    </div>
  );
}

// Мини-карточка профиля родителя в сайдбаре — аналогично, вместо
// прежней статичной надписи "Study Room Родитель" без единого упоминания,
// кто именно сейчас в аккаунте. childrenCount передаётся не всеми страницами
// (см. toSidebarUser(user, { childrenCount })) — если его нет, просто не
// показываем строку про детей, ничего не ломаем.
function ParentProfileCard({ user }) {
  if (!user) return null;
  return (
    <div className="flex items-center gap-3 bg-surface-container rounded-lg p-3">
      <Avatar src={user.avatarUrl} name={user.name} size="md" />
      <div className="min-w-0">
        <div className="font-label-md text-label-md font-bold text-on-surface truncate">{user.name}</div>
        <div className="flex items-center gap-1 text-on-surface-variant mt-0.5">
          <span className="material-symbols-outlined text-[14px]">family_restroom</span>
          <span className="font-label-md text-[11px] truncate">
            {typeof user.childrenCount === "number"
              ? `${user.childrenCount} ${declineChild(user.childrenCount)}`
              : "Родитель"}
          </span>
        </div>
      </div>
    </div>
  );
}

function declineChild(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "ребёнок";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "ребёнка";
  return "детей";
}

function SidebarHeader({ role, user }) {
  if (role === "student") {
    return (
      <div className="flex flex-col gap-4">
        <div className="px-2">
          <h1 className="font-headline-md text-headline-md font-bold text-primary">Study Room</h1>
          <p className="font-label-md text-label-md text-on-surface-variant">Ученик</p>
        </div>
        <StudentProfileCard user={user} />
      </div>
    );
  }
  if (role === "tutor") {
    return (
      <div className="flex flex-col gap-4">
        <div className="font-headline-sm text-headline-sm text-primary font-bold px-2">Study Room</div>
        <TutorProfileCard user={user} />
      </div>
    );
  }
  if (role === "parent") {
    return (
      <div className="flex flex-col gap-4">
        <div className="px-2">
          <h1 className="font-headline-sm text-headline-sm font-bold text-primary">Study Room</h1>
          <p className="font-label-md text-label-md text-on-surface-variant">Родитель</p>
        </div>
        <ParentProfileCard user={user} />
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
            <Avatar src={user.avatarUrl} name={user.name} size="sm" className="border-2 border-primary" />
            <div className="flex flex-col min-w-0">
              <span className="font-label-md text-label-md font-bold truncate">{user.name}</span>
            </div>
          </div>
        )}

        <FooterLinks showSwitchAccount={role !== "student"} />
      </aside>
    </>
  );
}
