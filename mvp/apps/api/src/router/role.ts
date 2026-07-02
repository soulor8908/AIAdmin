// apps/api/src/router/role.ts —— procedure 表：每个 procedure = { input, handler, auth }
// 输入经 Zod 校验（B1 router 层），handler 调 service。
// SEC-001：每个 procedure 必须声明 auth 元数据（本角色管理全 admin）。
// D1：写操作（create/delete/assign/remove）经 withAudit 包装，best-effort 旁路记审计日志（F1 跨域自动埋点）。
import { z } from 'zod';
import {
  assignRoleInputSchema,
  createRoleInputSchema,
  listRoleQuerySchema,
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
 * detail / delete procedure 入参 = path id (uuid)。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const roleDetailProcedureInputSchema = z.object({
  id: z.string().uuid(),
});

/**
 * listUserRoles procedure 入参 = path userId (uuid)。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const listUserRolesProcedureInputSchema = z.object({
  userId: z.string().uuid(),
});

export type RoleRouter = {
  list: Procedure<z.infer<typeof listRoleQuerySchema>, RoleListResult>;
  create: Procedure<z.infer<typeof createRoleInputSchema>, Role>;
  detail: Procedure<z.infer<typeof roleDetailProcedureInputSchema>, Role>;
  delete: Procedure<z.infer<typeof roleDetailProcedureInputSchema>, void>;
  assign: Procedure<z.infer<typeof assignRoleInputSchema>, UserRole>;
  listUserRoles: Procedure<z.infer<typeof listUserRolesProcedureInputSchema>, UserRole[]>;
  remove: Procedure<z.infer<typeof assignRoleInputSchema>, void>;
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
      input: roleDetailProcedureInputSchema,
      handler: withAudit(
        (input, ctx) => service.delete(input.id, ctx),
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
  };
}
