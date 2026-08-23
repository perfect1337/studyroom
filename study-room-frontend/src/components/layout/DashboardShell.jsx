import { useEffect, useState } from "react";
import Sidebar from "./Sidebar.jsx";
import TopBar from "./TopBar.jsx";
import MobileBottomNav from "./MobileBottomNav.jsx";
import { ROLE_SECTION_PREFIX, preloadRoleRoutes } from "../../routes/routeComponents.js";

export default function DashboardShell({ role, user, userLabel, avatarUrl, children }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Прогреваем JS-чанки остальных страниц этого раздела в свободное время браузера
  // (requestIdleCallback), уже после того как текущий экран отрисован. Дальнейшие
  // переходы по сайдбару в пределах роли происходят мгновенно, без Suspense-заставки
  // и без мерцания — независимо от того, навёл ли пользователь курсор на ссылку.
  useEffect(() => {
    const prefix = ROLE_SECTION_PREFIX[role];
    if (!prefix) return;
    const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 300));
    const cancelIdle = window.cancelIdleCallback ?? clearTimeout;
    const id = idle(() => preloadRoleRoutes(prefix));
    return () => cancelIdle(id);
  }, [role]);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar role={role} user={user} mobileOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      <div className="md:ml-64 min-h-screen flex flex-col">
        <TopBar
          userLabel={userLabel}
          avatarUrl={avatarUrl}
          onMenuClick={() => setMobileMenuOpen(true)}
        />
        <main className="flex-1 p-4 md:p-gutter max-w-container-max w-full pb-20 md:pb-gutter ml-[max(0px,calc((100%_-_1200px)/2_-_100px))] mr-auto page-fade-in">
          {children}
        </main>
      </div>

      <MobileBottomNav role={role} />
    </div>
  );
}
