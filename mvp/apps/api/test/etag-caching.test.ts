// apps/api/test/etag-caching.test.ts —— ③类新增 ETag 协商缓存测试（TECH-ETAG-CACHING-001）
//
// 本文件覆盖 PRD-ETAG-CACHING-001 的 17 个 AC 中可在 service/HTTP-header 层单测的部分（F1-F4 共 15 AC）：
//   - 单测 · src/etag.ts 纯函数（detailEtag / listEtag / parseIfNoneMatch）
//   - F1 ETag 生成（AC-F1-1~F1-4）：detail 响应含 ETag / ETag 随 version 递增 / ETag 格式合规 / 内置 admin ETag 恒 "0"
//   - F2 If-None-Match 协商（AC-F2-1~F2-4）：匹配→304 / 不匹配→200 / 缺失→200 / 格式非法→忽略 200
//   - F3 list ETag（AC-F3-1~F3-5）：list 含 ETag / 匹配→304 / create 后 ETag 变 / update 后 ETag 变 / 缺失→200
//   - F4 缓存失效（AC-F4-1~F4-2）：update 后 detail 304→200 / delete 后 list 304→200
//
// F2 协商缓存通过 parseIfNoneMatch + ETag 比对模拟 server.ts D9 的 304/200 决策逻辑（不经 HTTP），
// 端到端 HTTP 协商缓存（含 AC-F4-3 全链路）在 etag-caching-embedding.test.ts 中覆盖。
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - ETag 生成纯函数（detailEtag/listEtag/parseIfNoneMatch）从 src/etag.ts import（D7/D8，HTTP 层工具模块）。
//   - 行为测通过 callProc 调 router procedure 获取实体（读操作无 expected_version），验证 ETag 生成所需数据可用。
//   - 写操作（create/update/delete）通过 service 直接调用（携带 expected_version），构造 ETag 变化场景。
//   - negotiate() 辅助函数模拟 server.ts D9 的 304/200 决策：parseIfNoneMatch + ETag 比对。
//   - CODE-001：无 any 类型标注或断言，用 unknown + 类型守卫。
//   - user 无 detail 端点（Tech-Spec advisory 覆盖范围修正），F1 detail 测试用 role/notification。
import { describe, it, expect } from 'vitest';
import {
  userSchema,
  roleSchema,
  notificationSchema,
  userListResultSchema,
  roleListResultSchema,
  notificationListResultSchema,
  type Role,
  type Notification,
  type UserListResult,
  type RoleListResult,
  type NotificationListResult,
} from '@admin/contracts';
import { detailEtag, listEtag, parseIfNoneMatch } from '../src/etag.js';
import { UserRepository } from '../src/repository/user.js';
import { UserService } from '../src/service/user.js';
import { RoleRepository } from '../src/repository/role.js';
import { RoleService } from '../src/service/role.js';
import { NotificationRepository } from '../src/repository/notification.js';
import { NotificationService } from '../src/service/notification.js';
import { createUserRouter } from '../src/router/user.js';
import { createRoleRouter } from '../src/router/role.js';
import { createNotificationRouter } from '../src/router/notification.js';
import type { Procedure } from '../src/router/user.js';
import { BUILTIN_ADMIN_ROLE_NAME } from '../src/domain/role.js';
import type { Ctx } from '../src/context.js';
import { AppError } from '../src/errors.js';
import { createTestDb } from './helpers/db.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const TARGET_ID = '00000000-0000-4000-8000-000000000002';
const RECIPIENT_ID = '00000000-0000-4000-8000-000000000003';
const SEED_TS = '2020-01-01T00:00:00.000Z';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };

// ===========================================================================
// 辅助函数
// ===========================================================================

/** 模拟 router 层执行：safeParse 失败统一转 VALIDATION_ERROR，成功则调 handler。 */
async function callProc<I, O>(proc: Procedure<I, O>, raw: unknown, ctx: Ctx): Promise<O> {
  const parsed = proc.input.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', parsed.error.message);
  }
  return proc.handler(parsed.data, ctx);
}

/**
 * 模拟 server.ts D9 的 304 协商缓存决策逻辑（TECH-ETAG-CACHING-001 D9）。
 * - parseIfNoneMatch 解析 If-None-Match header → ETag 字符串或 null（缺失/非法）。
 * - ETag 匹配 → 304；不匹配/缺失/非法 → 200。
 * @returns 304（ETag 匹配）或 200（不匹配/缺失/非法）。
 */
