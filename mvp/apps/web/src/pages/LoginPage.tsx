// apps/web/src/pages/LoginPage.tsx —— F1 登录页（TECH-WEB-AUTH-USER-001 §6.1）
//
// 职责：
//   - 表单：email + password 输入框 + 提交按钮
//   - 提交：loginInputSchema.safeParse → 失败字段级错误（AC-F1-4/5/6）→ 成功调 useAuth().login
//   - 失败 INVALID_CREDENTIALS：显示"邮箱或密码错误"（AC-F1-2/3）
//   - 提交中：按钮 disabled + loading 文案（AC-F1-8，D16）
//   - 已登录访问 /login：RouteGuard 跳 /users（AC-F1-7，由 RouteGuard 覆盖）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（auth/AuthContext + components/ErrorBanner）。
// [约束] D4：表单校验复用 loginInputSchema.safeParse（禁止手写正则副本）。
// [约束] D12：password 提交后从 state 清除（PII 安全，SEC-003b）。
import { useState } from 'react';
import { loginInputSchema, type LoginInput } from '@admin/contracts';
import { useAuth } from '../auth/AuthContext.js';
import { ApiError } from '../api/client.js';
import { ErrorBanner } from '../components/ErrorBanner.js';

/** Zod issue 结构化子集（同 CreateUserModal 原因，避免直接 import zod）。 */
type ZodIssueLike = {
  path: (string | number)[];
  code: string;
};

/** 将 loginInputSchema.safeParse 的 issues 映射为字段级中文错误。 */
function mapLoginIssues(issues: ZodIssueLike[]): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path[0];
    if (typeof path !== 'string' || path in errs) continue;
    if (path === 'email') {
      errs.email = issue.code === 'invalid_type' ? '邮箱必填' : '邮箱格式不正确';
    } else if (path === 'password') {
      errs.password = '密码至少 8 位';
    }
  }
  return errs;
}

/** LoginPage 组件。 */
export function LoginPage(): JSX.Element {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitError(null);
    const payload: Record<string, string> = {};
    if (email.trim()) payload.email = email.trim();
    if (password) payload.password = password;
    const parsed = loginInputSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(mapLoginIssues(parsed.error.issues as ZodIssueLike[]));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await login(parsed.data);
      // D12 PII 安全：提交后清 password state
      setPassword('');
    } catch (err) {
      if (err instanceof ApiError) {
        // AC-F1-2/3：INVALID_CREDENTIALS 显示具体错误（防枚举）
        setSubmitError(err.message);
      } else {
        setSubmitError('操作失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // noValidate：禁用 HTML5 原生校验（input type=email 非法值会阻断 submit），全部经 loginInputSchema.safeParse（D4）
  return (
    <form onSubmit={handleSubmit} noValidate>
      <label>
        邮箱
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="邮箱"
        />
      </label>
      {errors.email && <span>{errors.email}</span>}
      <label>
        密码
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="密码"
        />
      </label>
      {errors.password && <span>{errors.password}</span>}
      <ErrorBanner message={submitError} />
      <button type="submit" disabled={submitting}>
        {submitting ? '登录中...' : '登录'}
      </button>
    </form>
  );
}

/** 导出表单输入类型（contracts 派生），供测试/组件引用。 */
export type { LoginInput };
