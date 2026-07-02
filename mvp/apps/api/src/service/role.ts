// apps/api/src/service/role.ts —— 业务层：编排 repository + 权限校验 + 抛 AppError
// 校验顺序（Tech-Spec §边界与异常，先到先返，不叠加）：
//   create:  B3 鉴权 → B4 name 唯一 → 写入
//   delete:  B3 鉴权 → B5 角色存在(ROLE_NOT_FOUND) → B6 内置(ROLE_BUILTIN_FORBIDDEN) → B7 已分配(ROLE_IN_USE)
//   assign:  B3 鉴权 → B8 用户存在(USER_NOT_FOUND) → B9 角色存在(ROLE_NOT_FOUND) → B10 已持有(USER_ROLE_ALREADY_ASSIGNED)
//   remove:  B3 鉴权 → B11 用户存在(USER_NOT_FOUND) → 关联不存在幂等 204(B12)
// D3：写操作返回 {entity, changes, before?}（WriteResult），供 router 层 withAudit 提取 entity + 旁路记日志。
import { randomUUID } from 'node:crypto';
import type {
  CreateRoleInput,
  ListRoleQuery,
  Role,
  RoleListResult,
  UserRole,
} from '@admin/contracts';
import type { RoleRepository } from '../repository/role.js';
import type { UserRepository } from '../repository/user.js';
import type { Ctx } from '../context.js';
import { markPii, type WriteResult } from '../domain/audit.js';
import { AppError } from '../errors.js';

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
    // B6: 内置角色不可删（先于 B7，无论是否已分配）
    if (role.is_builtin) {
      throw new AppError('ROLE_BUILTIN_FORBIDDEN', '内置角色不可删除');
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
}