function negotiate(etag: string, ifNoneMatchHeader: string | undefined): 200 | 304 {
  const ifNoneMatch = parseIfNoneMatch(ifNoneMatchHeader);
  if (ifNoneMatch !== null && ifNoneMatch === etag) {
    return 304;
  }
  return 200;
}

/** user setup：创建 userRepo（含 admin 操作者 + 独立 target 用户）+ userService + router。 */
function setupUser(): {
  repo: UserRepository;
  service: UserService;
  router: ReturnType<typeof createUserRouter>;
} {
  const db = createTestDb();
  const repo = new UserRepository(db);
  repo.insert({
    id: ADMIN_ID,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 0,
    password_hash: 'test-hash-placeholder',
  });
  repo.insert({
    id: TARGET_ID,
    name: 'target',
    email: 'target@example.com',
    status: 'active',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 0,
    password_hash: 'test-hash-placeholder',
  });
  const service = new UserService(repo);
  const router = createUserRouter(service);
  return { repo, service, router };
}

/**
 * user setup（指定 versions）：创建 userRepo 含 admin(v0) + target(v5) + recipient(v2)。
 * 用于 F3-3/F3-4 list ETag 变化场景（total=3, maxVersion=5 → ETag="3-5"）。
 */
function setupUserWithVersions(): {
  repo: UserRepository;
  service: UserService;
  router: ReturnType<typeof createUserRouter>;
} {
  const db = createTestDb();
  const repo = new UserRepository(db);
  repo.insert({
    id: ADMIN_ID,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 0,
    password_hash: 'test-hash-placeholder',
  });
  repo.insert({
    id: TARGET_ID,
    name: 'target',
    email: 'target@example.com',
    status: 'active',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 5,
    password_hash: 'test-hash-placeholder',
  });
  repo.insert({
    id: RECIPIENT_ID,
    name: 'recipient',
    email: 'recipient@example.com',
    status: 'active',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 2,
    password_hash: 'test-hash-placeholder',
  });
  const service = new UserService(repo);
  const router = createUserRouter(service);
  return { repo, service, router };
}

/** role setup：创建 roleRepo（构造时自动 seed 内置 admin，version=0）+ userRepo + roleService + router。 */
function setupRole(): {
  repo: RoleRepository;
  userRepo: UserRepository;
  service: RoleService;
  router: ReturnType<typeof createRoleRouter>;
} {
  // 多 repo 共享同一 db（RoleService 跨 role/user repo 查询）
  const db = createTestDb();
  const repo = new RoleRepository(db);
  const userRepo = new UserRepository(db);
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
  const service = new RoleService(repo, userRepo);
  const router = createRoleRouter(service);
  return { repo, userRepo, service, router };
}

/** notification setup：创建 userRepo（含 active 收件人）+ userService + notificationRepo + notificationService + router。 */
function setupNotification(): {
  userRepo: UserRepository;
  userService: UserService;
  repo: NotificationRepository;
  service: NotificationService;
  router: ReturnType<typeof createNotificationRouter>;
} {
  // 多 repo 共享同一 db（NotificationService 经 userService 查 user）
  const db = createTestDb();
  const userRepo = new UserRepository(db);
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
  userRepo.insert({
    id: RECIPIENT_ID,
    name: 'recipient',
    email: 'recipient@example.com',
    status: 'active',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 0,
    password_hash: 'test-hash-placeholder',
  });
  const userService = new UserService(userRepo);
  const repo = new NotificationRepository(db);
  const service = new NotificationService(userService, repo);
  const router = createNotificationRouter(service);
  return { userRepo, userService, repo, service, router };
}

/**
 * notification setup（指定 versions）：创建 3 条 draft 通知，versions=[0, 5, 2]。
 * 用于 F4-2 delete 后 list ETag 变化场景（total=3, maxVersion=5 → ETag="3-5"）。
 */
