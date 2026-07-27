const COLOR_MAP = {
  green: "bg-green-100 text-green-700",
  amber: "bg-amber-100 text-amber-700",
  orange: "bg-orange-100 text-orange-700",
  red: "bg-red-100 text-red-700",
  yellow: "bg-yellow-100 text-yellow-700",
  error: "bg-error-container text-on-error-container",
  secondary: "bg-secondary-container/30 text-on-secondary-container",
};

// Сопоставление текста статуса -> цвета, чтобы не дублировать эту логику на каждой странице.
const STATUS_COLOR = {
  Активен: "green",
  Оплачено: "green",
  Выполнено: "green",
  "В отпуске": "amber",
  Ожидание: "yellow",
  "В процессе": "orange",
  Просрочен: "red",
  Просрочено: "red",
  "На больничном": "error",
  Истёк: "red",
};

export default function StatusBadge({ status, color }) {
  const resolvedColor = color || STATUS_COLOR[status] || "secondary";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-bold uppercase shrink-0 ${COLOR_MAP[resolvedColor]}`}
    >
      {status}
    </span>
  );
}
