// apps/api/src/repository/token-blacklist.ts —— 数据访问层：登出吊销 token 黑名单（内存 Set）
// TECH-AUTH-001 D4：内存 Set 实现，logout 成功 → add(token)；token 校验时 has(token) → TOKEN_REVOKED。
// [约束] 进程重启清空（MVP 可接受，PRD Q8 决策①；持久化为未来方向，Out of scope）。
// [advisory] 黑名单无 TTL：过期 token 不会被主动清理，理论上内存增长；MVP 短时可接受。
// ARCH-001：repository 仅可 import domain/contracts，不得 import service/router。
export class TokenBlacklistRepository {
  private readonly store = new Set<string>();

  /** 将 token 加入黑名单（登出吊销）。已存在则幂等（Set 去重）。 */
  add(token: string): void {
    this.store.add(token);
  }

  /** 检查 token 是否已被吊销（命中黑名单）。 */
  has(token: string): boolean {
    return this.store.has(token);
  }
}
