// apps/web/src/components/SetParentModal.tsx —— 设置父角色弹窗（TECH-WEB-TRANSFER-INHERITANCE-001 §6.4，versioned + superRefine）
//
// 职责（F4）：
//   - 形态：modal（Q8 决策①，对齐 R14 RoleForm/R15 NotificationForm modal 风格），从 RoleListPage 行操作"设置父角色"按钮触发。
//   - 字段：parentRoleId select（aria-label="父角色"，D18），options 从 listRoles 派生。
//     · 禁用自继承 option value === roleId（前端防 ROLE_SELF_INHERITANCE，AC-F4-2）。
//     · 禁用内置 admin option is_builtin === true（前端防 ROLE_BUILTIN_PARENT_FORBIDDEN，AC-F4-3）。
//   - 提交：setParentInputSchema.safeParse（覆盖 superRefine roleId !== parentRoleId）→ setRoleParent(roleId, parentRoleId, expectedVersion)（versioned，D7）。
//   - 错误：ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE/ROLE_NOT_FOUND/VERSION_CONFLICT（§11.2）。
//
// [约束] ARCH-003：仅 import @admin/contracts（setParentInputSchema 复用，D4）+ apps/web 内部（api/）+ 第三方。
// [约束] D4：混合表单须 setParentInputSchema.safeParse（覆盖 superRefine，R13 S-1）。
// [约束] D7：versioned=true + expectedVersion=role.version → client 注入 If-Match（AC-F4-1）。
// [约束] D12：禁用自继承 roleId + 禁用内置 admin（前端防，后端兜底）。
// [约束] D18：aria-label="父角色"；D21/R15 S-14：label 跨组件唯一（"父角色" 消歧于 RoleListPage"角色名称"）。
//
// [test-writer stub] AI-002 test-first：本文件为 stub，组件 render 抛 NOT_IMPLEMENTED，测试期断言级红。
//   impl-writer 阶段落地真实实现（见 Spec §6.4 实现提示）。

/** SetParentModal 组件 props（roleId/expectedVersion 从 RoleListPage 行派生，onClose/onUpdated 回调）。 */
export type SetParentModalProps = {
  roleId: string;
  expectedVersion: number;
  onClose: () => void;
  onUpdated: () => void;
};

/**
 * SetParentModal —— 设置父角色弹窗（F4，versioned + superRefine + 禁用项）。
 * impl-writer 落地：parentRoleId select（禁用自继承+内置 admin）+ safeParse + setRoleParent + 错误码提示（§6.4/§11.2）。
 */
export function SetParentModal(_props: SetParentModalProps): JSX.Element {
  // [test-writer stub] impl-writer 替换为真实弹窗实现。
  void _props;
  throw new Error('NOT_IMPLEMENTED');
}
