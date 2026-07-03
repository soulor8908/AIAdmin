// apps/api/src/repository/notification.ts —— 数据访问层：DB 持久化实现（node:sqlite）
// TECH-PERSIST-001：内存 Map → DB notifications 表（重启不丢，AC-F1-2 持久化语义）。
// [约束] 接口签名不变（D2，ARCH-001 闭合）：7 个公开方法逐字不变，仅构造接收 db（D13）。
// [约束] sent_at/read_at 可空（NULL 绑定，D16）；update 用 read-merge-write（Partial patch，§6.5）。
// [约束] updateStatusAndSentAt/updateStatusAndReadAt 用 UPDATE RETURNING（D16 advisory #6）。
// [约束] 构造时**不 seed**任何通知（空起步，由 create 动态产生）。
// ARCH-001：repository 不得 import service/router；可 import domain/contracts/db 基础设施。
import type { Notification, NotificationStatus } from '@admin/contracts';
import type { NotificationEntity } from '../domain/notification.js';
import type { DatabaseSync } from 'node:sqlite';

/** 通知实体类型别名（与契约 notificationSchema 的 Notification 一致，SSOT 在 contracts，禁止手写副本）。 */
export type { NotificationEntity };

export interface NotificationListOptions {
  page: number;
  pageSize: number;
  status?: NotificationStatus;
}

export interface NotificationListRepoResult {
  items: Notification[];
  total: number;
}

/** notifications 表 DB 行结构（sent_at/read_at 可空）。 */
interface NotificationRow {
  id: string;
  title: string;
  content: string;
  recipient_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  read_at: string | null;
  version: number;
}

type Stmt = ReturnType<DatabaseSync['prepare']>;

/** 将 DB 行转为 NotificationEntity（{...row} 转普通对象，§11 #4）。 */
function rowToEntity(row: NotificationRow): NotificationEntity {
  return { ...row } as NotificationEntity;
}

/**
 * 通知域 DB repository。
 * 构造时 **不 seed** 任何通知（空起步，由 create 动态产生）；保持插入顺序（ORDER BY rowid，AC-F3-4）。
 * 暴露 findById / insert / update / updateStatusAndSentAt / updateStatusAndReadAt / delete / list。
 * 不暴露状态守卫逻辑（append-only 由 service 层裁决，repo 仅执行数据访问）。
 */
export class NotificationRepository {
  private readonly findByIdStmt: Stmt;
  private readonly insertStmt: Stmt;
  private readonly updateStmt: Stmt;
  private readonly updateStatusAndSentAtStmt: Stmt;
  private readonly updateStatusAndReadAtStmt: Stmt;
  private readonly deleteStmt: Stmt;
  private readonly listAllStmt: Stmt;
  private readonly countAllStmt: Stmt;
  private readonly listByStatusStmt: Stmt;
  private readonly countByStatusStmt: Stmt;

