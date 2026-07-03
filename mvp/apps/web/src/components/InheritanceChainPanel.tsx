// apps/web/src/components/InheritanceChainPanel.tsx —— 继承链展示（TECH-WEB-TRANSFER-INHERITANCE-001 §6.5，链形文本 Q6）
//
// 职责（F6）：
//   - 形态：modal/drawer（从 RoleListPage 行操作"查看继承链"按钮触发），传入 roleId。
//   - 加载：getInheritanceChain(roleId)（非 cacheable，T3，不发 If-None-Match）→ 裸 Role[] 祖先数组。
//   - 渲染（D10，Q6 链形文本）：
//     · 有父角色（chain.length > 0）：链形文本"父角色 B → 祖父角色 C → 曾祖父角色 D"（" → " 分隔，按返回顺序，AC-F6-1/F6-3）。
//     · 根角色空数组（chain.length === 0）：显示"无父角色"（D7 / AC-F6-2）。
//   - 错误：ROLE_NOT_FOUND → "角色不存在"（AC-F6-4，T2）。
//
// [约束] ARCH-003：仅 import @admin/contracts（Role 类型派生）+ apps/web 内部（api/role-inheritance）+ 第三方。
// [约束] D5：类型派生操作（roleId 从列表派生，TS 类型保证，不调 safeParse，R13 S-1）。
// [约束] D10：链形文本（" → " 分隔，Q6 决策①，不做树形/图表，D23）。
// [约束] D18：aria-label="继承链"；D21/R15 S-14：label 跨组件唯一。
//
// [test-writer stub] AI-002 test-first：本文件为 stub，组件 render 抛 NOT_IMPLEMENTED，测试期断言级红。
//   impl-writer 阶段落地真实实现（见 Spec §6.5 实现提示）。

/** InheritanceChainPanel 组件 props（roleId 从 RoleListPage 行派生，onClose 可选）。 */
export type InheritanceChainPanelProps = {
  roleId: string;
  onClose?: () => void;
};

/**
 * InheritanceChainPanel —— 继承链展示（F6，链形文本 + 根角色空数组"无父角色"）。
 * impl-writer 落地：getInheritanceChain 加载 + 链形文本渲染 + 根角色空数组"无父角色" + ROLE_NOT_FOUND 提示（§6.5）。
 */
export function InheritanceChainPanel(_props: InheritanceChainPanelProps): JSX.Element {
  // [test-writer stub] impl-writer 替换为真实继承链展示。
  void _props;
  throw new Error('NOT_IMPLEMENTED');
}
