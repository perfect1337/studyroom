import { useEffect, useState } from "react";
import Sidebar from "./Sidebar.jsx";
import TopBar from "./TopBar.jsx";
import MobileBottomNav from "./MobileBottomNav.jsx";
import { ROLE_SECTION_PREFIX, preloadRoleRoutes } from "../../routes/routeComponents.js";

export default function DashboardShell({ role, user, userLabel, avatarUrl, children, fullWidth = false }) {
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
        <main
          className={`flex-1 p-4 md:p-gutter w-full pb-20 md:pb-gutter page-fade-in ${
            fullWidth
              ? // Полная ширина экрана — используется на странице "Финансы", чтобы таблица
                // договоров помещалась без внутреннего горизонтального скролла на ПК
                // (см. FinanceDirectory.jsx). Остальные страницы по умолчанию держат
                // читаемую ширину контента (max-w-container-max), чтобы не растягивать
                // короткие формы/списки на весь широкий монитор.
                "max-w-none"
              : "max-w-container-max ml-[max(0px,calc((100%_-_1200px)/2_-_100px))] mr-auto"
          }`}
        >
          {children}
        </main>
      </div>

      <MobileBottomNav role={role} />
    </div>
  );
}
