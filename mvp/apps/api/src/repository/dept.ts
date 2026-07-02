// apps/api/src/repository/dept.ts —— 数据访问层：内存实现（Map）
// 本 MVP 不连真实 DB；DB schema SSOT 见 Tech-Spec §DB 变更。
// ARCH-001：repository 不得 import service/router；可 import domain/contracts。
import type { DepartmentEntity } from '../domain/dept.js';

/**
 * 部门域内存 repository。
 * [约束] 构造时**不 seed**任何内置部门（Tech-Spec §迁移与回滚：无内置部门 seed，空起步）。
 * [约束] 用 Map<string, DepartmentEntity> 存储并保持插入顺序（list/findByParent 用 Map.values() 顺序）。
 */
export class DepartmentRepository {
  private readonly store = new Map<string, DepartmentEntity>();

  /** 返回全部部门（保持插入顺序）。 */
  list(): DepartmentEntity[] {
    return Array.from(this.store.values());
  }

  findById(id: string): DepartmentEntity | undefined {
    return this.store.get(id);
  }

  /**
   * 按父 id 查直接子部门。
   * parentId=null → 返回根部门（parent_id=null）；parentId 非空 → 返回该父的直接子部门。
   * 保持插入顺序。
   */
  findByParent(parentId: string | null): DepartmentEntity[] {
    const result: DepartmentEntity[] = [];
    for (const d of this.store.values()) {
      if (d.parent_id === parentId) result.push(d);
    }
    return result;
  }

  insert(dept: DepartmentEntity): DepartmentEntity {
    this.store.set(dept.id, dept);
    return dept;
  }

  /** 删除部门行；返回是否曾存在。 */
  delete(id: string): boolean {
    return this.store.delete(id);
  }

  /**
   * 同父下名称是否已存在（Q3 同父唯一；跨父允许重名）。
   * parentId=null 表示在根部门中查重。
   * [advisory] 多数 DB 的 NULL 在唯一索引中互不相等，根部门间同名需 service 层显式校验；
   *            内存实现直接按 (parentId, name) 判等即可。
   */
  existsByNameUnderParent(name: string, parentId: string | null): boolean {
    for (const d of this.store.values()) {
      if (d.parent_id === parentId && d.name === name) return true;
    }
    return false;
  }

  /**
   * 计算「以 parentId 为父的新部门」所在层级（用于 create 守卫 B5）。
   * [约束] computeDepth(null) === 1（根，第 1 层）；
   *        computeDepth(rootId) === 2；逐层 +1。
   * 实现即沿 parent_id 链路向上数到根，得父部门层级，再 +1。
   * 注：本方法不校验 parentId 是否存在（service 层 B4 已先校验）；若不存在返回 1（保守不阻断）。
   */
  computeDepth(parentId: string | null): number {
    if (parentId === null) return 1;
    const parent = this.store.get(parentId);
    if (!parent) return 1; // 父不存在时保守返回 1（service 层 B4 先返 DEPT_NOT_FOUND）
    let parentDepth = 1;
    let current: DepartmentEntity | undefined = parent;
    while (current && current.parent_id !== null) {
      parentDepth++;
      current = this.store.get(current.parent_id);
    }
    return parentDepth + 1; // 新部门比父部门深一层
  }
}
