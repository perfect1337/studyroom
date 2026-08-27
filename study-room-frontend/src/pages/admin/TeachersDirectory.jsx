import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardShell from "../../components/layout/DashboardShell.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import Pagination from "../../components/ui/Pagination.jsx";
import { usePagination } from "../../utils/usePagination.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { fetchMyPeople, fetchBranches, createTutor, setTutorStatus } from "../../api/users.js";
import { fetchEnrollments, fetchCourses, assignCourseTutor } from "../../api/academic.js";
import { toSidebarUser, fullName } from "../../utils/userDisplay.js";
import { sanitizePhoneInput, isValidPhone } from "../../utils/phone.js";

const PAGE_SIZE = 10;

const TUTOR_STATUS_LABEL = {
  active: "Активен",
  vacation: "В отпуске",
  sick_leave: "На больничном",
  inactive: "Неактивен",
};

// Владелец сети может выставить любой статус (включая "Неактивен"),
// управляющий филиалом — только active|vacation|sick_leave (см. api-contracts.md, 1.15).
const STATUS_OPTIONS_BY_ROLE = {
  owner: ["active", "vacation", "sick_leave", "inactive"],
  branch_owner: ["active", "vacation", "sick_leave"],
};

function initials(person) {
  if (!person) return "?";
  return `${person.last_name?.[0] ?? ""}${person.first_name?.[0] ?? ""}`.toUpperCase() || "?";
}

const EMPTY_FORM = {
  last_name: "",
  first_name: "",
  patronymic: "",
  email: "",
  phone: "",
  branch_id: "",
  course_ids: [],
};

/**
 * Общий раздел "Преподаватели" для двух ролей:
 * - owner (раздел /admin): видит всех учителей сети, может выбрать филиал для просмотра
 *   и добавить нового учителя в любой филиал сети.
 * - branch_owner (раздел /branch): видит только учителей своего филиала (сервер сам
 *   ограничивает выборку по branch_id из JWT) и может добавлять новых учителей —
 *   но только в свой собственный филиал (branch_id подставляется автоматически,
 *   без выбора, и принудительно проверяется на бэкенде, см. UserHandler.CreateTutor).
 */
