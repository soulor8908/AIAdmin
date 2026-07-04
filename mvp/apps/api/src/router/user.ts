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
import { createTestDb } from '../db/connection.js';
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
 * updateStatus procedure 入参 = path id (uuid) + body updateUserStatusInputSchema + expected_version（If-Match header 注入）。
 * [约束] TECH-OPTIMISTIC-LOCKING-001 D4：expected_version 必填，server.ts 从 If-Match header 解析注入。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const updateUserStatusProcedureInputSchema = z.object({
  id: z.string().uuid(),
  body: updateUserStatusInputSchema,
  expected_version: z.number().int().min(0),
});

/**
 * detail procedure 入参 = path id (uuid)（读操作，无 expected_version）。
 * TECH-USER-DETAIL-WIRE-001 §4.4 D2，消除 R12 D19 端点 gap。
 * [advisory] S-19 沿用重复定义：与 router/role.ts roleDetailProcedureInputSchema 结构相同（均 { id: uuid }），
 *   仅 role detail + user detail = 2 处使用场景，符合 S-19 阈值（≤3 处简单常量），不强制提取共享 idPathSchema。
 *   若未来 detail 端点增至 ≥4 处（如 notification/department/user 四域均 detail），须提取 packages/contracts/src/schemas/common.ts 共享。
 * [约束] AC-G3：.strict() 拒绝多余字段（与 roleDetailProcedureInputSchema 非 strict 略有差异，
 *   AC-G3 测试明确要求 safeParse({ id, extra }) 失败；行为以测试为准，AI-002 不改断言）。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const userDetailProcedureInputSchema = z.object({
  id: z.string().uuid(),
}).strict();

export type UserRouter = {
  list: Procedure<z.infer<typeof listUserQuerySchema>, UserListResult>;
  create: Procedure<z.infer<typeof createUserInputSchema>, User>;
  detail: Procedure<z.infer<typeof userDetailProcedureInputSchema>, User>;
  updateStatus: Procedure<z.infer<typeof updateUserStatusProcedureInputSchema>, User>;
};

/**
 * 创建用户路由。写操作（create/updateStatus）经 withAudit 包装，best-effort 旁路记审计日志。
 * [advisory] auditService 为可选参数，缺省时创建内部 AuditLogService（独立 AuditLogRepository）；
 *             生产环境应传入共享实例以聚合日志，测试桩下缺省即可（best-effort 日志去向不影响测试断言）。
 */
export function createUserRouter(service: UserService, auditService?: AuditLogService): UserRouter {
  const audit = auditService ?? new AuditLogService(new AuditLogRepository(createTestDb()));
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
    // detail（TECH-USER-DETAIL-WIRE-001 D2，消除 D19）：读操作不经 withAudit（沿用 GET /v1/users / GET /v1/roles/:id 不埋点惯例）。
    detail: {
      input: userDetailProcedureInputSchema,
      handler: (input, ctx) => service.getById(input.id, ctx),
      auth: 'admin',
    },
    updateStatus: {
      input: updateUserStatusProcedureInputSchema,
      handler: withAudit(
        (input, ctx) => service.updateStatus(input.id, input.body.status, input.expected_version, ctx),
        audit,
        { entityType: 'user', action: 'update' },
      ),
      auth: 'admin',
    },
  };
}
