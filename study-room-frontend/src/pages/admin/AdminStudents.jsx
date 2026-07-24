import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { adminStudentsPage } from "../../data/mockData.js";

const STATUS_STYLES = {
  green: { badge: "bg-green-100 text-green-700", dot: "bg-green-500" },
  amber: { badge: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  red: { badge: "bg-red-100 text-red-700", dot: "bg-red-500" },
};

export default function AdminStudents() {
  const { stats, students, teachers } = adminStudentsPage;

  return (
    <DashboardShell role="admin" user={{ name: "Администратор" }} searchPlaceholder="Поиск студентов или учителей...">
      <div className="space-y-10 pb-10 mt-4">
        <div className="flex justify-between items-end">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary mb-2">Академический состав</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">Управление всеми участниками образовательного процесса</p>
          </div>
          <button className="flex items-center gap-2 px-6 py-3 bg-secondary-container text-on-secondary-container rounded-lg font-label-md text-label-md shadow-md hover:translate-y-[-2px] transition-all">
            <span className="material-symbols-outlined">school</span>
            Добавить учителя
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {stats.map((s) => (
            <div key={s.label} className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30">
              <p className="text-label-md text-on-surface-variant mb-1">{s.label}</p>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold text-primary">{s.value}</span>
                {s.trend && <span className="text-green-600 font-bold flex items-center text-sm mb-1">{s.trend}</span>}
                {s.stars && (
                  <div className="flex mb-1.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span
                        key={i}
                        className="material-symbols-outlined text-secondary text-sm"
                        style={i < s.stars ? { fontVariationSettings: "'FILL' 1" } : undefined}
                      >
                        star
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Список учеников</h3>
            <select className="bg-surface border-outline-variant rounded-lg text-label-md px-4 py-2 outline-none focus:border-primary">
              <option>Все курсы</option>
              <option>Математика</option>
              <option>Программирование</option>
              <option>История</option>
            </select>
          </div>
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] overflow-hidden border border-outline-variant/30 overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-md">
                  <th className="px-6 py-4 font-semibold">Ученик</th>
                  <th className="px-6 py-4 font-semibold">Курсы</th>
                  <th className="px-6 py-4 font-semibold">Срок контракта</th>
                  <th className="px-6 py-4 font-semibold">Посещаемость</th>
                  <th className="px-6 py-4 font-semibold">Ср. балл</th>
                  <th className="px-6 py-4 font-semibold">Статус</th>
                  <th className="px-6 py-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {students.map((st) => (
                  <tr key={st.id} className="hover:bg-surface-container-low transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center text-primary font-bold">
                          {st.initials}
                        </div>
                        <div>
                          <div className="font-bold text-on-surface">{st.name}</div>
                          <div className="text-[12px] text-on-surface-variant">ID: {st.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {st.courses.map((c) => (
                          <span key={c} className="px-2 py-1 bg-surface-variant rounded text-[11px] font-bold text-primary">
                            {c}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4"><div className="text-[13px] text-on-surface">{st.contractPeriod}</div></td>
                    <td className="px-6 py-4"><div className="text-[13px] font-semibold text-on-surface">{st.attendance}</div></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <span className="font-bold text-on-surface">{st.avgGrade}</span>
                        <span className="material-symbols-outlined text-secondary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                          star
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${
                          st.status === "Активен" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {st.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="material-symbols-outlined text-on-surface-variant cursor-pointer hover:bg-surface-container-highest rounded-full p-1">
                        more_vert
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Наши преподаватели</h3>
            <button className="text-primary font-bold font-label-md flex items-center gap-1 hover:underline">
              Смотреть всех <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {teachers.map((t) => {
              const style = STATUS_STYLES[t.statusColor];
              return (
                <div
                  key={t.id}
                  className="bg-surface-container-lowest p-6 rounded-2xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 flex flex-col gap-4 group hover:border-primary/30 transition-all"
                >
                  <div className="flex justify-between items-start">
                    <div className="relative">
                      <img src={t.avatarUrl} alt={t.name} className="w-16 h-16 rounded-xl object-cover" />
                      <div className={`absolute -bottom-1 -right-1 w-4 h-4 ${style.dot} border-2 border-white rounded-full`} />
                    </div>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${style.badge}`}>
                      {t.status}
                    </span>
                  </div>
                  <div>
                    <h4 className="font-bold text-body-lg text-on-surface">{t.name}</h4>
                    <p className="text-label-md text-primary font-semibold">{t.specialty}</p>
                  </div>
                  <div className="flex justify-between items-center py-3 border-y border-outline-variant/20">
                    <div className="text-center">
                      <p className="text-[10px] text-outline uppercase font-bold">Студенты</p>
                      <p className="font-bold text-on-surface">{t.students}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-outline uppercase font-bold">Опыт</p>
                      <p className="font-bold text-on-surface">{t.experience}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-outline uppercase font-bold">Рейтинг</p>
                      <p className="font-bold text-on-surface flex items-center justify-center gap-0.5">
                        {t.rating}
                        <span className="material-symbols-outlined text-[12px] text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>
                          star
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="flex-1 py-2 bg-surface-variant text-on-surface-variant rounded-lg font-bold text-[12px] hover:bg-primary-container hover:text-on-primary-container transition-all">
                      Профиль
                    </button>
                    <button className="px-3 py-2 bg-surface-variant text-on-surface-variant rounded-lg transition-all hover:bg-surface-container-highest">
                      <span className="material-symbols-outlined text-sm">mail</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
