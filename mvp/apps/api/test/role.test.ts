// apps/api/test/role.test.ts —— 测试先行（AI-002，复盘 P2 拆分）
// 本文件先于实现产出，覆盖 Tech-Spec TECH-ROLE-001 测试矩阵五类：
//   1. 单测 · domain 常量 + repository CRUD（内存）+ service 裁决
//   2. 契约测 · 出参 schema 匹配（.strict）+ 入参 safeParse 合法/非法样本
//   3. 边界 · F1-F4 全部边界与异常（B1-B12）
//   4. 权限 · 非 admin 调用各 procedure → FORBIDDEN；SEC-003 出参不夹带 PII
//   5. 状态机 · 守卫序列顺序（delete B5→B6→B7；assign B8→B9→B10）+ 删除前置链
// 设计说明（impl-writer 须遵循）：
//   - RoleRepository 构造时幂等 seed 内置 admin（is_builtin=true，permission_codes=全集）
//   - RoleService 构造签名：new RoleService(roleRepo, userRepo)；userRepo 用于 B8/B11 用户存在性校验
//   - router 导出 createRoleRouter / roleDetailProcedureInputSchema / listUserRolesProcedureInputSchema / Procedure
//   - domain/role.ts 导出常量 BUILTIN_ADMIN_ROLE_NAME / ALL_PERMISSION_CODES
import { describe, it, expect } from 'vitest';
import {
  roleSchema,
  roleListResultSchema,
  userRoleSchema,
  createRoleInputSchema,
  listRoleQuerySchema,
  assignRoleInputSchema,
  permissionCodeSchema,
  type ErrorCode,
  type Role,
  type UserRole,
} from '@admin/contracts';
import { RoleRepository } from '../src/repository/role.js';
import { RoleService } from '../src/service/role.js';
import {
  createRoleRouter,
  roleDetailProcedureInputSchema,
  listUserRolesProcedureInputSchema,
  type Procedure,
} from '../src/router/role.js';
import {
  BUILTIN_ADMIN_ROLE_NAME,
  ALL_PERMISSION_CODES,
} from '../src/domain/role.js';
import { UserRepository } from '../src/repository/user.js';
import { AppError } from '../src/errors.js';
import type { Ctx } from '../src/context.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const USER_ROLE_ID = '00000000-0000-4000-8000-000000000002';
const SEED_TS = '2020-01-01T00:00:00.000Z';
const MISSING_ID = '00000000-0000-4000-8000-000000000099';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };
const userCtx: Ctx = { user: { id: USER_ROLE_ID, role: 'user' } };

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
  });
  const service = new RoleService(repo, userRepo);
  const router = createRoleRouter(service);
  return { repo, userRepo, service, router };
}

function makeRole(i: number, overrides: Partial<Role> = {}): Role {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `role${i}`,
    description: `desc${i}`,
    permission_codes: ['user:read'],
    is_builtin: false,
    created_at: SEED_TS,
    ...overrides,
  };
}

function makeUserRole(i: number, overrides: Partial<UserRole> = {}): UserRole {
  return {
    id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    user_id: ADMIN_ID,
    role_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    assigned_at: SEED_TS,
    ...overrides,
  };
}

function builtinAdminId(repo: RoleRepository): string {
  const admin = repo.findByName(BUILTIN_ADMIN_ROLE_NAME);
  if (!admin) throw new Error('test setup: expected builtin admin role to be seeded');
  return admin.id;
}

// 模拟 router 层执行：safeParse 失败统一转 VALIDATION_ERROR，成功则调 handler。
async function callProc<I, O>(proc: Procedure<I, O>, raw: unknown, ctx: Ctx): Promise<O> {
  const parsed = proc.input.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', parsed.error.message);
  }
  return proc.handler(parsed.data, ctx);
}

