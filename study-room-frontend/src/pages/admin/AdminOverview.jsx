import { Link } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import { adminOverview } from "../../data/mockData.js";

export default function AdminOverview() {
  const { admin, stats, tutors, applications } = adminOverview;

  return (
    <DashboardShell role="admin" user={admin} searchPlaceholder="Поиск учеников или учителей...">
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-stack-md mb-stack-lg mt-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant flex items-center gap-4 hover:-translate-y-1 transition-transform"
          >
            <div className="w-12 h-12 bg-primary-container rounded-lg flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined">{s.icon}</span>
            </div>
            <div>
              <p className="text-on-surface-variant font-label-md text-label-md">{s.label}</p>
              <p className="text-headline-sm font-headline-sm text-primary">{s.value}</p>
            </div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-stack-lg pb-stack-lg">
        <section className="xl:col-span-2 flex flex-col gap-stack-md">
          <div className="flex justify-between items-end">
            <div>
              <h2 className="text-headline-sm font-headline-sm text-on-surface">Управление преподавателями</h2>
              <p className="text-on-surface-variant text-label-md font-label-md">Список активных репетиторов и их текущий статус</p>
            </div>
            <button className="bg-primary text-on-primary px-6 py-2 rounded-lg font-label-md text-label-md flex items-center gap-2 hover:bg-on-primary-fixed-variant transition-colors active:scale-95">
              <span className="material-symbols-outlined">person_add</span>
              Добавить учителя
            </button>
          </div>

          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden overflow-x-auto">
            <table className="w-full text-left min-w-[640px]">
              <thead className="bg-surface-container-low border-b border-outline-variant">
                <tr>
                  <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">ФИО Преподавателя</th>
                  <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Специализация</th>
                  <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Статус</th>
                  <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {tutors.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center font-bold text-primary">
                          {t.initials}
                        </div>
                        <div>
                          <p className="font-label-md text-label-md font-bold">{t.name}</p>
                          <p className="text-[12px] text-outline">ID: {t.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-label-md font-label-md">{t.specialty}</td>
                    <td className="px-6 py-4">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="text-outline hover:text-primary">
                        <span className="material-symbols-outlined">more_vert</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="flex flex-col gap-stack-lg">
          <div className="bg-primary p-6 rounded-2xl text-on-primary shadow-lg flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined">event_available</span>
              <h3 className="font-headline-sm text-headline-sm">Назначить урок</h3>
            </div>
            <p className="opacity-90 text-label-md font-label-md">Быстрое добавление занятия в расписание</p>
            <div className="flex flex-col gap-4 mt-2">
              <div>
                <label className="block text-[12px] font-bold text-white mb-1">Преподаватель</label>
                <select className="w-full bg-white text-black border-none rounded-lg p-3 text-label-md focus:ring-2 focus:ring-secondary-container appearance-none">
                  <option value="">Выберите учителя</option>
                  {tutors.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-bold text-white mb-1">Ученик</label>
                <select className="w-full bg-white text-black border-none rounded-lg p-3 text-label-md focus:ring-2 focus:ring-secondary-container appearance-none">
                  <option value="">Выберите ученика</option>
                  <option>Алексей К.</option>
                  <option>Мария С.</option>
                  <option>Иван П.</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[12px] font-bold text-white mb-1">Дата</label>
                  <input className="w-full bg-white text-black border-none rounded-lg p-3 text-label-md" type="date" />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-white mb-1">Время</label>
                  <input className="w-full bg-white text-black border-none rounded-lg p-3 text-label-md" type="time" />
                </div>
              </div>
              <button className="bg-secondary-container text-on-secondary-container py-4 rounded-lg font-bold hover:brightness-110 transition-all shadow-md active:scale-95 mt-2">
                Подтвердить
              </button>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-headline-sm text-headline-sm">Новые заявки</h3>
              <span className="bg-error text-white text-[10px] px-2 py-0.5 rounded-full">{applications.length} новых</span>
            </div>
            <div className="space-y-4">
              {applications.map((a) => (
                <div key={a.id} className="p-3 border border-outline-variant rounded-xl hover:bg-surface-container-low transition-colors cursor-pointer">
                  <div className="flex justify-between items-start mb-1">
                    <p className="font-bold text-label-md">{a.name} ({a.age} лет)</p>
                    <span className="text-[10px] text-outline">{a.timeAgo}</span>
                  </div>
                  <p className="text-[12px] text-on-surface-variant">Курс: {a.course}</p>
                  <p className="text-[10px] text-primary font-bold mt-1">Родитель: {a.parent}</p>
                </div>
              ))}
            </div>
            <button className="w-full mt-4 text-primary font-bold text-label-md border border-primary py-2 rounded-lg hover:bg-primary hover:text-white transition-all">
              Смотреть все заявки
            </button>
          </div>
        </aside>
      </div>
    </DashboardShell>
  );
}
