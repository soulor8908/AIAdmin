// apps/api/test/user.test.ts —— 测试先行（AI-002）
// 本文件先于实现产出，覆盖 Tech-Spec TECH-USER-001 测试矩阵五类：
//   1. 单测 · domain 状态机转移函数
//   2. 契约测 · 出参 schema 匹配 + 入参 safeParse 合法/非法样本
//   3. 边界 · 入参越界 / 邮箱重复 / 重复禁用 / 重复启用 / 用户不存在 / 禁用自身 / 分页
//   4. 权限 · 非 admin 调用各 procedure → FORBIDDEN；管理员启用自身 → 成功
//   5. 状态机 · active → disabled → active 全路径
import { describe, it, expect } from 'vitest';
import {
  userListResultSchema,
  userSchema,
  listUserQuerySchema,
  createUserInputSchema,
  type ErrorCode,
  type User,
} from '@admin/contracts';
import { UserRepository } from '../src/repository/user.js';
import { UserService } from '../src/service/user.js';
import {
  createUserRouter,
  updateUserStatusProcedureInputSchema,
  type Procedure,
} from '../src/router/user.js';
import { transitionStatus } from '../src/domain/user.js';
import { AppError } from '../src/errors.js';
import type { Ctx } from '../src/context.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const USER_ROLE_ID = '00000000-0000-4000-8000-000000000002';
const SEED_TS = '2020-01-01T00:00:00.000Z';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };
const userCtx: Ctx = { user: { id: USER_ROLE_ID, role: 'user' } };

function setup(): { repo: UserRepository; service: UserService; router: ReturnType<typeof createUserRouter> } {
  const repo = new UserRepository();
  const service = new UserService(repo);
  const router = createUserRouter(service);
  return { repo, service, router };
}

function makeUser(i: number, overrides: Partial<User> = {}): User {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `user${i}`,
    email: `user${i}@example.com`,
    status: 'active',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    ...overrides,
  };
}

function seedUsers(repo: UserRepository, n: number, start = 0): User[] {
  const users: User[] = [];
  for (let i = 0; i < n; i++) {
    const u = makeUser(start + i);
    repo.insert(u);
    users.push(u);
  }
  return users;
}

