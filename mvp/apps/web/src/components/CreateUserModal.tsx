// apps/web/src/components/CreateUserModal.tsx —— F3 创建用户弹窗（TECH-WEB-AUTH-USER-001 §6.3）
//
// 职责（impl-writer 落地，本文件为 stub）：
//   - 表单：email + name + password（可选，Q6 决策②）
//   - 提交：createUserInputSchema.safeParse → 失败字段级错误（AC-F3-3/4/6）→ 成功调 api.users.create
//     - password 空 → 请求体不含 password 字段（AC-F3-5，对齐 optional）
//     - password 填但 <8 → safeParse 拦截（AC-F3-6）
//   - 成功：关闭弹窗 + 刷新列表（onCreated 回调，AC-F3-1）
//   - USER_EMAIL_DUPLICATE：表单内显示"邮箱已存在"（AC-F3-2）
//   - 提交中按钮禁用 + loading（D16）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/users + lib/errorMapping）。
// [约束] D4：表单校验复用 createUserInputSchema.safeParse（禁止手写正则副本）。
// [约束] D12：password 提交后从 state 清除（PII 安全）。
import type { CreateUserInput } from '@admin/contracts';

/** CreateUserModal 组件 props。onCreated：创建成功后回调（刷新列表）；onClose：关闭弹窗。 */
export type CreateUserModalProps = {
  onClose: () => void;
  onCreated: () => void;
};

/** CreateUserModal 组件。stub 抛 NOT_IMPLEMENTED（断言级红）。 */
export function CreateUserModal(_props: CreateUserModalProps): JSX.Element {
  throw new Error('NOT_IMPLEMENTED');
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { CreateUserInput };
