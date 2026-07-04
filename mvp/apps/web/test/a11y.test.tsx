// @vitest-environment jsdom
// apps/web/test/a11y.test.tsx —— R23 AC-A11y-7 jest-axe vitest 单测（TECH-ACCESSIBILITY-DEEPENING-001 §4.7 / D8）
//
// 覆盖 AC：AC-A11y-7（jest-axe vitest 单测集成 + 关键组件 0 violations）
//
// 设计说明：
//   - jsdom 环境 + jest-axe axe 扫描（setup.ts 已注入 toHaveNoViolations matcher，D8）。
//   - mock 所有 API 模块（users / roles / role-inheritance / departments / notifications），
//     避免 axe 扫描时网络请求 pending 导致 loading 态 DOM 不完整（§4.7 [约束]）。
//   - 覆盖 8 个 modal 形态组件 + LoginPage 共 9 项 axe 扫描。
//   - [约束] jsdom 不支持 color-contrast 规则（jest-axe 默认禁用，§3.2/§3.10 S-23 核验），
//     AC-A11y-9 色彩对比由 @axe-core/playwright E2E 独占覆盖（a11y.spec.ts）。
//   - [advisory] region 规则属页面级 landmark 关注点（检查"所有内容在 <main> 等 landmark 内"），
//     组件级测试渲染单个组件无完整页面结构，禁用 region 避免误报（AC-A11y-8 E2E 页面级扫描覆盖 region）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { Role, RoleListResult, UserRole } from '@admin/contracts';
import { LoginPage } from '../src/pages/LoginPage.js';
import { CreateUserModal } from '../src/components/CreateUserModal.js';
import { SetParentModal } from '../src/components/SetParentModal.js';
import { RoleForm } from '../src/components/RoleForm.js';
import { UserRolesPanel } from '../src/components/UserRolesPanel.js';
import { EffectivePermissionsPanel } from '../src/components/EffectivePermissionsPanel.js';
import { InheritanceChainPanel } from '../src/components/InheritanceChainPanel.js';
import { DeptForm } from '../src/components/DeptForm.js';
import { NotificationForm } from '../src/components/NotificationForm.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';

// mock 所有 API 模块（避免 axe 扫描时 loading 态 DOM 不完整，§4.7 [约束]）
vi.mock('../src/api/users.js', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUserStatus: vi.fn(),
}));

vi.mock('../src/api/roles.js', () => ({
  listRoles: vi.fn(),
  createRole: vi.fn(),
  deleteRole: vi.fn(),
  listUserRoles: vi.fn(),
  assignRole: vi.fn(),
  removeRole: vi.fn(),
}));

vi.mock('../src/api/role-inheritance.js', () => ({
  setRoleParent: vi.fn(),
  unsetRoleParent: vi.fn(),
  getInheritanceChain: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('../src/api/departments.js', () => ({
  getDeptTree: vi.fn(),
  createDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
  assignUserDepartment: vi.fn(),
}));

vi.mock('../src/api/notifications.js', () => ({
  listNotifications: vi.fn(),
  createNotification: vi.fn(),
  updateNotification: vi.fn(),
  sendNotification: vi.fn(),
  markNotificationRead: vi.fn(),
  deleteNotification: vi.fn(),
}));

// 导入 mocked 模块（vi.mock 已 hoist，此处拿到的已是 mock 实现）
import * as apiRoles from '../src/api/roles.js';
import * as apiRoleInheritance from '../src/api/role-inheritance.js';

const listRolesMock = vi.mocked(apiRoles.listRoles);
const listUserRolesMock = vi.mocked(apiRoles.listUserRoles);
const getEffectivePermissionsMock = vi.mocked(apiRoleInheritance.getEffectivePermissions);
const getInheritanceChainMock = vi.mocked(apiRoleInheritance.getInheritanceChain);

// 有效 hex UUID（z.string().uuid() 严格校验，须全 hex 字符）
const ROLE_ID = '00000000-0000-4000-8000-0000000000a1';
const USER_ID = '00000000-0000-4000-8000-0000000000u1';

/** 组件级 axe 扫描选项：禁用 region（页面级 landmark 关注点，组件级无完整页面结构）。 */
const axeOptions = {
  rules: {
    // [advisory] region 规则检查"所有页面内容在 landmark（<main>/<nav> 等）内"，
    // 属页面级关注点。组件级测试渲染单个 modal/page 组件无完整 landmark 结构，
    // 禁用避免误报（AC-A11y-8 @axe-core/playwright E2E 页面级扫描覆盖 region）。
    region: { enabled: false },
  },
};

/** 构造 AuthContext stub 值（已登录态，供需 AuthContext.Provider 的组件用）。 */
function makeAuthValue(): AuthContextValue {
  return {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}

/** 构造 Role fixture。 */
function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: ROLE_ID,
    name: 'editor',
    description: '编辑者角色',
    permission_codes: ['user:read'],
    is_builtin: false,
    parent_role_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    version: 0,
    ...overrides,
  };
}

/** 构造 RoleListResult fixture。 */
function makeRoleListResult(items: Role[]): RoleListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 100,
    totalPages: 1,
  };
}

