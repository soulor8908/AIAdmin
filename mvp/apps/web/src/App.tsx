// apps/web/src/App.tsx —— 路由表 + AuthProvider 包裹（TECH-WEB-AUTH-USER-001 §7）
// 最小实现：路由表引用 stub 组件（impl-writer 落地后组件可渲染）。
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.js';
import { RouteGuard } from './auth/RouteGuard.js';
import { LoginPage } from './pages/LoginPage.js';
import { UserListPage } from './pages/UserListPage.js';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/users" element={<RouteGuard><UserListPage /></RouteGuard>} />
        <Route path="/" element={<Navigate to="/users" replace />} />
        <Route path="*" element={<Navigate to="/users" replace />} />
      </Routes>
    </AuthProvider>
  );
}
