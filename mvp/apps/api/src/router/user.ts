// apps/api/src/router/user.ts —— procedure 表：每个 procedure = { input, handler }
// 输入经 Zod 校验（B1 router 层），handler 调 service。
// D1：写操作（create/updateStatus）经 withAudit 包装，best-effort 旁路记审计日志（F1 跨域自动埋点）。
import { z } from 'zod';
import {
  createUserInputSchema,
  listUserQuerySchema,
  updateUserStatusInputSchema,
  type User,
  type UserListResult,
} from '@admin/contracts';
import type { UserService } from '../service/user.js';
import { AuditLogService } from '../service/audit.js';
import { AuditLogRepository } from '../repository/audit.js';
import type { Ctx } from '../context.js';
import { withAudit } from './audit.js';

/**
 * Procedure 形状。
 * input 用 z.ZodType<I, ZodTypeDef, unknown> 以兼容带 coerce/default 的 schema
 * （其 Input 类型与 Output 不一致，故第 3 参放宽为 unknown）。
 */
export type Procedure<I, O> = {
  input: z.ZodType<I, z.ZodTypeDef, unknown>;
  handler: (input: I, ctx: Ctx) => Promise<O>;
  auth: 'admin' | 'public';
};

/**
 * updateStatus procedure 入参 = path id (uuid) + body updateUserStatusInputSchema。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const updateUserStatusProcedureInputSchema = z.object({
  id: z.string().uuid(),
  body: updateUserStatusInputSchema,
});

export type UserRouter = {
  list: Procedure<z.infer<typeof listUserQuerySchema>, UserListResult>;
  create: Procedure<z.infer<typeof createUserInputSchema>, User>;
  updateStatus: Procedure<z.infer<typeof updateUserStatusProcedureInputSchema>, User>;
};

/**
 * 创建用户路由。写操作（create/updateStatus）经 withAudit 包装，best-effort 旁路记审计日志。
 * [advisory] auditService 为可选参数，缺省时创建内部 AuditLogService（独立 AuditLogRepository）；
 *             生产环境应传入共享实例以聚合日志，测试桩下缺省即可（best-effort 日志去向不影响测试断言）。
 */
export function createUserRouter(service: UserService, auditService?: AuditLogService): UserRouter {
  const audit = auditService ?? new AuditLogService(new AuditLogRepository());
  return {
    list: {
      input: listUserQuerySchema,
      handler: (input, ctx) => service.list(input, ctx),
      auth: 'admin',
    },
    create: {
      input: createUserInputSchema,
      handler: withAudit(
        (input, ctx) => service.create(input, ctx),
        audit,
        { entityType: 'user', action: 'create' },
      ),
      auth: 'admin',
    },
    updateStatus: {
      input: updateUserStatusProcedureInputSchema,
      handler: withAudit(
        (input, ctx) => service.updateStatus(input.id, input.body.status, ctx),
        audit,
        { entityType: 'user', action: 'update' },
      ),
      auth: 'admin',
    },
  };
}
