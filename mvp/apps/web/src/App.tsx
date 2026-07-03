// apps/web/src/App.tsx —— 路由表 + AuthProvider 包裹（TECH-WEB-AUTH-USER-001 §7）
// /login 与 /users 均经 RouteGuard 判定（AC-F1-7 已登录访问 /login → 跳 /users；AC-F6-1 未登录访问 /users → 跳 /login）。
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.js';
import { RouteGuard } from './auth/RouteGuard.js';
import { LoginPage } from './pages/LoginPage.js';
import { UserListPage } from './pages/UserListPage.js';

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
        <Route path="/" element={<Navigate to="/users" replace />} />
        <Route path="*" element={<Navigate to="/users" replace />} />
      </Routes>
    </AuthProvider>
  );
}
