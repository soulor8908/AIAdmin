// apps/api/test/role-inheritance-embedding.test.ts —— AI-007 端到端验收测试（PRD-ROLE-INHERITANCE-001 F1/F2/F3/F4）
//
// 背景（R8 · TECH-ROLE-INHERITANCE-001 §9）：权限继承的"有效权限码集合计算"是跨层行为
// （service 递归遍历 + repository 状态 + 权限并集聚合），无法由单层断言覆盖；环检测涉及
// 多角色状态联动；删除守卫 B8 涉及子角色引用跨层观测。须端到端验收（注入共享 roleRepo 观测继承链结构）。
//
// 注入方案（AI-007 关键 —— 注入共享依赖观测旁路副作用）：
//   - 共享 RoleRepository + UserRepository + AuditLogRepository：
//     RoleService 注入的 roleRepo 与可观测 roleRepo 同一实例；
//     createRoleRouter 注入的 auditService 与 auditRepo 同源（→ 同一 auditRepo）。
//   - setParent 成功 → withAudit 旁路写一条审计日志（entity_type=role/action=update），
//     本文件据 auditRepo.listAll() 读存储态日志断言。
//   - setParent 校验失败（环/自继承/内置约束）→ withAudit 不调 audit.record → auditRepo 无日志（无幽灵日志）。
//   - getEffectivePermissions 递归聚合 → 直接查共享 roleRepo.findById 观测继承链结构。
//
// 覆盖 PRD-ROLE-INHERITANCE-001 验收标准（§F1-F4 Given/When/Then）：
//   F1: AC-F1-1~F1-9 设置/解除继承关系（9 条）
//   F2: AC-F2-1~F2-4 查询继承链（4 条）
//   F3: AC-F3-1~F3-7 计算有效权限码集合（7 条）
//   F4: AC-F4-1~F4-3 删除守卫扩展（3 条）
import { describe, it, expect } from 'vitest';
import {
  type Role,
  type PermissionCode,
  type AuditLog,
  type AuditLogEntityType,
  type AuditLogAction,
  type ChangeField,
} from '@admin/contracts';
import { RoleRepository } from '../src/repository/role.js';
import { UserRepository } from '../src/repository/user.js';
import { AuditLogRepository } from '../src/repository/audit.js';
import { AuditLogService } from '../src/service/audit.js';
import { RoleService } from '../src/service/role.js';
import { createRoleRouter } from '../src/router/role.js';
import { AppError } from '../src/errors.js';
import type { Ctx } from '../src/context.js';
import type { Procedure } from '../src/router/user.js';
import { createTestDb } from './helpers/db.js';

const ADMIN_ID = 'admin-00000000-0000-4000-8000-000000000099';
const SEED_TS = '2020-01-01T00:00:00.000Z';

// [test-writer 缺陷修复] makeRole / seedUser 原用 ROLE_A_ID/USER_U1_ID 等非 uuid 友好 id，
// service 层调用通过（service 接受 string），但 router 层 procedure safeParse 要求 uuid。
// 统一改为 uuid 格式 id，使 router 层端到端测试（withAudit 审计日志落库）可通过 schema 校验。
const ROLE_A_ID = '00000000-0000-4000-8000-0000000000a1';
const ROLE_B_ID = '00000000-0000-4000-8000-0000000000b2';
const ROLE_C_ID = '00000000-0000-4000-8000-0000000000c3';
const ROLE_D_ID = '00000000-0000-4000-8000-0000000000d4';
const ROLE_E_ID = '00000000-0000-4000-8000-0000000000e5';
const USER_U1_ID = '00000000-0000-4000-8000-000000000011';

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

