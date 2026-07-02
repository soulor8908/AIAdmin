// apps/api/src/domain/audit.ts —— 领域层：脱敏纯函数 + PII 清单 + 保留期常量（无 IO）
// ARCH-001：domain 不得 import 上层（service/repository/router），仅可 import @admin/contracts。
// 操作日志无状态机（Tech-Spec §状态机：append-only，写入后只读，永不修改/删除）。
// ARCH-002：脱敏纯函数与保留期常量放 domain 层而非 contracts（contracts 只导出 Zod schema 与 z.infer 类型）。
// D6：PII 清单 shape SSOT 在 contracts（piiFieldRegistrySchema），data SSOT 在 domain（PII_FIELD_REGISTRY）。
import {
  piiFieldRegistrySchema,
  type AuditLogEntityType,
  type ChangeField,
  type PiiFieldRegistry,
} from '@admin/contracts';

/**
 * 日志保留期（PRD Q6：90 天）。本期仅记录 created_at 供后续清理任务使用；
 * 清理任务本期不实现（Out of scope），此常量作为 SSOT 供未来清理任务引用。
 */
export const AUDIT_LOG_RETENTION_DAYS = 90;

/**
 * 邮箱脱敏（SEC-003b）：保留首 2 字符 + *** + @ + 域名（如 ab***@example.com）。
 * 输出须可被 contracts 的 redactedEmailSchema 解析（/^.{2}\*\*\*@[^\s@]+$/）。
 * [advisory] local 部分不足 2 字符的邮箱为边缘场景（邮箱通常 ≥2 字符），原样返回，Dev 须反向同步 Spec。
 * @param email 待脱敏的邮箱原值
 * @returns 脱敏后的邮箱（local<2 字符或无 @ 时原样返回）
 */
export function redactEmail(email: string): string {
  const at = email.indexOf('@');
  // local 部分不足 2 字符（含无 @ 的 indexOf=-1、首个 @ 在 <2 位置）→ 原样返回
  if (at < 2) return email;
  return email.slice(0, 2) + '***' + email.slice(at);
}

/**
 * PII 字段清单 data SSOT（D6）：按 entity_type → Set<field_name>。
 * [约束] shape 经 contracts 的 piiFieldRegistrySchema 校验（测试断言 piiFieldRegistrySchema.parse(PII_FIELD_REGISTRY) 不抛）。
 * [约束] 本期仅 user 域含 PII 字段 email；role/dept 本期无 PII 字段（不在 registry 中，markPii 对未注册 entity_type 返回全 pii=false）。
 * [约束] 新增 PII 字段时仅修改本常量，service 层脱敏逻辑自动跟随（D7：信任标记，移除运行时正则兜底）。
 */
export const PII_FIELD_REGISTRY: PiiFieldRegistry = {
  user: new Set<string>(['email']),
};
// shape SSOT 对齐校验（启动时一次，确保 data SSOT 与 contracts shape 一致）
piiFieldRegistrySchema.parse(PII_FIELD_REGISTRY);

/**
 * 根据 PII_FIELD_REGISTRY 标记 ChangeField[] 的 pii 字段（D6 辅助函数）。
 * [约束] 不改原数组项的 field/value，仅覆盖 pii 标记（测试断言 markPii 不改 field/value）。
 * [约束] 返回新数组（不 mutate 原数组），每个 item 的 pii = registry[entityType].has(field)。
 * [约束] entity_type 未在 registry 中时，所有字段 pii=false（role/dept 本期无 PII）。
 * @param entityType 实体类型（user/role/dept）
 * @param fields 待标记的 ChangeField[]（pii 字段可任意填，会被覆盖）
 * @returns 新 ChangeField[]，pii 按 registry 标记
 */
export function markPii(
  entityType: AuditLogEntityType,
  fields: ChangeField[],
): ChangeField[] {
  const piiFields = PII_FIELD_REGISTRY[entityType];
  return fields.map((f) => ({
    field: f.field,
    value: f.value,
    pii: piiFields ? piiFields.has(f.field) : false,
  }));
}

/**
 * 写操作统一返回结构（D3）：service 层写操作返回 {entity, changes, before?}。
 * [约束] entity 为操作后的实体（create/update 返回实体，delete 返回 void/undefined 表 204 无体）；
 *        changes 为 after 快照（ChangeField[]，含本次实际变更字段，经 markPii 标记 pii）；
 *        before 为变更前快照（ChangeField[]，仅 update/delete 含，create 省略）。
 * [约束] router 层 withAudit HOF 据此结构提取 entity 返回给调用方，并 best-effort 调 audit.record 记录日志。
 */
export interface WriteResult<E> {
  entity: E;
  changes: ChangeField[];
  before?: ChangeField[];
}
