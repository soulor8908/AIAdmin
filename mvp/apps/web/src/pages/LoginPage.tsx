// apps/web/src/pages/LoginPage.tsx —— F1 登录页（TECH-WEB-AUTH-USER-001 §6.1）
//
// 职责（impl-writer 落地，本文件为 stub）：
//   - 表单：email + password 输入框 + 提交按钮
//   - 提交：loginInputSchema.safeParse → 失败字段级错误（AC-F1-4/5/6）→ 成功调 useAuth().login
//   - 失败 INVALID_CREDENTIALS：显示"邮箱或密码错误"（AC-F1-2/3）
//   - 提交中：按钮 disabled + loading 文案（AC-F1-8，D16）
//   - 已登录访问 /login：RouteGuard 跳 /users（AC-F1-7，由 RouteGuard 覆盖）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/auth + auth/AuthContext + components）。
// [约束] D4：表单校验复用 loginInputSchema.safeParse（禁止手写正则副本）。
// [约束] D12：password 提交后从 state 清除（PII 安全，SEC-003b）。
import type { LoginInput } from '@admin/contracts';

/** LoginPage 组件。stub 抛 NOT_IMPLEMENTED（断言级红）。 */
export function LoginPage(): JSX.Element {
  throw new Error('NOT_IMPLEMENTED');
}

/** 导出表单输入类型（contracts 派生），供测试/组件引用。 */
export type { LoginInput };
