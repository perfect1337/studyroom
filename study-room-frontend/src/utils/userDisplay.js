// Sidebar/TopBar (унаследованные от мок-версии) ждут { id, name, avatarUrl, childrenCount },
// а бэкенд отдаёт пользователя в формате { id, first_name, last_name, avatar_url, ... }
// (см. api-contracts.md, п.1.6). Этот хелпер приводит одно к другому в одном месте,
// вместо того чтобы дублировать маппинг на каждой странице.
export function toSidebarUser(user, extra = {}) {
  if (!user) return null;
  return {
    id: user.id,
    name: [user.last_name, user.first_name].filter(Boolean).join(" ") || user.email,
    avatarUrl: user.avatar_url,
    branchName: user.branch_name,
    branchIds: user.branch_ids || (user.branch_id ? [user.branch_id] : []),
    // role/isTutor — настоящая роль пользователя из JWT/профиля (а не
    // визуальная роль страницы, которая передаётся в Sidebar отдельным
    // проп'ом `role`). Нужны Sidebar'у, чтобы отличить владельца филиала,
    // открывшего "версию учителя" (role: branch_owner, isTutor: true,
    // но Sidebar рендерится с role="tutor"), от настоящего tutor'а — и
    // показать кнопку переключения обратно в панель филиала.
    // См. Sidebar.jsx: FooterLinks/teacherToggle.
    role: user.role,
    isTutor: !!user.is_tutor,
    ...extra,
  };
}

export function fullName(user) {
  if (!user) return "";
  return [user.last_name, user.first_name, user.patronymic].filter(Boolean).join(" ");
}
