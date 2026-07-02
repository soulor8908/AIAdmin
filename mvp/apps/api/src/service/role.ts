// apps/api/src/service/role.ts —— 业务层：编排 repository + 权限校验 + 抛 AppError
// 校验顺序（Tech-Spec §边界与异常，先到先返，不叠加）：
//   create:           B3 鉴权 → B4 name 唯一 → 写入
//   delete:           B3 鉴权 → B5 角色存在(ROLE_NOT_FOUND) → B6 内置(ROLE_BUILTIN_FORBIDDEN)
//                          → B8 子角色引用(ROLE_HAS_CHILDREN) → B7 已分配(ROLE_IN_USE)
//                          （TECH-ROLE-INHERITANCE-001 D6：B8 插在 B6 与 B7 之间，结构约束优先于使用约束）
//   assign:           B3 鉴权 → B8 用户存在(USER_NOT_FOUND) → B9 角色存在(ROLE_NOT_FOUND) → B10 已持有(USER_ROLE_ALREADY_ASSIGNED)
//   remove:           B3 鉴权 → B11 用户存在(USER_NOT_FOUND) → 关联不存在幂等 204(B12)
//   setParent:        B3 鉴权 → validateSetParent（角色存在/父角色存在/角色非内置/自继承/父角色非内置/环检测）
//   unsetParent:      B3 鉴权 → 角色存在 → 角色非内置
//   getInheritanceChain: B3 鉴权 → 角色存在
//   getEffectivePermissions: B3 鉴权 → 用户存在
// D3：写操作返回 {entity, changes, before?}（WriteResult），供 router 层 withAudit 提取 entity + 旁路记日志。
import { randomUUID } from 'node:crypto';
import type {
  CreateRoleInput,
  ListRoleQuery,
  PermissionCode,
  Role,
  RoleListResult,
  UserRole,
} from '@admin/contracts';
import type { RoleRepository } from '../repository/role.js';
import type { UserRepository } from '../repository/user.js';
import type { Ctx } from '../context.js';
import { markPii, type WriteResult } from '../domain/audit.js';
import { AppError } from '../errors.js';
import { validateSetParent, detectCycle } from '../domain/role-inheritance.js';

export class RoleService {
  constructor(
    private readonly roleRepo: RoleRepository,
    private readonly userRepo: UserRepository,
  ) {}

  /** SEC-002：service 入口校验调用者必须为 admin，否则 FORBIDDEN。 */
  private requireAdmin(ctx: Ctx): void {
    if (ctx.user.role !== 'admin') {
      throw new AppError('FORBIDDEN', '需要管理员权限');
    }
  }

  async list(query: ListRoleQuery, ctx: Ctx): Promise<RoleListResult> {
    this.requireAdmin(ctx);
    const { items, total } = this.roleRepo.list({
      page: query.page,
      pageSize: query.pageSize,
    });
    // F2: 空列表 totalPages=0；否则 ceil(total/pageSize)
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
    return { items, total, page: query.page, pageSize: query.pageSize, totalPages };
  }

  async getById(id: string, ctx: Ctx): Promise<Role> {
    this.requireAdmin(ctx);
    // B5: 目标不存在
    const role = this.roleRepo.findById(id);
    if (!role) {
      throw new AppError('ROLE_NOT_FOUND', `角色不存在: ${id}`);
    }
    return role;
  }

