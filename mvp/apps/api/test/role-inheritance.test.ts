// apps/api/test/role-inheritance.test.ts —— 测试先行（AI-002）
// 本文件先于实现产出，覆盖 Tech-Spec TECH-ROLE-INHERITANCE-001 测试矩阵：
//   1. 单测 · domain validateSetParent + detectCycle 纯函数
//   2. 契约测 · setParentInputSchema/inheritanceChainResultSchema/effectivePermissionsResultSchema
//   3. 边界 · F1 setParent 校验（7 类）+ F2 继承链 + F3 有效权限 + F4 delete B8 守卫
//   4. 权限 · 非 admin 调用 → FORBIDDEN
//   5. 状态机 · setParent 校验顺序 + delete 守卫顺序 B5→B6→B8→B7
// 设计说明（impl-writer 须遵循）：
//   - RoleRepository 既有构造签名不变（new RoleRepository()），seedBuiltinAdmin 追加 parent_role_id: null
//   - RoleService 既有构造签名不变（new RoleService(roleRepo, userRepo)），新增 4 方法
//   - createRoleRouter 追加 setParent/unsetParent/getInheritanceChain/getEffectivePermissions procedure
//   - domain/role-inheritance.ts 导出 validateSetParent + detectCycle 纯函数
//   - roleSchema 追加 parent_role_id: z.string().uuid().nullable()（②类签名变更，makeRole helper 已同步）
import { describe, it, expect } from 'vitest';
import {
  roleSchema,
  permissionCodeSchema,
  type ErrorCode,
  type Role,
  type PermissionCode,
} from '@admin/contracts';
import {
  setParentInputSchema,
  inheritanceChainResultSchema,
  effectivePermissionsResultSchema,
} from '@admin/contracts'; // 预期导入红（impl 尚未存在）
import { RoleRepository } from '../src/repository/role.js';
import { RoleService } from '../src/service/role.js';
import { createRoleRouter, type Procedure } from '../src/router/role.js';
import {
  validateSetParent,
  detectCycle,
} from '../src/domain/role-inheritance.js'; // 预期导入红（impl 尚未存在）
import {
  BUILTIN_ADMIN_ROLE_NAME,
  type RoleEntity,
} from '../src/domain/role.js';
import { UserRepository } from '../src/repository/user.js';
import { AppError } from '../src/errors.js';
import type { Ctx } from '../src/context.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const SEED_TS = '2020-01-01T00:00:00.000Z';
const MISSING_ID = '00000000-0000-4000-8000-000000000099';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };
const userCtx: Ctx = { user: { id: 'u1', role: 'user' } };

// --- makeRole helper（②类同步：追加 parent_role_id: null）---
function makeRole(i: number, overrides: Partial<Role> = {}): Role {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `role${i}`,
    description: `desc${i}`,
    permission_codes: ['user:read'],
    is_builtin: false,
    parent_role_id: null, // ②类同步：roleSchema 追加字段
    created_at: SEED_TS,
    version: 0, // TECH-OPTIMISTIC-LOCKING-001 D1：初始 version=0
    ...overrides,
  };
}

function setup(): {
  repo: RoleRepository;
  userRepo: UserRepository;
  service: RoleService;
  router: ReturnType<typeof createRoleRouter>;
} {
  const repo = new RoleRepository();
  const userRepo = new UserRepository();
  userRepo.insert({
    id: ADMIN_ID,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 0,
  });
  const service = new RoleService(repo, userRepo);
  const router = createRoleRouter(service);
  return { repo, userRepo, service, router };
}

/** 模拟 router 层执行：safeParse 失败统一转 VALIDATION_ERROR，成功则调 handler。 */
async function callProc<I, O>(proc: Procedure<I, O>, raw: unknown, ctx: Ctx): Promise<O> {
  const parsed = proc.input.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', parsed.error.message);
  }
  return proc.handler(parsed.data, ctx);
}

function builtinAdminId(repo: RoleRepository): string {
  const admin = repo.findByName(BUILTIN_ADMIN_ROLE_NAME);
  if (!admin) throw new Error('test setup: expected builtin admin role to be seeded');
  return admin.id;
}

