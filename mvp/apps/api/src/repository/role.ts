// apps/api/src/repository/role.ts —— 数据访问层：内存实现（Map）
// 本 MVP 不连真实 DB；DB schema SSOT 见 Tech-Spec §DB 变更。
// ARCH-001：repository 不得 import service/router；可 import domain/contracts。
import { randomUUID } from 'node:crypto';
import {
  BUILTIN_ADMIN_ROLE_NAME,
  ALL_PERMISSION_CODES,
  type RoleEntity,
  type UserRoleEntity,
} from '../domain/role.js';

export interface RoleListOptions {
  page: number;
  pageSize: number;
}

export interface RoleListResult {
  items: RoleEntity[];
  total: number;
}

/**
 * 角色域内存 repository。
 * 构造时幂等 seed 内置 admin（is_builtin=true，permission_codes=全集）。
 * user_roles 以 `${userId}|${roleId}` 为键存于独立 Map，保证 (user_id, role_id) 业务唯一。
 */
export class RoleRepository {
  private readonly roles = new Map<string, RoleEntity>();
  private readonly userRoles = new Map<string, UserRoleEntity>();

  constructor() {
    this.seedBuiltinAdmin();
  }

  /** 幂等 seed 内置 admin：若已存在同名角色则跳过。 */
  private seedBuiltinAdmin(): void {
    if (this.findByName(BUILTIN_ADMIN_ROLE_NAME)) return;
    const admin: RoleEntity = {
      id: randomUUID(),
      name: BUILTIN_ADMIN_ROLE_NAME,
      description: 'Built-in administrator role with all permissions',
      permission_codes: [...ALL_PERMISSION_CODES],
      is_builtin: true,
      // [约束] TECH-ROLE-INHERITANCE-001 D1：admin 是根角色，parent_role_id=null。
      // 同时禁止被设为父（ROLE_BUILTIN_PARENT_FORBIDDEN）与被设继承（ROLE_BUILTIN_FORBIDDEN）。
      parent_role_id: null,
      created_at: new Date().toISOString(),
      // [约束] TECH-OPTIMISTIC-LOCKING-001 D8：seed 数据 version=0（内置 admin 不可更新，version 恒 0）。
      version: 0,
    };
    this.roles.set(admin.id, admin);
  }

  /** 分页查询，保持插入顺序；返回当前页切片与总数。 */
  list(opts: RoleListOptions): RoleListResult {
    const arr = Array.from(this.roles.values());
    const total = arr.length;
    const start = (opts.page - 1) * opts.pageSize;
    const items = arr.slice(start, start + opts.pageSize);
    return { items, total };
  }

  findById(id: string): RoleEntity | undefined {
    return this.roles.get(id);
  }

  /** 按名称查找（区分大小写）。 */
  findByName(name: string): RoleEntity | undefined {
    for (const r of this.roles.values()) {
      if (r.name === name) return r;
    }
    return undefined;
  }

  insert(role: RoleEntity): RoleEntity {
    this.roles.set(role.id, role);
    return role;
  }

  /**
   * 原地更新角色字段（用于 setParent/unsetParent 修改 parent_role_id）+ version+1。
   * [约束] TECH-ROLE-INHERITANCE-001 D1：仅更新传入字段，未传字段保留原值。
   * [约束] TECH-OPTIMISTIC-LOCKING-001 D7：每次 update 递增 version（service 层已校验 If-Match）。
   * @returns 更新后的角色；若 id 不存在返回 undefined。
   */
  update(id: string, patch: Partial<RoleEntity>): RoleEntity | undefined {
    const existing = this.roles.get(id);
    if (!existing) return undefined;
    const updated: RoleEntity = { ...existing, ...patch, id: existing.id, version: existing.version + 1 };
    this.roles.set(id, updated);
    return updated;
  }

  /**
   * 查询引用某角色作为 parent_role_id 的全部子角色（用于 delete 守卫 B8 ROLE_HAS_CHILDREN）。
   * [约束] TECH-ROLE-INHERITANCE-001 §2 / D6：B8 守卫需检测待删角色是否仍有子角色引用。
   */
  findChildren(roleId: string): RoleEntity[] {
    const result: RoleEntity[] = [];
    for (const r of this.roles.values()) {
      if (r.parent_role_id === roleId) result.push(r);
    }
    return result;
  }

  /** 删除角色行；返回是否曾存在。 */
  delete(id: string): boolean {
    return this.roles.delete(id);
  }

  insertUserRole(userRole: UserRoleEntity): UserRoleEntity {
    this.userRoles.set(this.userRoleKey(userRole.user_id, userRole.role_id), userRole);
    return userRole;
  }

  /** 列出某用户持有的全部 user_role 关联（保持插入顺序）。 */
  findUserRolesByUser(userId: string): UserRoleEntity[] {
    const result: UserRoleEntity[] = [];
    for (const ur of this.userRoles.values()) {
      if (ur.user_id === userId) result.push(ur);
    }
    return result;
  }

  /** 列出引用某角色的全部 user_role 关联（用于 delete 守卫 B7 ROLE_IN_USE）。 */
  findUserRolesByRole(roleId: string): UserRoleEntity[] {
    const result: UserRoleEntity[] = [];
    for (const ur of this.userRoles.values()) {
      if (ur.role_id === roleId) result.push(ur);
    }
    return result;
  }

  /** 检测 (user_id, role_id) 关联是否存在。 */
  existsUserRole(userId: string, roleId: string): boolean {
    return this.userRoles.has(this.userRoleKey(userId, roleId));
  }

  /** 取 (user_id, role_id) 关联记录；不存在返回 undefined。 */
  findUserRole(userId: string, roleId: string): UserRoleEntity | undefined {
    return this.userRoles.get(this.userRoleKey(userId, roleId));
  }

  /** 按 (user_id, role_id) 删除关联；返回是否曾存在。 */
  deleteUserRole(userId: string, roleId: string): boolean {
    return this.userRoles.delete(this.userRoleKey(userId, roleId));
  }

  private userRoleKey(userId: string, roleId: string): string {
    return `${userId}|${roleId}`;
  }
}
