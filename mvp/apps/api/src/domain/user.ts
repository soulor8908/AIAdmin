// apps/api/src/domain/user.ts —— 领域层：实体类型别名 + 状态机转移（纯函数，不含 IO）
// ARCH-001：domain 不得 import 上层（service/repository/router），仅可 import @admin/contracts。
import type { User, UserStatus } from '@admin/contracts';

/**
 * 用户存储实体类型别名（TECH-AUTH-001 D5 落地）。
 * [约束] contracts.userEntitySchema 要求 password_hash 必填（schema 校验语义）；
 *        此处 domain 层用 optional 桥接向后兼容 —— 既有测试/seed 在不带 password_hash 的场景下
 *        仍可正常插入 UserRepository（无 type 错误），新增 auth 域 seed/service 写入时显式带 password_hash。
 * [约束] HTTP 响应输出前须经 userSchema 投影剥离 password_hash（SEC-003a，service 层 create 返回时剥离）。
 * [advisory] optional vs 必填：与 contracts.userEntitySchema（必填）的语义差异为 advisory 偏离，
 *            理由为「repository 内部存储兼容既有不带 password_hash 的 seed/测试 fixture」，
 *            impl-writer 已在 auth.test.ts L88-91 以 cast 桥接（impl-writer 对齐签名后可移除 cast，但保留亦无副作用）。
 */
export type UserEntity = User & { password_hash?: string };

/**
 * 投影 UserEntity → User（剥离 password_hash，SEC-003a 输出 schema 1:1）。
 * [约束] service 层在返回 entity 给 router/HTTP 层前调用本函数，确保响应不含敏感字段。
 *        存储态原对象不受影响（返回新对象，仅拷贝 userSchema 定义的字段）。
 * [约束] 既有测试 seed 不带 password_hash 时，本函数为 no-op（字段本就不存在），零变更。
 */
export function toUserOutput(entity: UserEntity): User {
  return {
    id: entity.id,
    name: entity.name,
    email: entity.email,
    status: entity.status,
    department_id: entity.department_id,
    created_at: entity.created_at,
    updated_at: entity.updated_at,
    version: entity.version,
  };
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
