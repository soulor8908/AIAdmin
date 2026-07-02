// apps/api/test/transfer-embedding.test.ts —— AI-007 端到端验收测试（PRD-TRANSFER-001 F1/F2/F3）
//
// 背景（R7 · TECH-TRANSFER-001 §9）：调岗事务为多步跨域原子操作（改部门 + 移除旧角色 + 分配新角色），
// 既有测试用 createXxxRouter(service) 只传 service，router 内部自建隔离的 AuditLogService/AuditLogRepository，
// 导致多步写操作后无法验证日志被记录/未记录（无幽灵日志），且补偿回滚后的状态恢复无法跨层观测。
//
// 注入方案（AI-007 关键 —— 注入共享依赖观测旁路副作用）：
//   - 共享 UserRepository + RoleRepository + DepartmentRepository + AuditLogRepository：
//     TransferService 注入的 userRepo/roleRepo 与可观测 userRepo/roleRepo 同一实例；
//     createTransferRouter 注入的 auditService 与 auditRepo 同源（→ 同一 auditRepo）。
//   - 调岗三步全部成功 → withAudit 旁路写一条聚合审计日志（entity_type=user/action=update），
//     本文件据 auditRepo.list() 读存储态日志断言 PRD F3-1 验收标准。
//   - 调岗任一步骤失败回滚 → withAudit 不调 audit.record → auditRepo 无日志（无幽灵日志，F3-2），
//     本文件据 auditRepo.list() total===0 断言。
//   - 回滚后状态恢复（F2-1/F2-2）→ 直接查共享 userRepo.findById + roleRepo.findUserRolesByUser 断言。
//
// 覆盖 PRD-TRANSFER-001 验收标准（§74-92 Given/When/Then）6 个 AC：
//   F1: AC-F1-1 调岗成功全链路（§74）
//   F2: AC-F2-1 步骤B失败回滚A（§85）/ AC-F2-2 步骤C失败回滚B+A（§86）/ AC-F2-3 补偿失败告警（§87）
//   F3: AC-F3-1 成功后聚合埋点（§91）/ AC-F3-2 失败无幽灵日志（§92）
import { describe, it, expect } from 'vitest';
import {
  transferInputSchema,
  type TransferInput,
  type User,
  type AuditLog,
  type AuditLogEntityType,
  type AuditLogAction,
  type ChangeField,
  type UserRole,
} from '@admin/contracts';
import { UserRepository } from '../src/repository/user.js';
import { RoleRepository } from '../src/repository/role.js';
import { DepartmentRepository } from '../src/repository/dept.js';
import { AuditLogRepository } from '../src/repository/audit.js';
import { UserService } from '../src/service/user.js';
import { RoleService } from '../src/service/role.js';
import { DepartmentService } from '../src/service/dept.js';
import { AuditLogService } from '../src/service/audit.js';
import { AppError } from '../src/errors.js';
import type { Ctx } from '../src/context.js';
import type { Procedure } from '../src/router/user.js';
import type { UserEntity } from '../src/domain/user.js';
import type { WriteResult } from '../src/domain/audit.js';
import { TransferService } from '../src/service/transfer.js'; // 预期导入红（impl 尚未存在）
import { createTransferRouter } from '../src/router/transfer.js'; // 预期导入红（impl 尚未存在）

// --- 固定 UUID（seed 用）---
const ADMIN_ID = 'admin-00000000-0000-4000-8000-000000000099';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const FROM_DEPT_ID = '00000000-0000-4000-8000-000000000010';
const TO_DEPT_ID = '00000000-0000-4000-8000-000000000020';
const OLD_ROLE_ID = '00000000-0000-4000-8000-000000000100';
const NEW_ROLE_ID = '00000000-0000-4000-8000-000000000200';
const USER_ROLE_ID = '00000000-0000-4000-8000-000000000101';
const SEED_TS = '2020-01-01T00:00:00.000Z';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };

// --- 辅助函数 ---

/** 模拟 router 层执行：safeParse 失败统一转 VALIDATION_ERROR，成功则调 handler。 */
async function callProc<I, O>(proc: Procedure<I, O>, raw: unknown, ctx: Ctx): Promise<O> {
  const parsed = proc.input.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', parsed.error.message);
  }
  return proc.handler(parsed.data, ctx);
}

