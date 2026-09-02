import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { assignHomework, fetchHomework, fetchLessons } from "../../api/academic.js";
import { fetchMyPeople } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";
import { usePagination } from "../../utils/usePagination.js";
import Pagination from "../../components/ui/Pagination.jsx";

const STATUS_LABEL = {
  assigned: "Не сделано учеником",
  viewed: "Сделано учеником",
};

/**
 * "Домашние задания (репетитор)" — см. api-contracts.md 2.12/2.13:
 * POST /homework создаёт задание (просто ссылка) для конкретного ученика,
 * GET /homework для роли tutor сервер сам возвращает только созданные им же
 * задания (created_by = self) — отдельный параметр tutor_id не нужен.
 */
export default function TutorHomework() {
  const { user } = useAuth();

  const [homework, setHomework] = useState([]);
  const [studentsById, setStudentsById] = useState({});
  const [assignableStudents, setAssignableStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [form, setForm] = useState({ student_id: "", link_url: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [hwRes, peopleRes, lessonsRes] = await Promise.all([
        fetchHomework(),
        fetchMyPeople(),
        fetchLessons({ tutor_id: user.id }),
      ]);
      setHomework(hwRes?.items ?? []);
      const list = peopleRes?.students ?? [];
      const byId = {};
      list.forEach((s) => (byId[s.id] = s));
      setStudentsById(byId);

      // Задание можно выдать только тому, с кем уже было или ещё будет
      // занятие (см. TutorStudents.jsx / PeopleDirectory.jsx и бэкенд
      // IsStudentOfTutor в lesson_repository.go). Часть таких учеников может
      // не найтись в peopleRes (GET /users фильтрует по branch_id тьютора) —
      // добавляем их отдельно, с именем из lesson.participant_names, чтобы
      // их вообще можно было выбрать в форме, а не только показать в списке.
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
    () => homework.slice().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [homework]
  );

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    if (!form.student_id || !form.link_url.trim()) {
      setSubmitError("Выберите ученика и укажите ссылку на задание");
      return;
    }
    setSubmitting(true);
    try {
      await assignHomework({ student_id: Number(form.student_id), link_url: form.link_url.trim() });
      setForm({ student_id: "", link_url: "" });
      await load();
    } catch (e) {
      setSubmitError(e.message || "Не удалось выдать задание");
    } finally {
      setSubmitting(false);
    }
  }

  const { page, setPage, pageItems: pagedHomework } = usePagination(sorted, 10);

  return (
    <DashboardShell
      role="tutor"
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="space-y-stack-lg pb-section-padding">
        <h2 className="font-headline-md text-headline-md text-on-background">Домашние задания</h2>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">
            {error}
          </div>
        )}

        <section className="bg-surface-container-lowest rounded-xl p-stack-md shadow-sm border border-outline-variant">
          <h3 className="font-headline-sm text-headline-sm text-on-background mb-stack-md">Выдать новое задание</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-stack-md items-end">
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
              <label className="font-label-md text-on-surface-variant ml-1">Ссылка на задание</label>
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
          <div className="p-stack-md border-b border-outline-variant">
            <h3 className="font-headline-sm text-headline-sm text-on-background">Выданные задания</h3>
          </div>
          {loading ? (
            <p className="p-stack-md text-on-surface-variant font-body-md">Загрузка…</p>
          ) : sorted.length === 0 ? (
            <p className="p-stack-md text-on-surface-variant font-body-md">Вы пока не выдали ни одного задания</p>
          ) : (
            <ul className="divide-y divide-outline-variant">
              {pagedHomework.map((hw) => {
                const student = studentsById[hw.student_id];
                const isViewed = hw.status === "viewed";
                return (
                  <li key={hw.id} className="p-stack-md flex items-center justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-label-md text-label-md font-bold text-on-background">
                        {student ? fullName(student) : hw.student_name || `Ученик #${hw.student_id}`}
                      </p>
                      <a
                        href={hw.link_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary hover:underline break-all"
                      >
                        {hw.link_url}
                      </a>
                    </div>
                    <span
                      className={`text-xs font-bold px-3 py-1 rounded-full shrink-0 whitespace-nowrap ${
                        isViewed ? "bg-surface-container-highest text-primary" : "bg-secondary-fixed text-on-secondary-container"
                      }`}
                    >
                      {STATUS_LABEL[hw.status] ?? hw.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        {!loading && sorted.length > 0 && (
          <Pagination page={page} pageSize={10} total={sorted.length} onPageChange={setPage} itemLabel="заданий" />
        )}
        </section>
      </div>
    </DashboardShell>
  );
}
