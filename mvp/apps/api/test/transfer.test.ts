// apps/api/test/transfer.test.ts —— 测试先行（AI-002，断言级红）
// 本文件先于实现产出，覆盖 Tech-Spec TECH-TRANSFER-001 测试矩阵五类：
//   1. domain 纯函数 · validateTransferInput 校验顺序（9 用例）
//   2. 契约测 · transferInputSchema 入参 safeParse 合法/非法样本（4 用例）
//   3. service · transfer 成功路径（2 用例：正常调岗 + 非 admin FORBIDDEN）
//   4. service · transfer 校验失败路径（7 用例：每类校验失败，断言无写入）
//   5. service · transfer 执行失败回滚（3 用例：步骤B失败回滚A / 步骤C失败回滚B+A / 补偿失败告警）
// 设计说明（impl-writer 须遵循）：
//   - validateTransferInput 签名：见 TECH-TRANSFER-001 §3.3 D3
//   - TransferService 构造签名：new TransferService(userService, deptService, roleService, userRepo, roleRepo, deptRepo)
//   - transfer 返回 WriteResult<User>（{entity, changes, before?}），before/after 含 department_id + role_id 虚拟字段
//   - 补偿闭包直接调 repo（userRepo.updateDepartmentId / roleRepo.insertUserRole / roleRepo.deleteUserRole），绕过 service
//   - 预期导入红：'../src/domain/transfer.js' / '../src/service/transfer.js'（impl 尚未存在）
import { describe, it, expect } from 'vitest';
import { transferInputSchema, type TransferInput, type ErrorCode, type UserRole } from '@admin/contracts';
import { UserRepository } from '../src/repository/user.js';
import { RoleRepository } from '../src/repository/role.js';
import { DepartmentRepository } from '../src/repository/dept.js';
import { UserService } from '../src/service/user.js';
import { RoleService } from '../src/service/role.js';
import { DepartmentService } from '../src/service/dept.js';
import { AppError } from '../src/errors.js';
import type { Ctx } from '../src/context.js';
import type { UserEntity } from '../src/domain/user.js';
import type { WriteResult } from '../src/domain/audit.js';
import { validateTransferInput } from '../src/domain/transfer.js'; // 预期导入红
import { TransferService } from '../src/service/transfer.js'; // 预期导入红
import { createTestDb } from './helpers/db.js';

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
const userCtx: Ctx = { user: { id: USER_ID, role: 'user' } };

// --- 辅助：构造合法 transferInput ---
function makeInput(overrides: Partial<TransferInput> = {}): TransferInput {
  const raw = {
    userId: USER_ID,
    toDepartmentId: TO_DEPT_ID,
    oldRoleId: OLD_ROLE_ID,
    newRoleId: NEW_ROLE_ID,
    ...overrides,
  };
  return transferInputSchema.parse(raw);
}

// --- 辅助：seed 公共数据 ---
function seed(
  userRepo: UserRepository,
  roleRepo: RoleRepository,
  deptRepo: DepartmentRepository,
): void {
  // 先 insert dept（users.department_id FK → departments.id，PRAGMA foreign_keys=ON 要求父先于子）
  deptRepo.insert({ id: FROM_DEPT_ID, name: 'Engineering', parent_id: null, created_at: SEED_TS });
  deptRepo.insert({ id: TO_DEPT_ID, name: 'Sales', parent_id: null, created_at: SEED_TS });
  userRepo.insert({
    id: ADMIN_ID,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    version: 0,
    created_at: SEED_TS,
    updated_at: SEED_TS,
  });
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
  roleRepo.insertUserRole({
    id: USER_ROLE_ID,
    user_id: USER_ID,
    role_id: OLD_ROLE_ID,
    assigned_at: SEED_TS,
  });
}

