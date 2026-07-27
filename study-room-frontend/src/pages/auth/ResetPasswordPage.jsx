import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { resetPassword } from "../../api/auth.js";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Неверная ссылка для восстановления пароля.");
    }
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Пароль должен содержать минимум 8 символов.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Пароли не совпадают.");
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword({ reset_token: token, new_password: password });
      setSuccess(true);
      setTimeout(() => navigate("/login"), 3000);
    } catch (err) {
      setError(err.message || "Не удалось сбросить пароль. Попробуйте снова.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-red-600">
        Недействительная ссылка для сброса пароля.
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-8 bg-surface-container-lowest rounded-xl shadow-lg">
        <h1 className="text-2xl font-bold text-on-surface mb-4">Сброс пароля</h1>
        <p className="text-on-surface-variant mb-6">Введите новый пароль для вашей учётной записи.</p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-error-container text-on-error-container text-sm flex items-center gap-2">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}

        {success ? (
          <div className="p-4 bg-green-100 text-green-800 rounded-lg">
            <p>Пароль успешно изменён!</p>
            <p className="text-sm">Перенаправляем на страницу входа...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-on-surface" htmlFor="password">
                Новый пароль
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1 w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-2 focus:ring-primary-fixed outline-none"
                placeholder="Минимум 8 символов"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-on-surface" htmlFor="confirm">
                Подтвердите пароль
              </label>
              <input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="mt-1 w-full px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-2 focus:ring-primary-fixed outline-none"
                placeholder="Повторите пароль"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 bg-primary text-on-primary font-medium rounded-lg shadow hover:shadow-md transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? "Сохранение…" : "Сбросить пароль"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}