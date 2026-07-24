import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import { adminFinance, adminOverview } from "../../data/mockData.js";

export default function AdminFinance() {
  const { totalRevenue, overdueCount, contracts, invoices } = adminFinance;

  return (
    <DashboardShell
      role="admin"
      user={adminOverview.admin}
      searchPlaceholder="Поиск по транзакциям..."
      userLabel="Алексей Иванов"
    >
      <div className="mt-4 pb-stack-lg">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary mb-1">Финансовый обзор</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Управление доходами, контрактами и счетами учебного центра.
            </p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary text-primary font-label-md text-label-md hover:bg-primary hover:text-on-primary transition-colors">
            <span className="material-symbols-outlined">download</span>
            Экспорт
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl text-primary">account_balance_wallet</span>
            </div>
            <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-2">Общая выручка</p>
            <h3 className="font-display-lg text-display-lg text-on-surface">{totalRevenue}</h3>
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl text-error">warning</span>
            </div>
            <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-2">Просрочено</p>
            <div className="flex items-center gap-2 mt-4 text-error font-bold">
              <span className="material-symbols-outlined">priority_high</span>
              <span className="text-sm">{overdueCount} контрактов требуют внимания</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Действующие контракты */}
          <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high overflow-hidden">
            <div className="p-6 border-b border-surface-container-high flex justify-between items-center">
              <h4 className="font-headline-sm text-headline-sm text-on-surface">Действующие контракты</h4>
              <button className="text-primary font-label-md text-label-md hover:underline">Все контракты</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low/50">
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">
                      Студент / Родитель
                    </th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">
                      Период
                    </th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">
                      Сумма
                    </th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high">
                      Статус
                    </th>
                    <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant border-b border-surface-container-high text-center">
                      Действие
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-high">
                  {contracts.map((c) => (
                    <tr key={c.student} className="hover:bg-surface-container-low/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-label-md text-label-md font-bold text-on-surface">{c.student}</div>
                        <div className="text-xs text-on-surface-variant">{c.parent}</div>
                      </td>
                      <td className="px-6 py-4 font-body-md text-body-md text-on-surface-variant">{c.period}</td>
                      <td className="px-6 py-4 font-body-md text-body-md font-semibold text-on-surface">{c.amount}</td>
                      <td className="px-6 py-4">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button className="text-on-surface-variant hover:text-primary transition-colors">
                          <span className="material-symbols-outlined">more_vert</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Последние счета */}
          <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-surface-container-high flex flex-col h-full">
            <div className="p-6 border-b border-surface-container-high flex justify-between items-center">
              <h4 className="font-headline-sm text-headline-sm text-on-surface">Последние счета</h4>
              <button className="text-primary font-label-md text-label-md hover:underline">Подробнее</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {invoices.map((inv) => (
                <div
                  key={inv.number}
                  className="p-4 rounded-xl border border-surface-container-high hover:border-primary-fixed transition-all group"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span className="font-label-md text-label-md font-bold text-on-surface">{inv.number}</span>
                      <p className="text-xs text-on-surface-variant">{inv.date}</p>
                    </div>
                    <span className="text-primary font-bold text-sm">{inv.amount}</span>
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center text-primary">
                      <span className="material-symbols-outlined text-sm">person</span>
                    </div>
                    <span className="text-sm font-medium">{inv.client}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button className="flex items-center justify-center gap-1 py-1.5 rounded bg-surface-container-low text-on-surface-variant font-label-md text-xs hover:bg-primary-container hover:text-on-primary-container transition-colors">
                      <span className="material-symbols-outlined text-sm">download</span>
                      Скачать
                    </button>
                    <button className="flex items-center justify-center gap-1 py-1.5 rounded bg-surface-container-low text-on-surface-variant font-label-md text-xs hover:bg-secondary-container hover:text-on-secondary-container transition-colors">
                      <span className="material-symbols-outlined text-sm">send</span>
                      Послать
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-surface-container-high">
              <button className="w-full text-center py-2 text-on-surface-variant font-label-md text-sm hover:text-primary transition-colors">
                Показать все счета
              </button>
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
