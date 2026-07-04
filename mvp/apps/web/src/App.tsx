// apps/web/src/App.tsx —— 路由表 + AuthProvider 包裹（TECH-WEB-AUTH-USER-001 §7 + TECH-WEB-ROLE-DEPT-AUDIT-001 §6 路由扩展 + TECH-WEB-NOTIFICATION-REPORT-001 §7 + TECH-WEB-TRANSFER-INHERITANCE-001 §7）
// /login /users /roles /departments /audit-logs /notifications /reports /transfer 均经 RouteGuard 判定（AC-F6-1 未登录访问 → 跳 /login，白名单仅 /login）。
// AC-F8-3：未登录访问 /roles /departments /audit-logs /notifications /reports /transfer → RouteGuard 跳 /login（白名单仍仅 /login）。
// R15 扩展：新增 /notifications /reports 两条 RouteGuard 包裹的路由（§7，AC-F8-1 6 入口路由侧落点）。
// R16 扩展：新增 /transfer 一条 RouteGuard 包裹的路由（§7，AC-F8-1 6→7 入口路由侧落点）。
//
// [约束] R22 D6 / AC-P7/P8：React.lazy + Suspense 代码分割（7 页全部按路由懒加载，首屏仅加载 /login chunk）。
//   - React.lazy 须用 .then(m => ({ default: m.XxxPage })) 转换 named export 为 default export（lazy 仅支持 default）
//   - Suspense fallback 文案"加载中..."（与既有 loading 文案一致，避免新文案破坏既有测试断言）
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.js';
import { RouteGuard } from './auth/RouteGuard.js';

// R22 D6 / AC-P7：每页独立 chunk（React.lazy 动态 import + .then 转 default export）。
const LoginPage = lazy(() => import('./pages/LoginPage.js').then((m) => ({ default: m.LoginPage })));
const UserListPage = lazy(() => import('./pages/UserListPage.js').then((m) => ({ default: m.UserListPage })));
const RoleListPage = lazy(() => import('./pages/RoleListPage.js').then((m) => ({ default: m.RoleListPage })));
const DeptTreePage = lazy(() => import('./pages/DeptTreePage.js').then((m) => ({ default: m.DeptTreePage })));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage.js').then((m) => ({ default: m.AuditLogPage })));
const NotificationListPage = lazy(() => import('./pages/NotificationListPage.js').then((m) => ({ default: m.NotificationListPage })));  // + R15
const ReportPage = lazy(() => import('./pages/ReportPage.js').then((m) => ({ default: m.ReportPage })));                       // + R15
const TransferPage = lazy(() => import('./pages/TransferPage.js').then((m) => ({ default: m.TransferPage })));                 // + R16

export function App() {
  return (
    <AuthProvider>
      {/* R22 D6 / AC-P8：Suspense fallback 文案"加载中..."（与既有 loading 文案一致，避免新文案破坏既有测试断言） */}
      <Suspense fallback={<div>加载中...</div>}>
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
          {/* + R16 §7：调岗路由，AC-F8-1 6→7 入口路由侧落点 */}
          <Route
            path="/transfer"
            element={
              <RouteGuard>
                <TransferPage />
              </RouteGuard>
            }
          />
          <Route path="/" element={<Navigate to="/users" replace />} />
          <Route path="*" element={<Navigate to="/users" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
