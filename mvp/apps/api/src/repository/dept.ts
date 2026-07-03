// apps/api/src/repository/dept.ts —— 数据访问层：DB 持久化实现（node:sqlite）
// TECH-PERSIST-001：内存 Map → DB departments 表（重启不丢，AC-F1-2 持久化语义）。
// [约束] 接口签名不变（D2，ARCH-001 闭合）：7 个公开方法逐字不变，仅构造接收 db（D13）。
// [约束] findByParent/existsByNameUnderParent：parentId=null 用 IS NULL（advisory #10，= NULL 永假）。
// [约束] computeDepth：循环 SELECT 沿 parent_id 链向上数到根（与内存版同算法，签名不变）。
// [约束] 构造时**不 seed**任何内置部门（空起步，无内置部门 seed）。
// ARCH-001：repository 不得 import service/router；可 import domain/contracts/db 基础设施。
import type { DepartmentEntity } from '../domain/dept.js';
import type { DatabaseSync } from 'node:sqlite';

/** departments 表 DB 行结构（4 列，无 depth/version/updated_at，AC-F2-2）。 */
interface DeptRow {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

type Stmt = ReturnType<DatabaseSync['prepare']>;

/** 将 DB 行转为 DepartmentEntity（{...row} 转普通对象，§11 #4）。 */
function rowToEntity(row: DeptRow): DepartmentEntity {
  return { ...row };
}

/**
 * 部门域 DB repository。
 * [约束] 构造时**不 seed**任何内置部门（空起步，无内置部门 seed）。
 * [约束] parent_id 为 NULL 时表示根部门（第 1 层）；自引用 FK ON DELETE RESTRICT 防 children 漏删。
 */
export class DepartmentRepository {
  private readonly db: DatabaseSync;
  private readonly listStmt: Stmt;
  private readonly findByIdStmt: Stmt;
  private readonly findByParentNullStmt: Stmt;
  private readonly findByParentIdStmt: Stmt;
  private readonly insertStmt: Stmt;
  private readonly deleteStmt: Stmt;
  private readonly existsByNameUnderParentNullStmt: Stmt;
  private readonly existsByNameUnderParentIdStmt: Stmt;
  private readonly findParentIdStmt: Stmt;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.listStmt = db.prepare('SELECT * FROM departments ORDER BY rowid');
    this.findByIdStmt = db.prepare('SELECT * FROM departments WHERE id=?');
    // findByParent：parentId=null → IS NULL（advisory #10，= NULL 永假）；parentId 非空 → = ?
    // 分支两 SQL 避免 IS ? 的语义歧义（§6.3 advisory：可分支或用 IS ?，此处选分支更清晰）
    this.findByParentNullStmt = db.prepare(
      'SELECT * FROM departments WHERE parent_id IS NULL ORDER BY rowid',
    );
    this.findByParentIdStmt = db.prepare(
      'SELECT * FROM departments WHERE parent_id=? ORDER BY rowid',
    );
    this.insertStmt = db.prepare(
      'INSERT INTO departments (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)',
    );
    this.deleteStmt = db.prepare('DELETE FROM departments WHERE id=?');
    // existsByNameUnderParent：同 IS NULL / = ? 分支（advisory #10）
    this.existsByNameUnderParentNullStmt = db.prepare(
      'SELECT 1 FROM departments WHERE name=? AND parent_id IS NULL',
    );
    this.existsByNameUnderParentIdStmt = db.prepare(
      'SELECT 1 FROM departments WHERE name=? AND parent_id=?',
    );
    // computeDepth：逐层 SELECT parent_id 沿链向上（与内存版同算法）
    this.findParentIdStmt = db.prepare('SELECT parent_id FROM departments WHERE id=?');
  }

  /** 返回全部部门（保持插入顺序，ORDER BY rowid）。 */
  list(): DepartmentEntity[] {
    const rows = this.listStmt.all() as DeptRow[];
    return rows.map(rowToEntity);
  }

  findById(id: string): DepartmentEntity | undefined {
    const row = this.findByIdStmt.get(id) as DeptRow | undefined;
    return row ? rowToEntity(row) : undefined;
  }

  /**
   * 按父 id 查直接子部门。
   * parentId=null → 返回根部门（parent_id IS NULL）；parentId 非空 → 返回该父的直接子部门。
   * 保持插入顺序（ORDER BY rowid）。
   */
  findByParent(parentId: string | null): DepartmentEntity[] {
    const stmt = parentId === null ? this.findByParentNullStmt : this.findByParentIdStmt;
    const rows = (parentId === null ? stmt.all() : stmt.all(parentId)) as DeptRow[];
    return rows.map(rowToEntity);
  }

  insert(dept: DepartmentEntity): DepartmentEntity {
    this.insertStmt.run(dept.id, dept.name, dept.parent_id, dept.created_at);
    return dept;
  }

  /** 删除部门行；返回是否曾存在（changes===1）。FK RESTRICT 防 children 漏删（backstop，§6.3）。 */
  delete(id: string): boolean {
    const result = this.deleteStmt.run(id);
    return result.changes === 1;
  }

  /**
   * 同父下名称是否已存在（Q3 同父唯一；跨父允许重名）。
   * parentId=null 表示在根部门中查重（用 IS NULL，advisory #10）。
   */
  existsByNameUnderParent(name: string, parentId: string | null): boolean {
    const stmt = parentId === null ? this.existsByNameUnderParentNullStmt : this.existsByNameUnderParentIdStmt;
    const row = parentId === null ? stmt.get(name) : stmt.get(name, parentId);
    return row !== undefined;
  }

  /**
   * 计算「以 parentId 为父的新部门」所在层级（用于 create 守卫 B5）。
   * [约束] computeDepth(null) === 1（根，第 1 层）；
   *        computeDepth(rootId) === 2；逐层 +1。
   * 实现即沿 parent_id 链路向上数到根，得父部门层级，再 +1（与内存版同算法）。
   * 注：本方法不校验 parentId 是否存在（service 层 B4 已先校验）；若不存在返回 1（保守不阻断）。
   */
  computeDepth(parentId: string | null): number {
    if (parentId === null) return 1;
    const parentRow = this.findParentIdStmt.get(parentId) as { parent_id: string | null } | undefined;
    if (!parentRow) return 1; // 父不存在时保守返回 1（service 层 B4 先返 DEPT_NOT_FOUND）
    let parentDepth = 1;
    let current: { parent_id: string | null } | undefined = parentRow;
    while (current && current.parent_id !== null) {
      parentDepth++;
      current = this.findParentIdStmt.get(current.parent_id) as
        | { parent_id: string | null }
        | undefined;
    }
    return parentDepth + 1; // 新部门比父部门深一层
  }
}
