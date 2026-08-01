import TeachersDirectory from "./TeachersDirectory.jsx";

// Управляющий филиалом (branch_owner): видит только учителей своего филиала
// (сервер сам ограничивает выборку) и может добавлять новых учителей — но
// только в свой собственный филиал (см. TeachersDirectory.jsx).
export default function BranchTeachers() {
  return <TeachersDirectory role="branch_owner" />;
}
