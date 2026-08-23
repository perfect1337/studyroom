import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { assignTest, fetchCourses, fetchLessons, fetchTests, gradeTest } from "../../api/academic.js";
import { fetchMyPeople } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";
import CourseTag from "../../components/ui/CourseTag.jsx";

const STATUS_LABEL = {
  assigned: "Не сдан",
  submitted: "Сдан",
};

const STATUS_FILTERS = ["Все", "Сдан", "Не сдан"];

const GRADES = [2, 3, 4, 5];

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/**
 * "Тесты (репетитор)" — по аналогии с TutorHomework.jsx, но с жизненным
 * циклом "сдан/не сдан" и оценкой. Оценку можно выставить только после
 * того, как ученик отметил тест сданным (см. GradeCell ниже).
 */
export default function TutorTests() {
  const { user } = useAuth();

  const [tests, setTests] = useState([]);
  const [studentsById, setStudentsById] = useState({});
  const [students, setStudents] = useState([]);
  const [assignableStudents, setAssignableStudents] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [form, setForm] = useState({ student_id: "", title: "", link_url: "", course_id: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [gradingId, setGradingId] = useState(null);

  // Фильтры списка выданных тестов (раньше их не было вовсе — список
  // просто показывал все тесты подряд).
  const [statusFilter, setStatusFilter] = useState("Все");
  const [studentFilter, setStudentFilter] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [testsRes, peopleRes, coursesRes, lessonsRes] = await Promise.all([
        fetchTests(),
        fetchMyPeople(),
        fetchCourses({ tutor_id: user.id }),
        fetchLessons({ tutor_id: user.id }),
      ]);
      setTests(testsRes?.items ?? []);
      const list = peopleRes?.students ?? [];
      setStudents(list);
      const byId = {};
      list.forEach((s) => (byId[s.id] = s));
      setStudentsById(byId);
      const courseList = coursesRes?.items ?? [];
      setCourses(courseList);

      // Выдавать тест можно только тому, с кем уже было или ещё будет
      // занятие — те же правила, что и в PeopleDirectory.jsx / бэкенде
      // (IsStudentOfTutor в lesson_repository.go). См. TutorHomework.jsx —
      // тот же фолбэк для участников, которых нет в branch-фильтрованном
      // peopleRes.
      const lessonList = lessonsRes?.items ?? [];
      const linked = new Map();
      lessonList.forEach((l) => {
        if (l.status === "cancelled") return;
        (l.participant_ids ?? []).forEach((id) => {
          if (linked.has(id)) return;
          linked.set(id, byId[id] ?? { id, first_name: l.participant_names?.[id] ?? `#${id}`, last_name: "" });
        });
      });
      setAssignableStudents(Array.from(linked.values()));
    } catch (e) {
      setError(e.message || "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.id) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const sorted = useMemo(
    () => tests.slice().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [tests]
  );

  const filteredSorted = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sorted.filter((t) => {
      if (statusFilter === "Сдан" && t.status !== "submitted") return false;
      if (statusFilter === "Не сдан" && t.status === "submitted") return false;
      if (studentFilter && String(t.student_id) !== String(studentFilter)) return false;
      if (courseFilter && String(t.course_id) !== String(courseFilter)) return false;
      if (query) {
        const student = studentsById[t.student_id];
        const haystack = `${fullName(student) || ""} ${t.title || ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [sorted, statusFilter, studentFilter, courseFilter, search, studentsById]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    if (!form.student_id || !form.title.trim() || !form.link_url.trim()) {
      setSubmitError("Выберите ученика, укажите название и ссылку на тест");
      return;
    }
    setSubmitting(true);
    try {
      await assignTest({
        student_id: Number(form.student_id),
        title: form.title.trim(),
        link_url: form.link_url.trim(),
        course_id: form.course_id ? Number(form.course_id) : undefined,
      });
      setForm({ student_id: "", title: "", link_url: "", course_id: "" });
      await load();
    } catch (e) {
      setSubmitError(e.message || "Не удалось выдать тест");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGrade(testId, grade) {
    setGradingId(testId);
    try {
      await gradeTest(testId, grade);
      setTests((prev) => prev.map((t) => (t.id === testId ? { ...t, grade, graded_at: new Date().toISOString() } : t)));
    } catch (e) {
      setError(e.message || "Не удалось выставить оценку");
    } finally {
      setGradingId(null);
    }
  }

  return (
    <DashboardShell
      role="tutor"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="space-y-stack-lg pb-section-padding">
        <h2 className="font-headline-md text-headline-md text-on-background">Тесты</h2>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
            {error}
          </div>
        )}

        <section className="bg-surface-container-lowest rounded-xl p-stack-md shadow-sm border border-outline-variant">
          <h3 className="font-headline-sm text-headline-sm text-on-background mb-stack-md">Выдать новый тест</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_1.2fr_auto] gap-stack-md items-end">
            <div className="space-y-stack-sm">
              <label className="font-label-md text-on-surface-variant ml-1">Ученик</label>
              <select
                value={form.student_id}
                onChange={(e) => setForm((f) => ({ ...f, student_id: e.target.value }))}
                className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Выберите ученика</option>
                {assignableStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {fullName(s)}
                  </option>
                ))}
              </select>
              {assignableStudents.length === 0 && (
                <p className="text-xs text-on-surface-variant mt-1">
                  Нет учеников с назначенными занятиями. Сначала добавьте занятие в расписании.
                </p>
              )}
            </div>
            <div className="space-y-stack-sm">
              <label className="font-label-md text-on-surface-variant ml-1">Курс / предмет</label>
              <select
                value={form.course_id}
                onChange={(e) => setForm((f) => ({ ...f, course_id: e.target.value }))}
                className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Без привязки к курсу</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {c.subject}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-stack-sm">
              <label className="font-label-md text-on-surface-variant ml-1">Название теста</label>
              <input
                type="text"
                required
                placeholder="Контрольная по алгебре"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="space-y-stack-sm">
              <label className="font-label-md text-on-surface-variant ml-1">Ссылка на тест</label>
              <input
                type="url"
                required
                placeholder="https://..."
                value={form.link_url}
                onChange={(e) => setForm((f) => ({ ...f, link_url: e.target.value }))}
                className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="bg-primary text-on-primary font-label-md px-6 py-3 rounded-lg shadow-sm hover:translate-y-[-1px] active:scale-95 transition-all disabled:opacity-60"
            >
              {submitting ? "Отправка..." : "Выдать"}
            </button>
          </form>
          {submitError && <p className="text-sm text-error mt-3">{submitError}</p>}
        </section>

        <section className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden">
          <div className="p-stack-md border-b border-outline-variant flex flex-col md:flex-row md:items-center md:justify-between gap-stack-md">
            <h3 className="font-headline-sm text-headline-sm text-on-background">Выданные тесты</h3>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[160px] sm:flex-none">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
                  search
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по ученику или названию..."
                  className="bg-surface border border-outline-variant rounded-lg pl-9 pr-4 py-2 text-label-md font-label-md outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary w-full sm:w-64"
                />
              </div>
              <div className="relative flex-1 min-w-[140px] sm:flex-none">
                <select
                  value={studentFilter}
                  onChange={(e) => setStudentFilter(e.target.value)}
                  className="w-full appearance-none bg-surface border border-outline-variant rounded-lg pl-3 pr-9 py-2 text-label-md font-label-md outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Все ученики</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {fullName(s)}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px] pointer-events-none">expand_more</span>
              </div>
              <div className="relative flex-1 min-w-[140px] sm:flex-none">
                <select
                  value={courseFilter}
                  onChange={(e) => setCourseFilter(e.target.value)}
                  className="w-full appearance-none bg-surface border border-outline-variant rounded-lg pl-3 pr-9 py-2 text-label-md font-label-md outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Все курсы</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} · {c.subject}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px] pointer-events-none">expand_more</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={`px-3.5 py-2 rounded-full text-sm font-label-md font-medium border transition-colors ${
                      statusFilter === f
                        ? "bg-primary text-on-primary border-primary"
                        : "bg-surface text-on-surface-variant border-outline-variant hover:bg-surface-container-low"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {loading ? (
            <p className="p-stack-md text-on-surface-variant font-body-md">Загрузка…</p>
          ) : sorted.length === 0 ? (
            <p className="p-stack-md text-on-surface-variant font-body-md">Вы пока не выдали ни одного теста</p>
          ) : filteredSorted.length === 0 ? (
            <p className="p-stack-md text-on-surface-variant font-body-md">Тестов с такими фильтрами не найдено</p>
          ) : (
            <>
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left min-w-[720px]">
              <thead className="bg-surface-container text-on-surface-variant text-label-md font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Ученик</th>
                  <th className="px-6 py-4">Тест</th>
                  <th className="px-6 py-4">Курс / предмет</th>
                  <th className="px-6 py-4">Статус</th>
                  <th className="px-6 py-4">Оценка</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {filteredSorted.map((t) => {
                  const student = studentsById[t.student_id];
                  const isSubmitted = t.status === "submitted";
                  return (
                    <tr key={t.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="px-6 py-5 font-label-md text-label-md font-bold text-on-background whitespace-nowrap">
                        {student ? fullName(student) : t.student_name || `Ученик #${t.student_id}`}
                      </td>
                      <td className="px-6 py-5 min-w-0">
                        <p className="font-label-md text-on-background">{t.title}</p>
                        <a
                          href={t.link_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-primary hover:underline break-all"
                        >
                          {t.link_url}
                        </a>
                        <p className="text-xs text-on-surface-variant mt-1">Выдан {formatDate(t.created_at)}</p>
                      </td>
                      <td className="px-6 py-5">
                        <CourseTag title={t.course_title} subject={t.course_subject} />
                      </td>
                      <td className="px-6 py-5">
                        <span
                          className={`text-xs font-bold px-3 py-1 rounded-full shrink-0 ${
                            isSubmitted ? "bg-surface-container-highest text-primary" : "bg-secondary-fixed text-on-secondary-container"
                          }`}
                        >
                          {STATUS_LABEL[t.status] ?? t.status}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        {!isSubmitted ? (
                          <span className="text-on-surface-variant text-sm">Ждём сдачи</span>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {GRADES.map((g) => (
                              <button
                                key={g}
                                disabled={gradingId === t.id}
                                onClick={() => handleGrade(t.id, g)}
                                className={`w-8 h-8 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 ${
                                  t.grade === g
                                    ? "bg-primary text-on-primary"
                                    : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                                }`}
                              >
                                {g}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            {/* Мобильные карточки */}
            <div className="md:hidden divide-y divide-outline-variant/30">
              {filteredSorted.map((t) => {
                const student = studentsById[t.student_id];
                const isSubmitted = t.status === "submitted";
                return (
                  <div key={t.id} className="p-4 flex flex-col gap-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-bold text-on-background">
                        {student ? fullName(student) : t.student_name || `Ученик #${t.student_id}`}
                      </span>
                      <span
                        className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full ${
                          isSubmitted ? "bg-surface-container-highest text-primary" : "bg-secondary-fixed text-on-secondary-container"
                        }`}
                      >
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                    </div>
                    <div>
                      <p className="font-label-md text-on-background">{t.title}</p>
                      <a
                        href={t.link_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary hover:underline break-all"
                      >
                        {t.link_url}
                      </a>
                      <p className="text-xs text-on-surface-variant mt-1">Выдан {formatDate(t.created_at)}</p>
                    </div>
                    <CourseTag title={t.course_title} subject={t.course_subject} />
                    <div>
                      {!isSubmitted ? (
                        <span className="text-on-surface-variant text-sm">Ждём сдачи</span>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {GRADES.map((g) => (
                            <button
                              key={g}
                              disabled={gradingId === t.id}
                              onClick={() => handleGrade(t.id, g)}
                              className={`w-9 h-9 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 ${
                                t.grade === g
                                  ? "bg-primary text-on-primary"
                                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                              }`}
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
