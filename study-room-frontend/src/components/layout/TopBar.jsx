import NotificationBell from "./NotificationBell.jsx";

/**
 * Верхняя панель. На мобильных слева появляется гамбургер (открывает Sidebar-drawer).
 */
export default function TopBar({
  userLabel,
  avatarUrl,
  onMenuClick = () => {},
}) {
  return (
    <header className="w-full h-16 sticky top-0 z-30 bg-surface shadow-[0px_10px_30px_rgba(0,0,0,0.05)] flex justify-between items-center px-4 md:px-gutter gap-2">
      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        <button
          onClick={onMenuClick}
          className="md:hidden text-on-surface-variant hover:text-primary p-2 -ml-2 shrink-0"
          aria-label="Открыть меню"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
      </div>
      <div className="flex items-center gap-2 md:gap-6 shrink-0">
        <div className="flex items-center gap-1 md:gap-2">
          <NotificationBell />
          <button className="hidden sm:flex w-9 h-9 md:w-10 md:h-10 items-center justify-center rounded-full hover:bg-surface-container text-on-surface-variant">
            <span className="material-symbols-outlined">help</span>
          </button>
        </div>
        {(userLabel || avatarUrl) && (
          <>
            <div className="hidden sm:block h-8 w-px bg-outline-variant" />
            <div className="flex items-center gap-3">
              {userLabel && <span className="font-label-md text-label-md hidden lg:block">{userLabel}</span>}
              {avatarUrl && (
                <img src={avatarUrl} alt={userLabel || "avatar"} className="w-8 h-8 rounded-full object-cover" />
              )}
            </div>
          </>
        )}
      </div>
    </header>
  );
}
