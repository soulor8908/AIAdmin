// apps/web/src/components/EffectivePermissionsPanel.tsx —— 有效权限展示（TECH-WEB-TRANSFER-INHERITANCE-001 §6.6，Q7 modal）
//
// 职责（F7）：
//   - 形态：modal（Q7 决策③，从 UserListPage 行操作"有效权限"按钮触发），传入 userId。
//   - 加载：getEffectivePermissions(userId)（非 cacheable，T3，不发 If-None-Match）→ 裸 PermissionCode[] 集合。
//   - 渲染（D11，Q7 权限码集合）：
//     · 有权限（length > 0）：渲染权限码列表（每项中文化映射，D11，如 user:read→"查看用户"、transfer:write→"调岗用户"）。
//       权限码中文化映射 SSOT 派生：键从 [...permissionCodeSchema.options] 派生（11 项全集，AI-005，AC-F7-3）。
//     · 空集合（length === 0）：显示"该用户暂无有效权限"（AC-F7-2）。
//   - 错误：USER_NOT_FOUND → "用户不存在"（AC-F7-4，T1）。
//
// [约束] ARCH-003：仅 import @admin/contracts（PermissionCode/permissionCodeSchema 派生）+ apps/web 内部（api/）+ 第三方。
// [约束] D5：类型派生操作（userId 从 UserListPage 行派生，TS 类型保证，不调 safeParse，R13 S-1）。
// [约束] D11：权限码中文化映射 SSOT 派生 [...permissionCodeSchema.options]（AI-005，禁止硬编码，AC-F7-3）。
// [约束] D18：aria-label="有效权限"；D21/R15 S-14：label 跨组件唯一（"有效权限" 消歧于 UserListPage"角色"按钮）。
//
// [test-writer stub] AI-002 test-first：本文件为 stub，组件 render 抛 NOT_IMPLEMENTED，测试期断言级红。
//   impl-writer 阶段落地真实实现（见 Spec §6.6 实现提示）。

/** EffectivePermissionsPanel 组件 props（userId 从 UserListPage 行派生，onClose 可选）。 */
export type EffectivePermissionsPanelProps = {
  userId: string;
  onClose?: () => void;
};

/**
 * EffectivePermissionsPanel —— 有效权限展示（F7，权限码列表 + 中文化 SSOT 派生 + 空集合提示）。
 * impl-writer 落地：getEffectivePermissions 加载 + 权限码列表中文化 + 空集合"该用户暂无有效权限" + USER_NOT_FOUND 提示（§6.6）。
 */
export function EffectivePermissionsPanel(_props: EffectivePermissionsPanelProps): JSX.Element {
  // [test-writer stub] impl-writer 替换为真实有效权限展示。
  void _props;
  throw new Error('NOT_IMPLEMENTED');
}