function setupNotificationWithVersions(): {
  repo: NotificationRepository;
  service: NotificationService;
  router: ReturnType<typeof createNotificationRouter>;
} {
  // 多 repo 共享同一 db（NotificationService 经 userService 查 user）
  const db = createTestDb();
  const userRepo = new UserRepository(db);
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
  userRepo.insert({
    id: RECIPIENT_ID,
    name: 'recipient',
    email: 'recipient@example.com',
    status: 'active',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 0,
    password_hash: 'test-hash-placeholder',
  });
  const userService = new UserService(userRepo);
  const repo = new NotificationRepository(db);
  const ids = [
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000103',
  ];
  const versions = [0, 5, 2];
  for (let i = 0; i < ids.length; i++) {
    repo.insert({
      id: ids[i]!,
      title: `N${i}`,
      content: `C${i}`,
      recipient_id: RECIPIENT_ID,
      status: 'draft',
      created_at: SEED_TS,
      updated_at: SEED_TS,
      sent_at: null,
      read_at: null,
      version: versions[i]!,
    });
  }
  const service = new NotificationService(userService, repo);
  const router = createNotificationRouter(service);
  return { repo, service, router };
}

// ===========================================================================
// 单测 · src/etag.ts 纯函数（TECH-ETAG-CACHING-001 D7/D8）
// ===========================================================================
describe('单测 · detailEtag', () => {
  it('version=0 → \'"0"\'', () => {
    expect(detailEtag({ version: 0 })).toBe('"0"');
  });

  it('version=5 → \'"5"\'', () => {
    expect(detailEtag({ version: 5 })).toBe('"5"');
  });

  it('version 缺失 → \'"0"\'（回退）', () => {
    expect(detailEtag({})).toBe('"0"');
    expect(detailEtag(null)).toBe('"0"');
    expect(detailEtag(undefined)).toBe('"0"');
  });

  it('返回值格式含双引号（RFC 7232 强 ETag）', () => {
    const etag = detailEtag({ version: 42 });
    expect(etag.startsWith('"')).toBe(true);
    expect(etag.endsWith('"')).toBe(true);
    expect(etag).toBe('"42"');
  });
});

describe('单测 · listEtag', () => {
  it('total=3, items=[v0,v5,v2] → \'"3-5"\'', () => {
    const result = { items: [{ version: 0 }, { version: 5 }, { version: 2 }], total: 3 };
    expect(listEtag(result)).toBe('"3-5"');
  });

  it('items=[], total=0 → \'"0-0"\'', () => {
    const result = { items: [], total: 0 };
    expect(listEtag(result)).toBe('"0-0"');
  });

  it('total 缺失 → \'"0-0"\'（回退）', () => {
    const result = { items: [{ version: 5 }] };
    expect(listEtag(result)).toBe('"0-0"');
  });

  it('maxVersion 计算：items=[v3,v7,v1] → max=7', () => {
    const result = { items: [{ version: 3 }, { version: 7 }, { version: 1 }], total: 3 };
    expect(listEtag(result)).toBe('"3-7"');
  });
});

describe('单测 · parseIfNoneMatch', () => {
  it('"\"0\"" → "\"0\""（合法引号格式）', () => {
    expect(parseIfNoneMatch('"0"')).toBe('"0"');
  });

  it('"\"3-5\"" → "\"3-5\""（合法引号格式含连字符）', () => {
    expect(parseIfNoneMatch('"3-5"')).toBe('"3-5"');
  });

  it('undefined → null（缺失）', () => {
    expect(parseIfNoneMatch(undefined)).toBe(null);
  });

  it('空串 → null', () => {
    expect(parseIfNoneMatch('')).toBe(null);
  });

  it('"abc" → null（无引号，格式非法）', () => {
    expect(parseIfNoneMatch('abc')).toBe(null);
  });

  it('"0" → null（纯数字无引号，与 R9 If-Match 纯数字区分）', () => {
    expect(parseIfNoneMatch('0')).toBe(null);
  });

  it('"\\\"0" → null（缺右引号，格式非法）', () => {
    expect(parseIfNoneMatch('"0')).toBe(null);
  });
});

