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
    ...extra,
  };
}

export function fullName(user) {
  if (!user) return "";
  return [user.last_name, user.first_name, user.patronymic].filter(Boolean).join(" ");
}
