export default function PlaceholderPage({ title }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 gap-4">
      <span className="material-symbols-outlined text-5xl text-outline-variant">construction</span>
      <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>
      <p className="font-body-md text-body-md text-on-surface-variant max-w-md">
        Раздел ещё не спроектирован в макетах Stitch — добавьте сюда экран, когда он появится.
      </p>
    </div>
  );
}
