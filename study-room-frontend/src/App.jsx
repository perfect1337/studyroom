import { Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth, ROLE_HOME_ROUTE } from "./context/AuthContext.jsx";
import ProtectedRoute from "./components/routing/ProtectedRoute.jsx";
import RouteFallback from "./components/routing/RouteFallback.jsx";
import ErrorBoundary from "./components/routing/ErrorBoundary.jsx";
import CookieConsentBanner from "./components/ui/CookieConsentBanner.jsx";

// Логин/регистрация нужны всем при первом заходе — грузим сразу, без lazy,
// чтобы не добавлять лишний сетевой скачок на самом первом экране приложения.
import LoginPage from "./pages/auth/LoginPage.jsx";
import RegisterPage from "./pages/auth/RegisterPage.jsx";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage.jsx";
import PlaceholderPage from "./components/ui/PlaceholderPage.jsx";

// Все остальные страницы — по одному чанку на маршрут (React.lazy + Vite).
// Раньше это были статические импорты: ученик при первом заходе скачивал JS
// админ-таблиц, финансовых отчётов и разделов тьютора/родителя, которые ему
// никогда не понадобятся. Теперь бандл каждой роли подгружается только тогда,
// когда пользователь реально переходит на соответствующий маршрут.
//
// Сами lazy()-компоненты вынесены в routes/routeComponents.js (а не объявлены
// здесь), потому что Sidebar/MobileBottomNav прогревают (preload) те же чанки
// по наведению/тапу на пункт меню — без общего реестра это был бы дубль-код
// и два разных Suspense-промиса на один и тот же чанк.
import {
  StudentOverview,
  StudentHomework,
  StudentTests,
  StudentGrades,
  StudentSchedule,
  StudentCourses,
  StudentProfile,
  TutorOverview,
  TutorStudents,
  TutorStudentDetail,
  TutorNewLesson,
  TutorSchedule,
  TutorHomework,
  TutorTests,
  ParentOverview,
  ParentChildren,
  ParentChildDetail,
  ParentSchedule,
  ParentContracts,
  AdminOverview,
  AdminStudents,
  AdminParents,
  AdminStudentDetail,
  AdminFinance,
  AdminTeachers,
  AdminTeacherDetail,
  AdminSchedule,
  BranchOverview,
  BranchStudents,
  BranchStudentDetail,
  BranchTeachers,
  BranchTeacherDetail,
  BranchSchedule,
  BranchCourses,
  BranchFinance,
  AdminBranches,
  AdminCourses,
  SettingsPage,
} from "./routes/routeComponents.js";

// Универсальная ссылка для Tilda: авторизованный пользователь попадает
// в свой раздел/профиль, неавторизованный — на вход с сохранением исходного URL.
function ProfileRedirect() {
  const { user, loading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (loading) return <RouteFallback />;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const profileRoute = {
    student: "/student/profile",
  }[user.role];

  return <Navigate to={profileRoute ?? ROLE_HOME_ROUTE[user.role] ?? "/login"} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        {/* Вне ErrorBoundary/Suspense маршрутов намеренно — согласие на куки
            должно быть видно на КАЖДОЙ странице (включая /login и /register,
            до входа в аккаунт), а не зависеть от того, какой раздел успел
            догрузиться. См. components/ui/CookieConsentBanner.jsx. */}
        <CookieConsentBanner />
      </AuthProvider>
    </BrowserRouter>
  );
}

