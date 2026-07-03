// apps/web/src/auth/RouteGuard.tsx —— 路由守卫组件（TECH-WEB-AUTH-USER-001 §5.2 D13）
//
// 职责：
//   - !isAuthenticated && path !== '/login' → <Navigate to="/login" />（AC-F6-1/3/4）
//   - isAuthenticated && path === '/login' → <Navigate to="/users" />（AC-F1-7）
//   - 白名单仅 /login（Q7 决策①），其余路由均须登录
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（AuthContext）+ react-router-dom。
// [约束] D13：白名单仅 /login。用 useLocation 读 path，useAuth 读 isAuthenticated。
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.js';

/** RouteGuard 组件：包裹受保护路由 element，根据登录态 + 当前 path 决定 Navigate/render children。 */
export function RouteGuard(props: { children: ReactNode }): JSX.Element {
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();

  // 多约束组合：未登录非白名单 → 跳 /login（AC-F6-1/3/4）
  if (!isAuthenticated && pathname !== '/login') {
    return <Navigate to="/login" replace />;
  }
  // 已登录访问 /login → 跳 /users（AC-F1-7）
  if (isAuthenticated && pathname === '/login') {
    return <Navigate to="/users" replace />;
  }
  return <>{props.children}</>;
}
