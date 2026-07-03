// apps/web/src/App.tsx —— 路由表 + AuthProvider 包裹（TECH-WEB-AUTH-USER-001 §7 + TECH-WEB-ROLE-DEPT-AUDIT-001 §6 路由扩展 + TECH-WEB-NOTIFICATION-REPORT-001 §7）
// /login /users /roles /departments /audit-logs /notifications /reports 均经 RouteGuard 判定（AC-F6-1 未登录访问 → 跳 /login，白名单仅 /login）。
// AC-F8-3：未登录访问 /roles /departments /audit-logs /notifications /reports → RouteGuard 跳 /login（白名单仍仅 /login）。
// R15 扩展：新增 /notifications /reports 两条 RouteGuard 包裹的路由（§7，AC-F8-1 6 入口路由侧落点）。
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.js';
import { RouteGuard } from './auth/RouteGuard.js';
import { LoginPage } from './pages/LoginPage.js';
import { UserListPage } from './pages/UserListPage.js';
import { RoleListPage } from './pages/RoleListPage.js';
import { DeptTreePage } from './pages/DeptTreePage.js';
import { AuditLogPage } from './pages/AuditLogPage.js';
import { NotificationListPage } from './pages/NotificationListPage.js';  // + R15
import { ReportPage } from './pages/ReportPage.js';                       // + R15

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="/login"
          element={
            <RouteGuard>
              <LoginPage />
            </RouteGuard>
          }
        />
        <Route
          path="/users"
          element={
            <RouteGuard>
              <UserListPage />
            </RouteGuard>
          }
        />
        <Route
          path="/roles"
          element={
            <RouteGuard>
              <RoleListPage />
            </RouteGuard>
          }
        />
        <Route
          path="/departments"
          element={
            <RouteGuard>
              <DeptTreePage />
            </RouteGuard>
          }
        />
        <Route
          path="/audit-logs"
          element={
            <RouteGuard>
              <AuditLogPage />
            </RouteGuard>
          }
        />
        {/* + R15 §7：通知/报表路由，AC-F8-1 6 入口路由侧落点 */}
        <Route
          path="/notifications"
          element={
            <RouteGuard>
              <NotificationListPage />
            </RouteGuard>
          }
        />
        <Route
          path="/reports"
          element={
            <RouteGuard>
              <ReportPage />
            </RouteGuard>
          }
        />
        <Route path="/" element={<Navigate to="/users" replace />} />
        <Route path="*" element={<Navigate to="/users" replace />} />
      </Routes>
    </AuthProvider>
  );
}
