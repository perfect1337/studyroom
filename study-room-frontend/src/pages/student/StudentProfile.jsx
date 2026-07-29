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

  const fields = [
    ["Email", user?.email],
    ["Телефон", user?.phone || "Не указан"],
    ["Роль", "Ученик"],
    ["Класс", user?.class_info || "Не указан"],
    ["Школа", user?.school || "Не указана"],
    ["Статус аккаунта", user?.is_active === false ? "Деактивирован" : "Активен"],
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
      <div className="max-w-[700px] mx-auto py-stack-lg space-y-stack-lg">
        <section className="bg-surface-container-lowest rounded-xl p-stack-lg shadow-sm border border-outline-variant flex flex-col md:flex-row items-center gap-6">
          <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-surface-container-highest shadow-sm bg-primary-fixed flex items-center justify-center text-primary font-bold text-3xl shrink-0">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt={fullName(user)} className="w-full h-full object-cover" />
            ) : (
              initials(user)
            )}
          </div>
          <div className="text-center md:text-left flex-1">
            <h2 className="font-headline-md text-headline-md text-on-background">{fullName(user)}</h2>
            {showAcademicStats && (
              <div className="flex flex-wrap justify-center md:justify-start gap-4 mt-2">
                {avgGrade != null && (
                  <Link
                    to="/student/grades"
                    className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg hover:bg-surface-container-high transition-colors"
                  >
                    <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>grade</span>
                    <span className="font-label-md text-on-surface">
                      Средний балл: <strong className="text-primary">{avgGrade.toFixed(1)}</strong>
                      {gradedTests.length > 0 && (
                        <span className="text-on-surface-variant"> ({gradedTests.length} {gradedTests.length === 1 ? "тест" : "тестов"})</span>
                      )}
                    </span>
                  </Link>
                )}
                {user?.attendance_pct != null && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg">
                    <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>event_available</span>
                    <span className="font-label-md text-on-surface">
                      Посещаемость: <strong className="text-primary">{Math.round(user.attendance_pct)}%</strong>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          <Link
            to="/student/settings"
            className="inline-flex items-center gap-2 bg-primary text-on-primary px-5 py-2.5 rounded-lg font-label-md shadow-sm hover:translate-y-[-1px] active:scale-95 transition-all shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
            Редактировать
          </Link>
        </section>

        <section className="bg-surface-container-lowest rounded-xl p-stack-md shadow-sm border border-outline-variant">
          <h3 className="font-headline-sm text-headline-sm text-on-background mb-stack-md">Данные аккаунта</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-stack-md">
            {fields.map(([label, value]) => (
              <div key={label} className="space-y-1">
                <dt className="text-xs uppercase tracking-wide text-on-surface-variant">{label}</dt>
                <dd className="font-body-lg text-on-background">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </DashboardShell>
  );
}