export default function TeachersDirectory({ role }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isOwner = role === "owner";
  const detailPath = (id) => (isOwner ? `/admin/teachers/${id}` : `/branch/teachers/${id}`);

  const [tutors, setTutors] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(""); // "" = все филиалы (только owner)
  const [enrollments, setEnrollments] = useState([]);
  const [courses, setCourses] = useState([]); // нужны, чтобы учитывать привязку курса к преподавателю (course_tutors)
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rowUpdating, setRowUpdating] = useState(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addStatus, setAddStatus] = useState("");
  const [createdCreds, setCreatedCreds] = useState(null);
  const [addFormCourses, setAddFormCourses] = useState([]); // курсы филиала, выбранного в форме добавления
  const [addFormCoursesLoading, setAddFormCoursesLoading] = useState(false);

  // Курсы для формы добавления преподавателя — курсы больше не привязаны к
  // филиалу, поэтому показываем весь каталог курсов сети независимо от
  // того, в какой филиал принят преподаватель.
  useEffect(() => {
    if (!showAddModal) {
      setAddFormCourses([]);
      return;
    }
    let cancelled = false;
    setAddFormCoursesLoading(true);
    fetchCourses()
      .then((res) => {
        if (!cancelled) setAddFormCourses(res?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setAddFormCourses([]);
      })
      .finally(() => {
        if (!cancelled) setAddFormCoursesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showAddModal]);

  // Список филиалов — нужен только owner, чтобы выбрать, какой филиал смотреть, и в форме добавления.
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    fetchBranches()
      .then((res) => {
        if (!cancelled) setBranches(res?.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        // branch_id учитывается сервером только для owner — для branch_owner сервер
        // всегда возвращает учителей только его собственного филиала.
        const params = { search: search || undefined };
        if (isOwner && selectedBranch) params.branch_id = Number(selectedBranch);

        const [peopleRes, enrollRes, coursesRes] = await Promise.all([
          fetchMyPeople(params),
          fetchEnrollments().catch(() => ({ items: [] })),
          fetchCourses(isOwner && selectedBranch ? { branch_id: Number(selectedBranch) } : {}).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setTutors(peopleRes?.tutors ?? []);
        setEnrollments(enrollRes?.items ?? []);
        setCourses(coursesRes?.items ?? []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Не удалось загрузить список преподавателей");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    // Небольшой дебаунс на поиск, чтобы не дёргать API на каждый символ.
    const t = setTimeout(load, search ? 350 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isOwner, selectedBranch, search]);

  // Считаем и личные назначения (enrollments.tutor_id), и учеников, записанных
  // на курсы, которые преподаватель ведёт через course_tutors — иначе привязка
  // нового курса к преподавателю никак не отражалась бы в этой таблице
  // (см. ту же логику в TeacherDetail.jsx: myStudents/taughtCourseIds).
  const activeStudentsByTutor = useMemo(() => {
    const map = {};
    const tutorsByCourse = {};
    courses.forEach((c) => {
      tutorsByCourse[c.id] = c.tutor_ids ?? [];
    });
    enrollments.forEach((e) => {
      const tutorIds = new Set(tutorsByCourse[e.course_id] ?? []);
      if (e.tutor_id) tutorIds.add(e.tutor_id);
      tutorIds.forEach((tutorId) => {
        (map[tutorId] ??= new Set()).add(e.student_id);
      });
    });
    return map;
  }, [enrollments, courses]);

  const branchNameById = useMemo(() => {
    const map = {};
    branches.forEach((b) => (map[b.id] = b.name || b.city));
    return map;
  }, [branches]);

  // Уволенные (is_active=false) остаются в таблице, но со статусом "Уволен"
  // (см. рендер ниже: badge + скрытый выпадающий список смены tutor_status —
  // менять статус уволенному нечего, сначала нужно восстановить в штат на
  // его карточке). Обычный фильтр по tutor_status продолжает работать поверх
  // этого: у уволенных tutor_status тоже переводится в inactive на бэкенде
  // (см. user-service SetStatus), так что под фильтром "Неактивен" они тоже
  // видны — это ожидаемо, там же показываются и "просто" деактивированные.
  const visibleTutors = useMemo(() => {
    if (statusFilter === "all") return tutors;
    return tutors.filter((t) => (t.tutor_status ?? "active") === statusFilter);
  }, [tutors, statusFilter]);

  const statusOptions = STATUS_OPTIONS_BY_ROLE[role] ?? STATUS_OPTIONS_BY_ROLE.branch_owner;

  const { page, setPage, pageItems: pagedTutors } = usePagination(visibleTutors, PAGE_SIZE);

  async function handleStatusChange(tutorId, newStatus) {
    setRowUpdating(tutorId);
    const prev = tutors;
    setTutors((list) => list.map((t) => (t.id === tutorId ? { ...t, tutor_status: newStatus } : t)));
    try {
      await setTutorStatus(tutorId, newStatus);
    } catch (e) {
      setTutors(prev);
      setError(e.message || "Не удалось изменить статус преподавателя");
    } finally {
      setRowUpdating(null);
    }
  }

  function openAddModal() {
    setAddForm(isOwner ? EMPTY_FORM : { ...EMPTY_FORM, branch_id: user?.branch_id ? String(user.branch_id) : "" });
    setAddStatus("");
    setCreatedCreds(null);
    setShowAddModal(true);
  }

  function toggleAddFormCourse(courseId) {
    setAddForm((f) => {
      const has = f.course_ids.includes(courseId);
      return { ...f, course_ids: has ? f.course_ids.filter((id) => id !== courseId) : [...f.course_ids, courseId] };
    });
  }

  async function handleAddTeacher(e) {
    e.preventDefault();
    if (!addForm.last_name || !addForm.first_name || !addForm.email || !addForm.branch_id) return;
    if (!isValidPhone(addForm.phone)) {
      setAddStatus("Введите телефон в формате из 10-15 цифр (можно с +)");
      return;
    }
    setAddStatus("saving");
    try {
      // Специализация в профиле преподавателя больше не вводится вручную —
      // формируем её автоматически из предметов выбранных курсов, чтобы
      // колонка "Специализация" в таблице по-прежнему было чем заполнить.
      const chosenCourses = addFormCourses.filter((c) => addForm.course_ids.includes(c.id));
      const specialization = [...new Set(chosenCourses.map((c) => c.subject).filter(Boolean))].join(", ") || undefined;

      const res = await createTutor({
        email: addForm.email,
        phone: addForm.phone || undefined,
        last_name: addForm.last_name,
        first_name: addForm.first_name,
        patronymic: addForm.patronymic || undefined,
        branch_id: Number(addForm.branch_id),
        specialization,
      });
      const newTutorId = (res?.user ?? res)?.id;

      // Закрепляем преподавателя за выбранными курсами (course_tutors) — именно
      // по этой связи ему затем будут показаны "его" ученики (см. ADR в
      // academic-service/internal/repository/enrollment_repository.go:ListForTutor).
      let assignError = "";
      if (newTutorId) {
        const results = await Promise.allSettled(
          addForm.course_ids.map((courseId) => assignCourseTutor(courseId, newTutorId))
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          assignError = `Преподаватель создан, но не удалось закрепить за ним ${failed} из ${addForm.course_ids.length} курс(ов). Закрепите их вручную на странице курса.`;
        }
      }

      setAddStatus("done");
      setCreatedCreds({
        email: addForm.email,
        temp_password: res?.temp_password ?? res?.temporary_password ?? res?.password ?? null,
        warning: assignError,
      });
      // Обновляем список, если новый учитель попадает в текущий фильтр по филиалу.
      if (!isOwner || !selectedBranch || Number(selectedBranch) === Number(addForm.branch_id)) {
        setTutors((list) => [res?.user ?? res, ...list]);
      }
      // Перечитываем курсы (assignCourseTutor уже сбросил их кэш через
      // invalidateQuery(["courses"]), см. api/academic.js) — без этого только
      // что назначенная привязка курс -> преподаватель не отразится в этой
      // таблице (специализация/число учеников) до следующей полной перезагрузки.
      if (newTutorId && addForm.course_ids.length > 0) {
        fetchCourses(isOwner && selectedBranch ? { branch_id: Number(selectedBranch) } : {})
          .then((r) => setCourses(r?.items ?? []))
          .catch(() => {});
      }
    } catch (e) {
      setAddStatus(e.message || "Не удалось создать преподавателя");
    }
  }

  return (
    <DashboardShell
      role={isOwner ? "admin" : "branch_owner"}
      user={toSidebarUser(user)}
      searchPlaceholder="Поиск преподавателя..."
      userLabel={fullName(user)}
      avatarUrl={user?.avatar_url}
    >
      <div className="mt-4 pb-stack-lg space-y-stack-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-stack-md">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary mb-1">Преподаватели</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              {isOwner
                ? "Список преподавателей по всей сети филиалов"
                : "Список преподавателей вашего филиала"}
            </p>
          </div>

          {/* Кнопка добавления учителя доступна и owner (в любой филиал сети),
              и branch_owner (только в свой собственный филиал). */}
          <button
            onClick={openAddModal}
            className="bg-primary text-on-primary px-6 py-2.5 rounded-lg font-label-md text-label-md flex items-center gap-2 hover:brightness-110 transition-all active:scale-95 shadow-sm"
          >
            <span className="material-symbols-outlined">person_add</span>
            Добавить преподавателя
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-container text-on-error-container font-label-md text-label-md">{error}</div>
        )}

        {/* Фильтры */}
        <section className="flex flex-col md:flex-row gap-stack-md md:items-center">
          <div className="relative w-full md:max-w-xs">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[20px]">
              search
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Имя или фамилия..."
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-full pl-10 pr-4 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
            />
          </div>

          {/* Фильтр по статусу — раньше был рядом кнопок ("таблеток"), но при
              4+ статусах он не помещался и уезжал в горизонтальный скролл
              (особенно на узких экранах) — заменили на выпадающий список,
              как и фильтр по филиалу чуть ниже. */}
          <div className="relative w-full md:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full md:w-auto appearance-none bg-surface-container-lowest border border-outline-variant rounded-lg pl-4 pr-9 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            >
              {["all", "active", "vacation", "sick_leave", "inactive"].map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "Все статусы" : TUTOR_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          {/* Выбор филиала — только у owner. branch_owner всегда видит только свой филиал. */}
          {isOwner && (
            <div className="relative md:ml-auto">
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="appearance-none bg-surface-container-lowest border border-outline-variant rounded-lg pl-4 pr-9 py-2 text-label-md font-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
              >
                <option value="">Все филиалы</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name || b.city}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        {/* Таблица преподавателей */}
        <div className="bg-surface-container-lowest rounded-xl shadow-[0px_10px_30px_rgba(0,0,0,0.05)] border border-outline-variant overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container-low text-on-surface-variant border-b border-outline-variant">
              <tr>
                <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">ФИО Преподавателя</th>
                <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Специализация</th>
                {isOwner && <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Филиал</th>}
                <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap">Активные ученики</th>
                <th className="px-6 py-4 font-label-md text-label-md whitespace-nowrap min-w-[220px]">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {!loading && visibleTutors.length === 0 && (
                <tr>
                  <td colSpan={isOwner ? 5 : 4} className="px-6 py-10 text-center text-on-surface-variant">
                    Преподаватели не найдены
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={isOwner ? 5 : 4} className="px-6 py-10 text-center text-on-surface-variant">
                    Загрузка...
                  </td>
                </tr>
              )}
              {pagedTutors.map((t) => {
                const studentCount = activeStudentsByTutor[t.id]?.size ?? 0;
                const status = t.tutor_status ?? "active";
                const isFired = t.is_active === false;
                return (
                  <tr
                    key={t.id}
                    onClick={() => navigate(detailPath(t.id))}
                    className="hover:bg-surface-container-low transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className="h-11 w-11 rounded-lg bg-primary-fixed flex items-center justify-center font-bold text-primary">
                          {initials(t)}
                        </div>
                        <div>
                          <div className="font-body-md text-body-md font-bold text-on-surface">{fullName(t)}</div>
                          <div className="text-label-md text-on-surface-variant text-[12px]">ID: {t.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-block whitespace-nowrap bg-primary-fixed text-on-primary-fixed px-3 py-1 rounded-full text-label-md font-medium">
                        {t.specialization || "—"}
                      </span>
                    </td>
                    {isOwner && (
                      <td className="px-6 py-4 text-label-md font-label-md text-on-surface-variant">
                        {branchNameById[t.branch_id] || (t.branch_id ? `Филиал #${t.branch_id}` : "—")}
                      </td>
                    )}
                    <td className="px-6 py-4 font-bold text-on-surface">{studentCount}</td>
                    <td className="px-6 py-4 min-w-[220px]" onClick={(e) => e.stopPropagation()}>
                      {isFired ? (
                        // Уволенный: менять tutor_status смысла нет (заблокирован
                        // вход, все занятия уже удалены каскадом на бэкенде) —
                        // вместо выпадающего списка просто бейдж, "Восстановить
                        // в штат" доступно на карточке преподавателя.
                        <StatusBadge status="Уволен" color="red" />
                      ) : (
                        <div className="flex items-center gap-2 flex-nowrap">
                          <StatusBadge status={TUTOR_STATUS_LABEL[status] ?? status} />
                          <select
                            value={status}
                            disabled={rowUpdating === t.id}
                            onChange={(e) => handleStatusChange(t.id, e.target.value)}
                            className="shrink-0 text-[12px] border border-outline-variant rounded-md px-2 py-1 bg-surface-container-lowest disabled:opacity-50"
                          >
                            {statusOptions.map((s) => (
                              <option key={s} value={s}>
                                {TUTOR_STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          {/* Мобильные карточки вместо таблицы */}
          <div className="md:hidden divide-y divide-outline-variant">
            {!loading && visibleTutors.length === 0 && (
              <div className="px-4 py-10 text-center text-on-surface-variant">Преподаватели не найдены</div>
            )}
            {loading && <div className="px-4 py-10 text-center text-on-surface-variant">Загрузка...</div>}
            {pagedTutors.map((t) => {
              const studentCount = activeStudentsByTutor[t.id]?.size ?? 0;
              const status = t.tutor_status ?? "active";
              const isFired = t.is_active === false;
              return (
                <div key={t.id} className="p-4 flex flex-col gap-3 active:bg-surface-container-low">
                  <div className="flex items-center gap-3" onClick={() => navigate(detailPath(t.id))}>
                    <div className="h-11 w-11 shrink-0 rounded-lg bg-primary-fixed flex items-center justify-center font-bold text-primary">
                      {initials(t)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-on-surface truncate">{fullName(t)}</div>
                      <div className="text-[12px] text-on-surface-variant">ID: {t.id}</div>
                    </div>
                    <span className="inline-block whitespace-nowrap bg-primary-fixed text-on-primary-fixed px-2.5 py-1 rounded-full text-[11px] font-medium">
                      {t.specialization || "—"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[12px] pt-2 border-t border-outline-variant/40" onClick={() => navigate(detailPath(t.id))}>
                    {isOwner && (
                      <div>
                        <span className="text-on-surface-variant block">Филиал</span>
                        <span className="text-on-surface">{branchNameById[t.branch_id] || (t.branch_id ? `#${t.branch_id}` : "—")}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-on-surface-variant block">Активные ученики</span>
                      <span className="font-bold text-on-surface">{studentCount}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap pt-1" onClick={(e) => e.stopPropagation()}>
                    {isFired ? (
                      <StatusBadge status="Уволен" color="red" />
                    ) : (
                      <>
                        <StatusBadge status={TUTOR_STATUS_LABEL[status] ?? status} />
                        <select
                          value={status}
                          disabled={rowUpdating === t.id}
                          onChange={(e) => handleStatusChange(t.id, e.target.value)}
                          className="flex-1 min-w-[140px] text-[12px] border border-outline-variant rounded-md px-2 py-1.5 bg-surface-container-lowest disabled:opacity-50"
                        >
                          {statusOptions.map((s) => (
                            <option key={s} value={s}>
                              {TUTOR_STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <Pagination page={page} pageSize={PAGE_SIZE} total={visibleTutors.length} onPageChange={setPage} itemLabel="преподавателей" />
        </div>
      </div>

      {/* Модалка добавления преподавателя — доступна и owner, и branch_owner */}
      {showAddModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAddModal(false)}>
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Добавить преподавателя</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-surface-container-high rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {createdCreds ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-green-100 text-green-800 font-label-md text-label-md">
                  Преподаватель создан. Данные для входа отправлены на почту{createdCreds.temp_password ? " и приведены ниже" : ""}.
                </div>
                <div className="text-label-md text-on-surface-variant space-y-1">
                  <div>Email: <span className="font-bold text-on-surface">{createdCreds.email}</span></div>
                  {createdCreds.temp_password && (
                    <div>Временный пароль: <span className="font-bold text-on-surface">{createdCreds.temp_password}</span></div>
                  )}
                </div>
                {createdCreds.warning && (
                  <div className="p-3 rounded-lg bg-amber-100 text-amber-800 font-label-md text-label-md">
                    {createdCreds.warning}
                  </div>
                )}
                <button
                  onClick={() => setShowAddModal(false)}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all"
                >
                  Готово
                </button>
              </div>
            ) : (
              <form onSubmit={handleAddTeacher} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Фамилия *</label>
                    <input
                      required
                      value={addForm.last_name}
                      onChange={(e) => setAddForm((f) => ({ ...f, last_name: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Имя *</label>
                    <input
                      required
                      value={addForm.first_name}
                      onChange={(e) => setAddForm((f) => ({ ...f, first_name: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Отчество</label>
                  <input
                    value={addForm.patronymic}
                    onChange={(e) => setAddForm((f) => ({ ...f, patronymic: e.target.value }))}
                    className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Email *</label>
                    <input
                      required
                      type="email"
                      value={addForm.email}
                      onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Телефон</label>
                    <input
                      value={addForm.phone}
                      onChange={(e) => setAddForm((f) => ({ ...f, phone: sanitizePhoneInput(e.target.value) }))}
                      placeholder="+7..."
                      inputMode="tel"
                      type="tel"
                      pattern="^\+?\d{10,15}$"
                      title="10-15 цифр, можно с ведущим +"
                      maxLength={16}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Филиал *</label>
                  {isOwner ? (
                    <select
                      required
                      value={addForm.branch_id}
                      onChange={(e) => setAddForm((f) => ({ ...f, branch_id: e.target.value, course_ids: [] }))}
                      className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-label-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                    >
                      <option value="">Выберите филиал</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name || b.city}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-label-md text-on-surface-variant">
                      {user?.branch_name || `Филиал #${user?.branch_id}`}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-on-surface-variant mb-1">Курсы</label>
                  <p className="text-[12px] text-on-surface-variant mb-2">
                    Преподаватель будет закреплён сразу за несколькими выбранными курсами этого филиала и увидит
                    только тех учеников, которые на них записаны. Курсы можно закрепить и позже, со страницы курса.
                  </p>
                  {!addForm.branch_id && (
                    <p className="text-[12px] text-on-surface-variant italic">Сначала выберите филиал.</p>
                  )}
                  {addForm.branch_id && addFormCoursesLoading && (
                    <p className="text-[12px] text-on-surface-variant italic">Загрузка курсов...</p>
                  )}
                  {addForm.branch_id && !addFormCoursesLoading && addFormCourses.length === 0 && (
                    <p className="text-[12px] text-on-surface-variant italic">
                      В этом филиале пока нет курсов — преподавателя можно создать уже сейчас, а курсы закрепить за
                      ним позже, когда они появятся.
                    </p>
                  )}
                  {addFormCourses.length > 0 && (
                    <div className="border border-outline-variant rounded-lg divide-y divide-outline-variant max-h-48 overflow-y-auto">
                      {addFormCourses.map((c) => (
                        <label
                          key={c.id}
                          className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-container-high transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={addForm.course_ids.includes(c.id)}
                            onChange={() => toggleAddFormCourse(c.id)}
                            className="w-4 h-4 accent-primary"
                          />
                          <span className="text-label-md text-on-surface">
                            {c.title} <span className="text-on-surface-variant">· {c.subject}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {addStatus && addStatus !== "saving" && addStatus !== "done" && (
                  <p className="text-sm text-error">{addStatus}</p>
                )}

                <button
                  type="submit"
                  disabled={addStatus === "saving"}
                  className="w-full bg-primary text-on-primary py-3 rounded-lg font-bold hover:brightness-110 transition-all disabled:opacity-60"
                >
                  {addStatus === "saving" ? "Сохранение..." : "Создать преподавателя"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
