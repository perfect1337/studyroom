/**
 * CourseTag — маленький бейдж "курс · предмет", которым помечаем тест
 * (или любую другую сущность) курсом, по которому он выдан. Используется
 * в списках тестов у всех ролей (StudentTests, TutorTests, ParentOverview,
 * StudentGrades, admin/StudentDetail, admin/TeacherDetail, PeopleDirectory),
 * чтобы не дублировать разметку.
 *
 * Принимает либо готовый объект теста/сущности с course_title/course_subject,
 * либо эти поля напрямую.
 */
export default function CourseTag({ title, subject, className = "" }) {
  if (!title && !subject) {
    return <span className={`text-on-surface-variant text-sm ${className}`}>—</span>;
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-tertiary-fixed text-on-tertiary-fixed text-xs font-label-md font-medium max-w-full ${className}`}
      title={[title, subject].filter(Boolean).join(" · ")}
    >
      <span className="material-symbols-outlined text-[14px] shrink-0">menu_book</span>
      <span className="truncate">
        {title || "Без курса"}
        {subject && <span className="opacity-75"> · {subject}</span>}
      </span>
    </span>
  );
}