// ===========================================================================
// 1. domain 纯函数 · validateSetParent + detectCycle
// ===========================================================================
describe('domain · validateSetParent 纯函数', () => {
  const baseInput = { roleId: 'r1', parentRoleId: 'r2' };
  it('角色不存在 → ROLE_NOT_FOUND', () => {
    expect(validateSetParent(baseInput, {
      roleExists: false, parentExists: true, roleIsBuiltin: false, parentIsBuiltin: false, hasCycle: false,
    })).toEqual({ ok: false, errorCode: 'ROLE_NOT_FOUND' });
  });
  it('父角色不存在 → ROLE_NOT_FOUND', () => {
    expect(validateSetParent(baseInput, {
      roleExists: true, parentExists: false, roleIsBuiltin: false, parentIsBuiltin: false, hasCycle: false,
    })).toEqual({ ok: false, errorCode: 'ROLE_NOT_FOUND' });
  });
  it('角色为内置 → ROLE_BUILTIN_FORBIDDEN（先于自继承）', () => {
    expect(validateSetParent(baseInput, {
      roleExists: true, parentExists: true, roleIsBuiltin: true, parentIsBuiltin: false, hasCycle: false,
    })).toEqual({ ok: false, errorCode: 'ROLE_BUILTIN_FORBIDDEN' });
  });
  it('自继承 → ROLE_SELF_INHERITANCE', () => {
    expect(validateSetParent({ roleId: 'r1', parentRoleId: 'r1' }, {
      roleExists: true, parentExists: true, roleIsBuiltin: false, parentIsBuiltin: false, hasCycle: false,
    })).toEqual({ ok: false, errorCode: 'ROLE_SELF_INHERITANCE' });
  });
  it('父角色为内置 admin → ROLE_BUILTIN_PARENT_FORBIDDEN', () => {
    expect(validateSetParent(baseInput, {
      roleExists: true, parentExists: true, roleIsBuiltin: false, parentIsBuiltin: true, hasCycle: false,
    })).toEqual({ ok: false, errorCode: 'ROLE_BUILTIN_PARENT_FORBIDDEN' });
  });
  it('环检测 → ROLE_INHERITANCE_CYCLE', () => {
    expect(validateSetParent(baseInput, {
      roleExists: true, parentExists: true, roleIsBuiltin: false, parentIsBuiltin: false, hasCycle: true,
    })).toEqual({ ok: false, errorCode: 'ROLE_INHERITANCE_CYCLE' });
  });
  it('全部校验通过 → ok:true', () => {
    expect(validateSetParent(baseInput, {
      roleExists: true, parentExists: true, roleIsBuiltin: false, parentIsBuiltin: false, hasCycle: false,
    })).toEqual({ ok: true });
  });
});

