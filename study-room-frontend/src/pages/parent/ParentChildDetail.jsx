import StudentDetail from "../admin/StudentDetail.jsx";

// Родитель: карточка своего ребёнка (доступ проверяется на бэкенде через parent_student).
export default function ParentChildDetail() {
  return <StudentDetail role="parent" />;
}