/** 从 ChangeField[] 中按字段名取 value。 */
function fieldValue(fields: ChangeField[], name: string): unknown {
  return fields.find((f) => f.field === name)?.value;
}

/** ChangeField[] 是否含某字段名。 */
function hasField(fields: ChangeField[], name: string): boolean {
  return fields.some((f) => f.field === name);
}

/** 按 entity_type + entity_id + action 在 auditRepo 中查找最近一条匹配日志（存储态原值，未脱敏）。 */
function findLog(
  repo: AuditLogRepository,
  match: { entityType?: AuditLogEntityType; entityId?: string; action?: AuditLogAction },
): AuditLog | undefined {
  // 返回最近一条匹配（末条）：send 与 markRead 同为 action=update 时须取后者，
  // .find() 返回首条会误中旧日志，故用 .filter().pop() 取末条（与 notification-embedding 先例一致）。
  return repo
    .listAll()
    .filter(
      (l) =>
        (match.entityType === undefined || l.entity_type === match.entityType) &&
        (match.entityId === undefined || l.entity_id === match.entityId) &&
        (match.action === undefined || l.action === match.action),
    )
    .pop();
}

// --- mock 类（注入共享依赖观测补偿回滚）---

/**
 * ThrowingRoleService（F2 用）：extends RoleService，按 failStep 在 remove/assign 抛错模拟步骤 B/C 失败。
 * - failStep='remove'：步骤 B（移除旧角色）抛 AppError('ROLE_IN_USE') → 触发补偿 A
 * - failStep='assign'：步骤 C（分配新角色）抛 AppError('USER_ROLE_ALREADY_ASSIGNED') → 触发补偿 B+A
 */
class ThrowingRoleService extends RoleService {
  constructor(
    roleRepo: RoleRepository,
    userRepo: UserRepository,
    private readonly failStep: 'remove' | 'assign',
  ) {
    super(roleRepo, userRepo);
  }
  async remove(userId: string, roleId: string, ctx: Ctx): Promise<WriteResult<void>> {
    if (this.failStep === 'remove') {
      throw new AppError('ROLE_IN_USE', 'mock step B fail');
    }
    return super.remove(userId, roleId, ctx);
  }
  async assign(userId: string, roleId: string, ctx: Ctx): Promise<WriteResult<UserRole>> {
    if (this.failStep === 'assign') {
      throw new AppError('USER_ROLE_ALREADY_ASSIGNED', 'mock step C fail');
    }
    return super.assign(userId, roleId, ctx);
  }
}

/**
 * ThrowingUserRepo（F2-3 用）：extends UserRepository，updateDepartmentId 在第二次调用（补偿时）抛错。
 * 第一次调用 = 步骤 A 正向改部门（成功）；第二次调用 = 补偿 A 改回原部门（抛错 → TRANSFER_COMPENSATION_FAILED）。
 */
class ThrowingUserRepo extends UserRepository {
  private updateDepartmentIdCallCount = 0;
  updateDepartmentId(
    userId: string,
    departmentId: string | null,
    updatedAt: string,
  ): UserEntity | undefined {
    this.updateDepartmentIdCallCount++;
    if (this.updateDepartmentIdCallCount === 2) {
      throw new Error('mock compensation failure (updateDepartmentId 2nd call)');
    }
    return super.updateDepartmentId(userId, departmentId, updatedAt);
  }
}

// --- 共享依赖 setup ---

/**
 * seed 共享依赖（userRepo/roleRepo/deptRepo/auditRepo）的公共数据：
 * admin 用户 + 被调岗用户（已归属 fromDept + 已分配 oldRole）+ fromDept + toDept + oldRole(builtin:false) + newRole。
 * 由各 setup 函数调用，保证 seed 一致性。
 */
