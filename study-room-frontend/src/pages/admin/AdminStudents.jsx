import PeopleDirectory from "../shared/PeopleDirectory.jsx";

// Владелец сети (owner): видит учеников всех филиалов, доступны фильтры
// по предмету и по филиалу.
export default function AdminStudents() {
  return <PeopleDirectory role="owner" />;
}
