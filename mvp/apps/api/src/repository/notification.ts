// apps/api/src/repository/notification.ts —— 数据访问层：内存实现（Map<string, Notification>）
// 本 MVP 不连真实 DB；DB schema SSOT 见 Tech-Spec §DB 变更。
// ARCH-001：repository 不得 import service/router；可 import domain/contracts。
// F1 append-only 守卫：repo 层不阻止 sent 态 update/delete（内存实现无独立约束），
//   由 service 层状态守卫裁决（B6 NOTIFICATION_INVALID_TRANSITION）；落地真实 DB 时可加触发器或应用层守卫。
import type { Notification, NotificationStatus } from '@admin/contracts';
import type { NotificationEntity } from '../domain/notification.js';

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

/**
 * 通知域内存 repository。
 * 构造时 **不 seed** 任何通知（空起步，由 create 动态产生）；保持插入顺序（与 user repo 一致）。
 * 暴露 findById / insert / update / updateStatusAndSentAt / updateStatusAndReadAt / delete / list。
 * 不暴露状态守卫逻辑（append-only 由 service 层裁决，repo 仅执行数据访问）。
 */
export class NotificationRepository {
  private readonly store = new Map<string, NotificationEntity>();

  /** 按主键查通知；不存在返回 undefined。 */
  findById(id: string): NotificationEntity | undefined {
    return this.store.get(id);
  }

  /** 追加一条通知（create 用，status=draft / sent_at=null / read_at=null 由 service 构造时填好）。 */
  insert(notification: NotificationEntity): NotificationEntity {
    this.store.set(notification.id, notification);
    return notification;
  }

  /** 全字段覆盖更新（update draft 用，service 层已守卫仅 draft 允许）+ version+1；不存在返回 undefined。
   * [约束] TECH-OPTIMISTIC-LOCKING-001 D7：每次 update 递增 version。 */
  update(id: string, patch: Partial<Omit<NotificationEntity, 'id'>>): NotificationEntity | undefined {
    const n = this.store.get(id);
    if (!n) return undefined;
    const updated: NotificationEntity = { ...n, ...patch, version: n.version + 1 };
    this.store.set(id, updated);
    return updated;
  }

  /** send（draft→sent）：仅置 status=sent + sent_at + updated_at + version+1；不存在返回 undefined。
   * [约束] TECH-OPTIMISTIC-LOCKING-001 D7：每次状态转移递增 version。 */
  updateStatusAndSentAt(
    id: string,
    sentAt: string,
    updatedAt: string,
  ): NotificationEntity | undefined {
    const n = this.store.get(id);
    if (!n) return undefined;
    const updated: NotificationEntity = {
      ...n,
      status: 'sent',
      sent_at: sentAt,
      updated_at: updatedAt,
      version: n.version + 1,
    };
    this.store.set(id, updated);
    return updated;
  }

  /** markRead（sent→read）：仅置 status=read + read_at + updated_at + version+1；不存在返回 undefined。
   * [约束] TECH-OPTIMISTIC-LOCKING-001 D7：每次状态转移递增 version。 */
  updateStatusAndReadAt(
    id: string,
    readAt: string,
    updatedAt: string,
  ): NotificationEntity | undefined {
    const n = this.store.get(id);
    if (!n) return undefined;
    const updated: NotificationEntity = {
      ...n,
      status: 'read',
      read_at: readAt,
      updated_at: updatedAt,
      version: n.version + 1,
    };
    this.store.set(id, updated);
    return updated;
  }

  /** 删除通知（delete draft 用，service 层已守卫仅 draft 允许）；不存在返回 false。 */
  delete(id: string): boolean {
    return this.store.delete(id);
  }

  /** 分页查询，可选按 status 过滤；保持插入顺序。 */
  list(opts: NotificationListOptions): NotificationListRepoResult {
    let arr = Array.from(this.store.values());
    if (opts.status) {
      arr = arr.filter((n) => n.status === opts.status);
    }
    const total = arr.length;
    const start = (opts.page - 1) * opts.pageSize;
    const items = arr.slice(start, start + opts.pageSize);
    return { items, total };
  }
}
