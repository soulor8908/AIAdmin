// apps/api/src/domain/audit.ts —— 领域层：脱敏纯函数 + 保留期常量（无 IO）
// ARCH-001：domain 不得 import 上层（service/repository/router），仅可 import @admin/contracts。
// 操作日志无状态机（Tech-Spec §状态机：append-only，写入后只读，永不修改/删除）。
// ARCH-002：脱敏纯函数与保留期常量放 domain 层而非 contracts（contracts 只导出 Zod schema 与 z.infer 类型）。

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