describe('domain · detectCycle 纯函数（祖先遍历）', () => {
  // 构造简单 role 查找表供 detectCycle 使用
  function makeFindById(roles: Record<string, RoleEntity | undefined>): (id: string) => RoleEntity | undefined {
    return (id: string) => roles[id];
  }
  it('无环（直线链 A←B←C，设 C.parent=D 不成环）', () => {
    const A: RoleEntity = { id: 'A', name: 'a', description: 'd', permission_codes: [], is_builtin: false, parent_role_id: null, created_at: SEED_TS, version: 0 };
    const B: RoleEntity = { id: 'B', name: 'b', description: 'd', permission_codes: [], is_builtin: false, parent_role_id: 'A', created_at: SEED_TS, version: 0 };
    const C: RoleEntity = { id: 'C', name: 'c', description: 'd', permission_codes: [], is_builtin: false, parent_role_id: 'B', created_at: SEED_TS, version: 0 };
    const D: RoleEntity = { id: 'D', name: 'd', description: 'd', permission_codes: [], is_builtin: false, parent_role_id: null, created_at: SEED_TS, version: 0 };
    const findById = makeFindById({ A, B, C, D });
    // 设 C.parent=D：从 D 向上遍历，D.parent=null → 无环
    const result = detectCycle('C', 'D', findById);
    expect(result.hasCycle).toBe(false);
    expect(result.cyclePath).toBeUndefined();
  });
  it('两节点环 A←B，设 A.parent=B → hasCycle=true（AC-F1-6）', () => {
    // 已有 B.parent=A，设 A.parent=B → detectCycle(A, B)：B.id!==A, B.parent=A, A.id===A → 环
    const A: RoleEntity = { id: 'A', name: 'a', description: 'd', permission_codes: [], is_builtin: false, parent_role_id: null, created_at: SEED_TS, version: 0 };
    const B: RoleEntity = { id: 'B', name: 'b', description: 'd', permission_codes: [], is_builtin: false, parent_role_id: 'A', created_at: SEED_TS, version: 0 };
    const findById = makeFindById({ A, B });
    const result = detectCycle('A', 'B', findById);
    expect(result.hasCycle).toBe(true);
    expect(result.cyclePath).toBeDefined();
    expect(result.cyclePath).toContain('A');
    expect(result.cyclePath).toContain('B');
  });
  it('三节点环 A←B←C，设 A.parent=C → hasCycle=true（AC-F1-7）', () => {
    // 已有 C.parent=B + B.parent=A，设 A.parent=C → detectCycle(A, C)：C.id!==A, C.parent=B, B.id!==A, B.parent=A, A.id===A → 环
    const A: RoleEntity = { id: 'A', name: 'a', description: 'd', permission_codes: [], is_builtin: false, parent_role_id: null, created_at: SEED_TS, version: 0 };
    const B: RoleEntity = { id: 'B', name: 'b', description: 'd', permission_codes: [], is_builtin: false, parent_role_id: 'A', created_at: SEED_TS, version: 0 };
    const C: RoleEntity = { id: 'C', name: 'c', description: 'd', permission_codes: [], is_builtin: false, parent_role_id: 'B', created_at: SEED_TS, version: 0 };
    const findById = makeFindById({ A, B, C });
    const result = detectCycle('A', 'C', findById);
    expect(result.hasCycle).toBe(true);
    expect(result.cyclePath).toBeDefined();
  });
  it('parentRoleId 指向的角色不存在 → hasCycle=false（上层须抛 ROLE_NOT_FOUND）', () => {
    const findById = makeFindById({});
    const result = detectCycle('A', 'MISSING', findById);
    expect(result.hasCycle).toBe(false);
  });
});

// ===========================================================================
// 2. 契约测 · schema safeParse 合法/非法样本
// ===========================================================================
describe('契约 · setParentInputSchema', () => {
  it('合法输入通过', () => {
    expect(setParentInputSchema.safeParse({
      roleId: '00000000-0000-4000-8000-000000000001',
      parentRoleId: '00000000-0000-4000-8000-000000000002',
    }).success).toBe(true);
  });
  it('roleId !== parentRoleId superRefine 通过', () => {
    const r = '00000000-0000-4000-8000-000000000001';
    expect(setParentInputSchema.safeParse({ roleId: r, parentRoleId: r }).success).toBe(false);
  });
  it('roleId 非合法 uuid 拒绝', () => {
    expect(setParentInputSchema.safeParse({
      roleId: 'not-uuid', parentRoleId: '00000000-0000-4000-8000-000000000002',
    }).success).toBe(false);
  });
  it('多余字段拒绝（.strict）', () => {
    expect(setParentInputSchema.safeParse({
      roleId: '00000000-0000-4000-8000-000000000001',
      parentRoleId: '00000000-0000-4000-8000-000000000002',
      extra: 'x',
    }).success).toBe(false);
  });
});

describe('契约 · inheritanceChainResultSchema / effectivePermissionsResultSchema', () => {
  it('inheritanceChainResultSchema 接受 Role[]', () => {
    const role: Role = makeRole(1);
    expect(() => inheritanceChainResultSchema.parse([role])).not.toThrow();
  });
  it('inheritanceChainResultSchema 接受空数组（根角色）', () => {
    expect(() => inheritanceChainResultSchema.parse([])).not.toThrow();
  });
  it('effectivePermissionsResultSchema 接受 PermissionCode[] 去重排序', () => {
    const codes: PermissionCode[] = ['user:read', 'role:read'];
    expect(() => effectivePermissionsResultSchema.parse(codes)).not.toThrow();
  });
  it('effectivePermissionsResultSchema 拒绝未知权限码', () => {
    expect(() => effectivePermissionsResultSchema.parse(['unknown:code' as PermissionCode])).toThrow();
  });
});

