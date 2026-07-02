// apps/api/src/router/transfer.ts —— procedure 表：每个 procedure = { input, handler, auth, permission }
// 输入经 Zod 校验（B1 router 层），handler 调 service。
// SEC-001：procedure 声明 auth='admin' + permission='transfer:write'（TECH-TRANSFER-001 §7）。
// F3 事务感知聚合埋点：transfer procedure 经 withAudit 包装（entity_type=user/action=update），
//   事务成功 → handler 返回 WriteResult → withAudit 调 audit.record（一条聚合日志）；
//   事务失败 → handler 抛异常 → withAudit 不调 audit.record → 无幽灵日志。
import { z } from 'zod';
import { transferInputSchema, type User } from '@admin/contracts';
import type { TransferService } from '../service/transfer.js';
import { AuditLogService } from '../service/audit.js';
import { AuditLogRepository } from '../repository/audit.js';
import type { Ctx } from '../context.js';
import type { Procedure } from './user.js';
import { withAudit } from './audit.js';

export type { Procedure };

/**
 * 调岗域 procedure 形状：在 Procedure 基础上追加 permission 元数据（SEC-001）。
 * permission 取 'transfer:write'（POST /v1/users/:userId/transfer 所需权限码）。
 */
export type TransferProcedure<I, O> = Procedure<I, O> & {
  permission: 'transfer:write';
};

/**
 * transfer procedure 入参 = path userId (uuid) + body（toDepartmentId/oldRoleId/newRoleId）。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 * [advisory] 不复用 transferInputSchema.omit（transferInputSchema 经 superRefine 返回 ZodEffects，
 *   ZodEffects 无 .omit 方法），改为内联定义 path+body schema 后 transform 拼成 TransferInput 形状，
 *   再用 transferInputSchema 二次校验（保留 superRefine 的 oldRoleId!==newRoleId 校验）。
 */
const transferPathBodySchema = z
  .object({
    userId: z.string().uuid(),
    toDepartmentId: z.string().uuid(),
    oldRoleId: z.string().uuid(),
    newRoleId: z.string().uuid(),
  })
  .strict();

export const transferProcedureInputSchema = transferPathBodySchema
  .refine((val) => val.oldRoleId !== val.newRoleId, (val) => ({
    path: ['newRoleId'],
    message: 'newRoleId 不能等于 oldRoleId（TRANSFER_SAME_ROLE）',
  }))
  .refine((val) => transferInputSchema.safeParse(val).success, {
    message: 'transferInputSchema 校验失败',
  });

export type TransferRouter = {
  transfer: TransferProcedure<z.infer<typeof transferProcedureInputSchema>, User>;
};

/**
 * 创建调岗路由。transfer 写操作经 withAudit 包装，best-effort 旁路记审计日志（F3 聚合埋点）。
 * [advisory] auditService 为可选参数，缺省时创建内部 AuditLogService（独立 AuditLogRepository）；
 *             生产环境应传入共享实例以聚合日志，测试桩下缺省即可。
 */
export function createTransferRouter(
  service: TransferService,
  auditService?: AuditLogService,
): TransferRouter {
  const audit = auditService ?? new AuditLogService(new AuditLogRepository());
  return {
    transfer: {
      input: transferProcedureInputSchema,
      handler: withAudit(
        (input, ctx) => service.transfer(input, ctx),
        audit,
        { entityType: 'user', action: 'update' },
      ),
      auth: 'admin',
      permission: 'transfer:write',
    },
  };
}

// 引用 Ctx 避免未使用警告（procedure handler 签名含 ctx，但本文件仅组装不直接调用）
export type { Ctx };
