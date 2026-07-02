// packages/contracts/src/schemas/user.ts —— 用户管理契约层（SSOT）
// 派生自 Tech-Spec TECH-USER-001（prd_ref: PRD-USER-001）。
// 约束：所有类型经 z.infer 派生，禁止手写 TS 类型副本（ARCH-002 / CODE-004）。
// 约束：email 用 z.string().email()；id 用 z.string().uuid()。

import { z } from 'zod';

/**
 * 用户状态机取值：
 * - active   = 启用（默认初始态）
 * - disabled = 禁用
 * 状态迁移：active ⇄ disabled（详见 Tech-Spec §状态机）
 */
export const userStatusSchema = z.enum(['active', 'disabled']);
export type UserStatus = z.infer<typeof userStatusSchema>;

/**
 * 用户实体：DB users 表行的契约投影。
 * 字段命名沿用 snake_case 以与 DB schema 对齐（created_at / updated_at / department_id）。
 * [约束] department_id 为跨域联动字段（TECH-DEPT-001 引入）：可空，空表示用户未归属任何部门；
 *        一个用户至多归属一个部门（PRD-DEPT-001 F4 / 跨域依赖）。createUserInputSchema 不含此字段
 *        （创建时不指定部门，默认未归属），归属维护经 PATCH /v1/users/{userId}/department（dept 域）。
 */
export const userSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    email: z.string().email(),
    status: userStatusSchema,
    department_id: z.string().uuid().nullable().optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type User = z.infer<typeof userSchema>;

/**
 * 新建用户输入。
 * Q5 决策：本期新建必填 = email + name；不含密码 / 角色 / 部门。
 */
export const createUserInputSchema = z
  .object({
    email: z.string().email(),
    name: z.string().min(1),
  })
  .strict();
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

/**
 * 更新用户状态输入。
 * F3 禁用 / F4 启用 共用同一 PATCH 端点（/v1/users/{id}/status）。
 * 具体行为（拒绝重复状态、禁用自身等）由 service 层 + 状态机裁决，不在 schema 层表达。
 */
export const updateUserStatusInputSchema = z
  .object({
    status: userStatusSchema,
  })
  .strict();
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusInputSchema>;

/**
 * 分页查询用户列表入参。
 * - page / pageSize 经 coerce 以兼容 query string 透传。
 * - status 可选，缺省表示不按状态过滤（F1 验收：未传入则返回所有状态）。
 * - pageSize 上限 100，防止一次性全量加载（非功能：性能）。
 */
export const listUserQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  status: userStatusSchema.optional(),
});
export type ListUserQuery = z.infer<typeof listUserQuerySchema>;

/**
 * 分页查询用户列表结果。
 * - total = 满足筛选条件的总条数（非当前页条数）。
 * - totalPages = ceil(total / pageSize)；空列表时为 0（F1 验收：总页数为 0）。
 */
export const userListResultSchema = z
  .object({
    items: z.array(userSchema),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    totalPages: z.number().int().min(0),
  })
  .strict();
export type UserListResult = z.infer<typeof userListResultSchema>;

/**
 * 错误码枚举：全局 SSOT，聚合 user 与 role 域错误码。
 * 各域 Tech-Spec §边界与异常 引用本枚举的子集；新增错误码须同步更新对应 Tech-Spec、
 * errors.ts 的 errorCodeToHttpStatus 穷举映射与 OpenAPI 片段，保持四处一致。
 */
export const errorCodeSchema = z.enum([
  // 入参校验失败（Zod 解析失败）
  'VALIDATION_ERROR',
  // 未认证 / 未登录（SEC-001：路由默认受保护）
  'UNAUTHORIZED',
  // 已认证但越权（SEC-002：service 层 requirePermission 拒绝）
  'FORBIDDEN',
  // 目标用户不存在（F4：ID 非法或不存在的用户）
  'USER_NOT_FOUND',
  // 邮箱已被占用（F2：邮箱唯一约束）
  'USER_EMAIL_DUPLICATE',
  // 禁用自身账号（F3：不能禁用自身当前登录账号）
  'USER_DISABLE_SELF_FORBIDDEN',
  // 重复禁用（F3：目标已是禁用状态）
  'USER_ALREADY_DISABLED',
  // 重复启用（F4：目标已是启用状态）
  'USER_ALREADY_ACTIVE',
  // ===== 角色域（TECH-ROLE-001）=====
  // 目标角色不存在（F3 删除 / F4 分配：role_id 合法但无记录）
  'ROLE_NOT_FOUND',
  // 角色名称重复（F1 创建：Q3 全局唯一约束）
  'ROLE_NAME_DUPLICATE',
  // 内置角色不可删除（F3/F5：admin 无论是否分配都禁止删除）
  'ROLE_BUILTIN_FORBIDDEN',
  // 角色已被分配给用户，禁止删除（F3：Q1 决策方案 B，需先解除全部分配）
  'ROLE_IN_USE',
  // 用户已持有该角色，重复分配（F4：已持有此角色）
  'USER_ROLE_ALREADY_ASSIGNED',
  // ===== 部门域（TECH-DEPT-001）=====
  // 目标部门不存在（F1 父部门校验 / F3 删除 / F4 归属：department_id 合法但无记录）
  'DEPT_NOT_FOUND',
  // 同父下部门名称重复（F1 创建：Q3 同父唯一约束）
  'DEPT_NAME_DUPLICATE',
  // 待删部门仍有子部门（F3 删除：Q2 禁止级联，须先清空子部门）
  'DEPT_HAS_CHILDREN',
  // [advisory] 预留码——删除部门时其下仍有归属用户。本期 Q1 决策为「解除归属」（置空而非阻断），
  //            故删除路径不抛此码；保留以备未来「严格删除模式」或显式阻断场景，service 层本期不抛出。
  'DEPT_HAS_USERS',
  // 创建子部门将超过最大层级 3（F1：Q4 层级上限，按父部门链路推导）
  'DEPT_DEPTH_EXCEEDED',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * 统一错误响应体。所有 procedure 失败均回包此结构，code 取自 errorCodeSchema。
 */
export const errorResponseSchema = z
  .object({
    code: errorCodeSchema,
    message: z.string(),
  })
  .strict();
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
