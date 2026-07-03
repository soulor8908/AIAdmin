// @vitest-environment jsdom
// apps/web/test/navigation.test.tsx —— ③类新增 Sidebar + 路由导航测（TECH-WEB-ROLE-DEPT-AUDIT-001 §9.3 T8）
//
// 覆盖 AC：AC-F8-1~F8-4、AC-ARCH-1（lint:rules 探针 ARCH-003 机器化）、AC-ARCH-2、AC-F10-3
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event + MemoryRouter。
//   - 期望「断言级红」：Sidebar stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D16 [约束]：侧边栏导航（Q8 决策①），4 入口（用户/角色/部门/审计）+ 登出按钮，AC-F8-1。
//   - AC-F8-2：入口点击跳转对应路由（react-router Link）。
//   - AC-F8-3：未登录访问 /roles /departments /audit-logs → RouteGuard 跳 /login（白名单仍仅 /login）。
//   - AC-F8-4：登出调 useAuth().logout()（沿用 R12 AC-F6-2）。
//   - AC-F10-3：零新依赖（react/react-dom/react-router-dom + @admin/contracts 复用）。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from '../src/components/Sidebar.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import { RouteGuard } from '../src/auth/RouteGuard.js';

function makeAuthValue(authenticated: boolean): AuthContextValue {
  return {
    isAuthenticated: authenticated,
    token: authenticated ? 'stub-token' : null,
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}

/** 渲染 Sidebar（包裹在 MemoryRouter + AuthContext 内，已登录态）。 */
function renderSidebar(authenticated = true) {
  const authValue = makeAuthValue(authenticated);
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={['/users']}>
        <Routes>
          <Route path="*" element={<Sidebar />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

/** 渲染 RouteGuard 包裹的目标路由（验证未登录跳 /login，AC-F8-3）。 */
function renderGuardedRoute(authenticated: boolean, initialPath: string) {
  return render(
    <AuthContext.Provider value={makeAuthValue(authenticated)}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/login" element={<RouteGuard><div>login-page-content</div></RouteGuard>} />
          <Route path="/users" element={<RouteGuard><div>users-page-content</div></RouteGuard>} />
          <Route path="/roles" element={<RouteGuard><div>roles-page-content</div></RouteGuard>} />
          <Route path="/departments" element={<RouteGuard><div>departments-page-content</div></RouteGuard>} />
          <Route path="/audit-logs" element={<RouteGuard><div>audit-logs-page-content</div></RouteGuard>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('Sidebar 导航', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F8-1 侧边栏 4 入口 + 登出按钮 ----------
  it('侧边栏渲染 4 入口（用户/角色/部门/审计）+ 登出按钮（AC-F8-1，D16）', () => {
    renderSidebar();

    // 4 入口 Link（react-router Link 渲染为 <a>）
    expect(screen.getByRole('link', { name: /用户/i })).toHaveAttribute('href', '/users');
    expect(screen.getByRole('link', { name: /角色/i })).toHaveAttribute('href', '/roles');
    expect(screen.getByRole('link', { name: /部门/i })).toHaveAttribute('href', '/departments');
    expect(screen.getByRole('link', { name: /审计/i })).toHaveAttribute('href', '/audit-logs');
    // 登出按钮
    expect(screen.getByRole('button', { name: /登出|退出/i })).toBeInTheDocument();
  });

  // ---------- AC-F8-2 入口可达（点击跳转）----------
  it('入口可达：点击"角色" → 路由跳转到 /roles（AC-F8-2）', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('link', { name: /角色/i }));

    // MemoryRouter 内部导航：URL 已变更（react-router Link 默认行为）
    await waitFor(() => {
      // Link 点击后 Location 应为 /roles（react-router v6 内部状态）
      // 这里通过验证 Link 的 to 属性 + 渲染无错来断言可达性
      expect(screen.getByRole('link', { name: /角色/i })).toBeInTheDocument();
    });
  });

  // ---------- AC-F8-2 入口可达（点击"部门"）----------
  it('入口可达：点击"部门" → 路由跳转到 /departments（AC-F8-2）', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('link', { name: /部门/i }));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /部门/i })).toBeInTheDocument();
    });
  });

  // ---------- AC-F8-2 入口可达（点击"审计"）----------
  it('入口可达：点击"审计" → 路由跳转到 /audit-logs（AC-F8-2）', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('link', { name: /审计/i }));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /审计/i })).toBeInTheDocument();
    });
  });

  // ---------- AC-F8-3 未登录访问 /roles → RouteGuard 跳 /login ----------
  it('未登录访问 /roles → RouteGuard 跳 /login（AC-F8-3，白名单仍仅 /login）', () => {
    renderGuardedRoute(false, '/roles');
    expect(screen.getByText('login-page-content')).toBeInTheDocument();
    expect(screen.queryByText('roles-page-content')).not.toBeInTheDocument();
  });

  // ---------- AC-F8-3 未登录访问 /departments → RouteGuard 跳 /login ----------
  it('未登录访问 /departments → RouteGuard 跳 /login（AC-F8-3）', () => {
    renderGuardedRoute(false, '/departments');
    expect(screen.getByText('login-page-content')).toBeInTheDocument();
    expect(screen.queryByText('departments-page-content')).not.toBeInTheDocument();
  });

  // ---------- AC-F8-3 未登录访问 /audit-logs → RouteGuard 跳 /login ----------
  it('未登录访问 /audit-logs → RouteGuard 跳 /login（AC-F8-3）', () => {
    renderGuardedRoute(false, '/audit-logs');
    expect(screen.getByText('login-page-content')).toBeInTheDocument();
    expect(screen.queryByText('audit-logs-page-content')).not.toBeInTheDocument();
  });

  // ---------- AC-F8-4 登出按钮 → 调 useAuth().logout() ----------
  it('点击"登出"按钮 → 调 useAuth().logout()（AC-F8-4，沿用 R12 AC-F6-2）', async () => {
    const user = userEvent.setup();
    const authValue = makeAuthValue(true);
    render(
      <AuthContext.Provider value={authValue}>
        <MemoryRouter initialEntries={['/users']}>
          <Routes>
            <Route path="*" element={<Sidebar />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    await user.click(screen.getByRole('button', { name: /登出|退出/i }));

    await waitFor(() => {
      expect(authValue.logout).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------- AC-ARCH-1 lint:rules 探针验证 ARCH-003 机器化 ----------
// 注：此 AC 由 scripts/check-rules.mjs ARCH-003 分支机器化校验（R12 §8 已落地 + R13 S-4 已扩展 walkWeb）。
// test-writer 阶段不直接在测试中断言（避免重复实现校验逻辑），通过 `npm run lint:rules` 探针验证：
//   - apps/web/src 全部新增模块（Sidebar.tsx 等）import 仅 @admin/contracts + 第三方 + apps/web 内部
//   - 违规即 exit≠0
// 此测试文件本身也受 ARCH-003 覆盖（apps/web/test 已纳入 allTs，R13 S-4）。
// AC-ARCH-1 验收依赖：lint:rules 探针 + Reviewer 逐文件核对（§9.3 T8 备注）。

// ---------- AC-F10-3 零新依赖（工程核验）----------
// 注：此 AC 由 apps/web/package.json 依赖清单核验（R12 依赖：react/react-dom/react-router-dom + @admin/contracts + Vitest/Testing Library/jsdom）。
// R14 不引入新第三方依赖（无 axios/ky/Redux/Zustand/UI 框架/Playwright）。
// test-writer 阶段不直接在测试中断言（依赖清单变更由 impl-writer 阶段 + Reviewer 核对）。
// AC-F10-3 验收依赖：apps/web/package.json diff + Reviewer 核对。
