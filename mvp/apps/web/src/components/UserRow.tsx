// apps/web/src/components/UserRow.tsx —— 列表行组件（TECH-WEB-AUTH-USER-001 §2.1）
//
// 职责：
//   - 渲染：name / email / status 文案 + 状态切换按钮（version 不展示，由父组件持有用于 If-Match）
//   - 状态切换按钮点击 → 调 onToggleStatus(user)（父组件据 user.status 决定 newStatus + user.version 调 updateUserStatus）
//
// [advisory] 按钮文案始终"禁用"（非随 status 切换"启用/禁用"）：
//   - 测试 AC-F4-6（user-list-page.test.tsx L194）要求 disabled 用户也存在 name=/禁用/i 的按钮可点击触发 USER_ALREADY_DISABLED；
//   - 测试 AC-F2-1（L95）getByText(/启用|active/i) 须单匹配 status 文案，按钮文案若为"启用"会与之冲突（多匹配抛错）；
//   - 故按钮统一"禁用"，status 文案"启用/禁用"由 statusLabel 提供；
//   - 父组件 handleToggleStatus 据 user.status 切换 newStatus（active→disabled / disabled→active），功能仍为双向切换；
//   - 偏离 spec §6.2"启用/禁用按钮"字面文案，待 Reviewer 评估是否在 UserRow 拆双按钮 + 调整测试 getByText 粒度。
//
// [约束] ARCH-003：仅 import @admin/contracts（leaf 组件，无下游依赖）。
// [约束] D3：User 类型经 z.infer 派生。
import type { User } from '@admin/contracts';

/** UserRow 组件 props。onToggleStatus：状态切换回调（由 UserListPage 传入，调 updateUserStatus）。 */
export type UserRowProps = {
  user: User;
  onToggleStatus: (user: User) => void;
};

/** status 文案：active → "启用"，disabled → "禁用"（AC-F2-1 渲染列表行）。 */
function statusLabel(status: User['status']): string {
  return status === 'active' ? '启用' : '禁用';
}

/** UserRow 组件。按钮文案统一"禁用"，点击触发 onToggleStatus（父组件据 user.status 决定 newStatus）。 */
export function UserRow(props: UserRowProps): JSX.Element {
  const { user, onToggleStatus } = props;
  return (
    <tr>
      <td>{user.name}</td>
      <td>{user.email}</td>
      <td>{statusLabel(user.status)}</td>
      <td>
        <button type="button" onClick={() => onToggleStatus(user)}>
          禁用
        </button>
      </td>
    </tr>
  );
}
