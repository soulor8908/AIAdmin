// apps/api/src/domain/version.ts —— 乐观锁版本校验纯函数（TECH-OPTIMISTIC-LOCKING-001 D5）
// ARCH-001：domain 不得 import 上层（service/repository/router），仅可 import @admin/contracts。
// 与 validateSetParent / transitionStatus 同模式（domain 持纯函数，service 调用转抛 AppError）。
import type { ErrorCode } from '@admin/contracts';

/**
 * 版本校验结果：匹配返回 ok，不匹配返回 VERSION_CONFLICT。
 */
export type VersionCheckResult =
  | { ok: true }
  | { ok: false; errorCode: 'VERSION_CONFLICT' };

/**
 * 乐观锁版本校验纯函数（D5）。
 * 比对客户端期望版本（If-Match header）与实体当前 version，不匹配则返回 VERSION_CONFLICT。
 *
 * @param expected 客户端期望版本（从 If-Match header 解析）
 * @param actual   实体当前 version
 * @returns { ok: true } | { ok: false, errorCode: 'VERSION_CONFLICT' }
 */
export function validateVersion(
  expected: number,
  actual: number,
): VersionCheckResult {
  if (expected !== actual) {
    return { ok: false, errorCode: 'VERSION_CONFLICT' as ErrorCode };
  }
  return { ok: true };
}
