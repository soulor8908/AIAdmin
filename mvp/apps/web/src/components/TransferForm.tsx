// apps/web/src/components/TransferForm.tsx —— 调岗混合表单（TECH-WEB-TRANSFER-INHERITANCE-001 §6.2，T4 superRefine）
//
// 职责（F1/F2/F3）：
//   - 4 字段控件（D13 选择器混合，Q2 决策②）：
//     · userId：input type=text（aria-label="用户 ID"，D18），自由文本 UUID 输入。
//     · toDepartmentId：select（aria-label="目标部门"，D18），options 从 getDepartmentTree 派生。
//     · oldRoleId：select（aria-label="原角色"，D18），options 从 listUserRoles(userId) 派生（AC-F1-2）。
//     · newRoleId：select（aria-label="新角色"，D18），options 从 listRoles 派生。
//     · "提交调岗"按钮（aria-label="提交调岗"，D18）。
//   - 提交：transferInputSchema.safeParse 整体校验（覆盖 userId uuid + 4 字段 uuid + .strict() + superRefine oldRoleId !== newRoleId）。
//   - 成功：onSubmitted 回调（TransferPage 显示"调岗成功" + 重置，AC-F1-3）。
//
// [约束] ARCH-003：仅 import @admin/contracts（transferInputSchema 复用，D4）+ apps/web 内部（api/）+ 第三方。
// [约束] D4：自由文本/选择器混合表单须 transferInputSchema.safeParse（覆盖 superRefine + .strict() + uuid，R13 S-1）。
// [约束] D13：userId 自由文本 + oldRoleId/newRoleId/toDepartmentId select（选择器数据源见 §6.1/§6.2）。
// [约束] D14：提交按钮原子提交（R14 S-9 教训：userId 输入失焦/完整 uuid 触发 listUserRoles，不每键入触发）。
// [约束] D18：aria-label 域特定（"用户 ID"/"目标部门"/"原角色"/"新角色"/"提交调岗"）。
// [约束] D21/R15 S-13：测试 fixture 须用有效 hex UUID；R15 S-14：label 跨组件唯一。
//
// [test-writer stub] AI-002 test-first：本文件为 stub，组件 render 抛 NOT_IMPLEMENTED，测试期断言级红
//   （transfer-page.test.tsx 经 TransferPage render → TransferForm render 抛错 → 断言级红）。
//   impl-writer 阶段落地真实实现（见 Spec §6.2 实现提示）。

/** TransferForm 组件 props（onSubmitted 成功回调，TransferPage 显示"调岗成功"+ 重置）。 */
export type TransferFormProps = {
  onSubmitted?: () => void;
};

/**
 * TransferForm —— 调岗混合表单（F1/F2/F3）。
 * impl-writer 落地：4 字段控件 + transferInputSchema.safeParse + transferUser 调用 + 错误码提示（§6.2/§11.1）。
 */
export function TransferForm(_props: TransferFormProps): JSX.Element {
  // [test-writer stub] impl-writer 替换为真实表单实现。
  void _props;
  throw new Error('NOT_IMPLEMENTED');
}
