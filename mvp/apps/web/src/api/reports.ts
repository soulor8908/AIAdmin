// apps/web/src/api/reports.ts —— 报表域 endpoint 封装（TECH-WEB-NOTIFICATION-REPORT-001 §4.2.2）
//
// 职责：
//   - queryOperations(query)：GET /v1/reports/operations（group_by 数组 query，D8 string[] repeated key）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client）。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D8：group_by 为数组，经扩展后的 RequestOptions.query（支持 string[]）拼接为 repeated key（?group_by=A&group_by=B）。
// [约束] D20：函数命名对齐本 Spec §4.2.2 声明。
// [约束] 本文件为类型派生操作（query/output 类型经 z.infer 派生），不调 safeParse。
import type { ReportQuery, ReportResult } from '@admin/contracts';
import { request } from './client.js';

/**
 * GET /v1/reports/operations —— 操作统计报表（纯读聚合）。
 * group_by 数组经 D8 扩展后的 query 拼接为 repeated key（?group_by=operator_id&group_by=date）。
 * 调用方传 pageSize=20（reportQuerySchema default=20，沿用 R14 D21）。
 */
export function queryOperations(query: ReportQuery): Promise<ReportResult> {
  return request<ReportResult>('GET', '/v1/reports/operations', { query });
}
