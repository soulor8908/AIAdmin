// apps/api/src/repository/user.ts —— 数据访问层：DB 持久化实现（node:sqlite）
// TECH-PERSIST-001：内存 Map → DB users 表（重启不丢，AC-F1-2 持久化语义）。
// [约束] 接口签名不变（D2，ARCH-001 闭合）：8 个公开方法逐字不变，仅构造接收 db（D13）。
// [约束] 保持插入顺序：list/findByIds/findByDepartmentId 用 ORDER BY rowid（AC-F3-4，D16 advisory）。
// [约束] 约束映射：insert catch UNIQUE email → USER_EMAIL_DUPLICATE（D10，§4）；FK/NOT NULL 走 500 backstop。
// ARCH-001：repository 不得 import service/router；可 import domain/contracts/db 基础设施。
import type { UserStatus } from '@admin/contracts';
import type { UserEntity } from '../domain/user.js';
import type { DatabaseSync } from 'node:sqlite';
import { isUniqueViolation, toAppError } from '../db/constraints.js';

export interface ListOptions {
  page: number;
  pageSize: number;
  status?: UserStatus;
}

export interface ListResult {
  items: UserEntity[];
  total: number;
}

/** users 表 DB 行结构（与 userEntitySchema 1:1，AC-F2-2）。 */
interface UserRow {
  id: string;
  name: string;
  email: string;
  status: string;
  department_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  password_hash: string;
}

/** PreparedStatement 类型别名（避免 ReturnType<DatabaseSync['prepare']> 重复）。 */
type Stmt = ReturnType<DatabaseSync['prepare']>;

/**
 * 将 DB 行转为 UserEntity（含 password_hash，存储态）。
 * [advisory] get()/all() 返回 [Object: null prototype]（§11 #4），此处用 {...row} 转普通对象。
 */
function rowToEntity(row: UserRow): UserEntity {
  return { ...row } as UserEntity;
}

export class UserRepository {
  private readonly db: DatabaseSync;
  private readonly findByIdStmt: Stmt;
  private readonly findByEmailStmt: Stmt;
  private readonly findByDepartmentIdStmt: Stmt;
  private readonly listAllStmt: Stmt;
  private readonly countAllStmt: Stmt;
  private readonly listByStatusStmt: Stmt;
  private readonly countByStatusStmt: Stmt;
  private readonly insertStmt: Stmt;
  private readonly updateStatusStmt: Stmt;
  private readonly updateDepartmentIdStmt: Stmt;
  /** findByIds 的 PreparedStatement 缓存（按 ids 长度复用，避免每次重新 prepare）。 */
  private readonly findByIdsCache = new Map<number, Stmt>();

