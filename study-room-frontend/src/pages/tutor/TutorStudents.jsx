import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import ProgressBar from "../../components/ui/ProgressBar.jsx";
import { currentTutor, tutorStudentsFull } from "../../data/mockData.js";

export default function TutorStudents() {
  return (
    <DashboardShell role="tutor" user={currentTutor} searchPlaceholder="Поиск ученика...">
      <div className="space-y-stack-md pb-stack-lg mt-4">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-background mb-1">Мои ученики</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Полная сводка по всем закреплённым ученикам и группам.
          </p>
        </div>

        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden overflow-x-auto">
          <table className="w-full text-left min-w-[820px]">
            <thead className="bg-surface-container-low text-on-surface-variant font-label-md">
              <tr>
                <th className="px-6 py-4 font-semibold">Ученик / группа</th>
                <th className="px-6 py-4 font-semibold">Предмет</th>
                <th className="px-6 py-4 font-semibold">Родитель</th>
                <th className="px-6 py-4 font-semibold">Прогресс</th>
                <th className="px-6 py-4 font-semibold">Посещаемость</th>
                <th className="px-6 py-4 font-semibold">Ср. балл</th>
                <th className="px-6 py-4 font-semibold">След. занятие</th>
                <th className="px-6 py-4 font-semibold">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {tutorStudentsFull.map((st) => (
                <tr key={st.id} className="hover:bg-surface-container-low transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center text-on-surface-variant font-bold shrink-0">
                        {st.initials}
                      </div>
                      <span className="font-bold text-on-surface">{st.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-on-surface-variant text-sm">{st.subject}</td>
                  <td className="px-6 py-4 text-on-surface-variant text-sm">{st.parent}</td>
                  <td className="px-6 py-4 w-40">
                    <ProgressBar value={st.progress} />
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-on-surface">{st.attendance}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-on-surface">{st.avgGrade}</td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">{st.nextLesson}</td>
                  <td className="px-6 py-4">
                    <StatusBadge status={st.contractStatus} color={st.contractStatus === "Активен" ? "green" : "amber"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
