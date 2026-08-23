import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { sanitizePhoneInput, isValidPhone } from "../../utils/phone.js";

const EMPTY_FORM = {
  last_name: "",
  first_name: "",
  patronymic: "",
  email: "",
  phone: "",
  password: "",
  confirm_password: "",
};

export default function RegisterPage() {
  const navigate = useNavigate();
  const { registerParent } = useAuth();

  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function updatePhone(e) {
    setForm((f) => ({ ...f, phone: sanitizePhoneInput(e.target.value) }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirm_password) {
      setError("Пароли не совпадают");
      return;
    }
    if (form.password.length < 8) {
      setError("Пароль должен быть не короче 8 символов");
      return;
    }
    if (!isValidPhone(form.phone)) {
      setError("Введите телефон в формате из 10-15 цифр (можно с +)");
      return;
    }

    setSubmitting(true);
    try {
      // POST /api/v1/users/auth/register — регистрирует пользователя как parent (см. п.1.1 контракта).
      await registerParent({
        email: form.email,
        phone: form.phone,
        password: form.password,
        last_name: form.last_name,
        first_name: form.first_name,
        patronymic: form.patronymic || undefined,
      });
      navigate("/parent", { replace: true });
    } catch (err) {
      setError(err.message || "Не удалось зарегистрироваться. Попробуйте ещё раз.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col font-body-md antialiased selection:bg-primary-container selection:text-on-primary-container">
      <header className="w-full py-stack-md px-margin-mobile md:px-gutter flex items-center justify-between">
        <Link
          to="/"
          className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-label-md text-label-md"
        >
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          <span>Вернуться на главную</span>
        </Link>
        <Link to="/login" className="font-headline-md text-headline-md font-bold text-primary flex items-center gap-2 hover:opacity-80 transition-opacity">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
            menu_book
          </span>
          Study Room
        </Link>
        <div className="w-32 hidden md:block" />
      </header>

      <main className="flex-grow flex items-center justify-center px-margin-mobile md:px-gutter py-section-padding">
        <div className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 overflow-hidden relative">
          <div className="h-2 w-full bg-primary absolute top-0 left-0" />
          <div className="p-8 md:p-10">
            <div className="text-center mb-stack-lg">
              <h1 className="font-headline-sm text-headline-sm text-on-surface mb-stack-sm">Создать аккаунт</h1>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Регистрация родителя — добавить детей и репетиторов можно будет из личного кабинета
              </p>
            </div>

            {error && (
              <div className="mb-stack-md p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px]">error</span>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-stack-md">
              <div className="grid grid-cols-2 gap-3">
                <Field id="last_name" label="Фамилия" icon="person" type="text" value={form.last_name} onChange={update("last_name")} />
                <Field id="first_name" label="Имя" icon="person" type="text" value={form.first_name} onChange={update("first_name")} />
              </div>
              <Field
                id="patronymic"
                label="Отчество (необязательно)"
                icon="badge"
                type="text"
                required={false}
                value={form.patronymic}
                onChange={update("patronymic")}
              />
              <Field id="email" label="Электронная почта" icon="mail" type="email" value={form.email} onChange={update("email")} />
              <Field
                id="phone"
                label="Номер телефона"
                icon="call"
                type="tel"
                placeholder="+7 (___) ___-__-__"
                value={form.phone}
                onChange={updatePhone}
                inputMode="tel"
                pattern="^\+?\d{10,15}$"
                title="10-15 цифр, можно с ведущим +"
                maxLength={16}
              />

              <div className="flex flex-col gap-stack-sm">
                <label className="font-label-md text-label-md text-on-surface" htmlFor="password">
                  Пароль
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-outline">
                    <span className="material-symbols-outlined text-[20px]">lock</span>
                  </span>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={form.password}
                    onChange={update("password")}
                    className="w-full pl-10 pr-10 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all shadow-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-outline hover:text-on-surface-variant transition-colors"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {showPassword ? "visibility_off" : "visibility"}
                    </span>
                  </button>
                </div>
                <p className="text-[12px] text-outline">Минимум 8 символов</p>
              </div>

              <Field
                id="confirm_password"
                label="Подтверждение пароля"
                icon="lock_reset"
                type="password"
                value={form.confirm_password}
                onChange={update("confirm_password")}
              />

              <div className="flex items-start mt-4">
                <div className="flex items-center h-5">
                  <input
                    id="terms"
                    name="terms"
                    type="checkbox"
                    required
                    className="w-4 h-4 text-primary bg-surface-container-lowest border-outline-variant rounded focus:ring-primary focus:ring-2 cursor-pointer"
                  />
                </div>
                <div className="ml-3 text-sm">
                  <label className="font-body-md text-body-md text-on-surface-variant text-[14px]" htmlFor="terms">
                    Я соглашаюсь с <a className="text-primary hover:underline font-label-md" href="#">Условиями использования</a> и{" "}
                    <a className="text-primary hover:underline font-label-md" href="#">Политикой конфиденциальности</a>
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-stack-lg py-3 px-4 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg shadow-sm hover:shadow-[0_4px_12px_rgba(0,74,198,0.2)] transition-all duration-200 flex justify-center items-center gap-2 transform active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "Регистрируем…" : "Зарегистрироваться"}
                {!submitting && <span className="material-symbols-outlined text-[20px]">arrow_forward</span>}
              </button>
            </form>

            <div className="mt-8 text-center">
              <p className="font-body-md text-body-md text-on-surface-variant">
                Уже есть аккаунт?{" "}
                <Link to="/login" className="text-primary font-label-md hover:underline decoration-primary underline-offset-4 transition-all">
                  Войти
                </Link>
              </p>
            </div>
          </div>

          <div className="absolute -bottom-16 -right-16 w-32 h-32 bg-primary/5 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -top-16 -left-16 w-32 h-32 bg-secondary-container/10 rounded-full blur-2xl pointer-events-none" />
        </div>
      </main>

      <footer className="w-full py-stack-md text-center">
        <p className="font-body-md text-[14px] text-outline">© 2026 Study Room. Все права защищены.</p>
      </footer>
    </div>
  );
}

function Field({ id, label, icon, type, placeholder, value, onChange, required = true, inputMode, pattern, title, maxLength }) {
  return (
    <div className="flex flex-col gap-stack-sm">
      <label className="font-label-md text-label-md text-on-surface" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-outline">
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </span>
        <input
          id={id}
          name={id}
          type={type}
          required={required}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          inputMode={inputMode}
          pattern={pattern}
          title={title}
          maxLength={maxLength}
          className="w-full pl-10 pr-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface placeholder-outline-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all shadow-sm"
        />
      </div>
    </div>
  );
}
