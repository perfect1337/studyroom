import { useState, useRef, useEffect } from "react";
import NotificationBell from "./NotificationBell.jsx";
import Avatar from "../ui/Avatar.jsx";

/**
 * Верхняя панель. На мобильных слева появляется гамбургер (открывает Sidebar-drawer).
 */
export default function TopBar({
  userLabel,
  avatarUrl,
  onMenuClick = () => {},
}) {
  const [showHelp, setShowHelp] = useState(false);
  const helpButtonRef = useRef(null);
  const helpMenuRef = useRef(null);

  // Закрытие при клике вне меню
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        showHelp &&
        helpMenuRef.current &&
        !helpMenuRef.current.contains(event.target) &&
        helpButtonRef.current &&
        !helpButtonRef.current.contains(event.target)
      ) {
        setShowHelp(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showHelp]);

  return (
    <>
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
            <div className="relative">
              <button 
                ref={helpButtonRef}
                onClick={() => setShowHelp(!showHelp)}
                className="hidden sm:flex w-9 h-9 md:w-10 md:h-10 items-center justify-center rounded-full hover:bg-surface-container text-on-surface-variant"
              >
                <span className="material-symbols-outlined">help</span>
              </button>

              {/* Выпадающее меню помощи */}
              {showHelp && (
                <div 
                  ref={helpMenuRef}
                  className="absolute right-0 top-full mt-2 w-80 bg-surface-container-lowest rounded-2xl shadow-xl border border-outline-variant p-6 z-50"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary-container rounded-full flex items-center justify-center">
                        <span className="material-symbols-outlined text-primary">headset_mic</span>
                      </div>
                      <h3 className="font-headline-sm text-headline-sm text-on-surface">Помощь</h3>
                    </div>
                    <button 
                      onClick={() => setShowHelp(false)}
                      className="p-1 hover:bg-surface-container-highest rounded-full text-on-surface-variant"
                    >
                      <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                  </div>

                  <p className="text-label-md text-on-surface-variant mb-4">
                    Остались вопросы? Свяжитесь с нами:
                  </p>

                  <div className="space-y-3">
                    <a 
                      href="mailto:studyroom@mail.ru"
                      className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low hover:bg-surface-container transition-colors group"
                    >
                      <div className="w-9 h-9 bg-error-container rounded-lg flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-error text-[20px]">mail</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] text-on-surface-variant">Email</p>
                        <p className="text-label-md font-bold text-primary group-hover:underline truncate">
                          studyroom@mail.ru
                        </p>
                      </div>
                    </a>

                    <a 
                      href="tel:+79371402712"
                      className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low hover:bg-surface-container transition-colors group"
                    >
                      <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-blue-600 text-[20px]">call</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] text-on-surface-variant">Телефон</p>
                        <p className="text-label-md font-bold text-primary group-hover:underline">
                          +7 (937) 140 27 12
                        </p>
                        <p className="text-[11px] text-on-surface-variant mt-0.5">
                          Можно звонить в рабочее время пн - пт
                        </p>
                      </div>
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
          {(userLabel || avatarUrl) && (
            <>
              <div className="hidden sm:block h-8 w-px bg-outline-variant" />
              <div className="flex items-center gap-3">
                {userLabel && (
                  <span className="font-label-md text-label-md hidden lg:block truncate max-w-[180px]">{userLabel}</span>
                )}
                {/* Avatar сам рисует инициалы, если avatarUrl нет — раньше здесь
                    просто ничего не появлялось (см. историю файла), из-за чего
                    у большинства тестовых аккаунтов (без avatar_url) в шапке
                    справа не было вообще никакого визуального "я" пользователя. */}
                <Avatar src={avatarUrl} name={userLabel} size="xs" />
              </div>
            </>
          )}
        </div>
      </header>
    </>
  );
}