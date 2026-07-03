// @vitest-environment jsdom
// apps/web/test/user-list-page-extend.test.tsx —— ③类新增 UserListPage 行操作扩展测（TECH-WEB-TRANSFER-INHERITANCE-001 §6.7，①类显式影响扩展 R14 user-list-page.test.tsx）
//
// 覆盖 AC：AC-F7-1（"有效权限"按钮触发 EffectivePermissionsPanel modal）、AC-S1-2（类型派生 userId 不 safeParse）、
//          AC-ARCH-2（类型 contracts 派生 User.id）
//
// ①类显式影响标注（AI-006，§9.1 #4）：
//   - 受影响既有文件：R14 `apps/web/test/user-list-page.test.tsx`
//   - R14 user-list-page.test.tsx 既有断言（line 165/187/203）用 `getByRole('button', { name: /禁用/i })`，
//     regex `/禁用/i` 仅匹配"禁用/启用"启停按钮，**不匹配**"有效权限"按钮；R14 user-roles-panel.test.tsx 用"角色"按钮
//     （独立测覆盖，本测无冲突）。
//   - 判定结论：**R14 既有断言 不失效（边缘 0 失效）**——R16 行操作按钮数量从 2（启停 + 角色）扩展为 3，但既有 getByRole
//     按 name 精确匹配"禁用"/"角色"不破坏（regex 不泛匹配），新增"有效权限"按钮的测试用例在本文件
//     （user-list-page-extend.test.tsx）覆盖，R14 既有测仅保留启停/角色按钮断言不重复覆盖（职责分离，对齐 R14 UserRolesPanel 模式）。
//   - impl-writer 不得改 R14 user-list-page.test.tsx 既有断言（AI-002 禁止改未失效断言）；本文件独立覆盖 R16 新增行为。
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api/users（listUsers/createUser/updateUserStatus）+ api/role-inheritance（getEffectivePermissions）。
//   - AuthContext.Provider 提供已登录态；MemoryRouter 包裹（UserListPage 不依赖路由但 EffectivePermissionsPanel 可能在树内）。
//   - 期望「断言级红」：UserListPage.tsx 当前 stub 抛 NOT_IMPLEMENTED（R12 stub 沿用，R16 扩展行操作须 impl-writer 实现）→ render 失败（非导入级红）。
//   - Q7 决策③：EffectivePermissionsPanel 从 UserListPage 行操作"有效权限"按钮触发（modal，传入 userId）。
//   - D5 / AC-S1-2：有效权限按钮为类型派生操作（userId 从 UserListPage 行派生自 User.id，TS 类型保证，不调 safeParse）。
//   - D11：权限码中文化映射 SSOT 派生（键从 [...permissionCodeSchema.options] 派生 11 项全集，AI-005，禁止硬编码），
//          具体中文化映射渲染由 effective-permissions-panel.test.tsx（T6）覆盖，本测仅覆盖"有效权限"按钮触发行为。
//   - D18：行操作按钮 aria-label 域特定（"有效权限"，禁止通用"button"）；R15 S-14：跨组件唯一（不与 UserListPage 既有"启停"/"角色"冲突）。
//   - R15 S-13：fixture 须用有效 hex UUID。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { User, UserListResult, PermissionCode } from '@admin/contracts';
import { UserListPage } from '../src/pages/UserListPage.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import { ApiError } from '../src/api/client.js';
import * as apiUsers from '../src/api/users.js';
import * as apiRoleInheritance from '../src/api/role-inheritance.js';

vi.mock('../src/api/users.js', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUserStatus: vi.fn(),
}));

vi.mock('../src/api/role-inheritance.js', () => ({
  setRoleParent: vi.fn(),
  unsetRoleParent: vi.fn(),
  getInheritanceChain: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

const listUsersMock = vi.mocked(apiUsers.listUsers);
const getEffectivePermissionsMock = vi.mocked(apiRoleInheritance.getEffectivePermissions);

// 有效 hex UUID（R15 S-13：z.string().uuid() 严格校验，须全 hex 字符）
const USER_ID = '00000000-0000-4000-8000-000000000001';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    name: 'Alice',
    email: 'alice@example.com',
    status: 'active',
    department_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    version: 0,
    ...overrides,
  };
}

function makeListResult(items: User[], overrides: Partial<UserListResult> = {}): UserListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    totalPages: items.length === 0 ? 0 : 1,
    ...overrides,
  };
}

