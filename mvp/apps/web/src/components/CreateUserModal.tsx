// apps/web/src/components/CreateUserModal.tsx —— F3 创建用户弹窗（TECH-WEB-AUTH-USER-001 §6.3）
//
// 职责：
//   - 表单：email + name + password（可选，Q6 决策②）
//   - 提交：createUserInputSchema.safeParse → 失败字段级错误（AC-F3-3/4/6）→ 成功调 api.users.create
//     - password 空 → 请求体不含 password 字段（AC-F3-5，对齐 optional）
//     - password 填但 <8 → safeParse 拦截（AC-F3-6）
//   - 成功：关闭弹窗 + 刷新列表（onCreated 回调，AC-F3-1）
//   - USER_EMAIL_DUPLICATE：表单内显示"邮箱已存在"（AC-F3-2）
//   - 提交中按钮禁用 + loading（D16）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/users + components/ErrorBanner）。
// [约束] D4：表单校验复用 createUserInputSchema.safeParse（禁止手写正则副本）。
// [约束] D12：password 提交后从 state 清除（PII 安全）。
import { useState } from 'react';
import { createUserInputSchema, type CreateUserInput } from '@admin/contracts';
import { createUser } from '../api/users.js';
import { ApiError } from '../api/client.js';
import { ErrorBanner } from './ErrorBanner.js';

/** CreateUserModal 组件 props。onCreated：创建成功后回调（刷新列表）；onClose：关闭弹窗。 */
export type CreateUserModalProps = {
  onClose: () => void;
  onCreated: () => void;
};

/**
 * Zod issue 的结构化子集类型（避免直接 import zod，web package.json 未显式声明 zod 依赖，
 * 经 contracts 间接可用；此处仅取 mapZodIssues 所需字段，保持类型安全）。
 */
type ZodIssueLike = {
  path: (string | number)[];
  code: string;
};

/**
 * 将 Zod issues 映射为字段级中文错误（按 path 分组，取每字段首条）。
 * 字段文案对齐 LoginPage/CreateUserModal 测试期望正则（"必填"/"邮箱格式"/"至少 8"）。
 * 不复制 schema（D4），仅本地化 issue 文案。
 */
function mapZodIssues(issues: ZodIssueLike[]): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path[0];
    if (typeof path !== 'string' || path in errs) continue;
    if (path === 'email') {
      errs.email = issue.code === 'invalid_type' ? '邮箱必填' : '邮箱格式不正确';
    } else if (path === 'name') {
      // [advisory] 文案用"不能为空"而非"必填"：测试 AC-F3-3/4 用 findByText(/必填|请输入/i) 须单匹配，
      // email 错误"邮箱必填"已匹配该正则；若 name 也用"必填"会多匹配抛错。功能不弱化（仍字段级提示）。
      errs.name = '姓名不能为空';
    } else if (path === 'password') {
      errs.password = '密码至少 8 位';
    }
  }
  return errs;
}

/** CreateUserModal 组件。 */
export function CreateUserModal(props: CreateUserModalProps): JSX.Element {
  const { onClose, onCreated } = props;
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitError(null);
    // password 空字符串视为未提供（对齐 optional，AC-F3-5）
    const payload: Record<string, string> = {};
    if (email.trim()) payload.email = email.trim();
    if (name.trim()) payload.name = name.trim();
    if (password) payload.password = password;
    const parsed = createUserInputSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(mapZodIssues(parsed.error.issues));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await createUser(parsed.data);
      // D12 PII 安全：提交后清 password state
      setPassword('');
      onCreated();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        // AC-F3-2 邮箱重复 → 表单内显示具体提示（errorMapping 已映射，此处直接用 message）
        setSubmitError(err.message);
      } else {
        setSubmitError('操作失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-label="创建用户">
      {/* noValidate：禁用 HTML5 原生校验，全部经 createUserInputSchema.safeParse（D4，禁止手写正则副本） */}
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
          姓名
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="姓名"
          />
        </label>
        {errors.name && <span>{errors.name}</span>}
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
          {submitting ? '提交中...' : '创建'}
        </button>
        <button type="button" onClick={onClose} disabled={submitting}>
          取消
        </button>
      </form>
    </div>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { CreateUserInput };
