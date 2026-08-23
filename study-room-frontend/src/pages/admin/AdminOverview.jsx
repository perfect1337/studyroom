import OverviewDirectory from "../shared/OverviewDirectory.jsx";

// Владелец сети (owner): сводка по всей сети филиалов, новые заявки CRM,
// список преподавателей.
export default function AdminOverview() {
  return <OverviewDirectory role="owner" />;
}