function seedSharedData(
  userRepo: UserRepository,
  roleRepo: RoleRepository,
  deptRepo: DepartmentRepository,
): void {
  // seed admin 用户（adminCtx 操作者）
  userRepo.insert({
    id: ADMIN_ID,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    version: 0,
    created_at: SEED_TS,
    updated_at: SEED_TS,
  });
  // seed 被调岗用户（已归属 fromDept + status=active）
  userRepo.insert({
    id: USER_ID,
    name: 'alice',
    email: 'alice@example.com',
    status: 'active',
    version: 0,
    department_id: FROM_DEPT_ID,
    created_at: SEED_TS,
    updated_at: SEED_TS,
  });
  // seed fromDept + toDept
  deptRepo.insert({ id: FROM_DEPT_ID, name: 'Engineering', parent_id: null, created_at: SEED_TS });
  deptRepo.insert({ id: TO_DEPT_ID, name: 'Sales', parent_id: null, created_at: SEED_TS });
  // seed oldRole(builtin:false) + newRole
  roleRepo.insert({
    id: OLD_ROLE_ID,
    name: 'engineer',
    description: 'Engineer role',
    permission_codes: ['user:read'],
    is_builtin: false,
    version: 0,
    parent_role_id: null, // ②类同步（TECH-ROLE-INHERITANCE-001 §8.2）
    created_at: SEED_TS,
  });
  roleRepo.insert({
    id: NEW_ROLE_ID,
    name: 'salesperson',
    description: 'Sales role',
    permission_codes: ['user:read'],
    is_builtin: false,
    version: 0,
    parent_role_id: null, // ②类同步（TECH-ROLE-INHERITANCE-001 §8.2）
    created_at: SEED_TS,
  });
  // seed userRole(userId, oldRole) —— 用户当前已分配 oldRole（调岗前置状态）
  roleRepo.insertUserRole({
    id: USER_ROLE_ID,
    user_id: USER_ID,
    role_id: OLD_ROLE_ID,
    assigned_at: SEED_TS,
  });
}

/**
 * 端到端 setup：创建共享 userRepo/roleRepo/deptRepo/auditRepo + 共享 auditService，
 * 注入 TransferService + createTransferRouter（共享 auditService 聚合日志）。
 * 关键（AI-007）：TransferService 注入的 userRepo/roleRepo 与可观测 userRepo/roleRepo 同一实例；
 * createTransferRouter 注入的 auditService 与 auditRepo 同源。
 */
function setupShared(): {
  userRepo: UserRepository;
  roleRepo: RoleRepository;
  deptRepo: DepartmentRepository;
  auditRepo: AuditLogRepository;
  auditService: AuditLogService;
  transferService: TransferService;
  router: ReturnType<typeof createTransferRouter>;
} {
  const userRepo = new UserRepository();
  const roleRepo = new RoleRepository();
  const deptRepo = new DepartmentRepository();
  const auditRepo = new AuditLogRepository();
  const auditService = new AuditLogService(auditRepo);
  seedSharedData(userRepo, roleRepo, deptRepo);
  const userService = new UserService(userRepo);
  const roleService = new RoleService(roleRepo, userRepo);
  const deptService = new DepartmentService(deptRepo, userRepo);
  const transferService = new TransferService(userService, deptService, roleService, userRepo, roleRepo, deptRepo);
  const router = createTransferRouter(transferService, auditService);
  return { userRepo, roleRepo, deptRepo, auditRepo, auditService, transferService, router };
}

/**
 * F2 setup（步骤 B 或 C 失败）：用 ThrowingRoleService 替换 RoleService，注入共享依赖。
 * - failStep='remove'：步骤 B 失败（AC-F2-1）
 * - failStep='assign'：步骤 C 失败（AC-F2-2）
 * 其余依赖同 setupShared()，保证补偿闭包直接调共享 repo 可观测。
 */
function setupWithThrowingRole(failStep: 'remove' | 'assign'): {
  userRepo: UserRepository;
  roleRepo: RoleRepository;
  deptRepo: DepartmentRepository;
  auditRepo: AuditLogRepository;
  transferService: TransferService;
  router: ReturnType<typeof createTransferRouter>;
} {
  const userRepo = new UserRepository();
  const roleRepo = new RoleRepository();
  const deptRepo = new DepartmentRepository();
  const auditRepo = new AuditLogRepository();
  const auditService = new AuditLogService(auditRepo);
  seedSharedData(userRepo, roleRepo, deptRepo);
  const userService = new UserService(userRepo);
  const throwingRoleService = new ThrowingRoleService(roleRepo, userRepo, failStep);
  const deptService = new DepartmentService(deptRepo, userRepo);
  const transferService = new TransferService(
    userService,
    deptService,
    throwingRoleService,
    userRepo,
    roleRepo,
    deptRepo,
  );
  const router = createTransferRouter(transferService, auditService);
  return { userRepo, roleRepo, deptRepo, auditRepo, transferService, router };
}

