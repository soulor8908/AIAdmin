// apps/api/src/service/transfer.ts —— 调岗事务业务层（TECH-TRANSFER-001 F1/F2/F3）
// 校验顺序（§5 D6，先到先返，不叠加）：
//   transfer: requireAdmin → 校验阶段（validateTransferInput，前置不写入）→ 执行阶段（A改部门→B移除旧角色→C分配新角色）→ 补偿（失败逆序）→ 返回聚合 WriteResult
// D1：TransferService 注入 UserService + DepartmentService + RoleService（service→service→service 三层横向依赖，ARCH-001 仅禁 service→router），
//     另注入 UserRepository + RoleRepository + DepartmentRepository（校验查询 + 补偿闭包直接调 repo，绕过 service，D4）。
// D2：补偿闭包在 service 内构造，失败逆序执行（栈语义：后执行先补偿）。
// D3：校验纯函数 validateTransferInput 在 domain 层。
// D4：补偿闭包直接调 repo（userRepo.updateDepartmentId / roleRepo.insertUserRole / roleRepo.deleteUserRole），
//     绕过 service 的 requireAdmin + withAudit 埋点 + 额外校验，保持补偿纯粹（避免幽灵日志与校验污染）。
// D5：transfer 返回聚合 WriteResult<User>（before/after 含 department_id + role_id 虚拟字段，复用 withAudit 埋点，单条聚合日志）。
// D6：校验阶段失败直接传播底层错误码（USER_NOT_FOUND 等，调用方可区分）；执行阶段失败已回滚后聚合为 TRANSFER_FAILED；补偿失败抛 TRANSFER_COMPENSATION_FAILED（非静默吞，CODE-002）。
// ARCH-001：service 不得 import router；service 不 import AuditLogService（埋点在 router 层 withAudit）。
//
// [advisory] 反向同步（impl-writer 实现期偏离 D1，已同步 Tech-Spec §2/§3.1）：
//   Tech-Spec §2/§3.1 原写 TransferService 注入 5 依赖（不含 DepartmentRepository）。
//   实现期发现：校验阶段前置校验 toDeptExists 需直接查部门存在性，DepartmentService 无 public 只读查询方法
//   （仅 tree(ctx) 返回树结构，成本高且语义不匹配）。为遵守 SEC-002（不为查询新增 service public 方法）
//   + 校验前置不写入（D6）+ ARCH-001（service→repo 读，ReportService 注入 AuditLogRepository 先例），
//   TransferService 额外注入 DepartmentRepository（第 6 依赖）仅用于校验 toDeptExists（读，不写入）。
//   补偿闭包不调 deptRepo（部门变更的补偿是 userRepo.updateDepartmentId 改回，不涉及 dept 表）。
import type { TransferInput, User } from '@admin/contracts';
import type { UserService } from './user.js';
import type { RoleService } from './role.js';
import type { DepartmentService } from './dept.js';
import type { UserRepository } from '../repository/user.js';
import type { RoleRepository } from '../repository/role.js';
import type { DepartmentRepository } from '../repository/dept.js';
import type { Ctx } from '../context.js';
import { validateTransferInput } from '../domain/transfer.js';
import { markPii, type WriteResult } from '../domain/audit.js';
import { AppError } from '../errors.js';

export class TransferService {
  constructor(
    private readonly userService: UserService,
    private readonly deptService: DepartmentService,
    private readonly roleService: RoleService,
    private readonly userRepo: UserRepository,
    private readonly roleRepo: RoleRepository,
    private readonly deptRepo: DepartmentRepository,
  ) {}

  /** SEC-002：service 入口校验调用者必须为 admin，否则 FORBIDDEN。 */
  private requireAdmin(ctx: Ctx): void {
    if (ctx.user.role !== 'admin') {
      throw new AppError('FORBIDDEN', '需要管理员权限');
    }
  }

