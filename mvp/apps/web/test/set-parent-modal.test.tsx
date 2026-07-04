// @vitest-environment jsdom
// apps/web/test/set-parent-modal.test.tsx —— ③类新增 SetParentModal 组件测（TECH-WEB-TRANSFER-INHERITANCE-001 §9.3 T4）
//
// 覆盖 AC：AC-F4-1（设置父角色成功 versioned）、AC-F4-2（自继承 superRefine 字段级错误，T2）、
//          AC-F4-3（内置 admin 父角色前端禁用 + 服务端兜底）、AC-F4-4（ROLE_INHERITANCE_CYCLE 提示"会形成继承环"，T2）、
//          AC-F4-5/F4-6（VERSION_CONFLICT 自动重试 + 仍冲突提示）、AC-F4-7（ROLE_NOT_FOUND）、
//          AC-ARCH-3（safeParse 拦截不发请求）、AC-S1-1（混合表单须 safeParse 覆盖 superRefine）
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api/role-inheritance（setRoleParent）+ api/roles（listRoles），AuthContext.Provider 提供已登录态。
//   - 期望「断言级红」：SetParentModal stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D4 + D12：parentRoleId select 选项从 listRoles 派生，禁用自继承 roleId（前端防 ROLE_SELF_INHERITANCE，AC-F4-2）
//              + 禁用内置 admin（前端防 ROLE_BUILTIN_PARENT_FORBIDDEN，AC-F4-3）。整体 setParentInputSchema.safeParse 覆盖 superRefine。
//   - D7/T3：setRoleParent versioned=true + expectedVersion=role.version → client 注入 If-Match（AC-F4-1）。
//   - D9：409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，由 T1 api-role-inheritance 测覆盖重试细节）。
//         组件层验证：重试成功 → onUpdated + 关闭；重试仍冲突 → 显示"数据已被修改"提示。
//   - T2/D20：错误码遵循 contracts SSOT，非臆造 ROLE_INHERITANCE_NOT_FOUND（roleId 不存在复用 ROLE_NOT_FOUND）。
//   - fixture 须用有效 hex UUID；组件 label 跨组件唯一（"父角色" 消歧于 RoleListPage"角色名称"）。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Role, RoleListResult } from '@admin/contracts';
import { SetParentModal } from '../src/components/SetParentModal.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import { ApiError } from '../src/api/client.js';
import * as apiRoleInheritance from '../src/api/role-inheritance.js';
import * as apiRoles from '../src/api/roles.js';

vi.mock('../src/api/role-inheritance.js', () => ({
  setRoleParent: vi.fn(),
  unsetRoleParent: vi.fn(),
  getInheritanceChain: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('../src/api/roles.js', () => ({
  listRoles: vi.fn(),
  createRole: vi.fn(),
  deleteRole: vi.fn(),
  listUserRoles: vi.fn(),
  assignRole: vi.fn(),
  removeRole: vi.fn(),
}));

const setRoleParentMock = vi.mocked(apiRoleInheritance.setRoleParent);
const listRolesMock = vi.mocked(apiRoles.listRoles);

// 有效 hex UUID（z.string().uuid() 严格校验，须全 hex 字符）
const ROLE_ID = '00000000-0000-4000-8000-0000000000a1';
const PARENT_ROLE_ID = '00000000-0000-4000-8000-0000000000a2';
const BUILTIN_ADMIN_ID = '00000000-0000-4000-8000-0000000000a9';

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: ROLE_ID,
    name: 'editor',
    description: '编辑者角色',
    permission_codes: ['user:read'],
    is_builtin: false,
    parent_role_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    version: 3,
    ...overrides,
  };
}

function makeListResult(items: Role[], overrides: Partial<RoleListResult> = {}): RoleListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 100,
    totalPages: items.length === 0 ? 0 : 1,
    ...overrides,
  };
}

