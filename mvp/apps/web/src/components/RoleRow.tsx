// apps/web/src/components/RoleRow.tsx —— 角色列表行组件（R22 D2 提取自 RoleListPage L205-245 内联 <tr>）
//
// 职责：
//   - 渲染：name / description / is_builtin 标识 + 操作按钮（删除/设置父角色/解除父角色/查看继承链）
//   - 删除按钮 → 调 onDelete(role)（父组件调 deleteRole versioned）
//   - 设置父角色按钮 → 调 onSetParent(role)（父组件弹 SetParentModal）
//   - 解除父角色按钮 → 调 onUnsetParent(role)（仅 parent_role_id !== null 时显示，根角色不显示，AC-F5-2）
//   - 查看继承链按钮 → 调 onViewChain(role.id)（父组件弹 InheritanceChainPanel）
//
// [约束] ARCH-003：仅 import @admin/contracts（leaf 组件，无下游依赖）。
// [约束] D3：Role 类型经 z.infer 派生。
// [约束] D7：删除/解除父角色回调由父组件持 role.version 调用 versioned API（If-Match）。
// [约束] D12 / AC-F5-2：解除父角色按钮仅 parent_role_id !== null 时显示（根角色不显示，前端防无意义操作）。
// [约束] D18：行操作按钮 accessible name 域特定（按钮文本"设置父角色"/"解除父角色"/"查看继承链"，禁止通用"button"）。
// [约束] R22 D2 / AC-P1：包裹 React.memo（浅比较 props 跳过 re-render，须配合父组件 useCallback 稳定回调引用）。
import { memo } from 'react';
import type { Role } from '@admin/contracts';

/** RoleRow 组件 props（提取自 RoleListPage 内联 <tr>，回调签名对齐父组件 handle* 函数）。 */
export type RoleRowProps = {
  role: Role;
  onDelete: (role: Role) => void;
  onSetParent: (role: Role) => void;
  onUnsetParent: (role: Role) => void;
  onViewChain: (roleId: string) => void;
};

/** RoleRow 组件。R22 D2 提取自 RoleListPage 内联 <tr> + memo 包裹（AC-P1）。 */
export const RoleRow = memo(function RoleRow(props: RoleRowProps): JSX.Element {
  const { role, onDelete, onSetParent, onUnsetParent, onViewChain } = props;
  return (
    <tr key={role.id}>
      <td>{role.name}</td>
      <td>{role.description}</td>
      <td>{role.is_builtin ? '内置' : '自定义'}</td>
      <td>
        <button
          type="button"
          onClick={() => onDelete(role)}
          disabled={role.is_builtin}
        >
          删除
        </button>
        {/* R16 行操作扩展（D18 域特定：按钮文本即域特定 accessible name，无需 aria-label 冗余）。
            [advisory] 移除 aria-label：原 aria-label="设置父角色" 与 SetParentModal select aria-label="父角色"
            同含"父角色"导致 findByLabelText(/父角色/i) 多匹配（RoleListPage 行按钮 + SetParentModal select）。
            按钮文本"设置父角色"/"解除父角色"/"查看继承链"提供等价 accessible name，getByRole('button',{name:...}) 不受影响。 */}
        <button
          type="button"
          onClick={() => onSetParent(role)}
        >
          设置父角色
        </button>
        {/* D12：解除父角色按钮仅 parent_role_id !== null 时显示（根角色不显示，AC-F5-2） */}
        {role.parent_role_id !== null && (
          <button
            type="button"
            onClick={() => onUnsetParent(role)}
          >
            解除父角色
          </button>
        )}
        <button
          type="button"
          onClick={() => onViewChain(role.id)}
        >
          查看继承链
        </button>
      </td>
    </tr>
  );
});
