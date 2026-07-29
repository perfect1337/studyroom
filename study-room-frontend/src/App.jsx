import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.jsx";
import ProtectedRoute from "./components/routing/ProtectedRoute.jsx";

import LoginPage from "./pages/auth/LoginPage.jsx";
import RegisterPage from "./pages/auth/RegisterPage.jsx";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage.jsx";

import StudentOverview from "./pages/student/StudentOverview.jsx";
import StudentHomework from "./pages/student/StudentHomework.jsx";
import StudentTests from "./pages/student/StudentTests.jsx";
import StudentGrades from "./pages/student/StudentGrades.jsx";
import StudentSchedule from "./pages/student/StudentSchedule.jsx";
import StudentCourses from "./pages/student/StudentCourses.jsx";
import StudentProfile from "./pages/student/StudentProfile.jsx";

import TutorOverview from "./pages/tutor/TutorOverview.jsx";
import TutorStudents from "./pages/tutor/TutorStudents.jsx";
import TutorStudentDetail from "./pages/tutor/TutorStudentDetail.jsx";
import TutorNewLesson from "./pages/tutor/TutorNewLesson.jsx";
import TutorSchedule from "./pages/tutor/TutorSchedule.jsx";
import TutorHomework from "./pages/tutor/TutorHomework.jsx";
import TutorTests from "./pages/tutor/TutorTests.jsx";

import ParentOverview from "./pages/parent/ParentOverview.jsx";
import ParentChildren from "./pages/parent/ParentChildren.jsx";
import ParentChildDetail from "./pages/parent/ParentChildDetail.jsx";
import ParentSchedule from "./pages/parent/ParentSchedule.jsx";
import ParentContracts from "./pages/parent/ParentContracts.jsx";

import AdminOverview from "./pages/admin/AdminOverview.jsx";
import AdminStudents from "./pages/admin/AdminStudents.jsx";
import AdminStudentDetail from "./pages/admin/AdminStudentDetail.jsx";
import AdminFinance from "./pages/admin/AdminFinance.jsx";
import AdminTeachers from "./pages/admin/AdminTeachers.jsx";
import AdminTeacherDetail from "./pages/admin/AdminTeacherDetail.jsx";
import AdminSchedule from "./pages/admin/AdminSchedule.jsx";
import BranchOverview from "./pages/admin/BranchOverview.jsx";
import BranchStudents from "./pages/admin/BranchStudents.jsx";
import BranchStudentDetail from "./pages/admin/BranchStudentDetail.jsx";
import BranchTeachers from "./pages/admin/BranchTeachers.jsx";
import BranchTeacherDetail from "./pages/admin/BranchTeacherDetail.jsx";
import BranchSchedule from "./pages/admin/BranchSchedule.jsx";
import AdminBranches from "./pages/admin/AdminBranches.jsx";
import AdminCourses from "./pages/admin/AdminCourses.jsx";

import PlaceholderPage from "./components/ui/PlaceholderPage.jsx";
import SettingsPage from "./pages/settings/SettingsPage.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
          <Route path="/branch/settings" element={<ProtectedRoute roles={["branch_owner"]}><SettingsPage role="branch_owner" /></ProtectedRoute>} />

          {/* 404 */}
          <Route path="*" element={<PlaceholderPage title="Страница не найдена" />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
