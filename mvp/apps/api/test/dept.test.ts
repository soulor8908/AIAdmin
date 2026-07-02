// apps/api/test/dept.test.ts —— 测试先行（AI-002，test-writer 先于 impl-writer 产出）
// 覆盖 Tech-Spec TECH-DEPT-001 测试矩阵五类：
//   1. 单测 · domain 常量（MAX_DEPARTMENT_DEPTH）+ repository CRUD（内存）+ service 裁决（守卫序列）
//   2. 契约测 · 出参 schema 匹配（.strict）+ 入参 safeParse 合法/非法样本 + 递归树节点
//   3. 边界 · F1-F4 全部边界与异常（B1-B11，B11 预留不触发）
//   4. 权限 · 非 admin 调用各 procedure → FORBIDDEN；SEC-003 出参 .strict 不夹带 PII；SEC-001 procedure 元数据
//   5. 状态机 · 守卫序列顺序（create B4→B5→B6 / delete B7→B8 / assign B9→B10）+ 删除前置链 + Q1 解除归属闭环
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - DepartmentRepository 构造时 **不 seed** 任何内置部门（Tech-Spec §迁移与回滚：无内置部门 seed，空起步）。
//   - DepartmentService 构造签名：`new DepartmentService(deptRepo, userRepo)`；userRepo 用于 B9 用户存在性 + Q1 删除时解除归属。
//   - DepartmentRepository 方法（impl-writer 据此实现）：
//       insert / findById / findByParent(parentId: string | null) / list() / delete(id) /
//       existsByNameUnderParent(name, parentId: string | null) /
//       computeDepth(parentId: string | null): number  // 返回「以 parentId 为父的新部门」所在层级：
//         computeDepth(null) === 1（根，第 1 层）；computeDepth(rootId) === 2；逐层 +1。
//   - UserRepository 跨域联动新增方法（impl-writer 据此实现）：
//       findByDepartmentId(deptId: string): UserEntity[]          // 查归属某部门的全部用户
//       updateDepartmentId(userId, departmentId: string | null, updatedAt: string): UserEntity | undefined
//   - DepartmentService 方法签名：
//       create(input: CreateDepartmentInput, ctx): Promise<Department>
//       delete(id: string, ctx): Promise<void>                     // Q1：删除前将其下用户 department_id 置空
//       assignUserDepartment(userId: string, departmentId: string | null, ctx): Promise<User>
//       tree(ctx): Promise<DepartmentTreeResult>
//   - service 层鉴权：requirePermission(code)，admin 桩下放行、非 admin → FORBIDDEN（SEC-002）。
//   - 守卫顺序（Tech-Spec §边界与异常，先到先返，不叠加）：
//       create:  B3 鉴权 → [parent_id 非空：B4 父不存在(DEPT_NOT_FOUND) → B5 层级超限(DEPT_DEPTH_EXCEEDED)] → B6 同父重名(DEPT_NAME_DUPLICATE) → 写入
//                根（parent_id=null/缺省）：跳过 B4/B5，层级=1，仅 B6。
//       delete:  B3 鉴权 → B7 不存在(DEPT_NOT_FOUND) → B8 有子部门(DEPT_HAS_CHILDREN) → [Q1: 用户 department_id 置空] → 删除 → 204
//                **不校验 B11 / DEPT_HAS_USERS**（Q1 解除归属为副作用，非阻断）。
//       assign:  B3 鉴权 → B9 用户不存在(USER_NOT_FOUND) → [departmentId 非空：B10 部门不存在(DEPT_NOT_FOUND)] → 写入 → 返回 user
//                departmentId=null（解除归属）时跳过 B10。
//       tree:    B3 鉴权 → 返回 departmentTreeResultSchema（空树 items=[]）。
//   - router 导出：createDeptRouter / deptDeleteProcedureInputSchema / DeptProcedure 类型。
//   - DeptProcedure = Procedure & { permission: 'dept:read' | 'dept:write' }（SEC-001 元数据）。
//   - domain/dept.ts 导出常量 MAX_DEPARTMENT_DEPTH = 3 与 DepartmentEntity 类型别名。
import { describe, it, expect } from 'vitest';
import {
  departmentSchema,
  departmentTreeQuerySchema,
  departmentTreeResultSchema,
  departmentTreeNodeSchema,
  createDepartmentInputSchema,
  assignUserDepartmentInputSchema,
  permissionCodeSchema,
  userSchema,
  type ErrorCode,
  type Department,
  type User,
} from '@admin/contracts';
import { DepartmentRepository } from '../src/repository/dept.js';
import { DepartmentService } from '../src/service/dept.js';
import {
  createDeptRouter,
  deptDeleteProcedureInputSchema,
  type DeptProcedure,
} from '../src/router/dept.js';
import { MAX_DEPARTMENT_DEPTH } from '../src/domain/dept.js';
import { UserRepository } from '../src/repository/user.js';
import { AppError } from '../src/errors.js';
import type { Ctx } from '../src/context.js';
import type { Procedure } from '../src/router/user.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const PLAIN_USER_ID = '00000000-0000-4000-8000-000000000002';
const SEED_TS = '2020-01-01T00:00:00.000Z';
const MISSING_ID = '00000000-0000-4000-8000-000000000099';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };
const userCtx: Ctx = { user: { id: PLAIN_USER_ID, role: 'user' } };