/** 按 entity_type + entity_id + action 在 auditRepo 中查找最近一条匹配日志。 */
function findLog(
  repo: AuditLogRepository,
  match: { entityType?: AuditLogEntityType; entityId?: string; action?: AuditLogAction },
): AuditLog | undefined {
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

/** 构造非内置 Role（含 parent_role_id: null，②类同步）。 */
function makeRole(
  id: string,
  overrides: Partial<Role> = {},
): Role {
  return {
    id,
    name: `role-${id}`,
    description: `desc-${id}`,
    permission_codes: ['user:read'],
    is_builtin: false,
    parent_role_id: null,
    created_at: SEED_TS,
    version: 0,
    ...overrides,
  };
}

// --- 共享依赖 setup ---

/**
 * 端到端 setup：创建共享 roleRepo/userRepo/auditRepo + 共享 auditService，
 * 注入 RoleService + createRoleRouter（共享 auditService 聚合日志）。
 * 关键（AI-007）：RoleService 注入的 roleRepo 与可观测 roleRepo 同一实例；
 * createRoleRouter 注入的 auditService 与 auditRepo 同源。
 */
function setupShared(): {
  roleRepo: RoleRepository;
  userRepo: UserRepository;
  auditRepo: AuditLogRepository;
  auditService: AuditLogService;
  service: RoleService;
  router: ReturnType<typeof createRoleRouter>;
} {
  // 多 repo 共享同一 db（RoleService 跨 role/user repo 查询，getEffectivePermissions 联查 user_roles；审计埋点写入同一 auditRepo）
  const db = createTestDb();
  const roleRepo = new RoleRepository(db);
  const userRepo = new UserRepository(db);
  const auditRepo = new AuditLogRepository(db);
  const auditService = new AuditLogService(auditRepo);
  userRepo.insert({
    id: ADMIN_ID,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 0,
    password_hash: 'test-hash-placeholder',
  });
  const service = new RoleService(roleRepo, userRepo);
  const router = createRoleRouter(service, auditService);
  return { roleRepo, userRepo, auditRepo, auditService, service, router };
}

function builtinAdminId(repo: RoleRepository): string {
  const admin = repo.findByName('admin');
  if (!admin) throw new Error('test setup: expected builtin admin role to be seeded');
  return admin.id;
}

// ===========================================================================
// F1 端到端 · 设置/解除继承关系（AC-F1-1~F1-9）
// ===========================================================================
describe('F1 端到端 · 设置/解除继承关系', () => {
  it('AC-F1-1 §正常设置继承 → B.parent_role_id=A + 审计日志 before=[null] after=[A]', async () => {
    const { roleRepo, auditRepo, service, router } = setupShared();
    const A = makeRole(ROLE_A_ID, { permission_codes: ['role:read'] });
    const B = makeRole(ROLE_B_ID, { permission_codes: ['user:read'] });
    roleRepo.insert(A);
    roleRepo.insert(B);
    const beforeTotal = auditRepo.listAll().length;
    // WHEN 设置 B.parent=A（经 router.setParent 触发 withAudit 旁路记审计日志）
    const result = await callProc(router.setParent, { roleId: ROLE_B_ID, parentRoleId: ROLE_A_ID, expected_version: 0 }, adminCtx);
    // THEN ① roleRepo 中 B.parent_role_id === A
    expect(roleRepo.findById(B.id)?.parent_role_id).toBe(A.id);
    // THEN ② 审计日志新增 1 条 entity_type=role/action=update
    const logs = auditRepo.listAll();
    expect(logs.length).toBe(beforeTotal + 1);
    const log = findLog(auditRepo, { entityType: 'role', entityId: B.id, action: 'update' });
    expect(log).toBeDefined();
    // THEN ③ before/after 含 parent_role_id 虚拟字段
    expect(fieldValue(log!.before, 'parent_role_id')).toBeNull();
    expect(fieldValue(log!.after, 'parent_role_id')).toBe(A.id);
  });

  it('AC-F1-2 §解除继承 → B.parent_role_id=null + before=[A] after=[null]', async () => {
    const { roleRepo, auditRepo, service, router } = setupShared();
    const A = makeRole(ROLE_A_ID);
    const B = makeRole(ROLE_B_ID);
    roleRepo.insert(A);
    roleRepo.insert(B);
    await service.setParent(B.id, A.id, 0, adminCtx);
    const beforeTotal = auditRepo.listAll().length;
    // WHEN 解除 B 的继承（经 router.unsetParent 触发 withAudit 旁路记审计日志）
    const result = await callProc(router.unsetParent, { roleId: B.id, expected_version: 1 }, adminCtx);
    // THEN B.parent_role_id === null
    expect(roleRepo.findById(B.id)?.parent_role_id).toBeNull();
    // THEN 审计日志新增 1 条
    const log = findLog(auditRepo, { entityType: 'role', entityId: B.id, action: 'update' });
    expect(log).toBeDefined();
    expect(fieldValue(log!.before, 'parent_role_id')).toBe(A.id);
    expect(fieldValue(log!.after, 'parent_role_id')).toBeNull();
  });

  it('AC-F1-3 §父角色不存在 → ROLE_NOT_FOUND（不修改任何角色、无审计日志）', async () => {
    const { roleRepo, auditRepo, service } = setupShared();
    const B = makeRole(ROLE_B_ID);
    roleRepo.insert(B);
    const beforeTotal = auditRepo.listAll().length;
    await expect(service.setParent(B.id, 'missing-id-00000000-0000-4000-8000-000000000099', 0, adminCtx))
      .rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
    expect(roleRepo.findById(B.id)?.parent_role_id).toBeNull();
    expect(auditRepo.listAll().length).toBe(beforeTotal); // 无幽灵日志
  });

  it('AC-F1-4 §自继承 → ROLE_SELF_INHERITANCE（不修改任何角色、无审计日志）', async () => {
    const { roleRepo, auditRepo, service } = setupShared();
    const B = makeRole(ROLE_B_ID);
    roleRepo.insert(B);
    const beforeTotal = auditRepo.listAll().length;
    await expect(service.setParent(B.id, B.id, 0, adminCtx))
      .rejects.toMatchObject({ code: 'ROLE_SELF_INHERITANCE' });
    expect(roleRepo.findById(B.id)?.parent_role_id).toBeNull();
    expect(auditRepo.listAll().length).toBe(beforeTotal);
  });

  it('AC-F1-5 §父角色为内置 admin → ROLE_BUILTIN_PARENT_FORBIDDEN（不修改、无日志）', async () => {
    const { roleRepo, auditRepo, service } = setupShared();
    const adminId = builtinAdminId(roleRepo);
    const B = makeRole(ROLE_B_ID);
    roleRepo.insert(B);
    const beforeTotal = auditRepo.listAll().length;
    await expect(service.setParent(B.id, adminId, 0, adminCtx))
      .rejects.toMatchObject({ code: 'ROLE_BUILTIN_PARENT_FORBIDDEN' });
    expect(roleRepo.findById(B.id)?.parent_role_id).toBeNull();
    expect(auditRepo.listAll().length).toBe(beforeTotal);
  });

  it('AC-F1-6 §环检测 A→B→A → ROLE_INHERITANCE_CYCLE（不修改、无日志）', async () => {
    const { roleRepo, auditRepo, service } = setupShared();
    const A = makeRole(ROLE_A_ID);
    const B = makeRole(ROLE_B_ID);
    roleRepo.insert(A);
    roleRepo.insert(B);
    // 先建立 B.parent=A
    await service.setParent(B.id, A.id, 0, adminCtx);
    const beforeTotal = auditRepo.listAll().length;
    // 再设 A.parent=B → 环
    await expect(service.setParent(A.id, B.id, 0, adminCtx))
      .rejects.toMatchObject({ code: 'ROLE_INHERITANCE_CYCLE' });
    expect(roleRepo.findById(A.id)?.parent_role_id).toBeNull();
    expect(auditRepo.listAll().length).toBe(beforeTotal); // 无幽灵日志
  });

  it('AC-F1-7 §环检测三节点链 A→C→B→A → ROLE_INHERITANCE_CYCLE', async () => {
    const { roleRepo, auditRepo, service } = setupShared();
    const A = makeRole(ROLE_A_ID);
    const B = makeRole(ROLE_B_ID);
    const C = makeRole(ROLE_C_ID);
    roleRepo.insert(A);
    roleRepo.insert(B);
    roleRepo.insert(C);
    await service.setParent(B.id, A.id, 0, adminCtx); // B.parent=A
    await service.setParent(C.id, B.id, 0, adminCtx); // C.parent=B
    const beforeTotal = auditRepo.listAll().length;
    // 设 A.parent=C → 环 A→C→B→A
    await expect(service.setParent(A.id, C.id, 0, adminCtx))
      .rejects.toMatchObject({ code: 'ROLE_INHERITANCE_CYCLE' });
    expect(roleRepo.findById(A.id)?.parent_role_id).toBeNull();
    expect(auditRepo.listAll().length).toBe(beforeTotal);
  });

  it('AC-F1-8 §对内置 admin 设置继承 → ROLE_BUILTIN_FORBIDDEN', async () => {
    const { roleRepo, auditRepo, service } = setupShared();
    const adminId = builtinAdminId(roleRepo);
    const B = makeRole(ROLE_B_ID);
    roleRepo.insert(B);
    const beforeTotal = auditRepo.listAll().length;
    await expect(service.setParent(adminId, B.id, 0, adminCtx))
      .rejects.toMatchObject({ code: 'ROLE_BUILTIN_FORBIDDEN' });
    expect(auditRepo.listAll().length).toBe(beforeTotal);
  });

  it('AC-F1-9 §重新设置继承（覆盖）→ B.parent 从 A 改为 C + 审计 before=[A] after=[C]', async () => {
    const { roleRepo, auditRepo, service, router } = setupShared();
    const A = makeRole(ROLE_A_ID);
    const B = makeRole(ROLE_B_ID);
    const C = makeRole(ROLE_C_ID);
    roleRepo.insert(A);
    roleRepo.insert(B);
    roleRepo.insert(C);
    await service.setParent(B.id, A.id, 0, adminCtx);
    // 覆盖：B.parent=A → B.parent=C（经 router.setParent 触发 withAudit 旁路记审计日志）
    const result = await callProc(router.setParent, { roleId: B.id, parentRoleId: C.id, expected_version: 1 }, adminCtx);
    expect(roleRepo.findById(B.id)?.parent_role_id).toBe(C.id);
    const log = findLog(auditRepo, { entityType: 'role', entityId: B.id, action: 'update' });
    expect(log).toBeDefined();
    expect(fieldValue(log!.before, 'parent_role_id')).toBe(A.id);
    expect(fieldValue(log!.after, 'parent_role_id')).toBe(C.id);
  });
});

// ===========================================================================
// F2 端到端 · 查询继承链（AC-F2-1~F2-4）
// ===========================================================================
describe('F2 端到端 · 查询继承链', () => {
  it('AC-F2-1 §单层继承链 B.parent=A → 返回 [A]', async () => {
    const { roleRepo, service } = setupShared();
    const A = makeRole(ROLE_A_ID);
    const B = makeRole(ROLE_B_ID);
    roleRepo.insert(A);
    roleRepo.insert(B);
    await service.setParent(B.id, A.id, 0, adminCtx);
    const chain = await service.getInheritanceChain(B.id, adminCtx);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.id).toBe(A.id);
    // 端到端断言：返回的 Role 含 parent_role_id（A 是根角色，parent_role_id=null）
    expect(chain[0]?.parent_role_id).toBeNull();
  });

  it('AC-F2-2 §多层继承链 C.parent=B, B.parent=A → 返回 [B, A]', async () => {
    const { roleRepo, service } = setupShared();
    const A = makeRole(ROLE_A_ID);
    const B = makeRole(ROLE_B_ID);
    const C = makeRole(ROLE_C_ID);
    roleRepo.insert(A);
    roleRepo.insert(B);
    roleRepo.insert(C);
    await service.setParent(B.id, A.id, 0, adminCtx);
    await service.setParent(C.id, B.id, 0, adminCtx);
    const chain = await service.getInheritanceChain(C.id, adminCtx);
    expect(chain).toHaveLength(2);
    expect(chain[0]?.id).toBe(B.id);
    expect(chain[0]?.parent_role_id).toBe(A.id);
    expect(chain[1]?.id).toBe(A.id);
    expect(chain[1]?.parent_role_id).toBeNull();
  });

  it('AC-F2-3 §根角色继承链 A.parent=null → 返回 []', async () => {
    const { roleRepo, service } = setupShared();
    const A = makeRole(ROLE_A_ID);
    roleRepo.insert(A);
    const chain = await service.getInheritanceChain(A.id, adminCtx);
    expect(chain).toEqual([]);
  });

  it('AC-F2-4 §不存在的角色 → ROLE_NOT_FOUND', async () => {
    const { service } = setupShared();
    await expect(service.getInheritanceChain('missing-id-00000000-0000-4000-8000-000000000099', adminCtx))
      .rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
  });
});