function renderSetParentModal(
  overrides: { roleId?: string; expectedVersion?: number } = {},
) {
  const onClose = vi.fn();
  const onUpdated = vi.fn();
  const authValue: AuthContextValue = {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  const result = render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <SetParentModal
          roleId={overrides.roleId ?? ROLE_ID}
          expectedVersion={overrides.expectedVersion ?? 3}
          onClose={onClose}
          onUpdated={onUpdated}
        />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return { ...result, onClose, onUpdated };
}

describe('SetParentModal 设置父角色弹窗', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F4-1 设置父角色成功（versioned）----------
  it('选父角色 + 提交 → setRoleParent(roleId, parentRoleId, expectedVersion) + 关闭弹窗 + onUpdated（AC-F4-1，D7/T3）', async () => {
    const parentRole = makeRole({ id: PARENT_ROLE_ID, name: '父角色', version: 0 });
    listRolesMock.mockResolvedValue(makeListResult([parentRole, makeRole({ id: ROLE_ID, name: 'editor' })]));
    const updated = makeRole({ parent_role_id: PARENT_ROLE_ID, version: 4 });
    setRoleParentMock.mockResolvedValue(updated);
    const user = userEvent.setup();
    const { onClose, onUpdated } = renderSetParentModal();

    // 选项加载后选父角色
    await screen.findByText(/父角色/);
    await user.selectOptions(screen.getByLabelText(/父角色/i), PARENT_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交|确定|保存/i }));

    await waitFor(() => {
      expect(setRoleParentMock).toHaveBeenCalledWith(ROLE_ID, PARENT_ROLE_ID, 3);
    });
    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ---------- AC-F4-2 自继承 superRefine 字段级错误（前端 safeParse 拦截，T2）----------
  it('选自身作父角色（绕过前端 disabled）→ setParentInputSchema.safeParse 拦截显示"不能继承自身"（AC-F4-2，T2/D4）', async () => {
    // 注：前端 disabled 自继承 option（D12），但绕过前端直接提交 roleId===parentRoleId 时 safeParse 兜底
    // 测试通过 mock listRoles 含自身角色 + 模拟绕过 disabled 选自身（实际 UI disabled 阻止，此处验证 safeParse 兜底）
    listRolesMock.mockResolvedValue(makeListResult([makeRole({ id: ROLE_ID, name: 'editor' })]));
    setRoleParentMock.mockResolvedValue(makeRole());
    const user = userEvent.setup();
    renderSetParentModal();

    await screen.findByText(/editor/);
    // 模拟选自身（UI disabled 但测试通过 selectOptions 强制选值验证 safeParse 兜底）
    await user.selectOptions(screen.getByLabelText(/父角色/i), ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交|确定|保存/i }));

    // safeParse 拦截（superRefine roleId === parentRoleId），不发请求
    expect(await screen.findByText(/不能继承自身|自继承/i)).toBeInTheDocument();
    expect(setRoleParentMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F4-3 内置 admin 父角色前端禁用 + 服务端兜底 ----------
  it('内置 admin option disabled（前端防 ROLE_BUILTIN_PARENT_FORBIDDEN，AC-F4-3，D12）', async () => {
    const adminRole = makeRole({ id: BUILTIN_ADMIN_ID, name: 'admin', is_builtin: true });
    const editorRole = makeRole({ id: PARENT_ROLE_ID, name: 'editor', is_builtin: false });
    listRolesMock.mockResolvedValue(makeListResult([adminRole, editorRole]));
    renderSetParentModal();

    await screen.findByText(/admin/);
    // 内置 admin option 须 disabled（D12 前端禁用项）
    const select = screen.getByLabelText(/父角色/i) as HTMLSelectElement;
    const adminOption = Array.from(select.options).find((opt) => opt.value === BUILTIN_ADMIN_ID);
    expect(adminOption).toBeDefined();
    expect(adminOption?.disabled).toBe(true);
  });

  it('服务端兜底 ROLE_BUILTIN_PARENT_FORBIDDEN → 显示"内置角色不可设为父角色"（AC-F4-3，T2 后端 service 兜底）', async () => {
    const adminRole = makeRole({ id: BUILTIN_ADMIN_ID, name: 'admin', is_builtin: true });
    listRolesMock.mockResolvedValue(makeListResult([adminRole, makeRole({ id: PARENT_ROLE_ID, name: 'editor' })]));
    setRoleParentMock.mockRejectedValue(
      new ApiError('ROLE_BUILTIN_PARENT_FORBIDDEN', '内置角色不可设为父角色'),
    );
    const user = userEvent.setup();
    renderSetParentModal();

    await screen.findByText(/admin/);
    // 模拟绕过前端 disabled 选 admin（实际 UI disabled 阻止，此处验证服务端兜底错误提示）
    await user.selectOptions(screen.getByLabelText(/父角色/i), BUILTIN_ADMIN_ID);
    await user.click(screen.getByRole('button', { name: /提交|确定|保存/i }));

    expect(await screen.findByText(/内置角色不可设为父角色/)).toBeInTheDocument();
  });

  // ---------- AC-F4-4 ROLE_INHERITANCE_CYCLE → "会形成继承环" ----------
  it('setRoleParent ROLE_INHERITANCE_CYCLE → 显示"会形成继承环"（AC-F4-4，T2 环检测）', async () => {
    const parentRole = makeRole({ id: PARENT_ROLE_ID, name: '父角色' });
    listRolesMock.mockResolvedValue(makeListResult([parentRole, makeRole({ id: ROLE_ID, name: 'editor' })]));
    setRoleParentMock.mockRejectedValue(
      new ApiError('ROLE_INHERITANCE_CYCLE', '会形成继承环：A → B → A'),
    );
    const user = userEvent.setup();
    renderSetParentModal();

    await screen.findByText(/父角色/);
    await user.selectOptions(screen.getByLabelText(/父角色/i), PARENT_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交|确定|保存/i }));

    // 前端展示通用提示"会形成继承环"（不解析环路径细节，§11.2 保守安全选择）
    expect(await screen.findByText(/会形成继承环/)).toBeInTheDocument();
  });

  // ---------- AC-F4-5 VERSION_CONFLICT 自动重试成功 → onUpdated ----------
  it('setRoleParent 409 VERSION_CONFLICT 重试成功 → onUpdated 回调（AC-F4-5，D9 client 自动重试）', async () => {
    const parentRole = makeRole({ id: PARENT_ROLE_ID, name: '父角色' });
    listRolesMock.mockResolvedValue(makeListResult([parentRole, makeRole({ id: ROLE_ID, name: 'editor' })]));
    // client 层自动重试后成功（setRoleParentMock 被 client 调用，client 内部重试由 mock fetch 控制，此处模拟组件层成功路径）
    const updated = makeRole({ parent_role_id: PARENT_ROLE_ID, version: 5 });
    setRoleParentMock.mockResolvedValue(updated);
    const user = userEvent.setup();
    const { onUpdated } = renderSetParentModal();

    await screen.findByText(/父角色/);
    await user.selectOptions(screen.getByLabelText(/父角色/i), PARENT_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交|确定|保存/i }));

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalled();
    });
  });

  // ---------- AC-F4-6 重试仍 VERSION_CONFLICT → "数据已被修改"提示 ----------
  it('setRoleParent 重试仍 VERSION_CONFLICT → 显示"数据已被修改"提示（AC-F4-6）', async () => {
    const parentRole = makeRole({ id: PARENT_ROLE_ID, name: '父角色' });
    listRolesMock.mockResolvedValue(makeListResult([parentRole, makeRole({ id: ROLE_ID, name: 'editor' })]));
    setRoleParentMock.mockRejectedValue(
      new ApiError('VERSION_CONFLICT', '数据已被修改，请刷新后重试', 5),
    );
    const user = userEvent.setup();
    renderSetParentModal();

    await screen.findByText(/父角色/);
    await user.selectOptions(screen.getByLabelText(/父角色/i), PARENT_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交|确定|保存/i }));

    expect(await screen.findByText(/数据已被修改/)).toBeInTheDocument();
  });

  // ---------- AC-F4-7 ROLE_NOT_FOUND → "角色不存在" ----------
  it('setRoleParent ROLE_NOT_FOUND → 显示"角色不存在"（AC-F4-7，T2 roleId/parentRoleId 竞态不存在复用 role 域码）', async () => {
    const parentRole = makeRole({ id: PARENT_ROLE_ID, name: '父角色' });
    listRolesMock.mockResolvedValue(makeListResult([parentRole, makeRole({ id: ROLE_ID, name: 'editor' })]));
    setRoleParentMock.mockRejectedValue(new ApiError('ROLE_NOT_FOUND', '角色不存在'));
    const user = userEvent.setup();
    renderSetParentModal();

    await screen.findByText(/父角色/);
    await user.selectOptions(screen.getByLabelText(/父角色/i), PARENT_ROLE_ID);
    await user.click(screen.getByRole('button', { name: /提交|确定|保存/i }));

    expect(await screen.findByText(/角色不存在/)).toBeInTheDocument();
  });

  // ---------- AC-ARCH-3 / AC-S1-1 safeParse 拦截不发请求（混合表单须 safeParse 覆盖 superRefine）----------
  it('未选父角色直接提交 → safeParse 拦截不发请求（AC-ARCH-3/AC-S1-1，D4 混合表单须 safeParse）', async () => {
    listRolesMock.mockResolvedValue(makeListResult([makeRole({ id: PARENT_ROLE_ID, name: '父角色' })]));
    setRoleParentMock.mockResolvedValue(makeRole());
    const user = userEvent.setup();
    renderSetParentModal();

    await screen.findByText(/父角色/);
    // 不选父角色直接提交（parentRoleId 空 → safeParse 拦截）
    await user.click(screen.getByRole('button', { name: /提交|确定|保存/i }));

    // safeParse 拦截（parentRoleId uuid 缺失），不发请求
    await waitFor(() => {
      expect(setRoleParentMock).not.toHaveBeenCalled();
    });
  });
});
