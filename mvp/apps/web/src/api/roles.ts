// apps/web/src/api/roles.ts —— 角色域 endpoint 封装（TECH-WEB-ROLE-DEPT-AUDIT-001 §4.2.1）
//
// 职责：
//   - listRoles(query)：GET /v1/roles（分页，无服务端筛选，B2）
//   - createRole(input)：POST /v1/roles（body={name, description, permission_codes}，B1 无 code 字段）
//   - deleteRole(id, expectedVersion)：DELETE /v1/roles/:id（versioned=true，If-Match=expectedVersion，D7）
//   - listUserRoles(userId)：GET /v1/users/:userId/roles（返回裸 UserRole[]，无 envelope，B5）
//   - assignRole(userId, roleId)：POST /v1/users/:userId/roles/:roleId（path 参数，body 空）
//   - removeRole(userId, roleId)：DELETE /v1/users/:userId/roles/:roleId
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client），禁止 import apps/api/src/**。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D7：deleteRole 须 versioned=true + expectedVersion → client 注入 If-Match（AC-F3-7）。
// [约束] D9：409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条）。
// [约束] B5：listUserRoles 返回裸 UserRole[]（无 envelope，wire 直接是数组）。
// [约束] 本文件为类型派生操作（input/output 类型经 z.infer 派生），不调 safeParse。
//                调用方（自由文本表单）负责 safeParse 校验后再传入。
import type {
  CreateRoleInput,
  ListRoleQuery,
  Role,
  RoleListResult,
  UserRole,
} from '@admin/contracts';
import { invalidateEtagCache, request } from './client.js';

/**
 * GET /v1/roles —— 角色列表（分页，无服务端筛选，B2）。调用方传 pageSize=20（D21）。
 * TECH-ETAG-CACHING-001 D7：cacheable=true，200 响应 ETag 被缓存，下次同路径注入 If-None-Match 协商缓存。
 */
export function listRoles(query: ListRoleQuery): Promise<RoleListResult> {
  return request<RoleListResult>('GET', '/v1/roles', { query, cacheable: true });
}

/** POST /v1/roles —— 创建角色（body={name, description, permission_codes}，B1 无 code 字段）。成功后失效列表 ETag 缓存。 */
export function createRole(input: CreateRoleInput): Promise<Role> {
  return request<Role>('POST', '/v1/roles', { body: input }).then((r) => {
    invalidateEtagCache('GET', '/v1/roles');
    return r;
  });
}

/**
 * DELETE /v1/roles/:id —— 删除角色（versioned=true，If-Match=expectedVersion，AC-F3-7）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9，用 409 body current_version，不 GET 单条）。
 * 409 ROLE_IN_USE 不重试（非 VERSION_CONFLICT），抛 ApiError 由调用方处理。
 * 成功后失效列表 ETag 缓存（TECH-ETAG-CACHING-001 D7）。
 */
export function deleteRole(id: string, expectedVersion: number): Promise<void> {
  return request<void>('DELETE', `/v1/roles/${id}`, {
    versioned: true,
    expectedVersion,
  }).then((r) => {
    invalidateEtagCache('GET', '/v1/roles');
    return r;
  });
}

/** GET /v1/users/:userId/roles —— 用户已分配角色列表（返回裸 UserRole[]，无 envelope，B5）。 */
export function listUserRoles(userId: string): Promise<UserRole[]> {
  return request<UserRole[]>('GET', `/v1/users/${userId}/roles`);
}

/** POST /v1/users/:userId/roles/:roleId —— 分配角色（path 参数，body 空）。成功后失效角色列表 ETag 缓存。 */
export function assignRole(userId: string, roleId: string): Promise<void> {
  return request<void>('POST', `/v1/users/${userId}/roles/${roleId}`).then((r) => {
    invalidateEtagCache('GET', '/v1/roles');
    return r;
  });
}

/** DELETE /v1/users/:userId/roles/:roleId —— 移除角色（path 参数，body 空）。成功后失效角色列表 ETag 缓存。 */
export function removeRole(userId: string, roleId: string): Promise<void> {
  return request<void>('DELETE', `/v1/users/${userId}/roles/${roleId}`).then((r) => {
    invalidateEtagCache('GET', '/v1/roles');
    return r;
  });
}
