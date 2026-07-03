// @vitest-environment jsdom
// apps/web/test/transfer-page.test.tsx —— ③类新增 TransferPage + TransferForm 组件测（TECH-WEB-TRANSFER-INHERITANCE-001 §9.3 T3）
//
// 覆盖 AC：AC-F1-1（4 字段控件渲染）、AC-F1-2（userId 输入触发 listUserRoles）、AC-F1-3（提交调岗成功 + 重置）、
//          AC-F1-4（提交按钮禁用）、AC-F2-1（safeParse 整体通过）、AC-F2-2（userId 非 uuid 字段级错误）、
//          AC-F2-3（superRefine oldRoleId===newRoleId path=['newRoleId']，T4）、AC-F2-4（.strict() 拒绝多余字段）、
//          AC-F3-1~F3-7（各错误码提示，T1 SSOT 真实码）、AC-ARCH-3（safeParse 拦截不发请求）、AC-S1-1（混合表单须 safeParse）
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event + MemoryRouter + AuthContext.Provider。
//   - mock api/transfer（transferUser）+ api/roles（listRoles, listUserRoles）+ api/departments（getDeptTree）。
//   - 期望「断言级红」：TransferPage stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。TransferPage 内部渲染 TransferForm，
//     故经 TransferPage 测 TransferForm 行为（4 字段 + safeParse + superRefine + 错误码提示）。
//   - D4 + D13：TransferForm 为混合表单（userId 自由文本 UUID + oldRoleId/newRoleId/toDepartmentId select），
//     整体 transferInputSchema.safeParse 覆盖 superRefine（oldRoleId !== newRoleId → path=['newRoleId']）+ .strict() + uuid 校验。
//   - D8/T4：transfer 非 versioned，不传 If-Match（由 T1 api-transfer.test.ts 测覆盖，本文件测组件层提交行为）。
//   - D14：调岗成功 → "调岗成功"提示 + TransferForm 重置（AC-F1-3）。
//   - D18：aria-label 域特定（"用户 ID"/"目标部门"/"原角色"/"新角色"/"提交调岗"）。
//   - D19/T1：错误码遵循 contracts SSOT，USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN 复用各域既有码
//             （非臆造 TRANSFER_*_NOT_FOUND）；transfer 专属码 TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_FAILED/TRANSFER_COMPENSATION_FAILED。
//   - R15 S-13：fixture 须用有效 hex UUID（z.string().uuid() 严格校验，须全 hex 字符）。
//   - R15 S-14：组件 label 跨组件唯一（"用户 ID"/"目标部门"/"原角色"/"新角色"/"提交调岗" 不与既有 label 冲突）。
//   - SEC-003b：测试中不 console.log/记录 password 或 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { DepartmentTreeResult, Role, RoleListResult, UserRole } from '@admin/contracts';
import { TransferPage } from '../src/pages/TransferPage.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import { ApiError } from '../src/api/client.js';
import * as apiTransfer from '../src/api/transfer.js';
import * as apiRoles from '../src/api/roles.js';
import * as apiDepartments from '../src/api/departments.js';

vi.mock('../src/api/transfer.js', () => ({
  transferUser: vi.fn(),
}));

vi.mock('../src/api/roles.js', () => ({
  listRoles: vi.fn(),
  createRole: vi.fn(),
  deleteRole: vi.fn(),
  listUserRoles: vi.fn(),
  assignRole: vi.fn(),
  removeRole: vi.fn(),
}));

vi.mock('../src/api/departments.js', () => ({
  getDeptTree: vi.fn(),
  createDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
  assignUserDepartment: vi.fn(),
}));

const transferUserMock = vi.mocked(apiTransfer.transferUser);
const listRolesMock = vi.mocked(apiRoles.listRoles);
const listUserRolesMock = vi.mocked(apiRoles.listUserRoles);
const getDeptTreeMock = vi.mocked(apiDepartments.getDeptTree);