/**
 * F2-3 setup（补偿失败告警）：用 ThrowingUserRepo（updateDepartmentId 第2次抛错）+ ThrowingRoleService(remove 抛错)。
 * 步骤 A 正向成功（updateDepartmentId 第1次）→ 步骤 B 失败 → 补偿 A 抛错（updateDepartmentId 第2次）→ TRANSFER_COMPENSATION_FAILED。
 * 关键：deptService 与 TransferService 共用同一 ThrowingUserRepo 实例，保证补偿闭包观测到第2次抛错。
 */
function setupWithCompensationFailure(): {
  userRepo: ThrowingUserRepo;
  roleRepo: RoleRepository;
  deptRepo: DepartmentRepository;
  auditRepo: AuditLogRepository;
  router: ReturnType<typeof createTransferRouter>;
} {
  const userRepo = new ThrowingUserRepo();
  const roleRepo = new RoleRepository();
  const deptRepo = new DepartmentRepository();
  const auditRepo = new AuditLogRepository();
  const auditService = new AuditLogService(auditRepo);
  seedSharedData(userRepo, roleRepo, deptRepo);
  const userService = new UserService(userRepo);
  const throwingRoleService = new ThrowingRoleService(roleRepo, userRepo, 'remove');
  // deptService 注入同一 ThrowingUserRepo：步骤 A 正向改部门经 deptService → userRepo.updateDepartmentId(第1次)
  const deptService = new DepartmentService(deptRepo, userRepo);
  // TransferService 注入同一 ThrowingUserRepo：补偿 A 直接调 userRepo.updateDepartmentId(第2次)→抛错
  const transferService = new TransferService(
    userService,
    deptService,
    throwingRoleService,
    userRepo,
    roleRepo,
    deptRepo,
  );
  const router = createTransferRouter(transferService, auditService);
  return { userRepo, roleRepo, deptRepo, auditRepo, router };
}

/** 标准调岗入参构造（经 transferInputSchema.parse 确保 SSOT 校验通过）。 */
function makeInput(): TransferInput {
  return transferInputSchema.parse({
    userId: USER_ID,
    toDepartmentId: TO_DEPT_ID,
    oldRoleId: OLD_ROLE_ID,
    newRoleId: NEW_ROLE_ID,
  });
}

// ---------------------------------------------------------------------------
// F1 端到端 · 调岗成功全链路（AC-F1-1，§74）
// ---------------------------------------------------------------------------
describe('F1 端到端 · 调岗成功全链路（AC-F1-1，注入共享依赖观测多步副作用）', () => {
  it('AC-F1-1 §74 正常调岗成功 → user 部门=toDept + oldRole 已移除 + newRole 已分配 + auditRepo 含聚合日志 + handler 返回 entity.department_id=toDept', async () => {
    const { userRepo, roleRepo, auditRepo, router } = setupShared();
    // GIVEN 调岗前状态：user 已归属 fromDept + 已分配 oldRole
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
    expect(roleRepo.findUserRolesByUser(USER_ID).map((ur) => ur.role_id)).toContain(OLD_ROLE_ID);
    // WHEN 调岗（经 router.transfer.handler，withAudit 旁路埋点写入共享 auditRepo）
    // 注：createTransferRouter 为预期导入红，router.transfer 推断为 any，需显式断言 handler 返回类型为 User
    const result = (await callProc(router.transfer, makeInput(), adminCtx)) as User;
    // THEN ① userRepo 中 user.department_id === toDept
    expect(userRepo.findById(USER_ID)?.department_id).toBe(TO_DEPT_ID);
    // THEN ② roleRepo 中 oldRole 已移除 + newRole 已分配
    const roleIds = roleRepo.findUserRolesByUser(USER_ID).map((ur) => ur.role_id);
    expect(roleIds).not.toContain(OLD_ROLE_ID);
    expect(roleIds).toContain(NEW_ROLE_ID);
    // THEN ③ auditRepo.list total>=1 且 items 含 entity_type='user'/action='update'
    const { items, total } = auditRepo.list({ page: 1, pageSize: 10 });
    expect(total).toBeGreaterThanOrEqual(1);
    const transferLog = items.find(
      (l) => l.entity_type === 'user' && l.entity_id === USER_ID && l.action === 'update',
    );
    expect(transferLog).toBeDefined();
    // THEN ④ handler 返回的 entity.department_id === toDept
    expect(result.department_id).toBe(TO_DEPT_ID);
  });
});

