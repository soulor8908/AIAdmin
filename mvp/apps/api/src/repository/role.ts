// apps/api/src/repository/role.ts —— 数据访问层：DB 持久化实现（node:sqlite）
// TECH-PERSIST-001：内存 Map → DB roles + user_roles 表（重启不丢，AC-F1-2 持久化语义）。
// [约束] 接口签名不变（D2，ARCH-001 闭合）：13 个公开方法逐字不变，仅构造接收 db（D13）。
// [约束] 构造时幂等 seed 内置 admin（INSERT OR IGNORE，UNIQUE name 触发 ignore，D7）。
// [约束] 复合字段：permission_codes JSON 序列化（D14）；is_builtin INTEGER 0/1 ↔ boolean（D16）。
// [约束] 约束映射：insert catch UNIQUE name → ROLE_NAME_DUPLICATE；insertUserRole catch UNIQUE(user_id,role_id) → USER_ROLE_ALREADY_ASSIGNED（D10，§4）。
// ARCH-001：repository 不得 import service/router；可 import domain/contracts/db 基础设施。
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  BUILTIN_ADMIN_ROLE_NAME,
  ALL_PERMISSION_CODES,
  type RoleEntity,
  type UserRoleEntity,
} from '../domain/role.js';
import { isUniqueViolation, toAppError } from '../db/constraints.js';

export interface RoleListOptions {
  page: number;
  pageSize: number;
}

export interface RoleListResult {
  items: RoleEntity[];
  total: number;
}

/** roles 表 DB 行结构（permission_codes 为 JSON 字符串，is_builtin 为 0/1）。 */
interface RoleRow {
  id: string;
  name: string;
  description: string;
  permission_codes: string;
  is_builtin: number;
  parent_role_id: string | null;
  created_at: string;
  version: number;
}

/** user_roles 表 DB 行结构。 */
interface UserRoleRow {
  id: string;
  user_id: string;
  role_id: string;
  assigned_at: string;
}

type Stmt = ReturnType<DatabaseSync['prepare']>;

/** 将 roles DB 行转为 RoleEntity（permission_codes JSON.parse，is_builtin Boolean 转换，D14/D16）。 */
function roleRowToEntity(row: RoleRow): RoleEntity {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permission_codes: JSON.parse(row.permission_codes) as RoleEntity['permission_codes'],
    is_builtin: Boolean(row.is_builtin),
    parent_role_id: row.parent_role_id,
    created_at: row.created_at,
    version: row.version,
  };
}

/** 将 user_roles DB 行转为 UserRoleEntity。 */
function userRoleRowToEntity(row: UserRoleRow): UserRoleEntity {
  return { ...row };
}

/**
 * 角色域 DB repository。
 * 构造时幂等 seed 内置 admin（INSERT OR IGNORE，UNIQUE name 触发 ignore，D7）。
 * user_roles 以 (user_id, role_id) UNIQUE 约束保证业务唯一（DB 层 SSOT，Q10）。
 */
