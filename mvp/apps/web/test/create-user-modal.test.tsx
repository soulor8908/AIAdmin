// @vitest-environment jsdom
// apps/web/test/create-user-modal.test.tsx —— ③类新增 CreateUserModal 组件测（TECH-WEB-AUTH-USER-001 §9.3 #5）
//
// 覆盖 AC：AC-F3-1~F3-6
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api.users.createUser（控制 resolve/reject + 断言入参）。
//   - 期望「断言级红」：CreateUserModal stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D4：表单校验复用 createUserInputSchema.safeParse（email + name min(1) + password optional min(8)）。
//   - AC-F3-5：password 空 → 请求体不含 password（对齐 optional 语义）。
//   - SEC-003b：测试中不 console.log/记录 password 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@admin/contracts';
import { CreateUserModal } from '../src/components/CreateUserModal.js';
import { ApiError } from '../src/api/client.js';
import * as apiUsers from '../src/api/users.js';

vi.mock('../src/api/users.js', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUserStatus: vi.fn(),
}));

const createUserMock = vi.mocked(apiUsers.createUser);

function makeUserFixture(): User {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Bob',
    email: 'bob@example.com',
    status: 'active',
    department_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    version: 0,
  };
}

function renderModal() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const result = render(<CreateUserModal onClose={onClose} onCreated={onCreated} />);
  return { ...result, onClose, onCreated };
}

describe('CreateUserModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F3-1 渲染 ----------
  it('渲染 email/name/password 输入框', () => {
    renderModal();
    expect(screen.getByLabelText(/邮箱/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/姓名/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/密码/i)).toBeInTheDocument();
  });

  // ---------- AC-F3-3/4 空提交 → 字段级错误 ----------
  it('空提交 → 字段级错误（AC-F3-3/4，不发请求）', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/必填|请输入/i)).toBeInTheDocument();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F3-6 password < 8 → 字段级错误 ----------
  it('password < 8 → 字段级错误"密码至少 8 位"（AC-F3-6）', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/邮箱/i), 'new@example.com');
    await user.type(screen.getByLabelText(/姓名/i), 'New User');
    await user.type(screen.getByLabelText(/密码/i), 'short');
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/至少\s*8|密码.*8/i)).toBeInTheDocument();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F3-5 password 空 → 请求体不含 password ----------
  it('password 空 → 请求体不含 password 字段（AC-F3-5，对齐 optional）', async () => {
    createUserMock.mockResolvedValue(makeUserFixture());
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/邮箱/i), 'new@example.com');
    await user.type(screen.getByLabelText(/姓名/i), 'New User');
    // 不填 password
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    await waitFor(() => {
      expect(createUserMock).toHaveBeenCalledWith({
        email: 'new@example.com',
        name: 'New User',
      });
    });
    // 确保入参不含 password 字段
    expect(createUserMock.mock.calls[0]?.[0]).not.toHaveProperty('password');
  });

  // ---------- AC-F3-1 提交成功 → 关闭弹窗 + 刷新列表 ----------
  it('提交成功 → 关闭弹窗 + 刷新列表（AC-F3-1）', async () => {
    createUserMock.mockResolvedValue(makeUserFixture());
    const user = userEvent.setup();
    const { onClose, onCreated } = renderModal();

    await user.type(screen.getByLabelText(/邮箱/i), 'new@example.com');
    await user.type(screen.getByLabelText(/姓名/i), 'New User');
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ---------- AC-F3-2 邮箱重复 ----------
  it('USER_EMAIL_DUPLICATE → 显示"邮箱已存在"（AC-F3-2）', async () => {
    createUserMock.mockRejectedValue(new ApiError('USER_EMAIL_DUPLICATE', '邮箱已存在'));
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/邮箱/i), 'dup@example.com');
    await user.type(screen.getByLabelText(/姓名/i), 'Dup User');
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText('邮箱已存在')).toBeInTheDocument();
  });
});