  constructor(db: DatabaseSync) {
    this.findByIdStmt = db.prepare('SELECT * FROM notifications WHERE id=?');
    this.insertStmt = db.prepare(
      'INSERT INTO notifications (id, title, content, recipient_id, status, created_at, updated_at, sent_at, read_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    // update 用 read-merge-write：先 SELECT 现有 → JS 合并 patch → UPDATE 全字段（§6.5，Partial 无法用 COALESCE）
    this.updateStmt = db.prepare(
      'UPDATE notifications SET title=?, content=?, recipient_id=?, updated_at=?, version=version+1 WHERE id=? RETURNING *',
    );
    this.updateStatusAndSentAtStmt = db.prepare(
      "UPDATE notifications SET status='sent', sent_at=?, updated_at=?, version=version+1 WHERE id=? RETURNING *",
    );
    this.updateStatusAndReadAtStmt = db.prepare(
      "UPDATE notifications SET status='read', read_at=?, updated_at=?, version=version+1 WHERE id=? RETURNING *",
    );
    this.deleteStmt = db.prepare('DELETE FROM notifications WHERE id=?');
    this.listAllStmt = db.prepare('SELECT * FROM notifications ORDER BY rowid LIMIT ? OFFSET ?');
    this.countAllStmt = db.prepare('SELECT COUNT(*) AS n FROM notifications');
    this.listByStatusStmt = db.prepare(
      'SELECT * FROM notifications WHERE status=? ORDER BY rowid LIMIT ? OFFSET ?',
    );
    this.countByStatusStmt = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE status=?');
  }

  /** 按主键查通知；不存在返回 undefined。 */
  findById(id: string): NotificationEntity | undefined {
    const row = this.findByIdStmt.get(id) as NotificationRow | undefined;
    return row ? rowToEntity(row) : undefined;
  }

  /** 追加一条通知（create 用，status=draft / sent_at=null / read_at=null 由 service 构造时填好）。 */
  insert(notification: NotificationEntity): NotificationEntity {
    this.insertStmt.run(
      notification.id,
      notification.title,
      notification.content,
      notification.recipient_id,
      notification.status,
      notification.created_at,
      notification.updated_at,
      notification.sent_at,
      notification.read_at,
      notification.version,
    );
    return notification;
  }

  /** 全字段覆盖更新（update draft 用，service 层已守卫仅 draft 允许）+ version+1；不存在返回 undefined。
   * [约束] read-merge-write：先 SELECT 现有 → 合并 patch → UPDATE（Partial 无法用 COALESCE 区分未传/null）。
   * [约束] TECH-OPTIMISTIC-LOCKING-001 D7：每次 update 递增 version。 */
  update(id: string, patch: Partial<Omit<NotificationEntity, 'id'>>): NotificationEntity | undefined {
    const existing = this.findById(id);
    if (!existing) return undefined;
    const merged: NotificationEntity = { ...existing, ...patch, id: existing.id };
    const row = this.updateStmt.get(
      merged.title,
      merged.content,
      merged.recipient_id,
      merged.updated_at,
      id,
    ) as NotificationRow | undefined;
    return row ? rowToEntity(row) : undefined;
  }

  /** send（draft→sent）：仅置 status=sent + sent_at + updated_at + version+1；不存在返回 undefined。
   * [约束] TECH-OPTIMISTIC-LOCKING-001 D7：每次状态转移递增 version。 */
  updateStatusAndSentAt(
    id: string,
    sentAt: string,
    updatedAt: string,
  ): NotificationEntity | undefined {
    const row = this.updateStatusAndSentAtStmt.get(sentAt, updatedAt, id) as
      | NotificationRow
      | undefined;
    return row ? rowToEntity(row) : undefined;
  }

  /** markRead（sent→read）：仅置 status=read + read_at + updated_at + version+1；不存在返回 undefined。
   * [约束] TECH-OPTIMISTIC-LOCKING-001 D7：每次状态转移递增 version。 */
  updateStatusAndReadAt(
    id: string,
    readAt: string,
    updatedAt: string,
  ): NotificationEntity | undefined {
    const row = this.updateStatusAndReadAtStmt.get(readAt, updatedAt, id) as
      | NotificationRow
      | undefined;
    return row ? rowToEntity(row) : undefined;
  }

  /** 删除通知（delete draft 用，service 层已守卫仅 draft 允许）；不存在返回 false（changes===0）。 */
  delete(id: string): boolean {
    const result = this.deleteStmt.run(id);
    return result.changes === 1;
  }

  /** 分页查询，可选按 status 过滤；保持插入顺序（ORDER BY rowid，AC-F3-4）。 */
  list(opts: NotificationListOptions): NotificationListRepoResult {
    const offset = (opts.page - 1) * opts.pageSize;
    if (opts.status) {
      const items = this.listByStatusStmt.all(opts.status, opts.pageSize, offset) as NotificationRow[];
      const totalRow = this.countByStatusStmt.get(opts.status) as { n: number };
      return { items: items.map(rowToEntity), total: totalRow.n };
    }
    const items = this.listAllStmt.all(opts.pageSize, offset) as NotificationRow[];
    const totalRow = this.countAllStmt.get() as { n: number };
    return { items: items.map(rowToEntity), total: totalRow.n };
  }
}
