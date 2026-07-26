import ScheduleDirectory from "./ScheduleDirectory.jsx";

// Владелец сети (owner): видит расписание по всей сети филиалов,
// доступны фильтры по филиалу, преподавателю и ученику.
export default function AdminSchedule() {
  return <ScheduleDirectory role="owner" />;
}
