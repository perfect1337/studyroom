// Единая аватарка с fallback-инициалами.
//
// Раньше у каждой страницы/компонента, где показывалось ФИО, был свой
// копипаст: либо голый <img src={avatarUrl} /> без обработки отсутствующего
// avatar_url (Sidebar.TutorProfileCard, футер сайдбара admin/branch_owner,
// TopBar — там при пустом avatar_url аватар просто не рендерился вообще),
// либо своя мини-функция initials() (StudentOverview, StudentProfile,
// ParentOverview) — у каждой чуть свой набор классов и размеров.
// Avatar собирает это в одном месте: если src есть — показываем картинку,
// если нет — цветной кружок с инициалами (как и раньше делали лучшие из
// существующих страниц), везде одинаково.
const SIZE_CLASSES = {
  xs: "w-8 h-8 text-[11px]",
  sm: "w-10 h-10 text-sm",
  md: "w-12 h-12 text-base",
  lg: "w-16 h-16 text-lg",
  xl: "w-24 h-24 text-2xl",
};

export function getInitials(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const second = parts.length > 1 ? parts[1][0] ?? "" : "";
  return (first + second).toUpperCase() || "?";
}

/**
 * @param {string} [src] - URL картинки (avatar_url). Если пусто — инициалы.
 * @param {string} [name] - ФИО/имя, из которого берутся инициалы и alt-текст.
 * @param {"xs"|"sm"|"md"|"lg"|"xl"} [size]
 * @param {boolean} [ring] - белая рамка + тень (для аватаров на цветных/фото-подложках)
 */
export default function Avatar({ src, name, size = "md", ring = false, className = "" }) {
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;
  return (
    <div
      className={[
        "relative shrink-0 rounded-full overflow-hidden flex items-center justify-center",
        "bg-primary-fixed text-primary font-bold select-none",
        sizeClass,
        ring ? "border-4 border-surface shadow-sm" : "",
        className,
      ].join(" ")}
      title={name || undefined}
    >
      {src ? (
        <img src={src} alt={name || "avatar"} className="w-full h-full object-cover" />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </div>
  );
}
