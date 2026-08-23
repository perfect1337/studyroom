import CoursesDirectory from "../shared/CoursesDirectory.jsx";

// Владелец сети (owner): курсы по всей сети филиалов, создание курса сразу
// для всех филиалов, удаление любого курса.
export default function AdminCourses() {
  return <CoursesDirectory role="owner" />;
}
