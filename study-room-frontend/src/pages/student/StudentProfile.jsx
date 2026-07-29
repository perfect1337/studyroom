import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchTests } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

// Поля карточки "Данные аккаунта" — каждое со своей иконкой, чтобы блок
// читался как список карточек, а не голый <dl>.
const ACCOUNT_ICON = {
  Email: "mail",
  Телефон: "call",
  Роль: "school",
  Класс: "groups",
  Школа: "location_city",
  "Статус аккаунта": "verified_user",
};

/**
 * "Профиль ученика" — сводка данных из своего же профиля (GET /users/me
 * уже выполнен AuthContext при входе, здесь просто отображаем то, что там
 * есть). Редактирование — на отдельной странице /student/settings, куда
 * ведёт кнопка ниже, чтобы не дублировать формы.
 */
export default function StudentProfile() {
  const { user } = useAuth();
  const [tests, setTests] = useState([]);

  useEffect(() => {
    if (!user?.id) return;
    // Область видимости сужается на бэкенде до собственных тестов ученика.
    fetchTests()
      .then((res) => setTests(res?.items ?? []))
      .catch(() => setTests([]));
  }, [user?.id]);

  const isActive = user?.is_active !== false;
  const fields = [
    ["Email", user?.email],
    ["Телефон", user?.phone || "Не указан"],
    ["Роль", "Ученик"],
    ["Класс", user?.class_info || "Не указан"],
    ["Школа", user?.school || "Не указана"],
    ["Статус аккаунта", isActive ? "Активен" : "Деактивирован"],
  ];

  // Средний балл — среднее арифметическое по всем оценённым тестам; если их
  // ещё нет, показываем статический avg_grade из профиля (если был задан).
  const gradedTests = tests.filter((t) => t.grade != null);
  const avgGrade = gradedTests.length
    ? gradedTests.reduce((s, t) => s + t.grade, 0) / gradedTests.length
    : user?.avg_grade ?? null;

  const showAcademicStats = avgGrade != null || user?.attendance_pct != null;

  return (
    <DashboardShell
      role="student"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="max-w-[760px] mx-auto py-stack-lg space-y-stack-lg">
        {/* Карточка профиля: градиентная "обложка" сверху + аватар внахлёст,
            вместо плоского серого блока — заметнее выделяет профиль на странице. */}
        <section className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant overflow-hidden">
          <div
            className="h-28 sm:h-32 relative"
            style={{ background: "linear-gradient(120deg, #004ac6 0%, #2563eb 55%, #5b8dff 100%)" }}
          >
            <div className="absolute inset-0 opacity-20" style={{
              backgroundImage: "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.5) 0, transparent 35%), radial-gradient(circle at 85% 75%, rgba(255,255,255,0.35) 0, transparent 30%)",
            }} />
            <Link
              to="/student/settings"
              className="hidden sm:inline-flex absolute top-4 right-4 items-center gap-2 bg-white/15 backdrop-blur text-white px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-white/25 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">edit</span>
              Редактировать
            </Link>
          </div>

          <div className="px-6 sm:px-8 pb-6 sm:pb-8">
            <div className="flex flex-col sm:flex-row sm:items-end gap-5 -mt-14 sm:-mt-16">
              <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full overflow-hidden border-4 border-surface-container-lowest shadow-lg bg-primary-fixed flex items-center justify-center text-primary font-bold text-4xl shrink-0">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt={fullName(user)} className="w-full h-full object-cover" />
                ) : (
                  initials(user)
                )}
              </div>
              <div className="flex-1 min-w-0 pb-1 text-center sm:text-left">
                <h2 className="font-headline-md text-headline-md text-on-background truncate">{fullName(user)}</h2>
                <div className="flex items-center justify-center sm:justify-start gap-2 mt-1">
                  <span className="inline-flex items-center gap-1 text-on-surface-variant font-label-md text-label-md">
                    <span className="material-symbols-outlined text-[16px]">school</span>
                    Ученик
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                      isActive ? "bg-primary/10 text-primary" : "bg-error-container text-on-error-container"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-primary" : "bg-error"}`} />
                    {isActive ? "Активен" : "Деактивирован"}
                  </span>
                </div>
              </div>
              <Link
                to="/student/settings"
                className="sm:hidden inline-flex items-center justify-center gap-2 bg-primary text-on-primary px-5 py-2.5 rounded-lg font-label-md shadow-sm active:scale-95 transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">edit</span>
                Редактировать
              </Link>
            </div>

            {showAcademicStats && (
              <div className="flex flex-wrap justify-center sm:justify-start gap-3 mt-6">
                {avgGrade != null && (
                  <Link
                    to="/student/grades"
                    className="flex items-center gap-3 px-4 py-3 bg-surface-container rounded-xl hover:bg-surface-container-high hover:-translate-y-0.5 transition-all"
                  >
                    <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>grade</span>
                    </div>
                    <div className="text-left">
                      <p className="text-[11px] uppercase tracking-wide text-on-surface-variant leading-none mb-1">Средний балл</p>
                      <p className="font-label-md text-on-surface leading-none">
                        <strong className="text-primary text-base">{avgGrade.toFixed(1)}</strong>
                        {gradedTests.length > 0 && (
                          <span className="text-on-surface-variant"> · {gradedTests.length} {gradedTests.length === 1 ? "тест" : "тестов"}</span>
                        )}
                      </p>
                    </div>
                  </Link>
                )}
                {user?.attendance_pct != null && (
                  <div className="flex items-center gap-3 px-4 py-3 bg-surface-container rounded-xl">
                    <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>event_available</span>
                    </div>
                    <div className="text-left">
                      <p className="text-[11px] uppercase tracking-wide text-on-surface-variant leading-none mb-1">Посещаемость</p>
                      <p className="font-label-md text-on-surface leading-none">
                        <strong className="text-primary text-base">{Math.round(user.attendance_pct)}%</strong>
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="bg-surface-container-lowest rounded-2xl p-stack-md sm:p-6 shadow-sm border border-outline-variant">
          <h3 className="font-headline-sm text-headline-sm text-on-background mb-stack-md">Данные аккаунта</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map(([label, value]) => (
              <div
                key={label}
                className="flex items-start gap-3 p-3.5 rounded-xl border border-outline-variant/60 bg-surface-container-low hover:bg-surface-container transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[18px]">{ACCOUNT_ICON[label] ?? "info"}</span>
                </div>
                <div className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-wide text-on-surface-variant mb-0.5">{label}</dt>
                  <dd className="font-body-lg text-on-background truncate">{value}</dd>
                </div>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </DashboardShell>
  );
}
