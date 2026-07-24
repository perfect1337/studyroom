export default function ProgressBar({ value, colorClass = "bg-primary" }) {
  return (
    <div className="w-full bg-surface-container-high h-2 rounded-full">
      <div className={`${colorClass} h-2 rounded-full transition-all`} style={{ width: `${value}%` }} />
    </div>
  );
}
