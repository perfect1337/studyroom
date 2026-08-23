// Фолбэк для <Suspense> вокруг ленивых (React.lazy) страниц в App.jsx.
// Чанки прогреваются заранее (см. routes/routeComponents.js: preloadRoute /
// preloadRoleRoutes, вызывается из Sidebar/MobileBottomNav по hover/tap и
// в фоне после логина), поэтому в норме этот компонент почти никогда не
// успевает отрисоваться. На случай редких промахов (прямой переход по ссылке,
// "вперёд/назад" в браузере) — появление с задержкой и плавным fade-in,
// а не мгновенная резкая вспышка текста на пустом фоне.
export default function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-on-surface-variant font-body-md route-fallback-fade">
      <div className="flex items-center gap-3">
        <span className="route-fallback-spinner" aria-hidden="true" />
        Загрузка…
      </div>
    </div>
  );
}
