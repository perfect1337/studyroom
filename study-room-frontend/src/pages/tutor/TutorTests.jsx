import { useEffect, useMemo, useState } from "react";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { assignTest, fetchTests, gradeTest } from "../../api/academic.js";
import { fetchMyPeople } from "../../api/users.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const STATUS_LABEL = {
  assigned: "Не сдан",
  submitted: "Сдан",
};

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [form, setForm] = useState({ student_id: "", title: "", link_url: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [gradingId, setGradingId] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [testsRes, peopleRes] = await Promise.all([fetchTests(), fetchMyPeople()]);
      setTests(testsRes?.items ?? []);
      const list = peopleRes?.students ?? [];
      setStudents(list);
      const byId = {};
      list.forEach((s) => (byId[s.id] = s));
      setStudentsById(byId);
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
      });
      setForm({ student_id: "", title: "", link_url: "" });
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
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1.4fr_auto] gap-stack-md items-end">
            <div className="space-y-stack-sm">
              <label className="font-label-md text-on-surface-variant ml-1">Ученик</label>
              <select
                value={form.student_id}
                onChange={(e) => setForm((f) => ({ ...f, student_id: e.target.value }))}
                className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Выберите ученика</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {fullName(s)}
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

        <section className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden overflow-x-auto">
          <div className="p-stack-md border-b border-outline-variant">
            <h3 className="font-headline-sm text-headline-sm text-on-background">Выданные тесты</h3>
          </div>
          {loading ? (
            <p className="p-stack-md text-on-surface-variant font-body-md">Загрузка…</p>
          ) : sorted.length === 0 ? (
            <p className="p-stack-md text-on-surface-variant font-body-md">Вы пока не выдали ни одного теста</p>
          ) : (
            <table className="w-full text-left min-w-[720px]">
              <thead className="bg-surface-container text-on-surface-variant text-label-md font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Ученик</th>
                  <th className="px-6 py-4">Тест</th>
                  <th className="px-6 py-4">Статус</th>
                  <th className="px-6 py-4">Оценка</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {sorted.map((t) => {
                  const student = studentsById[t.student_id];
                  const isSubmitted = t.status === "submitted";
                  return (
                    <tr key={t.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="px-6 py-5 font-label-md text-label-md font-bold text-on-background whitespace-nowrap">
                        {student ? fullName(student) : `Ученик #${t.student_id}`}
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
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
