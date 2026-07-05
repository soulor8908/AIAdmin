// @vitest-environment jsdom
// apps/web/test/route-guard.test.tsx —— ③类新增 RouteGuard 守卫测（TECH-WEB-AUTH-USER-001 §9.3 #6）
//
// 覆盖 AC：AC-F6-1~F6-4、AC-F1-7
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + MemoryRouter。
//   - AuthContext.Provider 控制 isAuthenticated，RouteGuard 据 path + auth 决定 Navigate/render。
//   - 期望「断言级红」：RouteGuard stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D13：白名单仅 /login。未登录非 /login → 跳 /login；已登录访问 /login → 跳 /users。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RouteGuard } from '../src/auth/RouteGuard.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';

function makeAuthValue(authenticated: boolean): AuthContextValue {
  return {
    isAuthenticated: authenticated,
    token: authenticated ? 'stub-token' : null,
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * 全部受保护路由（AC-F8-1 7 入口路由侧落点）。
 * AC-F8-3：未登录访问以下任一路由 → RouteGuard 跳 /login（白名单仅 /login）。
 */
const PROTECTED_ROUTES = [
  '/users',
  '/roles',
  '/departments',
  '/audit-logs',
  '/notifications',
  '/reports',
  '/transfer',
] as const;

/** 在指定初始路径下渲染 RouteGuard 包裹的 children。 */
function renderGuard(authenticated: boolean, initialPath: string) {
  return render(
    <AuthContext.Provider value={makeAuthValue(authenticated)}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/login" element={<RouteGuard><div>login-page-content</div></RouteGuard>} />
          <Route path="/users" element={<RouteGuard><div>users-page-content</div></RouteGuard>} />
          <Route path="/roles" element={<RouteGuard><div>roles-page-content</div></RouteGuard>} />
          <Route path="/departments" element={<RouteGuard><div>departments-page-content</div></RouteGuard>} />
          <Route path="/audit-logs" element={<RouteGuard><div>audit-logs-page-content</div></RouteGuard>} />
          <Route path="/notifications" element={<RouteGuard><div>notifications-page-content</div></RouteGuard>} />
          <Route path="/reports" element={<RouteGuard><div>reports-page-content</div></RouteGuard>} />
          <Route path="/transfer" element={<RouteGuard><div>transfer-page-content</div></RouteGuard>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('RouteGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F6-1 未登录访问受保护 → 跳 /login ----------
  it('未登录（isAuthenticated=false）访问 /users → Navigate to /login（AC-F6-1）', () => {
    renderGuard(false, '/users');
    // 未登录访问 /users → RouteGuard 跳 /login → 渲染 /login 的 children
    expect(screen.getByText('login-page-content')).toBeInTheDocument();
    expect(screen.queryByText('users-page-content')).not.toBeInTheDocument();
  });

  // ---------- AC-F8-3 未登录访问 7 个受保护路由 → 全部跳 /login（白名单仅 /login）----------
  it.each(PROTECTED_ROUTES)(
    '未登录访问 %s → Navigate to /login（AC-F8-3，白名单仅 /login）',
    (route) => {
      renderGuard(false, route);
      expect(screen.getByText('login-page-content')).toBeInTheDocument();
      // 当前路由的 children 不应渲染（已跳 /login）
      const routeContent = screen.queryByText(`${route.slice(1)}-page-content`);
      expect(routeContent).not.toBeInTheDocument();
    },
  );

  // ---------- AC-F1-7 已登录访问 /login → 跳 /users ----------
  it('已登录访问 /login → Navigate to /users（AC-F1-7）', () => {
    renderGuard(true, '/login');
    expect(screen.getByText('users-page-content')).toBeInTheDocument();
    expect(screen.queryByText('login-page-content')).not.toBeInTheDocument();
  });

  // ---------- AC-F6-4 未登录访问 /login → 渲染 children（白名单）----------
  it('未登录访问 /login → 渲染 children（白名单，AC-F6-4）', () => {
    renderGuard(false, '/login');
    expect(screen.getByText('login-page-content')).toBeInTheDocument();
  });

  // ---------- AC-F6-3 登出后 → 跳 /login ----------
  it('登出后 isAuthenticated=false → 跳 /login（AC-F6-3）', () => {
    // 模拟登出后状态：isAuthenticated=false，访问 /users
    renderGuard(false, '/users');
    expect(screen.getByText('login-page-content')).toBeInTheDocument();
    expect(screen.queryByText('users-page-content')).not.toBeInTheDocument();
  });

  // ---------- AC-F8-3 已登录访问 7 个受保护路由 → 全部渲染 children（不跳转）----------
  it.each(PROTECTED_ROUTES)(
    '已登录访问 %s → 渲染 children（AC-F8-3，已登录不跳转）',
    (route) => {
      renderGuard(true, route);
      const routeContent = screen.getByText(`${route.slice(1)}-page-content`);
      expect(routeContent).toBeInTheDocument();
      // 不应跳 /login
      expect(screen.queryByText('login-page-content')).not.toBeInTheDocument();
    },
  );
});