function setup(): {
  deptRepo: DepartmentRepository;
  userRepo: UserRepository;
  service: DepartmentService;
  router: ReturnType<typeof createDeptRouter>;
} {
  const deptRepo = new DepartmentRepository();
  const userRepo = new UserRepository();
  userRepo.insert({
    id: ADMIN_ID,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    created_at: SEED_TS,
    updated_at: SEED_TS,
  });
  const service = new DepartmentService(deptRepo, userRepo);
  const router = createDeptRouter(service);
  return { deptRepo, userRepo, service, router };
}

function makeDept(i: number, overrides: Partial<Department> = {}): Department {
  return {
    id: `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `dept${i}`,
    parent_id: null,
    created_at: SEED_TS,
    ...overrides,
  };
}

/** 经 service 构建一条根→子→孙的三层链，返回三层节点（R=第1层, C=第2层, G=第3层）。 */
async function buildThreeLevelChain(
  service: DepartmentService,
): Promise<{ root: Department; child: Department; grandchild: Department }> {
  const root = await service.create({ name: 'R', parent_id: null }, adminCtx);
  const child = await service.create({ name: 'C', parent_id: root.id }, adminCtx);
  const grandchild = await service.create({ name: 'G', parent_id: child.id }, adminCtx);
  return { root, child, grandchild };
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
  it('MAX_DEPARTMENT_DEPTH === 3（Q4 层级上限）', () => {
    expect(MAX_DEPARTMENT_DEPTH).toBe(3);
  });
});

describe('单测 · repository CRUD（内存）', () => {
  it('初始化为空（无内置部门 seed）：list() 返回空', () => {
    const repo = new DepartmentRepository();
    expect(repo.list()).toEqual([]);
  });

  it('insert/findById：写入后可按 id 查回', () => {
    const repo = new DepartmentRepository();
    const d = makeDept(1);
    repo.insert(d);
    expect(repo.findById(d.id)).toEqual(d);
  });

  it('findById：不存在返回 undefined', () => {
    const repo = new DepartmentRepository();
    expect(repo.findById(MISSING_ID)).toBeUndefined();
  });

  it('findByParent(null)：返回根部门（parent_id=null）', () => {
    const repo = new DepartmentRepository();
    const r1 = makeDept(1, { name: 'root1' });
    const r2 = makeDept(2, { name: 'root2' });
    const child = makeDept(3, { name: 'c', parent_id: r1.id });
    repo.insert(r1);
    repo.insert(r2);
    repo.insert(child);
    const roots = repo.findByParent(null);
    expect(roots).toHaveLength(2);
    expect(roots.map((d) => d.name).sort()).toEqual(['root1', 'root2']);
  });

  it('findByParent(id)：返回该父的直接子部门', () => {
    const repo = new DepartmentRepository();
    const r = makeDept(1);
    repo.insert(r);
    const c1 = makeDept(2, { name: 'c1', parent_id: r.id });
    const c2 = makeDept(3, { name: 'c2', parent_id: r.id });
    repo.insert(c1);
    repo.insert(c2);
    const children = repo.findByParent(r.id);
    expect(children).toHaveLength(2);
    expect(children.map((d) => d.name).sort()).toEqual(['c1', 'c2']);
  });

  it('list()：返回全部部门（保持插入顺序）', () => {
    const repo = new DepartmentRepository();
    repo.insert(makeDept(1, { name: 'a' }));
    repo.insert(makeDept(2, { name: 'b' }));
    expect(repo.list()).toHaveLength(2);
    expect(repo.list()[0]!.name).toBe('a');
  });

  it('delete：删除后 findById 为空，返回 true；不存在返回 false', () => {
    const repo = new DepartmentRepository();
    const d = makeDept(1);
    repo.insert(d);
    expect(repo.delete(d.id)).toBe(true);
    expect(repo.findById(d.id)).toBeUndefined();
    expect(repo.delete(MISSING_ID)).toBe(false);
  });

  it('existsByNameUnderParent：同父同名 → true；不同父同名 → false；同父不同名 → false', () => {
    const repo = new DepartmentRepository();
    const r1 = makeDept(1, { name: 'r1' });
    const r2 = makeDept(2, { name: 'r2' });
    repo.insert(r1);
    repo.insert(r2);
    const c1 = makeDept(3, { name: 'shared', parent_id: r1.id });
    repo.insert(c1);
    // 同父同名
    expect(repo.existsByNameUnderParent('shared', r1.id)).toBe(true);
    // 不同父同名（r2 下没有 'shared'）→ false（Q3 跨父允许重名）
    expect(repo.existsByNameUnderParent('shared', r2.id)).toBe(false);
    // 根部门同名校验：r1/r2 都是根，名字不同；插入根 'rootX' 后同父(null)同名 → true
    repo.insert(makeDept(4, { name: 'rootX', parent_id: null }));
    expect(repo.existsByNameUnderParent('rootX', null)).toBe(true);
    expect(repo.existsByNameUnderParent('absent', null)).toBe(false);
  });

  it('computeDepth：根(null)=1；root=2；child=3；grandchild=4（逐层 +1）', () => {
    const repo = new DepartmentRepository();
    expect(repo.computeDepth(null)).toBe(1);
    const r = makeDept(1, { name: 'r' });
    repo.insert(r);
    expect(repo.computeDepth(r.id)).toBe(2);
    const c = makeDept(2, { name: 'c', parent_id: r.id });
    repo.insert(c);
    expect(repo.computeDepth(c.id)).toBe(3);
    const g = makeDept(3, { name: 'g', parent_id: c.id });
    repo.insert(g);
    // 第 4 层（schema/函数可计算，service 层拒绝创建）
    expect(repo.computeDepth(g.id)).toBe(4);
  });
});

describe('单测 · service 裁决', () => {
  it('create 根部门：parent_id 缺省 → 成功，层级=1，parent_id=null', async () => {
    const { service } = setup();
    const d = await service.create({ name: 'root', parent_id: null }, adminCtx);
    expect(d.parent_id).toBeNull();
    expect(d.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(d.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('create 根部门：parent_id 缺省（不传）跳过 B4/B5，仅 B6', async () => {
    const { service } = setup();
    const d = await service.create({ name: 'root2' }, adminCtx);
    expect(d.parent_id).toBeNull();
  });

  it('create 守卫序列 B4→B5：parent_id 指向不存在部门 → DEPT_NOT_FOUND（先于 B5）', async () => {
    const { service } = setup();
    await expectAppError(
      service.create({ name: 'x', parent_id: MISSING_ID }, adminCtx),
      'DEPT_NOT_FOUND',
    );
  });

  it('create 守卫序列 B5→B6：父在第 3 层 → DEPT_DEPTH_EXCEEDED（先于 B6）', async () => {
    const { service } = setup();
    const { grandchild } = await buildThreeLevelChain(service);
    await expectAppError(
      service.create({ name: 'GG', parent_id: grandchild.id }, adminCtx),
      'DEPT_DEPTH_EXCEEDED',
    );
  });

  it('create 守卫序列 B6：同父同名 → DEPT_NAME_DUPLICATE', async () => {
    const { service } = setup();
    const { root } = await buildThreeLevelChain(service);
    await service.create({ name: 'dup', parent_id: root.id }, adminCtx);
    await expectAppError(
      service.create({ name: 'dup', parent_id: root.id }, adminCtx),
      'DEPT_NAME_DUPLICATE',
    );
  });

  it('create 跨父同名 → 成功（Q3 同父唯一，跨父允许）', async () => {
    const { service } = setup();
    const r1 = await service.create({ name: 'r1', parent_id: null }, adminCtx);
    const r2 = await service.create({ name: 'r2', parent_id: null }, adminCtx);
    const a = await service.create({ name: 'shared', parent_id: r1.id }, adminCtx);
    const b = await service.create({ name: 'shared', parent_id: r2.id }, adminCtx);
    expect(a.parent_id).toBe(r1.id);
    expect(b.parent_id).toBe(r2.id);
  });

  it('delete 守卫序列 B7→B8：不存在 → DEPT_NOT_FOUND（先于 B8）', async () => {
    const { service } = setup();
    await expectAppError(service.delete(MISSING_ID, adminCtx), 'DEPT_NOT_FOUND');
  });

  it('delete 守卫序列 B8：有子部门 → DEPT_HAS_CHILDREN', async () => {
    const { service } = setup();
    const { root } = await buildThreeLevelChain(service);
    await expectAppError(service.delete(root.id, adminCtx), 'DEPT_HAS_CHILDREN');
  });

  it('delete 含用户部门 → 成功 204（Q1 解除归属，不抛 DEPT_HAS_USERS）+ 用户 department_id 置空', async () => {
    const { service, userRepo } = setup();
    const d = await service.create({ name: 'withUsers', parent_id: null }, adminCtx);
    userRepo.updateDepartmentId(ADMIN_ID, d.id, SEED_TS);
    await expect(service.delete(d.id, adminCtx)).resolves.toBeUndefined();
    const u = userRepo.findById(ADMIN_ID);
    expect(u?.department_id).toBeNull();
  });

  it('assign 守卫序列 B9→B10：用户不存在 → USER_NOT_FOUND（先于 B10）', async () => {
    const { service } = setup();
    const d = await service.create({ name: 'd', parent_id: null }, adminCtx);
    await expectAppError(
      service.assignUserDepartment(MISSING_ID, d.id, adminCtx),
      'USER_NOT_FOUND',
    );
  });

  it('assign 守卫序列 B10：部门不存在 → DEPT_NOT_FOUND', async () => {
    const { service } = setup();
    await expectAppError(
      service.assignUserDepartment(ADMIN_ID, MISSING_ID, adminCtx),
      'DEPT_NOT_FOUND',
    );
  });

  it('assign departmentId=null（解除归属）跳过 B10：即使 departmentId 不存在也不报 DEPT_NOT_FOUND', async () => {
    const { service } = setup();
    const u = await service.assignUserDepartment(ADMIN_ID, null, adminCtx);
    expect(u.department_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. 契约测 · 出参 schema 匹配 + 入参 safeParse
// ---------------------------------------------------------------------------
describe('契约测 · 出参 schema 匹配', () => {
  it('tree 空树返回匹配 departmentTreeResultSchema（.strict，items=[]）', async () => {
    const { router } = setup();
    const result = await callProc(router.tree, {}, adminCtx);
    expect(() => departmentTreeResultSchema.parse(result)).not.toThrow();
    expect(result.items).toEqual([]);
  });

  it('tree 多层级返回匹配 departmentTreeResultSchema', async () => {
    const { router } = setup();
    await callProc(router.create, { name: 'R', parent_id: null }, adminCtx);
    const tree = await callProc(router.tree, {}, adminCtx);
    expect(() => departmentTreeResultSchema.parse(tree)).not.toThrow();
  });

  it('create 返回匹配 departmentSchema（.strict，201 形态）', async () => {
    const { router } = setup();
    const result = await callProc(router.create, { name: 'root', parent_id: null }, adminCtx);
    expect(() => departmentSchema.parse(result)).not.toThrow();
    expect(result.name).toBe('root');
    expect(result.parent_id).toBeNull();
  });

  it('assign 返回匹配 userSchema（含 department_id 字段，SEC-003a 出参 1:1）', async () => {
    const { router } = setup();
    const d = await callProc(router.create, { name: 'd', parent_id: null }, adminCtx);
    const result = await callProc(
      router.assignUserDepartment,
      { userId: ADMIN_ID, departmentId: d.id },
      adminCtx,
    );
    expect(() => userSchema.parse(result)).not.toThrow();
    expect(result.id).toBe(ADMIN_ID);
    expect(result.department_id).toBe(d.id);
  });

  it('userSchema 接受 department_id 为 uuid 或 null（跨域联动字段）', () => {
    const base = {
      id: ADMIN_ID,
      name: 'admin',
      email: 'admin@example.com',
      status: 'active' as const,
      created_at: SEED_TS,
      updated_at: SEED_TS,
    };
    expect(userSchema.safeParse({ ...base, department_id: null }).success).toBe(true);
    expect(
      userSchema.safeParse({ ...base, department_id: '00000000-0000-4000-8000-000000000010' }).success,
    ).toBe(true);
  });

  it('departmentTreeResultSchema.strict：多余字段被拒绝', () => {
    expect(departmentTreeResultSchema.safeParse({ items: [], extra: 1 }).success).toBe(false);
  });

  it('departmentSchema.strict：多余字段被拒绝', () => {
    expect(
      departmentSchema.safeParse({
        id: ADMIN_ID,
        name: 'd',
        parent_id: null,
        created_at: SEED_TS,
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it('递归 departmentTreeNodeSchema：3 层嵌套样本可解析', () => {
    const sample = {
      id: ADMIN_ID,
      name: 'R',
      parent_id: null,
      created_at: SEED_TS,
      children: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          name: 'C',
          parent_id: ADMIN_ID,
          created_at: SEED_TS,
          children: [
            {
              id: '00000000-0000-4000-8000-000000000003',
              name: 'G',
              parent_id: '00000000-0000-4000-8000-000000000002',
              created_at: SEED_TS,
              children: [],
            },
          ],
        },
      ],
    };
    expect(() => departmentTreeNodeSchema.parse(sample)).not.toThrow();
  });

  it('递归 departmentTreeNodeSchema：第 4 层样本仍可解析（schema 不限层数，层数由 service 校验）', () => {
    const sample = {
      id: ADMIN_ID,
      name: 'R',
      parent_id: null,
      created_at: SEED_TS,
      children: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          name: 'C',
          parent_id: ADMIN_ID,
          created_at: SEED_TS,
          children: [
            {
              id: '00000000-0000-4000-8000-000000000003',
              name: 'G',
              parent_id: '00000000-0000-4000-8000-000000000002',
              created_at: SEED_TS,
              children: [
                {
                  id: '00000000-0000-4000-8000-000000000004',
                  name: 'GG',
                  parent_id: '00000000-0000-4000-8000-000000000003',
                  created_at: SEED_TS,
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => departmentTreeNodeSchema.parse(sample)).not.toThrow();
  });

  it('递归 departmentTreeNodeSchema.strict：节点多余字段被拒绝', () => {
    expect(
      departmentTreeNodeSchema.safeParse({
        id: ADMIN_ID,
        name: 'R',
        parent_id: null,
        created_at: SEED_TS,
        children: [],
        secret: 'leak',
      }).success,
    ).toBe(false);
  });
});

describe('契约测 · 入参 safeParse 合法/非法样本', () => {
  it('permissionCodeSchema.safeParse：dept:read 通过', () => {
    expect(permissionCodeSchema.safeParse('dept:read').success).toBe(true);
  });
  it('permissionCodeSchema.safeParse：dept:write 通过', () => {
    expect(permissionCodeSchema.safeParse('dept:write').success).toBe(true);
  });
  it('permissionCodeSchema.safeParse：非法码 foo:bar 拒绝', () => {
    expect(permissionCodeSchema.safeParse('foo:bar').success).toBe(false);
  });

  it('create: name 空串非法', () => {
    expect(createDepartmentInputSchema.safeParse({ name: '' }).success).toBe(false);
  });
  it('create: name 超 64 字符非法', () => {
    expect(createDepartmentInputSchema.safeParse({ name: 'x'.repeat(65) }).success).toBe(false);
  });
  it('create: parent_id 非 uuid 非法', () => {
    expect(
      createDepartmentInputSchema.safeParse({ name: 'r', parent_id: 'not-uuid' }).success,
    ).toBe(false);
  });
  it('create: 携带 department_id 字段非法（.strict，创建时不指定部门，Q5）', () => {
    expect(
      createDepartmentInputSchema.safeParse({
        name: 'r',
        department_id: '00000000-0000-4000-8000-000000000010',
      }).success,
    ).toBe(false);
  });
  it('create: 携带 id 字段非法（.strict，服务端生成）', () => {
    expect(
      createDepartmentInputSchema.safeParse({ name: 'r', id: ADMIN_ID }).success,
    ).toBe(false);
  });
  it('create: 仅 name 合法（parent_id 缺省=根）', () => {
    expect(createDepartmentInputSchema.safeParse({ name: 'r' }).success).toBe(true);
  });
  it('create: name + parent_id=null 合法（显式根）', () => {
    expect(createDepartmentInputSchema.safeParse({ name: 'r', parent_id: null }).success).toBe(true);
  });
  it('create: name + 合法 parent_id uuid 合法', () => {
    expect(
      createDepartmentInputSchema.safeParse({ name: 'r', parent_id: ADMIN_ID }).success,
    ).toBe(true);
  });

  it('assign: userId 非 uuid 非法', () => {
    expect(
      assignUserDepartmentInputSchema.safeParse({ userId: 'not-uuid', departmentId: ADMIN_ID })
        .success,
    ).toBe(false);
  });
  it('assign: departmentId 非 uuid 且非 null 非法', () => {
    expect(
      assignUserDepartmentInputSchema.safeParse({ userId: ADMIN_ID, departmentId: 'not-uuid' })
        .success,
    ).toBe(false);
  });
  it('assign: departmentId 缺省非法（必填+可空，消除缺省歧义）', () => {
    expect(
      assignUserDepartmentInputSchema.safeParse({ userId: ADMIN_ID }).success,
    ).toBe(false);
  });
  it('assign: departmentId=null 合法（解除归属）', () => {
    expect(
      assignUserDepartmentInputSchema.safeParse({ userId: ADMIN_ID, departmentId: null }).success,
    ).toBe(true);
  });
  it('assign: 合法 userId + departmentId(uuid) 通过', () => {
    expect(
      assignUserDepartmentInputSchema.safeParse({
        userId: ADMIN_ID,
        departmentId: '00000000-0000-4000-8000-000000000010',
      }).success,
    ).toBe(true);
  });

  it('delete procedure input: id 非 uuid 非法', () => {
    expect(deptDeleteProcedureInputSchema.safeParse({ id: 'not-uuid' }).success).toBe(false);
  });
  it('delete procedure input: 合法 uuid 通过', () => {
    expect(deptDeleteProcedureInputSchema.safeParse({ id: ADMIN_ID }).success).toBe(true);
  });

  it('tree query: 空对象合法（无参）', () => {
    expect(departmentTreeQuerySchema.safeParse({}).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. 边界 · F1-F4
// ---------------------------------------------------------------------------
describe('边界 · F1 创建部门', () => {
  it('F1: 合法名称 + 有效父 → 创建成功，挂在该父下（parent_id=父id）', async () => {
    const { router } = setup();
    const root = await callProc(router.create, { name: 'root', parent_id: null }, adminCtx);
    const child = await callProc(
      router.create,
      { name: 'child', parent_id: root.id },
      adminCtx,
    );
    expect(child.parent_id).toBe(root.id);
  });

  it('F1: 不指定 parent_id → 根部门（层级 1，parent_id=null）', async () => {
    const { router } = setup();
    const root = await callProc(router.create, { name: 'root' }, adminCtx);
    expect(root.parent_id).toBeNull();
  });

  it('F1: 父在第 3 层下创建 → DEPT_DEPTH_EXCEEDED（Q4 层级上限）', async () => {
    const { router } = setup();
    const { root, child, grandchild } = await buildThreeLevelChainViaRouter(router);
    expect(root.parent_id).toBeNull();
    expect(child.parent_id).toBe(root.id);
    expect(grandchild.parent_id).toBe(child.id);
    await expectAppError(
      callProc(router.create, { name: 'gg', parent_id: grandchild.id }, adminCtx),
      'DEPT_DEPTH_EXCEEDED',
    );
  });

  it('F1: 同父同名 → DEPT_NAME_DUPLICATE', async () => {
    const { router } = setup();
    const root = await callProc(router.create, { name: 'root', parent_id: null }, adminCtx);
    await callProc(router.create, { name: 'dup', parent_id: root.id }, adminCtx);
    await expectAppError(
      callProc(router.create, { name: 'dup', parent_id: root.id }, adminCtx),
      'DEPT_NAME_DUPLICATE',
    );
  });

  it('F1: 不同父同名 → 成功（Q3 跨父允许重名）', async () => {
    const { router } = setup();
    const r1 = await callProc(router.create, { name: 'r1', parent_id: null }, adminCtx);
    const r2 = await callProc(router.create, { name: 'r2', parent_id: null }, adminCtx);
    const a = await callProc(router.create, { name: 'shared', parent_id: r1.id }, adminCtx);
    const b = await callProc(router.create, { name: 'shared', parent_id: r2.id }, adminCtx);
    expect(a.parent_id).toBe(r1.id);
    expect(b.parent_id).toBe(r2.id);
  });

  it('F1: parent_id 指向不存在部门 → DEPT_NOT_FOUND', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.create, { name: 'x', parent_id: MISSING_ID }, adminCtx),
      'DEPT_NOT_FOUND',
    );
  });

  it('F1: name 空串 → VALIDATION_ERROR', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.create, { name: '', parent_id: null }, adminCtx),
      'VALIDATION_ERROR',
    );
  });

  it('F1: name 超 64 字符 → VALIDATION_ERROR', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.create, { name: 'x'.repeat(65), parent_id: null }, adminCtx),
      'VALIDATION_ERROR',
    );
  });
});

describe('边界 · F2 查看树', () => {
  it('F2: 无任何部门 → items=[]', async () => {
    const { router } = setup();
    const result = await callProc(router.tree, {}, adminCtx);
    expect(result.items).toEqual([]);
    expect(() => departmentTreeResultSchema.parse(result)).not.toThrow();
  });

  it('F2: 多层级树结构正确体现父子归属与层级', async () => {
    const { router } = setup();
    const { root, child, grandchild } = await buildThreeLevelChainViaRouter(router);
    const result = await callProc(router.tree, {}, adminCtx);
    expect(result.items).toHaveLength(1);
    const r = result.items[0]!;
    expect(r.id).toBe(root.id);
    expect(r.children).toHaveLength(1);
    expect(r.children[0]!.id).toBe(child.id);
    expect(r.children[0]!.children).toHaveLength(1);
    expect(r.children[0]!.children[0]!.id).toBe(grandchild.id);
    expect(r.children[0]!.children[0]!.children).toEqual([]);
  });

  it('F2: 叶节点 children=[]', async () => {
    const { router } = setup();
    await callProc(router.create, { name: 'lonely', parent_id: null }, adminCtx);
    const result = await callProc(router.tree, {}, adminCtx);
    expect(result.items[0]!.children).toEqual([]);
  });

  it('F2: 多根部门各自成树', async () => {
    const { router } = setup();
    const r1 = await callProc(router.create, { name: 'r1', parent_id: null }, adminCtx);
    const r2 = await callProc(router.create, { name: 'r2', parent_id: null }, adminCtx);
    await callProc(router.create, { name: 'c1', parent_id: r1.id }, adminCtx);
    const result = await callProc(router.tree, {}, adminCtx);
    expect(result.items).toHaveLength(2);
    const root1 = result.items.find((n) => n.id === r1.id);
    const root2 = result.items.find((n) => n.id === r2.id);
    expect(root1?.children).toHaveLength(1);
    expect(root2?.children).toEqual([]);
  });
});

describe('边界 · F3 删除部门', () => {
  it('F3: 无子无用户 → 204（resolve undefined）', async () => {
    const { router } = setup();
    const d = await callProc(router.create, { name: 'leaf', parent_id: null }, adminCtx);
    await expect(callProc(router.delete, { id: d.id }, adminCtx)).resolves.toBeUndefined();
  });

  it('F3: 无子有用户 → 204 且用户 department_id 置空（Q1 解除归属，账号保留）', async () => {
    const { router, userRepo } = setup();
    const d = await callProc(router.create, { name: 'withUsers', parent_id: null }, adminCtx);
    userRepo.updateDepartmentId(ADMIN_ID, d.id, SEED_TS);
    await expect(callProc(router.delete, { id: d.id }, adminCtx)).resolves.toBeUndefined();
    expect(userRepo.findById(ADMIN_ID)?.department_id).toBeNull();
  });

  it('F3: 有子部门 → DEPT_HAS_CHILDREN（Q2 禁止级联）', async () => {
    const { router } = setup();
    const { root } = await buildThreeLevelChainViaRouter(router);
    await expectAppError(callProc(router.delete, { id: root.id }, adminCtx), 'DEPT_HAS_CHILDREN');
  });

  it('F3: 不存在 → DEPT_NOT_FOUND', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.delete, { id: MISSING_ID }, adminCtx), 'DEPT_NOT_FOUND');
  });

  it('F3: 含子 + 含用户同时命中 → 先 DEPT_HAS_CHILDREN（B8 在 Q1 解除前）', async () => {
    const { router, userRepo } = setup();
    const { root } = await buildThreeLevelChainViaRouter(router);
    userRepo.updateDepartmentId(ADMIN_ID, root.id, SEED_TS);
    await expectAppError(callProc(router.delete, { id: root.id }, adminCtx), 'DEPT_HAS_CHILDREN');
    // 用户尚未被解除（B8 先返，Q1 未执行）
    expect(userRepo.findById(ADMIN_ID)?.department_id).toBe(root.id);
  });

  it('F3: 删除含用户部门不抛 DEPT_HAS_USERS（B11 预留码本期不触发）', async () => {
    const { router, userRepo } = setup();
    const d = await callProc(router.create, { name: 'd', parent_id: null }, adminCtx);
    userRepo.updateDepartmentId(ADMIN_ID, d.id, SEED_TS);
    // 应成功（resolve），而非抛 DEPT_HAS_USERS
    await expect(callProc(router.delete, { id: d.id }, adminCtx)).resolves.toBeUndefined();
  });
});

describe('边界 · F4 分配用户部门', () => {
  it('F4: 无部门用户归属 D → 200 返回 user 含 department_id=D', async () => {
    const { router } = setup();
    const d = await callProc(router.create, { name: 'D', parent_id: null }, adminCtx);
    const result = await callProc(
      router.assignUserDepartment,
      { userId: ADMIN_ID, departmentId: d.id },
      adminCtx,
    );
    expect(result.department_id).toBe(d.id);
  });

  it('F4: 已归属 D1 改归属 D2 → 覆盖为 D2（一个用户仅属一个部门）', async () => {
    const { router } = setup();
    const d1 = await callProc(router.create, { name: 'D1', parent_id: null }, adminCtx);
    const d2 = await callProc(router.create, { name: 'D2', parent_id: null }, adminCtx);
    await callProc(
      router.assignUserDepartment,
      { userId: ADMIN_ID, departmentId: d1.id },
      adminCtx,
    );
    const result = await callProc(
      router.assignUserDepartment,
      { userId: ADMIN_ID, departmentId: d2.id },
      adminCtx,
    );
    expect(result.department_id).toBe(d2.id);
  });

  it('F4: 解除归属（departmentId=null）→ department_id=null', async () => {
    const { router } = setup();
    const d = await callProc(router.create, { name: 'D', parent_id: null }, adminCtx);
    await callProc(
      router.assignUserDepartment,
      { userId: ADMIN_ID, departmentId: d.id },
      adminCtx,
    );
    const result = await callProc(
      router.assignUserDepartment,
      { userId: ADMIN_ID, departmentId: null },
      adminCtx,
    );
    expect(result.department_id).toBeNull();
  });

  it('F4: 不存在用户 → USER_NOT_FOUND', async () => {
    const { router } = setup();
    const d = await callProc(router.create, { name: 'D', parent_id: null }, adminCtx);
    await expectAppError(
      callProc(
        router.assignUserDepartment,
        { userId: MISSING_ID, departmentId: d.id },
        adminCtx,
      ),
      'USER_NOT_FOUND',
    );
  });

  it('F4: 不存在部门 → DEPT_NOT_FOUND', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(
        router.assignUserDepartment,
        { userId: ADMIN_ID, departmentId: MISSING_ID },
        adminCtx,
      ),
      'DEPT_NOT_FOUND',
    );
  });

  it('F4: 部门被删后原归属用户 department_id=null（Q1 语义闭环）', async () => {
    const { router, userRepo } = setup();
    const d = await callProc(router.create, { name: 'D', parent_id: null }, adminCtx);
    await callProc(
      router.assignUserDepartment,
      { userId: ADMIN_ID, departmentId: d.id },
      adminCtx,
    );
    await callProc(router.delete, { id: d.id }, adminCtx);
    const u = userRepo.findById(ADMIN_ID);
    expect(u?.department_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. 权限 · SEC-002 / SEC-003 / SEC-001
// ---------------------------------------------------------------------------
describe('权限 · SEC-002 非 admin 各 procedure → FORBIDDEN', () => {
  it('非 admin 调 tree → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.tree, {}, userCtx), 'FORBIDDEN');
  });

  it('非 admin 调 create → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.create, { name: 'x', parent_id: null }, userCtx),
      'FORBIDDEN',
    );
  });

  it('非 admin 调 delete → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.delete, { id: ADMIN_ID }, userCtx), 'FORBIDDEN');
  });

  it('非 admin 调 assignUserDepartment → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(
        router.assignUserDepartment,
        { userId: ADMIN_ID, departmentId: null },
        userCtx,
      ),
      'FORBIDDEN',
    );
  });
});

describe('权限 · SEC-003 出参 .strict 不夹带 PII', () => {
  it('SEC-003: tree 出参匹配 departmentTreeResultSchema（.strict，无多余字段）', async () => {
    const { router } = setup();
    await callProc(router.create, { name: 'R', parent_id: null }, adminCtx);
    const result = await callProc(router.tree, {}, adminCtx);
    expect(() => departmentTreeResultSchema.parse(result)).not.toThrow();
  });

  it('SEC-003: create 出参匹配 departmentSchema（.strict，无 PII）', async () => {
    const { router } = setup();
    const result = await callProc(router.create, { name: 'R', parent_id: null }, adminCtx);
    expect(() => departmentSchema.parse(result)).not.toThrow();
  });

  it('SEC-003: assign 出参匹配 userSchema（.strict）', async () => {
    const { router } = setup();
    const d = await callProc(router.create, { name: 'D', parent_id: null }, adminCtx);
    const result = await callProc(
      router.assignUserDepartment,
      { userId: ADMIN_ID, departmentId: d.id },
      adminCtx,
    );
    expect(() => userSchema.parse(result)).not.toThrow();
  });
});

describe('权限 · SEC-001 procedure 元数据声明', () => {
  it('tree.permission === "dept:read"（查看树）', () => {
    const { router } = setup();
    expect((router.tree as DeptProcedure<unknown, unknown>).permission).toBe('dept:read');
  });

  it('create.permission === "dept:write"', () => {
    const { router } = setup();
    expect((router.create as DeptProcedure<unknown, unknown>).permission).toBe('dept:write');
  });

  it('delete.permission === "dept:write"', () => {
    const { router } = setup();
    expect((router.delete as DeptProcedure<unknown, unknown>).permission).toBe('dept:write');
  });

  it('assignUserDepartment.permission === "dept:write"', () => {
    const { router } = setup();
    expect(
      (router.assignUserDepartment as DeptProcedure<unknown, unknown>).permission,
    ).toBe('dept:write');
  });
});

// ---------------------------------------------------------------------------
// 5. 状态机 · 守卫序列顺序 + 删除前置链 + Q1 闭环
// ---------------------------------------------------------------------------
describe('状态机 · 守卫序列顺序', () => {
  it('create: 父不存在 + 层级超限同时命中 → 先 DEPT_NOT_FOUND（B4 优先 B5）', async () => {
    const { service } = setup();
    // MISSING_ID 不存在 → B4 先返（B5 层级推导需父存在，无法触发）
    await expectAppError(
      service.create({ name: 'x', parent_id: MISSING_ID }, adminCtx),
      'DEPT_NOT_FOUND',
    );
  });

  it('create: 层级超限 + 同名同时命中 → 先 DEPT_DEPTH_EXCEEDED（B5 优先 B6）', async () => {
    const { service, deptRepo } = setup();
    const { root, child, grandchild } = await buildThreeLevelChain(service);
    // 在 grandchild 下预置一条同名 'dup'（直接 repo.insert 绕过 service 的 B5 校验）
    deptRepo.insert(
      makeDept(50, { name: 'dup', parent_id: grandchild.id, created_at: SEED_TS }),
    );
    // service.create：grandchild 在第 3 层 → B5 层级超限先于 B6 同名
    await expectAppError(
      service.create({ name: 'dup', parent_id: grandchild.id }, adminCtx),
      'DEPT_DEPTH_EXCEEDED',
    );
    // 去掉层级问题后，同名才触发 B6（用 root 下预置同名验证 B6 可达）
    deptRepo.insert(makeDept(51, { name: 'dup2', parent_id: root.id, created_at: SEED_TS }));
    await expectAppError(
      service.create({ name: 'dup2', parent_id: root.id }, adminCtx),
      'DEPT_NAME_DUPLICATE',
    );
  });

  it('delete: 不存在 + 有子同时命中 → 先 DEPT_NOT_FOUND（B7 优先 B8）', async () => {
    const { service } = setup();
    // MISSING_ID 不存在 → B7 先返（B8 有子无从触发）
    await expectAppError(service.delete(MISSING_ID, adminCtx), 'DEPT_NOT_FOUND');
  });

  it('assign: 用户不存在 + 部门不存在同时命中 → 先 USER_NOT_FOUND（B9 优先 B10）', async () => {
    const { service } = setup();
    await expectAppError(
      service.assignUserDepartment(MISSING_ID, MISSING_ID, adminCtx),
      'USER_NOT_FOUND',
    );
  });
});

describe('状态机 · 删除前置链 + Q1 闭环', () => {
  it('删除前置链：有子 → DEPT_HAS_CHILDREN → 逐个删除子部门 → 再次删除本部门 → 204（Q2 闭环）', async () => {
    const { router } = setup();
    const root = await callProc(router.create, { name: 'root', parent_id: null }, adminCtx);
    const c1 = await callProc(router.create, { name: 'c1', parent_id: root.id }, adminCtx);
    const c2 = await callProc(router.create, { name: 'c2', parent_id: root.id }, adminCtx);
    // root 有子 → 拒
    await expectAppError(callProc(router.delete, { id: root.id }, adminCtx), 'DEPT_HAS_CHILDREN');
    // 逐个删子
    await callProc(router.delete, { id: c1.id }, adminCtx);
    await callProc(router.delete, { id: c2.id }, adminCtx);
    // 再次删 root → 204
    await expect(callProc(router.delete, { id: root.id }, adminCtx)).resolves.toBeUndefined();
  });

  it('Q1 闭环：删除含用户部门 → 用户 department_id=null → 再次查用户确认无归属', async () => {
    const { router, userRepo, service } = setup();
    const d = await callProc(router.create, { name: 'd', parent_id: null }, adminCtx);
    await callProc(
      router.assignUserDepartment,
      { userId: ADMIN_ID, departmentId: d.id },
      adminCtx,
    );
    expect(userRepo.findById(ADMIN_ID)?.department_id).toBe(d.id);
    await service.delete(d.id, adminCtx);
    expect(userRepo.findById(ADMIN_ID)?.department_id).toBeNull();
    // 再次 assign null 仍成功（幂等解除）
    const u = await service.assignUserDepartment(ADMIN_ID, null, adminCtx);
    expect(u.department_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 辅助：经 router 构建三层链（F1/F2/F3 边界用例复用）
// ---------------------------------------------------------------------------
async function buildThreeLevelChainViaRouter(router: ReturnType<typeof createDeptRouter>): Promise<{
  root: Department;
  child: Department;
  grandchild: Department;
}> {
  const root = await callProc(router.create, { name: 'R', parent_id: null }, adminCtx);
  const child = await callProc(router.create, { name: 'C', parent_id: root.id }, adminCtx);
  const grandchild = await callProc(router.create, { name: 'G', parent_id: child.id }, adminCtx);
  return { root, child, grandchild };
}
