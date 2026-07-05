// apps/api/src/domain/user.ts —— 领域层：实体类型别名 + 状态机转移（纯函数，不含 IO）
// ARCH-001：domain 不得 import 上层（service/repository/router），仅可 import @admin/contracts。
import type { User, UserStatus } from '@admin/contracts';

/**
 * 用户存储实体类型别名（TECH-AUTH-001 D5 落地）。
 * 与 contracts.userEntitySchema 1:1 对齐：password_hash 必填（DB schema `password_hash TEXT NOT NULL`，
 * 见 schema.sql L50）。此前 domain 层用 optional 桥接向后兼容不带 password_hash 的 seed/测试 fixture，
 * 是与 contracts 的语义漂移；现已统一为必填，所有 seed/fixture 须显式带 password_hash。
 * [约束] HTTP 响应输出前须经 toUserOutput 投影剥离 password_hash（SEC-003a，service 层 create 返回时剥离）。
 */
export type UserEntity = User & { password_hash: string };

/**
 * 投影 UserEntity → User（剥离 password_hash，SEC-003a 输出 schema 1:1）。
 * 用结构 omit 而非字段枚举：UserEntity = User & { password_hash }，
 * 故 Omit<UserEntity, 'password_hash'> 在结构上就是 User，TS 会校验。
 * 避免手抄字段（schema 加字段时静默丢失 —— 见复盘「toUserOutput 漂移陷阱」）。
 */
export function toUserOutput(entity: UserEntity): User {
  const { password_hash: _stripped, ...rest } = entity;
  return rest;
}

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
