// apps/api/src/repository/token-blacklist.ts —— 数据访问层：登出吊销 token 黑名单（DB 持久化）
// TECH-PERSIST-001：内存 Set → DB token_blacklist 表（重启不丢，AC-F1-2 持久化语义）。
// [约束] 接口签名不变（D2，ARCH-001 闭合）：add(token)/has(token) 逐字不变，仅构造接收 db（D13）。
// [advisory] add 用 INSERT OR IGNORE 幂等（PK token 去重，§6.6）；has 用 SELECT 1 命中判定。
// ARCH-001：repository 仅可 import domain/contracts/db 基础设施，不得 import service/router。
import type { DatabaseSync } from 'node:sqlite';

/** DB 行结构（token + revoked_at）。 */
interface TokenBlacklistRow {
  token: string;
  revoked_at: string;
}

/**
 * 登出吊销 token 黑名单 repository（DB 持久化）。
 * 构造接收 db 连接（D13）；prepare 一次复用 PreparedStatement（D5 advisory）。
 */
export class TokenBlacklistRepository {
  private readonly insertStmt: ReturnType<DatabaseSync['prepare']>;
  private readonly findByTokenStmt: ReturnType<DatabaseSync['prepare']>;

  constructor(db: DatabaseSync) {
    this.insertStmt = db.prepare(
      'INSERT OR IGNORE INTO token_blacklist (token, revoked_at) VALUES (?, ?)',
    );
    this.findByTokenStmt = db.prepare('SELECT 1 FROM token_blacklist WHERE token=?');
  }

  /** 将 token 加入黑名单（登出吊销）。已存在则幂等（INSERT OR IGNORE，PK token 去重）。 */
  add(token: string): void {
    this.insertStmt.run(token, new Date().toISOString());
  }

  /** 检查 token 是否已被吊销（命中黑名单）。 */
  has(token: string): boolean {
    const row = this.findByTokenStmt.get(token) as TokenBlacklistRow | undefined;
    return row !== undefined;
  }
}
