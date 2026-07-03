// apps/web/src/api/users.ts —— 用户域 endpoint 封装（TECH-WEB-AUTH-USER-001 §2 E3/E4/E5）
//
// 职责：
//   - listUsers(query)：GET /v1/users（query 拼接 page/pageSize/status）
//   - createUser(input)：POST /v1/users（body={email,name,password?}）
//   - updateUserStatus(id, input, expectedVersion)：PATCH /v1/users/:id/status（versioned=true，If-Match=expectedVersion）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client），禁止 import apps/api/src/**。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D7：updateUserStatus 须 versioned=true + expectedVersion → client 注入 If-Match（AC-F4-7）。
// [约束] D9：409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条）。
// [约束] D14：前端显式传 pageSize=20，不依赖 listUserQuerySchema 缺省（schema default=10）。调用方传 pageSize=20。
import type {
  CreateUserInput,
  ListUserQuery,
  UpdateUserStatusInput,
  User,
  UserListResult,
} from '@admin/contracts';
import { request } from './client.js';

/** GET /v1/users —— 列表查询（分页 + 状态筛选）。调用方传 pageSize=20（D14）。 */
export function listUsers(query: ListUserQuery): Promise<UserListResult> {
  return request<UserListResult>('GET', '/v1/users', { query });
}

/** POST /v1/users —— 创建用户（password 可选，空则不传，对齐 createUserInputSchema optional）。 */
export function createUser(input: CreateUserInput): Promise<User> {
  return request<User>('POST', '/v1/users', { body: input });
}

/**
 * PATCH /v1/users/:id/status —— 状态更新（启用/禁用）。
 * versioned=true + expectedVersion → client 注入 If-Match header（D7，AC-F4-7）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9，用 409 body current_version）。
 */
export function updateUserStatus(
  id: string,
  input: UpdateUserStatusInput,
  expectedVersion: number,
): Promise<User> {
  return request<User>('PATCH', `/v1/users/${id}/status`, {
    body: input,
    versioned: true,
    expectedVersion,
  });
}
