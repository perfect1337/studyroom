import PeopleDirectory from "../shared/PeopleDirectory.jsx";

// Управляющий филиалом (branch_owner): видит только учеников своего филиала
// (сервер сам ограничивает выборку), доступен только фильтр по предмету.
export default function BranchStudents() {
  return <PeopleDirectory role="branch_owner" />;
}
