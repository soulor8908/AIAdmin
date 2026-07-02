// apps/api/src/domain/user.ts —— 领域层：实体类型别名 + 状态机转移（纯函数，不含 IO）
// ARCH-001：domain 不得 import 上层（service/repository/router），仅可 import @admin/contracts。
import type { User, UserStatus } from '@admin/contracts';

/** 用户实体类型别名（与契约 userSchema 的 User 一致，SSOT 在 contracts，禁止手写副本）。 */
export type UserEntity = User;

/** 状态机转移结果：合法返回下一态，非法返回对应错误码。 */
export type TransitionResult =
  | { ok: true; next: UserStatus }
  | { ok: false; errorCode: 'USER_ALREADY_ACTIVE' | 'USER_ALREADY_DISABLED' };

/**
 * 状态机裁决（纯函数）：active ⇄ disabled 合法；同态转移非法（重复启用/禁用）。
 * 不读写 IO，由 service 层调用并把 errorCode 转抛为 AppError。
 * 对齐 Tech-Spec §状态机迁移规则。
 */
export function transitionStatus(from: UserStatus, to: UserStatus): TransitionResult {
  if (from === to) {
    return from === 'active'
      ? { ok: false, errorCode: 'USER_ALREADY_ACTIVE' }
      : { ok: false, errorCode: 'USER_ALREADY_DISABLED' };
  }
  return { ok: true, next: to };
}
