// packages/contracts/src/schemas/role.ts —— 角色管理契约层（SSOT）
// 派生自 Tech-Spec TECH-ROLE-001（prd_ref: PRD-ROLE-001）。
// 约束：所有类型经 z.infer 派生，禁止手写 TS 类型副本（ARCH-002 / CODE-004）。
// 约束：错误码 SSOT 为 user.ts 的 errorCodeSchema（跨域共享单一枚举），角色相关码已追加其中；
//       本文件不重复定义 errorCodeSchema，避免 export * 重名冲突（详见 Tech-Spec §API 契约）。
// 约束：id 用 z.string().uuid()；created_at / assigned_at 用 z.string().datetime()。

import { z } from 'zod';

/**
 * 权限码枚举（Q2 决策：固定枚举）。
 * [约束] 创建角色时对 permission_codes 逐项校验，未知码拒绝 → VALIDATION_ERROR。
 * [约束] 后续新增模块时随对应 PRD 扩展该枚举；内置 admin 权限范围随枚举扩展自动覆盖（Q4）。
 * [约束] dept:read / dept:write 为跨域联动扩展（TECH-DEPT-001 引入）：dept:read 查看部门树，
 *        dept:write 创建/删除部门及维护用户归属。内置 admin 随枚举扩展自动覆盖这两个码。
 */
export const permissionCodeSchema = z.enum([
  'user:read',
  'user:write',
  'role:read',
  'role:write',
  'dept:read',
  'dept:write',
]);
export type PermissionCode = z.infer<typeof permissionCodeSchema>;

/**
 * 角色实体：DB roles 表行的契约投影。
 * 字段命名沿用 snake_case 以与 DB schema 对齐（permission_codes / is_builtin / created_at）。
 * [约束] name 全局唯一（Q3，唯一性在 service 层裁决 → ROLE_NAME_DUPLICATE）。
 * [约束] permission_codes 创建后不可改（F1：本期无角色编辑端点，变更需删除重建）。
 * [约束] name 长度 1..64（来自 PRD，见 Tech-Spec §边界与异常）。
 * [advisory] description 长度上限 512，PRD 未指定，Dev 可按真实 DB 列宽调整并反向同步 Spec。
 */
export const roleSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(64),
    description: z.string().max(512),
    permission_codes: z.array(permissionCodeSchema),
    is_builtin: z.boolean(),
    created_at: z.string().datetime(),
  })
  .strict();
export type Role = z.infer<typeof roleSchema>;

/**
 * 新建角色输入（F1）。
 * [约束] name 1..64；permission_codes 允许为空（Q2 决策：零权限角色作占位）。
 * [约束] is_builtin / id / created_at 由服务端生成，不入输入（.strict() 拒绝多余字段）。
 */
export const createRoleInputSchema = z
  .object({
    name: z.string().min(1).max(64),
    description: z.string().max(512),
    permission_codes: z.array(permissionCodeSchema),
  })
  .strict();
export type CreateRoleInput = z.infer<typeof createRoleInputSchema>;

/**
 * 分页查询角色列表入参（F2）。
 * [advisory] 分页参数沿用 user 域约定；角色数据量通常很小，Dev 可改为全量返回并反向同步 Spec。
 * [约束] pageSize 上限 100（防止一次性全量加载，NFR 性能）。
 */
export const listRoleQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
export type ListRoleQuery = z.infer<typeof listRoleQuerySchema>;

/**
 * 分页查询角色列表结果（F2，含内置 admin 标识）。
 * [约束] 输出 schema 带 .strict()（SEC-003a）。
 * [约束] total = 满足筛选条件的总条数；totalPages = ceil(total/pageSize)；空列表 totalPages=0。
 */
export const roleListResultSchema = z
  .object({
    items: z.array(roleSchema),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    totalPages: z.number().int().min(0),
  })
  .strict();
export type RoleListResult = z.infer<typeof roleListResultSchema>;

/**
 * 为用户分配角色入参（F4，procedure 级合并输入）。
 * [约束] userId + roleId 均为 uuid。
 * [约束] 此 schema 同时作为「分配」与「移除」两个 procedure 的入参形状
 *        （path userId + body/path roleId 的合并形态，对齐 user 域
 *        updateUserStatusProcedureInputSchema 的 path+body 合并风格）；OpenAPI 侧按 path/body 拆分。
 */
export const assignRoleInputSchema = z
  .object({
    userId: z.string().uuid(),
    roleId: z.string().uuid(),
  })
  .strict();
export type AssignRoleInput = z.infer<typeof assignRoleInputSchema>;

/**
 * 用户-角色关联实体：DB user_roles 表行的契约投影（F4）。
 * [约束] (user_id, role_id) 业务唯一（重复分配 → USER_ROLE_ALREADY_ASSIGNED）。
 */
export const userRoleSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    role_id: z.string().uuid(),
    assigned_at: z.string().datetime(),
  })
  .strict();
export type UserRole = z.infer<typeof userRoleSchema>;
