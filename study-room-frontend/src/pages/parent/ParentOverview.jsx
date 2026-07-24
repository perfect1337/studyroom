import { useState } from "react";
import { Link } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { currentParent } from "../../data/mockData.js";

export default function ParentOverview() {
  const p = currentParent;
  const [format, setFormat] = useState("group");
  const [notif, setNotif] = useState(p.notificationSettings);

  return (
    <DashboardShell role="parent" user={p} searchPlaceholder="Поиск..." userLabel={p.name} avatarUrl={p.avatarUrl}>
      <div className="space-y-stack-lg pb-stack-lg">
        <header className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant flex flex-col md:flex-row items-center md:items-start justify-between gap-6 mt-4">
          <div className="flex items-center gap-6 z-10">
            <img src={p.avatarUrl} alt={p.name} className="w-24 h-24 rounded-full object-cover border-4 border-surface shadow-sm" />
            <div>
              <h2 className="font-headline-md text-headline-md text-on-surface">{p.name}</h2>
              <p className="font-body-md text-body-md text-on-surface-variant">{p.email}</p>
              <p className="font-body-md text-body-md text-on-surface-variant opacity-70 mt-1">ID: {p.id}</p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
          <div className="space-y-stack-md lg:col-span-2">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Мои дети и курсы</h3>

            <div className="bg-surface-container-low border border-dashed border-primary rounded-xl p-6 flex flex-col items-center text-center cursor-pointer hover:bg-surface-container transition-colors group">
              <div className="w-12 h-12 rounded-full bg-primary-container text-primary flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined">add</span>
              </div>
              <h4 className="font-label-md text-label-md text-primary font-bold mb-2">Добавить ребёнка</h4>
              <p className="font-body-md text-body-md text-on-surface-variant text-sm max-w-md">
                При добавлении для ученика будет автоматически создан личный кабинет. Данные для входа будут отправлены на почту родителя.
              </p>
            </div>

            <div className="space-y-4">
              {p.children.map((child) => (
                <div key={child.id} className="bg-surface-container-lowest rounded-xl p-5 shadow-sm border border-outline-variant flex flex-col gap-5">
                  <div className="flex flex-col md:flex-row gap-5 items-start">
                    <img src={child.photoUrl} alt={child.name} className="w-16 h-16 rounded-lg object-cover shadow-sm" />
                    <div className="flex-1 w-full">
                      <div className="flex justify-between items-center w-full">
                        <h4 className="font-label-md text-label-md font-bold text-on-surface text-lg mb-1">{child.name}</h4>
                        <Link to={`/parent/children/${child.id}`} className="text-primary hover:bg-surface-container-low p-2 rounded-full transition-colors">
                          <span className="material-symbols-outlined">chevron_right</span>
                        </Link>
                      </div>
                      <div className="space-y-2 mt-3">
                        {child.courseTags.map((tag) => (
                          <div key={tag} className="flex items-center gap-3 bg-surface-container-lowest p-2 rounded border border-outline-variant">
                            <div className="w-8 h-8 rounded bg-surface-tint/10 flex items-center justify-center text-primary">
                              <span className="material-symbols-outlined text-sm">calculate</span>
                            </div>
                            <span className="font-body-md text-body-md text-sm text-on-surface-variant">{tag}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-outline-variant pt-4 mt-2">
                    <h5 className="font-label-md font-bold text-on-surface mb-3">Статистика</h5>
                    <div className="flex gap-6 mb-4">
                      <div>
                        <span className="text-on-surface-variant text-sm">Успеваемость:</span>
                        <span className="font-bold text-primary ml-1">{child.performancePct}%</span>
                      </div>
                      <div>
                        <span className="text-on-surface-variant text-sm">Посещаемость:</span>
                        <span className="font-bold text-primary ml-1">{child.attendancePct}%</span>
                      </div>
                    </div>
                    <h5 className="font-label-md font-bold text-on-surface mb-2">Преподаватели</h5>
                    <div className="space-y-2">
                      {child.teachers.map((t) => (
                        <div key={t.name} className="flex justify-between text-sm bg-surface-container-lowest p-2 rounded border border-outline-variant">
                          <span className="text-on-surface font-medium">{t.name}</span>
                          <span className="text-on-surface-variant">{t.subject}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant mt-8">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">event_upcoming</span>
                Предстоящие занятия
              </h3>
              <div className="space-y-3">
                {p.upcomingLessons.map((l) => (
                  <div key={l.id} className="flex justify-between items-center bg-surface-container-lowest border border-outline-variant p-3 rounded-lg">
                    <div>
                      <p className="font-label-md text-on-surface font-bold">{l.title}</p>
                      <p className="text-sm text-on-surface-variant flex items-center gap-1 mt-1">
                        <span className="material-symbols-outlined text-[16px]">schedule</span> {l.time}
                      </p>
                    </div>
                    <span className="material-symbols-outlined text-primary bg-primary-container/10 p-2 rounded-full">video_camera_front</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm border border-outline-variant mt-8">
              <h4 className="font-label-md text-label-md font-bold text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-outline">notifications</span>Настройка уведомлений
              </h4>
              <p className="text-sm text-on-surface-variant mb-3">Получать уведомления об окончании договора:</p>
              <div className="space-y-3">
                {[
                  { key: "email", label: "Почта" },
                  { key: "sms", label: "SMS" },
                  { key: "messenger", label: "Мессенджеры" },
                ].map((ch) => (
                  <label key={ch.key} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notif[ch.key]}
                      onChange={() => setNotif((n) => ({ ...n, [ch.key]: !n[ch.key] }))}
                      className="w-5 h-5 rounded text-primary focus:ring-primary border-outline-variant"
                    />
                    <span className="text-sm text-on-surface font-medium">{ch.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-stack-md">
            <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">payments</span>
                Договоры и Оплата
              </h3>
              <div className="space-y-4">
                {p.contracts.map((c) => (
                  <div key={c.id} className="p-4 rounded-lg bg-surface-container-low border border-outline-variant">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-label-md font-bold text-on-surface">Договор №{c.id}</span>
                      <span className="px-2 py-1 rounded bg-secondary-container/30 text-on-secondary-container text-[10px] font-bold uppercase">
                        {c.status}
                      </span>
                    </div>
                    <p className="text-sm text-on-surface-variant mb-3">{c.subject}</p>
                    <p className="text-[12px] text-on-surface-variant mb-3 opacity-70">Срок: {c.period}</p>
                    <div className="flex justify-between items-center">
                      <span className="text-headline-sm font-bold text-on-surface">{c.amount}</span>
                      <button className="bg-primary text-on-primary px-4 py-2 rounded-lg font-label-md text-label-md hover:bg-primary-container transition-colors">
                        Оплатить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant">
              <h3 className="font-headline-sm text-headline-sm text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">add_task</span>
                Записаться на новый курс
              </h3>
              <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                <div>
                  <label className="block font-label-md text-label-md text-on-surface mb-2">Выберите ребёнка</label>
                  <select className="w-full rounded-lg border-outline-variant bg-surface-container-lowest text-on-surface focus:ring-primary">
                    {p.children.map((c) => (
                      <option key={c.id}>{c.name}</option>
                    ))}
                    <option>Добавить нового ребёнка...</option>
                  </select>
                </div>
                <div>
                  <label className="block font-label-md text-label-md text-on-surface mb-2">Предмет</label>
                  <select className="w-full rounded-lg border-outline-variant bg-surface-container-lowest text-on-surface focus:ring-primary">
                    <option>Физика</option>
                    <option>Информатика</option>
                    <option>Русский язык</option>
                    <option>История</option>
                  </select>
                </div>
                <div>
                  <label className="block font-label-md text-label-md text-on-surface mb-2">Формат обучения</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormat("group")}
                      className={`p-2 border rounded-lg text-sm font-medium ${
                        format === "group" ? "border-primary bg-primary-container/10 text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
                      }`}
                    >
                      Группа
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormat("individual")}
                      className={`p-2 border rounded-lg text-sm font-medium ${
                        format === "individual" ? "border-primary bg-primary-container/10 text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
                      }`}
                    >
                      Индивидуально
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-label-md text-label-md hover:bg-primary-container transition-all mt-2"
                >
                  Отправить заявку
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
