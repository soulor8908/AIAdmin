// apps/api/src/router/role.ts —— procedure 表：每个 procedure = { input, handler, auth }
// 输入经 Zod 校验（B1 router 层），handler 调 service。
// SEC-001：每个 procedure 必须声明 auth 元数据（本角色管理全 admin）。
// D1：写操作（create/delete/assign/remove）经 withAudit 包装，best-effort 旁路记审计日志（F1 跨域自动埋点）。
import { z } from 'zod';
import {
  assignRoleInputSchema,
  createRoleInputSchema,
  listRoleQuerySchema,
  unsetParentInputSchema,
  inheritanceChainInputSchema,
  effectivePermissionsInputSchema,
  type PermissionCode,
  type Role,
  type RoleListResult,
  type UserRole,
} from '@admin/contracts';
import type { RoleService } from '../service/role.js';
import { AuditLogService } from '../service/audit.js';
import { AuditLogRepository } from '../repository/audit.js';
import type { Procedure } from './user.js';
import { withAudit } from './audit.js';

export type { Procedure };

/**
 * detail procedure 入参 = path id (uuid)（读操作，无 expected_version）。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const roleDetailProcedureInputSchema = z.object({
  id: z.string().uuid(),
});

/**
 * delete procedure 入参 = path id (uuid) + expected_version（写操作，If-Match header 注入）。
 * [约束] TECH-OPTIMISTIC-LOCKING-001 D4/D15：delete 为写操作须拆分读写 schema，delete 含 expected_version。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const roleDeleteProcedureInputSchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int().min(0),
});

/**
 * listUserRoles procedure 入参 = path userId (uuid)。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const listUserRolesProcedureInputSchema = z.object({
  userId: z.string().uuid(),
});

/**
 * setParent procedure 入参 = path roleId + body { parentRoleId } + expected_version（If-Match header 注入）。
 * [约束] TECH-OPTIMISTIC-LOCKING-001 D4/D15：写操作须拆分读写 schema，写含 expected_version。
 * [约束] contracts setParentInputSchema 为 ZodEffects（.superRefine），不可 .extend()；按 D15 独立声明写 schema。
 * [约束] superRefine 拒绝自继承（与 contracts setParentInputSchema 同规则，读写拆分后各自独立声明）。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const setParentProcedureInputSchema = z
  .object({
    roleId: z.string().uuid(),
    parentRoleId: z.string().uuid(),
    expected_version: z.number().int().min(0),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.roleId === val.parentRoleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'parentRoleId 不能等于 roleId（自继承禁止）',
      });
    }
  });

/**
 * unsetParent procedure 入参 = path roleId + expected_version（If-Match header 注入）。
 * [约束] TECH-OPTIMISTIC-LOCKING-001 D4：在 contracts unsetParentInputSchema 基础上 extend expected_version。
 */
export const unsetParentProcedureInputSchema = unsetParentInputSchema.extend({
  expected_version: z.number().int().min(0),
});

/**
 * getInheritanceChain procedure 入参 = path roleId。
 * 复用 contracts 的 inheritanceChainInputSchema。
 */
export const inheritanceChainProcedureInputSchema = inheritanceChainInputSchema;

/**
 * getEffectivePermissions procedure 入参 = path userId。
 * 复用 contracts 的 effectivePermissionsInputSchema。
 */
export const effectivePermissionsProcedureInputSchema = effectivePermissionsInputSchema;

export type RoleRouter = {
  list: Procedure<z.infer<typeof listRoleQuerySchema>, RoleListResult>;
  create: Procedure<z.infer<typeof createRoleInputSchema>, Role>;
  detail: Procedure<z.infer<typeof roleDetailProcedureInputSchema>, Role>;
  delete: Procedure<z.infer<typeof roleDeleteProcedureInputSchema>, void>;
  assign: Procedure<z.infer<typeof assignRoleInputSchema>, UserRole>;
  listUserRoles: Procedure<z.infer<typeof listUserRolesProcedureInputSchema>, UserRole[]>;
  remove: Procedure<z.infer<typeof assignRoleInputSchema>, void>;
  // 角色继承（TECH-ROLE-INHERITANCE-001 F1/F2/F3）
  setParent: Procedure<z.infer<typeof setParentProcedureInputSchema>, Role>;
  unsetParent: Procedure<z.infer<typeof unsetParentProcedureInputSchema>, Role>;
  getInheritanceChain: Procedure<z.infer<typeof inheritanceChainProcedureInputSchema>, Role[]>;
  getEffectivePermissions: Procedure<z.infer<typeof effectivePermissionsProcedureInputSchema>, PermissionCode[]>;
};

