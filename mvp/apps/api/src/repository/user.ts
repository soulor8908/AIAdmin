// apps/api/src/repository/user.ts —— 数据访问层：内存实现（Map<string, User>）
// 本 MVP 不连真实 DB；DB schema SSOT 见 Tech-Spec §DB 变更。
import type { UserStatus } from '@admin/contracts';
import type { UserEntity } from '../domain/user.js';

export interface ListOptions {
  page: number;
  pageSize: number;
  status?: UserStatus;
}

export interface ListResult {
  items: UserEntity[];
  total: number;
}

export class UserRepository {
  private readonly store = new Map<string, UserEntity>();

  /** 分页查询，可选按 status 过滤；保持插入顺序。 */
  list(opts: ListOptions): ListResult {
    let arr = Array.from(this.store.values());
    if (opts.status) {
      arr = arr.filter((u) => u.status === opts.status);
    }
    const total = arr.length;
    const start = (opts.page - 1) * opts.pageSize;
    const items = arr.slice(start, start + opts.pageSize);
    return { items, total };
  }

  findById(id: string): UserEntity | undefined {
    return this.store.get(id);
  }

  /**
   * 批量查用户（TECH-NOTIFICATION-001 D2 落点）：遍历 store，返回存在的 UserEntity[]。
   * [约束] 不存在的 id 静默 omitted（不在结果中），不抛错（与 findById 返回 undefined 的"不存在即无"语义一致）。
   * [约束] 保持插入顺序（与 findById/findByDepartmentId 一致）。
   * [约束] 调用方传唯一 id（去重由调用方负责，PRD Q10）；本期 NotificationService.send 传 [recipient_id]。
   */
  findByIds(ids: string[]): UserEntity[] {
    const result: UserEntity[] = [];
    for (const id of ids) {
      const u = this.store.get(id);
      if (u) result.push(u);
    }
    return result;
  }

  findByEmail(email: string): UserEntity | undefined {
    for (const u of this.store.values()) {
      if (u.email === email) return u;
    }
    return undefined;
  }

  insert(user: UserEntity): UserEntity {
    this.store.set(user.id, user);
    return user;
  }

  /** 仅更新 status 与 updated_at + version+1；不存在返回 undefined。
   * [约束] TECH-OPTIMISTIC-LOCKING-001 D7：每次 update 递增 version。 */
  updateStatus(id: string, status: UserStatus, updatedAt: string): UserEntity | undefined {
    const u = this.store.get(id);
    if (!u) return undefined;
    const updated: UserEntity = { ...u, status, updated_at: updatedAt, version: u.version + 1 };
    this.store.set(id, updated);
    return updated;
  }

  /** 跨域联动（TECH-DEPT-001）：查归属某部门的全部用户（保持插入顺序）。 */
  findByDepartmentId(deptId: string): UserEntity[] {
    const result: UserEntity[] = [];
    for (const u of this.store.values()) {
      if (u.department_id === deptId) result.push(u);
    }
    return result;
  }

  /** 跨域联动（TECH-DEPT-001）：更新用户的 department_id（null=解除归属）+ version+1；不存在返回 undefined。
   * [约束] TECH-OPTIMISTIC-LOCKING-001 D7：每次 update 递增 version。 */
  updateDepartmentId(
    userId: string,
    departmentId: string | null,
    updatedAt: string,
  ): UserEntity | undefined {
    const u = this.store.get(userId);
    if (!u) return undefined;
    const updated: UserEntity = { ...u, department_id: departmentId, updated_at: updatedAt, version: u.version + 1 };
    this.store.set(userId, updated);
    return updated;
  }
}
