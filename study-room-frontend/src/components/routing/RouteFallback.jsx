// Фолбэк для <Suspense> вокруг ленивых (React.lazy) страниц в App.jsx.
// Показывается очень коротко (один сетевой чанк ~10-30кб), поэтому решение
// намеренно простое — тот же стиль, что и у ProtectedRoute при проверке сессии.
export default function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-on-surface-variant font-body-md">
      Загрузка…
    </div>
  );
}