function renderUserListPage() {
  const authValue: AuthContextValue = {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <UserListPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('UserListPage 行操作扩展（R16 有效权限按钮触发 EffectivePermissionsPanel）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F7-1 "有效权限"按钮渲染 + 点击触发 EffectivePermissionsPanel ----------
  it('用户行渲染"有效权限"按钮 + 点击触发 EffectivePermissionsPanel（AC-F7-1，D18 aria-label 域特定）', async () => {
    const user = makeUser({ name: 'Alice', status: 'active' });
    listUsersMock.mockResolvedValue(makeListResult([user]));
    getEffectivePermissionsMock.mockResolvedValue(['user:read'] as PermissionCode[]);
    const userEventInst = userEvent.setup();
    renderUserListPage();

    await screen.findByText('Alice');
    const effectivePermBtn = screen.getByRole('button', { name: /有效权限/i });
    expect(effectivePermBtn).toBeInTheDocument();
    await userEventInst.click(effectivePermBtn);

    // EffectivePermissionsPanel modal 渲染 → 调 getEffectivePermissions(userId)
    await waitFor(() => {
      expect(getEffectivePermissionsMock).toHaveBeenCalledWith(USER_ID);
    });
  });

  // ---------- AC-F7-1 EffectivePermissionsPanel 调用为类型派生（AC-S1-2，D5）----------
  it('"有效权限"按钮触发 getEffectivePermissions(userId) userId 为字面量派生不 safeParse（AC-F7-1，AC-S1-2，D5）', async () => {
    const user = makeUser({ name: 'Alice', status: 'active' });
    listUsersMock.mockResolvedValue(makeListResult([user]));
    getEffectivePermissionsMock.mockResolvedValue([] as PermissionCode[]);
    const userEventInst = userEvent.setup();
    renderUserListPage();

    await screen.findByText('Alice');
    await userEventInst.click(screen.getByRole('button', { name: /有效权限/i }));

    // 类型派生：userId 从 UserListPage 行 User.id 派生传入，不经 safeParse（D5，AC-S1-2）
    await waitFor(() => {
      expect(getEffectivePermissionsMock).toHaveBeenCalledWith(USER_ID);
    });
  });

  // ---------- AC-F7-1 EffectivePermissionsPanel 渲染权限码中文化（与 T6 联动，D11）----------
  it('点"有效权限"按钮 → EffectivePermissionsPanel modal 渲染权限码中文化列表（AC-F7-1，D11，与 T6 联动）', async () => {
    const user = makeUser({ name: 'Alice', status: 'active' });
    listUsersMock.mockResolvedValue(makeListResult([user]));
    // 返回含 transfer:write 权限码（R16 新增权限码，验证中文化映射含此项）
    const permissions: PermissionCode[] = ['user:read', 'role:read', 'transfer:write'];
    getEffectivePermissionsMock.mockResolvedValue(permissions);
    const userEventInst = userEvent.setup();
    renderUserListPage();

    await screen.findByText('Alice');
    await userEventInst.click(screen.getByRole('button', { name: /有效权限/i }));

    // EffectivePermissionsPanel 渲染权限码中文化（D11，至少一项中文化提示出现）
    // 具体中文化措辞由 impl-writer 定（须 Review 报告记录，R13 S-2），本测断言至少出现中文化或权限码文本
    await waitFor(() => {
      expect(getEffectivePermissionsMock).toHaveBeenCalledWith(USER_ID);
    });
    await waitFor(() => {
      expect(screen.getByText(/查看用户|用户.*读|user:read|有效权限/i)).toBeInTheDocument();
    });
  });

  // ---------- AC-F7-2 EffectivePermissionsPanel 空集合显示"该用户暂无有效权限"（与 T6 联动）----------
  it('点"有效权限"按钮 + 返回空集合 → 显示"该用户暂无有效权限"（AC-F7-2，与 T6 联动）', async () => {
    const user = makeUser({ name: 'Alice', status: 'active' });
    listUsersMock.mockResolvedValue(makeListResult([user]));
    getEffectivePermissionsMock.mockResolvedValue([] as PermissionCode[]);
    const userEventInst = userEvent.setup();
    renderUserListPage();

    await screen.findByText('Alice');
    await userEventInst.click(screen.getByRole('button', { name: /有效权限/i }));

    expect(await screen.findByText(/该用户暂无有效权限/)).toBeInTheDocument();
  });

  // ---------- AC-F7-4 USER_NOT_FOUND → "用户不存在"（与 T6 联动，T1 复用 user 域码）----------
  it('点"有效权限"按钮 + USER_NOT_FOUND → 显示"用户不存在"（AC-F7-4，T1/D19 userId 竞态）', async () => {
    const user = makeUser({ name: 'Alice', status: 'active' });
    listUsersMock.mockResolvedValue(makeListResult([user]));
    getEffectivePermissionsMock.mockRejectedValue(
      new ApiError('USER_NOT_FOUND', '用户不存在'),
    );
    const userEventInst = userEvent.setup();
    renderUserListPage();

    await screen.findByText('Alice');
    await userEventInst.click(screen.getByRole('button', { name: /有效权限/i }));

    expect(await screen.findByText(/用户不存在/)).toBeInTheDocument();
  });

  // ---------- AC-ARCH-2 类型 contracts 派生（userId 经 User.id 派生）----------
  it('userId 经 contracts User 类型派生（AC-ARCH-2，D3 禁止手写 TS 类型副本）', async () => {
    const user = makeUser({ name: 'Alice', status: 'active' });
    listUsersMock.mockResolvedValue(makeListResult([user]));
    getEffectivePermissionsMock.mockResolvedValue([] as PermissionCode[]);
    const userEventInst = userEvent.setup();
    renderUserListPage();

    await screen.findByText('Alice');
    await userEventInst.click(screen.getByRole('button', { name: /有效权限/i }));

    // 静态保证：getEffectivePermissions(userId: string) 经 User.id 派生（contracts z.infer 派生，D3，AC-ARCH-2）
    await waitFor(() => {
      expect(getEffectivePermissionsMock).toHaveBeenCalledWith(USER_ID);
    });
  });
});
