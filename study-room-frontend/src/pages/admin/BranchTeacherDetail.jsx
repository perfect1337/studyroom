import TeacherDetail from "./TeacherDetail.jsx";

// Управляющий филиалом (branch_owner): карточка преподавателя своего филиала
// (доступ проверяется на бэкенде по branch_id из JWT). Увольнение недоступно —
// эта роль может менять только active|vacation|sick_leave.
export default function BranchTeacherDetail() {
  return <TeacherDetail role="branch_owner" />;
}
