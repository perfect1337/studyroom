import { useState } from "react";
import Sidebar from "./Sidebar.jsx";
import TopBar from "./TopBar.jsx";
import MobileBottomNav from "./MobileBottomNav.jsx";

export default function DashboardShell({ role, user, userLabel, avatarUrl, children }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar role={role} user={user} mobileOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      <div className="md:ml-64 min-h-screen flex flex-col">
        <TopBar
          userLabel={userLabel}
          avatarUrl={avatarUrl}
          onMenuClick={() => setMobileMenuOpen(true)}
        />
        <main className="flex-1 p-4 md:p-gutter max-w-container-max w-full pb-20 md:pb-gutter ml-[max(0px,calc((100%_-_1200px)/2_-_100px))] mr-auto">
          {children}
        </main>
      </div>

      <MobileBottomNav role={role} />
    </div>
  );
}
