import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.jsx";
import ProtectedRoute from "./components/routing/ProtectedRoute.jsx";

import LoginPage from "./pages/auth/LoginPage.jsx";
import RegisterPage from "./pages/auth/RegisterPage.jsx";

import StudentOverview from "./pages/student/StudentOverview.jsx";
import StudentHomework from "./pages/student/StudentHomework.jsx";
import StudentSchedule from "./pages/student/StudentSchedule.jsx";

import TutorOverview from "./pages/tutor/TutorOverview.jsx";
import TutorStudents from "./pages/tutor/TutorStudents.jsx";
import TutorNewLesson from "./pages/tutor/TutorNewLesson.jsx";
import TutorSchedule from "./pages/tutor/TutorSchedule.jsx";

import ParentOverview from "./pages/parent/ParentOverview.jsx";
import ParentChildDetail from "./pages/parent/ParentChildDetail.jsx";
import ParentSchedule from "./pages/parent/ParentSchedule.jsx";

import AdminOverview from "./pages/admin/AdminOverview.jsx";
import AdminStudents from "./pages/admin/AdminStudents.jsx";
import AdminFinance from "./pages/admin/AdminFinance.jsx";
import AdminTeachers from "./pages/admin/AdminTeachers.jsx";
import BranchOverview from "./pages/admin/BranchOverview.jsx";
import BranchTeachers from "./pages/admin/BranchTeachers.jsx";

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

          {/* Ученик (role: student) */}
          <Route path="/student" element={<ProtectedRoute roles={["student"]}><StudentOverview /></ProtectedRoute>} />
          <Route path="/student/schedule" element={<ProtectedRoute roles={["student"]}><StudentSchedule /></ProtectedRoute>} />
          <Route path="/student/courses" element={<ProtectedRoute roles={["student"]}><PlaceholderPage title="Курсы ученика" /></ProtectedRoute>} />
          <Route path="/student/homework" element={<ProtectedRoute roles={["student"]}><StudentHomework /></ProtectedRoute>} />
          <Route path="/student/profile" element={<ProtectedRoute roles={["student"]}><PlaceholderPage title="Профиль ученика" /></ProtectedRoute>} />
          <Route path="/student/settings" element={<ProtectedRoute roles={["student"]}><SettingsPage role="student" /></ProtectedRoute>} />

          {/* Репетитор (role: tutor) */}
          <Route path="/tutor" element={<ProtectedRoute roles={["tutor"]}><TutorOverview /></ProtectedRoute>} />
          <Route path="/tutor/students" element={<ProtectedRoute roles={["tutor"]}><TutorStudents /></ProtectedRoute>} />
          <Route path="/tutor/schedule" element={<ProtectedRoute roles={["tutor"]}><TutorSchedule /></ProtectedRoute>} />
          <Route path="/tutor/schedule/new" element={<ProtectedRoute roles={["tutor"]}><TutorNewLesson /></ProtectedRoute>} />
          <Route path="/tutor/homework" element={<ProtectedRoute roles={["tutor"]}><PlaceholderPage title="Домашние задания (репетитор)" /></ProtectedRoute>} />
          <Route path="/tutor/settings" element={<ProtectedRoute roles={["tutor"]}><SettingsPage role="tutor" /></ProtectedRoute>} />

          {/* Родитель (role: parent) */}
          <Route path="/parent" element={<ProtectedRoute roles={["parent"]}><ParentOverview /></ProtectedRoute>} />
          <Route path="/parent/children" element={<Navigate to="/parent" replace />} />
          <Route path="/parent/children/:childId" element={<ProtectedRoute roles={["parent"]}><ParentChildDetail /></ProtectedRoute>} />
          <Route path="/parent/schedule" element={<ProtectedRoute roles={["parent"]}><ParentSchedule /></ProtectedRoute>} />
          <Route path="/parent/settings" element={<ProtectedRoute roles={["parent"]}><SettingsPage role="parent" /></ProtectedRoute>} />

          {/* Владелец сети филиалов (role: owner) — раздел /admin */}
          <Route path="/admin" element={<ProtectedRoute roles={["owner"]}><AdminOverview /></ProtectedRoute>} />
          <Route path="/admin/students" element={<ProtectedRoute roles={["owner"]}><AdminStudents /></ProtectedRoute>} />
          <Route path="/admin/teachers" element={<ProtectedRoute roles={["owner"]}><AdminTeachers /></ProtectedRoute>} />
          <Route path="/admin/finance" element={<ProtectedRoute roles={["owner"]}><AdminFinance /></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute roles={["owner"]}><SettingsPage role="owner" /></ProtectedRoute>} />

          {/* Управляющий филиалом (role: branch_owner) — отдельный раздел /branch */}
          <Route path="/branch" element={<ProtectedRoute roles={["branch_owner"]}><BranchOverview /></ProtectedRoute>} />
          <Route path="/branch/students" element={<ProtectedRoute roles={["branch_owner"]}><PlaceholderPage title="Студенты филиала" /></ProtectedRoute>} />
          <Route path="/branch/teachers" element={<ProtectedRoute roles={["branch_owner"]}><BranchTeachers /></ProtectedRoute>} />
          <Route path="/branch/settings" element={<ProtectedRoute roles={["branch_owner"]}><SettingsPage role="branch_owner" /></ProtectedRoute>} />

          {/* 404 */}
          <Route path="*" element={<PlaceholderPage title="Страница не найдена" />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
