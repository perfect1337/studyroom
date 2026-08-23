import FinanceDirectory from "../shared/FinanceDirectory.jsx";

// Владелец сети (owner): финансы по всей сети филиалов — выбор филиала
// при создании договора, полный список договоров сети.
export default function AdminFinance() {
  return <FinanceDirectory role="owner" />;
}
