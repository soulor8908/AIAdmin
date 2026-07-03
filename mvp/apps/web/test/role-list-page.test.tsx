// @vitest-environment jsdom
// apps/web/test/role-list-page.test.tsx —— ③类新增 RoleListPage 组件测（TECH-WEB-ROLE-DEPT-AUDIT-001 §9.3 T4）
//
// 覆盖 AC：AC-F1-1~F1-6、AC-F3-1/F3-3~F3-6、AC-ARCH-3（safeParse 拦截不发请求）、AC-S1-1
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api.roles（listRoles/createRole/deleteRole），AuthContext.Provider 提供已登录态。
//   - 期望「断言级红」：RoleListPage stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D21：首次加载 pageSize=20（不依赖 schema 缺省 10）。
//   - D11 [advisory]：客户端名称搜索仅过滤当前页（非服务端筛选），AC-F1-6 advisory 测试覆盖。
//   - AC-F1-5：内置角色标识（is_builtin=true 显示"内置"badge + 删除按钮 disabled）。
//   - AC-F3-1：删除成功刷新列表；AC-F3-3 重试仍冲突提示；AC-F3-4/5/6 错误码提示。
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

vi.mock('../src/api/roles.js', () => ({
  listRoles: vi.fn(),
  createRole: vi.fn(),
  deleteRole: vi.fn(),
  listUserRoles: vi.fn(),
  assignRole: vi.fn(),
  removeRole: vi.fn(),
}));

const listRolesMock = vi.mocked(apiRoles.listRoles);
const deleteRoleMock = vi.mocked(apiRoles.deleteRole);

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    name: 'admin',
    description: '管理员角色',
    permission_codes: ['user:read', 'user:write'],
    is_builtin: true,
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

