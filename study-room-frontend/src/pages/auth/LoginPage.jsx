import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth, ROLE_HOME_ROUTE } from "../../context/AuthContext.jsx";
import { forgotPassword } from "../../api/auth.js";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ login: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      // POST /api/v1/users/auth/login — роль приходит с бэкенда в user.role,
      // по ней определяем, в какой раздел вести пользователя.
      const user = await login(form.login, form.password);
      const from = location.state?.from?.pathname;
      const home = ROLE_HOME_ROUTE[user.role] ?? "/login";
      navigate(from && from !== "/login" ? from : home, { replace: true });
    } catch (err) {
      // Обработка специфичных ошибок с бэкенда
      const errorMessage = err.message || err.response?.data?.message || "";
      if (errorMessage.toLowerCase().includes("invalid login or password")) {
        setError("Неверный логин или пароль");
      } else {
        setError(errorMessage || "Не удалось войти. Проверьте логин и пароль.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault(); 
    const email = form.login.trim();
    if (!email) {
      setError("Введите ваш email в поле «Логин или Email»");
      return;
    }
    setError("");
    setSuccessMessage("");
    try {
      await forgotPassword({ email });
      setSuccessMessage("Пароль отправлен на вашу почту. Проверьте ящик.");
    } catch (err) {
      const errorMessage = err.message || err.response?.data?.message || "";
      setError(errorMessage || "Не удалось отправить запрос. Попробуйте позже.");
    }
  }

  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col font-body-md antialiased">
      <header className="w-full h-16 flex items-center px-margin-mobile md:px-gutter max-w-container-max mx-auto absolute top-0 left-0 right-0 z-10">
        <div className="font-headline-md text-headline-md font-bold text-primary">Study Room</div>
        <Link
          to="https://studyroom64.ru/"
          className="ml-auto flex items-center gap-2 text-label-md font-label-md text-on-surface-variant hover:text-primary transition-colors"
        >
          <span className="material-symbols-outlined">arrow_back</span>
          <span>Вернуться на главную</span>
        </Link>
      </header>

      <main className="flex-grow flex items-center justify-center p-margin-mobile md:p-gutter pt-24 pb-24 relative overflow-hidden">
        <div className="absolute top-[-10%] right-[-5%] w-[40vw] h-[40vw] rounded-full bg-surface-container-highest opacity-50 blur-[100px] z-0 pointer-events-none" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[30vw] h-[30vw] rounded-full bg-primary-fixed opacity-40 blur-[80px] z-0 pointer-events-none" />

        <div className="w-full max-w-[1000px] bg-surface-container-lowest rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.05)] flex flex-col md:flex-row overflow-hidden z-10 border border-surface-container-high relative">
          <div className="hidden md:block md:w-1/2 relative bg-surface-container-low">
            <img
              className="absolute inset-0 w-full h-full object-cover opacity-90"
              alt="Студенты за совместной учёбой"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuBkm4FJoeMAljb42lybBFJZ7vg7Y_sTWCf7uuYvrmcbYKWEyZtR8ULm1VYUoSlRQvu0sb_pwTDmJuuevYUluxXviYUHjbpQt_iwVD8PrPrPPWa0tdptl2oue-13nJr_gYICe7z-U_IEasqzLETyZd6VA8ikE3_7zI8yNI6Fimdjf4fDpZe9_zQAYXj2TG-ZbDiA6MvnGeU8RaokIc8d2R1aQDLz83YYAsrXFeOeOeM8ptc-QzvBYUVANmeADZLui5FL8rQYbxOBBo4"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-primary/80 to-transparent" />
            <div className="absolute bottom-0 left-0 p-stack-lg text-on-primary">
              <h2 className="font-headline-md text-headline-md mb-stack-sm">Добро пожаловать обратно</h2>
              <p className="font-body-lg text-body-lg opacity-90">
                Продолжите своё обучение в современной цифровой среде.
              </p>
            </div>
          </div>

          <div className="w-full md:w-1/2 p-stack-lg md:p-[48px] flex flex-col justify-center bg-surface-container-lowest">
            <div className="mb-stack-lg text-center md:text-left">
              <h1 className="font-headline-md text-headline-md text-on-surface mb-stack-sm">Вход</h1>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Введите свои данные для доступа к платформе
              </p>
            </div>

            {error && (
              <div className="mb-stack-md p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px]"></span>
                {error}
              </div>
            )}
            {successMessage && (
              <div className="mb-stack-md p-3 rounded-lg bg-green-100 text-green-800 font-label-md text-label-md flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px]">check_circle</span>
                {successMessage}
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-stack-md">
              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="login">
                  Логин или Email
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">
                    mail
                  </span>
                  <input
                    id="login"
                    name="login"
                    type="text"
                    required
                    autoComplete="username"
                    value={form.login}
                    onChange={update("login")}
                    placeholder="student@example.com"
                    className="w-full pl-10 pr-4 py-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary-fixed focus:outline-none transition-all duration-200"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-stack-sm">
                <div className="flex justify-between items-center">
                  <label className="font-label-md text-label-md text-on-surface" htmlFor="password">
                    Пароль
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="font-label-md text-label-md text-primary hover:text-primary-container transition-colors bg-transparent border-none cursor-pointer p-0"
                  >
                    Забыли пароль?
                  </button>
                </div>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">
                    lock
                  </span>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={form.password}
                    onChange={update("password")}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface font-body-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary-fixed focus:outline-none transition-all duration-200"
                  />
                  <button
                    type="button"
                    aria-label="Показать пароль"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface transition-colors"
                  >
                    <span className="material-symbols-outlined">
                      {showPassword ? "visibility_off" : "visibility"}
                    </span>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="mt-stack-sm w-full bg-primary text-on-primary font-label-md text-label-md py-3 px-6 rounded-lg shadow-sm hover:shadow-md hover:-translate-y-[1px] hover:bg-primary-container transition-all duration-200 flex justify-center items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "Входим…" : "Войти"}
                {!submitting && <span className="material-symbols-outlined">arrow_forward</span>}
              </button>
            </form>

            <div className="mt-stack-lg mb-stack-md flex items-center gap-4">
              <div className="h-px bg-outline-variant flex-grow" />
              <span className="font-label-md text-label-md text-outline">или</span>
              <div className="h-px bg-outline-variant flex-grow" />
            </div>

            <div className="text-center">
              <p className="font-body-md text-body-md text-on-surface-variant">
                Нет аккаунта?{" "}
                <Link
                  to="/register"
                  className="font-label-md text-label-md text-primary font-semibold hover:underline decoration-secondary transition-all"
                >
                  Создать аккаунт
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}