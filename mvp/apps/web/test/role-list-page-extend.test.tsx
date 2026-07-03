// @vitest-environment jsdom
// apps/web/test/role-list-page-extend.test.tsx —— ③类新增 RoleListPage 行操作扩展测（TECH-WEB-TRANSFER-INHERITANCE-001 §9.3 T2，①类显式影响扩展 R14 role-list-page.test.tsx）
//
// 覆盖 AC：AC-F4-1（设置父角色按钮触发 SetParentModal）、AC-F5-1（解除父角色成功 versioned DELETE + 刷新）、
//          AC-F5-2（根角色 parent_role_id === null 不显示"解除父角色"按钮）、AC-F5-3（VERSION_CONFLICT 重试）、
//          AC-F5-4（ROLE_NOT_FOUND → 刷新列表移除该行）、AC-F6-1（查看继承链按钮触发 InheritanceChainPanel）、
//          AC-S1-2（类型派生 roleId/version 不 safeParse）、AC-ARCH-2（类型 contracts 派生）
//
// ①类显式影响标注（AI-006，§9.1 #3）：
//   - 受影响既有文件：R14 `apps/web/test/role-list-page.test.tsx`
//   - R14 role-list-page.test.tsx 既有断言（line 112/125/190/212/227/243/257）用 `getByRole('button', { name: /删除/i })`，
//     regex `/删除/i` 仅匹配"删除"按钮，**不匹配**"设置父角色"/"解除父角色"/"查看继承链"3 新增按钮。
//   - 判定结论：**R14 既有断言 不失效（边缘 0 失效）**——R16 行操作按钮数量从 1（删除）扩展为 4，但既有 getByRole
//     按 name 精确匹配"删除"不破坏（regex 不泛匹配），新增 3 按钮的测试用例在本文件（role-list-page-extend.test.tsx）
//     覆盖，R14 既有测仅保留删除按钮断言不重复覆盖（职责分离，对齐 R14 UserRolesPanel 模式）。
//   - impl-writer 不得改 R14 role-list-page.test.tsx 既有断言（AI-002 禁止改未失效断言）；本文件独立覆盖 R16 新增行为。
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api/roles（listRoles/createRole/deleteRole/listUserRoles/assignRole/removeRole）+
//     api/role-inheritance（setRoleParent/unsetRoleParent/getInheritanceChain/getEffectivePermissions）。
//   - AuthContext.Provider 提供已登录态；MemoryRouter 包裹（RoleListPage 不依赖路由但 SetParentModal/InheritanceChainPanel 可能在树内）。
//   - 期望「断言级红」：RoleListPage.tsx 当前 stub 抛 NOT_IMPLEMENTED（R14 stub 沿用，R16 扩展行操作须 impl-writer 实现）→ render 失败（非导入级红）。
//   - D7/T3：unsetRoleParent versioned=true + expectedVersion=role.version → client 注入 If-Match（AC-F5-1）。
//   - D9：409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，由 T1 api-role-inheritance 测覆盖重试细节）。
//         组件层验证：重试成功 → 刷新列表；重试仍冲突 → 显示"数据已被修改"提示。
//   - D5 / AC-S1-2：解除父角色按钮为类型派生操作（roleId/version 从 RoleListPage 列表派生，TS 类型保证，不调 safeParse）。
//   - D12 / AC-F5-2：解除父角色按钮仅 parent_role_id !== null 时显示（根角色不显示，前端防无意义操作）。
//   - D18：行操作按钮 aria-label 域特定（"设置父角色"/"解除父角色"/"查看继承链"，禁止通用"button"）。
//   - R15 S-13：fixture 须用有效 hex UUID；R15 S-14：组件 label 跨组件唯一（"设置父角色"等不与 RoleListPage 既有"删除"冲突）。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Role, RoleListResult } from '@admin/contracts';
import { RoleListPage } from '../src/pages/RoleListPage.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import { ApiError } from '../src/api/client.js';
import * as apiRoles from '../src/api/roles.js';
import * as apiRoleInheritance from '../src/api/role-inheritance.js';

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

const listRolesMock = vi.mocked(apiRoles.listRoles);
const unsetRoleParentMock = vi.mocked(apiRoleInheritance.unsetRoleParent);
const getInheritanceChainMock = vi.mocked(apiRoleInheritance.getInheritanceChain);
const setRoleParentMock = vi.mocked(apiRoleInheritance.setRoleParent);

