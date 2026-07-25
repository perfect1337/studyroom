import StudentDetail from "./StudentDetail.jsx";

// Управляющий филиалом (branch_owner): карточка ученика своего филиала
// (доступ проверяется на бэкенде по branch_id из JWT).
export default function BranchStudentDetail() {
  return <StudentDetail role="branch_owner" />;
}
