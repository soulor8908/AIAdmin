// @vitest-environment jsdom
// apps/web/test/user-list-page.test.tsx —— ③类新增 UserListPage 组件测（TECH-WEB-AUTH-USER-001 §9.3 #4）
//
// 覆盖 AC：AC-F2-1~F2-7、AC-F4-1/2/5/6
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api.users（listUsers/createUser/updateUserStatus），AuthContext.Provider 提供已登录态。
//   - 期望「断言级红」：UserListPage stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D14：首次加载 pageSize=20（不依赖 schema 缺省 10）。
//   - SEC-003b：测试中不 console.log/记录 password 或 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { User, UserListResult } from '@admin/contracts';
import { UserListPage } from '../src/pages/UserListPage.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import { ApiError } from '../src/api/client.js';
import * as apiUsers from '../src/api/users.js';

vi.mock('../src/api/users.js', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUserStatus: vi.fn(),
}));

const listUsersMock = vi.mocked(apiUsers.listUsers);
const updateUserStatusMock = vi.mocked(apiUsers.updateUserStatus);

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '00000000-0000-4000-8000-000000000001',
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

describe('UserListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F2-1 首次加载 ----------
  it('首次加载调 listUsers({page:1, pageSize:20})（AC-F2-1，D14）', async () => {
    listUsersMock.mockResolvedValue(makeListResult([makeUser()]));
    renderUserListPage();

    await waitFor(() => {
      expect(listUsersMock).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    });
  });

  // ---------- AC-F2-1 渲染列表行 ----------
  it('渲染列表行（name/email/status，AC-F2-1）', async () => {
    const user = makeUser({ name: 'Alice', email: 'alice@example.com', status: 'active' });
    listUsersMock.mockResolvedValue(makeListResult([user]));
    renderUserListPage();

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText(/启用|active/i)).toBeInTheDocument();
  });

  // ---------- AC-F2-2 分页 ----------
  it('分页：点下一页 → listUsers({page:2})（AC-F2-2）', async () => {
    listUsersMock.mockResolvedValue(
      makeListResult([makeUser()], { total: 25, page: 1, totalPages: 2 }),
    );
    const user = userEvent.setup();
    renderUserListPage();

    await screen.findByText('Alice');
    await user.click(screen.getByRole('button', { name: /下一页|>|next/i }));

    await waitFor(() => {
      expect(listUsersMock).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    });
  });

  // ---------- AC-F2-3 状态筛选 ----------
  it('状态筛选：选 disabled → listUsers({page:1, pageSize:20, status:"disabled"})（AC-F2-3）', async () => {
    listUsersMock.mockResolvedValue(makeListResult([]));
    const user = userEvent.setup();
    renderUserListPage();

    await screen.findByText(/暂无用户|loading/i);
    await user.selectOptions(screen.getByRole('combobox', { name: /状态|筛选/i }), 'disabled');

    await waitFor(() => {
      expect(listUsersMock).toHaveBeenCalledWith({ page: 1, pageSize: 20, status: 'disabled' });
    });
  });

  // ---------- AC-F2-5 空状态 ----------
  it('空状态：items=[] → 显示"暂无用户"（AC-F2-5）', async () => {
    listUsersMock.mockResolvedValue(makeListResult([]));
    renderUserListPage();

    expect(await screen.findByText('暂无用户')).toBeInTheDocument();
  });

  // ---------- AC-F2-6 分页信息 ----------
  it('分页信息：渲染 total/totalPages（AC-F2-6）', async () => {
    listUsersMock.mockResolvedValue(
      makeListResult([makeUser()], { total: 25, page: 1, pageSize: 20, totalPages: 2 }),
    );
    renderUserListPage();

    expect(await screen.findByText(/共\s*25\s*条/)).toBeInTheDocument();
    expect(screen.getByText(/第\s*1\s*\/\s*2\s*页/)).toBeInTheDocument();
  });

  // ---------- AC-F2-7 加载态 ----------
  it('加载态：loading=true → loading 文案（AC-F2-7，D16）', async () => {
    // listUsers 永不 resolve（保持 loading 态）
    listUsersMock.mockReturnValue(new Promise<UserListResult>(() => {}));
    renderUserListPage();

    expect(await screen.findByText(/loading|加载中/i)).toBeInTheDocument();
  });

  // ---------- AC-F4-1/2 启停按钮 → 调 updateUserStatus ----------
  it('启停按钮点击 → 调 updateUserStatus（AC-F4-1/2）', async () => {
    const user = makeUser({ status: 'active', version: 3 });
    listUsersMock.mockResolvedValue(makeListResult([user]));
    updateUserStatusMock.mockResolvedValue(makeUser({ status: 'disabled', version: 4 }));
    const userEventInst = userEvent.setup();
    renderUserListPage();

    await screen.findByText('Alice');
    await userEventInst.click(screen.getByRole('button', { name: /禁用/i }));

    await waitFor(() => {
      expect(updateUserStatusMock).toHaveBeenCalledWith(
        user.id,
        { status: 'disabled' },
        3,
      );
    });
  });

  // ---------- AC-F4-5 禁用自身 ----------
  it('USER_DISABLE_SELF_FORBIDDEN → 显示"不能禁用自身账号"（AC-F4-5）', async () => {
    const user = makeUser({ status: 'active', version: 0 });
    listUsersMock.mockResolvedValue(makeListResult([user]));
    updateUserStatusMock.mockRejectedValue(
      new ApiError('USER_DISABLE_SELF_FORBIDDEN', '不能禁用自身账号'),
    );
    const userEventInst = userEvent.setup();
    renderUserListPage();

    await screen.findByText('Alice');
    await userEventInst.click(screen.getByRole('button', { name: /禁用/i }));

    expect(await screen.findByText('不能禁用自身账号')).toBeInTheDocument();
  });

  // ---------- AC-F4-6 重复状态 ----------
  it('USER_ALREADY_DISABLED → 显示对应提示（AC-F4-6）', async () => {
    const user = makeUser({ status: 'disabled', version: 0 });
    listUsersMock.mockResolvedValue(makeListResult([user]));
    updateUserStatusMock.mockRejectedValue(
      new ApiError('USER_ALREADY_DISABLED', '用户已是禁用状态'),
    );
    const userEventInst = userEvent.setup();
    renderUserListPage();

    await screen.findByText('Alice');
    await userEventInst.click(screen.getByRole('button', { name: /禁用/i }));

    expect(await screen.findByText(/禁用状态/)).toBeInTheDocument();
  });
});
