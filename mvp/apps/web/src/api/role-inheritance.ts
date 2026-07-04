// apps/web/src/api/role-inheritance.ts —— 角色继承域 endpoint 封装（TECH-WEB-TRANSFER-INHERITANCE-001 §4.2.2）
//
// 职责：
//   - setRoleParent(roleId, parentRoleId, expectedVersion)：POST /v1/roles/:roleId/parent（versioned=true，If-Match）
//   - unsetRoleParent(roleId, expectedVersion)：DELETE /v1/roles/:roleId/parent（versioned=true，If-Match）
//   - getInheritanceChain(roleId)：GET /v1/roles/:roleId/inheritance-chain（非 cacheable，T3，裸 Role[]）
//   - getEffectivePermissions(userId)：GET /v1/users/:userId/effective-permissions（非 cacheable，T3，裸 PermissionCode[]）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client）。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D7：setRoleParent/unsetRoleParent 须 versioned=true + expectedVersion → client 注入 If-Match（T3 versioned）。
// [约束] D9：409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条）。
//            409 ROLE_INHERITANCE_CYCLE/ROLE_BUILTIN_PARENT_FORBIDDEN 不重试（非 VERSION_CONFLICT，抛 ApiError）。
// [约束] 本文件为类型派生操作（input/output 类型经 z.infer 派生），不调 safeParse。
// [约束] D17：函数命名对齐本 Spec §4.2.2 声明（setRoleParent/unsetRoleParent/getInheritanceChain/getEffectivePermissions）。
//
// [test-writer stub] AI-002 test-first：本文件为 stub，函数体抛 NOT_IMPLEMENTED，测试期断言级红。
//   impl-writer 阶段落地真实实现（见 Spec §4.2.2 实现提示）。
import type {
  EffectivePermissionsResult,
  InheritanceChainResult,
  Role,
} from '@admin/contracts';
import { request } from './client.js';

/**
 * POST /v1/roles/:roleId/parent —— 设置父角色（versioned=true，If-Match=expectedVersion，T3）。
 * body={parentRoleId}（roleId 在 path，对齐 server.ts L293-300 buildInput path+body 合并）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9，用 409 body current_version）。
 * 409 ROLE_INHERITANCE_CYCLE（环检测，message 含环路径）/ROLE_BUILTIN_PARENT_FORBIDDEN 不重试抛 ApiError。
 * ROLE_SELF_INHERITANCE 由 superRefine 前端拦截（D12，AC-F4-2，不到后端）。
 * ROLE_NOT_FOUND（roleId/parentRoleId 不存在，复用 role 域既有码，T2）抛 ApiError。
 */
export function setRoleParent(
  roleId: string,
  parentRoleId: string,
  expectedVersion: number,
): Promise<Role> {
  return request<Role>('POST', `/v1/roles/${roleId}/parent`, {
    body: { parentRoleId },
    versioned: true,
    expectedVersion,
  });
}

/**
 * DELETE /v1/roles/:roleId/parent —— 解除父角色（versioned=true，If-Match=expectedVersion，T3）。
 * body 空（roleId 在 path）。409 VERSION_CONFLICT 由 client 自动重试 1 次（D9，DELETE 重试幂等——
 * 409 表示未删除，重试语义安全）。ROLE_NOT_FOUND 抛 ApiError。
 */
export function unsetRoleParent(roleId: string, expectedVersion: number): Promise<Role> {
  return request<Role>('DELETE', `/v1/roles/${roleId}/parent`, {
    versioned: true,
    expectedVersion,
  });
}

/**
 * GET /v1/roles/:roleId/inheritance-chain —— 继承链（**非 cacheable**，T3，不发 If-None-Match）。
 * 返回裸 Role[] 祖先数组（无 envelope，从直接父角色到根角色，按继承顺序；根角色返回 []）。
 */
export function getInheritanceChain(roleId: string): Promise<InheritanceChainResult> {
  return request<InheritanceChainResult>('GET', `/v1/roles/${roleId}/inheritance-chain`);
}

/**
 * GET /v1/users/:userId/effective-permissions —— 有效权限（**非 cacheable**，T3，不发 If-None-Match）。
 * 返回裸 PermissionCode[] 集合（无 envelope，直接角色 ∪ 沿继承链向上的父角色权限码并集，去重排序）。
 */
export function getEffectivePermissions(userId: string): Promise<EffectivePermissionsResult> {
  return request<EffectivePermissionsResult>('GET', `/v1/users/${userId}/effective-permissions`);
}
