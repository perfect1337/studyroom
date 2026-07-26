import NotificationBell from "./NotificationBell.jsx";

/**
 * Верхняя панель. На мобильных слева появляется гамбургер (открывает Sidebar-drawer),
 * поле поиска сжимается до иконки на очень узких экранах, чтобы не ломать раскладку.
 */
export default function TopBar({
  searchPlaceholder = "Поиск...",
  userLabel,
  avatarUrl,
  onMenuClick = () => {},
}) {
  return (
    <header className="w-full h-16 sticky top-0 z-30 bg-surface shadow-[0px_10px_30px_rgba(0,0,0,0.05)] flex justify-between items-center px-4 md:px-gutter gap-2">
      <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
        <button
          onClick={onMenuClick}
          className="md:hidden text-on-surface-variant hover:text-primary p-2 -ml-2 shrink-0"
          aria-label="Открыть меню"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>

        <div className="relative w-full max-w-md min-w-0">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[20px]">
            search
          </span>
          <input
            type="text"
            placeholder={searchPlaceholder}
            className="w-full pl-10 pr-4 py-2 rounded-full border-none bg-surface-container-low focus:outline-none focus:ring-2 focus:ring-primary/20 font-body-md text-body-md text-sm md:text-base"
          />
        </div>
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
