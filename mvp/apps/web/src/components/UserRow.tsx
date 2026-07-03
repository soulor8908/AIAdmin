// apps/web/src/components/UserRow.tsx —— 列表行组件（TECH-WEB-AUTH-USER-001 §2.1）
//
// 职责（impl-writer 落地，本文件为 stub）：
//   - 渲染：name / email / status + 启用/禁用按钮（+ version 隐藏用于 If-Match）
//   - 启停按钮点击 → 调 onToggleStatus(user)
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（lib/errorMapping）。
// [约束] D3：User 类型经 z.infer 派生。
import type { User } from '@admin/contracts';

/** UserRow 组件 props。onToggleStatus：启停回调（由 UserListPage 传入，调 updateUserStatus）。 */
export type UserRowProps = {
  user: User;
  onToggleStatus: (user: User) => void;
};

/** UserRow 组件。stub 抛 NOT_IMPLEMENTED（断言级红）。 */
export function UserRow(_props: UserRowProps): JSX.Element {
  throw new Error('NOT_IMPLEMENTED');
}