// ===========================================================================
// F1 · ETag 生成（AC-F1-1 ~ F1-4）
// ===========================================================================
describe('F1 · ETag 生成', () => {
  it('AC-F1-1: detail 响应含 ETag（role + notification 通过 callProc 获取实体，detailEtag 格式正确）', async () => {
    // role detail（内置 admin v0）
    const { repo: roleRepo, router: roleRouter } = setupRole();
    const adminRole = roleRepo.findByName(BUILTIN_ADMIN_ROLE_NAME);
    expect(adminRole).toBeDefined();
    const roleDetail: Role = await callProc(
      roleRouter.detail,
      { id: adminRole!.id },
      adminCtx,
    );
    expect(detailEtag(roleDetail)).toBe('"0"');

    // notification detail（create 后 v0）
    const { router: notifRouter, service: notifService } = setupNotification();
    const created = await notifService.create(
      { title: 'T', content: 'C', recipient_id: RECIPIENT_ID },
      adminCtx,
    );
    const notifDetail: Notification = await callProc(
      notifRouter.detail,
      { id: created.entity.id },
      adminCtx,
    );
    expect(detailEtag(notifDetail)).toBe('"0"');
  });

  it('AC-F1-2: ETag 随 version 递增（User v0 → updateStatus(v0)→v1，detailEtag 从 "0"→"1"）', async () => {
    const { repo, service } = setupUser();
    // update 前：version=0 → ETag="0"
    const before = repo.findById(TARGET_ID);
    expect(before).toBeDefined();
    expect(detailEtag(before)).toBe('"0"');
    // updateStatus(v0) → version=1
    await service.updateStatus(TARGET_ID, 'disabled', 0, adminCtx);
    // update 后：version=1 → ETag="1"
    const after = repo.findById(TARGET_ID);
    expect(after).toBeDefined();
    expect(detailEtag(after)).toBe('"1"');
  });

  it('AC-F1-3: ETag 格式合规（detailEtag 返回值匹配 /^"\\d+"$/，RFC 7232 强 ETag）', () => {
    expect(detailEtag({ version: 0 })).toMatch(/^"\d+"$/);
    expect(detailEtag({ version: 1 })).toMatch(/^"\d+"$/);
    expect(detailEtag({ version: 42 })).toMatch(/^"\d+"$/);
    expect(detailEtag({ version: 999 })).toMatch(/^"\d+"$/);
    // version 缺失回退也合规
    expect(detailEtag({})).toMatch(/^"\d+"$/);
  });

  it('AC-F1-4: 内置 admin ETag 恒 "0"（内置 role version=0，detailEtag→"0"）', async () => {
    const { repo, router } = setupRole();
    const adminRole = repo.findByName(BUILTIN_ADMIN_ROLE_NAME);
    expect(adminRole).toBeDefined();
    expect(adminRole!.is_builtin).toBe(true);
    expect(adminRole!.version).toBe(0);
    // 通过 callProc 调 router.detail 获取实体
    const detail: Role = await callProc(
      router.detail,
      { id: adminRole!.id },
      adminCtx,
    );
    expect(detail.is_builtin).toBe(true);
    expect(detail.version).toBe(0);
    expect(detailEtag(detail)).toBe('"0"');
  });
});

// ===========================================================================
// F2 · If-None-Match 协商缓存（AC-F2-1 ~ F2-4，通过 parseIfNoneMatch + ETag 比对模拟）
// ===========================================================================
describe('F2 · If-None-Match 协商缓存（模拟 server.ts D9 决策）', () => {
  it('AC-F2-1: ETag 匹配 → 304（parseIfNoneMatch("\"0\"")==detailEtag(v0) → 304）', async () => {
    const { service, router } = setupNotification();
    const created = await service.create(
      { title: 'T', content: 'C', recipient_id: RECIPIENT_ID },
      adminCtx,
    );
    const detail: Notification = await callProc(
      router.detail,
      { id: created.entity.id },
      adminCtx,
    );
    const etag = detailEtag(detail);
    // If-None-Match 与 ETag 匹配 → 304
    expect(negotiate(etag, '"0"')).toBe(304);
  });

  it('AC-F2-2: ETag 不匹配 → 200（parseIfNoneMatch("\"0\"")!=detailEtag(v1) → 200）', async () => {
    const { service, router } = setupNotification();
    const created = await service.create(
      { title: 'T', content: 'C', recipient_id: RECIPIENT_ID },
      adminCtx,
    );
    // update(v0)→v1
    await service.update(
      created.entity.id,
      { title: 'newT', recipient_id: RECIPIENT_ID },
      0,
      adminCtx,
    );
    const detail: Notification = await callProc(
      router.detail,
      { id: created.entity.id },
      adminCtx,
    );
    const etag = detailEtag(detail);
    expect(etag).toBe('"1"');
    // 旧 If-None-Match="0" 与新 ETag="1" 不匹配 → 200
    expect(negotiate(etag, '"0"')).toBe(200);
  });

  it('AC-F2-3: 缺失 If-None-Match → 200（parseIfNoneMatch(undefined)===null → 200）', async () => {
    const { service, router } = setupNotification();
    const created = await service.create(
      { title: 'T', content: 'C', recipient_id: RECIPIENT_ID },
      adminCtx,
    );
    const detail: Notification = await callProc(
      router.detail,
      { id: created.entity.id },
      adminCtx,
    );
    const etag = detailEtag(detail);
    // If-None-Match 缺失 → 200（无条件 GET）
    expect(negotiate(etag, undefined)).toBe(200);
  });

  it('AC-F2-4: If-None-Match 格式非法 → 忽略 200（parseIfNoneMatch("abc")===null → 200）', async () => {
    const { service, router } = setupNotification();
    const created = await service.create(
      { title: 'T', content: 'C', recipient_id: RECIPIENT_ID },
      adminCtx,
    );
    const detail: Notification = await callProc(
      router.detail,
      { id: created.entity.id },
      adminCtx,
    );
    const etag = detailEtag(detail);
    // If-None-Match="abc"（非引号格式）→ parseIfNoneMatch 返回 null → 忽略 → 200
    expect(negotiate(etag, 'abc')).toBe(200);
  });
});

