// apps/web/src/auth/RouteGuard.tsx —— 路由守卫组件（TECH-WEB-AUTH-USER-001 §5.2 D13）
//
// 职责（impl-writer 落地，本文件为 stub）：
//   - !isAuthenticated && path !== '/login' → <Navigate to="/login" />（AC-F6-1/3/4）
//   - isAuthenticated && path === '/login' → <Navigate to="/users" />（AC-F1-7）
//   - 白名单仅 /login（Q7 决策①），其余路由均须登录
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（AuthContext）+ react-router-dom。
// [约束] D13：白名单仅 /login。impl-writer 用 useLocation 读 path，useAuth 读 isAuthenticated。
import type { ReactNode } from 'react';

/** RouteGuard 组件：包裹受保护路由。stub 抛 NOT_IMPLEMENTED。 */
export function RouteGuard(_props: { children: ReactNode }): JSX.Element {
  throw new Error('NOT_IMPLEMENTED');
}
