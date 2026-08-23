import ScheduleDirectory from "./ScheduleDirectory.jsx";

// Управляющий филиалом (branch_owner): видит расписание только своего филиала
// (сервер сам ограничивает выборку), фильтра по филиалу нет — только
// по преподавателю и ученику.
export default function BranchSchedule() {
  return <ScheduleDirectory role="branch_owner" />;
}