export class RoleRepository {
  private readonly db: DatabaseSync;
  private readonly findByIdStmt: Stmt;
  private readonly findByNameStmt: Stmt;
  private readonly findChildrenStmt: Stmt;
  private readonly listStmt: Stmt;
  private readonly countStmt: Stmt;
  private readonly insertStmt: Stmt;
  private readonly updateStmt: Stmt;
  private readonly deleteStmt: Stmt;
  private readonly seedAdminStmt: Stmt;
  private readonly insertUserRoleStmt: Stmt;
  private readonly findUserRolesByUserStmt: Stmt;
  private readonly findUserRolesByRoleStmt: Stmt;
  private readonly existsUserRoleStmt: Stmt;
  private readonly findUserRoleStmt: Stmt;
  private readonly deleteUserRoleStmt: Stmt;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.findByIdStmt = db.prepare('SELECT * FROM roles WHERE id=?');
    this.findByNameStmt = db.prepare('SELECT * FROM roles WHERE name=?');
    this.findChildrenStmt = db.prepare('SELECT * FROM roles WHERE parent_role_id=? ORDER BY rowid');
    this.listStmt = db.prepare('SELECT * FROM roles ORDER BY rowid LIMIT ? OFFSET ?');
    this.countStmt = db.prepare('SELECT COUNT(*) AS n FROM roles');
    this.insertStmt = db.prepare(
      'INSERT INTO roles (id, name, description, permission_codes, is_builtin, parent_role_id, created_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    // update 用 read-merge-write：COALESCE 对 nullable parent_role_id 不适用（无法区分"未传"与"显式置 null"），
    // 故先 SELECT 现有 → JS 合并 patch → UPDATE 全字段（§6.2 advisory）。
    this.updateStmt = db.prepare(
      'UPDATE roles SET name=?, description=?, permission_codes=?, is_builtin=?, parent_role_id=?, version=version+1 WHERE id=? RETURNING *',
    );
    this.deleteStmt = db.prepare('DELETE FROM roles WHERE id=?');
    this.seedAdminStmt = db.prepare(
      'INSERT OR IGNORE INTO roles (id, name, description, permission_codes, is_builtin, parent_role_id, created_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.insertUserRoleStmt = db.prepare(
      'INSERT INTO user_roles (id, user_id, role_id, assigned_at) VALUES (?, ?, ?, ?)',
    );
    this.findUserRolesByUserStmt = db.prepare(
      'SELECT * FROM user_roles WHERE user_id=? ORDER BY rowid',
    );
    this.findUserRolesByRoleStmt = db.prepare(
      'SELECT * FROM user_roles WHERE role_id=? ORDER BY rowid',
    );
    this.existsUserRoleStmt = db.prepare(
      'SELECT 1 FROM user_roles WHERE user_id=? AND role_id=?',
    );
    this.findUserRoleStmt = db.prepare(
      'SELECT * FROM user_roles WHERE user_id=? AND role_id=?',
    );
    this.deleteUserRoleStmt = db.prepare(
      'DELETE FROM user_roles WHERE user_id=? AND role_id=?',
    );
    this.seedBuiltinAdmin();
  }

  /** 幂等 seed 内置 admin：INSERT OR IGNORE（UNIQUE name 冲突时静默忽略，D7）。 */
  private seedBuiltinAdmin(): void {
    this.seedAdminStmt.run(
      randomUUID(),
      BUILTIN_ADMIN_ROLE_NAME,
      'Built-in administrator role with all permissions',
      JSON.stringify(ALL_PERMISSION_CODES),
      1, // is_builtin: true（D16）
      null, // parent_role_id: admin 是根角色（TECH-ROLE-INHERITANCE-001 D1）
      new Date().toISOString(),
      0, // version: 内置 admin 不可更新，version 恒 0（TECH-OPTIMISTIC-LOCKING-001 D8）
    );
  }

  /** 分页查询，保持插入顺序（ORDER BY rowid，AC-F3-4）；返回当前页切片与总数。 */
  list(opts: RoleListOptions): RoleListResult {
    const offset = (opts.page - 1) * opts.pageSize;
    const items = this.listStmt.all(opts.pageSize, offset) as RoleRow[];
    const totalRow = this.countStmt.get() as { n: number };
    return { items: items.map(roleRowToEntity), total: totalRow.n };
  }

  findById(id: string): RoleEntity | undefined {
    const row = this.findByIdStmt.get(id) as RoleRow | undefined;
    return row ? roleRowToEntity(row) : undefined;
  }

  /** 按名称查找（区分大小写）。 */
  findByName(name: string): RoleEntity | undefined {
    const row = this.findByNameStmt.get(name) as RoleRow | undefined;
    return row ? roleRowToEntity(row) : undefined;
  }

  insert(role: RoleEntity): RoleEntity {
    try {
      this.insertStmt.run(
        role.id,
        role.name,
        role.description,
        JSON.stringify(role.permission_codes),
        role.is_builtin ? 1 : 0,
        role.parent_role_id,
        role.created_at,
        role.version,
      );
      return role;
    } catch (e) {
      // D10 约束映射：UNIQUE name → ROLE_NAME_DUPLICATE（AC-F5-1）；其他重抛走 500 backstop
      if (isUniqueViolation(e, 'roles', 'name')) {
        toAppError('ROLE_NAME_DUPLICATE', '角色名已被占用');
      }
      throw e;
    }
  }