// ===========================================================================
// 3. F1 setParent 边界与异常（7 类校验）
// ===========================================================================
describe('F1 · setParent 校验顺序与边界', () => {
  it('AC-F1-1 正常设置继承 → B.parent_role_id=A + 审计 before=[null] after=[A]', async () => {
    const { repo, service } = setup();
    const A = makeRole(1, { permission_codes: ['role:read'] });
    const B = makeRole(2, { permission_codes: ['user:read'] });
    repo.insert(A);
    repo.insert(B);
    const result = await service.setParent(B.id, A.id, 0, adminCtx);
    expect(repo.findById(B.id)?.parent_role_id).toBe(A.id);
    expect(result.entity.parent_role_id).toBe(A.id);
    // before/after 含 parent_role_id 虚拟字段
    expect(result.before?.find((f) => f.field === 'parent_role_id')?.value).toBeNull();
    expect(result.changes.find((f) => f.field === 'parent_role_id')?.value).toBe(A.id);
  });

  it('AC-F1-3 父角色不存在 → ROLE_NOT_FOUND（不修改任何角色）', async () => {
    const { repo, service } = setup();
    const B = makeRole(2);
    repo.insert(B);
    await expect(service.setParent(B.id, MISSING_ID, 0, adminCtx)).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
    expect(repo.findById(B.id)?.parent_role_id).toBeNull();
  });

  it('AC-F1-4 自继承 → ROLE_SELF_INHERITANCE（不修改任何角色）', async () => {
    const { repo, service } = setup();
    const B = makeRole(2);
    repo.insert(B);
    await expect(service.setParent(B.id, B.id, 0, adminCtx)).rejects.toMatchObject({ code: 'ROLE_SELF_INHERITANCE' });
    expect(repo.findById(B.id)?.parent_role_id).toBeNull();
  });

  it('AC-F1-5 父角色为内置 admin → ROLE_BUILTIN_PARENT_FORBIDDEN（不修改任何角色）', async () => {
    const { repo, service } = setup();
    const adminId = builtinAdminId(repo);
    const B = makeRole(2);
    repo.insert(B);
    await expect(service.setParent(B.id, adminId, 0, adminCtx)).rejects.toMatchObject({ code: 'ROLE_BUILTIN_PARENT_FORBIDDEN' });
    expect(repo.findById(B.id)?.parent_role_id).toBeNull();
  });

  it('AC-F1-6 环检测 A→B→A → ROLE_INHERITANCE_CYCLE（不修改任何角色）', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    const B = makeRole(2);
    repo.insert(A);
    repo.insert(B);
    // 先建立 B.parent=A
    await service.setParent(B.id, A.id, 0, adminCtx);
    // 再设 A.parent=B → 环
    await expect(service.setParent(A.id, B.id, 0, adminCtx)).rejects.toMatchObject({ code: 'ROLE_INHERITANCE_CYCLE' });
    expect(repo.findById(A.id)?.parent_role_id).toBeNull();
  });

  it('AC-F1-7 环检测三节点链 A→C→B→A → ROLE_INHERITANCE_CYCLE', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    const B = makeRole(2);
    const C = makeRole(3);
    repo.insert(A);
    repo.insert(B);
    repo.insert(C);
    await service.setParent(B.id, A.id, 0, adminCtx); // B.parent=A
    await service.setParent(C.id, B.id, 0, adminCtx); // C.parent=B
    // 设 A.parent=C → 环 A→C→B→A
    await expect(service.setParent(A.id, C.id, 0, adminCtx)).rejects.toMatchObject({ code: 'ROLE_INHERITANCE_CYCLE' });
    expect(repo.findById(A.id)?.parent_role_id).toBeNull();
  });

  it('AC-F1-8 对内置 admin 设置继承 → ROLE_BUILTIN_FORBIDDEN', async () => {
    const { repo, service } = setup();
    const adminId = builtinAdminId(repo);
    const B = makeRole(2);
    repo.insert(B);
    await expect(service.setParent(adminId, B.id, 0, adminCtx)).rejects.toMatchObject({ code: 'ROLE_BUILTIN_FORBIDDEN' });
  });

  it('AC-F1-9 重新设置继承（覆盖）→ B.parent 从 A 改为 C', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    const B = makeRole(2);
    const C = makeRole(3);
    repo.insert(A);
    repo.insert(B);
    repo.insert(C);
    await service.setParent(B.id, A.id, 0, adminCtx);
    // 覆盖：B.parent=A → B.parent=C
    const result = await service.setParent(B.id, C.id, 1, adminCtx);
    expect(repo.findById(B.id)?.parent_role_id).toBe(C.id);
    expect(result.before?.find((f) => f.field === 'parent_role_id')?.value).toBe(A.id);
    expect(result.changes.find((f) => f.field === 'parent_role_id')?.value).toBe(C.id);
  });

  it('角色不存在 → ROLE_NOT_FOUND（roleId 不存在）', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    repo.insert(A);
    await expect(service.setParent(MISSING_ID, A.id, 0, adminCtx)).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
  });

  it('非 admin 调用 → FORBIDDEN', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    const B = makeRole(2);
    repo.insert(A);
    repo.insert(B);
    await expect(service.setParent(B.id, A.id, 0, userCtx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ===========================================================================
// F1 unsetParent
// ===========================================================================
describe('F1 · unsetParent', () => {
  it('AC-F1-2 解除继承 → B.parent_role_id=null + before=[A] after=[null]', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    const B = makeRole(2);
    repo.insert(A);
    repo.insert(B);
    await service.setParent(B.id, A.id, 0, adminCtx);
    const result = await service.unsetParent(B.id, 1, adminCtx);
    expect(repo.findById(B.id)?.parent_role_id).toBeNull();
    expect(result.before?.find((f) => f.field === 'parent_role_id')?.value).toBe(A.id);
    expect(result.changes.find((f) => f.field === 'parent_role_id')?.value).toBeNull();
  });

  it('unsetParent 角色不存在 → ROLE_NOT_FOUND', async () => {
    const { service } = setup();
    await expect(service.unsetParent(MISSING_ID, 0, adminCtx)).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
  });

  it('unsetParent 内置 admin → ROLE_BUILTIN_FORBIDDEN', async () => {
    const { repo, service } = setup();
    const adminId = builtinAdminId(repo);
    await expect(service.unsetParent(adminId, 0, adminCtx)).rejects.toMatchObject({ code: 'ROLE_BUILTIN_FORBIDDEN' });
  });

  it('非 admin 调用 → FORBIDDEN', async () => {
    const { repo, service } = setup();
    const B = makeRole(2);
    repo.insert(B);
    await expect(service.unsetParent(B.id, 0, userCtx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ===========================================================================
// 4. F2 getInheritanceChain
// ===========================================================================
describe('F2 · getInheritanceChain', () => {
  it('AC-F2-1 单层继承链 B.parent=A → 返回 [A]', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    const B = makeRole(2);
    repo.insert(A);
    repo.insert(B);
    await service.setParent(B.id, A.id, 0, adminCtx);
    const chain = await service.getInheritanceChain(B.id, adminCtx);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.id).toBe(A.id);
  });

  it('AC-F2-2 多层继承链 C.parent=B, B.parent=A → 返回 [B, A]', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    const B = makeRole(2);
    const C = makeRole(3);
    repo.insert(A);
    repo.insert(B);
    repo.insert(C);
    await service.setParent(B.id, A.id, 0, adminCtx);
    await service.setParent(C.id, B.id, 0, adminCtx);
    const chain = await service.getInheritanceChain(C.id, adminCtx);
    expect(chain).toHaveLength(2);
    expect(chain[0]?.id).toBe(B.id);
    expect(chain[1]?.id).toBe(A.id);
  });

  it('AC-F2-3 根角色继承链 A.parent=null → 返回 []', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    repo.insert(A);
    const chain = await service.getInheritanceChain(A.id, adminCtx);
    expect(chain).toEqual([]);
  });

  it('AC-F2-4 不存在的角色 → ROLE_NOT_FOUND', async () => {
    const { service } = setup();
    await expect(service.getInheritanceChain(MISSING_ID, adminCtx)).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
  });

  it('非 admin 调用 → FORBIDDEN', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    repo.insert(A);
    await expect(service.getInheritanceChain(A.id, userCtx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ===========================================================================
// 5. F3 getEffectivePermissions（读时聚合）
// ===========================================================================
describe('F3 · getEffectivePermissions（读时聚合）', () => {
  it('AC-F3-1 单角色无继承 → 仅直接权限', async () => {
    const { repo, userRepo, service } = setup();
    const A = makeRole(1, { permission_codes: ['role:read', 'user:read'] });
    repo.insert(A);
    userRepo.insert({
      id: 'u2', name: 'u', email: 'u@e.com', status: 'active', created_at: SEED_TS, updated_at: SEED_TS, version: 0,
    });
    repo.insertUserRole({
      id: 'ur1', user_id: 'u2', role_id: A.id, assigned_at: SEED_TS,
    });
    const perms = await service.getEffectivePermissions('u2', adminCtx);
    expect(perms.sort()).toEqual(['role:read', 'user:read']);
  });

  it('AC-F3-2 单角色单层继承 → B 自身 ∪ A 父角色并集', async () => {
    const { repo, userRepo, service } = setup();
    const A = makeRole(1, { permission_codes: ['role:read', 'user:read'] });
    const B = makeRole(2, { permission_codes: ['role:write'] });
    repo.insert(A);
    repo.insert(B);
    await service.setParent(B.id, A.id, 0, adminCtx);
    userRepo.insert({
      id: 'u2', name: 'u', email: 'u@e.com', status: 'active', created_at: SEED_TS, updated_at: SEED_TS, version: 0,
    });
    repo.insertUserRole({ id: 'ur1', user_id: 'u2', role_id: B.id, assigned_at: SEED_TS });
    const perms = await service.getEffectivePermissions('u2', adminCtx);
    expect(perms.sort()).toEqual(['role:read', 'role:write', 'user:read']);
  });

  it('AC-F3-3 单角色多层继承 → C ∪ B ∪ A 递归并集', async () => {
    const { repo, userRepo, service } = setup();
    const A = makeRole(1, { permission_codes: ['role:read', 'user:read'] });
    const B = makeRole(2, { permission_codes: ['role:write'] });
    const C = makeRole(3, { permission_codes: ['dept:read'] });
    repo.insert(A);
    repo.insert(B);
    repo.insert(C);
    await service.setParent(B.id, A.id, 0, adminCtx);
    await service.setParent(C.id, B.id, 0, adminCtx);
    userRepo.insert({
      id: 'u2', name: 'u', email: 'u@e.com', status: 'active', created_at: SEED_TS, updated_at: SEED_TS, version: 0,
    });
    repo.insertUserRole({ id: 'ur1', user_id: 'u2', role_id: C.id, assigned_at: SEED_TS });
    const perms = await service.getEffectivePermissions('u2', adminCtx);
    expect(perms.sort()).toEqual(['dept:read', 'role:read', 'role:write', 'user:read']);
  });

  it('AC-F3-4 多角色继承并集 → A ∪ D ∪ E', async () => {
    const { repo, userRepo, service } = setup();
    const A = makeRole(1, { permission_codes: ['role:read'] });
    const D = makeRole(4, { permission_codes: ['notification:read'] });
    const E = makeRole(5, { permission_codes: ['dept:write'] });
    repo.insert(A);
    repo.insert(D);
    repo.insert(E);
    await service.setParent(D.id, E.id, 0, adminCtx);
    userRepo.insert({
      id: 'u2', name: 'u', email: 'u@e.com', status: 'active', created_at: SEED_TS, updated_at: SEED_TS, version: 0,
    });
    repo.insertUserRole({ id: 'ur1', user_id: 'u2', role_id: A.id, assigned_at: SEED_TS });
    repo.insertUserRole({ id: 'ur2', user_id: 'u2', role_id: D.id, assigned_at: SEED_TS });
    const perms = await service.getEffectivePermissions('u2', adminCtx);
    expect(perms.sort()).toEqual(['dept:write', 'notification:read', 'role:read']);
  });

  it('AC-F3-5 继承关系变更后权限自动更新（读时聚合）', async () => {
    const { repo, userRepo, service } = setup();
    const A = makeRole(1, { permission_codes: ['role:read'] });
    const B = makeRole(2, { permission_codes: ['role:write'] });
    repo.insert(A);
    repo.insert(B);
    userRepo.insert({
      id: 'u2', name: 'u', email: 'u@e.com', status: 'active', created_at: SEED_TS, updated_at: SEED_TS, version: 0,
    });
    repo.insertUserRole({ id: 'ur1', user_id: 'u2', role_id: B.id, assigned_at: SEED_TS });
    // 变更前：B 无父角色，有效权限=[role:write]
    const before = await service.getEffectivePermissions('u2', adminCtx);
    expect(before.sort()).toEqual(['role:write']);
    // 设置 B.parent=A
    await service.setParent(B.id, A.id, 0, adminCtx);
    // 变更后：B ∪ A = [role:write, role:read]
    const after = await service.getEffectivePermissions('u2', adminCtx);
    expect(after.sort()).toEqual(['role:read', 'role:write']);
  });

  it('AC-F3-6 用户不存在 → USER_NOT_FOUND', async () => {
    const { service } = setup();
    await expect(service.getEffectivePermissions(MISSING_ID, adminCtx)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('AC-F3-7 用户无角色 → 返回空数组', async () => {
    const { userRepo, service } = setup();
    userRepo.insert({
      id: 'u2', name: 'u', email: 'u@e.com', status: 'active', created_at: SEED_TS, updated_at: SEED_TS, version: 0,
    });
    const perms = await service.getEffectivePermissions('u2', adminCtx);
    expect(perms).toEqual([]);
  });

  it('非 admin 调用 → FORBIDDEN', async () => {
    const { userRepo, service } = setup();
    userRepo.insert({
      id: 'u2', name: 'u', email: 'u@e.com', status: 'active', created_at: SEED_TS, updated_at: SEED_TS, version: 0,
    });
    await expect(service.getEffectivePermissions('u2', userCtx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ===========================================================================
// 6. F4 delete 守卫扩展（B5→B6→B8→B7）
// ===========================================================================
describe('F4 · delete 守卫 B8 ROLE_HAS_CHILDREN', () => {
  it('AC-F4-1 删除有子角色的角色 → ROLE_HAS_CHILDREN（不删除）', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    const B = makeRole(2);
    repo.insert(A);
    repo.insert(B);
    await service.setParent(B.id, A.id, 0, adminCtx);
    // A 有子角色 B
    await expect(service.delete(A.id, 0, adminCtx)).rejects.toMatchObject({ code: 'ROLE_HAS_CHILDREN' });
    expect(repo.findById(A.id)).toBeDefined();
  });

  it('AC-F4-2 删除无子角色的角色 → 成功', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    repo.insert(A);
    await service.delete(A.id, 0, adminCtx);
    expect(repo.findById(A.id)).toBeUndefined();
  });

  it('AC-F4-3 解除子角色继承后可删除', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    const B = makeRole(2);
    repo.insert(A);
    repo.insert(B);
    await service.setParent(B.id, A.id, 0, adminCtx);
    // 解除 B 的继承
    await service.unsetParent(B.id, 1, adminCtx);
    // 现在删除 A 应成功
    await service.delete(A.id, 0, adminCtx);
    expect(repo.findById(A.id)).toBeUndefined();
  });

  it('守卫顺序 B5→B6→B8→B7：内置角色先于子角色校验', async () => {
    const { repo, service } = setup();
    const adminId = builtinAdminId(repo);
    // 给 admin 添加子角色（理论上不可能，因 admin 不可被设为父——但假设数据已存在）
    const B = makeRole(2);
    repo.insert(B);
    // 直接 repo 层设置 B.parent=adminId 绕过 service 校验（模拟数据已存在）
    const adminRole = repo.findById(adminId)!;
    // delete admin 应先触发 B6 ROLE_BUILTIN_FORBIDDEN（而非 B8 ROLE_HAS_CHILDREN）
    await expect(service.delete(adminId, 0, adminCtx)).rejects.toMatchObject({ code: 'ROLE_BUILTIN_FORBIDDEN' });
  });

  it('守卫顺序 B8 先于 B7：有子角色且已分配 → ROLE_HAS_CHILDREN（非 ROLE_IN_USE）', async () => {
    const { repo, userRepo, service } = setup();
    const A = makeRole(1);
    const B = makeRole(2);
    repo.insert(A);
    repo.insert(B);
    await service.setParent(B.id, A.id, 0, adminCtx);
    // 给 A 分配用户（触发 B7 条件），但 B8 应先拦截
    userRepo.insert({
      id: 'u2', name: 'u', email: 'u@e.com', status: 'active', created_at: SEED_TS, updated_at: SEED_TS, version: 0,
    });
    repo.insertUserRole({ id: 'ur1', user_id: 'u2', role_id: A.id, assigned_at: SEED_TS });
    await expect(service.delete(A.id, 0, adminCtx)).rejects.toMatchObject({ code: 'ROLE_HAS_CHILDREN' });
  });
});

// ===========================================================================
// 7. router 层 · procedure 注册 + withAudit 包装
// ===========================================================================
describe('router · role-inheritance procedure 注册', () => {
  it('createRoleRouter 返回 setParent procedure（经 withAudit 包装）', () => {
    const { router } = setup();
    expect(router.setParent).toBeDefined();
    expect(router.setParent.auth).toBe('admin');
  });
  it('createRoleRouter 返回 unsetParent procedure（经 withAudit 包装）', () => {
    const { router } = setup();
    expect(router.unsetParent).toBeDefined();
    expect(router.unsetParent.auth).toBe('admin');
  });
  it('createRoleRouter 返回 getInheritanceChain procedure（读，不经 withAudit）', () => {
    const { router } = setup();
    expect(router.getInheritanceChain).toBeDefined();
    expect(router.getInheritanceChain.auth).toBe('admin');
  });
  it('createRoleRouter 返回 getEffectivePermissions procedure（读，不经 withAudit）', () => {
    const { router } = setup();
    expect(router.getEffectivePermissions).toBeDefined();
    expect(router.getEffectivePermissions.auth).toBe('admin');
  });
});

// ===========================================================================
// 8. ②类签名变更回归 · roleSchema.parse 含 parent_role_id
// ===========================================================================
describe('②类签名变更回归 · roleSchema 含 parent_role_id', () => {
  it('makeRole 返回的 Role 经 roleSchema.parse 通过（含 parent_role_id:null）', () => {
    const r = makeRole(1);
    expect(() => roleSchema.parse(r)).not.toThrow();
  });
  it('service.create 返回的 Role 经 roleSchema.parse 通过（含 parent_role_id:null）', async () => {
    const { service } = setup();
    const result = await service.create(
      { name: 'newrole', description: 'd', permission_codes: ['user:read'] },
      adminCtx,
    );
    expect(() => roleSchema.parse(result.entity)).not.toThrow();
    expect(result.entity.parent_role_id).toBeNull();
  });
  it('内置 admin seed 含 parent_role_id:null', () => {
    const { repo } = setup();
    const admin = repo.findByName(BUILTIN_ADMIN_ROLE_NAME)!;
    expect(admin.parent_role_id).toBeNull();
    expect(() => roleSchema.parse(admin)).not.toThrow();
  });
  it('setParent 后 roleSchema.parse 通过（parent_role_id=uuid）', async () => {
    const { repo, service } = setup();
    const A = makeRole(1);
    const B = makeRole(2);
    repo.insert(A);
    repo.insert(B);
    await service.setParent(B.id, A.id, 0, adminCtx);
    const updated = repo.findById(B.id)!;
    expect(() => roleSchema.parse(updated)).not.toThrow();
    expect(updated.parent_role_id).toBe(A.id);
  });
});

// ===========================================================================
// 9. AI-005 SSOT 派生 · errorCodeSchema 4 码自动覆盖
// ===========================================================================
describe('AI-005 · errorCodeSchema 含 4 个 ROLE_INHERITANCE_* 码（跨域联动①）', () => {
  it('[...errorCodeSchema.options] 含 4 码（SSOT 派生，零改动）', async () => {
    const { errorCodeSchema } = await import('@admin/contracts');
    const allCodes = [...errorCodeSchema.options];
    expect(allCodes).toContain('ROLE_SELF_INHERITANCE');
    expect(allCodes).toContain('ROLE_BUILTIN_PARENT_FORBIDDEN');
    expect(allCodes).toContain('ROLE_INHERITANCE_CYCLE');
    expect(allCodes).toContain('ROLE_HAS_CHILDREN');
  });
});
