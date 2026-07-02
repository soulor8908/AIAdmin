// packages/contracts/src/schemas/report.ts —— 操作统计报表契约层（SSOT，F2）
// 派生自 Tech-Spec TECH-AUDIT-ENHANCEMENT-001 §报表聚合契约（prd_ref: PRD-AUDIT-ENHANCEMENT-001 F2）。
// 约束：所有类型经 z.infer 派生（ARCH-002 / CODE-004）；输出 schema 带 .strict()（SEC-003a）。
// 约束：错误码 SSOT 仍为 user.ts 的 errorCodeSchema，本轮跨域联动追加 REPORT_GROUP_BY_REQUIRED / REPORT_TIME_RANGE_INVALID；
//       本文件不重复定义 errorCodeSchema，避免 export * 重名冲突。
// 约束：report 领域为纯读 + 聚合（非 CRUD），不扩展 auditLogEntityTypeSchema 枚举（entity_type 仍为 user/role/dept）。
// 约束：report 聚合维度均为非 PII 字段，仅返回计数，不涉及 PII 脱敏（PRD F2 末条）。
import { z } from 'zod';
import { auditLogEntityTypeSchema, auditLogActionSchema } from './audit.js';

/**
 * group by 维度枚举（PRD Q6：1~4 维，去重）。
 * [约束] operator_id → 取日志顶层 operator_id（uuid 字符串）；
 *        entity_type → 取日志顶层 entity_type（user/role/dept）；
 *        action → 取日志顶层 action（create/update/delete）；
 *        date → 取 operated_at.slice(0,10)（UTC 自然日 YYYY-MM-DD，PRD Q6）。
 */
export const reportGroupByDimSchema = z.enum(['operator_id', 'entity_type', 'action', 'date']);
export type ReportGroupByDim = z.infer<typeof reportGroupByDimSchema>;

/**
 * 报表查询入参（F2）。
 * [约束] D10 决策：group_by 为 z.array(reportGroupByDimSchema).max(4).optional()（不在 schema 层 .min(1) 拒绝空），
 *        由 router/service 层语义判定 group_by 缺省/空数组 → REPORT_GROUP_BY_REQUIRED；
 *        schema 层 superRefine 仅做 维度去重 + 时间范围检测，router 层据 error.issues 区分
 *        时间范围非法 → REPORT_TIME_RANGE_INVALID，其余 → VALIDATION_ERROR。
 * [约束] operated_from/operated_to 为 ISO datetime 闭区间；from > to → superRefine 拒绝（router 层后判 REPORT_TIME_RANGE_INVALID）。
 * [约束] page 默认 1；pageSize 默认 20、上限 100（transform 钳制，与 audit 列表查询一致，Q9）。
 * [advisory] 查询 schema 非 strict（未知 query 键被 strip，与 listAuditLogQuerySchema 一致）。
 */
export const reportQuerySchema = z
  .object({
    group_by: z.array(reportGroupByDimSchema).max(4).optional(),
    operated_from: z.string().datetime().optional(),
    operated_to: z.string().datetime().optional(),
    operator_id: z.string().uuid().optional(),
    entity_type: auditLogEntityTypeSchema.optional(),
    action: auditLogActionSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .transform((n) => Math.min(n, 100))
      .default(20),
  })
  .superRefine((data, ctx) => {
    // 去重校验：group_by 须无重复维度（缺省/空数组不在 schema 层拒绝，由 router 层语义判定）
    if (data.group_by !== undefined) {
      const seen = new Set<string>();
      for (const dim of data.group_by) {
        if (seen.has(dim)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'group_by 维度重复', path: ['group_by'] });
        }
        seen.add(dim);
      }
    }
    // 时间范围校验：from > to 拒绝（router 层后判 REPORT_TIME_RANGE_INVALID）
    if (data.operated_from && data.operated_to && data.operated_from > data.operated_to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'operated_from 晚于 operated_to',
        path: ['operated_from'],
      });
    }
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/**
 * 聚合行 item：含各 group_by 维度的值 + count。
 * [advisory] 用 z.record(z.string(), z.union([z.string(), z.number()])) 承载 { [dim]: value, count }——
 *            维度键随 group_by 动态变化，无法静态枚举字段名；service 层保证 items 每项含且仅含
 *            group_by 声明的维度键 + count。.and(z.object({count})) 强制 count 字段为非负整数。
 *            [advisory 偏离 Spec D8 示例] 不在 count 子 object 上加 .strict()：与 z.record 交集后 .strict()
 *            会拒绝 group_by 维度键（如 operator_id/entity_type），导致多维 item 校验失败；以测试契约（多维 item
 *            通过）为准，service 层裁决维度键集合（见 §3.3 D8 advisory）。
 */
export const reportAggItemSchema = z
  .record(z.string(), z.union([z.string(), z.number()]))
  .and(z.object({ count: z.number().int().min(0) }));
export type ReportAggItem = z.infer<typeof reportAggItemSchema>;

/**
 * 报表查询结果（F2）。
 * [约束] .strict()（SEC-003a）：拒绝多余字段；group_by 原样回显。
 * [约束] total = 去重后维度组合数（Map.size），非当前页条数；totalPages = ceil(total/pageSize)；空列表 totalPages=0。
 * [约束] items 按 count 降序 + 维度值升序 tiebreaker 排序（PRD Q8，service 层实现，不入 schema）。
 */
export const reportResultSchema = z
  .object({
    items: z.array(reportAggItemSchema),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    totalPages: z.number().int().min(0),
    group_by: z.array(reportGroupByDimSchema),
  })
  .strict();
export type ReportResult = z.infer<typeof reportResultSchema>;