describe('RoleListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F1-1 首次加载 ----------
  it('首次加载调 listRoles({page:1, pageSize:20})（AC-F1-1，D21）', async () => {
    listRolesMock.mockResolvedValue(makeListResult([makeRole()]));
    renderRoleListPage();

    await waitFor(() => {
      expect(listRolesMock).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    });
  });

  // ---------- AC-F1-1 渲染角色行 ----------
  it('渲染角色行（name/description，AC-F1-1）', async () => {
    const role = makeRole({ name: 'editor', description: '编辑者角色' });
    listRolesMock.mockResolvedValue(makeListResult([role]));
    renderRoleListPage();

    expect(await screen.findByText('editor')).toBeInTheDocument();
    expect(screen.getByText('编辑者角色')).toBeInTheDocument();
  });

  // ---------- AC-F1-5 内置角色标识 ----------
  it('内置角色（is_builtin=true）显示"内置"标识 + 删除按钮 disabled（AC-F1-5）', async () => {
    const role = makeRole({ name: 'admin', is_builtin: true });
    listRolesMock.mockResolvedValue(makeListResult([role]));
    renderRoleListPage();

    expect(await screen.findByText('admin')).toBeInTheDocument();
    expect(screen.getByText(/内置/i)).toBeInTheDocument();
    // 内置角色删除按钮 disabled（AC-F1-5 [advisory] 预禁用优化 UX）
    const deleteBtn = screen.queryByRole('button', { name: /删除/i });
    if (deleteBtn) {
      expect(deleteBtn).toBeDisabled();
    }
  });

  // ---------- AC-F1-5 自定义角色可删除 ----------
  it('自定义角色（is_builtin=false）删除按钮可点击（AC-F1-5）', async () => {
    const role = makeRole({ name: 'editor', is_builtin: false, version: 2 });
    listRolesMock.mockResolvedValue(makeListResult([role]));
    renderRoleListPage();

    expect(await screen.findByText('editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /删除/i })).not.toBeDisabled();
  });

  // ---------- AC-F1-2 分页 ----------
  it('分页：点下一页 → listRoles({page:2})（AC-F1-2）', async () => {
    listRolesMock.mockResolvedValue(
      makeListResult([makeRole()], { total: 25, page: 1, totalPages: 2 }),
    );
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('admin');
    await user.click(screen.getByRole('button', { name: /下一页|>|next/i }));

    await waitFor(() => {
      expect(listRolesMock).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    });
  });

  // ---------- AC-F1-3 空状态 ----------
  it('空状态：items=[] → 显示"暂无角色"（AC-F1-3）', async () => {
    listRolesMock.mockResolvedValue(makeListResult([]));
    renderRoleListPage();

    expect(await screen.findByText('暂无角色')).toBeInTheDocument();
  });

  // ---------- AC-F1-4 加载态 ----------
  it('加载态：loading=true → loading 文案（AC-F1-4，D16）', async () => {
    listRolesMock.mockReturnValue(new Promise<RoleListResult>(() => {}));
    renderRoleListPage();

    expect(await screen.findByText(/loading|加载中/i)).toBeInTheDocument();
  });

  // ---------- AC-F1-6 客户端名称搜索 [advisory]（D11，仅过滤当前页）----------
  it('客户端名称搜索：输入关键字 → 仅过滤当前页 items（AC-F1-6，D11 advisory）', async () => {
    const r1 = makeRole({ id: '00000000-0000-4000-8000-0000000000a1', name: 'admin' });
    const r2 = makeRole({ id: '00000000-0000-4000-8000-0000000000a2', name: 'editor', is_builtin: false });
    listRolesMock.mockResolvedValue(makeListResult([r1, r2]));
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('admin');
    await user.type(screen.getByPlaceholderText(/搜索|名称/i), 'edit');

    // 当前页过滤：editor 显示，admin 不显示（D11：非服务端筛选，仅过滤当前页）
    await waitFor(() => {
      expect(screen.getByText('editor')).toBeInTheDocument();
      expect(screen.queryByText('admin')).not.toBeInTheDocument();
    });
    // listRoles 不应被再次调用（advisory 客户端过滤不发新请求）
    expect(listRolesMock).toHaveBeenCalledTimes(1);
  });

  // ---------- AC-F3-1 删除成功 → 刷新列表 ----------
  it('删除自定义角色成功 → 调 deleteRole + 刷新列表（AC-F3-1）', async () => {
    const role = makeRole({ name: 'editor', is_builtin: false, version: 3 });
    listRolesMock.mockResolvedValueOnce(makeListResult([role]));
    listRolesMock.mockResolvedValueOnce(makeListResult([])); // 删除后刷新
    deleteRoleMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    await user.click(screen.getByRole('button', { name: /删除/i }));

    await waitFor(() => {
      expect(deleteRoleMock).toHaveBeenCalledWith(role.id, 3);
    });
    // 刷新列表（listRoles 至少被调用 2 次：初始 + 删除后刷新）
    await waitFor(() => {
      expect(listRolesMock).toHaveBeenCalledTimes(2);
    });
  });

  // ---------- AC-F3-3 重试仍冲突 → "数据已被修改" 提示 ----------
  it('deleteRole 重试仍 VERSION_CONFLICT → 显示"数据已被修改"提示（AC-F3-3）', async () => {
    const role = makeRole({ name: 'editor', is_builtin: false, version: 3 });
    listRolesMock.mockResolvedValue(makeListResult([role]));
    deleteRoleMock.mockRejectedValue(
      new ApiError('VERSION_CONFLICT', '数据已被修改，请刷新后重试', 5),
    );
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    await user.click(screen.getByRole('button', { name: /删除/i }));

    expect(await screen.findByText(/数据已被修改/)).toBeInTheDocument();
  });

  // ---------- AC-F3-4 内置角色不可删除 ----------
  it('deleteRole ROLE_BUILTIN_FORBIDDEN → 显示"内置角色不可删除"（AC-F3-4）', async () => {
    // 注：UI 预禁用内置删除按钮，但后端兜底返回 ROLE_BUILTIN_FORBIDDEN
    const role = makeRole({ name: 'admin', is_builtin: false, version: 0 });
    listRolesMock.mockResolvedValue(makeListResult([role]));
    deleteRoleMock.mockRejectedValue(new ApiError('ROLE_BUILTIN_FORBIDDEN', '内置角色不可删除'));
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('admin');
    await user.click(screen.getByRole('button', { name: /删除/i }));

    expect(await screen.findByText(/内置角色不可删除/)).toBeInTheDocument();
  });

  // ---------- AC-F3-5 角色已被分配 ----------
  it('deleteRole ROLE_IN_USE → 显示"角色已分配给用户"提示（AC-F3-5）', async () => {
    const role = makeRole({ name: 'editor', is_builtin: false, version: 0 });
    listRolesMock.mockResolvedValue(makeListResult([role]));
    deleteRoleMock.mockRejectedValue(
      new ApiError('ROLE_IN_USE', '角色已分配给用户，请先解除分配'),
    );
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    await user.click(screen.getByRole('button', { name: /删除/i }));

    expect(await screen.findByText(/角色已分配给用户/)).toBeInTheDocument();
  });

  // ---------- AC-F3-6 角色不存在 ----------
  it('deleteRole ROLE_NOT_FOUND → 显示"角色不存在"并刷新列表（AC-F3-6）', async () => {
    const role = makeRole({ name: 'editor', is_builtin: false, version: 0 });
    listRolesMock.mockResolvedValue(makeListResult([role]));
    deleteRoleMock.mockRejectedValue(new ApiError('ROLE_NOT_FOUND', '角色不存在'));
    const user = userEvent.setup();
    renderRoleListPage();

    await screen.findByText('editor');
    await user.click(screen.getByRole('button', { name: /删除/i }));

    expect(await screen.findByText(/角色不存在/)).toBeInTheDocument();
    // 列表刷新（AC-F3-6：删除不存在 → 刷新列表移除该行）
    await waitFor(() => {
      expect(listRolesMock).toHaveBeenCalledTimes(2);
    });
  });
});
