import { useState } from "react";
import Sidebar from "./Sidebar.jsx";
import TopBar from "./TopBar.jsx";
import MobileBottomNav from "./MobileBottomNav.jsx";

export default function DashboardShell({ role, user, searchPlaceholder, userLabel, avatarUrl, children }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar role={role} user={user} mobileOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      <div className="md:ml-64 min-h-screen flex flex-col">
        <TopBar
          searchPlaceholder={searchPlaceholder}
          userLabel={userLabel}
          avatarUrl={avatarUrl}
          onMenuClick={() => setMobileMenuOpen(true)}
        />
        <main className="flex-1 p-4 md:p-gutter max-w-container-max mx-auto w-full pb-20 md:pb-gutter">
          {children}
        </main>
      </div>

      <MobileBottomNav role={role} />
    </div>
  );
}
