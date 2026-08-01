import CoursesDirectory from "../shared/CoursesDirectory.jsx";

// Руководитель филиала (branch_owner): тот же функционал по курсам, что и у
// owner (создание, удаление), но ограниченный собственным филиалом — сервер
// сам подставляет и проверяет branch_id (см. CoursesDirectory.jsx и
// academic-service/CourseHandler).
export default function BranchCourses() {
  return <CoursesDirectory role="branch_owner" />;
}
