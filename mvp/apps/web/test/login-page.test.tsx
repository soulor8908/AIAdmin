// @vitest-environment jsdom
// apps/web/test/login-page.test.tsx —— ③类新增 LoginPage 组件测（TECH-WEB-AUTH-USER-001 §9.3 #3）
//
// 覆盖 AC：AC-F1-1~F1-8
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api.auth.login（控制 resolve/reject），AuthContext.Provider 提供 login action spy。
//   - 期望「断言级红」：LoginPage stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红，因符号已导出）。
//   - D4：表单校验复用 loginInputSchema.safeParse（email 格式 + password min(8) + 空字段）。
//   - SEC-003b：测试中不 console.log/记录 password 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '../src/pages/LoginPage.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import { ApiError } from '../src/api/client.js';

// mock api.auth（控制 login API resolve/reject）
vi.mock('../src/api/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
}));

function renderLoginPage(authOverrides: Partial<AuthContextValue> = {}) {
  const authValue: AuthContextValue = {
    isAuthenticated: false,
    token: null,
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...authOverrides,
  };
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F1-1 渲染 ----------
  it('渲染 email + password 输入框 + 提交按钮', () => {
    renderLoginPage();
    expect(screen.getByLabelText(/邮箱/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/密码/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /登录/i })).toBeInTheDocument();
  });

  // ---------- AC-F1-6 空提交 → 字段级错误 ----------
  it('空提交 → 字段级错误（不发请求，AC-F1-6）', async () => {
    const loginSpy = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLoginPage({ login: loginSpy });

    await user.click(screen.getByRole('button', { name: /登录/i }));

    expect(await screen.findByText(/必填|请输入/i)).toBeInTheDocument();
    expect(loginSpy).not.toHaveBeenCalled();
  });

  // ---------- AC-F1-5 password < 8 → 字段级错误 ----------
  it('password < 8 → 字段级错误"密码至少 8 位"（AC-F1-5）', async () => {
    const loginSpy = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLoginPage({ login: loginSpy });

    await user.type(screen.getByLabelText(/邮箱/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/密码/i), 'short');
    await user.click(screen.getByRole('button', { name: /登录/i }));

    expect(await screen.findByText(/至少\s*8|密码.*8/i)).toBeInTheDocument();
    expect(loginSpy).not.toHaveBeenCalled();
  });

  // ---------- AC-F1-4 email 非法格式 → 字段级错误 ----------
  it('email 非法格式 → 字段级错误"邮箱格式不正确"（AC-F1-4）', async () => {
    const loginSpy = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLoginPage({ login: loginSpy });

    await user.type(screen.getByLabelText(/邮箱/i), 'not-an-email');
    await user.type(screen.getByLabelText(/密码/i), 'password123');
    await user.click(screen.getByRole('button', { name: /登录/i }));

    expect(await screen.findByText(/邮箱格式/i)).toBeInTheDocument();
    expect(loginSpy).not.toHaveBeenCalled();
  });

  // ---------- AC-F1-1 提交成功 → 调用 login action ----------
  it('提交成功 → 调用 useAuth().login（AC-F1-1）', async () => {
    const loginSpy = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLoginPage({ login: loginSpy });

    await user.type(screen.getByLabelText(/邮箱/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/密码/i), 'password123');
    await user.click(screen.getByRole('button', { name: /登录/i }));

    await waitFor(() => {
      expect(loginSpy).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'password123' });
    });
  });

  // ---------- AC-F1-2/3 INVALID_CREDENTIALS → 显示错误 ----------
  it('INVALID_CREDENTIALS → 显示"邮箱或密码错误"（AC-F1-2/3，防枚举）', async () => {
    const loginSpy = vi.fn().mockRejectedValue(
      new ApiError('INVALID_CREDENTIALS', '邮箱或密码错误'),
    );
    const user = userEvent.setup();
    renderLoginPage({ login: loginSpy });

    await user.type(screen.getByLabelText(/邮箱/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/密码/i), 'wrongpass1');
    await user.click(screen.getByRole('button', { name: /登录/i }));

    expect(await screen.findByText('邮箱或密码错误')).toBeInTheDocument();
  });

  // ---------- AC-F1-8 提交中按钮 disabled + loading ----------
  it('提交中按钮 disabled + loading 文案（AC-F1-8，D16）', async () => {
    // login 永不 resolve（保持 loading 态）
    const loginSpy = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    const user = userEvent.setup();
    renderLoginPage({ login: loginSpy });

    await user.type(screen.getByLabelText(/邮箱/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/密码/i), 'password123');
    await user.click(screen.getByRole('button', { name: /登录/i }));

    await waitFor(() => {
      const btn = screen.getByRole('button');
      expect(btn).toBeDisabled();
    });
    expect(screen.getByText(/loading|提交中|登录中/i)).toBeInTheDocument();
  });
});
