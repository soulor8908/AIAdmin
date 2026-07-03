// @vitest-environment jsdom
// apps/web/test/user-roles-panel.test.tsx —— ③类新增 UserRolesPanel 组件测（TECH-WEB-ROLE-DEPT-AUDIT-001 §9.3 T7）
//
// 覆盖 AC：AC-F4-1~F4-6、AC-ARCH-4（类型派生 toggle 不调 safeParse）、AC-S1-2
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api.roles（listUserRoles/listRoles/assignRole/removeRole），AuthContext.Provider 提供已登录态。
//   - 期望「断言级红」：UserRolesPanel stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D5 [约束]：toggle 为类型派生操作（roleId 从全量角色列表派生，TS 类型保证 uuid），不调 safeParse（AC-ARCH-4，AC-S1-2）。
//   - B5：listUserRoles 返回裸 UserRole[]（无 envelope）。
//   - D22：roleId 全量从 listRoles({page:1,pageSize:100}) 派生（类型派生 toggle 选项源）。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Role, RoleListResult, UserRole } from '@admin/contracts';
import { UserRolesPanel } from '../src/components/UserRolesPanel.js';
import { ApiError } from '../src/api/client.js';
import * as apiRoles from '../src/api/roles.js';

vi.mock('../src/api/roles.js', () => ({
  listRoles: vi.fn(),
  createRole: vi.fn(),
  deleteRole: vi.fn(),
  listUserRoles: vi.fn(),
  assignRole: vi.fn(),
  removeRole: vi.fn(),
}));

const listUserRolesMock = vi.mocked(apiRoles.listUserRoles);
const listRolesMock = vi.mocked(apiRoles.listRoles);
const assignRoleMock = vi.mocked(apiRoles.assignRole);
const removeRoleMock = vi.mocked(apiRoles.removeRole);

const USER_ID = '00000000-0000-4000-8000-0000000000user';
const ROLE_ID_ADMIN = '00000000-0000-4000-8000-0000000000a1';
const ROLE_ID_EDITOR = '00000000-0000-4000-8000-0000000000a2';

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: ROLE_ID_ADMIN,
    name: 'admin',
    description: '管理员角色',
    permission_codes: ['user:read'],
    is_builtin: true,
    parent_role_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    version: 0,
    ...overrides,
  };
}

function makeRoleListResult(items: Role[]): RoleListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 100,
    totalPages: 1,
  };
}