  async create(input: CreateRoleInput, ctx: Ctx): Promise<WriteResult<Role>> {
    this.requireAdmin(ctx);
    // B4: name 全局唯一（含与内置 admin 冲突，Q3）
    const existing = this.roleRepo.findByName(input.name);
    if (existing) {
      throw new AppError('ROLE_NAME_DUPLICATE', `角色名称已存在: ${input.name}`);
    }
    const role: Role = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      permission_codes: input.permission_codes,
      is_builtin: false, // F1: 新建恒为非内置
      // [约束] TECH-ROLE-INHERITANCE-001 Q9：创建时无父角色，parent_role_id=null（根角色）。
      // 后续经 setParent 维护继承关系。
      parent_role_id: null,
      created_at: new Date().toISOString(),
    };
    const inserted = this.roleRepo.insert(role);
    // D3：changes 为 after 快照（role 本期无 PII，markPii 全 false）
    const changes = markPii('role', [
      { field: 'name', value: inserted.name, pii: false },
      { field: 'description', value: inserted.description, pii: false },
      { field: 'permission_codes', value: inserted.permission_codes, pii: false },
    ]);
    return { entity: inserted, changes };
  }

  async delete(id: string, ctx: Ctx): Promise<WriteResult<void>> {
    this.requireAdmin(ctx);
    // B5: 角色不存在（先于 B6/B7）
    const role = this.roleRepo.findById(id);
    if (!role) {
      throw new AppError('ROLE_NOT_FOUND', `角色不存在: ${id}`);
    }
    // B6: 内置角色不可删（先于 B7/B8，无论是否已分配或有子角色）
    if (role.is_builtin) {
      throw new AppError('ROLE_BUILTIN_FORBIDDEN', '内置角色不可删除');
    }
    // B8: 子角色引用（TECH-ROLE-INHERITANCE-001 D6：B8 插在 B6 与 B7 之间，结构约束优先于使用约束）。
    //     待删角色若仍有子角色引用，删除会导致子角色 parent_role_id 悬空，须先解除全部子角色继承。
    const children = this.roleRepo.findChildren(id);
    if (children.length > 0) {
      throw new AppError('ROLE_HAS_CHILDREN', '角色仍有子角色继承，需先解除全部子角色继承');
    }
    // B7: 已被分配（Q1 方案 B：须先解除全部分配）
    const assigned = this.roleRepo.findUserRolesByRole(id);
    if (assigned.length > 0) {
      throw new AppError('ROLE_IN_USE', '角色已被分配，需先解除全部分配');
    }
    this.roleRepo.delete(id);
    // D3：delete 返回 entity=void（204 无体），before 为删除前快照
    const before = markPii('role', [
      { field: 'name', value: role.name, pii: false },
      { field: 'description', value: role.description, pii: false },
      { field: 'permission_codes', value: role.permission_codes, pii: false },
    ]);
    return { entity: undefined, changes: [], before };
  }

  async assign(userId: string, roleId: string, ctx: Ctx): Promise<WriteResult<UserRole>> {
    this.requireAdmin(ctx);
    // B8: 用户不存在（先于 B9）
    const user = this.userRepo.findById(userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', `用户不存在: ${userId}`);
    }
    // B9: 角色不存在（先于 B10）
    const role = this.roleRepo.findById(roleId);
    if (!role) {
      throw new AppError('ROLE_NOT_FOUND', `角色不存在: ${roleId}`);
    }
    // B10: 该用户已持有此角色
    if (this.roleRepo.existsUserRole(userId, roleId)) {
      throw new AppError('USER_ROLE_ALREADY_ASSIGNED', '该用户已持有此角色');
    }
    // D3 + PRD F1（role.assignRole·removeRole，沿用 PRD-AUDIT-001 Q7：action=update，
    //   before/after 含虚拟字段 assigned_user_ids: string[] 的旧值/新值）：
    //   分配前查该角色当前关联的全量用户 id 列表（before 快照）
    const beforeUserIds = this.roleRepo.findUserRolesByRole(roleId).map((ur) => ur.user_id);
    const userRole: UserRole = {
      id: randomUUID(),
      user_id: userId,
      role_id: roleId,
      assigned_at: new Date().toISOString(),
    };
    const inserted = this.roleRepo.insertUserRole(userRole);
    // 分配后再查该角色关联的全量用户 id 列表（after 快照）
    const afterUserIds = this.roleRepo.findUserRolesByRole(roleId).map((ur) => ur.user_id);
    const before = markPii('role', [
      { field: 'assigned_user_ids', value: beforeUserIds, pii: false },
    ]);
    const changes = markPii('role', [
      { field: 'assigned_user_ids', value: afterUserIds, pii: false },
    ]);
    return { entity: inserted, changes, before };
  }

  async remove(userId: string, roleId: string, ctx: Ctx): Promise<WriteResult<void>> {
    this.requireAdmin(ctx);
    // B11: 用户不存在
    const user = this.userRepo.findById(userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', `用户不存在: ${userId}`);
    }
    // D3 + PRD F1（role.assignRole·removeRole，沿用 PRD-AUDIT-001 Q7：action=update，
    //   before/after 含虚拟字段 assigned_user_ids: string[] 的旧值/新值）：
    //   移除前查该角色当前关联的全量用户 id 列表（before 快照）
    const beforeUserIds = this.roleRepo.findUserRolesByRole(roleId).map((ur) => ur.user_id);
    // B12: 关联不存在视为幂等成功（204），不抛错
    this.roleRepo.deleteUserRole(userId, roleId);
    // 移除后再查该角色关联的全量用户 id 列表（after 快照）
    const afterUserIds = this.roleRepo.findUserRolesByRole(roleId).map((ur) => ur.user_id);
    const before = markPii('role', [
      { field: 'assigned_user_ids', value: beforeUserIds, pii: false },
    ]);
    const changes = markPii('role', [
      { field: 'assigned_user_ids', value: afterUserIds, pii: false },
    ]);
    return { entity: undefined, changes, before };
  }

  async listUserRoles(userId: string, ctx: Ctx): Promise<UserRole[]> {
    this.requireAdmin(ctx);
    return this.roleRepo.findUserRolesByUser(userId);
  }

  // ============================================================
  // 角色继承（TECH-ROLE-INHERITANCE-001 F1/F2/F3）
  // ============================================================

  /**
   * F1 设置继承关系（D1/D2/D4/D5）。
   * 校验顺序（§5）：requireAdmin → validateSetParent（角色存在/父角色存在/角色非内置/自继承/父角色非内置/环检测）。
   * 写操作返回 WriteResult<Role>，before/after 含 parent_role_id 虚拟字段（pii=false）。
   */
  async setParent(roleId: string, parentRoleId: string, ctx: Ctx): Promise<WriteResult<Role>> {
    this.requireAdmin(ctx);
    const role = this.roleRepo.findById(roleId);
    const parent = this.roleRepo.findById(parentRoleId);
    // 环检测：detectCycle 从 parentRoleId 向上遍历，遇 roleId 则环。
    // 注：parent 不存在时 detectCycle 的 findById 返回 undefined → hasCycle=false，
    //     由 validateSetParent 的 parentExists 校验先拦截（ROLE_NOT_FOUND）。
    const cycle = detectCycle(roleId, parentRoleId, (id) => this.roleRepo.findById(id));
    const result = validateSetParent(
      { roleId, parentRoleId },
      {
        roleExists: role !== undefined,
        parentExists: parent !== undefined,
        roleIsBuiltin: role?.is_builtin ?? false,
        parentIsBuiltin: parent?.is_builtin ?? false,
        hasCycle: cycle.hasCycle,
      },
    );
    if (!result.ok) {
      // 环检测错误 message 含环路径（A→B→A）便于调试（AC-F1-6/F1-7）
      if (result.errorCode === 'ROLE_INHERITANCE_CYCLE' && cycle.hasCycle) {
        throw new AppError('ROLE_INHERITANCE_CYCLE', `继承关系形成环: ${cycle.cyclePath!.join('→')}`);
      }
      throw new AppError(result.errorCode, `setParent 校验失败: ${result.errorCode}`);
    }
    // 校验通过，写入 parent_role_id（覆盖语义：Q5 决策，重新设置继承即覆盖旧值）
    const beforeRoleId = role!.parent_role_id;
    const updated = this.roleRepo.update(roleId, { parent_role_id: parentRoleId });
    // D5：before/after 含 parent_role_id 虚拟字段（pii=false）
    const before = markPii('role', [
      { field: 'parent_role_id', value: beforeRoleId, pii: false },
    ]);
    const changes = markPii('role', [
      { field: 'parent_role_id', value: parentRoleId, pii: false },
    ]);
    return { entity: updated!, changes, before };
  }

  /**
   * F1 解除继承关系（D5）。
   * 校验顺序：requireAdmin → 角色存在 → 角色非内置（内置 admin 不可改继承关系）。
   * 写操作返回 WriteResult<Role>，before/after 含 parent_role_id 虚拟字段。
   */
  async unsetParent(roleId: string, ctx: Ctx): Promise<WriteResult<Role>> {
    this.requireAdmin(ctx);
    const role = this.roleRepo.findById(roleId);
    if (!role) {
      throw new AppError('ROLE_NOT_FOUND', `角色不存在: ${roleId}`);
    }
    if (role.is_builtin) {
      throw new AppError('ROLE_BUILTIN_FORBIDDEN', '内置角色不可修改继承关系');
    }
    const beforeRoleId = role.parent_role_id;
    const updated = this.roleRepo.update(roleId, { parent_role_id: null });
    const before = markPii('role', [
      { field: 'parent_role_id', value: beforeRoleId, pii: false },
    ]);
    const changes = markPii('role', [
      { field: 'parent_role_id', value: null, pii: false },
    ]);
    return { entity: updated!, changes, before };
  }

  /**
   * F2 查询继承链（D7 · 祖先角色数组，从父到根）。
   * 校验顺序：requireAdmin → 角色存在。
   * 递归沿 parent_role_id 链向上遍历，遇 undefined 抛 ROLE_NOT_FOUND（CODE-002：非静默吞）。
   * 根角色（parent_role_id=null）返回 []（AC-F2-3）。
   */
  async getInheritanceChain(roleId: string, ctx: Ctx): Promise<Role[]> {
    this.requireAdmin(ctx);
    const role = this.roleRepo.findById(roleId);
    if (!role) {
      throw new AppError('ROLE_NOT_FOUND', `角色不存在: ${roleId}`);
    }
    const chain: Role[] = [];
    let current: Role | undefined = role;
    while (current.parent_role_id !== null) {
      const parent = this.roleRepo.findById(current.parent_role_id);
      if (!parent) {
        // CODE-002：链中某角色不存在（数据不一致），非静默吞，抛 ROLE_NOT_FOUND
        throw new AppError('ROLE_NOT_FOUND', `继承链中角色不存在: ${current.parent_role_id}`);
      }
      chain.push(parent);
      current = parent;
    }
    return chain;
  }

  /**
   * F3 计算用户有效权限码集合（D3 · 读时聚合，不存储冗余副本）。
   * 校验顺序：requireAdmin → 用户存在。
   * 算法：对用户直接分配的每个角色，沿 parent_role_id 链向上递归收集 permission_codes，取并集。
   * 去重（Set）+ 排序（sort）保证返回结果确定性（Q7）。
   */
  async getEffectivePermissions(userId: string, ctx: Ctx): Promise<PermissionCode[]> {
    this.requireAdmin(ctx);
    const user = this.userRepo.findById(userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', `用户不存在: ${userId}`);
    }
    const userRoles = this.roleRepo.findUserRolesByUser(userId);
    const permissionSet = new Set<PermissionCode>();
    for (const ur of userRoles) {
      const role = this.roleRepo.findById(ur.role_id);
      if (!role) continue; // 数据不一致静默跳过（角色被删除但 user_role 未清理，理论上不会发生）
      // 沿继承链向上递归收集 permission_codes
      let current: Role | undefined = role;
      while (current) {
        for (const code of current.permission_codes) {
          permissionSet.add(code);
        }
        if (current.parent_role_id === null) break;
        current = this.roleRepo.findById(current.parent_role_id);
      }
    }
    // Q7：去重（Set）+ 排序（sort）保证确定性
    return [...permissionSet].sort();
  }
}
