import StudentDetail from "../admin/StudentDetail.jsx";

// Репетитор: карточка ученика своего филиала (доступ проверяется на бэкенде по branch_id).
export default function TutorStudentDetail() {
  return <StudentDetail role="tutor" />;
}
