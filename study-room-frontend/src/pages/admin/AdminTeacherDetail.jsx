import TeacherDetail from "./TeacherDetail.jsx";

// Владелец сети (owner): карточка любого преподавателя сети — полный доступ,
// включая смену статуса и увольнение (is_active=false).
export default function AdminTeacherDetail() {
  return <TeacherDetail role="owner" />;
}