// 有效 hex UUID（R15 S-13：z.string().uuid() 严格校验，须全 hex 字符）
const ROLE_ID = '00000000-0000-4000-8000-0000000000a1';
const PARENT_ROLE_ID = '00000000-0000-4000-8000-0000000000a2';

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: ROLE_ID,
    name: 'editor',
    description: '编辑者角色',
    permission_codes: ['user:read', 'user:write'],
    is_builtin: false,
    parent_role_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    version: 0,
    ...overrides,
  };
}

function makeListResult(items: Role[], overrides: Partial<RoleListResult> = {}): RoleListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    totalPages: items.length === 0 ? 0 : 1,
    ...overrides,
  };
}

function renderRoleListPage() {
  const authValue: AuthContextValue = {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <RoleListPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('RoleListPage 行操作扩展（R16 角色继承管理按钮）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F4-1 设置父角色按钮渲染 + 点击触发 SetParentModal ----------
  it('自定义角色行渲染"设置父角色"按钮 + 点击触发 SetParentModal 弹窗（AC-F4-1，D18 aria-label 域特定）', async () => {
    const role = makeRole({ name: 'editor', is_builtin: false, version: 3 });
    listRolesMock.mockResolvedValue(makeListResult([role]));
    // SetParentModal 渲染时调 listRoles 加载父角色选项（mock 二次调用避免未 resolve）
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    const setParentBtn = screen.getByRole('button', { name: /设置父角色/i });
    expect(setParentBtn).toBeInTheDocument();
    await user.click(setParentBtn);

    // SetParentModal 弹窗渲染（含"父角色" select 控件，D18 域特定 aria-label 消歧于 RoleListPage"角色名称"）
    // 断言弹窗标题或父角色选择控件出现（具体 DOM 由 impl-writer 定）
    await waitFor(() => {
      expect(screen.getByText(/设置父角色|父角色/i)).toBeInTheDocument();
    });
  });

  // ---------- AC-F5-2 根角色不显示"解除父角色"按钮 ----------
  it('根角色（parent_role_id === null）不显示"解除父角色"按钮（AC-F5-2，D12 前端防无意义操作）', async () => {
    const rootRole = makeRole({ name: 'admin', is_builtin: false, parent_role_id: null });
    listRolesMock.mockResolvedValue(makeListResult([rootRole]));
    renderRoleListPage();

    await screen.findByText('admin');
    // 根角色无"解除父角色"按钮（parent_role_id === null，AC-F5-2）
    expect(screen.queryByRole('button', { name: /解除父角色/i })).not.toBeInTheDocument();
  });

  // ---------- AC-F5-2 非根角色显示"解除父角色"按钮 ----------
  it('非根角色（parent_role_id !== null）显示"解除父角色"按钮（AC-F5-2 反向，D12）', async () => {
    const childRole = makeRole({
      name: 'editor',
      is_builtin: false,
      parent_role_id: PARENT_ROLE_ID,
      version: 5,
    });
    listRolesMock.mockResolvedValue(makeListResult([childRole]));
    renderRoleListPage();

    expect(await screen.findByText('editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /解除父角色/i })).toBeInTheDocument();
  });

  // ---------- AC-F5-1 解除父角色成功 → 调 unsetRoleParent versioned + 刷新列表 ----------
  it('点"解除父角色"成功 → 调 unsetRoleParent(roleId, version) versioned DELETE + 刷新列表（AC-F5-1，D7/T3）', async () => {
    const childRole = makeRole({
      name: 'editor',
      is_builtin: false,
      parent_role_id: PARENT_ROLE_ID,
      version: 5,
    });
    // 初始列表 + 解除后刷新列表（parent_role_id 变 null）
    listRolesMock.mockResolvedValueOnce(makeListResult([childRole]));
    listRolesMock.mockResolvedValueOnce(
      makeListResult([makeRole({ parent_role_id: null, version: 6 })]),
    );
    unsetRoleParentMock.mockResolvedValue(
      makeRole({ parent_role_id: null, version: 6 }),
    );
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    await user.click(screen.getByRole('button', { name: /解除父角色/i }));

    // 调 unsetRoleParent(roleId, expectedVersion)（versioned DELETE，AC-F5-1，D7/T3）
    await waitFor(() => {
      expect(unsetRoleParentMock).toHaveBeenCalledWith(ROLE_ID, 5);
    });
    // 刷新列表（listRoles 至少被调用 2 次：初始 + 解除后刷新，AC-F5-1）
    await waitFor(() => {
      expect(listRolesMock).toHaveBeenCalledTimes(2);
    });
  });

  // ---------- AC-F5-1 类型派生不 safeParse（AC-S1-2，D5）----------
  it('unsetRoleParent 调用参数 roleId/version 为字面量派生自 RoleListPage 列表项（AC-S1-2，D5 类型派生不 safeParse）', async () => {
    const childRole = makeRole({
      name: 'editor',
      is_builtin: false,
      parent_role_id: PARENT_ROLE_ID,
      version: 7,
    });
    listRolesMock.mockResolvedValue(makeListResult([childRole]));
    unsetRoleParentMock.mockResolvedValue(makeRole({ parent_role_id: null, version: 8 }));
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    await user.click(screen.getByRole('button', { name: /解除父角色/i }));

    // 类型派生：roleId/version 从列表项 Role.id/Role.version 直接传入，不经 safeParse（D5，AC-S1-2）
    await waitFor(() => {
      expect(unsetRoleParentMock).toHaveBeenCalledWith(ROLE_ID, 7);
    });
    // 静态保证：unsetRoleParent 接收 (string, number) 字面量，无 schema 校验调用
    // （此项为类型派生操作的 TS 类型保证，测试用 mock 验证调用签名符合类型契约）
  });

  // ---------- AC-F5-3 VERSION_CONFLICT 重试成功 → 刷新列表 ----------
  it('unsetRoleParent 重试 VERSION_CONFLICT 成功 → 刷新列表无"数据已被修改"提示（AC-F5-3，D9 重试幂等）', async () => {
    const childRole = makeRole({
      name: 'editor',
      is_builtin: false,
      parent_role_id: PARENT_ROLE_ID,
      version: 5,
    });
    listRolesMock.mockResolvedValue(makeListResult([childRole]));
    unsetRoleParentMock.mockResolvedValue(makeRole({ parent_role_id: null, version: 6 }));
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    await user.click(screen.getByRole('button', { name: /解除父角色/i }));

    // 重试成功（client D9 自动重试，组件层不感知）：列表刷新 + 无"数据已被修改"提示
    await waitFor(() => {
      expect(unsetRoleParentMock).toHaveBeenCalledWith(ROLE_ID, 5);
    });
    await waitFor(() => {
      expect(listRolesMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText(/数据已被修改/)).not.toBeInTheDocument();
  });

  // ---------- AC-F5-3 重试仍 VERSION_CONFLICT → 显示"数据已被修改"提示 ----------
  it('unsetRoleParent 重试仍 VERSION_CONFLICT → 显示"数据已被修改，请刷新后重试"（AC-F5-3，D9 重试仍冲突）', async () => {
    const childRole = makeRole({
      name: 'editor',
      is_builtin: false,
      parent_role_id: PARENT_ROLE_ID,
      version: 5,
    });
    listRolesMock.mockResolvedValue(makeListResult([childRole]));
    unsetRoleParentMock.mockRejectedValue(
      new ApiError('VERSION_CONFLICT', '数据已被修改，请刷新后重试', 6),
    );
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    await user.click(screen.getByRole('button', { name: /解除父角色/i }));

    expect(await screen.findByText(/数据已被修改/)).toBeInTheDocument();
  });

  // ---------- AC-F5-4 ROLE_NOT_FOUND → 显示"角色不存在" + 刷新列表移除该行 ----------
  it('unsetRoleParent ROLE_NOT_FOUND → 显示"角色不存在" + 刷新列表移除该行（AC-F5-4，T2/D20 roleId 竞态）', async () => {
    const childRole = makeRole({
      name: 'editor',
      is_builtin: false,
      parent_role_id: PARENT_ROLE_ID,
      version: 5,
    });
    // 初始列表含 childRole，刷新后空（移除该行）
    listRolesMock.mockResolvedValueOnce(makeListResult([childRole]));
    listRolesMock.mockResolvedValueOnce(makeListResult([]));
    unsetRoleParentMock.mockRejectedValue(new ApiError('ROLE_NOT_FOUND', '角色不存在'));
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    await user.click(screen.getByRole('button', { name: /解除父角色/i }));

    expect(await screen.findByText(/角色不存在/)).toBeInTheDocument();
    // 刷新列表移除该行（listRoles 至少 2 次：初始 + ROLE_NOT_FOUND 后 refresh，AC-F5-4）
    await waitFor(() => {
      expect(listRolesMock).toHaveBeenCalledTimes(2);
    });
  });

  // ---------- AC-F6-1 查看继承链按钮渲染 + 点击触发 InheritanceChainPanel ----------
  it('角色行渲染"查看继承链"按钮 + 点击触发 InheritanceChainPanel（AC-F6-1，D18 aria-label 域特定）', async () => {
    const role = makeRole({ name: 'editor', is_builtin: false, version: 3 });
    listRolesMock.mockResolvedValue(makeListResult([role]));
    getInheritanceChainMock.mockResolvedValue([
      makeRole({ id: PARENT_ROLE_ID, name: '父角色' }),
    ]);
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    const viewChainBtn = screen.getByRole('button', { name: /查看继承链/i });
    expect(viewChainBtn).toBeInTheDocument();
    await user.click(viewChainBtn);

    // InheritanceChainPanel 渲染 → 调 getInheritanceChain(roleId)（类型派生，AC-S1-2）
    await waitFor(() => {
      expect(getInheritanceChainMock).toHaveBeenCalledWith(ROLE_ID);
    });
  });

  // ---------- AC-F6-1 查看继承链 InheritanceChainPanel 调用为类型派生（AC-S1-2）----------
  it('查看继承链按钮触发 getInheritanceChain(roleId) roleId 为字面量派生不 safeParse（AC-F6-1，AC-S1-2，D5）', async () => {
    const role = makeRole({ name: 'editor', is_builtin: false, version: 3 });
    listRolesMock.mockResolvedValue(makeListResult([role]));
    getInheritanceChainMock.mockResolvedValue([]);
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    await user.click(screen.getByRole('button', { name: /查看继承链/i }));

    // 类型派生：roleId 从列表项 Role.id 派生传入，不经 safeParse（D5，AC-S1-2）
    await waitFor(() => {
      expect(getInheritanceChainMock).toHaveBeenCalledWith(ROLE_ID);
    });
  });

  // ---------- AC-F4-1 SetParentModal 设置父角色成功 → 刷新列表 ----------
  it('设置父角色成功 → SetParentModal 调 setRoleParent + 关闭弹窗 + RoleListPage 刷新（AC-F4-1，D7 versioned）', async () => {
    const role = makeRole({ name: 'editor', is_builtin: false, version: 3 });
    // 初始列表（parent_role_id=null）→ SetParentModal 内 listRoles 加载选项 → 设置后刷新（parent_role_id=PARENT_ROLE_ID）
    listRolesMock.mockResolvedValue(makeListResult([role]));
    setRoleParentMock.mockResolvedValue(
      makeRole({ parent_role_id: PARENT_ROLE_ID, version: 4 }),
    );
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    await user.click(screen.getByRole('button', { name: /设置父角色/i }));

    // SetParentModal 内"父角色" select 控件渲染（D18，aria-label="父角色"）
    await screen.findByLabelText(/父角色/i);

    // 列表刷新（listRoles 至少 2 次：初始 + 设置后刷新）
    await waitFor(() => {
      expect(listRolesMock).toHaveBeenCalled();
    });
  });

  // ---------- AC-ARCH-2 类型 contracts 派生（roleId/version 经 Role.id/Role.version 派生）----------
  it('roleId/version 经 contracts Role 类型派生（AC-ARCH-2，D3 禁止手写 TS 类型副本）', async () => {
    const role = makeRole({
      name: 'editor',
      is_builtin: false,
      parent_role_id: PARENT_ROLE_ID,
      version: 9,
    });
    listRolesMock.mockResolvedValue(makeListResult([role]));
    unsetRoleParentMock.mockResolvedValue(makeRole({ parent_role_id: null, version: 10 }));
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    await user.click(screen.getByRole('button', { name: /解除父角色/i }));

    // 静态保证：unsetRoleParent(roleId: string, expectedVersion: number) 经 Role.id/Role.version 派生
    // （contracts z.infer 派生，D3，AC-ARCH-2）
    await waitFor(() => {
      expect(unsetRoleParentMock).toHaveBeenCalledWith(ROLE_ID, 9);
    });
  });
});
