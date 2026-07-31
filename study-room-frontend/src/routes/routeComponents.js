import { lazy } from "react";

// lazy(), у которого дополнительно есть .preload() — тот же factory,
// вызванный заранее (например, при наведении на пункт меню), кладёт чанк
// в кэш модулей браузера. Когда реальная навигация происходит позже,
// React.lazy находит уже разрешённый промис и НЕ показывает Suspense-fallback —
// именно это убирает "мерцание" (blank-экран) при переходах между разделами.
function lazyPreload(factory) {
  let promise;
  const load = () => {
    if (!promise) promise = factory();
    return promise;
  };
  const Component = lazy(load);
  Component.preload = load;
  return Component;
}

export const StudentOverview = lazyPreload(() => import("../pages/student/StudentOverview.jsx"));
export const StudentHomework = lazyPreload(() => import("../pages/student/StudentHomework.jsx"));
export const StudentTests = lazyPreload(() => import("../pages/student/StudentTests.jsx"));
export const StudentGrades = lazyPreload(() => import("../pages/student/StudentGrades.jsx"));
export const StudentSchedule = lazyPreload(() => import("../pages/student/StudentSchedule.jsx"));
export const StudentCourses = lazyPreload(() => import("../pages/student/StudentCourses.jsx"));
export const StudentProfile = lazyPreload(() => import("../pages/student/StudentProfile.jsx"));

export const TutorOverview = lazyPreload(() => import("../pages/tutor/TutorOverview.jsx"));
export const TutorStudents = lazyPreload(() => import("../pages/tutor/TutorStudents.jsx"));
export const TutorStudentDetail = lazyPreload(() => import("../pages/tutor/TutorStudentDetail.jsx"));
export const TutorNewLesson = lazyPreload(() => import("../pages/tutor/TutorNewLesson.jsx"));
export const TutorSchedule = lazyPreload(() => import("../pages/tutor/TutorSchedule.jsx"));
export const TutorHomework = lazyPreload(() => import("../pages/tutor/TutorHomework.jsx"));
export const TutorTests = lazyPreload(() => import("../pages/tutor/TutorTests.jsx"));

export const ParentOverview = lazyPreload(() => import("../pages/parent/ParentOverview.jsx"));
export const ParentChildren = lazyPreload(() => import("../pages/parent/ParentChildren.jsx"));
export const ParentChildDetail = lazyPreload(() => import("../pages/parent/ParentChildDetail.jsx"));
export const ParentSchedule = lazyPreload(() => import("../pages/parent/ParentSchedule.jsx"));
export const ParentContracts = lazyPreload(() => import("../pages/parent/ParentContracts.jsx"));

export const AdminOverview = lazyPreload(() => import("../pages/admin/AdminOverview.jsx"));
export const AdminStudents = lazyPreload(() => import("../pages/admin/AdminStudents.jsx"));
export const AdminStudentDetail = lazyPreload(() => import("../pages/admin/AdminStudentDetail.jsx"));
export const AdminFinance = lazyPreload(() => import("../pages/admin/AdminFinance.jsx"));
export const AdminTeachers = lazyPreload(() => import("../pages/admin/AdminTeachers.jsx"));
export const AdminTeacherDetail = lazyPreload(() => import("../pages/admin/AdminTeacherDetail.jsx"));
export const AdminSchedule = lazyPreload(() => import("../pages/admin/AdminSchedule.jsx"));
export const BranchOverview = lazyPreload(() => import("../pages/admin/BranchOverview.jsx"));
export const BranchStudents = lazyPreload(() => import("../pages/admin/BranchStudents.jsx"));
export const BranchStudentDetail = lazyPreload(() => import("../pages/admin/BranchStudentDetail.jsx"));
export const BranchTeachers = lazyPreload(() => import("../pages/admin/BranchTeachers.jsx"));
export const BranchTeacherDetail = lazyPreload(() => import("../pages/admin/BranchTeacherDetail.jsx"));
export const BranchSchedule = lazyPreload(() => import("../pages/admin/BranchSchedule.jsx"));
export const BranchCourses = lazyPreload(() => import("../pages/admin/BranchCourses.jsx"));
export const AdminBranches = lazyPreload(() => import("../pages/admin/AdminBranches.jsx"));
export const AdminCourses = lazyPreload(() => import("../pages/admin/AdminCourses.jsx"));

export const SettingsPage = lazyPreload(() => import("../pages/settings/SettingsPage.jsx"));

// path -> lazy-компонент, чтобы можно было прогреть чанк заранее по known-пути
// (используется в Sidebar/MobileBottomNav при наведении/тапе на пункт меню).
export const ROUTE_COMPONENT_BY_PATH = {
  "/student": StudentOverview,
  "/student/schedule": StudentSchedule,
  "/student/courses": StudentCourses,
  "/student/homework": StudentHomework,
  "/student/tests": StudentTests,
  "/student/grades": StudentGrades,
  "/student/profile": StudentProfile,
  "/student/settings": SettingsPage,

  "/tutor": TutorOverview,
  "/tutor/students": TutorStudents,
  "/tutor/schedule": TutorSchedule,
  "/tutor/schedule/new": TutorNewLesson,
  "/tutor/homework": TutorHomework,
  "/tutor/tests": TutorTests,
  "/tutor/settings": SettingsPage,

  "/parent": ParentOverview,
  "/parent/children": ParentChildren,
  "/parent/schedule": ParentSchedule,
  "/parent/contracts": ParentContracts,
  "/parent/settings": SettingsPage,

  "/admin": AdminOverview,
  "/admin/students": AdminStudents,
  "/admin/teachers": AdminTeachers,
  "/admin/schedule": AdminSchedule,
  "/admin/finance": AdminFinance,
  "/admin/branches": AdminBranches,
  "/admin/courses": AdminCourses,
  "/admin/settings": SettingsPage,

  "/branch": BranchOverview,
  "/branch/students": BranchStudents,
  "/branch/teachers": BranchTeachers,
  "/branch/schedule": BranchSchedule,
  "/branch/courses": BranchCourses,
  "/branch/settings": SettingsPage,
};

// role (значение пропа DashboardShell/Sidebar, см. NAV_ITEMS в Sidebar.jsx) -> базовый путь раздела.
export const ROLE_SECTION_PREFIX = {
  student: "/student",
  tutor: "/tutor",
  parent: "/parent",
  admin: "/admin",
  branch_owner: "/branch",
};

/** Прогреть чанк конкретного маршрута (используется при hover/focus/touchstart на ссылке). */
export function preloadRoute(path) {
  ROUTE_COMPONENT_BY_PATH[path]?.preload?.();
}

/** Прогреть все маршруты одной роли — вызывается один раз в фоне (idle) после входа,
 * чтобы дальнейшая навигация внутри раздела была мгновенной без единого мерцания. */
export function preloadRoleRoutes(prefix) {
  Object.entries(ROUTE_COMPONENT_BY_PATH).forEach(([path, Component]) => {
    if (path === prefix || path.startsWith(`${prefix}/`)) Component.preload?.();
  });
}
