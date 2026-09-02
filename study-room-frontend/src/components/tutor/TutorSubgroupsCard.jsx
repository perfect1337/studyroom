import { useMemo } from "react";
import { fullName } from "../../utils/userDisplay.js";

function isoDate(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function formatDate(value) {
  const iso = isoDate(value);
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU");
}

function lessonBelongsToSubgroup(lesson, subgroup) {
  if (!lesson || !subgroup || Number(lesson.course_id) !== Number(subgroup.course_id) || Number(lesson.tutor_id) !== Number(subgroup.tutor_id)) {
    return false;
  }
  if (lesson.group_type && lesson.group_type !== "group") return false;
  const subgroupIds = [...new Set((subgroup.student_ids ?? []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const lessonIds = [...new Set((lesson.participant_ids ?? []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!subgroupIds.length || subgroupIds.length !== lessonIds.length) return false;
  return subgroupIds.every((id, index) => id === lessonIds[index]);
}

export default function TutorSubgroupsCard({ subgroups = [], lessons = [], courses = [], students = [], title = "Подгруппы преподавателя" }) {
  const studentsById = useMemo(() => Object.fromEntries(students.map((student) => [student.id, student])), [students]);
  const coursesById = useMemo(() => Object.fromEntries(courses.map((course) => [course.id, course])), [courses]);

  const items = useMemo(() => {
    const today = isoDate(new Date());
    return subgroups.map((subgroup) => {
      const subgroupLessons = lessons
        .filter((lesson) => lesson.status !== "cancelled" && lessonBelongsToSubgroup(lesson, subgroup))
        .sort((a, b) => `${isoDate(a.lesson_date)}${a.start_time ?? ""}`.localeCompare(`${isoDate(b.lesson_date)}${b.start_time ?? ""}`));
      if (!subgroupLessons.length) return null;

      const upcoming = subgroupLessons.find((lesson) => isoDate(lesson.lesson_date) >= today && lesson.status === "scheduled");
      const completed = subgroupLessons.filter((lesson) => lesson.status === "completed" || isoDate(lesson.lesson_date) < today);
      return {
        subgroup,
        course: coursesById[subgroup.course_id],
        lessons: subgroupLessons,
        upcoming,
        completed,
        studentNames: (subgroup.student_ids ?? []).map((id) => {
          const student = studentsById[id];
          return student ? fullName(student) : `Ученик #${id}`;
        }),
      };
    }).filter(Boolean).sort((a, b) => a.subgroup.name.localeCompare(b.subgroup.name, "ru"));
  }, [subgroups, lessons, coursesById, studentsById]);

  return (
    <section className="bg-surface-container-lowest rounded-xl p-stack-md shadow-[0_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant/30">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-headline-sm text-[20px] text-on-surface">{title}</h3>
          <p className="text-xs text-on-surface-variant mt-1">Показываются только рабочие подгруппы, у которых есть активные или уже прошедшие занятия.</p>
        </div>
        <span className="inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-full bg-primary/10 text-primary text-sm font-bold">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg bg-surface-container-low p-4 text-sm text-on-surface-variant">Подгрупп с занятиями пока нет.</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {items.map(({ subgroup, course, lessons: subgroupLessons, upcoming, completed, studentNames }) => (
            <article key={subgroup.id} className="rounded-xl border border-outline-variant/40 bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="font-label-md font-bold text-on-surface truncate">{subgroup.name}</h4>
                  <p className="text-xs text-on-surface-variant mt-1 truncate">{course?.title || course?.subject || `Курс #${subgroup.course_id}`}</p>
                </div>
                <span className="shrink-0 px-2 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-bold">Активна</span>
              </div>
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex items-center gap-2 text-on-surface-variant"><span className="material-symbols-outlined text-[16px] text-primary">groups</span><span>{studentNames.length} {studentNames.length === 1 ? "ученик" : studentNames.length < 5 ? "ученика" : "учеников"}</span></div>
                <div className="text-on-surface break-words">{studentNames.join(", ")}</div>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <div className="rounded-lg bg-surface-container-low p-2"><div className="text-on-surface-variant">Занятий</div><strong className="text-on-surface">{subgroupLessons.length}</strong></div>
                  <div className="rounded-lg bg-surface-container-low p-2"><div className="text-on-surface-variant">Проведено</div><strong className="text-on-surface">{completed.length}</strong></div>
                </div>
                <div className="pt-1 text-on-surface-variant">
                  <div>Следующее: {upcoming ? `${formatDate(upcoming.lesson_date)} · ${upcoming.start_time ?? ""}–${upcoming.end_time ?? ""}` : "нет запланированных"}</div>
                  {completed.length > 0 && <div className="mt-1">Последнее проведённое: {formatDate(completed[completed.length - 1].lesson_date)}</div>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
