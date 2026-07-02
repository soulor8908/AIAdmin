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
    // [约束] TECH-OPTIMISTIC-LOCKING-001 D1：乐观锁版本号，初始 0，每次 update +1。
    // If-Match header 携带的 expected_version 须与实体当前 version 匹配，否则 VERSION_CONFLICT。
    version: z.number().int().min(0),
  })
  .strict();
export type User = z.infer<typeof userSchema>;

/**
 * 用户存储实体：DB users 表行的完整投影（含敏感字段 password_hash）。
 * [约束] TECH-AUTH-001 D5：拆分存储实体 schema 与输出 schema。
 *        userSchema（输出）保持完全不变 —— 不含 password_hash（SEC-003a：响应输出 schema 1:1 + .strict() 拒绝多余字段），
 *        User 类型不变 → 既有 user 响应测试零变更（ARCH-001 闭合）。
 *        userEntitySchema（存储/内部）含 password_hash，仅供 repository/service 内部使用；
 *        HTTP 响应输出前须经 userSchema 投影剥离 password_hash（impl-writer 阶段落地）。
 * [约束] password_hash = scrypt 输出 `salt.hash` 格式（base64，TECH-AUTH-001 D2）。
 *        禁止在 userSchema 内 optional password_hash（语义混乱且污染 User 类型）。
 */
export const userEntitySchema = userSchema
  .extend({
    password_hash: z.string().min(1),
  })
  .strict();
export type UserEntity = z.infer<typeof userEntitySchema>;

/**
 * 新建用户输入。
 * Q5 决策：本期新建必填 = email + name；不含角色 / 部门。
 * [约束] TECH-AUTH-001 D6：追加 password optional（z.string().min(8)，PRD Q12 最低 8 位）。
 *        缺省时 service 层生成临时密码并记审计日志；.strict() 仍拒绝多余字段。
 *        既有 {email, name} 样本因 password optional 仍合法 → 既有 createUser 测试零变更。
 */
export const createUserInputSchema = z
  .object({
    email: z.string().email(),
    name: z.string().min(1),
    password: z.string().min(8).optional(),
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
  // ===== 操作日志域（TECH-AUDIT-001）=====
  // [advisory] 预留码——单条日志详情查询（GET /v1/audit-logs/{id}）时 id 合法但无记录。
  //            本期仅提供列表查询 GET /v1/audit-logs（F2），列表空结果返回 items=[] 而非 404，故本期 service 层不抛此码；
  //            保留以备未来单条详情端点，append-only 无 update/delete 错误码（日志不可修改/删除，F4）。
  'AUDIT_LOG_NOT_FOUND',
  // ===== 报表域（TECH-AUDIT-ENHANCEMENT-001）=====
  // group_by 缺失或空数组（D10：schema 层 optional/max(4) 不拒绝空，service 层语义判定 → 400）
  'REPORT_GROUP_BY_REQUIRED',
  // 时间范围无效（operated_from 晚于 operated_to，D10：schema superRefine 检测 + service 层语义判定 → 400）
  'REPORT_TIME_RANGE_INVALID',
  // ===== 通知域（TECH-NOTIFICATION-001）=====
  // 通知不存在（id 合法 uuid 但无记录，任意写操作 update/delete/send/markRead 触发，B5）
  'NOTIFICATION_NOT_FOUND',
  // send 时收件人不存在（findByIds 结果为空，B7，区别于 B5 通知本身不存在）
  'NOTIFICATION_RECIPIENT_NOT_FOUND',
  // send 时收件人存在但 status=disabled（B8，收件人状态冲突）
  'NOTIFICATION_RECIPIENT_DISABLED',
  // 状态转移/状态守卫操作非法（跳过/同态/回退/update|delete|send|markRead 状态守卫违规，B6，单码覆盖所有状态非法）
  'NOTIFICATION_INVALID_TRANSITION',
  // ===== 调岗事务域（TECH-TRANSFER-001）=====
  // oldRoleId === newRoleId（无意义操作，避免同角色调岗）
  'TRANSFER_SAME_ROLE',
  // 用户当前未分配 oldRoleId（前置状态不满足，无法移除）
  'TRANSFER_OLD_ROLE_NOT_ASSIGNED',
  // 补偿回滚自身失败（数据一致性告警，须运维介入，非静默吞）
  'TRANSFER_COMPENSATION_FAILED',
  // 调岗执行阶段失败已回滚（聚合错误码，message 含失败步骤+底层原因；校验阶段错误码直接传播不聚合）
  'TRANSFER_FAILED',
  // ===== 角色继承域（TECH-ROLE-INHERITANCE-001）=====
  // 自继承：parentRoleId === roleId（避免无意义继承自身）
  'ROLE_SELF_INHERITANCE',
  // 父角色为内置 admin（admin 是根角色，禁止被设为父）
  'ROLE_BUILTIN_PARENT_FORBIDDEN',
  // 新继承关系形成环（祖先遍历检测到环，message 含环路径 A→B→A）
  'ROLE_INHERITANCE_CYCLE',
  // 删除守卫 B8：待删角色仍有子角色引用（须先解除全部子角色继承，B5→B6→B8→B7）
  'ROLE_HAS_CHILDREN',
  // ===== 乐观锁域（TECH-OPTIMISTIC-LOCKING-001）=====
  // 写操作缺失 If-Match header（Q4 决策：必填，缺失 → 400）
  'VERSION_REQUIRED',
  // If-Match version 与实体当前 version 不匹配（409，状态冲突，响应含 current_version 供重试）
  'VERSION_CONFLICT',
  // ===== 鉴权域（TECH-AUTH-001）=====
  // 邮箱不存在或密码错（401，模糊错误不区分，防账号枚举，PRD Q9/Q10）
  'INVALID_CREDENTIALS',
  // token 伪造/格式错/scheme 非 Bearer（401，PRD Q10）
  'TOKEN_INVALID',
  // token 已过期（401，exp ≤ now，PRD Q10）
  'TOKEN_EXPIRED',
  // token 已登出吊销（401，命中黑名单，PRD Q10）
  'TOKEN_REVOKED',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * 统一错误响应体。所有 procedure 失败均回包此结构，code 取自 errorCodeSchema。
 * [约束] TECH-OPTIMISTIC-LOCKING-001 D3：current_version 为可选字段，
 *        仅 VERSION_CONFLICT 时填充（供客户端 GET 最新资源后重试）。不破坏既有消费者。
 */
export const errorResponseSchema = z
  .object({
    code: errorCodeSchema,
    message: z.string(),
    current_version: z.number().int().min(0).optional(),
  })
  .strict();
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
