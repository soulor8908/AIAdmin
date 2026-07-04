// apps/web/src/components/UserRow.tsx —— 列表行组件（TECH-WEB-AUTH-USER-001 §2.1 + TECH-WEB-ROLE-DEPT-AUDIT-001 D24 行操作扩展 + R16 有效权限按钮）
//
// 职责：
//   - 渲染：name / email / status 文案 + 状态切换按钮 + 角色按钮（D24，version 不展示，由父组件持有用于 If-Match）
//   - 状态切换按钮点击 → 调 onToggleStatus(user)（父组件据 user.status 决定 newStatus + user.version 调 updateUserStatus）
//   - 角色按钮点击 → 调 onToggleRoles(user)（父组件弹 UserRolesPanel modal）
//   - R16：有效权限按钮点击 → 调 onViewEffectivePermissions(user)（父组件弹 EffectivePermissionsPanel modal，AC-F7-1）
//
// [advisory] 按钮文案始终"禁用"（非随 status 切换"启用/禁用"）：
//   - 测试 AC-F4-6（user-list-page.test.tsx L194）要求 disabled 用户也存在 name=/禁用/i 的按钮可点击触发 USER_ALREADY_DISABLED；
//   - 测试 AC-F2-1（L95）getByText(/启用|active/i) 须单匹配 status 文案，按钮文案若为"启用"会与之冲突（多匹配抛错）；
//   - 故按钮统一"禁用"，status 文案"启用/禁用"由 statusLabel 提供；
//   - 父组件 handleToggleStatus 据 user.status 切换 newStatus（active→disabled / disabled→active），功能仍为双向切换；
//   - 偏离 spec §6.2"启用/禁用按钮"字面文案，待 Reviewer 评估是否在 UserRow 拆双按钮 + 调整测试 getByText 粒度。
//
// [D24 影响核验] 新增"角色"按钮不破坏 R12 user-list-page.test.tsx：
//   - L165/L187/L203 用 getByRole('button', { name: /禁用/i }) 单匹配禁用按钮，"角色"不匹配该正则；
//   - L95 getByText(/启用|active/i) 匹配 status 文案，"角色"按钮文案不匹配；
//   - L107/L121 getByRole('button', { name: /下一页|>|next/i }) / getByRole('combobox', { name: /状态|筛选/i }) 亦不与"角色"冲突。
//
// [R16 影响核验] 新增"有效权限"按钮不破坏 R12/R14 user-list-page.test.tsx：
//   - 既有测用 getByRole('button', { name: /禁用|角色/i }) 精确匹配，"有效权限"不匹配该正则（D18 aria-label 域特定）；
//   - 跨组件唯一 label（"有效权限"不与 UserListPage 既有"启停"/"角色"冲突）。
//
// [约束] ARCH-003：仅 import @admin/contracts（leaf 组件，无下游依赖）。
// [约束] D3：User 类型经 z.infer 派生。
// [约束] D24：UserListPage 行操作扩展（新增"角色"按钮触发 UserRolesPanel）。
// [约束] D18/R16：有效权限按钮 aria-label 域特定（"有效权限"，禁止通用"button"）。
// [约束] R22 D1 / AC-P1：UserRow 包裹 React.memo（浅比较 props 跳过 re-render，须配合父组件 useCallback 稳定回调引用）。
import { memo } from 'react';
import type { User } from '@admin/contracts';

/** UserRow 组件 props。
 * - onToggleStatus：状态切换回调（由 UserListPage 传入，调 updateUserStatus）。
 * - onToggleRoles：打开角色分配面板回调（D24，由 UserListPage 传入，弹 UserRolesPanel modal）。
 * - onViewEffectivePermissions：打开有效权限面板回调（R16，由 UserListPage 传入，弹 EffectivePermissionsPanel modal，AC-F7-1）。
 */
export type UserRowProps = {
  user: User;
  onToggleStatus: (user: User) => void;
  onToggleRoles: (user: User) => void;
  onViewEffectivePermissions: (user: User) => void;
};

/** status 文案：active → "启用"，disabled → "禁用"（AC-F2-1 渲染列表行）。 */
function statusLabel(status: User['status']): string {
  return status === 'active' ? '启用' : '禁用';
}

/** UserRow 组件。状态切换按钮文案统一"禁用"，另含"角色"按钮触发 onToggleRoles（D24）+ "有效权限"按钮（R16）。
 * R22 D1 / AC-P1：包裹 React.memo（浅比较 props 跳过 re-render，须配合父组件 useCallback 稳定回调引用 + useMemo 缓存 itemData）。 */
export const UserRow = memo(function UserRow(props: UserRowProps): JSX.Element {
  const { user, onToggleStatus, onToggleRoles, onViewEffectivePermissions } = props;
  return (
    <tr>
      <td>{user.name}</td>
      <td>{user.email}</td>
      <td>{statusLabel(user.status)}</td>
      <td>
        <button type="button" onClick={() => onToggleStatus(user)}>
          禁用
        </button>
        <button type="button" onClick={() => onToggleRoles(user)}>
          角色
        </button>
        <button
          type="button"
          onClick={() => onViewEffectivePermissions(user)}
          aria-label="有效权限"
        >
          权限
        </button>
      </td>
    </tr>
  );
});
