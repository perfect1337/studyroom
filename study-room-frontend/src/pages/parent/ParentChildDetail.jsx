import { Link, useParams } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { currentParent } from "../../data/mockData.js";

const STATUS_TEXT_COLOR = {
  orange: "text-orange-600",
  green: "text-green-600",
  error: "text-error",
};
const STATUS_DOT_COLOR = {
  orange: "bg-orange-600",
  green: "bg-green-600",
  error: "bg-error",
};

export default function ParentChildDetail() {
  const { childId } = useParams();
  const p = currentParent;
  const child = p.children.find((c) => c.id === childId) ?? p.children[0];

  return (
    <DashboardShell role="parent" user={p} searchPlaceholder="Поиск по кабинету..." userLabel={p.name} avatarUrl={p.avatarUrl}>
      <div className="space-y-stack-lg pb-stack-lg">
        <nav className="flex items-center gap-2 text-label-md text-on-surface-variant mt-4">
          <Link to="/parent" className="hover:text-primary">Главная</Link>
          <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          <Link to="/parent/children" className="hover:text-primary">Мои дети</Link>
          <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          <span className="text-on-surface font-bold">{child.name}</span>
        </nav>

        <div className="bg-surface-container-lowest p-stack-lg rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30">
          <div className="flex flex-col md:flex-row items-center gap-gutter">
            <div className="relative">
              <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-primary/10">
                <img src={child.photoUrl} alt={child.name} className="w-full h-full object-cover" />
              </div>
              <div className="absolute bottom-0 right-0 bg-primary text-white p-1 rounded-full border-2 border-white">
                <span className="material-symbols-outlined text-[18px]">verified</span>
              </div>
            </div>
            <div className="flex-1 text-center md:text-left">
              <div className="flex flex-col md:flex-row md:items-end gap-2 mb-1">
                <h2 className="font-headline-md text-headline-md text-on-surface">{child.name}</h2>
                <span className="text-on-surface-variant font-label-md mb-1.5 opacity-60">ID: {child.id}</span>
              </div>
              <p className="text-on-surface-variant font-body-md mb-4">{child.classInfo}</p>
              <div className="flex flex-wrap justify-center md:justify-start gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg">
                  <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                    star
                  </span>
                  <span className="font-label-md text-on-surface">
                    Успеваемость: <strong className="text-primary">{child.performance}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg">
                  <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                    calendar_month
                  </span>
                  <span className="font-label-md text-on-surface">
                    Посещаемость: <strong className="text-primary">{child.attendance}</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-gutter">
          <section className="col-span-12 lg:col-span-8 space-y-stack-md">
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Курсы ребёнка</h3>
              <a className="text-primary font-label-md hover:underline" href="#">Все курсы</a>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md">
              {child.courses.map((course) => (
                <div
                  key={course.id}
                  className="bg-surface-container-lowest p-stack-md rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 flex flex-col justify-between group hover:border-primary/50 transition-colors cursor-pointer"
                >
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <div className="p-2 bg-primary/10 text-primary rounded-lg">
                        <span className="material-symbols-outlined">{course.icon}</span>
                      </div>
                      <span className="bg-green-100 text-green-700 text-[12px] font-bold px-2 py-0.5 rounded-full uppercase">
                        {course.status}
                      </span>
                    </div>
                    <h4 className="font-headline-sm text-[20px] mb-1">{course.title}</h4>
                    <p className="text-on-surface-variant text-label-md mb-4">Преподаватель: {course.teacher}</p>
                    <div className="w-full bg-surface-container-high h-2 rounded-full mb-2">
                      <div className="bg-primary h-2 rounded-full" style={{ width: `${course.progress}%` }} />
                    </div>
                    <div className="flex justify-between text-[12px] text-on-surface-variant font-bold mb-4">
                      <span>ПРОГРЕСС</span>
                      <span>{course.progress}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-stack-lg">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-stack-md">Домашние задания</h3>
              <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-surface-container text-on-surface-variant text-label-md font-bold uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-4">Предмет</th>
                      <th className="px-6 py-4">Задание</th>
                      <th className="px-6 py-4">Статус</th>
                      <th className="px-6 py-4 text-right">Срок сдачи</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {child.homeworkTable.map((hw, idx) => (
                      <tr key={idx} className="hover:bg-surface-container-low transition-colors">
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div className="p-1.5 bg-primary/10 text-primary rounded">
                              <span className="material-symbols-outlined text-[18px]">{hw.icon}</span>
                            </div>
                            <span className="font-label-md text-on-surface">{hw.subject}</span>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <p className="font-label-md text-on-surface max-w-xs truncate">{hw.title}</p>
                        </td>
                        <td className="px-6 py-5">
                          <span className={`flex items-center gap-1.5 font-bold text-[13px] ${STATUS_TEXT_COLOR[hw.statusColor]}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT_COLOR[hw.statusColor]}`} />
                            {hw.status}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-right font-bold text-on-surface-variant text-label-md">{hw.due}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <aside className="col-span-12 lg:col-span-4 space-y-stack-lg">
            <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30 p-4">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-bold text-on-surface">{child.calendarMonth}</h4>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-on-surface-variant font-bold text-[11px] mb-1">
                {["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"].map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {child.calendarDays.map((d, idx) => (
                  <div
                    key={idx}
                    className={`text-label-md py-1 rounded-lg relative flex justify-center items-center cursor-pointer ${
                      d.muted
                        ? "text-outline-variant"
                        : d.active
                        ? "font-bold bg-primary text-white"
                        : "text-on-surface hover:bg-primary/10"
                    }`}
                  >
                    {d.day}
                    {d.dot && (
                      <span
                        className={`absolute bottom-1 w-1 h-1 rounded-full ${
                          d.dot === "primary" ? "bg-primary" : "bg-secondary-container"
                        }`}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-outline-variant space-y-3">
                {child.dailySchedule.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold ${
                        item.accent === "primary" ? "bg-primary/10 text-primary" : "bg-secondary-container/20 text-on-secondary-container"
                      }`}
                    >
                      {item.date}
                    </div>
                    <div className="flex-1">
                      <p className="text-label-md font-bold leading-tight">{item.title}</p>
                      <p className="text-[12px] text-on-surface-variant">{item.location}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>

        <footer className="pt-6 text-center border-t border-outline-variant/30 text-on-surface-variant text-[13px] opacity-60">
          © 2026 Study Room Education Portal. Все права защищены.
        </footer>
      </div>
    </DashboardShell>
  );
}