  constructor(db: DatabaseSync) {
    this.db = db;
    this.findByIdStmt = db.prepare('SELECT * FROM users WHERE id=?');
    this.findByEmailStmt = db.prepare('SELECT * FROM users WHERE email=?');
    this.findByDepartmentIdStmt = db.prepare(
      'SELECT * FROM users WHERE department_id=? ORDER BY rowid',
    );
    this.listAllStmt = db.prepare(
      'SELECT * FROM users ORDER BY rowid LIMIT ? OFFSET ?',
    );
    this.countAllStmt = db.prepare('SELECT COUNT(*) AS n FROM users');
    this.listByStatusStmt = db.prepare(
      'SELECT * FROM users WHERE status=? ORDER BY rowid LIMIT ? OFFSET ?',
    );
    this.countByStatusStmt = db.prepare('SELECT COUNT(*) AS n FROM users WHERE status=?');
    this.insertStmt = db.prepare(
      'INSERT INTO users (id, name, email, status, department_id, created_at, updated_at, version, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    // UPDATE ... RETURNING * 经 .get() 返回更新后行（D16 advisory #6，SQLite 3.35+）；
    // 无匹配行（id 不存在）时 .get() 返回 undefined（语义=更新 0 行）。
    this.updateStatusStmt = db.prepare(
      'UPDATE users SET status=?, updated_at=?, version=version+1 WHERE id=? RETURNING *',
    );
    this.updateDepartmentIdStmt = db.prepare(
      'UPDATE users SET department_id=?, updated_at=?, version=version+1 WHERE id=? RETURNING *',
    );
  }

  /** 分页查询，可选按 status 过滤；保持插入顺序（ORDER BY rowid，AC-F3-4）。 */
  list(opts: ListOptions): ListResult {
    const offset = (opts.page - 1) * opts.pageSize;
    if (opts.status) {
      const items = this.listByStatusStmt.all(opts.status, opts.pageSize, offset) as UserRow[];
      const totalRow = this.countByStatusStmt.get(opts.status) as { n: number };
      return { items: items.map(rowToEntity), total: totalRow.n };
    }
    const items = this.listAllStmt.all(opts.pageSize, offset) as UserRow[];
    const totalRow = this.countAllStmt.get() as { n: number };
    return { items: items.map(rowToEntity), total: totalRow.n };
  }

  findById(id: string): UserEntity | undefined {
    const row = this.findByIdStmt.get(id) as UserRow | undefined;
    return row ? rowToEntity(row) : undefined;
  }

  /**
   * 批量查用户（TECH-NOTIFICATION-001 D2 落点）：按 ids IN 查询，返回存在的 UserEntity[]。
   * [约束] 不存在的 id 静默 omitted（不在结果中），不抛错（与 findById 返回 undefined 的"不存在即无"语义一致）。
   * [约束] 保持插入顺序（ORDER BY rowid，AC-F3-4）。
   * [约束] 调用方传唯一 id（去重由调用方负责，PRD Q10）；本期 NotificationService.send 传 [recipient_id]。
   */
  findByIds(ids: string[]): UserEntity[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    let stmt = this.findByIdsCache.get(ids.length);
    if (!stmt) {
      stmt = this.db.prepare(`SELECT * FROM users WHERE id IN (${placeholders}) ORDER BY rowid`);
      this.findByIdsCache.set(ids.length, stmt);
    }
    const rows = stmt.all(...ids) as UserRow[];
    return rows.map(rowToEntity);
  }

  findByEmail(email: string): UserEntity | undefined {
    const row = this.findByEmailStmt.get(email) as UserRow | undefined;
    return row ? rowToEntity(row) : undefined;
  }

  insert(user: UserEntity): UserEntity {
    try {
      this.insertStmt.run(
        user.id,
        user.name,
        user.email,
        user.status,
        user.department_id ?? null,
        user.created_at,
        user.updated_at,
        user.version,
        user.password_hash ?? '',
      );
      return user;
    } catch (e) {
      // D10 约束映射：UNIQUE email → USER_EMAIL_DUPLICATE（AC-F5-1）；其他（FK/NOT NULL）重抛走 500 backstop
      if (isUniqueViolation(e, 'users', 'email')) {
        toAppError('USER_EMAIL_DUPLICATE', '邮箱已被占用');
      }
      throw e;
    }
  }

  /** 仅更新 status 与 updated_at + version+1；不存在返回 undefined。
   * [约束] TECH-OPTIMISTIC-LOCKING-001 D7：每次 update 递增 version。 */
  updateStatus(id: string, status: UserStatus, updatedAt: string): UserEntity | undefined {
    const row = this.updateStatusStmt.get(status, updatedAt, id) as UserRow | undefined;
    return row ? rowToEntity(row) : undefined;
  }

  /** 跨域联动（TECH-DEPT-001）：查归属某部门的全部用户（保持插入顺序）。 */
  findByDepartmentId(deptId: string): UserEntity[] {
    const rows = this.findByDepartmentIdStmt.all(deptId) as UserRow[];
    return rows.map(rowToEntity);
  }

  /** 跨域联动（TECH-DEPT-001）：更新用户的 department_id（null=解除归属）+ version+1；不存在返回 undefined。
   * [约束] TECH-OPTIMISTIC-LOCKING-001 D7：每次 update 递增 version。 */
  updateDepartmentId(
    userId: string,
    departmentId: string | null,
    updatedAt: string,
  ): UserEntity | undefined {
    const row = this.updateDepartmentIdStmt.get(departmentId, updatedAt, userId) as
      | UserRow
      | undefined;
    return row ? rowToEntity(row) : undefined;
  }
}
