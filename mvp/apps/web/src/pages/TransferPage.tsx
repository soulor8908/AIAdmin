// apps/web/src/pages/TransferPage.tsx —— 调岗独立页（TECH-WEB-TRANSFER-INHERITANCE-001 §6.1，Q1 决策①独立路由）
//
// 职责：
//   - 路由 /transfer（独立路由，对齐 R14 DeptTreePage 独立路由风格，Q1 决策①）。
//   - 渲染：标题"调岗管理" + <TransferForm> + 成功提示区 + 错误提示区。
//   - TransferForm onSubmitted 回调 → 显示"调岗成功"提示 + TransferForm 重置（D14，AC-F1-3）。
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（components/TransferForm + auth）+ 第三方。
// [约束] D14：调岗成功 → 显示"调岗成功"提示 + TransferForm 重置（不跳转用户详情/调岗历史，Q3/Q4 决策①）。
// [约束] D13：TransferForm 选择器数据源由 TransferForm 内部加载（listRoles/getDepartmentTree/listUserRoles）。
//
// [test-writer stub] AI-002 test-first：本文件为 stub，组件 render 抛 NOT_IMPLEMENTED，测试期断言级红
//   （transfer-page.test.tsx render TransferPage 失败 → 断言级红，非导入级红）。
//   impl-writer 阶段落地真实实现（见 Spec §6.1 实现提示）。

/** TransferPage 组件 props（无 props，用 useAuth + 内部 state）。 */
export type TransferPageProps = Record<string, never>;

/**
 * TransferPage —— 调岗独立页（F1，含 TransferForm + 成功/错误提示区）。
 * impl-writer 落地：渲染标题 + <TransferForm onSubmitted={...} /> + 成功提示区（"调岗成功"）+ 错误提示区。
 */
export function TransferPage(_props: TransferPageProps): JSX.Element {
  // [test-writer stub] impl-writer 替换为真实渲染（标题 + <TransferForm onSubmitted={...} /> + 成功/错误提示区）。
  void _props;
  throw new Error('NOT_IMPLEMENTED');
}