// Вынесено в отдельный компонент, а не написано прямо в App: useLocation()
// можно вызывать только внутри <BrowserRouter>, а сам App его и рендерит.
// location.pathname используется как resetKey для ErrorBoundary — уход с
// упавшей страницы на другой маршрут сбрасывает состояние ошибки, вместо
// того чтобы навсегда держать всё приложение на экране "Что-то пошло не так".
function AppRoutes() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
            {/* Точка входа — единая страница логина для всех ролей (см. ТЗ п.6.1) */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/profile" element={<ProfileRedirect />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* Ученик (role: student) */}
            <Route path="/student" element={<ProtectedRoute roles={["student"]}><StudentOverview /></ProtectedRoute>} />
            <Route path="/student/schedule" element={<ProtectedRoute roles={["student"]}><StudentSchedule /></ProtectedRoute>} />
            <Route path="/student/courses" element={<ProtectedRoute roles={["student"]}><StudentCourses /></ProtectedRoute>} />
            <Route path="/student/homework" element={<ProtectedRoute roles={["student"]}><StudentHomework /></ProtectedRoute>} />
            <Route path="/student/tests" element={<ProtectedRoute roles={["student"]}><StudentTests /></ProtectedRoute>} />
            <Route path="/student/grades" element={<ProtectedRoute roles={["student"]}><StudentGrades /></ProtectedRoute>} />
            <Route path="/student/profile" element={<ProtectedRoute roles={["student"]}><StudentProfile /></ProtectedRoute>} />
            <Route path="/student/settings" element={<ProtectedRoute roles={["student"]}><SettingsPage role="student" /></ProtectedRoute>} />

            {/* Репетитор (role: tutor) */}
            <Route path="/tutor" element={<ProtectedRoute roles={["tutor"]}><TutorOverview /></ProtectedRoute>} />
            <Route path="/tutor/students" element={<ProtectedRoute roles={["tutor"]}><TutorStudents /></ProtectedRoute>} />
            <Route path="/tutor/students/:studentId" element={<ProtectedRoute roles={["tutor"]}><TutorStudentDetail /></ProtectedRoute>} />
            <Route path="/tutor/schedule" element={<ProtectedRoute roles={["tutor"]}><TutorSchedule /></ProtectedRoute>} />
            <Route path="/tutor/schedule/new" element={<ProtectedRoute roles={["tutor"]}><TutorNewLesson /></ProtectedRoute>} />
            <Route path="/tutor/homework" element={<ProtectedRoute roles={["tutor"]}><TutorHomework /></ProtectedRoute>} />
            <Route path="/tutor/tests" element={<ProtectedRoute roles={["tutor"]}><TutorTests /></ProtectedRoute>} />
            <Route path="/tutor/settings" element={<ProtectedRoute roles={["tutor"]}><SettingsPage role="tutor" /></ProtectedRoute>} />

            {/* Родитель (role: parent) */}
            <Route path="/parent" element={<ProtectedRoute roles={["parent"]}><ParentOverview /></ProtectedRoute>} />
            <Route path="/parent/children" element={<ProtectedRoute roles={["parent"]}><ParentChildren /></ProtectedRoute>} />
            <Route path="/parent/children/:childId" element={<ProtectedRoute roles={["parent"]}><ParentChildDetail /></ProtectedRoute>} />
            <Route path="/parent/schedule" element={<ProtectedRoute roles={["parent"]}><ParentSchedule /></ProtectedRoute>} />
            <Route path="/parent/contracts" element={<ProtectedRoute roles={["parent"]}><ParentContracts /></ProtectedRoute>} />
            <Route path="/parent/settings" element={<ProtectedRoute roles={["parent"]}><SettingsPage role="parent" /></ProtectedRoute>} />

            {/* Владелец сети филиалов (role: owner) — раздел /admin */}
            <Route path="/admin" element={<ProtectedRoute roles={["owner"]}><AdminOverview /></ProtectedRoute>} />
            <Route path="/admin/students" element={<ProtectedRoute roles={["owner"]}><AdminStudents /></ProtectedRoute>} />
            <Route path="/admin/parents" element={<ProtectedRoute roles={["owner"]}><AdminParents /></ProtectedRoute>} />
            <Route path="/admin/students/:studentId" element={<ProtectedRoute roles={["owner"]}><AdminStudentDetail /></ProtectedRoute>} />
            <Route path="/admin/teachers" element={<ProtectedRoute roles={["owner"]}><AdminTeachers /></ProtectedRoute>} />
            <Route path="/admin/teachers/:teacherId" element={<ProtectedRoute roles={["owner"]}><AdminTeacherDetail /></ProtectedRoute>} />
            <Route path="/admin/schedule" element={<ProtectedRoute roles={["owner"]}><AdminSchedule /></ProtectedRoute>} />
            <Route path="/admin/finance" element={<ProtectedRoute roles={["owner"]}><AdminFinance /></ProtectedRoute>} />
            <Route path="/admin/branches" element={<ProtectedRoute roles={["owner"]}><AdminBranches /></ProtectedRoute>} />
            <Route path="/admin/courses" element={<ProtectedRoute roles={["owner"]}><AdminCourses /></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute roles={["owner"]}><SettingsPage role="owner" /></ProtectedRoute>} />

            {/* Управляющий филиалом (role: branch_owner) — отдельный раздел /branch */}
            <Route path="/branch" element={<ProtectedRoute roles={["branch_owner"]}><BranchOverview /></ProtectedRoute>} />
            <Route path="/branch/students" element={<ProtectedRoute roles={["branch_owner"]}><BranchStudents /></ProtectedRoute>} />
            <Route path="/branch/students/:studentId" element={<ProtectedRoute roles={["branch_owner"]}><BranchStudentDetail /></ProtectedRoute>} />
            <Route path="/branch/teachers" element={<ProtectedRoute roles={["branch_owner"]}><BranchTeachers /></ProtectedRoute>} />
            <Route path="/branch/teachers/:teacherId" element={<ProtectedRoute roles={["branch_owner"]}><BranchTeacherDetail /></ProtectedRoute>} />
            <Route path="/branch/schedule" element={<ProtectedRoute roles={["branch_owner"]}><BranchSchedule /></ProtectedRoute>} />
            <Route path="/branch/courses" element={<ProtectedRoute roles={["branch_owner"]}><BranchCourses /></ProtectedRoute>} />
            <Route path="/branch/finance" element={<ProtectedRoute roles={["branch_owner"]}><BranchFinance /></ProtectedRoute>} />
            <Route path="/branch/settings" element={<ProtectedRoute roles={["branch_owner"]}><SettingsPage role="branch_owner" /></ProtectedRoute>} />

            {/* 404 */}
            <Route path="*" element={<PlaceholderPage title="Страница не найдена" />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