// --- 辅助：标准 setup（默认合法前置态）---
function setup(): {
  userRepo: UserRepository;
  roleRepo: RoleRepository;
  deptRepo: DepartmentRepository;
  userService: UserService;
  roleService: RoleService;
  deptService: DepartmentService;
  transferService: TransferService;
} {
  // 多 repo 共享同一 db（transfer 事务跨 user/role/dept repo，FK + 补偿回滚需一致）
  const db = createTestDb();
  const userRepo = new UserRepository(db);
  const roleRepo = new RoleRepository(db);
  const deptRepo = new DepartmentRepository(db);
  seed(userRepo, roleRepo, deptRepo);
  const userService = new UserService(userRepo);
  const roleService = new RoleService(roleRepo, userRepo);
  const deptService = new DepartmentService(deptRepo, userRepo);
  const transferService = new TransferService(userService, deptService, roleService, userRepo, roleRepo, deptRepo, db);
  return { userRepo, roleRepo, deptRepo, userService, roleService, deptService, transferService };
}

// --- 辅助：从 ChangeField[] 取字段值（before/after 虚拟字段断言）---
function fieldValue(fields: { field: string; value: unknown; pii: boolean }[], name: string): unknown {
  return fields.find((f) => f.field === name)?.value;
}

// ===========================================================
// 1. domain · validateTransferInput 校验纯函数（9 用例）
// ===========================================================
describe('domain · validateTransferInput 校验顺序（先到先返）', () => {
  const baseInput: TransferInput = {
    userId: USER_ID,
    toDepartmentId: TO_DEPT_ID,
    oldRoleId: OLD_ROLE_ID,
    newRoleId: NEW_ROLE_ID,
  };
  const okDeps = {
    userExists: true,
    userActive: true,
    toDeptExists: true,
    newRoleExists: true,
    oldRoleExists: true,
    oldRoleBuiltin: false,
    userHasOldRole: true,
  };

  it('用户不存在 → USER_NOT_FOUND', () => {
    const r = validateTransferInput(baseInput, { ...okDeps, userExists: false });
    expect(r).toEqual({ ok: false, errorCode: 'USER_NOT_FOUND' });
  });

  it('用户已禁用 → USER_ALREADY_DISABLED', () => {
    const r = validateTransferInput(baseInput, { ...okDeps, userActive: false });
    expect(r).toEqual({ ok: false, errorCode: 'USER_ALREADY_DISABLED' });
  });

  it('目标部门不存在 → DEPT_NOT_FOUND', () => {
    const r = validateTransferInput(baseInput, { ...okDeps, toDeptExists: false });
    expect(r).toEqual({ ok: false, errorCode: 'DEPT_NOT_FOUND' });
  });

  it('新角色不存在 → ROLE_NOT_FOUND', () => {
    const r = validateTransferInput(baseInput, { ...okDeps, newRoleExists: false });
    expect(r).toEqual({ ok: false, errorCode: 'ROLE_NOT_FOUND' });
  });

  it('旧角色不存在 → ROLE_NOT_FOUND', () => {
    const r = validateTransferInput(baseInput, { ...okDeps, oldRoleExists: false });
    expect(r).toEqual({ ok: false, errorCode: 'ROLE_NOT_FOUND' });
  });

  it('旧角色 builtin → ROLE_BUILTIN_FORBIDDEN', () => {
    const r = validateTransferInput(baseInput, { ...okDeps, oldRoleBuiltin: true });
    expect(r).toEqual({ ok: false, errorCode: 'ROLE_BUILTIN_FORBIDDEN' });
  });

  it('oldRoleId===newRoleId → TRANSFER_SAME_ROLE', () => {
    const r = validateTransferInput(
      { ...baseInput, newRoleId: OLD_ROLE_ID },
      { ...okDeps, userHasOldRole: true },
    );
    expect(r).toEqual({ ok: false, errorCode: 'TRANSFER_SAME_ROLE' });
  });

  it('用户未分配 oldRole → TRANSFER_OLD_ROLE_NOT_ASSIGNED', () => {
    const r = validateTransferInput(baseInput, { ...okDeps, userHasOldRole: false });
    expect(r).toEqual({ ok: false, errorCode: 'TRANSFER_OLD_ROLE_NOT_ASSIGNED' });
  });

  it('全部通过 → {ok:true}', () => {
    const r = validateTransferInput(baseInput, okDeps);
    expect(r).toEqual({ ok: true });
  });
});