// ===========================================================================
// F3 · list 端点 ETag（AC-F3-1 ~ F3-5）
// ===========================================================================
describe('F3 · list 端点 ETag', () => {
  it('AC-F3-1: list 响应含 ETag（user list 返回 {items,total}，listEtag 格式 "total-maxVersion"）', async () => {
    const { router } = setupUser();
    const result: UserListResult = await callProc(
      router.list,
      { page: 1, pageSize: 100 },
      adminCtx,
    );
    const etag = listEtag(result);
    // 格式："total-maxVersion"（含引号）
    expect(etag).toMatch(/^"\d+-\d+"$/);
    // 2 个 seed 用户，均 version=0 → "2-0"
    expect(etag).toBe('"2-0"');
  });

  it('AC-F3-2: list ETag 匹配 → 304（listEtag==parseIfNoneMatch → 304）', async () => {
    const { router } = setupUser();
    const result: UserListResult = await callProc(
      router.list,
      { page: 1, pageSize: 100 },
      adminCtx,
    );
    const etag = listEtag(result);
    // If-None-Match 与 list ETag 匹配 → 304
    expect(negotiate(etag, etag)).toBe(304);
  });

  it('AC-F3-3: create 后 list ETag 变化（create 前 "3-5" → create 后 total+1 → "4-5"）', async () => {
    const { service, router } = setupUserWithVersions();
    // create 前：3 个用户 versions=[0,5,2] → ETag="3-5"
    const before: UserListResult = await callProc(
      router.list,
      { page: 1, pageSize: 100 },
      adminCtx,
    );
    expect(listEtag(before)).toBe('"3-5"');
    // create 新用户（version=0）
    await service.create(
      { email: 'new@example.com', name: 'New' },
      adminCtx,
    );
    // create 后：4 个用户 versions=[0,5,2,0] → total=4, maxVersion=5 → "4-5"
    const after: UserListResult = await callProc(
      router.list,
      { page: 1, pageSize: 100 },
      adminCtx,
    );
    expect(listEtag(after)).toBe('"4-5"');
    // ETag 变化 → 旧 If-None-Match 不匹配 → 200
    expect(negotiate(listEtag(after), '"3-5"')).toBe(200);
  });

  it('AC-F3-4: update 后 list ETag 变化（update version 5→6 → "3-6"）', async () => {
    const { service, router } = setupUserWithVersions();
    // update 前：3 个用户 versions=[0,5,2] → ETag="3-5"
    const before: UserListResult = await callProc(
      router.list,
      { page: 1, pageSize: 100 },
      adminCtx,
    );
    expect(listEtag(before)).toBe('"3-5"');
    // update TARGET(v5)→v6（updateStatus 携带 expectedVersion=5）
    await service.updateStatus(TARGET_ID, 'disabled', 5, adminCtx);
    // update 后：3 个用户 versions=[0,6,2] → total=3, maxVersion=6 → "3-6"
    const after: UserListResult = await callProc(
      router.list,
      { page: 1, pageSize: 100 },
      adminCtx,
    );
    expect(listEtag(after)).toBe('"3-6"');
    // ETag 变化 → 旧 If-None-Match 不匹配 → 200
    expect(negotiate(listEtag(after), '"3-5"')).toBe(200);
  });

  it('AC-F3-5: list If-None-Match 缺失 → 200（无条件 GET）', async () => {
    const { router } = setupUser();
    const result: UserListResult = await callProc(
      router.list,
      { page: 1, pageSize: 100 },
      adminCtx,
    );
    const etag = listEtag(result);
    // If-None-Match 缺失 → 200
    expect(negotiate(etag, undefined)).toBe(200);
  });
});

