import { useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { updateMe, changePassword } from "../../api/auth.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

// role из JWT/контекста -> роль для сайдбара (у owner отдельный визуальный раздел "admin")
const SIDEBAR_ROLE = {
  student: "student",
  tutor: "tutor",
  parent: "parent",
  owner: "admin",
  branch_owner: "branch_owner",
};

const ROLE_TAGLINE = {
  student: "Управление учётной записью ученика",
  tutor: "Управление учётной записью преподавателя",
  parent: "Управление учётной записью родителя",
  owner: "Управление учётной записью владельца сети",
  branch_owner: "Управление учётной записью управляющего филиалом",
};

function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

/**
 * Раздел "Настройки" — общий для всех ролей (см. п.1.7 / 1.8 api-contracts.md):
 * - PATCH /users/me — редактирование имени/фамилии/отчества/аватара (по ссылке, т.к.
 *   отдельного эндпоинта загрузки файла в контракте нет — только строка avatar_url).
 * - POST /users/me/change-password — смена пароля.
 * Email и телефон бэкенд через эти эндпоинты не меняет, поэтому показываем их только для чтения.
 */
export default function SettingsPage({ role }) {
  const { user, updateUser } = useAuth();

  const [profileForm, setProfileForm] = useState({
    last_name: user?.last_name ?? "",
    first_name: user?.first_name ?? "",
    patronymic: user?.patronymic ?? "",
    avatar_url: user?.avatar_url ?? "",
  });
  const [profileStatus, setProfileStatus] = useState("");
  const [profileError, setProfileError] = useState("");

  const [pwForm, setPwForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [pwStatus, setPwStatus] = useState("");
  const [pwError, setPwError] = useState("");

  async function handleProfileSubmit(e) {
    e.preventDefault();
    setProfileStatus("saving");
    setProfileError("");
    try {
      const updated = await updateMe({
        last_name: profileForm.last_name,
        first_name: profileForm.first_name,
        patronymic: profileForm.patronymic || undefined,
        avatar_url: profileForm.avatar_url || undefined,
      });
      updateUser(updated ?? profileForm);
      setProfileStatus("done");
      setTimeout(() => setProfileStatus(""), 2000);
    } catch (err) {
      setProfileStatus("");
      setProfileError(err.message || "Не удалось сохранить изменения");
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPwError("");
    if (!pwForm.current_password || !pwForm.new_password) return;
    if (pwForm.new_password.length < 8) {
      setPwError("Новый пароль должен содержать не менее 8 символов");
      return;
    }
    if (pwForm.new_password !== pwForm.confirm_password) {
      setPwError("Пароли не совпадают");
      return;
    }
    setPwStatus("saving");
    try {
      await changePassword({ current_password: pwForm.current_password, new_password: pwForm.new_password });
      setPwStatus("done");
      setPwForm({ current_password: "", new_password: "", confirm_password: "" });
      setTimeout(() => setPwStatus(""), 2000);
    } catch (err) {
      setPwStatus("");
      setPwError(err.message || "Не удалось сменить пароль");
    }
  }

  return (
    <DashboardShell
      role={SIDEBAR_ROLE[role] ?? role}
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="max-w-[800px] mx-auto py-stack-lg space-y-stack-lg">
        {/* Profile Header */}
        <section className="bg-surface-container-lowest rounded-xl p-stack-md shadow-[0_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant flex flex-col md:flex-row items-center gap-6">
          <div className="relative group shrink-0">
            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-surface-container-highest shadow-sm bg-primary-fixed flex items-center justify-center text-primary font-bold text-3xl">
              {profileForm.avatar_url ? (
                <img src={profileForm.avatar_url} alt={fullName(user)} className="w-full h-full object-cover" />
              ) : (
                initials(user)
              )}
            </div>
          </div>
          <div className="text-center md:text-left flex-1 w-full">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">{fullName(user) || user?.email}</h3>
            <p className="font-body-md text-on-surface-variant">{ROLE_TAGLINE[role] ?? "Управление учётной записью"}</p>
            <div className="mt-4">
              <label className="block text-[12px] font-bold text-on-surface-variant mb-1 text-left">Ссылка на фото профиля</label>
              <input
                value={profileForm.avatar_url}
                onChange={(e) => setProfileForm((f) => ({ ...f, avatar_url: e.target.value }))}
                placeholder="https://..."
                className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-on-surface"
              />
            </div>
          </div>
        </section>

        {/* Personal Information */}
        <section className="bg-surface-container-lowest rounded-xl p-stack-md shadow-[0_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant">
          <div className="flex items-center gap-3 mb-stack-lg">
            <span className="material-symbols-outlined text-primary">person</span>
            <h3 className="font-headline-sm text-[20px] text-on-surface">Личная информация</h3>
          </div>
          <form onSubmit={handleProfileSubmit} className="space-y-stack-md">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md">
              <div className="space-y-stack-sm">
                <label className="font-label-md text-on-surface-variant ml-1">Фамилия</label>
                <input
                  required
                  value={profileForm.last_name}
                  onChange={(e) => setProfileForm((f) => ({ ...f, last_name: e.target.value }))}
                  className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-on-surface"
                  type="text"
                />
              </div>
              <div className="space-y-stack-sm">
                <label className="font-label-md text-on-surface-variant ml-1">Имя</label>
                <input
                  required
                  value={profileForm.first_name}
                  onChange={(e) => setProfileForm((f) => ({ ...f, first_name: e.target.value }))}
                  className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-on-surface"
                  type="text"
                />
              </div>
            </div>
            <div className="space-y-stack-sm">
              <label className="font-label-md text-on-surface-variant ml-1">Отчество</label>
              <input
                value={profileForm.patronymic}
                onChange={(e) => setProfileForm((f) => ({ ...f, patronymic: e.target.value }))}
                placeholder="Введите отчество"
                className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-on-surface"
                type="text"
              />
            </div>
            <div className="space-y-stack-sm">
              <label className="font-label-md text-on-surface-variant ml-1">Адрес электронной почты</label>
              <div className="relative">
                <input
                  value={user?.email ?? ""}
                  disabled
                  className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 outline-none text-on-surface-variant cursor-not-allowed"
                  type="email"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-primary material-symbols-outlined">verified</span>
              </div>
              <p className="text-[12px] text-on-surface-variant ml-1">Смена email в этой версии недоступна — обратитесь в поддержку.</p>
            </div>

            {profileError && <p className="text-sm text-error">{profileError}</p>}

            <div className="pt-stack-md flex justify-end">
              <button
                type="submit"
                disabled={profileStatus === "saving"}
                className={`font-label-md px-8 py-3 rounded-lg shadow-sm hover:translate-y-[-1px] active:scale-95 transition-all disabled:opacity-60 ${
                  profileStatus === "done" ? "bg-green-600 text-white" : "bg-primary text-on-primary"
                }`}
              >
                {profileStatus === "saving" ? "Сохранение..." : profileStatus === "done" ? "Сохранено ✓" : "Сохранить изменения"}
              </button>
            </div>
          </form>
        </section>

        {/* Security */}
        <section className="bg-surface-container-lowest rounded-xl p-stack-md shadow-[0_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant">
          <div className="flex items-center gap-3 mb-stack-lg">
            <span className="material-symbols-outlined text-tertiary">security</span>
            <h3 className="font-headline-sm text-[20px] text-on-surface">Безопасность</h3>
          </div>
          <form onSubmit={handlePasswordSubmit} className="space-y-stack-md">
            <div className="space-y-stack-sm">
              <label className="font-label-md text-on-surface-variant ml-1">Текущий пароль</label>
              <input
                required
                value={pwForm.current_password}
                onChange={(e) => setPwForm((f) => ({ ...f, current_password: e.target.value }))}
                className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-on-surface"
                placeholder="••••••••"
                type="password"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md">
              <div className="space-y-stack-sm">
                <label className="font-label-md text-on-surface-variant ml-1">Новый пароль</label>
                <input
                  required
                  value={pwForm.new_password}
                  onChange={(e) => setPwForm((f) => ({ ...f, new_password: e.target.value }))}
                  className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-on-surface"
                  placeholder="Введите новый пароль"
                  type="password"
                />
              </div>
              <div className="space-y-stack-sm">
                <label className="font-label-md text-on-surface-variant ml-1">Подтвердите пароль</label>
                <input
                  required
                  value={pwForm.confirm_password}
                  onChange={(e) => setPwForm((f) => ({ ...f, confirm_password: e.target.value }))}
                  className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-on-surface"
                  placeholder="Повторите новый пароль"
                  type="password"
                />
              </div>
            </div>
            <div className="bg-surface-container-low p-4 rounded-lg flex items-start gap-3">
              <span className="material-symbols-outlined text-primary text-[20px]">info</span>
              <p className="text-label-md text-on-surface-variant">Пароль должен содержать не менее 8 символов.</p>
            </div>

            {pwError && <p className="text-sm text-error">{pwError}</p>}

            <div className="pt-stack-md flex justify-end">
              <button
                type="submit"
                disabled={pwStatus === "saving"}
                className={`font-label-md px-8 py-3 rounded-lg shadow-sm hover:translate-y-[-1px] active:scale-95 transition-all disabled:opacity-60 ${
                  pwStatus === "done" ? "bg-green-600 text-white" : "bg-secondary-container text-on-secondary-container"
                }`}
              >
                {pwStatus === "saving" ? "Сохранение..." : pwStatus === "done" ? "Пароль обновлён ✓" : "Обновить пароль"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </DashboardShell>
  );
}
