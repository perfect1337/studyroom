import TeachersDirectory from "./TeachersDirectory.jsx";

// Владелец сети (owner): видит учителей всех филиалов, может выбрать конкретный
// филиал для просмотра и добавить нового преподавателя.
export default function AdminTeachers() {
  return <TeachersDirectory role="owner" />;
}
