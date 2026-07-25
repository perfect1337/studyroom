import TeachersDirectory from "./TeachersDirectory.jsx";

// Управляющий филиалом (branch_owner): видит только учителей своего филиала
// (сервер сам ограничивает выборку) и не может добавлять новых учителей.
export default function BranchTeachers() {
  return <TeachersDirectory role="branch_owner" />;
}
