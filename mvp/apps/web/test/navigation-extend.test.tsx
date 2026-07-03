// @vitest-environment jsdom
// apps/web/test/navigation-extend.test.tsx —— ③类新增 Sidebar/路由守卫 R15 扩展测（TECH-WEB-NOTIFICATION-REPORT-001 §9.3 T6）
//
// 覆盖 AC：AC-F8-1（侧边栏 6 入口+登出）、AC-F8-2（入口可达 /notifications /reports）、
//          AC-F8-3（路由守卫覆盖新页）、AC-ARCH-1（lint:rules 探针）、AC-F10-3（零新依赖）
//
// ①类显式影响标注（AI-002 边界，test-writer 仅标注，由 impl-writer 落地处理）：
//   - R14 既有 `apps/web/test/navigation.test.tsx` line 69 断言"侧边栏渲染 4 入口（用户/角色/部门/审计）+ 登出按钮"，
//     R15 D17 扩展 Sidebar 为 6 入口（新增通知/报表）后，该 4 入口断言**失效**（4→6）。
//   - 本 test-writer 阶段**不修改** R14 navigation.test.tsx（AI-002 禁止改既有测试断言）。
//     impl-writer 在扩展 Sidebar.tsx 时须同步调整 R14 navigation.test.tsx 的 4 入口断言为 6 入口
//     （matcher 改动须 Reviewer 判定，AI-002 须显式列出受影响文件 + 改动性质 + 理由，对齐 R14 errorMapping 扩展范例）。
//   - 本文件为**新增**独立文件（不扩展 R14 navigation.test.tsx），断言 R15 目标态（6 入口 + /notifications /reports 路由）。
//     test-writer 阶段 Sidebar 仍为 R14 4 入口态 → 本文件 6 入口断言失败（断言级红，证明测试有效）；
//     impl-writer 扩展 Sidebar 为 6 入口后 → 本文件通过 + R14 navigation.test.tsx 4 入口断言失效（由 impl-writer 调整）。
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event + MemoryRouter。
//   - D17：侧边栏 6 入口（用户/角色/部门/审计/通知/报表）+ 登出按钮（AC-F8-1，4→6 扩展）。
//   - AC-F8-2：入口点击跳转对应路由（react-router Link，新增 /notifications /reports 可达性）。
//   - AC-F8-3：未登录访问 /notifications /reports → RouteGuard 跳 /login（白名单仍仅 /login，R12 D13 沿用）。
//   - AC-F10-3：零新依赖（工程核验，见文件末注释）。
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

/** 渲染 RouteGuard 包裹的目标路由（验证未登录跳 /login，AC-F8-3，含 R15 新页）。 */
function renderGuardedRoute(authenticated: boolean, initialPath: string) {
  return render(
    <AuthContext.Provider value={makeAuthValue(authenticated)}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/login" element={<RouteGuard><div>login-page-content</div></RouteGuard>} />
          <Route path="/notifications" element={<RouteGuard><div>notifications-page-content</div></RouteGuard>} />
          <Route path="/reports" element={<RouteGuard><div>reports-page-content</div></RouteGuard>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('Sidebar 导航 R15 扩展（6 入口 + 通知/报表路由守卫）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F8-1 侧边栏 6 入口 + 登出按钮（4→6 扩展，D17）----------
  it('侧边栏渲染 6 入口（用户/角色/部门/审计/通知/报表）+ 登出按钮（AC-F8-1，D17，①类显式影响 4→6）', () => {
    renderSidebar();

    // R14 4 入口
    expect(screen.getByRole('link', { name: /用户/i })).toHaveAttribute('href', '/users');
    expect(screen.getByRole('link', { name: /角色/i })).toHaveAttribute('href', '/roles');
    expect(screen.getByRole('link', { name: /部门/i })).toHaveAttribute('href', '/departments');
    expect(screen.getByRole('link', { name: /审计/i })).toHaveAttribute('href', '/audit-logs');
    // R15 新增 2 入口（D17）
    expect(screen.getByRole('link', { name: /通知/i })).toHaveAttribute('href', '/notifications');
    expect(screen.getByRole('link', { name: /报表/i })).toHaveAttribute('href', '/reports');
    // 登出按钮
    expect(screen.getByRole('button', { name: /登出|退出/i })).toBeInTheDocument();
  });

  // ---------- AC-F8-2 入口可达（点击"通知"）----------
  it('入口可达：点击"通知" → 路由跳转到 /notifications（AC-F8-2）', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('link', { name: /通知/i }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /通知/i })).toHaveAttribute('href', '/notifications');
    });
  });

  // ---------- AC-F8-2 入口可达（点击"报表"）----------
  it('入口可达：点击"报表" → 路由跳转到 /reports（AC-F8-2）', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('link', { name: /报表/i }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /报表/i })).toHaveAttribute('href', '/reports');
    });
  });

  // ---------- AC-F8-3 未登录访问 /notifications → RouteGuard 跳 /login ----------
  it('未登录访问 /notifications → RouteGuard 跳 /login（AC-F8-3，白名单仍仅 /login）', () => {
    renderGuardedRoute(false, '/notifications');
    expect(screen.getByText('login-page-content')).toBeInTheDocument();
    expect(screen.queryByText('notifications-page-content')).not.toBeInTheDocument();
  });

  // ---------- AC-F8-3 未登录访问 /reports → RouteGuard 跳 /login ----------
  it('未登录访问 /reports → RouteGuard 跳 /login（AC-F8-3）', () => {
    renderGuardedRoute(false, '/reports');
    expect(screen.getByText('login-page-content')).toBeInTheDocument();
    expect(screen.queryByText('reports-page-content')).not.toBeInTheDocument();
  });

  // ---------- AC-F8-3 已登录访问 /notifications → 渲染受保护内容（守卫不误拦）----------
  it('已登录访问 /notifications → 渲染受保护内容（AC-F8-3，守卫不误拦）', () => {
    renderGuardedRoute(true, '/notifications');
    expect(screen.getByText('notifications-page-content')).toBeInTheDocument();
    expect(screen.queryByText('login-page-content')).not.toBeInTheDocument();
  });
});

// ---------- AC-ARCH-1 lint:rules 探针验证 ARCH-003 机器化 ----------
// 注：此 AC 由 scripts/check-rules.mjs ARCH-003 分支机器化校验（R12 §8 已落地 + R13 S-4 已扩展 walkWeb）。
// test-writer 阶段不直接在测试中断言（避免重复实现校验逻辑），通过 `npm run lint:rules` 探针验证：
//   - apps/web/src 扩展文件（Sidebar.tsx、App.tsx、errorMapping.ts）+ 新增模块 import 仅 @admin/contracts + 第三方 + apps/web 内部
//   - 违规即 exit≠0
// AC-ARCH-1 验收依赖：lint:rules 探针 + Reviewer 逐文件核对（§9.3 T6 备注）。

// ---------- AC-F10-3 零新依赖（工程核验）----------
// 注：此 AC 由 apps/web/package.json 依赖清单核验（R12/R14 依赖：react/react-dom/react-router-dom + @admin/contracts +
// Vitest/Testing Library/jsdom）。R15 不引入新第三方依赖（无 axios/ky/Redux/Zustand/UI 框架/Playwright/图表库）。
// AC-F10-3 验收依赖：apps/web/package.json diff + Reviewer 核对。