describe('R23 AC-A11y-7 jest-axe 可访问性扫描', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 mock 返回值（供 async-loading 组件用，避免 loading 态 DOM 不完整）
    listRolesMock.mockResolvedValue(makeRoleListResult([makeRole()]));
    listUserRolesMock.mockResolvedValue([] as UserRole[]);
    getEffectivePermissionsMock.mockResolvedValue(['user:read']);
    getInheritanceChainMock.mockResolvedValue([]);
  });

  // ---------- 8 个 modal 形态组件 ----------

  it('CreateUserModal 应无 WCAG 违规', async () => {
    const { container } = render(
      <CreateUserModal onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it('SetParentModal 应无 WCAG 违规', async () => {
    const { container } = render(
      <MemoryRouter>
        <SetParentModal
          roleId={ROLE_ID}
          expectedVersion={0}
          onClose={vi.fn()}
          onUpdated={vi.fn()}
        />
      </MemoryRouter>,
    );
    // 等待 listRoles 完成（select option 渲染，避免 loading 态 DOM 不完整）
    await waitFor(() => {
      expect(listRolesMock).toHaveBeenCalled();
    });
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it('RoleForm 应无 WCAG 违规', async () => {
    const { container } = render(
      <RoleForm onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it('UserRolesPanel 应无 WCAG 违规', async () => {
    const { container } = render(
      <UserRolesPanel userId={USER_ID} onClose={vi.fn()} />,
    );
    // 等待 listUserRoles + listRoles 完成（checkbox 列表渲染）
    await waitFor(() => {
      expect(listUserRolesMock).toHaveBeenCalled();
      expect(listRolesMock).toHaveBeenCalled();
    });
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it('EffectivePermissionsPanel 应无 WCAG 违规', async () => {
    const { container } = render(
      <MemoryRouter>
        <AuthContext.Provider value={makeAuthValue()}>
          <EffectivePermissionsPanel userId={USER_ID} onClose={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    // 等待 getEffectivePermissions 完成（权限列表渲染）
    await waitFor(() => {
      expect(getEffectivePermissionsMock).toHaveBeenCalled();
    });
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it('InheritanceChainPanel 应无 WCAG 违规', async () => {
    const { container } = render(
      <MemoryRouter>
        <AuthContext.Provider value={makeAuthValue()}>
          <InheritanceChainPanel roleId={ROLE_ID} onClose={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    // 等待 getInheritanceChain 完成（链形文本渲染）
    await waitFor(() => {
      expect(getInheritanceChainMock).toHaveBeenCalled();
    });
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it('DeptForm 应无 WCAG 违规', async () => {
    const { container } = render(
      <DeptForm onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it('NotificationForm（创建模式）应无 WCAG 违规', async () => {
    const { container } = render(
      <MemoryRouter>
        <AuthContext.Provider value={makeAuthValue()}>
          <NotificationForm mode="create" onClose={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  // ---------- LoginPage 关键页面 ----------

  it('LoginPage 应无 WCAG 违规', async () => {
    const authValue: AuthContextValue = {
      isAuthenticated: false,
      token: null,
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    const { container } = render(
      <AuthContext.Provider value={authValue}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });
});
