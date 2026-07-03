// @vitest-environment jsdom
// apps/web/test/role-form.test.tsx —— ③类新增 RoleForm 组件测（TECH-WEB-ROLE-DEPT-AUDIT-001 §9.3 T4 拆分）
//
// 覆盖 AC：AC-F2-1~F2-6、AC-ARCH-3（自由文本表单 safeParse 拦截不发请求）、AC-S1-1
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api.roles.createRole（控制 resolve/reject + 断言入参）。
//   - 期望「断言级红」：RoleForm stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D4：自由文本表单须 createRoleInputSchema.safeParse（name 1..64 + description max512 + .strict() 拒绝多余字段）。
//   - D5 [约束]：permission_codes 多选为类型派生操作，但整体 safeParse 覆盖此字段（§3.2 混合表单提示）。
//   - B1：ROLE_NAME_DUPLICATE（非 ROLE_CODE_DUPLICATE）；createRole body 无 code 字段。
//   - AC-F2-2：permission_codes 选项从 [...permissionCodeSchema.options] SSOT 派生（11 项，AI-005）。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { permissionCodeSchema, type Role } from '@admin/contracts';
import { RoleForm } from '../src/components/RoleForm.js';
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

const createRoleMock = vi.mocked(apiRoles.createRole);

// SSOT 派生：从 contracts permissionCodeSchema 取全集（AI-005，禁止硬编码）
const ALL_PERMISSION_CODES = [...permissionCodeSchema.options];

function makeRoleFixture(overrides: Partial<Role> = {}): Role {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
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

function renderForm() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const result = render(<RoleForm onClose={onClose} onCreated={onCreated} />);
  return { ...result, onClose, onCreated };
}

describe('RoleForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F2-2 permission_codes 多选 SSOT 派生（AI-005）----------
  it('permission_codes 多选选项 = [...permissionCodeSchema.options] SSOT 派生（AC-F2-2，AI-005）', () => {
    renderForm();
    // 多选 select 的 options 应覆盖全部 11 个权限码（SSOT 派生，禁止硬编码）
    const select = screen.getByLabelText(/权限|permission/i);
    const optionValues = Array.from(select.querySelectorAll('option'))
      .map((o) => o.getAttribute('value'))
      .filter((v): v is string => v !== null && v !== '');
    // SSOT 派生断言：每个权限码均出现在 select options 中
    for (const code of ALL_PERMISSION_CODES) {
      expect(optionValues).toContain(code);
    }
  });

  // ---------- AC-F2-3 name 空 → safeParse 拦截 ----------
  it('name 空 → safeParse 拦截显示"角色名称必填"（AC-F2-3，AC-ARCH-3 不发请求）', async () => {
    const user = userEvent.setup();
    renderForm();

    // 不填 name，直接提交
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/角色名称必填|名称.*必填/i)).toBeInTheDocument();
    expect(createRoleMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F2-4 name > 64 → safeParse 拦截 ----------
  it('name > 64 字符 → safeParse 拦截显示"角色名称不超过 64 字符"（AC-F2-4，AC-ARCH-3 不发请求）', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/名称|name/i), 'a'.repeat(65));
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/不超过\s*64|名称.*64/i)).toBeInTheDocument();
    expect(createRoleMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F2-5 description > 512 → safeParse 拦截 ----------
  it('description > 512 字符 → safeParse 拦截显示"描述不超过 512 字符"（AC-F2-5，AC-ARCH-3 不发请求）', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/名称|name/i), 'editor');
    await user.type(screen.getByLabelText(/描述|description/i), 'a'.repeat(513));
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/不超过\s*512|描述.*512/i)).toBeInTheDocument();
    expect(createRoleMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F2-1 提交成功 → 关闭弹窗 + 刷新列表 ----------
  it('提交成功 → createRole 调用 + 关闭弹窗 + 刷新列表（AC-F2-1）', async () => {
    createRoleMock.mockResolvedValue(makeRoleFixture());
    const user = userEvent.setup();
    const { onClose, onCreated } = renderForm();

    await user.type(screen.getByLabelText(/名称|name/i), 'editor');
    await user.type(screen.getByLabelText(/描述|description/i), '编辑者角色');
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    await waitFor(() => {
      expect(createRoleMock).toHaveBeenCalledWith({
        name: 'editor',
        description: '编辑者角色',
        permission_codes: expect.any(Array),
      });
    });
    // B1：请求体不含 code 字段（contracts SSOT 无此字段）
    expect(createRoleMock.mock.calls[0]?.[0]).not.toHaveProperty('code');

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ---------- AC-F2-6 ROLE_NAME_DUPLICATE → 表单内提示（B1：非 ROLE_CODE_DUPLICATE）----------
  it('ROLE_NAME_DUPLICATE → 表单内显示"角色名称已存在"（AC-F2-6，B1）', async () => {
    createRoleMock.mockRejectedValue(new ApiError('ROLE_NAME_DUPLICATE', '角色名称已存在'));
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/名称|name/i), 'admin');
    await user.type(screen.getByLabelText(/描述|description/i), '管理员');
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/角色名称已存在/)).toBeInTheDocument();
  });
});
