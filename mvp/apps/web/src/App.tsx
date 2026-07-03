// apps/web/src/App.tsx —— 路由表 + AuthProvider 包裹（TECH-WEB-AUTH-USER-001 §7 + TECH-WEB-ROLE-DEPT-AUDIT-001 §6 路由扩展）
// /login /users /roles /departments /audit-logs 均经 RouteGuard 判定（AC-F6-1 未登录访问 → 跳 /login，白名单仅 /login）。
// AC-F8-3：未登录访问 /roles /departments /audit-logs → RouteGuard 跳 /login（白名单仍仅 /login）。
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.js';
import { RouteGuard } from './auth/RouteGuard.js';
import { LoginPage } from './pages/LoginPage.js';
import { UserListPage } from './pages/UserListPage.js';
import { RoleListPage } from './pages/RoleListPage.js';
import { DeptTreePage } from './pages/DeptTreePage.js';
import { AuditLogPage } from './pages/AuditLogPage.js';

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
        <Route path="/" element={<Navigate to="/users" replace />} />
        <Route path="*" element={<Navigate to="/users" replace />} />
      </Routes>
    </AuthProvider>
  );
}