// ===========================================================================
// F3 端到端 · 计算用户有效权限码集合（AC-F3-1~F3-7）
// ===========================================================================
describe('F3 端到端 · 计算用户有效权限码集合（读时聚合）', () => {
  /** seed 用户 + 分配角色。 */
  function seedUserWithRoles(
    userRepo: UserRepository,
    roleRepo: RoleRepository,
    userId: string,
    roleIds: string[],
  ): void {
    userRepo.insert({
      id: userId,
      name: `user-${userId}`,
      email: `${userId}@example.com`,
      status: 'active',
      created_at: SEED_TS,
      updated_at: SEED_TS,
      version: 0,
      password_hash: 'test-hash-placeholder',
    });
    for (let i = 0; i < roleIds.length; i++) {
      roleRepo.insertUserRole({
        id: `ur-${userId}-${i}`,
        user_id: userId,
        role_id: roleIds[i]!,
        assigned_at: SEED_TS,
      });
    }
  }

  it('AC-F3-1 §单角色无继承 → 仅直接权限', async () => {
    const { roleRepo, userRepo, service } = setupShared();
    const A = makeRole(ROLE_A_ID, { permission_codes: ['role:read', 'user:read'] });
    roleRepo.insert(A);
    seedUserWithRoles(userRepo, roleRepo, USER_U1_ID, [A.id]);
    const perms = await service.getEffectivePermissions(USER_U1_ID, adminCtx);
    expect(perms.sort()).toEqual(['role:read', 'user:read']);
  });

  it('AC-F3-2 §单角色单层继承 → B 自身 ∪ A 父角色并集', async () => {
    const { roleRepo, userRepo, service } = setupShared();
    const A = makeRole(ROLE_A_ID, { permission_codes: ['role:read', 'user:read'] });
    const B = makeRole(ROLE_B_ID, { permission_codes: ['role:write'] });
    roleRepo.insert(A);
    roleRepo.insert(B);
    await service.setParent(B.id, A.id, 0, adminCtx);
    seedUserWithRoles(userRepo, roleRepo, USER_U1_ID, [B.id]);
    const perms = await service.getEffectivePermissions(USER_U1_ID, adminCtx);
    expect(perms.sort()).toEqual(['role:read', 'role:write', 'user:read']);
  });

  it('AC-F3-3 §单角色多层继承 → C ∪ B ∪ A 递归并集', async () => {
    const { roleRepo, userRepo, service } = setupShared();
    const A = makeRole(ROLE_A_ID, { permission_codes: ['role:read', 'user:read'] });
    const B = makeRole(ROLE_B_ID, { permission_codes: ['role:write'] });
    const C = makeRole(ROLE_C_ID, { permission_codes: ['dept:read'] });
    roleRepo.insert(A);
    roleRepo.insert(B);
    roleRepo.insert(C);
    await service.setParent(B.id, A.id, 0, adminCtx);
    await service.setParent(C.id, B.id, 0, adminCtx);
    seedUserWithRoles(userRepo, roleRepo, USER_U1_ID, [C.id]);
    const perms = await service.getEffectivePermissions(USER_U1_ID, adminCtx);
    expect(perms.sort()).toEqual(['dept:read', 'role:read', 'role:write', 'user:read']);
  });

  it('AC-F3-4 §多角色继承并集 → A ∪ D ∪ E', async () => {
    const { roleRepo, userRepo, service } = setupShared();
    const A = makeRole(ROLE_A_ID, { permission_codes: ['role:read'] });
    const D = makeRole(ROLE_D_ID, { permission_codes: ['notification:read'] });
    const E = makeRole(ROLE_E_ID, { permission_codes: ['dept:write'] });
    roleRepo.insert(A);
    roleRepo.insert(D);
    roleRepo.insert(E);
    await service.setParent(D.id, E.id, 0, adminCtx);
    seedUserWithRoles(userRepo, roleRepo, USER_U1_ID, [A.id, D.id]);
    const perms = await service.getEffectivePermissions(USER_U1_ID, adminCtx);
    expect(perms.sort()).toEqual(['dept:write', 'notification:read', 'role:read']);
  });

  it('AC-F3-5 §继承关系变更后权限自动更新（读时聚合验证）', async () => {
    const { roleRepo, userRepo, service } = setupShared();
    const A = makeRole(ROLE_A_ID, { permission_codes: ['role:read'] });
    const B = makeRole(ROLE_B_ID, { permission_codes: ['role:write'] });
    roleRepo.insert(A);
    roleRepo.insert(B);
    seedUserWithRoles(userRepo, roleRepo, USER_U1_ID, [B.id]);
    // 变更前：B 无父角色，有效权限=[role:write]
    const before = await service.getEffectivePermissions(USER_U1_ID, adminCtx);
    expect(before.sort()).toEqual(['role:write']);
    // 设置 B.parent=A（继承关系变更）
    await service.setParent(B.id, A.id, 0, adminCtx);
    // 变更后：B ∪ A = [role:write, role:read]（读时聚合自动反映新继承链）
    const after = await service.getEffectivePermissions(USER_U1_ID, adminCtx);
    expect(after.sort()).toEqual(['role:read', 'role:write']);
  });

  it('AC-F3-6 §用户不存在 → USER_NOT_FOUND', async () => {
    const { service } = setupShared();
    await expect(service.getEffectivePermissions('missing-id-00000000-0000-4000-8000-000000000099', adminCtx))
      .rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('AC-F3-7 §用户无角色 → 返回空数组', async () => {
    const { userRepo, service } = setupShared();
    userRepo.insert({
      id: USER_U1_ID, name: 'u', email: 'u@e.com', status: 'active', created_at: SEED_TS, updated_at: SEED_TS, version: 0, password_hash: 'test-hash-placeholder',
    });
    const perms = await service.getEffectivePermissions(USER_U1_ID, adminCtx);
    expect(perms).toEqual([]);
  });
});

// ===========================================================================
// F4 端到端 · 删除守卫扩展（AC-F4-1~F4-3）
// ===========================================================================
describe('F4 端到端 · 删除守卫 B8 ROLE_HAS_CHILDREN', () => {
  it('AC-F4-1 §删除有子角色的角色 → ROLE_HAS_CHILDREN（不删除、无日志）', async () => {
    const { roleRepo, auditRepo, service } = setupShared();
    const A = makeRole(ROLE_A_ID);
    const B = makeRole(ROLE_B_ID);
    roleRepo.insert(A);
    roleRepo.insert(B);
    await service.setParent(B.id, A.id, 0, adminCtx);
    const beforeTotal = auditRepo.listAll().length;
    // WHEN 删除 A（有子角色 B）
    await expect(service.delete(A.id, 0, adminCtx)).rejects.toMatchObject({ code: 'ROLE_HAS_CHILDREN' });
    // THEN A 仍存在
    expect(roleRepo.findById(A.id)).toBeDefined();
    // THEN 无删除日志（无幽灵日志）
    expect(auditRepo.listAll().length).toBe(beforeTotal);
  });

  it('AC-F4-2 §删除无子角色的角色 → 成功 + 删除日志', async () => {
    const { roleRepo, auditRepo, service, router } = setupShared();
    const A = makeRole(ROLE_A_ID);
    roleRepo.insert(A);
    const beforeTotal = auditRepo.listAll().length;
    // WHEN 删除 A（无子角色，经 router.delete 触发 withAudit 旁路记审计日志）
    await callProc(router.delete, { id: ROLE_A_ID, expected_version: 0 }, adminCtx);
    // THEN A 不存在
    expect(roleRepo.findById(A.id)).toBeUndefined();
    // THEN 删除日志新增 1 条
    const logs = auditRepo.listAll();
    expect(logs.length).toBe(beforeTotal + 1);
    const log = findLog(auditRepo, { entityType: 'role', entityId: A.id, action: 'delete' });
    expect(log).toBeDefined();
  });

  it('AC-F4-3 §解除子角色继承后可删除', async () => {
    const { roleRepo, service } = setupShared();
    const A = makeRole(ROLE_A_ID);
    const B = makeRole(ROLE_B_ID);
    roleRepo.insert(A);
    roleRepo.insert(B);
    await service.setParent(B.id, A.id, 0, adminCtx);
    // WHEN 解除 B 的继承 + 删除 A
    await service.unsetParent(B.id, 1, adminCtx);
    await service.delete(A.id, 0, adminCtx);
    // THEN 删除成功
    expect(roleRepo.findById(A.id)).toBeUndefined();
    // B 仍存在，parent_role_id 恢复 null
    expect(roleRepo.findById(B.id)?.parent_role_id).toBeNull();
  });
});

// ===========================================================================
// 端到端 · router 层 withAudit 包装验证
// ===========================================================================
describe('端到端 · router 层 setParent withAudit 包装', () => {
  it('setParent 经 router 调用成功 → 审计日志落库（entity_type=role/action=update）', async () => {
    const { roleRepo, auditRepo, router } = setupShared();
    const A = makeRole(ROLE_A_ID);
    const B = makeRole(ROLE_B_ID);
    roleRepo.insert(A);
    roleRepo.insert(B);
    // 经 router.setParent 调用（withAudit 包装）
    await callProc(router.setParent, { roleId: B.id, parentRoleId: A.id, expected_version: 0 }, adminCtx);
    // 审计日志落库
    const log = findLog(auditRepo, { entityType: 'role', entityId: B.id, action: 'update' });
    expect(log).toBeDefined();
    expect(roleRepo.findById(B.id)?.parent_role_id).toBe(A.id);
  });

  it('setParent 经 router 调用校验失败 → 无幽灵日志', async () => {
    const { roleRepo, auditRepo, router } = setupShared();
    const B = makeRole(ROLE_B_ID);
    roleRepo.insert(B);
    const beforeTotal = auditRepo.listAll().length;
    // 自继承 → schema superRefine 在 router 入口先拦截（service 层 ROLE_SELF_INHERITANCE 不会执行）
    await expect(callProc(router.setParent, { roleId: B.id, parentRoleId: B.id, expected_version: 0 }, adminCtx))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(auditRepo.listAll().length).toBe(beforeTotal); // 无幽灵日志
  });

  it('getEffectivePermissions 经 router 调用（读，不经 withAudit）→ 无审计日志', async () => {
    const { roleRepo, userRepo, auditRepo, router } = setupShared();
    const A = makeRole(ROLE_A_ID, { permission_codes: ['user:read'] });
    roleRepo.insert(A);
    userRepo.insert({
      id: USER_U1_ID, name: 'u', email: 'u@e.com', status: 'active', created_at: SEED_TS, updated_at: SEED_TS, version: 0, password_hash: 'test-hash-placeholder',
    });
    roleRepo.insertUserRole({ id: 'ur1', user_id: USER_U1_ID, role_id: A.id, assigned_at: SEED_TS });
    const beforeTotal = auditRepo.listAll().length;
    const perms = await callProc(router.getEffectivePermissions, { userId: USER_U1_ID }, adminCtx);
    expect(perms).toEqual(['user:read']);
    expect(auditRepo.listAll().length).toBe(beforeTotal); // 读操作不埋点
  });
});