/**
 * 创建角色路由。写操作（create/delete/assign/remove）经 withAudit 包装，best-effort 旁路记审计日志。
 * [advisory] auditService 为可选参数，缺省时创建内部 AuditLogService（独立 AuditLogRepository）；
 *             生产环境应传入共享实例以聚合日志，测试桩下缺省即可（best-effort 日志去向不影响测试断言）。
 */
export function createRoleRouter(service: RoleService, auditService?: AuditLogService): RoleRouter {
  const audit = auditService ?? new AuditLogService(new AuditLogRepository());
  return {
    list: {
      input: listRoleQuerySchema,
      handler: (input, ctx) => service.list(input, ctx),
      auth: 'admin',
    },
    create: {
      input: createRoleInputSchema,
      handler: withAudit(
        (input, ctx) => service.create(input, ctx),
        audit,
        { entityType: 'role', action: 'create' },
      ),
      auth: 'admin',
    },
    detail: {
      input: roleDetailProcedureInputSchema,
      handler: (input, ctx) => service.getById(input.id, ctx),
      auth: 'admin',
    },
    delete: {
      input: roleDeleteProcedureInputSchema,
      handler: withAudit(
        (input, ctx) => service.delete(input.id, input.expected_version, ctx),
        audit,
        { entityType: 'role', action: 'delete', entityIdFromInput: (input) => (input as { id: string }).id },
      ),
      auth: 'admin',
    },
    assign: {
      input: assignRoleInputSchema,
      handler: withAudit(
        (input, ctx) => service.assign(input.userId, input.roleId, ctx),
        audit,
        { entityType: 'role', action: 'update', entityIdFromInput: (input) => (input as { roleId: string }).roleId },
      ),
      auth: 'admin',
    },
    listUserRoles: {
      input: listUserRolesProcedureInputSchema,
      handler: (input, ctx) => service.listUserRoles(input.userId, ctx),
      auth: 'admin',
    },
    remove: {
      input: assignRoleInputSchema,
      handler: withAudit(
        (input, ctx) => service.remove(input.userId, input.roleId, ctx),
        audit,
        { entityType: 'role', action: 'update', entityIdFromInput: (input) => (input as { roleId: string }).roleId },
      ),
      auth: 'admin',
    },
    // 角色继承（TECH-ROLE-INHERITANCE-001 F1/F2/F3）
    // setParent/unsetParent 经 withAudit 包装（entity_type=role/action=update，D5）
    setParent: {
      input: setParentProcedureInputSchema,
      handler: withAudit(
        (input, ctx) => service.setParent(input.roleId, input.parentRoleId, input.expected_version, ctx),
        audit,
        { entityType: 'role', action: 'update', entityIdFromInput: (input) => (input as { roleId: string }).roleId },
      ),
      auth: 'admin',
    },
    unsetParent: {
      input: unsetParentProcedureInputSchema,
      handler: withAudit(
        (input, ctx) => service.unsetParent(input.roleId, input.expected_version, ctx),
        audit,
        { entityType: 'role', action: 'update', entityIdFromInput: (input) => (input as { roleId: string }).roleId },
      ),
      auth: 'admin',
    },
    // 读操作（getInheritanceChain/getEffectivePermissions）不经 withAudit
    getInheritanceChain: {
      input: inheritanceChainProcedureInputSchema,
      handler: (input, ctx) => service.getInheritanceChain(input.roleId, ctx),
      auth: 'admin',
    },
    getEffectivePermissions: {
      input: effectivePermissionsProcedureInputSchema,
      handler: (input, ctx) => service.getEffectivePermissions(input.userId, ctx),
      auth: 'admin',
    },
  };
}
