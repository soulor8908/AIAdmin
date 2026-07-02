// apps/api/src/router/notification.ts —— procedure 表：每个 procedure = { input, handler, auth, permission? }
// 输入经 Zod 校验（B1 router 层），handler 调 service。
// SEC-001：每个 procedure 必须声明 auth 元数据（list/detail/create/update/send/delete='admin'，markRead='public' 收件人自服务）。
// SEC-001（TECH-NOTIFICATION-001 扩展）：NotificationProcedure 的 permission 为可选（markRead 自服务不走权限码，Q4b）。
// D6：5 类写操作（create/update/send/markRead/delete）经 withAudit 包装，best-effort 旁路记审计日志（F2 跨域自动埋点）。
// markRead 经 withAudit 包装（auth='public'，收件人自服务，operator_id=ctx.user.id 收件人；不设 permission）。
import { z } from 'zod';
import {
  createNotificationInputSchema,
  listNotificationQuerySchema,
  updateNotificationInputSchema,
  type Notification,
  type NotificationListResult,
} from '@admin/contracts';
import type { NotificationService } from '../service/notification.js';
import { AuditLogService } from '../service/audit.js';
import { AuditLogRepository } from '../repository/audit.js';
import type { Ctx } from '../context.js';
import type { Procedure } from './user.js';
import { withAudit } from './audit.js';

export type { Procedure };

/**
 * 通知域 procedure 形状：在 Procedure 基础上追加可选 permission 元数据（SEC-001）。
 * permission 取 'notification:read'（list/detail）或 'notification:write'（create/update/send/delete）；
 * markRead 为收件人自服务无 permission（Q4b：自服务不走权限码），故 permission 设为可选。
 */
export type NotificationProcedure<I, O> = Procedure<I, O> & {
  permission?: 'notification:read' | 'notification:write';
};

/**
 * detail / send / markRead / delete procedure 入参 = path id (uuid)。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const notificationIdProcedureInputSchema = z.object({
  id: z.string().uuid(),
});

/**
 * update procedure 入参 = path id (uuid) + body updateNotificationInputSchema。
 * 单独导出以便契约测直接对该 schema 跑 safeParse。
 */
export const updateNotificationProcedureInputSchema = z.object({
  id: z.string().uuid(),
  body: updateNotificationInputSchema,
});

export type NotificationRouter = {
  list: NotificationProcedure<z.infer<typeof listNotificationQuerySchema>, NotificationListResult>;
  detail: NotificationProcedure<z.infer<typeof notificationIdProcedureInputSchema>, Notification>;
  create: NotificationProcedure<z.infer<typeof createNotificationInputSchema>, Notification>;
  update: NotificationProcedure<z.infer<typeof updateNotificationProcedureInputSchema>, Notification>;
  send: NotificationProcedure<z.infer<typeof notificationIdProcedureInputSchema>, Notification>;
  markRead: NotificationProcedure<z.infer<typeof notificationIdProcedureInputSchema>, Notification>;
  delete: NotificationProcedure<z.infer<typeof notificationIdProcedureInputSchema>, void>;
};

/**
 * 创建通知路由。5 类写操作（create/update/send/markRead/delete）经 withAudit 包装，best-effort 旁路记审计日志。
 * [advisory] auditService 为可选参数，缺省时创建内部 AuditLogService（独立 AuditLogRepository）；
 *             生产环境应传入共享实例以聚合日志，测试桩下缺省即可（best-effort 日志去向不影响测试断言）。
 * [约束] markRead 的 auth='public'（收件人自服务，非 admin），permission 缺省（自服务不走权限码，Q4b）。
 */
export function createNotificationRouter(
  service: NotificationService,
  auditService?: AuditLogService,
): NotificationRouter {
  const audit = auditService ?? new AuditLogService(new AuditLogRepository());
  return {
    list: {
      input: listNotificationQuerySchema,
      handler: (input, ctx) => service.list(input, ctx),
      auth: 'admin',
      permission: 'notification:read',
    },
    detail: {
      input: notificationIdProcedureInputSchema,
      handler: (input, ctx) => service.detail(input.id, ctx),
      auth: 'admin',
      permission: 'notification:read',
    },
    create: {
      input: createNotificationInputSchema,
      handler: withAudit(
        (input, ctx) => service.create(input, ctx),
        audit,
        { entityType: 'notification', action: 'create' },
      ),
      auth: 'admin',
      permission: 'notification:write',
    },
    update: {
      input: updateNotificationProcedureInputSchema,
      handler: withAudit(
        (input, ctx) => service.update(input.id, input.body, ctx),
        audit,
        { entityType: 'notification', action: 'update' },
      ),
      auth: 'admin',
      permission: 'notification:write',
    },
    send: {
      input: notificationIdProcedureInputSchema,
      handler: withAudit(
        (input, ctx) => service.send(input.id, ctx),
        audit,
        { entityType: 'notification', action: 'update' },
      ),
      auth: 'admin',
      permission: 'notification:write',
    },
    // public: markRead 为收件人自服务（PRD Q4b），不走 requireAdmin/permission 码，校验由 service 层 ctx.user.id === recipient_id 守卫
    markRead: {
      input: notificationIdProcedureInputSchema,
      handler: withAudit(
        (input, ctx) => service.markRead(input.id, ctx),
        audit,
        { entityType: 'notification', action: 'update' },
      ),
      auth: 'public',
    },
    delete: {
      input: notificationIdProcedureInputSchema,
      handler: withAudit(
        (input, ctx) => service.delete(input.id, ctx),
        audit,
        {
          entityType: 'notification',
          action: 'delete',
          entityIdFromInput: (input) => (input as { id: string }).id,
        },
      ),
      auth: 'admin',
      permission: 'notification:write',
    },
  };
}
