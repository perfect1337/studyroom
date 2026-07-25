import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import Pagination from "../../components/ui/Pagination.jsx";
import { usePagination } from "../../utils/usePagination.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchMyPeople } from "../../api/users.js";
import { fetchApplications } from "../../api/crm.js";
import { fetchContracts } from "../../api/contracts.js";
import { fetchCourses, createLesson } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";

const TEACHERS_PAGE_SIZE = 5;
const APPLICATIONS_PAGE_SIZE = 5;

const TUTOR_STATUS_LABEL = {
  active: "Активен",
  vacation: "В отпуске",
  sick_leave: "На больничном",
  inactive: "Неактивен",
};

function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

export default function AdminOverview() {
  const { user } = useAuth();

  const [students, setStudents] = useState([]);
  const [tutors, setTutors] = useState([]);
  const [applications, setApplications] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [lessonForm, setLessonForm] = useState({ tutorId: "", courseId: "", date: "", time: "" });
  const [lessonStatus, setLessonStatus] = useState("");
  const [applicationSearch, setApplicationSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [peopleRes, applicationsRes, contractsRes, coursesRes] = await Promise.all([
          fetchMyPeople(),
          fetchApplications({ status: "new" }).catch(() => ({ items: [] })),
          fetchContracts().catch(() => ({ items: [] })),
          fetchCourses(),
        ]);
        if (cancelled) return;
        setStudents(peopleRes?.students ?? []);
        setTutors(peopleRes?.tutors ?? []);
        setApplications(applicationsRes?.items ?? []);
        setContracts(contractsRes?.items ?? []);
        setCourses(coursesRes?.items ?? []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось загрузить данные");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalRevenue = useMemo(
    () => contracts.reduce((sum, c) => sum + (c.payment_status === "paid" ? Number(c.amount) || 0 : 0), 0),
    [contracts]
  );

  const stats = [
    { label: "Всего учеников", value: String(students.length), icon: "school" },
    { label: "Всего репетиторов", value: String(tutors.length), icon: "person_pin" },
    { label: "Выручка (оплачено)", value: `₽${totalRevenue.toLocaleString("ru-RU")}`, icon: "trending_up" },
    { label: "Новые заявки", value: String(applications.length), icon: "assignment_ind" },
  ];

  // Поиск по алфавиту среди заявок — фильтр по имени + сортировка А-Я.
  const visibleApplications = useMemo(() => {
    const q = applicationSearch.trim().toLowerCase();
    const filtered = q ? applications.filter((a) => (a.name ?? "").toLowerCase().includes(q)) : applications;
    return [...filtered].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ru"));
  }, [applications, applicationSearch]);

  const { page: teachersPage, setPage: setTeachersPage, pageItems: pagedTutors } = usePagination(tutors, TEACHERS_PAGE_SIZE);
  const { page: applicationsPage, setPage: setApplicationsPage, pageItems: pagedApplications } = usePagination(
    visibleApplications,
    APPLICATIONS_PAGE_SIZE
  );

  async function handleCreateLesson(e) {
    e.preventDefault();
    if (!lessonForm.tutorId || !lessonForm.courseId || !lessonForm.date || !lessonForm.time) return;
    setLessonStatus("saving");
    try {
      await createLesson({
        course_id: Number(lessonForm.courseId),
        tutor_id: Number(lessonForm.tutorId),
        topic: "Занятие",
        lesson_date: lessonForm.date,
        start_time: lessonForm.time,
        end_time: lessonForm.time,
        location_type: "offline",
        group_type: "individual",
      });
      setLessonStatus("done");
      setLessonForm({ tutorId: "", courseId: "", date: "", time: "" });
    } catch (e) {
      setLessonStatus(e.message || "Не удалось создать занятие");
    }
  }

  return (
    <DashboardShell role="admin" user={toSidebarUser(user)} searchPlaceholder="Поиск учеников или учителей...">
      {error && (
        <div className="mt-4 p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-stack-md mb-stack-lg mt-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-surface-container-lowest p-6 rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant flex items-center gap-4 hover:-translate-y-1 transition-transform"
          >
            <div className="w-12 h-12 bg-primary-container rounded-lg flex items-center justify-center text-on-primary-container">
              <span className="material-symbols-outlined">{s.icon}</span>
            </div>
            <div>
              <p className="text-on-surface-variant font-label-md text-label-md">{s.label}</p>
              <p className="text-headline-sm font-headline-sm text-primary">{loading ? "…" : s.value}</p>
            </div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-stack-lg pb-stack-lg">
        <section className="xl:col-span-2 flex flex-col gap-stack-md">
          <div className="flex justify-between items-end">
            <div>
              <h2 className="text-headline-sm font-headline-sm text-on-surface">Управление преподавателями</h2>
              <p className="text-on-surface-variant text-label-md font-label-md">Список репетиторов и их текущий статус</p>
            </div>
            <Link
              to="/admin/teachers"
              className="bg-primary text-on-primary px-6 py-2 rounded-lg font-label-md text-label-md flex items-center gap-2 hover:bg-on-primary-fixed-variant transition-colors active:scale-95"
            >
              <span className="material-symbols-outlined">person_add</span>
              Добавить учителя
            </Link>
          </div>

          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden overflow-x-auto">
            <table className="w-full text-left min-w-[640px]">
              <thead className="bg-surface-container-low border-b border-outline-variant">
                <tr>
                  <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">ФИО Преподавателя</th>
                  <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Специализация</th>
                  <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {!loading && tutors.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-on-surface-variant">Репетиторов пока нет</td>
                  </tr>
                )}
                {pagedTutors.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center font-bold text-primary">
                          {initials(t)}
                        </div>
                        <div>
                          <p className="font-label-md text-label-md font-bold">{fullName(t)}</p>
                          <p className="text-[12px] text-outline">ID: {t.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-label-md font-label-md">{t.specialization ?? "—"}</td>
                    <td className="px-6 py-4">
                      <StatusBadge status={TUTOR_STATUS_LABEL[t.tutor_status] ?? "Активен"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={teachersPage}
              pageSize={TEACHERS_PAGE_SIZE}
              total={tutors.length}
              onPageChange={setTeachersPage}
              itemLabel="преподавателей"
            />
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-headline-sm text-headline-sm">Новые заявки</h3>
              <span className="bg-error text-white text-[10px] px-2 py-0.5 rounded-full">{applications.length} новых</span>
            </div>

            <div className="relative mb-4">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
                search
              </span>
              <input
                value={applicationSearch}
                onChange={(e) => setApplicationSearch(e.target.value)}
                placeholder="Поиск по имени (А-Я)..."
                className="w-full bg-surface border border-outline-variant rounded-full pl-9 pr-4 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              />
            </div>

            <div className="space-y-4">
              {visibleApplications.length === 0 && (
                <p className="text-sm text-on-surface-variant">
                  {applicationSearch ? "Ничего не найдено." : "Новых заявок нет."}
                </p>
              )}
              {pagedApplications.map((a) => (
                <div key={a.id} className="p-3 border border-outline-variant rounded-xl hover:bg-surface-container-low transition-colors">
                  <div className="flex justify-between items-start mb-1">
                    <p className="font-bold text-label-md">{a.name} {a.age ? `(${a.age} лет)` : ""}</p>
                    <span className="text-[10px] text-outline">
                      {a.created_at ? new Date(a.created_at).toLocaleDateString("ru-RU") : ""}
                    </span>
                  </div>
                  <p className="text-[12px] text-on-surface-variant">Интерес: {a.subject_interest ?? a.course ?? "—"}</p>
                </div>
              ))}
            </div>

            <Pagination
              page={applicationsPage}
              pageSize={APPLICATIONS_PAGE_SIZE}
              total={visibleApplications.length}
              onPageChange={setApplicationsPage}
              itemLabel="заявок"
            />
          </div>
        </section>

        <aside className="flex flex-col gap-stack-lg">
          <div className="bg-primary p-6 rounded-2xl text-on-primary shadow-lg flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined">event_available</span>
              <h3 className="font-headline-sm text-headline-sm">Назначить урок</h3>
            </div>
            <p className="opacity-90 text-label-md font-label-md">Быстрое добавление занятия в расписание</p>
            <form onSubmit={handleCreateLesson} className="flex flex-col gap-4 mt-2">
              <div>
                <label className="block text-[12px] font-bold text-white mb-1">Преподаватель</label>
                <select
                  value={lessonForm.tutorId}
                  onChange={(e) => setLessonForm((f) => ({ ...f, tutorId: e.target.value }))}
                  className="w-full bg-white text-black border-none rounded-lg p-3 text-label-md focus:ring-2 focus:ring-secondary-container appearance-none"
                >
                  <option value="">Выберите учителя</option>
                  {tutors.map((t) => (
                    <option key={t.id} value={t.id}>{fullName(t)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-bold text-white mb-1">Курс</label>
                <select
                  value={lessonForm.courseId}
                  onChange={(e) => setLessonForm((f) => ({ ...f, courseId: e.target.value }))}
                  className="w-full bg-white text-black border-none rounded-lg p-3 text-label-md focus:ring-2 focus:ring-secondary-container appearance-none"
                >
                  <option value="">Выберите курс</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[12px] font-bold text-white mb-1">Дата</label>
                  <input
                    className="w-full bg-white text-black border-none rounded-lg p-3 text-label-md"
                    type="date"
                    value={lessonForm.date}
                    onChange={(e) => setLessonForm((f) => ({ ...f, date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-white mb-1">Время</label>
                  <input
                    className="w-full bg-white text-black border-none rounded-lg p-3 text-label-md"
                    type="time"
                    value={lessonForm.time}
                    onChange={(e) => setLessonForm((f) => ({ ...f, time: e.target.value }))}
                  />
                </div>
              </div>
              <button type="submit" className="bg-secondary-container text-on-secondary-container py-4 rounded-lg font-bold hover:brightness-110 transition-all shadow-md active:scale-95 mt-2">
                Подтвердить
              </button>
              {lessonStatus === "done" && <p className="text-sm text-white">Занятие создано!</p>}
              {lessonStatus && lessonStatus !== "saving" && lessonStatus !== "done" && (
                <p className="text-sm text-red-100">{lessonStatus}</p>
              )}
            </form>
          </div>
        </aside>
      </div>
    </DashboardShell>
  );
}