  /**
   * 调岗事务（F1/F2/F3）：校验 → 改部门 → 移除旧角色 → 分配新角色，三步跨域原子操作。
   * [约束] 校验阶段失败直接传播底层错误码（不聚合）。
   * [约束] 执行阶段失败已回滚后聚合为 TRANSFER_FAILED；补偿失败抛 TRANSFER_COMPENSATION_FAILED。
   * [约束] 补偿闭包直接调 repo（D4），绕过 service 的 requireAdmin/埋点/校验。
   * @returns 聚合 WriteResult<User>（before/after 含 department_id + role_id 虚拟字段）
   */
  async transfer(input: TransferInput, ctx: Ctx): Promise<WriteResult<User>> {
    this.requireAdmin(ctx);

    // --- 校验阶段（前置，不产生写入） ---
    const user = this.userRepo.findById(input.userId);
    const toDept = this.deptRepo.findById(input.toDepartmentId);
    const oldRole = this.roleRepo.findById(input.oldRoleId);
    const newRole = this.roleRepo.findById(input.newRoleId);
    const userRoles = this.roleRepo.findUserRolesByUser(input.userId);
    const userHasOldRole = userRoles.some((ur) => ur.role_id === input.oldRoleId);

    const validation = validateTransferInput(input, {
      userExists: !!user,
      userActive: user?.status === 'active',
      toDeptExists: !!toDept,
      newRoleExists: !!newRole,
      oldRoleExists: !!oldRole,
      oldRoleBuiltin: oldRole?.is_builtin === true,
      userHasOldRole,
    });
    if (!validation.ok) {
      throw new AppError(validation.errorCode, `调岗校验失败: ${validation.errorCode}`);
    }

    // 此时 user 非空、oldRole 非空、newRole 非空（校验已通过）
    const fromDeptId = user!.department_id ?? null;

    // --- 执行阶段（A→B→C，每步成功后 push 补偿闭包） ---
    const compensations: Array<() => void> = [];
    try {
      // 步骤 A：改部门（经 deptService.assignUserDepartment，含 requireAdmin + 内部校验）
      await this.deptService.assignUserDepartment(input.userId, input.toDepartmentId, ctx);
      compensations.push(() => {
        this.userRepo.updateDepartmentId(input.userId, fromDeptId, new Date().toISOString());
      });

      // 步骤 B：移除旧角色（经 roleService.remove，含 requireAdmin + 内部校验）
      await this.roleService.remove(input.userId, input.oldRoleId, ctx);
      compensations.push(() => {
        this.roleRepo.insertUserRole({
          id: crypto.randomUUID(),
          user_id: input.userId,
          role_id: input.oldRoleId,
          assigned_at: new Date().toISOString(),
        });
      });

      // 步骤 C：分配新角色（经 roleService.assign，含 requireAdmin + 内部校验）
      await this.roleService.assign(input.userId, input.newRoleId, ctx);
      compensations.push(() => {
        this.roleRepo.deleteUserRole(input.userId, input.newRoleId);
      });

      // --- 三步全成功 → 构造聚合 WriteResult<User>（D5） ---
      const updated = this.userRepo.findById(input.userId)!;
      const before = markPii('user', [
        { field: 'department_id', value: fromDeptId, pii: false },
        { field: 'role_id', value: input.oldRoleId, pii: false },
      ]);
      const changes = markPii('user', [
        { field: 'department_id', value: input.toDepartmentId, pii: false },
        { field: 'role_id', value: input.newRoleId, pii: false },
      ]);
      return { entity: updated, changes, before };
    } catch (e) {
      // --- 补偿阶段（逆序执行，D2） ---
      const originalError = e instanceof Error ? e : new Error(String(e));
      for (let i = compensations.length - 1; i >= 0; i--) {
        try {
          compensations[i]!();
        } catch (compErr) {
          // 补偿失败：非静默吞（CODE-002），抛 TRANSFER_COMPENSATION_FAILED
          const compMsg = compErr instanceof Error ? compErr.message : String(compErr);
          throw new AppError(
            'TRANSFER_COMPENSATION_FAILED',
            `补偿失败 at compensation[${i}]: ${compMsg}; 原失败: ${originalError.message}`,
          );
        }
      }
      // 补偿完成 → 抛 TRANSFER_FAILED（聚合执行阶段失败）
      throw new AppError('TRANSFER_FAILED', `调岗失败已回滚: ${originalError.message}`);
    }
  }
}