// ===========================================================================
// F4 · 缓存失效语义（AC-F4-1 ~ F4-2）
// ===========================================================================
describe('F4 · 缓存失效语义', () => {
  it('AC-F4-1: update 后 detail 304→200（旧 ETag "0" vs 新 ETag "1" 不匹配 → 200）', async () => {
    const { service, router } = setupNotification();
    const created = await service.create(
      { title: 'T', content: 'C', recipient_id: RECIPIENT_ID },
      adminCtx,
    );
    // update 前：version=0 → ETag="0"，If-None-Match="0" 匹配 → 304
    const beforeDetail: Notification = await callProc(
      router.detail,
      { id: created.entity.id },
      adminCtx,
    );
    const beforeEtag = detailEtag(beforeDetail);
    expect(beforeEtag).toBe('"0"');
    expect(negotiate(beforeEtag, '"0"')).toBe(304);

    // update(v0)→v1
    await service.update(
      created.entity.id,
      { title: 'updated', recipient_id: RECIPIENT_ID },
      0,
      adminCtx,
    );
    // update 后：version=1 → ETag="1"，旧 If-None-Match="0" 不匹配 → 200
    const afterDetail: Notification = await callProc(
      router.detail,
      { id: created.entity.id },
      adminCtx,
    );
    const afterEtag = detailEtag(afterDetail);
    expect(afterEtag).toBe('"1"');
    expect(negotiate(afterEtag, '"0"')).toBe(200);
  });

  it('AC-F4-2: delete 后 list 304→200（旧 ETag "3-5" vs 删除后 "2-5" 不匹配 → 200）', async () => {
    const { service, router } = setupNotificationWithVersions();
    // delete 前：3 条通知 versions=[0,5,2] → ETag="3-5"，If-None-Match="3-5" 匹配 → 304
    const beforeList: NotificationListResult = await callProc(
      router.list,
      { page: 1, pageSize: 100 },
      adminCtx,
    );
    expect(listEtag(beforeList)).toBe('"3-5"');
    expect(negotiate(listEtag(beforeList), '"3-5"')).toBe(304);

    // delete 第一条通知（id=...101, version=0, draft）
    const firstNotifId = '00000000-0000-4000-8000-000000000101';
    await service.delete(firstNotifId, 0, adminCtx);

    // delete 后：2 条通知 versions=[5,2] → total=2, maxVersion=5 → "2-5"
    const afterList: NotificationListResult = await callProc(
      router.list,
      { page: 1, pageSize: 100 },
      adminCtx,
    );
    expect(listEtag(afterList)).toBe('"2-5"');
    // 旧 If-None-Match="3-5" 与新 ETag="2-5" 不匹配 → 200
    expect(negotiate(listEtag(afterList), '"3-5"')).toBe(200);
  });
});

// ===========================================================================
// ①类契约测 · 实体 schema 含 version 字段（ETag 生成依赖 SSOT）
// ===========================================================================
describe('①类契约测 · 实体 schema 含 version + list schema 含 items/total（ETag 生成依赖 SSOT）', () => {
  it('userSchema / roleSchema / notificationSchema 均含 version 字段（detailEtag 依赖）', () => {
    // ETag 生成依赖实体 version 字段（TECH-ETAG-CACHING-001 D7），contracts SSOT 须含此字段
    expect(userSchema.shape.version).toBeDefined();
    expect(roleSchema.shape.version).toBeDefined();
    expect(notificationSchema.shape.version).toBeDefined();
  });

  it('userListResultSchema / roleListResultSchema / notificationListResultSchema 均含 items + total（listEtag 依赖）', () => {
    // list ETag 生成依赖 {items, total} 结构（TECH-ETAG-CACHING-001 D7），contracts SSOT 须含此字段
    expect(userListResultSchema.shape.items).toBeDefined();
    expect(userListResultSchema.shape.total).toBeDefined();
    expect(roleListResultSchema.shape.items).toBeDefined();
    expect(roleListResultSchema.shape.total).toBeDefined();
    expect(notificationListResultSchema.shape.items).toBeDefined();
    expect(notificationListResultSchema.shape.total).toBeDefined();
  });
});
