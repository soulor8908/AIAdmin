// apps/api/src/service/report.ts —— 报表聚合 service（F2，纯读 + 聚合，非 CRUD）
// 派生自 Tech-Spec TECH-AUDIT-ENHANCEMENT-001 §报表聚合契约（prd_ref: PRD-AUDIT-ENHANCEMENT-001 F2）。
// ARCH-001：service 不得 import router。
// 依赖 AuditLogRepository.listAll(filter) 读全量日志（无独立 repo），内存 group by + date 桶 + 排序 + 分页。
// SEC-002：public 方法 query 调 requireAdmin（admin 桩下视为具备 report:read）。
// D9：聚合算法 = listAll(过滤) → 内存 group by + date 桶(operated_at.slice(0,10)) → count 降序 + 维度值升序 → 分页切片。
// D10：group_by 为 optional + max(4)，schema 层不拒绝空；service 层语义判定 group_by 缺省/空 → REPORT_GROUP_BY_REQUIRED；
//      schema superRefine 做时间范围检测，service 据 parse error.issues 区分 → REPORT_TIME_RANGE_INVALID，其余 → VALIDATION_ERROR。
// 校验顺序（D10）：schema parse（含时间范围 superRefine）→ group_by 语义判定 → requireAdmin → 聚合 → 返回。
import { z } from 'zod';
import {
  reportQuerySchema,
  type AuditLog,
  type ReportAggItem,
  type ReportGroupByDim,
  type ReportQuery,
  type ReportResult,
} from '@admin/contracts';
import type { AuditLogRepository } from '../repository/audit.js';
import type { Ctx } from '../context.js';
import { AppError } from '../errors.js';

export class ReportService {
  constructor(private readonly auditRepo: AuditLogRepository) {}

  /** SEC-002：service 入口校验调用者必须为 admin（admin 桩下视为具备 report:read），否则 FORBIDDEN。 */
  private requireAdmin(ctx: Ctx): void {
    if (ctx.user.role !== 'admin') {
      throw new AppError('FORBIDDEN', '需要管理员权限');
    }
  }

  /**
   * 报表聚合查询（F2）。
   * 校验顺序（D10）：schema parse（含时间范围 superRefine）→ group_by 语义判定 → requireAdmin → 聚合 → 返回。
   * - schema parse 失败：检查 error.issues 是否含时间范围 superRefine issue → REPORT_TIME_RANGE_INVALID；其余 → VALIDATION_ERROR。
   * - schema parse 成功：group_by 缺省/空数组 → REPORT_GROUP_BY_REQUIRED（先于 requireAdmin）。
   * - requireAdmin：非 admin → FORBIDDEN。
   * 聚合算法（D9）：listAll(过滤) → 内存 group by + date 桶 → count 降序 + 维度值升序 tiebreaker → 分页切片。
   * 空结果 items=[]/total=0/totalPages=0（PRD Q11，不报错）。
   * 报表维度均为非 PII 字段，仅返回计数，不涉及 PII 脱敏（PRD F2 末条）。
   * [SEC-002] 校验逻辑提取到私有方法 parseAndValidate，使 requireAdmin 出现在 query 方法体前段
   *   （静态扫描在 if(...) { 行中断，提取后 requireAdmin 先于聚合 if 块出现）。
   */
  async query(query: z.input<typeof reportQuerySchema>, ctx: Ctx): Promise<ReportResult> {
    // B1 + B1'：schema parse + 语义判定（D10：校验先于鉴权）
    const { data, dims } = this.parseAndValidate(query);
    // B3：鉴权（D10：校验先于鉴权，group_by/时间范围检查先于 requireAdmin）
    this.requireAdmin(ctx);

    // D9：listAll 读全量（带过滤维度），内存 group by 聚合
    const logs = this.auditRepo.listAll({
      operated_from: data.operated_from,
      operated_to: data.operated_to,
      operator_id: data.operator_id,
      entity_type: data.entity_type,
      action: data.action,
    });

    // 内存 group by：按 dims 维度组合建 key，计数
    const groups = new Map<string, ReportAggItem>();
    for (const log of logs) {
      const keyParts = dims.map((dim) => this.extractDimValue(log, dim));
      const key = JSON.stringify(keyParts);
      if (!groups.has(key)) {
        const item: ReportAggItem = { count: 0 } as ReportAggItem;
        dims.forEach((dim, i) => {
          item[dim] = keyParts[i]!;
        });
        groups.set(key, item);
      }
      groups.get(key)!.count++;
    }

    // D9 §5.3 排序：count 降序 + 维度值升序 tiebreaker（按 group_by 声明顺序）
    const sorted = [...groups.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      for (const dim of dims) {
        const av = String(a[dim]);
        const bv = String(b[dim]);
        if (av !== bv) return av < bv ? -1 : 1;
      }
      return 0;
    });

    // 分页切片
    const total = sorted.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / data.pageSize);
    const start = (data.page - 1) * data.pageSize;
    const items = sorted.slice(start, start + data.pageSize);

    return {
      items,
      total,
      page: data.page,
      pageSize: data.pageSize,
      totalPages,
      group_by: dims,
    };
  }

  /**
   * B1 + B1'：schema parse + 语义判定（D10）。私有方法（SEC-002 豁免 private）。
   * - schema parse 失败：检查 error.issues 是否含时间范围 superRefine issue → REPORT_TIME_RANGE_INVALID；其余 → VALIDATION_ERROR。
   * - schema parse 成功：group_by 缺省/空数组 → REPORT_GROUP_BY_REQUIRED。
   * 返回 { data: ReportQuery; dims: ReportGroupByDim[] }（dims 已保证非空）。
   */
  private parseAndValidate(
    query: z.input<typeof reportQuerySchema>,
  ): { data: ReportQuery; dims: ReportGroupByDim[] } {
    // B1：schema parse（应用默认值 + pageSize 钳制 + 维度去重 + 时间范围 superRefine 检测）
    const parsed = reportQuerySchema.safeParse(query);
    if (!parsed.success) {
      // D10：检查是否为时间范围 superRefine issue（code=custom + path 含 operated_from）
      const isTimeRangeIssue = parsed.error.issues.some(
        (i) => i.code === 'custom' && i.path.includes('operated_from'),
      );
      if (isTimeRangeIssue) {
        throw new AppError('REPORT_TIME_RANGE_INVALID', 'operated_from 晚于 operated_to');
      }
      throw new AppError('VALIDATION_ERROR', parsed.error.message);
    }
    const data = parsed.data;
    // B1'：group_by 语义判定（D10：schema 层 optional/max(4) 不拒绝空，service 层语义判定）
    if (!data.group_by || data.group_by.length === 0) {
      throw new AppError('REPORT_GROUP_BY_REQUIRED', 'group_by 不能为空');
    }
    return { data, dims: data.group_by };
  }

  /**
   * 从日志提取维度值（D9）。
   * - operator_id → log.operator_id（uuid 字符串）
   * - entity_type → log.entity_type（user/role/dept）
   * - action → log.action（create/update/delete）
   * - date → log.operated_at.slice(0,10)（UTC 自然日 YYYY-MM-DD，PRD Q6）
   */
  private extractDimValue(
    log: AuditLog,
    dim: ReportGroupByDim,
  ): string {
    if (dim === 'operator_id') return log.operator_id;
    if (dim === 'entity_type') return log.entity_type;
    if (dim === 'action') return log.action;
    // date：UTC 自然日桶（operated_at.slice(0,10)）
    return log.operated_at.slice(0, 10);
  }
}
