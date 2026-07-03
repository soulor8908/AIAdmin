// apps/web/src/api/audit-logs.ts —— 审计域 endpoint 封装（TECH-WEB-ROLE-DEPT-AUDIT-001 §4.2.3）
//
// 职责：
//   - listAuditLogs(query)：GET /v1/audit-logs（query 拼接 page/pageSize/operated_from/operated_to/operator_id/entity_type）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client）。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D10：消费 RedactedAuditLog（脱敏态），禁用 auditLogSchema（存储态含未脱敏 PII）。
// [约束] B3：query 仅 page/pageSize/operated_from/operated_to/operator_id/entity_type（无 action）。
// [约束] R13 S-1：本文件为类型派生操作（query/output 类型经 z.infer 派生），不调 safeParse。
import type { AuditLogListResult, ListAuditLogQuery } from '@admin/contracts';
import { request } from './client.js';

/** GET /v1/audit-logs —— 审计日志列表（只读，分页 + 筛选，items 为脱敏态）。调用方传 pageSize=20（D21）。 */
export function listAuditLogs(query: ListAuditLogQuery): Promise<AuditLogListResult> {
  return request<AuditLogListResult>('GET', '/v1/audit-logs', { query });
}