// ===========================================================
// 2. 契约 · transferInputSchema 入参校验（4 用例）
// ===========================================================
describe('契约 · transferInputSchema safeParse', () => {
  it('缺字段 → 失败', () => {
    const r = transferInputSchema.safeParse({ userId: USER_ID });
    expect(r.success).toBe(false);
  });

  it('非 uuid → 失败', () => {
    const r = transferInputSchema.safeParse({
      userId: 'not-a-uuid',
      toDepartmentId: TO_DEPT_ID,
      oldRoleId: OLD_ROLE_ID,
      newRoleId: NEW_ROLE_ID,
    });
    expect(r.success).toBe(false);
  });

  it('oldRoleId===newRoleId → 失败（superRefine TRANSFER_SAME_ROLE）', () => {
    const r = transferInputSchema.safeParse({
      userId: USER_ID,
      toDepartmentId: TO_DEPT_ID,
      oldRoleId: OLD_ROLE_ID,
      newRoleId: OLD_ROLE_ID,
    });
    expect(r.success).toBe(false);
  });

  it('合法入参 → 成功', () => {
    const r = transferInputSchema.safeParse({
      userId: USER_ID,
      toDepartmentId: TO_DEPT_ID,
      oldRoleId: OLD_ROLE_ID,
      newRoleId: NEW_ROLE_ID,
    });
    expect(r.success).toBe(true);
  });
});