  /**
   * 原地更新角色字段（用于 setParent/unsetParent 修改 parent_role_id）+ version+1。
   * [约束] TECH-ROLE-INHERITANCE-001 D1：仅更新传入字段，未传字段保留原值（read-merge-write）。
   * [约束] TECH-OPTIMISTIC-LOCKING-001 D7：每次 update 递增 version（service 层已校验 If-Match）。
   * @returns 更新后的角色；若 id 不存在返回 undefined。
   */
  update(id: string, patch: Partial<RoleEntity>): RoleEntity | undefined {
    const existing = this.findById(id);
    if (!existing) return undefined;
    // read-merge-write：合并 patch 后全字段 UPDATE（COALESCE 不适用 nullable parent_role_id）
    const merged: RoleEntity = { ...existing, ...patch, id: existing.id };
    const row = this.updateStmt.get(
      merged.name,
      merged.description,
      JSON.stringify(merged.permission_codes),
      merged.is_builtin ? 1 : 0,
      merged.parent_role_id,
      id,
    ) as RoleRow | undefined;
    return row ? roleRowToEntity(row) : undefined;
  }

  /**
   * 查询引用某角色作为 parent_role_id 的全部子角色（用于 delete 守卫 B8 ROLE_HAS_CHILDREN）。
   * [约束] TECH-ROLE-INHERITANCE-001 §2 / D6：B8 守卫需检测待删角色是否仍有子角色引用。
   */
  findChildren(roleId: string): RoleEntity[] {
    const rows = this.findChildrenStmt.all(roleId) as RoleRow[];
    return rows.map(roleRowToEntity);
  }

  /** 删除角色行；返回是否曾存在（changes===1）。FK RESTRICT 防 children 漏删（backstop，§6.2）。 */
  delete(id: string): boolean {
    const result = this.deleteStmt.run(id);
    return result.changes === 1;
  }

  insertUserRole(userRole: UserRoleEntity): UserRoleEntity {
    try {
      this.insertUserRoleStmt.run(
        userRole.id,
        userRole.user_id,
        userRole.role_id,
        userRole.assigned_at,
      );
      return userRole;
    } catch (e) {
      // D10 约束映射：UNIQUE(user_id,role_id) → USER_ROLE_ALREADY_ASSIGNED（AC-F5-1 / AC-F4-3）；
      // 其他（FK user/role 不存在）重抛走 500 backstop
      if (isUniqueViolation(e, 'user_roles', 'user_id', 'role_id')) {
        toAppError('USER_ROLE_ALREADY_ASSIGNED', '用户已被分配该角色');
      }
      throw e;
    }
  }

  /** 列出某用户持有的全部 user_role 关联（保持插入顺序）。 */
  findUserRolesByUser(userId: string): UserRoleEntity[] {
    const rows = this.findUserRolesByUserStmt.all(userId) as UserRoleRow[];
    return rows.map(userRoleRowToEntity);
  }

  /** 列出引用某角色的全部 user_role 关联（用于 delete 守卫 B7 ROLE_IN_USE）。 */
  findUserRolesByRole(roleId: string): UserRoleEntity[] {
    const rows = this.findUserRolesByRoleStmt.all(roleId) as UserRoleRow[];
    return rows.map(userRoleRowToEntity);
  }

  /** 检测 (user_id, role_id) 关联是否存在。 */
  existsUserRole(userId: string, roleId: string): boolean {
    const row = this.existsUserRoleStmt.get(userId, roleId);
    return row !== undefined;
  }

  /** 取 (user_id, role_id) 关联记录；不存在返回 undefined。 */
  findUserRole(userId: string, roleId: string): UserRoleEntity | undefined {
    const row = this.findUserRoleStmt.get(userId, roleId) as UserRoleRow | undefined;
    return row ? userRoleRowToEntity(row) : undefined;
  }

  /** 按 (user_id, role_id) 删除关联；返回是否曾存在（changes===1）。 */
  deleteUserRole(userId: string, roleId: string): boolean {
    const result = this.deleteUserRoleStmt.run(userId, roleId);
    return result.changes === 1;
  }
}
