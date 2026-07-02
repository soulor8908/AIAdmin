// apps/api/src/router/report.ts —— procedure 表：每个 procedure = { input, handler, auth, permission }
// 派生自 Tech-Spec TECH-AUDIT-ENHANCEMENT-001 §报表聚合契约（F2，纯读 + 聚合，非 CRUD）。
// 输入经 Zod 校验（B1 router 层），handler 调 service。
// SEC-001：procedure 声明 auth='admin'（受保护入口）。
// SEC-001（TECH-AUDIT-ENHANCEMENT-001 扩展）：ReportProcedure 额外声明 permission='report:read'。
// F2 非 CRUD：router 仅注册 query procedure，**不注册 create/update/delete/patch**（纯读 + 聚合）。
// D10：reportQuerySchema.group_by 为 optional + max(4)，schema 层不拒绝空；
//      service 层语义判定 group_by 缺省/空 → REPORT_GROUP_BY_REQUIRED，时间范围非法 → REPORT_TIME_RANGE_INVALID。
import {
  reportQuerySchema,
  type ReportQuery,
  type ReportResult,
} from '@admin/contracts';
import type { ReportService } from '../service/report.js';
import type { Procedure } from './user.js';

export type { Procedure };

/**
 * 报表域 procedure 形状：在 Procedure 基础上追加 permission 元数据（SEC-001）。
 * permission 取 'report:read'（查询操作统计报表 GET /v1/reports/query 所需权限码）。
 */
export type ReportProcedure<I, O> = Procedure<I, O> & {
  permission: 'report:read';
};

export type ReportRouter = {
  query: ReportProcedure<ReportQuery, ReportResult>;
};

/**
 * 创建报表路由。仅暴露 query procedure（F2 操作统计报表查询），
 * 复用 contracts 的 reportQuerySchema（含 pageSize transform 钳制 + group_by optional + superRefine）。
 * handler 委托 service.query，service 层做语义判定（group_by/时间范围）+ requireAdmin + 聚合。
 */
export function createReportRouter(service: ReportService): ReportRouter {
  return {
    query: {
      input: reportQuerySchema,
      handler: (input, ctx) => service.query(input, ctx),
      auth: 'admin',
      permission: 'report:read',
    },
  };
}