// ===========================================================
// 3. service · transfer 成功路径（2 用例）
// ===========================================================
describe('service · transfer 成功路径', () => {
  it('正常调岗：三步成功 → 返回 WriteResult，部门变更 + 角色变更', async () => {
    const { userRepo, roleRepo, transferService } = setup();
    const input = makeInput();
    const result = await transferService.transfer(input, adminCtx);
    // 返回 WriteResult 形状
    expect(result).toHaveProperty('entity');
    expect(result).toHaveProperty('changes');
    expect(result).toHaveProperty('before');
    // entity 部门已改
    expect(result.entity.department_id).toBe(TO_DEPT_ID);
    // before 含 department_id=fromDept + role_id=oldRole（虚拟字段）
    expect(fieldValue(result.before ?? [], 'department_id')).toBe(FROM_DEPT_ID);
    expect(fieldValue(result.before ?? [], 'role_id')).toBe(OLD_ROLE_ID);
    // changes（after）含 department_id=toDept + role_id=newRole
    expect(fieldValue(result.changes, 'department_id')).toBe(TO_DEPT_ID);
    expect(fieldValue(result.changes, 'role_id')).toBe(NEW_ROLE_ID);
    // 存储态：userRepo 中 user.department_id 已改为 toDept
    expect(userRepo.findById(USER_ID)?.department_id).toBe(TO_DEPT_ID);
    // 存储态：roleRepo 中 oldRole 已移除、newRole 已分配
    const roles = roleRepo.findUserRolesByUser(USER_ID);
    const roleIds = roles.map((r) => r.role_id);
    expect(roleIds).not.toContain(OLD_ROLE_ID);
    expect(roleIds).toContain(NEW_ROLE_ID);
  });

  it('非 admin 调用 → 抛 FORBIDDEN', async () => {
    const { transferService } = setup();
    const input = makeInput();
    await expect(transferService.transfer(input, userCtx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

// ===========================================================
// 4. service · transfer 校验失败路径（7 用例，断言无写入）
// ===========================================================
describe('service · transfer 校验失败（前置校验，不产生写入）', () => {
  it('用户不存在 → USER_NOT_FOUND，无写入', async () => {
    const { userRepo, roleRepo, transferService } = setup();
    const input = makeInput({ userId: '00000000-0000-4000-8000-000000000099' });
    await expect(transferService.transfer(input, adminCtx)).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
    // 无写入：部门不变 + 角色不变
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
    expect(roleRepo.findUserRolesByUser(USER_ID).map((r) => r.role_id)).toEqual([OLD_ROLE_ID]);
  });

  it('用户已禁用 → USER_ALREADY_DISABLED，无写入', async () => {
    const { userRepo, transferService } = setup();
    // 禁用用户
    userRepo.updateStatus(USER_ID, 'disabled', SEED_TS);
    const input = makeInput();
    await expect(transferService.transfer(input, adminCtx)).rejects.toMatchObject({
      code: 'USER_ALREADY_DISABLED',
    });
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
  });

  it('目标部门不存在 → DEPT_NOT_FOUND，无写入', async () => {
    const { userRepo, transferService } = setup();
    const input = makeInput({ toDepartmentId: '00000000-0000-4000-8000-000000000099' });
    await expect(transferService.transfer(input, adminCtx)).rejects.toMatchObject({
      code: 'DEPT_NOT_FOUND',
    });
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
  });

  it('新角色不存在 → ROLE_NOT_FOUND，无写入', async () => {
    const { userRepo, transferService } = setup();
    const input = makeInput({ newRoleId: '00000000-0000-4000-8000-000000000099' });
    await expect(transferService.transfer(input, adminCtx)).rejects.toMatchObject({
      code: 'ROLE_NOT_FOUND',
    });
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
  });

  it('旧角色不存在 → ROLE_NOT_FOUND，无写入', async () => {
    const { userRepo, transferService } = setup();
    const input = makeInput({ oldRoleId: '00000000-0000-4000-8000-000000000099' });
    await expect(transferService.transfer(input, adminCtx)).rejects.toMatchObject({
      code: 'ROLE_NOT_FOUND',
    });
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
  });

  it('旧角色 builtin → ROLE_BUILTIN_FORBIDDEN，无写入', async () => {
    const { userRepo, roleRepo, transferService } = setup();
    // 把 oldRole 改为 builtin（先删再插，因为 insert 是 set 语义）
    roleRepo.delete(OLD_ROLE_ID);
    roleRepo.insert({
      id: OLD_ROLE_ID,
    name: 'admin-builtin',
    description: 'builtin',
    permission_codes: ['user:read'],
    is_builtin: true,
    version: 0,
    parent_role_id: null, // ②类同步（TECH-ROLE-INHERITANCE-001 §8.2）
    created_at: SEED_TS,
  });
    const input = makeInput();
    await expect(transferService.transfer(input, adminCtx)).rejects.toMatchObject({
      code: 'ROLE_BUILTIN_FORBIDDEN',
    });
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
  });

  it('用户未分配 oldRole → TRANSFER_OLD_ROLE_NOT_ASSIGNED，无写入', async () => {
    const { userRepo, roleRepo, transferService } = setup();
    // 移除 userRole，使用户未分配 oldRole
    roleRepo.deleteUserRole(USER_ID, OLD_ROLE_ID);
    const input = makeInput();
    await expect(transferService.transfer(input, adminCtx)).rejects.toMatchObject({
      code: 'TRANSFER_OLD_ROLE_NOT_ASSIGNED',
    });
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
  });
});

// ===========================================================
// 5. service · transfer 执行失败回滚（3 用例）
// ===========================================================

/**
 * ThrowingRoleService（F2 用）：extends RoleService，按 failStep 在 remove/assign 抛错。
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
 * ThrowingUserRepo（F2-3 用）：updateDepartmentId 第二次调用（补偿时）抛错。
 */
class ThrowingUserRepo extends UserRepository {
  private callCount = 0;
  updateDepartmentId(
    userId: string,
    departmentId: string | null,
    updatedAt: string,
  ): UserEntity | undefined {
    this.callCount++;
    if (this.callCount === 2) {
      throw new Error('mock compensation failure (updateDepartmentId 2nd call)');
    }
    return super.updateDepartmentId(userId, departmentId, updatedAt);
  }
}

describe('service · transfer 执行失败回滚（补偿闭包逆序执行）', () => {
  it('步骤 B 失败 → 补偿 A：用户部门恢复 fromDept，oldRole 仍在（未成功移除）', async () => {
    const db = createTestDb();
    const userRepo = new UserRepository(db);
    const roleRepo = new RoleRepository(db);
    const deptRepo = new DepartmentRepository(db);
    seed(userRepo, roleRepo, deptRepo);
    const throwingRoleService = new ThrowingRoleService(roleRepo, userRepo, 'remove');
    const userService = new UserService(userRepo);
    const deptService = new DepartmentService(deptRepo, userRepo);
    const transferService = new TransferService(userService, deptService, throwingRoleService, userRepo, roleRepo, deptRepo, db);

    const input = makeInput();
    await expect(transferService.transfer(input, adminCtx)).rejects.toMatchObject({
      code: 'TRANSFER_FAILED',
    });
    // 步骤 A 补偿：用户部门恢复 fromDept
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
    // 步骤 B 未成功：oldRole 仍在
    const roleIds = roleRepo.findUserRolesByUser(USER_ID).map((r) => r.role_id);
    expect(roleIds).toContain(OLD_ROLE_ID);
    expect(roleIds).not.toContain(NEW_ROLE_ID);
  });

  it('步骤 C 失败 → 补偿 B+A：用户部门恢复 fromDept，oldRole 重新分配，newRole 未分配', async () => {
    const db = createTestDb();
    const userRepo = new UserRepository(db);
    const roleRepo = new RoleRepository(db);
    const deptRepo = new DepartmentRepository(db);
    seed(userRepo, roleRepo, deptRepo);
    const throwingRoleService = new ThrowingRoleService(roleRepo, userRepo, 'assign');
    const userService = new UserService(userRepo);
    const deptService = new DepartmentService(deptRepo, userRepo);
    const transferService = new TransferService(userService, deptService, throwingRoleService, userRepo, roleRepo, deptRepo, db);

    const input = makeInput();
    await expect(transferService.transfer(input, adminCtx)).rejects.toMatchObject({
      code: 'TRANSFER_FAILED',
    });
    // 补偿 A：用户部门恢复 fromDept
    expect(userRepo.findById(USER_ID)?.department_id).toBe(FROM_DEPT_ID);
    // 补偿 B：oldRole 重新分配
    const roleIds = roleRepo.findUserRolesByUser(USER_ID).map((r) => r.role_id);
    expect(roleIds).toContain(OLD_ROLE_ID);
    // 步骤 C 未成功：newRole 未分配
    expect(roleIds).not.toContain(NEW_ROLE_ID);
  });

  it('补偿失败 → TRANSFER_COMPENSATION_FAILED（非静默吞）', async () => {
    const db = createTestDb();
    const throwingUserRepo = new ThrowingUserRepo(db);
    const roleRepo = new RoleRepository(db);
    const deptRepo = new DepartmentRepository(db);
    seed(throwingUserRepo, roleRepo, deptRepo);
    const throwingRoleService = new ThrowingRoleService(roleRepo, throwingUserRepo, 'remove');
    const userService = new UserService(throwingUserRepo);
    const deptService = new DepartmentService(deptRepo, throwingUserRepo);
    const transferService = new TransferService(
      userService,
      deptService,
      throwingRoleService,
      throwingUserRepo,
      roleRepo,
      deptRepo,
      db,
    );

    const input = makeInput();
    await expect(transferService.transfer(input, adminCtx)).rejects.toMatchObject({
      code: 'TRANSFER_COMPENSATION_FAILED',
    });
  });
});
