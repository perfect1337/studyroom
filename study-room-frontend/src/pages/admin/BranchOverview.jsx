import OverviewDirectory from "../shared/OverviewDirectory.jsx";

// Руководитель филиала (branch_owner): тот же функционал обзора, что и у
// owner (выручка, новые заявки, преподаватели), но в рамках своего филиала —
// сервер сам ограничивает данные по branch_id из JWT.
export default function BranchOverview() {
  return <OverviewDirectory role="branch_owner" />;
}