function firstUser(users: User[]): User {
  const u = users[0];
  if (!u) throw new Error('test setup: expected at least one seeded user');
  return u;
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
// 1. 单测 · domain 状态机转移函数
// ---------------------------------------------------------------------------
describe('单测 · domain 状态机 transitionStatus', () => {
  it('active → disabled 合法转移，next=disabled', () => {
    const r = transitionStatus('active', 'disabled');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('disabled');
  });

  it('disabled → active 合法转移，next=active', () => {
    const r = transitionStatus('disabled', 'active');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('active');
  });

  it('active → active 非法（重复启用）→ USER_ALREADY_ACTIVE', () => {
    const r = transitionStatus('active', 'active');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('USER_ALREADY_ACTIVE');
  });

  it('disabled → disabled 非法（重复禁用）→ USER_ALREADY_DISABLED', () => {
    const r = transitionStatus('disabled', 'disabled');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('USER_ALREADY_DISABLED');
  });
});

// ---------------------------------------------------------------------------
// 2. 契约测 · 出参 schema 匹配 + 入参 safeParse
// ---------------------------------------------------------------------------
describe('契约测 · 出参 schema 匹配', () => {
  it('list 返回结构匹配 userListResultSchema', async () => {
    const { repo, router } = setup();
    seedUsers(repo, 3);
    const result = await callProc(router.list, { page: 1, pageSize: 10 }, adminCtx);
    expect(() => userListResultSchema.parse(result)).not.toThrow();
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(1);
  });

  it('create 返回匹配 userSchema，且 status=active', async () => {
    const { router } = setup();
    const result = await callProc(router.create, { email: 'new@example.com', name: 'New' }, adminCtx);
    expect(() => userSchema.parse(result)).not.toThrow();
    expect(result.status).toBe('active');
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('updateStatus 返回匹配 userSchema', async () => {
    const { repo, router } = setup();
    const u = firstUser(seedUsers(repo, 1));
    const result = await callProc(
      router.updateStatus,
      { id: u.id, body: { status: 'disabled' } },
      adminCtx,
    );
    expect(() => userSchema.parse(result)).not.toThrow();
    expect(result.status).toBe('disabled');
  });
});

describe('契约测 · 入参 safeParse 合法/非法样本', () => {
  it('list: page=0 非法', () => {
    expect(listUserQuerySchema.safeParse({ page: 0, pageSize: 10 }).success).toBe(false);
  });
  it('list: pageSize=101 非法', () => {
    expect(listUserQuerySchema.safeParse({ page: 1, pageSize: 101 }).success).toBe(false);
  });
  it('list: status 非枚举值非法', () => {
    expect(listUserQuerySchema.safeParse({ page: 1, pageSize: 10, status: 'invalid' }).success).toBe(false);
  });
  it('list: 合法样本通过（带/不带 status）', () => {
    expect(listUserQuerySchema.safeParse({ page: 1, pageSize: 10 }).success).toBe(true);
    expect(listUserQuerySchema.safeParse({ page: 2, pageSize: 20, status: 'active' }).success).toBe(true);
  });
  it('create: email 缺 @ 非法', () => {
    expect(createUserInputSchema.safeParse({ email: 'noat.com', name: 'X' }).success).toBe(false);
  });
  it('create: name 空串非法', () => {
    expect(createUserInputSchema.safeParse({ email: 'a@b.com', name: '' }).success).toBe(false);
  });
  it('create: 合法样本通过', () => {
    expect(createUserInputSchema.safeParse({ email: 'a@b.com', name: 'Alice' }).success).toBe(true);
  });
  it('updateStatus: id 非 uuid 非法', () => {
    expect(
      updateUserStatusProcedureInputSchema.safeParse({ id: 'not-uuid', body: { status: 'active' } }).success,
    ).toBe(false);
  });
  it('updateStatus: status 非枚举非法', () => {
    expect(
      updateUserStatusProcedureInputSchema.safeParse({
        id: '00000000-0000-4000-8000-000000000001',
        body: { status: 'invalid' },
      }).success,
    ).toBe(false);
  });
  it('updateStatus: 合法样本通过', () => {
    expect(
      updateUserStatusProcedureInputSchema.safeParse({
        id: '00000000-0000-4000-8000-000000000001',
        body: { status: 'disabled' },
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. 边界
// ---------------------------------------------------------------------------
describe('边界', () => {
  it('page=0 经 procedure 触发 VALIDATION_ERROR', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.list, { page: 0, pageSize: 10 }, adminCtx), 'VALIDATION_ERROR');
  });

  it('pageSize=101 经 procedure 触发 VALIDATION_ERROR', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.list, { page: 1, pageSize: 101 }, adminCtx), 'VALIDATION_ERROR');
  });

  it('status 非法经 procedure 触发 VALIDATION_ERROR', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.list, { page: 1, pageSize: 10, status: 'invalid' }, adminCtx),
      'VALIDATION_ERROR',
    );
  });

  it('email 重复 → USER_EMAIL_DUPLICATE', async () => {
    const { router } = setup();
    await callProc(router.create, { email: 'dup@example.com', name: 'A' }, adminCtx);
    await expectAppError(
      callProc(router.create, { email: 'dup@example.com', name: 'B' }, adminCtx),
      'USER_EMAIL_DUPLICATE',
    );
  });

  it('重复禁用 → USER_ALREADY_DISABLED', async () => {
    const { repo, router } = setup();
    const u = firstUser(seedUsers(repo, 1));
    await callProc(router.updateStatus, { id: u.id, body: { status: 'disabled' } }, adminCtx);
    await expectAppError(
      callProc(router.updateStatus, { id: u.id, body: { status: 'disabled' } }, adminCtx),
      'USER_ALREADY_DISABLED',
    );
  });

  it('重复启用 → USER_ALREADY_ACTIVE', async () => {
    const { repo, router } = setup();
    const u = firstUser(seedUsers(repo, 1));
    await expectAppError(
      callProc(router.updateStatus, { id: u.id, body: { status: 'active' } }, adminCtx),
      'USER_ALREADY_ACTIVE',
    );
  });

  it('目标用户不存在 → USER_NOT_FOUND', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(
        router.updateStatus,
        { id: '00000000-0000-4000-8000-000000000099', body: { status: 'disabled' } },
        adminCtx,
      ),
      'USER_NOT_FOUND',
    );
  });

  it('禁用自身 → USER_DISABLE_SELF_FORBIDDEN', async () => {
    const { repo, router } = setup();
    repo.insert(
      makeUser(99, { id: ADMIN_ID, name: 'admin', email: 'admin@example.com' }),
    );
    await expectAppError(
      callProc(router.updateStatus, { id: ADMIN_ID, body: { status: 'disabled' } }, adminCtx),
      'USER_DISABLE_SELF_FORBIDDEN',
    );
  });

  it('顺序校验：自身且已禁用 → B6 优先 B7（USER_DISABLE_SELF_FORBIDDEN）', async () => {
    const { repo, router } = setup();
    repo.insert(
      makeUser(99, {
        id: ADMIN_ID,
        name: 'admin',
        email: 'admin@example.com',
        status: 'disabled',
      }),
    );
    await expectAppError(
      callProc(router.updateStatus, { id: ADMIN_ID, body: { status: 'disabled' } }, adminCtx),
      'USER_DISABLE_SELF_FORBIDDEN',
    );
  });

  it('F1: 25 条数据 page=2 pageSize=10 → 11-20 条，total=25 totalPages=3', async () => {
    const { repo, router } = setup();
    seedUsers(repo, 25);
    const result = await callProc(router.list, { page: 2, pageSize: 10 }, adminCtx);
    expect(result.items).toHaveLength(10);
    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(() => userListResultSchema.parse(result)).not.toThrow();
  });

  it('F1: 空库 page=1 → items=[] total=0 totalPages=0', async () => {
    const { router } = setup();
    const result = await callProc(router.list, { page: 1, pageSize: 10 }, adminCtx);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it('F1: status=disabled 过滤后启用用户不出现；未传 status 返回全部', async () => {
    const { repo, router } = setup();
    const users = seedUsers(repo, 3);
    const first = firstUser(users);
    repo.updateStatus(first.id, 'disabled', new Date().toISOString());

    const disabledOnly = await callProc(router.list, { page: 1, pageSize: 10, status: 'disabled' }, adminCtx);
    expect(disabledOnly.items).toHaveLength(1);
    expect(disabledOnly.items[0]?.id).toBe(first.id);
    expect(disabledOnly.total).toBe(1);

    const all = await callProc(router.list, { page: 1, pageSize: 10 }, adminCtx);
    expect(all.total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. 权限
// ---------------------------------------------------------------------------
describe('权限 · SEC-002', () => {
  it('非 admin 调 list → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.list, { page: 1, pageSize: 10 }, userCtx), 'FORBIDDEN');
  });

  it('非 admin 调 create → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.create, { email: 'x@y.com', name: 'X' }, userCtx),
      'FORBIDDEN',
    );
  });

  it('非 admin 调 updateStatus → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(
        router.updateStatus,
        { id: '00000000-0000-4000-8000-000000000001', body: { status: 'disabled' } },
        userCtx,
      ),
      'FORBIDDEN',
    );
  });

  it('管理员启用自身 → 成功（不禁止自我启用）', async () => {
    const { repo, router } = setup();
    repo.insert(
      makeUser(99, {
        id: ADMIN_ID,
        name: 'admin',
        email: 'admin@example.com',
        status: 'disabled',
      }),
    );
    const result = await callProc(
      router.updateStatus,
      { id: ADMIN_ID, body: { status: 'active' } },
      adminCtx,
    );
    expect(result.status).toBe('active');
    expect(() => userSchema.parse(result)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. 状态机 · active → disabled → active 全路径
// ---------------------------------------------------------------------------
describe('状态机 · active → disabled → active 全路径', () => {
  it('active → disabled → active 完整流转，每次 updated_at 刷新', async () => {
    const { repo, router } = setup();
    const u = firstUser(seedUsers(repo, 1));

    const afterDisable = await callProc(
      router.updateStatus,
      { id: u.id, body: { status: 'disabled' } },
      adminCtx,
    );
    expect(afterDisable.status).toBe('disabled');
    expect(afterDisable.updated_at).not.toBe(u.updated_at);
    expect(() => userSchema.parse(afterDisable)).not.toThrow();

    const afterEnable = await callProc(
      router.updateStatus,
      { id: u.id, body: { status: 'active' } },
      adminCtx,
    );
    expect(afterEnable.status).toBe('active');
    expect(afterEnable.updated_at).not.toBe(u.updated_at);
    expect(() => userSchema.parse(afterEnable)).not.toThrow();
  });

  it('全路径中重复状态被拒绝：active→active=ALREADY_ACTIVE；disabled→disabled=ALREADY_DISABLED', async () => {
    const { repo, router } = setup();
    const u = firstUser(seedUsers(repo, 1));

    await expectAppError(
      callProc(router.updateStatus, { id: u.id, body: { status: 'active' } }, adminCtx),
      'USER_ALREADY_ACTIVE',
    );

    await callProc(router.updateStatus, { id: u.id, body: { status: 'disabled' } }, adminCtx);

    await expectAppError(
      callProc(router.updateStatus, { id: u.id, body: { status: 'disabled' } }, adminCtx),
      'USER_ALREADY_DISABLED',
    );
  });
});
