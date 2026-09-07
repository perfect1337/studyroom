import { useState, useEffect } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import ConfirmToggleModal from "../../components/ui/ConfirmToggleModal.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { updateMe, changePassword } from "../../api/auth.js";
import { fetchNotificationSettings, updateNotificationSettings, unlinkTelegram, unlinkMax } from "../../api/notifications.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";
import { useTelegramStatus } from "../../hooks/useTelegramStatus.js";
import { useMaxStatus } from "../../hooks/useMaxStatus.js";
import { MAX_BOT_URL } from "../../api/config.js";
import { TELEGRAM_BOT_URL } from "../../api/config.js";

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
  branch_owner: "Управление учётной записью руководителя филиала",
};

function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

// В контракте бэкенда нет отдельного эндпоинта загрузки файла — только строковое
// поле avatar_url. Чтобы пользователь не вставлял ссылку руками, читаем выбранный
// файл, ужимаем его на канвасе (макс. 512x512, JPEG) и кладём как data:-URL в то же
// поле — работает без изменений на сервере.
const MAX_AVATAR_SIDE = 512;
const MAX_AVATAR_BYTES = 1_500_000; // ~1.5MB — с запасом под TEXT-колонку и трафик

function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Выберите файл изображения (JPEG, PNG, WebP)"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Файл повреждён или это не изображение"));
      img.onload = () => {
        const scale = Math.min(1, MAX_AVATAR_SIDE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        if (dataUrl.length > MAX_AVATAR_BYTES) {
          reject(new Error("Изображение слишком большое даже после сжатия — выберите файл поменьше"));
          return;
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Раздел "Настройки" — общий для всех ролей (см. п.1.7 / 1.8 api-contracts.md):
 * - PATCH /users/me — редактирование имени/фамилии/отчества/аватара/email (по ссылке
 *   на аватар, т.к. отдельного эндпоинта загрузки файла в контракте нет — только
 *   строка avatar_url).
 * - POST /users/me/change-password — смена пароля.
 * Email редактируем для всех ролей, включая ученика: у ученика это поле одновременно
 * служит логином для входа (сгенерировано при создании аккаунта из ФИО), но ученик
 * теперь может сам заменить его на свою настоящую почту — так же, как остальные роли,
 * с тем же подтверждением текущим паролем (см. UpdateMe на бэкенде).
 * Телефон бэкенд через эти эндпоинты не меняет, поэтому в форме его нет вовсе.
 * Блок "Уведомления" (Telegram/email) — для всех ролей, КРОМЕ ученика: он не может
 * сам подключать/отключать уведомления в своём профиле (см. ниже, isStudent).
 */
export default function SettingsPage({ role }) {
  const { user, updateUser, setTutorMode } = useAuth();

  const [tutorModeLoading, setTutorModeLoading] = useState(false);
  const [tutorModeError, setTutorModeError] = useState("");
  // Доп. подтверждение при переключении тумблера "версия учителя" — как при
  // включении, так и при выключении (см. кнопку switch ниже: она теперь
  // только открывает эту модалку, а не дёргает API напрямую). При выключении
  // это особенно важно: оно необратимо удаляет профиль преподавателя
  // (специализацию/статус) и назначения курсов на бэкенде — см.
  // handleTutorModeConfirm.
  const [tutorModeConfirmOpen, setTutorModeConfirmOpen] = useState(false);

  function handleTutorModeToggle() {
    setTutorModeError("");
    setTutorModeConfirmOpen(true);
  }

  async function handleTutorModeConfirm() {
    setTutorModeError("");
    setTutorModeLoading(true);
    try {
      await setTutorMode(!user?.is_tutor);
      setTutorModeConfirmOpen(false);
    } catch (e) {
      setTutorModeError(e?.message || "Не удалось изменить режим. Попробуйте ещё раз.");
    } finally {
      setTutorModeLoading(false);
    }
  }

  function handleTutorModeCancel() {
    if (tutorModeLoading) return;
    setTutorModeConfirmOpen(false);
  }

  const { status: tgStatus, loading: tgLoading, refresh: refreshTg } = useTelegramStatus();
  const { status: maxStatus, loading: maxLoading, refresh: refreshMax } = useMaxStatus();

  const [notifSettings, setNotifSettings] = useState(null);
  const [notifLoading, setNotifLoading] = useState(true);

  useEffect(() => {
    // Ученику подключение уведомлений недоступно (см. блок "Уведомления"
    // ниже — он скрыт для role=student), поэтому и настройки для него не
    // грузим — незачем дёргать API впустую.
    if (role === "student") {
      setNotifLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const settings = await fetchNotificationSettings();
        if (!cancelled) setNotifSettings(settings);
      } catch (e) {
        console.error("Failed to load notification settings:", e);
      }
      if (!cancelled) setNotifLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [role]);

  async function handleNotifToggle(key) {
    if (!notifSettings) return;
    const updated = { ...notifSettings, [key]: !notifSettings[key] };
    if (updated.telegram_enabled) updated.preferred_messenger = "telegram";
    else if (updated.max_enabled) updated.preferred_messenger = "max";
    else if (updated.whatsapp_enabled) updated.preferred_messenger = "whatsapp";
    else if (updated.email_enabled) updated.preferred_messenger = "email";
    else updated.preferred_messenger = "";
    setNotifSettings(updated);
    try {
      await updateNotificationSettings(updated);
      if (key === "telegram_enabled" && updated.telegram_enabled) {
        try { await refreshTg(); } catch {}
      }
      if (key === "max_enabled" && updated.max_enabled) {
        try { await refreshMax(); } catch {}
      }
    } catch (e) {
      setNotifSettings(notifSettings);
    }
  }

  const [tgUnlinking, setTgUnlinking] = useState(false);
  const [tgUnlinkError, setTgUnlinkError] = useState("");

  // handleUnlinkTelegram — раньше отвязать Telegram можно было только
  // заблокировав/удалив бота в самом Telegram, что никак не удаляло запись
  // на бэкенде (telegram_users) — уведомления продолжали молча пытаться
  // уйти в чат, который человек уже не откроет. Теперь есть явный DELETE
  // /notifications/telegram/link (см. api/notifications.js), который
  // удаляет привязку и заодно выключает telegram_enabled в настройках —
  // здесь просто синхронизируем локальный state с тем, что сделал бэкенд.
  async function handleUnlinkTelegram() {
    setTgUnlinkError("");
    setTgUnlinking(true);
    try {
      await unlinkTelegram();
      await refreshTg();
      setNotifSettings((prev) => (prev ? { ...prev, telegram_enabled: false } : prev));
    } catch (e) {
      setTgUnlinkError(e.message || "Не удалось отвязать Telegram");
    } finally {
      setTgUnlinking(false);
    }
  }

  const [maxUnlinking, setMaxUnlinking] = useState(false);
  const [maxUnlinkError, setMaxUnlinkError] = useState("");
  async function handleUnlinkMax() {
    setMaxUnlinkError(""); setMaxUnlinking(true);
    try {
      await unlinkMax();
      await refreshMax();
      setNotifSettings((prev) => (prev ? { ...prev, max_enabled: false } : prev));
    } catch (e) { setMaxUnlinkError(e.message || "Не удалось отвязать MAX"); }
    finally { setMaxUnlinking(false); }
  }

  const isStudent = role === "student";
  const [profileForm, setProfileForm] = useState({
    last_name: user?.last_name ?? "",
    first_name: user?.first_name ?? "",
    patronymic: user?.patronymic ?? "",
    avatar_url: user?.avatar_url ?? "",
    class_info: user?.class_info ?? "",
    school: user?.school ?? "",
    email: user?.email ?? "",
  });
  const [profileStatus, setProfileStatus] = useState("");
  const [profileError, setProfileError] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [avatarLoading, setAvatarLoading] = useState(false);
  // Текущий пароль запрашиваем отдельно от остальной формы профиля — это
  // разовое подтверждение личности для смены email, а не поле профиля,
  // которое нужно было бы предзаполнять/хранить между сохранениями.
  const [emailPassword, setEmailPassword] = useState("");

  async function handleAvatarFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // чтобы можно было выбрать тот же файл повторно
    if (!file) return;
    setAvatarError("");
    setAvatarLoading(true);
    try {
      const dataUrl = await resizeImageFile(file);
      setProfileForm((f) => ({ ...f, avatar_url: dataUrl }));
    } catch (err) {
      setAvatarError(err.message || "Не удалось обработать изображение");
    } finally {
      setAvatarLoading(false);
    }
  }

  const [pwForm, setPwForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [pwStatus, setPwStatus] = useState("");
  const [pwError, setPwError] = useState("");

  async function handleProfileSubmit(e) {
    e.preventDefault();
    // Email считается изменённым, если новое значение отличается от того,
    // что реально сохранено на сервере (user?.email) — не от начального
    // значения формы при монтировании, так как пользователь мог сначала
    // ввести email, потом стереть и вернуть обратно то же значение.
    // Это касается и ученика — он теперь тоже может сменить свой email.
    const emailChanged = profileForm.email.trim() !== (user?.email ?? "");
    if (emailChanged && !emailPassword) {
      setProfileError("Чтобы сменить email, введите текущий пароль.");
      return;
    }
    setProfileStatus("saving");
    setProfileError("");
    try {
      const updated = await updateMe({
        last_name: profileForm.last_name,
        first_name: profileForm.first_name,
        patronymic: profileForm.patronymic || undefined,
        avatar_url: profileForm.avatar_url || undefined,
        // Класс/школу может менять только сам ученик — бэкенд отклонит эти
        // поля с 403 для остальных ролей, поэтому не отправляем их вовсе.
        ...(isStudent
          ? {
              class_info: profileForm.class_info || undefined,
              school: profileForm.school || undefined,
            }
          : {}),
        // Email редактируем для всех ролей, включая ученика.
        email: profileForm.email || undefined,
        // current_password отправляем, только когда email реально
        // меняется — бэкенд требует его именно в этом случае (см.
        // UpdateMe), не стоит гонять пароль по сети без нужды.
        ...(emailChanged ? { current_password: emailPassword } : {}),
      });
      updateUser(updated ?? profileForm);
      setEmailPassword("");
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
            <label
              htmlFor="avatar-upload-input"
              className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity"
              title="Загрузить фото"
            >
              <span className="material-symbols-outlined text-white text-3xl">photo_camera</span>
            </label>
            <input
              id="avatar-upload-input"
              type="file"
              accept="image/*"
              onChange={handleAvatarFile}
              className="hidden"
            />
          </div>
          <div className="text-center md:text-left flex-1 w-full">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">{fullName(user) || user?.email}</h3>
            <p className="font-body-md text-on-surface-variant">{ROLE_TAGLINE[role] ?? "Управление учётной записью"}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label
                htmlFor="avatar-upload-input"
                className="inline-flex items-center gap-2 bg-surface border border-outline-variant rounded-lg px-4 py-2 text-label-md font-bold text-on-surface cursor-pointer hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">upload</span>
                {avatarLoading ? "Обработка..." : "Загрузить фото"}
              </label>
              {profileForm.avatar_url && (
                <button
                  type="button"
                  onClick={() => setProfileForm((f) => ({ ...f, avatar_url: "" }))}
                  className="text-label-md text-error font-bold hover:underline"
                >
                  Удалить фото
                </button>
              )}
            </div>
            {avatarError && <p className="text-sm text-error mt-2 text-left">{avatarError}</p>}
            <p className="text-[12px] text-on-surface-variant mt-1 text-left">JPEG, PNG или WebP. Изменения сохранятся после нажатия «Сохранить изменения» ниже.</p>
          </div>
        </section>

        {/* Режим "версия учителя" — только для владельца филиала (branch_owner).
            Включает тот же UI и функционал, что у обычного преподавателя
            (назначение себе курсов, задания, тесты), не создавая отдельный
            логин — переключиться обратно можно кнопкой внизу сайдбара
            "Вернуться в панель филиала". Данные владельца филиала (роль,
            договоры, филиал и т.д.) не затрагиваются в любом случае.
            Выключение тумблера, в отличие от прошлой версии, ПОЛНОСТЬЮ
            удаляет информацию о вас как о преподавателе (специализацию,
            статус, назначенные курсы) — см. ConfirmToggleModal ниже и
            комментарий в user_handler.go/SetTutorMode на бэкенде. Уже
            стоящие занятия при этом остаются в расписании филиала — просто
            перестают быть "вашими": у них снимается закреплённый
            преподаватель, и любой tutor этого курса сможет взять их себе. */}
        {role === "branch_owner" && (
          <section className="bg-surface-container-lowest rounded-xl p-stack-md shadow-[0_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant">
            <div className="flex items-center gap-3 mb-stack-md">
              <span className="material-symbols-outlined text-primary">school</span>
              <h3 className="font-headline-sm text-[20px] text-on-surface">Режим преподавателя</h3>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="max-w-[520px]">
                <p className="font-label-md font-bold text-on-surface">Зарегистрироваться как учитель</p>
                <p className="text-sm text-on-surface-variant mt-1">
                  Включите, чтобы получить кнопку «Сменить на версию учителя» внизу меню слева. В этом режиме
                  доступны интерфейс и функции преподавателя: можно назначать себе курсы, выдавать задания и тесты —
                  как обычному учителю. Ваши данные владельца филиала при этом сохраняются в любом случае.
                </p>
                <p className="text-sm text-on-surface-variant mt-1">
                  При выключении вся информация о вас как о преподавателе (специализация, статус, назначенные курсы)
                  будет удалена без возможности восстановления — уже стоящие в расписании занятия останутся, но
                  преподавателем в них вы больше не будете значиться.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!!user?.is_tutor}
                disabled={tutorModeLoading}
                onClick={handleTutorModeToggle}
                className={`shrink-0 relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-60 ${
                  user?.is_tutor ? "bg-primary" : "bg-surface-container-highest border border-outline-variant"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    user?.is_tutor ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {tutorModeError && <p className="text-sm text-error mt-3">{tutorModeError}</p>}
          </section>
        )}

        <ConfirmToggleModal
          open={tutorModeConfirmOpen}
          danger={!!user?.is_tutor}
          busy={tutorModeLoading}
          error={tutorModeError}
          title={user?.is_tutor ? "Выключить режим преподавателя?" : "Включить режим преподавателя?"}
          description={
            user?.is_tutor
              ? "Это удалит вашу специализацию, статус преподавателя и назначения на курсы — восстановить их будет нельзя, при повторном включении придётся настраивать заново.\n\nУже стоящие занятия останутся в расписании филиала, но преподавателем в них вы больше не будете указаны — их сможет взять себе любой другой преподаватель этого курса.\n\nВы также сразу пропадёте из списка «Преподаватели» своего филиала."
              : "Вы получите интерфейс и функции преподавателя: назначение себе курсов, задания и тесты — как у обычного учителя. Роль владельца филиала и все её данные при этом сохранятся."
          }
          confirmLabel={user?.is_tutor ? "Да, выключить" : "Да, включить"}
          cancelLabel="Отмена"
          onCancel={handleTutorModeCancel}
          onConfirm={handleTutorModeConfirm}
        />

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
            {isStudent && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md">
                <div className="space-y-stack-sm">
                  <label className="font-label-md text-on-surface-variant ml-1">Школа</label>
                  <input
                    value={profileForm.school}
                    onChange={(e) => setProfileForm((f) => ({ ...f, school: e.target.value }))}
                    placeholder="Например, Школа №25"
                    className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-on-surface"
                    type="text"
                  />
                </div>
                <div className="space-y-stack-sm">
                  <label className="font-label-md text-on-surface-variant ml-1">Класс</label>
                  <div className="relative">
                    <select
                      value={profileForm.class_info}
                      onChange={(e) => setProfileForm((f) => ({ ...f, class_info: e.target.value }))}
                      className="w-full appearance-none bg-surface border border-outline-variant rounded-lg pl-4 pr-9 py-3 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-on-surface"
                    >
                      <option value="">Не указан</option>
                      {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={String(n)}>{n} класс</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-stack-sm">
              <label className="font-label-md text-on-surface-variant ml-1">Адрес электронной почты</label>
              <div className="relative">
                <input
                  value={profileForm.email}
                  onChange={(e) => setProfileForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 outline-none transition-all text-on-surface focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  type="email"
                />
              </div>
              <p className="text-[12px] text-on-surface-variant ml-1">
                {isStudent
                  ? "Используется и как логин для входа, и для email-уведомлений. После смены снова понадобится текущий email для входа, пока вы не выйдете и не зайдёте заново."
                  : "Используется для входа и уведомлений. После смены снова понадобится текущий email для входа, пока вы не выйдете и не зайдёте заново."}
              </p>
            </div>

            {profileForm.email.trim() !== (user?.email ?? "") && (
              <div className="space-y-stack-sm">
                <label className="font-label-md text-on-surface-variant ml-1">Текущий пароль</label>
                <input
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 outline-none transition-all focus:ring-2 focus:ring-primary/20 focus:border-primary text-on-surface"
                  type="password"
                  placeholder="Введите пароль, чтобы подтвердить смену email"
                />
                <p className="text-[12px] text-on-surface-variant ml-1">
                  Требуется для подтверждения — email одновременно служит логином для входа.
                </p>
              </div>
            )}

            {profileError && <p className="text-sm text-error">{profileError}</p>}

            <div className="pt-stack-md flex justify-end">
              <button
                type="submit"
                disabled={profileStatus === "saving" || avatarLoading}
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

        {/* Notifications — недоступно ученику: он не может сам подключать
            уведомления (ни Telegram, ни email) в своём профиле. */}
        {!isStudent && (
        <section className="bg-surface-container-lowest rounded-xl p-stack-md shadow-[0_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant">
          <div className="flex items-center gap-3 mb-stack-lg">
            <span className="material-symbols-outlined text-warning">notifications</span>
            <h3 className="font-headline-sm text-[20px] text-on-surface">Уведомления</h3>
          </div>

          {notifLoading ? (
            <p className="text-sm text-on-surface-variant">Загрузка настроек...</p>
          ) : (
            <div className="space-y-stack-md">
              {/* Telegram — адаптивно под любые экраны: на узких (мобильных)
                  шапка блока переходит на две строки (текст сверху,
                  переключатель под ним на всю ширину), на планшетах/десктопе
                  остаётся в одну строку, как раньше. */}
              <div className="bg-surface rounded-xl p-3 sm:p-4 space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <p className="font-label-md font-bold text-on-surface">Telegram</p>
                      <p className="text-xs text-on-surface-variant break-words">Уведомления о занятиях, оценках и платежах</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer self-start shrink-0 sm:self-auto">
                    <input
                      type="checkbox"
                      checked={!!notifSettings?.telegram_enabled}
                      onChange={() => handleNotifToggle("telegram_enabled")}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>

                {tgStatus !== null && (
                  <div className={`flex items-center gap-2 text-xs font-bold ${
                    tgStatus.connected ? "text-primary" : "text-warning"
                  }`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${tgStatus.connected ? "bg-primary" : "bg-warning"}`}></span>
                    {tgStatus.connected ? "Подключено" : "Не подключено"}
                  </div>
                )}

                {tgLoading ? (
                  <p className="text-xs text-on-surface-variant">Проверка статуса...</p>
                ) : !tgStatus?.connected && notifSettings?.telegram_enabled ? (
                  <div className="bg-surface-container-low border border-outline-variant rounded-lg p-3 space-y-2">
                    <p className="text-xs font-bold text-on-surface">👋 Для подключения:</p>
                    <ol className="text-xs text-on-surface-variant space-y-1 list-decimal list-inside break-words">
                      <li>Откройте бота <strong>Study Room</strong></li>
                      <li>Нажмите <code className="bg-surface px-1 rounded text-[10px] font-mono">/start</code></li>
                      <li>Введите email, указанный при регистрации</li>
                    </ol>
                    <a
                      href={TELEGRAM_BOT_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 bg-primary text-on-primary px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity w-full sm:w-auto justify-center"
                    >
                      <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                      Открыть бота
                    </a>
                  </div>
                ) : tgStatus?.connected ? (
                  <div className="bg-primary/10 border border-primary/30 rounded-lg p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-[16px] shrink-0">check_circle</span>
                      <p className="text-xs text-primary font-medium break-words">
                        {tgStatus.telegram_username ? `Подключено как @${tgStatus.telegram_username}` : "Telegram подключён"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleUnlinkTelegram}
                      disabled={tgUnlinking}
                      className="text-xs font-bold text-error hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {tgUnlinking ? "Отвязываем..." : "Отвязать Telegram"}
                    </button>
                    {tgUnlinkError && <p className="text-xs text-error">{tgUnlinkError}</p>}
                  </div>
                ) : null}
              </div>

              {/* MAX */}
              <div className="bg-surface rounded-xl p-3 sm:p-4 space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0"><p className="font-label-md font-bold text-on-surface">MAX</p><p className="text-xs text-on-surface-variant">Уведомления о занятиях, оценках и платежах</p></div>
                  <label className="relative inline-flex items-center cursor-pointer self-start shrink-0 sm:self-auto"><input type="checkbox" checked={!!notifSettings?.max_enabled} onChange={() => handleNotifToggle("max_enabled")} className="sr-only peer" /><div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div></label>
                </div>
                {maxStatus !== null && <div className={`flex items-center gap-2 text-xs font-bold ${maxStatus.connected ? "text-primary" : "text-warning"}`}><span className={`w-2 h-2 rounded-full shrink-0 ${maxStatus.connected ? "bg-primary" : "bg-warning"}`}></span>{maxStatus.connected ? "Подключено" : "Не подключено"}</div>}
                {maxLoading ? <p className="text-xs text-on-surface-variant">Проверка статуса...</p> : !maxStatus?.connected && notifSettings?.max_enabled ? (
                  <div className="bg-surface-container-low border border-outline-variant rounded-lg p-3 space-y-2"><p className="text-xs font-bold text-on-surface">👋 Для подключения:</p><ol className="text-xs text-on-surface-variant space-y-1 list-decimal list-inside"><li>Откройте бота Study Room в MAX</li><li>Нажмите Старт</li><li>Введите email, указанный при регистрации</li></ol><a href={MAX_BOT_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 bg-primary text-on-primary px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90">Открыть бота</a></div>
                ) : maxStatus?.connected ? (
                  <div className="bg-primary/10 border border-primary/30 rounded-lg p-2 space-y-2"><div className="flex items-center gap-2"><span className="material-symbols-outlined text-primary text-[16px]">check_circle</span><p className="text-xs text-primary font-medium">{maxStatus.max_username ? `Подключено как @${maxStatus.max_username}` : "MAX подключён"}</p></div><button type="button" onClick={handleUnlinkMax} disabled={maxUnlinking} className="text-xs font-bold text-error hover:underline disabled:opacity-50">{maxUnlinking ? "Отвязываем..." : "Отвязать MAX"}</button>{maxUnlinkError && <p className="text-xs text-error">{maxUnlinkError}</p>}</div>
                ) : null}
              </div>

              {/* Email */}
              <div className="flex items-center justify-between bg-surface rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary">email</span>
                  <div>
                    <p className="font-label-md font-bold text-on-surface">Почта</p>
                    <p className="text-xs text-on-surface-variant">Email-уведомления</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!notifSettings?.email_enabled}
                    onChange={() => handleNotifToggle("email_enabled")}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
            </div>
          )}
        </section>
        )}
      </div>
    </DashboardShell>
  );
}
