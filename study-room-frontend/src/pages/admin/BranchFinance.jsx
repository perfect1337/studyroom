import FinanceDirectory from "../shared/FinanceDirectory.jsx";

// Руководитель филиала (branch_owner): тот же функционал по финансам, что и
// у owner (просмотр, создание и редактирование договоров, статус оплаты),
// но ограниченный собственным филиалом — сервер сам подставляет и проверяет
// branch_id (см. FinanceDirectory.jsx и contracts-service/ContractHandler).
export default function BranchFinance() {
  return <FinanceDirectory role="branch_owner" />;
}
