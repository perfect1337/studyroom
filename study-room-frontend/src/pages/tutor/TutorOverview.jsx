import { Link } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { currentTutor } from "../../data/mockData.js";

export default function TutorOverview() {
  const t = currentTutor;

  return (
    <DashboardShell role="tutor" user={t} searchPlaceholder="Поиск..." userLabel={t.name} avatarUrl={t.avatarUrl}>
      <div className="mb-stack-lg mt-4">
        <h1 className="font-headline-md text-headline-md text-on-background mb-2">Панель управления репетитора</h1>
        <p className="font-body-lg text-body-lg text-on-surface-variant">Добро пожаловать, {t.name.split(" ")[0]}. Вот сводка вашей активности.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-stack-lg pb-stack-lg">
        <section className="lg:col-span-2 bg-surface-container-lowest rounded-xl p-6 shadow-[0px_10px_30px_rgba(0,0,0,0.05)]">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-headline-sm text-headline-sm text-on-background flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">calendar_month</span>
              Расписание на сегодня
            </h2>
            <Link to="/tutor/schedule" className="text-primary font-label-md text-label-md hover:underline">
              Весь календарь
            </Link>
          </div>

          <div className="flex flex-col gap-4">
            {t.todaySchedule.map((lesson) => (
              <div
                key={lesson.id}
                className={`flex flex-col sm:flex-row rounded-lg border border-outline-variant p-4 gap-4 items-start sm:items-center relative overflow-hidden ${
                  lesson.isPast ? "bg-surface-container-low opacity-80" : "bg-surface hover:shadow-md transition-shadow"
                }`}
              >
                {lesson.isLast && (
                  <div className="absolute top-0 right-0 bg-tertiary-container text-on-tertiary-container px-3 py-1 rounded-bl-lg font-label-md text-[10px] font-bold uppercase tracking-wider">
                    Последнее занятие
                  </div>
                )}
                <div className="flex flex-col min-w-[120px]">
                  <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">{lesson.time}</span>
                  <span className="font-label-md text-label-md text-on-surface-variant">{lesson.endTime}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="bg-primary-container text-on-primary-container px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">
                      {lesson.subject}
                    </span>
                    <span className="bg-surface-variant text-on-surface-variant px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">
                      {lesson.statusTag}
                    </span>
                  </div>
                  <h3 className="font-body-lg text-body-lg text-on-surface font-medium">{lesson.title}</h3>
                  {lesson.participants && (
                    <p className="font-label-md text-label-md text-on-surface-variant mt-1">{lesson.participants}</p>
                  )}
                  {lesson.isPast && (
                    <div className="mt-2 flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-error font-medium text-label-md">
                        <span className="material-symbols-outlined text-body-md">person_off</span>
                        Отсутствовал: {lesson.absentStudent}
                      </div>
                      <div className="text-label-md text-on-surface-variant italic">Причина отсутствия: {lesson.absentReason}</div>
                    </div>
                  )}
                </div>
                <div>
                  {lesson.isPast ? (
                    <button className="text-primary font-label-md text-label-md hover:underline">Отчёт</button>
                  ) : (
                    <button className="border border-primary text-primary px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-surface-container transition-colors">
                      Детали
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="flex flex-col gap-stack-lg">
          <section className="bg-surface-container-lowest rounded-xl p-6 shadow-[0px_10px_30px_rgba(0,0,0,0.05)]">
            <h2 className="font-headline-sm text-headline-sm text-on-background flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-primary">person_search</span>
              Мои ученики
            </h2>
            <div className="flex flex-col gap-3">
              {t.students.map((st) => (
                <div key={st.id} className="flex items-center gap-3 p-2 hover:bg-surface-container rounded-lg cursor-pointer transition-colors">
                  <div className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center text-on-surface-variant font-bold">
                    {st.initials}
                  </div>
                  <div className="flex-1">
                    <div className="font-body-md text-body-md font-medium text-on-surface">{st.name}</div>
                    <div className="font-label-md text-label-md text-on-surface-variant">{st.subject}</div>
                  </div>
                  <div className="w-12 bg-surface-container-high rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${st.progress >= 60 ? "bg-primary" : "bg-secondary-container"}`}
                      style={{ width: `${st.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <Link to="/tutor/students" className="mt-4 w-full block text-center text-primary font-label-md text-label-md hover:underline">
              Все ученики
            </Link>
          </section>

          <section className="bg-surface-container-lowest rounded-xl p-6 shadow-[0px_10px_30px_rgba(0,0,0,0.05)] flex-1">
            <h2 className="font-headline-sm text-headline-sm text-on-background flex items-center gap-2 mb-6">
              <span className="material-symbols-outlined text-primary">school</span>
              Управление обучением
            </h2>
            <div className="flex flex-col gap-6">
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-2">Назначить тему урока</label>
                <div className="relative">
                  <select className="w-full bg-surface border border-outline-variant rounded-lg p-3 appearance-none focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-md text-body-md text-on-surface transition-all shadow-sm">
                    <option>Выберите ученика/группу</option>
                    <option>Группа 10-А (Математика)</option>
                    <option>Анна Смирнова (Физика)</option>
                  </select>
                  <span className="material-symbols-outlined absolute right-3 top-3 text-on-surface-variant pointer-events-none">
                    expand_more
                  </span>
                </div>
                <input
                  className="mt-2 w-full bg-surface border border-outline-variant rounded-lg p-3 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-md text-body-md text-on-surface transition-all shadow-sm"
                  placeholder="Введите тему..."
                  type="text"
                />
              </div>
              <div className="border-t border-outline-variant pt-6">
                <h3 className="font-label-md text-label-md text-on-surface-variant mb-3">Выдать задание</h3>
                <button className="w-full border-2 border-dashed border-primary-fixed-dim bg-surface-container-low text-primary hover:bg-surface-container hover:border-primary py-4 rounded-lg flex flex-col items-center justify-center gap-2 transition-all group">
                  <span className="material-symbols-outlined text-3xl group-hover:scale-110 transition-transform">upload_file</span>
                  <span className="font-label-md text-label-md font-medium">Загрузить файл задания</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}
