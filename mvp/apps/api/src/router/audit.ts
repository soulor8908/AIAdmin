// apps/api/src/router/audit.ts —— procedure 表：每个 procedure = { input, handler, auth, permission }
// 输入经 Zod 校验（B1 router 层），handler 调 service。
// SEC-001：每个 procedure 必须声明 auth 元数据（操作日志查询全 admin）。
// SEC-001（TECH-AUDIT-001 扩展）：AuditProcedure 额外声明 permission（audit:read）。
// F4 append-only：router 仅注册 list procedure，**不注册 update/delete/patch/create**（HTTP 层无修改/删除/创建路由）。
import { z } from 'zod';
import {
  listAuditLogQuerySchema,
  type AuditLogListResult,
} from '@admin/contracts';
import type { AuditLogService } from '../service/audit.js';
import type { Procedure } from './user.js';

export type { Procedure };

/**
 * 操作日志域 procedure 形状：在 Procedure 基础上追加 permission 元数据（SEC-001）。
 * permission 取 'audit:read'（查询操作日志 GET /v1/audit-logs 所需权限码）。
 */
export type AuditProcedure<I, O> = Procedure<I, O> & {
  permission: 'audit:read';
};

export type AuditRouter = {
  list: AuditProcedure<z.infer<typeof listAuditLogQuerySchema>, AuditLogListResult>;
};

/**
 * 创建操作日志路由。仅暴露 list procedure（F2 列表查询），
 * 复用 contracts 的 listAuditLogQuerySchema（含 pageSize transform 钳制）。
 */
export function createAuditRouter(service: AuditLogService): AuditRouter {
  return {
    list: {
      input: listAuditLogQuerySchema,
      handler: (input, ctx) => service.list(input, ctx),
      auth: 'admin',
      permission: 'audit:read',
    },
  };
}
