// apps/web/src/api/users.ts —— 用户域 endpoint 封装（TECH-WEB-AUTH-USER-001 §2 E3/E4/E5）
//
// 职责（impl-writer 落地，本文件为 stub）：
//   - listUsers(query)：GET /v1/users（query 拼接 page/pageSize/status）
//   - createUser(input)：POST /v1/users（body={email,name,password?}）
//   - updateUserStatus(id, input, expectedVersion)：PATCH /v1/users/:id/status（versioned=true，If-Match=expectedVersion）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client），禁止 import apps/api/src/**。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D7：updateUserStatus 须 versioned=true + expectedVersion → client 注入 If-Match（AC-F4-7）。
// [约束] D14：前端显式传 pageSize=20，不依赖 listUserQuerySchema 缺省（schema default=10）。
import type {
  CreateUserInput,
  ListUserQuery,
  UpdateUserStatusInput,
  User,
  UserListResult,
} from '@admin/contracts';

/** GET /v1/users —— 列表查询（分页 + 状态筛选）。 */
export async function listUsers(_query: ListUserQuery): Promise<UserListResult> {
  throw new Error('NOT_IMPLEMENTED');
}

/** POST /v1/users —— 创建用户（password 可选，空则不传）。 */
export async function createUser(_input: CreateUserInput): Promise<User> {
  throw new Error('NOT_IMPLEMENTED');
}

/**
 * PATCH /v1/users/:id/status —— 状态更新（启用/禁用）。
 * versioned=true + expectedVersion → client 注入 If-Match header（D7，AC-F4-7）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9，用 409 body current_version）。
 */
export async function updateUserStatus(
  _id: string,
  _input: UpdateUserStatusInput,
  _expectedVersion: number,
): Promise<User> {
  throw new Error('NOT_IMPLEMENTED');
}