async function expectAppError(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  const err = await promise.then(
    () => {
      throw new Error(`期望抛出 ${code}，但 Promise 已 resolve`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  if (err instanceof AppError) {
    expect(err.code).toBe(code);
  }
}

// ---------------------------------------------------------------------------
// 1. 单测 · domain 常量 + repository CRUD + service 裁决
// ---------------------------------------------------------------------------
describe('单测 · domain 常量', () => {
  it('BUILTIN_ADMIN_ROLE_NAME === "admin"', () => {
    expect(BUILTIN_ADMIN_ROLE_NAME).toBe('admin');
  });

  it('ALL_PERMISSION_CODES 包含全部 6 个权限码', () => {
    expect(ALL_PERMISSION_CODES).toEqual(['user:read', 'user:write', 'role:read', 'role:write', 'dept:read', 'dept:write']);
  });
});

describe('单测 · repository CRUD（内存）', () => {
  it('初始化时内置 admin 角色已 seed：is_builtin=true，permission_codes=全集', () => {
    const repo = new RoleRepository();
    const admin = repo.findByName(BUILTIN_ADMIN_ROLE_NAME);
    expect(admin).toBeDefined();
    if (admin) {
      expect(admin.is_builtin).toBe(true);
      expect(admin.permission_codes).toEqual(ALL_PERMISSION_CODES);
      expect(admin.name).toBe(BUILTIN_ADMIN_ROLE_NAME);
    }
  });

  it('roles insert/findById：写入后可按 id 查回', () => {
    const repo = new RoleRepository();
    const r = makeRole(1);
    repo.insert(r);
    expect(repo.findById(r.id)).toEqual(r);
  });

  it('roles findByName：按名称查回（区分大小写）', () => {
    const repo = new RoleRepository();
    const r = makeRole(2, { name: 'editor' });
    repo.insert(r);
    expect(repo.findByName('editor')).toEqual(r);
    expect(repo.findByName('Editor')).toBeUndefined();
  });

  it('roles list：分页计算 total/切片（25 条 + admin = 26）', () => {
    const repo = new RoleRepository();
    for (let i = 1; i <= 25; i++) repo.insert(makeRole(i));
    const r1 = repo.list({ page: 1, pageSize: 10 });
    expect(r1.total).toBe(26);
    expect(r1.items).toHaveLength(10);
    const r3 = repo.list({ page: 3, pageSize: 10 });
    expect(r3.items).toHaveLength(6); // 26 - 20
  });

  it('roles list：空库（删除 admin 后）total=0 items=[]', () => {
    const repo = new RoleRepository();
    repo.delete(builtinAdminId(repo));
    const { items, total } = repo.list({ page: 1, pageSize: 10 });
    expect(items).toHaveLength(0);
    expect(total).toBe(0);
  });

  it('roles delete：删除后 findById 为空', () => {
    const repo = new RoleRepository();
    const r = makeRole(3);
    repo.insert(r);
    expect(repo.delete(r.id)).toBe(true);
    expect(repo.findById(r.id)).toBeUndefined();
  });

  it('user_roles insert/findByUser：写入后可按 user 查回列表', () => {
    const repo = new RoleRepository();
    const r1 = makeRole(1);
    const r2 = makeRole(2);
    repo.insert(r1);
    repo.insert(r2);
    repo.insertUserRole(makeUserRole(1, { user_id: ADMIN_ID, role_id: r1.id }));
    repo.insertUserRole(makeUserRole(2, { user_id: ADMIN_ID, role_id: r2.id }));
    const list = repo.findUserRolesByUser(ADMIN_ID);
    expect(list).toHaveLength(2);
  });

  it('user_roles existsPair/findByUserRole：检测 (user,role) 是否存在', () => {
    const repo = new RoleRepository();
    const r = makeRole(5);
    repo.insert(r);
    const ur = makeUserRole(5, { user_id: ADMIN_ID, role_id: r.id });
    repo.insertUserRole(ur);
    expect(repo.existsUserRole(ADMIN_ID, r.id)).toBe(true);
    expect(repo.findUserRole(ADMIN_ID, r.id)).toEqual(ur);
    expect(repo.existsUserRole(ADMIN_ID, MISSING_ID)).toBe(false);
  });

  it('user_roles delete：按 (user,role) 删除', () => {
    const repo = new RoleRepository();
    const r = makeRole(6);
    repo.insert(r);
    repo.insertUserRole(makeUserRole(6, { user_id: ADMIN_ID, role_id: r.id }));
    expect(repo.deleteUserRole(ADMIN_ID, r.id)).toBe(true);
    expect(repo.existsUserRole(ADMIN_ID, r.id)).toBe(false);
  });
});

describe('单测 · service 裁决', () => {
  it('create：name 与内置 admin 冲突 → ROLE_NAME_DUPLICATE', async () => {
    const { service } = setup();
    await expectAppError(
      service.create(
        { name: BUILTIN_ADMIN_ROLE_NAME, description: 'dup', permission_codes: [] },
        adminCtx,
      ),
      'ROLE_NAME_DUPLICATE',
    );
  });

  it('delete 守卫序列 B5→B6→B7：不存在角色 → ROLE_NOT_FOUND（先于 B6/B7）', async () => {
    const { service } = setup();
    await expectAppError(service.delete(MISSING_ID, adminCtx), 'ROLE_NOT_FOUND');
  });

  it('assign 守卫序列 B8→B9→B10：用户不存在 → USER_NOT_FOUND（先于 B9）', async () => {
    const { service } = setup();
    await expectAppError(
      service.assign(MISSING_ID, '00000000-0000-4000-8000-000000000088', adminCtx),
      'USER_NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. 契约测 · 出参 schema 匹配 + 入参 safeParse
// ---------------------------------------------------------------------------
describe('契约测 · 出参 schema 匹配', () => {
  it('list 返回结构匹配 roleListResultSchema（.strict 拒绝多余字段）', async () => {
    const { router } = setup();
    const result = await callProc(router.list, { page: 1, pageSize: 10 }, adminCtx);
    expect(() => roleListResultSchema.parse(result)).not.toThrow();
    expect(result.items.length).toBeGreaterThanOrEqual(1); // 至少含 admin
  });

  it('list 结果中内置 admin 的 is_builtin=true', async () => {
    const { router } = setup();
    const result = await callProc(router.list, { page: 1, pageSize: 100 }, adminCtx);
    const admin = result.items.find((r) => r.name === BUILTIN_ADMIN_ROLE_NAME);
    expect(admin).toBeDefined();
    expect(admin?.is_builtin).toBe(true);
  });

  it('create 返回匹配 roleSchema，且 is_builtin=false，permission_codes 按提交值固定', async () => {
    const { router } = setup();
    const result = await callProc(
      router.create,
      { name: 'editor', description: 'd', permission_codes: ['user:read', 'role:read'] },
      adminCtx,
    );
    expect(() => roleSchema.parse(result)).not.toThrow();
    expect(result.is_builtin).toBe(false);
    expect(result.permission_codes).toEqual(['user:read', 'role:read']);
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('detail 返回匹配 roleSchema', async () => {
    const { repo, router } = setup();
    const adminId = builtinAdminId(repo);
    const result = await callProc(router.detail, { id: adminId }, adminCtx);
    expect(() => roleSchema.parse(result)).not.toThrow();
    expect(result.name).toBe(BUILTIN_ADMIN_ROLE_NAME);
  });

  it('assign 返回匹配 userRoleSchema（201 形态）', async () => {
    const { repo, router } = setup();
    const r = makeRole(10);
    repo.insert(r);
    const result = await callProc(router.assign, { userId: ADMIN_ID, roleId: r.id }, adminCtx);
    expect(() => userRoleSchema.parse(result)).not.toThrow();
    expect(result.user_id).toBe(ADMIN_ID);
    expect(result.role_id).toBe(r.id);
  });

  it('listUserRoles 返回 userRoleSchema[]', async () => {
    const { repo, router } = setup();
    const r = makeRole(11);
    repo.insert(r);
    repo.insertUserRole(makeUserRole(11, { user_id: ADMIN_ID, role_id: r.id }));
    const result = await callProc(router.listUserRoles, { userId: ADMIN_ID }, adminCtx);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(() => userRoleSchema.parse(result[0])).not.toThrow();
  });
});

describe('契约测 · 入参 safeParse 合法/非法样本', () => {
  it('permissionCodeSchema.safeParse：非法码 foo:bar 拒绝', () => {
    expect(permissionCodeSchema.safeParse('foo:bar').success).toBe(false);
  });
  it('permissionCodeSchema.safeParse：合法码 role:write 通过', () => {
    expect(permissionCodeSchema.safeParse('role:write').success).toBe(true);
  });

  it('create: name 空串非法', () => {
    expect(
      createRoleInputSchema.safeParse({ name: '', description: 'd', permission_codes: [] }).success,
    ).toBe(false);
  });
  it('create: name 超 64 字符非法', () => {
    expect(
      createRoleInputSchema.safeParse({
        name: 'x'.repeat(65),
        description: 'd',
        permission_codes: [],
      }).success,
    ).toBe(false);
  });
  it('create: permission_codes 含未知码 foo:bar 非法', () => {
    expect(
      createRoleInputSchema.safeParse({
        name: 'r',
        description: 'd',
        permission_codes: ['foo:bar'],
      }).success,
    ).toBe(false);
  });
  it('create: permission_codes=[] 合法（零权限角色）', () => {
    expect(
      createRoleInputSchema.safeParse({ name: 'r', description: 'd', permission_codes: [] }).success,
    ).toBe(true);
  });
  it('create: 多余字段 is_builtin 非法（.strict）', () => {
    expect(
      createRoleInputSchema.safeParse({
        name: 'r',
        description: 'd',
        permission_codes: [],
        is_builtin: true,
      }).success,
    ).toBe(false);
  });
  it('create: 合法样本通过', () => {
    expect(
      createRoleInputSchema.safeParse({
        name: 'editor',
        description: 'd',
        permission_codes: ['user:read', 'role:read'],
      }).success,
    ).toBe(true);
  });

  it('list: page=0 非法', () => {
    expect(listRoleQuerySchema.safeParse({ page: 0, pageSize: 10 }).success).toBe(false);
  });
  it('list: pageSize=101 非法', () => {
    expect(listRoleQuerySchema.safeParse({ page: 1, pageSize: 101 }).success).toBe(false);
  });
  it('list: 空对象合法（走默认值 page=1 pageSize=10）', () => {
    expect(listRoleQuerySchema.safeParse({}).success).toBe(true);
  });

  it('assign: userId 非 uuid 非法', () => {
    expect(
      assignRoleInputSchema.safeParse({ userId: 'not-uuid', roleId: ADMIN_ID }).success,
    ).toBe(false);
  });
  it('assign: roleId 非 uuid 非法', () => {
    expect(
      assignRoleInputSchema.safeParse({ userId: ADMIN_ID, roleId: 'not-uuid' }).success,
    ).toBe(false);
  });
  it('assign: 合法样本通过', () => {
    expect(
      assignRoleInputSchema.safeParse({
        userId: ADMIN_ID,
        roleId: '00000000-0000-4000-8000-000000000002',
      }).success,
    ).toBe(true);
  });

  it('detail procedure input: id 非 uuid 非法', () => {
    expect(roleDetailProcedureInputSchema.safeParse({ id: 'not-uuid' }).success).toBe(false);
  });
  it('listUserRoles procedure input: userId 非 uuid 非法', () => {
    expect(listUserRolesProcedureInputSchema.safeParse({ userId: 'not-uuid' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. 边界 · F1-F4
// ---------------------------------------------------------------------------
describe('边界 · F1 创建角色', () => {
  it('F1: name 合法且未占用 → 创建成功，is_builtin=false，permission_codes 按提交值', async () => {
    const { router } = setup();
    const result = await callProc(
      router.create,
      { name: 'editor', description: '编辑者', permission_codes: ['user:read'] },
      adminCtx,
    );
    expect(result.is_builtin).toBe(false);
    expect(result.name).toBe('editor');
    expect(result.permission_codes).toEqual(['user:read']);
  });

  it('F1: name 重复（与已建角色）→ ROLE_NAME_DUPLICATE', async () => {
    const { router } = setup();
    await callProc(router.create, { name: 'editor', description: 'd', permission_codes: [] }, adminCtx);
    await expectAppError(
      callProc(router.create, { name: 'editor', description: 'd2', permission_codes: [] }, adminCtx),
      'ROLE_NAME_DUPLICATE',
    );
  });

  it('F1: name 重复（与内置 admin）→ ROLE_NAME_DUPLICATE', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(
        router.create,
        { name: BUILTIN_ADMIN_ROLE_NAME, description: 'd', permission_codes: [] },
        adminCtx,
      ),
      'ROLE_NAME_DUPLICATE',
    );
  });

  it('F1: name 空串 → VALIDATION_ERROR', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.create, { name: '', description: 'd', permission_codes: [] }, adminCtx),
      'VALIDATION_ERROR',
    );
  });

  it('F1: name 超 64 字符 → VALIDATION_ERROR', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(
        router.create,
        { name: 'x'.repeat(65), description: 'd', permission_codes: [] },
        adminCtx,
      ),
      'VALIDATION_ERROR',
    );
  });

  it('F1: permission_codes 含未知码 → VALIDATION_ERROR', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(
        router.create,
        { name: 'r', description: 'd', permission_codes: ['foo:bar'] },
        adminCtx,
      ),
      'VALIDATION_ERROR',
    );
  });

  it('F1: permission_codes=[] → 成功（零权限角色）', async () => {
    const { router } = setup();
    const result = await callProc(
      router.create,
      { name: 'empty', description: 'd', permission_codes: [] },
      adminCtx,
    );
    expect(result.permission_codes).toEqual([]);
  });
});

describe('边界 · F2 列表与详情', () => {
  it('F2: 列表含内置 admin 并标识 is_builtin=true', async () => {
    const { router } = setup();
    const result = await callProc(router.list, { page: 1, pageSize: 10 }, adminCtx);
    const admin = result.items.find((r) => r.name === BUILTIN_ADMIN_ROLE_NAME);
    expect(admin).toBeDefined();
    expect(admin?.is_builtin).toBe(true);
  });

  it('F2: detail 返回 name/description/permission_codes/is_builtin', async () => {
    const { repo, router } = setup();
    const adminId = builtinAdminId(repo);
    const result = await callProc(router.detail, { id: adminId }, adminCtx);
    expect(result.name).toBe(BUILTIN_ADMIN_ROLE_NAME);
    expect(typeof result.description).toBe('string');
    expect(Array.isArray(result.permission_codes)).toBe(true);
    expect(result.is_builtin).toBe(true);
  });

  it('F2: detail 不存在 → ROLE_NOT_FOUND', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.detail, { id: MISSING_ID }, adminCtx), 'ROLE_NOT_FOUND');
  });

  it('F2: 25 条 page=2 pageSize=10 → 11-20 条 total=25 totalPages=3', async () => {
    const { router } = setup();
    // setup 已有 1 个 admin，再创建 24 个 → total=25
    for (let i = 1; i <= 24; i++) {
      await callProc(router.create, { name: `r${i}`, description: 'd', permission_codes: [] }, adminCtx);
    }
    const result = await callProc(router.list, { page: 2, pageSize: 10 }, adminCtx);
    expect(result.items).toHaveLength(10);
    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(() => roleListResultSchema.parse(result)).not.toThrow();
  });

  it('F2: 空库（service 层，repo 删除 admin 后）→ total=0 totalPages=0', async () => {
    const { repo, router } = setup();
    repo.delete(builtinAdminId(repo));
    const result = await callProc(router.list, { page: 1, pageSize: 10 }, adminCtx);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });
});

describe('边界 · F3 删除角色', () => {
  it('F3: 删除非内置且未被分配 → 204（resolve undefined）', async () => {
    const { router } = setup();
    const created = await callProc(
      router.create,
      { name: 'toDelete', description: 'd', permission_codes: [] },
      adminCtx,
    );
    await expect(callProc(router.delete, { id: created.id }, adminCtx)).resolves.toBeUndefined();
  });

  it('F3: 删除内置 admin（未被分配）→ ROLE_BUILTIN_FORBIDDEN', async () => {
    const { repo, router } = setup();
    const adminId = builtinAdminId(repo);
    await expectAppError(callProc(router.delete, { id: adminId }, adminCtx), 'ROLE_BUILTIN_FORBIDDEN');
  });

  it('F3: 删除已被分配的非内置角色 → ROLE_IN_USE', async () => {
    const { repo, router } = setup();
    const created = await callProc(
      router.create,
      { name: 'assigned', description: 'd', permission_codes: [] },
      adminCtx,
    );
    repo.insertUserRole(makeUserRole(70, { user_id: ADMIN_ID, role_id: created.id }));
    await expectAppError(callProc(router.delete, { id: created.id }, adminCtx), 'ROLE_IN_USE');
  });

  it('F3: 删除不存在 → ROLE_NOT_FOUND', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.delete, { id: MISSING_ID }, adminCtx), 'ROLE_NOT_FOUND');
  });

  it('F3: 解除全部分配后删除 → 204', async () => {
    const { repo, router } = setup();
    const created = await callProc(
      router.create,
      { name: 'thenDelete', description: 'd', permission_codes: [] },
      adminCtx,
    );
    repo.insertUserRole(makeUserRole(71, { user_id: ADMIN_ID, role_id: created.id }));
    await callProc(router.remove, { userId: ADMIN_ID, roleId: created.id }, adminCtx);
    await expect(callProc(router.delete, { id: created.id }, adminCtx)).resolves.toBeUndefined();
  });
});

describe('边界 · F4 分配与移除', () => {
  it('F4: 为用户分配 R1 → 201 返回 userRoleSchema', async () => {
    const { repo, router } = setup();
    const r = makeRole(12);
    repo.insert(r);
    const result = await callProc(router.assign, { userId: ADMIN_ID, roleId: r.id }, adminCtx);
    expect(() => userRoleSchema.parse(result)).not.toThrow();
    expect(result.user_id).toBe(ADMIN_ID);
    expect(result.role_id).toBe(r.id);
  });

  it('F4: 再分配 R2 → 201，用户持多角色', async () => {
    const { repo, router } = setup();
    const r1 = makeRole(13);
    const r2 = makeRole(14);
    repo.insert(r1);
    repo.insert(r2);
    await callProc(router.assign, { userId: ADMIN_ID, roleId: r1.id }, adminCtx);
    await callProc(router.assign, { userId: ADMIN_ID, roleId: r2.id }, adminCtx);
    const list = await callProc(router.listUserRoles, { userId: ADMIN_ID }, adminCtx);
    expect(list).toHaveLength(2);
  });

  it('F4: 重复分配已持有角色 → USER_ROLE_ALREADY_ASSIGNED', async () => {
    const { repo, router } = setup();
    const r = makeRole(15);
    repo.insert(r);
    await callProc(router.assign, { userId: ADMIN_ID, roleId: r.id }, adminCtx);
    await expectAppError(
      callProc(router.assign, { userId: ADMIN_ID, roleId: r.id }, adminCtx),
      'USER_ROLE_ALREADY_ASSIGNED',
    );
  });

  it('F4: 为不存在用户分配 → USER_NOT_FOUND', async () => {
    const { repo, router } = setup();
    const r = makeRole(16);
    repo.insert(r);
    await expectAppError(
      callProc(router.assign, { userId: MISSING_ID, roleId: r.id }, adminCtx),
      'USER_NOT_FOUND',
    );
  });

  it('F4: 为不存在角色分配 → ROLE_NOT_FOUND', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.assign, { userId: ADMIN_ID, roleId: MISSING_ID }, adminCtx),
      'ROLE_NOT_FOUND',
    );
  });

  it('F4: 移除已持有 → 204（resolve undefined）', async () => {
    const { repo, router } = setup();
    const r = makeRole(17);
    repo.insert(r);
    await callProc(router.assign, { userId: ADMIN_ID, roleId: r.id }, adminCtx);
    await expect(
      callProc(router.remove, { userId: ADMIN_ID, roleId: r.id }, adminCtx),
    ).resolves.toBeUndefined();
  });

  it('F4: 移除不存在的关联 → 204（幂等，B12）', async () => {
    const { repo, router } = setup();
    const r = makeRole(18);
    repo.insert(r);
    await expect(
      callProc(router.remove, { userId: ADMIN_ID, roleId: r.id }, adminCtx),
    ).resolves.toBeUndefined();
  });

  it('F4: 移除时用户不存在 → USER_NOT_FOUND（B11）', async () => {
    const { repo, router } = setup();
    const r = makeRole(19);
    repo.insert(r);
    await expectAppError(
      callProc(router.remove, { userId: MISSING_ID, roleId: r.id }, adminCtx),
      'USER_NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// 4. 权限 · SEC-002
// ---------------------------------------------------------------------------
describe('权限 · SEC-002 非 admin 各 procedure → FORBIDDEN', () => {
  it('非 admin 调 list → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.list, { page: 1, pageSize: 10 }, userCtx), 'FORBIDDEN');
  });

  it('非 admin 调 create → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.create, { name: 'x', description: 'd', permission_codes: [] }, userCtx),
      'FORBIDDEN',
    );
  });

  it('非 admin 调 detail → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.detail, { id: ADMIN_ID }, userCtx), 'FORBIDDEN');
  });

  it('非 admin 调 delete → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.delete, { id: ADMIN_ID }, userCtx), 'FORBIDDEN');
  });

  it('非 admin 调 assign → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.assign, { userId: ADMIN_ID, roleId: USER_ROLE_ID }, userCtx),
      'FORBIDDEN',
    );
  });

  it('非 admin 调 listUserRoles → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.listUserRoles, { userId: ADMIN_ID }, userCtx),
      'FORBIDDEN',
    );
  });

  it('非 admin 调 remove → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.remove, { userId: ADMIN_ID, roleId: USER_ROLE_ID }, userCtx),
      'FORBIDDEN',
    );
  });

  it('SEC-003: list 出参仅含 roleSchema 字段（.strict 拒绝多余字段，无 PII）', async () => {
    const { router } = setup();
    const result = await callProc(router.list, { page: 1, pageSize: 10 }, adminCtx);
    for (const item of result.items) {
      expect(() => roleSchema.parse(item)).not.toThrow();
    }
    expect(() => roleListResultSchema.parse(result)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. 状态机 · 守卫序列顺序 + 删除前置链
// ---------------------------------------------------------------------------
describe('状态机 · 守卫序列顺序', () => {
  it('delete: 不存在 + 内置同时命中 → 先 ROLE_NOT_FOUND（B5 优先 B6）', async () => {
    const { service } = setup();
    await expectAppError(service.delete(MISSING_ID, adminCtx), 'ROLE_NOT_FOUND');
  });

  it('delete: 内置 + 已分配同时命中 → 先 ROLE_BUILTIN_FORBIDDEN（B6 优先 B7）', async () => {
    const { repo, service } = setup();
    const adminId = builtinAdminId(repo);
    repo.insertUserRole(makeUserRole(50, { user_id: ADMIN_ID, role_id: adminId }));
    await expectAppError(service.delete(adminId, adminCtx), 'ROLE_BUILTIN_FORBIDDEN');
  });

  it('assign: 用户不存在 + 角色不存在同时命中 → 先 USER_NOT_FOUND（B8 优先 B9）', async () => {
    const { service } = setup();
    await expectAppError(
      service.assign(MISSING_ID, '00000000-0000-4000-8000-000000000088', adminCtx),
      'USER_NOT_FOUND',
    );
  });

  it('删除前置链：被分配 → ROLE_IN_USE → 解除全部分配 → 再次删除 → 204', async () => {
    const { repo, router } = setup();
    const created = await callProc(
      router.create,
      { name: 'lifecycle', description: 'd', permission_codes: [] },
      adminCtx,
    );
    repo.insertUserRole(makeUserRole(60, { user_id: ADMIN_ID, role_id: created.id }));
    // 删除被拒（B7）
    await expectAppError(callProc(router.delete, { id: created.id }, adminCtx), 'ROLE_IN_USE');
    // 解除分配
    await callProc(router.remove, { userId: ADMIN_ID, roleId: created.id }, adminCtx);
    // 再次删除 → 204
    await expect(callProc(router.delete, { id: created.id }, adminCtx)).resolves.toBeUndefined();
  });
});