// ---------------------------------------------------------------------------
// F2 端到端 · 回滚恢复（AC-F2-1 / AC-F2-2 / AC-F2-3）
// ---------------------------------------------------------------------------
describe('F2 端到端 · 回滚恢复（AC-F2-1/2/3，注入共享依赖观测补偿回滚）', () => {
  it('AC-F2-1 §85 步骤B失败回滚A → user 部门恢复 fromDept + oldRole 仍在 + auditRepo 无日志 + 抛 TRANSFER_FAILED', async () => {
    const { userRepo, roleRepo, auditRepo, router } = setupWithThrowingRole('remove');
    // GIVEN 调岗前状态
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
    expect(roleRepo.findUserRolesByUser(USER_ID).map((ur) => ur.role_id)).toContain(OLD_ROLE_ID);
    // WHEN 调岗（步骤 B remove 抛错 → 补偿 A 改回 fromDept）
    await expect(callProc(router.transfer, makeInput(), adminCtx)).rejects.toMatchObject({
      code: 'TRANSFER_FAILED',
    });
    // THEN ① userRepo 中 user.department_id === fromDept（步骤A补偿恢复）
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
    // THEN ② roleRepo 中 oldRole 仍在（步骤B未成功，未移除）；newRole 未分配
    const roleIds = roleRepo.findUserRolesByUser(USER_ID).map((ur) => ur.role_id);
    expect(roleIds).toContain(OLD_ROLE_ID);
    expect(roleIds).not.toContain(NEW_ROLE_ID);
    // THEN ③ auditRepo 无日志（无幽灵日志）
    expect(auditRepo.list({ page: 1, pageSize: 10 }).total).toBe(0);
  });

  it('AC-F2-2 §86 步骤C失败回滚B+A → user 部门恢复 + oldRole 重新分配 + newRole 未分配 + auditRepo 无日志 + 抛 TRANSFER_FAILED', async () => {
    const { userRepo, roleRepo, auditRepo, router } = setupWithThrowingRole('assign');
    // GIVEN 调岗前状态
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
    expect(roleRepo.findUserRolesByUser(USER_ID).map((ur) => ur.role_id)).toContain(OLD_ROLE_ID);
    // WHEN 调岗（步骤 C assign 抛错 → 补偿 B 重新分配 oldRole + 补偿 A 改回 fromDept）
    await expect(callProc(router.transfer, makeInput(), adminCtx)).rejects.toMatchObject({
      code: 'TRANSFER_FAILED',
    });
    // THEN ① user 部门恢复 fromDept
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
    // THEN ② oldRole 重新分配（补偿B生效：roleRepo.insertUserRole 重新加回 oldRole）
    const roleIds = roleRepo.findUserRolesByUser(USER_ID).map((ur) => ur.role_id);
    expect(roleIds).toContain(OLD_ROLE_ID);
    // THEN ③ newRole 未分配（步骤C失败）
    expect(roleIds).not.toContain(NEW_ROLE_ID);
    // THEN ④ auditRepo 无日志
    expect(auditRepo.list({ page: 1, pageSize: 10 }).total).toBe(0);
  });

  it('AC-F2-3 §87 补偿失败告警 → 抛 TRANSFER_COMPENSATION_FAILED（非静默吞）+ auditRepo 无日志', async () => {
    const { auditRepo, router } = setupWithCompensationFailure();
    // WHEN 调岗（步骤 B remove 抛错 → 补偿 A updateDepartmentId 第2次抛错 → TRANSFER_COMPENSATION_FAILED）
    await expect(callProc(router.transfer, makeInput(), adminCtx)).rejects.toMatchObject({
      code: 'TRANSFER_COMPENSATION_FAILED',
    });
    // THEN auditRepo 无日志（补偿失败也不埋点，withAudit handler 抛错不调 audit.record）
    expect(auditRepo.list({ page: 1, pageSize: 10 }).total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F3 端到端 · 事务感知聚合埋点（AC-F3-1 / AC-F3-2）
// ---------------------------------------------------------------------------
describe('F3 端到端 · 事务感知聚合埋点（AC-F3-1/2，注入共享 auditRepo 观测旁路副作用）', () => {
  it('AC-F3-1 §91 成功后聚合埋点 → auditRepo 恰好新增 1 条 entity_type=user/action=update，before/after 含 department_id + role_id', async () => {
    const { auditRepo, router } = setupShared();
    // GIVEN 调岗前 auditRepo 为空
    const totalBefore = auditRepo.list({ page: 1, pageSize: 10 }).total;
    expect(totalBefore).toBe(0);
    // WHEN 调岗成功
    await callProc(router.transfer, makeInput(), adminCtx);
    // THEN auditRepo 恰好新增 1 条（total 相比 before 多 1）
    const { items, total } = auditRepo.list({ page: 1, pageSize: 10 });
    expect(total).toBe(totalBefore + 1);
    // 取聚合日志（存储态原值，未脱敏）
    const log = findLog(auditRepo, { entityType: 'user', entityId: USER_ID, action: 'update' });
    expect(log).toBeDefined();
    if (!log) return;
    // entity_type=user / action=update / entity_id=USER_ID / operator_id=ADMIN_ID
    expect(log.entity_type).toBe('user');
    expect(log.action).toBe('update');
    expect(log.entity_id).toBe(USER_ID);
    expect(log.operator_id).toBe(ADMIN_ID);
    // before 含 department_id（旧 fromDept）+ role_id（旧 oldRole）字段
    expect(hasField(log.before, 'department_id')).toBe(true);
    expect(hasField(log.before, 'role_id')).toBe(true);
    expect(fieldValue(log.before, 'department_id')).toBe(FROM_DEPT_ID);
    expect(fieldValue(log.before, 'role_id')).toBe(OLD_ROLE_ID);
    // after 含 department_id（新 toDept）+ role_id（新 newRole）字段
    expect(hasField(log.after, 'department_id')).toBe(true);
    expect(hasField(log.after, 'role_id')).toBe(true);
    expect(fieldValue(log.after, 'department_id')).toBe(TO_DEPT_ID);
    expect(fieldValue(log.after, 'role_id')).toBe(NEW_ROLE_ID);
    // 仅一条聚合日志（非三条分散）：该 user 的 update 日志恰好 1 条
    expect(items.filter((l) => l.entity_id === USER_ID && l.entity_type === 'user')).toHaveLength(1);
  });

  it('AC-F3-2 §92 失败无幽灵日志 → 步骤B失败回滚后 auditRepo total===0（无调岗相关日志）', async () => {
    const { auditRepo, router } = setupWithThrowingRole('remove');
    // GIVEN 调岗前 auditRepo 为空
    const totalBefore = auditRepo.list({ page: 1, pageSize: 10 }).total;
    expect(totalBefore).toBe(0);
    // WHEN 调岗失败回滚（步骤 B remove 抛错）
    await expect(callProc(router.transfer, makeInput(), adminCtx)).rejects.toMatchObject({
      code: 'TRANSFER_FAILED',
    });
    // THEN auditRepo total===0（与调岗前一致，无新增 transfer 相关日志）
    expect(auditRepo.list({ page: 1, pageSize: 10 }).total).toBe(0);
    // 无 entity_type=user/action=update 的调岗日志
    const transferLog = findLog(auditRepo, { entityType: 'user', entityId: USER_ID, action: 'update' });
    expect(transferLog).toBeUndefined();
  });
});
