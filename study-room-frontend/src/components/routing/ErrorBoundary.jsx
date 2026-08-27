import { Component } from "react";

/**
 * Ловит необработанные ошибки рендера в любом компоненте ниже по дереву.
 * Без этого одна неожиданная ошибка (например, обращение к полю
 * несуществующего объекта в ответе API непривычной формы) роняла бы всё
 * React-приложение целиком в пустой белый экран — без единой подсказки,
 * что случилось, и без способа восстановиться, кроме ручной перезагрузки
 * вслепую.
 *
 * React error boundaries обязаны быть классовыми компонентами — на момент
 * написания это единственный официально поддерживаемый способ
 * (getDerivedStateFromError/componentDidCatch не имеют хук-аналога).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // В проде здесь не помешал бы репортинг в Sentry/аналог — пока хотя бы
    // не даём ошибке пройти молча.
    console.error("Uncaught render error:", error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // Если пользователь перешёл на другой маршрут (см. resetKey из App.jsx,
    // обычно — текущий location.pathname), сбрасываем состояние ошибки:
    // сломанная страница не должна навсегда парализовать всё приложение,
    // достаточно уйти с неё.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-surface p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <span className="material-symbols-outlined text-error text-[48px]">error</span>
            <h1 className="font-headline-sm text-headline-sm text-on-surface">Что-то пошло не так</h1>
            <p className="text-body-md font-body-md text-on-surface-variant">
              На странице произошла непредвиденная ошибка. Попробуйте обновить страницу — обычно это помогает.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 bg-primary text-on-primary px-6 py-3 rounded-lg font-label-md text-label-md hover:opacity-90 transition-opacity"
            >
              <span className="material-symbols-outlined text-[18px]">refresh</span>
              Обновить страницу
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
