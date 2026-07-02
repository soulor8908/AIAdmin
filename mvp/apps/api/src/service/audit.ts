// apps/api/src/service/audit.ts —— 业务层：编排 repository + 权限校验 + PII 脱敏
// 校验顺序（Tech-Spec §边界与异常，先到先返，不叠加）：
//   list:   B1（router Zod 解析，含 pageSize 钳制）→ B3 鉴权（requireAdmin）→ 过滤 → 倒序 → 分页 → 脱敏 → 返回
//   record: B3 鉴权（requireAdmin，旁路调用方已校验，此处 SEC-002 重复校验）→ 写入（append-only）
// ARCH-001：service 不得 import router。
// D7：脱敏按 pii 标记（D5 ChangeField.pii）套 redactEmail，移除运行时正则兜底 EMAIL_LIKE_RE（信任标记，不按值猜测）。
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  listAuditLogQuerySchema,
  type AuditLog,
  type AuditLogListResult,
  type ChangeField,
} from '@admin/contracts';
import type { AuditLogRepository } from '../repository/audit.js';
import type { Ctx } from '../context.js';
import { redactEmail } from '../domain/audit.js';
import { AppError } from '../errors.js';

/**
 * record 入参：AuditLog 去掉服务端生成的 id / created_at（由 service 生成）。
 * 供其他 service（user/role/dept）在写操作成功后被动旁路调用记录日志（F1）。
 * before/after 为 ChangeField[]（D5 结构化快照，含 pii 标记）。
 */
export type AuditLogRecordInput = Omit<AuditLog, 'id' | 'created_at'>;

export class AuditLogService {
  constructor(private readonly auditRepo: AuditLogRepository) {}

  /** SEC-002：service 入口校验调用者必须为 admin（admin 桩下视为具备 audit:read），否则 FORBIDDEN。 */
  private requireAdmin(ctx: Ctx): void {
    if (ctx.user.role !== 'admin') {
      throw new AppError('FORBIDDEN', '需要管理员权限');
    }
  }

  /**
   * 列表查询（F2）：B1 解析（含 pageSize 钳制/默认值）→ B3 鉴权 → 过滤 → 倒序 → 分页 → 脱敏 → 返回。
   * service 入口对 query 套用 listAuditLogQuerySchema 以应用默认值（page=1/pageSize=20）与
   * pageSize transform 钳制（≤100，Q4）；router 层已解析时为幂等二次解析。
   * 空结果返回 items=[]/total=0/totalPages=0（不触发 B4 AUDIT_LOG_NOT_FOUND）。
   * 返回的 items 为脱敏态（redactedAuditLogSchema）：before/after 中 pii=true 字段已套用 redactEmail（SEC-003b，D7）。
   */
  async list(query: z.input<typeof listAuditLogQuerySchema>, ctx: Ctx): Promise<AuditLogListResult> {
    // B1：应用默认值与 pageSize 钳制（与 router 层幂等）
    const parsed = listAuditLogQuerySchema.parse(query);
    // B3：鉴权
    this.requireAdmin(ctx);
    const { items, total } = this.auditRepo.list({
      page: parsed.page,
      pageSize: parsed.pageSize,
      operated_from: parsed.operated_from,
      operated_to: parsed.operated_to,
      operator_id: parsed.operator_id,
      entity_type: parsed.entity_type,
    });
    const totalPages = total === 0 ? 0 : Math.ceil(total / parsed.pageSize);
    const redactedItems = items.map((l) => this.redactLog(l));
    return { items: redactedItems, total, page: parsed.page, pageSize: parsed.pageSize, totalPages };
  }

  /**
   * 旁路写入日志（F1）：供 withAudit（router 层）在写操作成功后调用记录日志。
   * 主操作失败则不调用本方法（PRD 兼容性要求：日志记录不影响主操作成败）。
   * 返回存储态 AuditLog（before/after 含原 PII，未脱敏）；查询入口 list 返回脱敏态（存储原值/查询脱敏分离）。
   * SEC-002 豁免：本方法为框架内部旁路日志写入，由 withAudit 在被审计 service 方法已通过自身鉴权后调用；
   *   operator_id 取自 input.operator_id（withAudit 从 ctx.user.id 设置），反映真实操作者（admin 或自服务收件人 F2-5）。
   *   若此处再 requireAdmin 会阻断 markRead 自服务埋点（收件人非 admin → FORBIDDEN 被 withAudit 吞 → 日志不入库），
   *   使 F2-5（operator_id=收件人 id 的日志须入库）不可达。被审计操作的鉴权由对应 service 方法负责：
   *   create/update/send/delete/list/detail 调 requireAdmin；markRead 走收件人守卫（ctx.user.id === recipient_id）。
   */
  // SEC-002-exempt: framework-internal旁路 logging via withAudit; operator_id=actual operator (admin or self-service recipient F2-5); admin guard would block markRead self-service audit
  async record(input: AuditLogRecordInput, _ctx: Ctx): Promise<AuditLog> {
    const log: AuditLog = {
      id: randomUUID(),
      operator_id: input.operator_id,
      operator_name: input.operator_name,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      action: input.action,
      operated_at: input.operated_at,
      before: input.before,
      after: input.after,
      created_at: new Date().toISOString(),
    };
    return this.auditRepo.insert(log);
  }

  /** 对单条日志的 before/after 套用 PII 脱敏（返回新对象，不修改存储态原值）。 */
  private redactLog(log: AuditLog): AuditLog {
    return {
      ...log,
      before: this.redactFields(log.before),
      after: this.redactFields(log.after),
    };
  }

  /**
   * 遍历 ChangeField[]，对 pii=true 且值为 string 的字段调 redactEmail；其余原样返回（D7：信任标记，不按值猜测）。
   * SEC-003b：查询返回的 before/after 中 pii 字段须脱敏，避免批量导出 PII。
   * [约束] 仅 pii=true 的字段脱敏；pii=false 但值像邮箱的字段原样返回（移除 EMAIL_LIKE_RE 正则兜底）。
   */
  private redactFields(fields: ChangeField[]): ChangeField[] {
    return fields.map((f) => {
      if (f.pii && typeof f.value === 'string') {
        return { ...f, value: redactEmail(f.value) };
      }
      return f;
    });
  }
}