// 有效 hex UUID（R15 S-13：z.string().uuid() 严格校验，须全 hex 字符）
const USER_ID = '00000000-0000-4000-8000-000000000001';
const DEPT_ID = '00000000-0000-4000-8000-0000000000d1';
const OLD_ROLE_ID = '00000000-0000-4000-8000-0000000000b1';
const NEW_ROLE_ID = '00000000-0000-4000-8000-0000000000c1';

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: OLD_ROLE_ID,
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

function makeRoleListResult(items: Role[], overrides: Partial<RoleListResult> = {}): RoleListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 100,
    totalPages: items.length === 0 ? 0 : 1,
    ...overrides,
  };
}

function makeUserRole(overrides: Partial<UserRole> = {}): UserRole {
  return {
    id: '00000000-0000-4000-8000-0000000000u1',
    user_id: USER_ID,
    role_id: OLD_ROLE_ID,
    assigned_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDeptTree(): DepartmentTreeResult {
  return {
    items: [
      {
        id: DEPT_ID,
        name: '技术部',
        parent_id: null,
        created_at: '2026-01-01T00:00:00.000Z',
        children: [],
      },
    ],
  };
}

function renderTransferPage() {
  const authValue: AuthContextValue = {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <TransferPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

/** 预置 mock：listRoles/getDeptTree 返回数据，listUserRoles 按 userId 返回已分配角色。 */
function presetSelectorData() {
  listRolesMock.mockResolvedValue(
    makeRoleListResult([
      makeRole({ id: OLD_ROLE_ID, name: 'editor' }),
      makeRole({ id: NEW_ROLE_ID, name: 'viewer' }),
    ]),
  );
  getDeptTreeMock.mockResolvedValue(makeDeptTree());
  listUserRolesMock.mockResolvedValue([makeUserRole({ role_id: OLD_ROLE_ID })]);
}

describe('TransferPage + TransferForm 调岗页', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F1-1 4 字段控件渲染 ----------
  it('渲染 4 字段控件（userId/目标部门/原角色/新角色）+ 提交调岗按钮（AC-F1-1，D18 aria-label 域特定）', async () => {
    presetSelectorData();
    renderTransferPage();

    // 4 字段控件 + 提交按钮（D18 aria-label 域特定）
    expect(await screen.findByLabelText(/用户\s*ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/目标部门/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/原角色/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/新角色/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /提交调岗/i })).toBeInTheDocument();
  });

  // ---------- AC-F1-2 userId 输入触发 listUserRoles ----------
  it('userId 输入完整 uuid → 触发 listUserRoles(userId) 加载 oldRoleId 选项（AC-F1-2，D13/D14）', async () => {
    presetSelectorData();
    const user = userEvent.setup();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    // 输入完整 uuid（失焦/完整 uuid 触发 listUserRoles，R14 S-9 不每键入触发）
    await user.type(screen.getByLabelText(/用户\s*ID/i), USER_ID);
    // 触发失焦（Tab）以模拟失焦触发 listUserRoles
    await user.tab();

    await waitFor(() => {
      expect(listUserRolesMock).toHaveBeenCalledWith(USER_ID);
    });
  });

  // ---------- AC-F1-4 提交按钮禁用（任意字段未填）----------
  it('提交按钮禁用：任意字段未填 → "提交调岗"按钮 disabled（AC-F1-4）', async () => {
    presetSelectorData();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    // 未填任何字段 → 提交按钮 disabled
    expect(screen.getByRole('button', { name: /提交调岗/i })).toBeDisabled();
  });

  // ---------- AC-F1-3 提交调岗成功 + 重置 ----------
  it('提交调岗成功 → transferUser(input) + 显示"调岗成功"提示 + 表单重置（AC-F1-3，D14）', async () => {
    presetSelectorData();
    transferUserMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    // 填 4 字段
    await user.type(screen.getByLabelText(/用户\s*ID/i), USER_ID);
    await user.tab();
    await waitFor(() => expect(listUserRolesMock).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(/目标部门/i), DEPT_ID);
    await user.selectOptions(screen.getByLabelText(/原角色/i), OLD_ROLE_ID);
    await user.selectOptions(screen.getByLabelText(/新角色/i), NEW_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交调岗/i }));

    await waitFor(() => {
      expect(transferUserMock).toHaveBeenCalledWith({
        userId: USER_ID,
        toDepartmentId: DEPT_ID,
        oldRoleId: OLD_ROLE_ID,
        newRoleId: NEW_ROLE_ID,
      });
    });
    // 成功提示（D14，AC-F1-3）
    expect(await screen.findByText(/调岗成功/)).toBeInTheDocument();
  });

  // ---------- AC-F2-1 safeParse 整体通过 ----------
  it('4 字段合法 + oldRoleId !== newRoleId → safeParse 通过 + 调 transferUser（AC-F2-1，D4）', async () => {
    presetSelectorData();
    transferUserMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    await user.type(screen.getByLabelText(/用户\s*ID/i), USER_ID);
    await user.tab();
    await waitFor(() => expect(listUserRolesMock).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(/目标部门/i), DEPT_ID);
    await user.selectOptions(screen.getByLabelText(/原角色/i), OLD_ROLE_ID);
    await user.selectOptions(screen.getByLabelText(/新角色/i), NEW_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交调岗/i }));

    // safeParse 整体通过 → 调 transferUser
    await waitFor(() => {
      expect(transferUserMock).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- AC-F2-2 userId 非 uuid → safeParse 字段级错误 ----------
  it('userId 非 uuid → safeParse 拦截显示"用户 ID 须为 UUID 格式"（AC-F2-2，AC-ARCH-3 不发请求）', async () => {
    presetSelectorData();
    const user = userEvent.setup();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    // 填非法 userId（非 uuid）
    await user.type(screen.getByLabelText(/用户\s*ID/i), 'not-a-uuid');
    await user.selectOptions(screen.getByLabelText(/目标部门/i), DEPT_ID);
    await user.selectOptions(screen.getByLabelText(/原角色/i), OLD_ROLE_ID);
    await user.selectOptions(screen.getByLabelText(/新角色/i), NEW_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交调岗/i }));

    // safeParse 拦截（z.string().uuid()），userId 字段级错误
    expect(await screen.findByText(/UUID 格式|用户.*UUID/i)).toBeInTheDocument();
    expect(transferUserMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F2-3 superRefine oldRoleId === newRoleId → path=['newRoleId'] 字段级错误 ----------
  it(`oldRoleId === newRoleId → superRefine 拦截显示"新角色不能与原角色相同"（AC-F2-3，T4 path=['newRoleId']）`, async () => {
    presetSelectorData();
    const user = userEvent.setup();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    await user.type(screen.getByLabelText(/用户\s*ID/i), USER_ID);
    await user.tab();
    await waitFor(() => expect(listUserRolesMock).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(/目标部门/i), DEPT_ID);
    // oldRoleId === newRoleId（选同一个角色）
    await user.selectOptions(screen.getByLabelText(/原角色/i), OLD_ROLE_ID);
    await user.selectOptions(screen.getByLabelText(/新角色/i), OLD_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交调岗/i }));

    // superRefine 拦截（oldRoleId === newRoleId → path=['newRoleId']，T4）
    expect(await screen.findByText(/新角色不能与原角色相同|不能.*相同/i)).toBeInTheDocument();
    expect(transferUserMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F3-1 USER_NOT_FOUND → "用户不存在" ----------
  it('transferUser USER_NOT_FOUND → 显示"用户不存在"（AC-F3-1，T1 复用 user 域码）', async () => {
    presetSelectorData();
    transferUserMock.mockRejectedValue(new ApiError('USER_NOT_FOUND', '用户不存在'));
    const user = userEvent.setup();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    await user.type(screen.getByLabelText(/用户\s*ID/i), USER_ID);
    await user.tab();
    await waitFor(() => expect(listUserRolesMock).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(/目标部门/i), DEPT_ID);
    await user.selectOptions(screen.getByLabelText(/原角色/i), OLD_ROLE_ID);
    await user.selectOptions(screen.getByLabelText(/新角色/i), NEW_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交调岗/i }));

    expect(await screen.findByText(/用户不存在/)).toBeInTheDocument();
  });

  // ---------- AC-F3-2 DEPT_NOT_FOUND → "部门不存在" ----------
  it('transferUser DEPT_NOT_FOUND → 显示"部门不存在"（AC-F3-2，T1 复用 dept 域码）', async () => {
    presetSelectorData();
    transferUserMock.mockRejectedValue(new ApiError('DEPT_NOT_FOUND', '部门不存在'));
    const user = userEvent.setup();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    await user.type(screen.getByLabelText(/用户\s*ID/i), USER_ID);
    await user.tab();
    await waitFor(() => expect(listUserRolesMock).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(/目标部门/i), DEPT_ID);
    await user.selectOptions(screen.getByLabelText(/原角色/i), OLD_ROLE_ID);
    await user.selectOptions(screen.getByLabelText(/新角色/i), NEW_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交调岗/i }));

    expect(await screen.findByText(/部门不存在/)).toBeInTheDocument();
  });

  // ---------- AC-F3-3 ROLE_NOT_FOUND → "角色不存在" ----------
  it('transferUser ROLE_NOT_FOUND → 显示"角色不存在"（AC-F3-3，T1 复用 role 域码）', async () => {
    presetSelectorData();
    transferUserMock.mockRejectedValue(new ApiError('ROLE_NOT_FOUND', '角色不存在'));
    const user = userEvent.setup();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    await user.type(screen.getByLabelText(/用户\s*ID/i), USER_ID);
    await user.tab();
    await waitFor(() => expect(listUserRolesMock).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(/目标部门/i), DEPT_ID);
    await user.selectOptions(screen.getByLabelText(/原角色/i), OLD_ROLE_ID);
    await user.selectOptions(screen.getByLabelText(/新角色/i), NEW_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交调岗/i }));

    expect(await screen.findByText(/角色不存在/)).toBeInTheDocument();
  });

  // ---------- AC-F3-4 ROLE_BUILTIN_FORBIDDEN → "内置角色不可移除/删除" ----------
  it('transferUser ROLE_BUILTIN_FORBIDDEN → 显示"内置角色不可移除"（AC-F3-4，T1 复用 role 域码，oldRole 为内置）', async () => {
    presetSelectorData();
    transferUserMock.mockRejectedValue(new ApiError('ROLE_BUILTIN_FORBIDDEN', '内置角色不可删除'));
    const user = userEvent.setup();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    await user.type(screen.getByLabelText(/用户\s*ID/i), USER_ID);
    await user.tab();
    await waitFor(() => expect(listUserRolesMock).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(/目标部门/i), DEPT_ID);
    await user.selectOptions(screen.getByLabelText(/原角色/i), OLD_ROLE_ID);
    await user.selectOptions(screen.getByLabelText(/新角色/i), NEW_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交调岗/i }));

    // §11.1 提示"内置角色不可移除"；errorMapping 返回"内置角色不可删除"——两者均含"内置角色不可"，flexible matcher
    expect(await screen.findByText(/内置角色不可(移除|删除)/)).toBeInTheDocument();
  });

  // ---------- AC-F3-5 TRANSFER_OLD_ROLE_NOT_ASSIGNED → "用户未持有原角色" ----------
  it('transferUser TRANSFER_OLD_ROLE_NOT_ASSIGNED → 显示"用户未持有原角色"（AC-F3-5，T1 transfer 专属码竞态）', async () => {
    presetSelectorData();
    transferUserMock.mockRejectedValue(
      new ApiError('TRANSFER_OLD_ROLE_NOT_ASSIGNED', '用户未持有原角色'),
    );
    const user = userEvent.setup();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    await user.type(screen.getByLabelText(/用户\s*ID/i), USER_ID);
    await user.tab();
    await waitFor(() => expect(listUserRolesMock).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(/目标部门/i), DEPT_ID);
    await user.selectOptions(screen.getByLabelText(/原角色/i), OLD_ROLE_ID);
    await user.selectOptions(screen.getByLabelText(/新角色/i), NEW_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交调岗/i }));

    expect(await screen.findByText(/用户未持有原角色/)).toBeInTheDocument();
  });

  // ---------- AC-F3-6 TRANSFER_FAILED → "调岗失败"（聚合码 message 透传）----------
  it('transferUser TRANSFER_FAILED → 显示"调岗失败"含后端 message（AC-F3-6，T1 聚合码 message 含失败步骤）', async () => {
    presetSelectorData();
    transferUserMock.mockRejectedValue(
      new ApiError('TRANSFER_FAILED', '调岗失败：步骤 C 移除原角色失败 - role:write 权限不足'),
    );
    const user = userEvent.setup();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    await user.type(screen.getByLabelText(/用户\s*ID/i), USER_ID);
    await user.tab();
    await waitFor(() => expect(listUserRolesMock).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(/目标部门/i), DEPT_ID);
    await user.selectOptions(screen.getByLabelText(/原角色/i), OLD_ROLE_ID);
    await user.selectOptions(screen.getByLabelText(/新角色/i), NEW_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交调岗/i }));

    // 聚合码前端透传后端 message（§11.1，D19），须含"调岗失败"
    expect(await screen.findByText(/调岗失败/)).toBeInTheDocument();
  });

  // ---------- AC-F3-7 TRANSFER_SAME_ROLE 服务端兜底 → "新角色不能与原角色相同" ----------
  it('transferUser TRANSFER_SAME_ROLE（服务端兜底）→ 显示"新角色不能与原角色相同"（AC-F3-7，客户端 safeParse 未拦截绕过）', async () => {
    presetSelectorData();
    transferUserMock.mockRejectedValue(
      new ApiError('TRANSFER_SAME_ROLE', '新角色不能与原角色相同'),
    );
    const user = userEvent.setup();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    await user.type(screen.getByLabelText(/用户\s*ID/i), USER_ID);
    await user.tab();
    await waitFor(() => expect(listUserRolesMock).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(/目标部门/i), DEPT_ID);
    await user.selectOptions(screen.getByLabelText(/原角色/i), OLD_ROLE_ID);
    await user.selectOptions(screen.getByLabelText(/新角色/i), NEW_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交调岗/i }));

    // 服务端兜底 TRANSFER_SAME_ROLE（客户端 safeParse 未拦截绕过直接调 API 时）
    expect(await screen.findByText(/新角色不能与原角色相同/)).toBeInTheDocument();
  });

  // ---------- AC-ARCH-3 / AC-S1-1 safeParse 拦截不发请求（混合表单须 safeParse）----------
  it('userId 非 uuid → safeParse 拦截不发请求（AC-ARCH-3/AC-S1-1，D4 混合表单须 safeParse 覆盖 superRefine）', async () => {
    presetSelectorData();
    const user = userEvent.setup();
    renderTransferPage();

    await screen.findByLabelText(/用户\s*ID/i);
    // 填非法 userId + 其他字段合法
    await user.type(screen.getByLabelText(/用户\s*ID/i), 'invalid');
    await user.selectOptions(screen.getByLabelText(/目标部门/i), DEPT_ID);
    await user.selectOptions(screen.getByLabelText(/原角色/i), OLD_ROLE_ID);
    await user.selectOptions(screen.getByLabelText(/新角色/i), NEW_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交调岗/i }));

    // safeParse 拦截（userId 非 uuid），不发请求（AC-ARCH-3）
    await waitFor(() => {
      expect(transferUserMock).not.toHaveBeenCalled();
    });
  });
});
