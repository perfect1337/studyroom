import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.jsx";
import ProtectedRoute from "./components/routing/ProtectedRoute.jsx";
import RouteFallback from "./components/routing/RouteFallback.jsx";

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

const StudentOverview = lazy(() => import("./pages/student/StudentOverview.jsx"));
const StudentHomework = lazy(() => import("./pages/student/StudentHomework.jsx"));
const StudentTests = lazy(() => import("./pages/student/StudentTests.jsx"));
const StudentGrades = lazy(() => import("./pages/student/StudentGrades.jsx"));
const StudentSchedule = lazy(() => import("./pages/student/StudentSchedule.jsx"));
const StudentCourses = lazy(() => import("./pages/student/StudentCourses.jsx"));
const StudentProfile = lazy(() => import("./pages/student/StudentProfile.jsx"));

const TutorOverview = lazy(() => import("./pages/tutor/TutorOverview.jsx"));
const TutorStudents = lazy(() => import("./pages/tutor/TutorStudents.jsx"));
const TutorStudentDetail = lazy(() => import("./pages/tutor/TutorStudentDetail.jsx"));
const TutorNewLesson = lazy(() => import("./pages/tutor/TutorNewLesson.jsx"));
const TutorSchedule = lazy(() => import("./pages/tutor/TutorSchedule.jsx"));
const TutorHomework = lazy(() => import("./pages/tutor/TutorHomework.jsx"));
const TutorTests = lazy(() => import("./pages/tutor/TutorTests.jsx"));

const ParentOverview = lazy(() => import("./pages/parent/ParentOverview.jsx"));
const ParentChildren = lazy(() => import("./pages/parent/ParentChildren.jsx"));
const ParentChildDetail = lazy(() => import("./pages/parent/ParentChildDetail.jsx"));
const ParentSchedule = lazy(() => import("./pages/parent/ParentSchedule.jsx"));
const ParentContracts = lazy(() => import("./pages/parent/ParentContracts.jsx"));

const AdminOverview = lazy(() => import("./pages/admin/AdminOverview.jsx"));
const AdminStudents = lazy(() => import("./pages/admin/AdminStudents.jsx"));
const AdminStudentDetail = lazy(() => import("./pages/admin/AdminStudentDetail.jsx"));
const AdminFinance = lazy(() => import("./pages/admin/AdminFinance.jsx"));
const AdminTeachers = lazy(() => import("./pages/admin/AdminTeachers.jsx"));
const AdminTeacherDetail = lazy(() => import("./pages/admin/AdminTeacherDetail.jsx"));
const AdminSchedule = lazy(() => import("./pages/admin/AdminSchedule.jsx"));
const BranchOverview = lazy(() => import("./pages/admin/BranchOverview.jsx"));
const BranchStudents = lazy(() => import("./pages/admin/BranchStudents.jsx"));
const BranchStudentDetail = lazy(() => import("./pages/admin/BranchStudentDetail.jsx"));
const BranchTeachers = lazy(() => import("./pages/admin/BranchTeachers.jsx"));
const BranchTeacherDetail = lazy(() => import("./pages/admin/BranchTeacherDetail.jsx"));
const BranchSchedule = lazy(() => import("./pages/admin/BranchSchedule.jsx"));
const BranchCourses = lazy(() => import("./pages/admin/BranchCourses.jsx"));
const AdminBranches = lazy(() => import("./pages/admin/AdminBranches.jsx"));
const AdminCourses = lazy(() => import("./pages/admin/AdminCourses.jsx"));

const SettingsPage = lazy(() => import("./pages/settings/SettingsPage.jsx"));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Точка входа — единая страница логина для всех ролей (см. ТЗ п.6.1) */}
            <Route path="/" element={<Navigate to="/login" replace />} />
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
            <Route path="/branch/settings" element={<ProtectedRoute roles={["branch_owner"]}><SettingsPage role="branch_owner" /></ProtectedRoute>} />

            {/* 404 */}
            <Route path="*" element={<PlaceholderPage title="Страница не найдена" />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
