// @vitest-environment jsdom
// apps/web/test/dept-form.test.tsx —— ③类新增 DeptForm 组件测（TECH-WEB-ROLE-DEPT-AUDIT-001 §9.3 T5 拆分）
//
// 覆盖 AC：AC-F5-3/4/5/6、AC-ARCH-3（自由文本表单 safeParse 拦截不发请求）、AC-S1-1
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api.departments.createDepartment（控制 resolve/reject + 断言入参）。
//   - 期望「断言级红」：DeptForm stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D4：自由文本表单须 createDepartmentInputSchema.safeParse（name 1..64 + parent_id uuid|null 可选 + .strict() 拒绝多余字段）。
//   - D13 [约束]：parentId 可选（缺省/null=根部门，Q5 决策①），AC-F5-2/3。
//   - B5：DEPT_NAME_DUPLICATE（非部门 code 字段冲突）；createDepartment body 含/不含 parent_id。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Department } from '@admin/contracts';
import { DeptForm } from '../src/components/DeptForm.js';
import { ApiError } from '../src/api/client.js';
import * as apiDepartments from '../src/api/departments.js';

vi.mock('../src/api/departments.js', () => ({
  getDeptTree: vi.fn(),
  createDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
  assignUserDepartment: vi.fn(),
}));

const createDepartmentMock = vi.mocked(apiDepartments.createDepartment);

const PARENT_ID = '00000000-0000-4000-8000-0000000000d0';

function makeDeptFixture(overrides: Partial<Department> = {}): Department {
  return {
    id: '00000000-0000-4000-8000-0000000000d1',
    name: '工程部',
    parent_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderForm(props?: { parentId?: string | null }) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const result = render(
    <DeptForm
      onClose={onClose}
      onCreated={onCreated}
      parentId={props?.parentId}
    />,
  );
  return { ...result, onClose, onCreated };
}

describe('DeptForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F5-4 name 空 → safeParse 拦截 ----------
  it('name 空 → safeParse 拦截显示"部门名称必填"（AC-F5-4，AC-ARCH-3 不发请求）', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/部门名称必填|名称.*必填/i)).toBeInTheDocument();
    expect(createDepartmentMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F5-4 name > 64 → safeParse 拦截 ----------
  it('name > 64 字符 → safeParse 拦截显示"部门名称不超过 64 字符"（AC-F5-4，AC-ARCH-3 不发请求）', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/名称|name/i), 'a'.repeat(65));
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/不超过\s*64|名称.*64/i)).toBeInTheDocument();
    expect(createDepartmentMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F5-2 创建根部门（parentId 缺省）→ body 不含 parent_id ----------
  it('创建根部门（parentId 缺省）→ createDepartment body 不含 parent_id（AC-F5-2，D13）', async () => {
    createDepartmentMock.mockResolvedValue(makeDeptFixture({ name: '技术中心', parent_id: null }));
    const user = userEvent.setup();
    const { onClose, onCreated } = renderForm();

    await user.type(screen.getByLabelText(/名称|name/i), '技术中心');
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    await waitFor(() => {
      expect(createDepartmentMock).toHaveBeenCalledWith({ name: '技术中心' });
    });
    // D13：parentId 缺省=根部门，body 不含 parent_id
    expect(createDepartmentMock.mock.calls[0]?.[0]).not.toHaveProperty('parent_id');

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ---------- AC-F5-3 创建子部门（parentId 提供）→ body 含 parent_id ----------
  it('创建子部门（parentId=PARENT_ID）→ createDepartment body 含 parent_id（AC-F5-3，D13）', async () => {
    createDepartmentMock.mockResolvedValue(makeDeptFixture({ name: '工程部', parent_id: PARENT_ID }));
    const user = userEvent.setup();
    const { onClose, onCreated } = renderForm({ parentId: PARENT_ID });

    await user.type(screen.getByLabelText(/名称|name/i), '工程部');
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    await waitFor(() => {
      expect(createDepartmentMock).toHaveBeenCalledWith({ name: '工程部', parent_id: PARENT_ID });
    });

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ---------- AC-F5-5 DEPT_NAME_DUPLICATE → 表单内提示 ----------
  it('DEPT_NAME_DUPLICATE → 表单内显示"同级别下部门名称已存在"（AC-F5-5）', async () => {
    createDepartmentMock.mockRejectedValue(
      new ApiError('DEPT_NAME_DUPLICATE', '同级别下部门名称已存在'),
    );
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/名称|name/i), '工程部');
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/同级别下部门名称已存在/)).toBeInTheDocument();
  });

  // ---------- AC-F5-6 DEPT_DEPTH_EXCEEDED → 表单内提示 ----------
  it('DEPT_DEPTH_EXCEEDED → 表单内显示"部门层级超过上限"（AC-F5-6）', async () => {
    createDepartmentMock.mockRejectedValue(
      new ApiError('DEPT_DEPTH_EXCEEDED', '部门层级超过上限'),
    );
    const user = userEvent.setup();
    renderForm({ parentId: PARENT_ID });

    await user.type(screen.getByLabelText(/名称|name/i), '孙子部门');
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/部门层级超过上限/)).toBeInTheDocument();
  });
});