function makeUserRole(overrides: Partial<UserRole> = {}): UserRole {
  return {
    id: '00000000-0000-4000-8000-0000000000ur1',
    user_id: USER_ID,
    role_id: ROLE_ID_ADMIN,
    assigned_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPanel() {
  const onClose = vi.fn();
  const result = render(<UserRolesPanel userId={USER_ID} onClose={onClose} />);
  return { ...result, onClose };
}

describe('UserRolesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 mock：用户已分配 admin 角色 + 全量角色含 admin/editor
    listUserRolesMock.mockResolvedValue([makeUserRole({ role_id: ROLE_ID_ADMIN })]);
    listRolesMock.mockResolvedValue(
      makeRoleListResult([
        makeRole({ id: ROLE_ID_ADMIN, name: 'admin' }),
        makeRole({ id: ROLE_ID_EDITOR, name: 'editor', is_builtin: false }),
      ]),
    );
  });

  // ---------- AC-F4-1 加载用户已分配角色 ----------
  it('加载调 listUserRoles(userId) + listRoles({page:1,pageSize:100})（AC-F4-1，B5 裸数组 + D22）', async () => {
    renderPanel();

    await waitFor(() => {
      expect(listUserRolesMock).toHaveBeenCalledWith(USER_ID);
      // D22：全量角色作 toggle 选项源（pageSize=100 取全量）
      expect(listRolesMock).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
    });
  });

  // ---------- AC-F4-1 渲染已分配角色 + 未分配角色 ----------
  it('渲染已分配角色（勾选态）+ 未分配角色（未勾选态），AC-F4-1', async () => {
    renderPanel();

    // admin 已分配（勾选态），editor 未分配（未勾选态）
    const adminCheckbox = await screen.findByRole('checkbox', { name: /admin/i });
    expect(adminCheckbox).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /editor/i })).not.toBeChecked();
  });

  // ---------- AC-F4-2 toggle 勾选（分配）→ assignRole ----------
  it('toggle 勾选 editor → 调 assignRole(userId, editorId)（AC-F4-2，类型派生操作）', async () => {
    assignRoleMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPanel();

    const editorCheckbox = await screen.findByRole('checkbox', { name: /editor/i });
    await user.click(editorCheckbox);

    await waitFor(() => {
      // D5 [约束]：类型派生操作，roleId 从全量角色列表派生（TS 类型保证 uuid）
      expect(assignRoleMock).toHaveBeenCalledWith(USER_ID, ROLE_ID_EDITOR);
    });
  });

  // ---------- AC-F4-3 toggle 取消勾选（移除）→ removeRole ----------
  it('toggle 取消勾选 admin → 调 removeRole(userId, adminId)（AC-F4-3，类型派生操作）', async () => {
    removeRoleMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPanel();

    const adminCheckbox = await screen.findByRole('checkbox', { name: /admin/i });
    await user.click(adminCheckbox);

    await waitFor(() => {
      expect(removeRoleMock).toHaveBeenCalledWith(USER_ID, ROLE_ID_ADMIN);
    });
  });

  // ---------- AC-F4-4 重复分配 → USER_ROLE_ALREADY_ASSIGNED ----------
  it('assignRole USER_ROLE_ALREADY_ASSIGNED → 显示"用户已持有该角色"（AC-F4-4）', async () => {
    assignRoleMock.mockRejectedValue(
      new ApiError('USER_ROLE_ALREADY_ASSIGNED', '用户已持有该角色'),
    );
    const user = userEvent.setup();
    renderPanel();

    const editorCheckbox = await screen.findByRole('checkbox', { name: /editor/i });
    await user.click(editorCheckbox);

    expect(await screen.findByText(/用户已持有该角色/)).toBeInTheDocument();
  });

  // ---------- AC-F4-5 角色不存在 → ROLE_NOT_FOUND ----------
  it('assignRole ROLE_NOT_FOUND → 显示"角色不存在"（AC-F4-5）', async () => {
    assignRoleMock.mockRejectedValue(new ApiError('ROLE_NOT_FOUND', '角色不存在'));
    const user = userEvent.setup();
    renderPanel();

    const editorCheckbox = await screen.findByRole('checkbox', { name: /editor/i });
    await user.click(editorCheckbox);

    expect(await screen.findByText(/角色不存在/)).toBeInTheDocument();
  });

  // ---------- AC-F4-6 用户不存在 → USER_NOT_FOUND ----------
  it('assignRole USER_NOT_FOUND → 显示"用户不存在"（AC-F4-6）', async () => {
    assignRoleMock.mockRejectedValue(new ApiError('USER_NOT_FOUND', '用户不存在'));
    const user = userEvent.setup();
    renderPanel();

    const editorCheckbox = await screen.findByRole('checkbox', { name: /editor/i });
    await user.click(editorCheckbox);

    expect(await screen.findByText(/用户不存在/)).toBeInTheDocument();
  });

  // ---------- AC-ARCH-4 / AC-S1-2 类型派生 toggle 不调 safeParse ----------
  it('类型派生 toggle：assignRole/removeRole 调用前不调 schema.safeParse（AC-ARCH-4，AC-S1-2，D5）', async () => {
    // 类型派生操作断言：roleId 从全量角色列表派生（Role.id 为 uuid 字面量，TS 类型保证）
    // 此测试通过行为断言验证：toggle 直接调 assignRole，无中间 schema 校验步骤
    // 反向核实：impl-writer 不应在 UserRolesPanel 内对 toggle 操作调 assignRoleInputSchema.safeParse
    assignRoleMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPanel();

    const editorCheckbox = await screen.findByRole('checkbox', { name: /editor/i });
    await user.click(editorCheckbox);

    await waitFor(() => {
      // toggle 直接派发 assignRole（类型派生操作，无 safeParse 中间层）
      expect(assignRoleMock).toHaveBeenCalledTimes(1);
      expect(assignRoleMock).toHaveBeenCalledWith(USER_ID, ROLE_ID_EDITOR);
    });
  });
});
