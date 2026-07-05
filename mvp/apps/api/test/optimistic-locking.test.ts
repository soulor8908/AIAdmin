// apps/api/test/optimistic-locking.test.ts —— ③类新增并发冲突测试（TECH-OPTIMISTIC-LOCKING-001）
//
// 本文件在 service/domain 层覆盖乐观锁的并发冲突验收点（不涉及 HTTP/If-Match 解析，单层 service 调用）：
//   - F1 version 字段：create 初始 0 / update +1 / list+detail 返回 version / 内置 admin version=0
//   - F3 版本校验：成功路径 + VERSION_CONFLICT 冲突路径 + 状态不变性 + 丢失更新模拟
//   - F4 守卫顺序：不存在优先于版本校验；版本校验优先于业务规则（已禁用→先 VERSION_CONFLICT 后 USER_ALREADY_DISABLED）
//   - 单测 · domain 纯函数 validateVersion(expected, actual)
//
// F2（If-Match HTTP header 解析）与端到端丢失更新场景（经 router/HTTP 层）在
// optimistic-locking-embedding.test.ts 中覆盖，本文件不重复。
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - 测试在 SERVICE 层调用（service.updateStatus / service.delete / service.send 等），
//     不经 router，故不触发 If-Match header 解析（F2 范畴）。
//   - 守卫顺序断言（F4）通过"同时命中两类错误时优先返回哪个错误码"证明（行为可观测），
//     AC-F4-3 额外通过 readFileSync 检查 service 源码注释含 "B_version" / "版本校验"。
//   - 丢失更新（AC-F3-6）模拟：client A 用 v0 写成功 → version=1；client B 持旧 v0 写 → VERSION_CONFLICT。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import type { ErrorCode, User, Role, Notification } from '@admin/contracts';
import { errorCodeSchema, errorResponseSchema } from '@admin/contracts';
import { UserRepository } from '../src/repository/user.js';
import { UserService } from '../src/service/user.js';
import { RoleRepository } from '../src/repository/role.js';
import { RoleService } from '../src/service/role.js';
import { NotificationRepository } from '../src/repository/notification.js';
import { NotificationService } from '../src/service/notification.js';
import { validateVersion } from '../src/domain/version.js';
import { AppError } from '../src/errors.js';
import type { Ctx } from '../src/context.js';
import { createTestDb } from './helpers/db.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const TARGET_ID = '00000000-0000-4000-8000-000000000002';
const RECIPIENT_ID = '00000000-0000-4000-8000-000000000003';
const SEED_TS = '2020-01-01T00:00:00.000Z';
const MISSING_ID = '00000000-0000-4000-8000-000000000099';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };
const userCtx: Ctx = { user: { id: 'u1', role: 'user' } };
const recipientCtx: Ctx = { user: { id: RECIPIENT_ID, role: 'user' } };

// service 源码路径（AC-F4-3 读取注释断言守卫顺序文档化）
const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_SERVICE_SRC = resolve(__dirname, '../src/service/user.ts');
const ROLE_SERVICE_SRC = resolve(__dirname, '../src/service/role.ts');
const NOTIFICATION_SERVICE_SRC = resolve(__dirname, '../src/service/notification.ts');

/**
 * user setup：创建 userRepo（含 admin 操作者 + 独立 target 用户）+ userService。
 * target 用户 id ≠ adminCtx.user.id，避免 updateStatus(disabled) 命中 B6 禁用自身守卫。
 * 返回的 repo/service 可观测存储态（断言 version/status 不变性）。
 */
function setupUser(): { repo: UserRepository; service: UserService } {
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
  return { repo, service };
}

/**
 * role setup：创建 roleRepo（构造时自动 seed 内置 admin，version=0）+ userRepo + roleService。
 * RoleService 构造签名：new RoleService(roleRepo, userRepo)。
 */
function setupRole(): { repo: RoleRepository; userRepo: UserRepository; service: RoleService } {
  // 多 repo 共享同一 db（RoleService 跨 role/user repo 查询，需一致）
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
  return { repo, userRepo, service };
}

/**
 * notification setup：创建 userRepo（含 active 收件人）+ userService + notificationRepo + notificationService。
 * NotificationService 构造签名：new NotificationService(userService, notificationRepo)（跨 service 依赖 D1）。
 */
function setupNotification(): {
  userRepo: UserRepository;
  userService: UserService;
  repo: NotificationRepository;
  service: NotificationService;
} {
  // 多 repo 共享同一 db（NotificationService 经 userService 查 user，notification 引用 recipient）
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
  return { userRepo, userService, repo, service };
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

// ===========================================================================
// 单测 · domain 纯函数 validateVersion（TECH-OPTIMISTIC-LOCKING-001 D5）
// ===========================================================================
describe('单测 · validateVersion', () => {
  it('expected === actual → { ok: true }', () => {
    expect(validateVersion(0, 0)).toEqual({ ok: true });
  });

  it('expected=1, actual=0 → { ok: false, errorCode: VERSION_CONFLICT }', () => {
    expect(validateVersion(1, 0)).toEqual({ ok: false, errorCode: 'VERSION_CONFLICT' });
  });

  it('expected=0, actual=1 → { ok: false, errorCode: VERSION_CONFLICT }', () => {
    expect(validateVersion(0, 1)).toEqual({ ok: false, errorCode: 'VERSION_CONFLICT' });
  });
});

// ===========================================================================
// F1 · version 字段（AC-F1-1 ~ F1-5）
// ===========================================================================
describe('F1 · version 字段', () => {
  it('AC-F1-1: service.create 返回 entity.version === 0（user/role/notification 三域）', async () => {
    // user
    const { service: userService } = setupUser();
    const userResult = await userService.create(
      { email: 'newuser@example.com', name: 'New User' },
      adminCtx,
    );
    expect(userResult.entity.version).toBe(0);

    // role
    const { service: roleService } = setupRole();
    const roleResult = await roleService.create(
      { name: 'editor', description: 'd', permission_codes: ['user:read'] },
      adminCtx,
    );
    expect(roleResult.entity.version).toBe(0);

    // notification
    const { service: notificationService } = setupNotification();
    const notificationResult = await notificationService.create(
      { title: 'T', content: 'C', recipient_id: RECIPIENT_ID },
      adminCtx,
    );
    expect(notificationResult.entity.version).toBe(0);
  });

  it('AC-F1-2: User v0 → updateStatus(expectedVersion=0) 成功 → entity.version === 1', async () => {
    const { service } = setupUser();
    const result = await service.updateStatus(TARGET_ID, 'disabled', 0, adminCtx);
    expect(result.entity.version).toBe(1);
    expect(result.entity.status).toBe('disabled');
  });

  it('AC-F1-3: Notification draft v0 → update(v0)→v1 → send(v1)→v2 → markRead(v2)→v3', async () => {
    const { service } = setupNotification();
    // create draft v0
    const draft = await service.create(
      { title: 'T', content: 'C', recipient_id: RECIPIENT_ID },
      adminCtx,
    );
    expect(draft.entity.version).toBe(0);

    // update(v0) → v1（携带 recipient_id 保留收件人，service.update 全字段覆盖语义）
    const updated = await service.update(
      draft.entity.id,
      { title: 'newT', recipient_id: RECIPIENT_ID },
      0,
      adminCtx,
    );
    expect(updated.entity.version).toBe(1);

    // send(v1) → v2
    const sent = await service.send(draft.entity.id, 1, adminCtx);
    expect(sent.entity.version).toBe(2);
    expect(sent.entity.status).toBe('sent');

    // markRead(v2) → v3（收件人自服务，recipientCtx.user.id === RECIPIENT_ID）
    const read = await service.markRead(draft.entity.id, 2, recipientCtx);
    expect(read.entity.version).toBe(3);
    expect(read.entity.status).toBe('read');
  });

  it('AC-F1-4: list/detail 返回 version（user/role/notification 三域）', async () => {
    // user list
    const { service: userService } = setupUser();
    const userList = await userService.list({ page: 1, pageSize: 10 }, adminCtx);
    expect(userList.items.length).toBeGreaterThan(0);
    for (const u of userList.items) {
      expect(typeof u.version).toBe('number');
      expect(u.version).toBe(0);
    }

    // role list（含内置 admin）+ getById
    const { repo: roleRepo, service: roleService } = setupRole();
    const roleList = await roleService.list({ page: 1, pageSize: 10 }, adminCtx);
    expect(roleList.items.length).toBeGreaterThan(0);
    for (const r of roleList.items) {
      expect(typeof r.version).toBe('number');
    }
    const adminRole = roleRepo.findByName('admin');
    expect(adminRole).toBeDefined();
    const detailRole = await roleService.getById(adminRole!.id, adminCtx);
    expect(detailRole.version).toBe(0);

    // notification list + detail
    const { service: notificationService } = setupNotification();
    await notificationService.create(
      { title: 'T', content: 'C', recipient_id: RECIPIENT_ID },
      adminCtx,
    );
    const notificationList = await notificationService.list({ page: 1, pageSize: 10 }, adminCtx);
    expect(notificationList.items.length).toBe(1);
    expect(typeof notificationList.items[0]?.version).toBe('number');
    const detail = await notificationService.detail(notificationList.items[0]!.id, adminCtx);
    expect(typeof detail.version).toBe('number');
    expect(detail.version).toBe(0);
  });

  it('AC-F1-5: 内置 admin role（auto-seeded）→ getById(...).version === 0', async () => {
    const { repo, service } = setupRole();
    const admin = repo.findByName('admin');
    expect(admin).toBeDefined();
    const detail = await service.getById(admin!.id, adminCtx);
    expect(detail.is_builtin).toBe(true);
    expect(detail.version).toBe(0);
  });
});

// ===========================================================================
// F3 · 版本校验（AC-F3-1 ~ F3-6）
// ===========================================================================
describe('F3 · 版本校验', () => {
  it('AC-F3-1: User v0 → updateStatus(expectedVersion=0) 成功，entity.version === 1', async () => {
    const { service } = setupUser();
    const result = await service.updateStatus(TARGET_ID, 'disabled', 0, adminCtx);
    expect(result.entity.version).toBe(1);
    expect(result.entity.status).toBe('disabled');
  });

  it('AC-F3-2: User v0 → updateStatus(0) 成功(v1) → updateStatus(0, stale) → VERSION_CONFLICT, current_version===1', async () => {
    const { service } = setupUser();
    // 第一次成功 → version=1
    await service.updateStatus(TARGET_ID, 'disabled', 0, adminCtx);
    // 用 stale v0 再次写（用户当前是 disabled，再写 disabled 会被版本校验先拦截）
    try {
      await service.updateStatus(TARGET_ID, 'disabled', 0, adminCtx);
      expect.unreachable('should throw VERSION_CONFLICT');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      if (e instanceof AppError) {
        expect(e.code).toBe('VERSION_CONFLICT');
        expect(e.meta?.current_version).toBe(1);
      }
    }
  });

  it('AC-F3-3: Role v0 → delete(expectedVersion=0) 成功(void)；另一 role v0 → delete(expectedVersion=99) → VERSION_CONFLICT', async () => {
    const { service } = setupRole();
    // 成功路径：创建非内置角色 v0 → delete(v0) → void
    const created = await service.create(
      { name: 'toDelete', description: 'd', permission_codes: [] },
      adminCtx,
    );
    const deleted = await service.delete(created.entity.id, 0, adminCtx);
    expect(deleted.entity).toBeUndefined();

    // 冲突路径：创建另一非内置角色 v0 → delete(v99) → VERSION_CONFLICT, current_version===0
    const another = await service.create(
      { name: 'conflict', description: 'd', permission_codes: [] },
      adminCtx,
    );
    try {
      await service.delete(another.entity.id, 99, adminCtx);
      expect.unreachable('should throw VERSION_CONFLICT');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      if (e instanceof AppError) {
        expect(e.code).toBe('VERSION_CONFLICT');
        expect(e.meta?.current_version).toBe(0);
      }
    }
  });

  it('AC-F3-4: Notification draft v0 → send(expectedVersion=0) 成功(version===1)；send(expectedVersion=99) → VERSION_CONFLICT', async () => {
    const { service } = setupNotification();
    // 成功路径
    const draft = await service.create(
      { title: 'T', content: 'C', recipient_id: RECIPIENT_ID },
      adminCtx,
    );
    const sent = await service.send(draft.entity.id, 0, adminCtx);
    expect(sent.entity.status).toBe('sent');
    expect(sent.entity.version).toBe(1);

    // 冲突路径：新建 draft → send(v99) → VERSION_CONFLICT, current_version===0
    const draft2 = await service.create(
      { title: 'T2', content: 'C', recipient_id: RECIPIENT_ID },
      adminCtx,
    );
    try {
      await service.send(draft2.entity.id, 99, adminCtx);
      expect.unreachable('should throw VERSION_CONFLICT');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      if (e instanceof AppError) {
        expect(e.code).toBe('VERSION_CONFLICT');
        expect(e.meta?.current_version).toBe(0);
      }
    }
  });

  it('AC-F3-5: User v0 → updateStatus(expectedVersion=99) 冲突 → 用户 status/version 不变，无副作用', async () => {
    const { repo, service } = setupUser();
    try {
      await service.updateStatus(TARGET_ID, 'disabled', 99, adminCtx);
      expect.unreachable('should throw VERSION_CONFLICT');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      if (e instanceof AppError) {
        expect(e.code).toBe('VERSION_CONFLICT');
        expect(e.meta?.current_version).toBe(0);
      }
    }
    // 状态不变：仍 active，version 仍 0
    const after = repo.findById(TARGET_ID);
    expect(after?.status).toBe('active');
    expect(after?.version).toBe(0);
  });

  it('AC-F3-6: 丢失更新模拟：client A 写成功(v1) → client B 持旧 v0 写 → VERSION_CONFLICT，最终状态=A 的写入', async () => {
    const { repo, service } = setupUser();
    // client A：用 v0 写 disabled 成功 → version=1, status=disabled
    const aResult = await service.updateStatus(TARGET_ID, 'disabled', 0, adminCtx);
    expect(aResult.entity.version).toBe(1);
    expect(aResult.entity.status).toBe('disabled');

    // client B：持旧 v0 写（未感知 A 的更新）→ VERSION_CONFLICT, current_version===1
    try {
      await service.updateStatus(TARGET_ID, 'disabled', 0, adminCtx);
      expect.unreachable('should throw VERSION_CONFLICT');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      if (e instanceof AppError) {
        expect(e.code).toBe('VERSION_CONFLICT');
        expect(e.meta?.current_version).toBe(1);
      }
    }

    // 最终状态 = A 的写入（disabled, version=1），B 的写入被拒绝
    const after = repo.findById(TARGET_ID);
    expect(after?.status).toBe('disabled');
    expect(after?.version).toBe(1);
  });
});

// ===========================================================================
// F4 · 守卫顺序（AC-F4-1 ~ F4-3）
// ===========================================================================
describe('F4 · 守卫顺序', () => {
  it('AC-F4-1: 不存在用户 → updateStatus(expectedVersion=0) → USER_NOT_FOUND（非 VERSION_CONFLICT）', async () => {
    const { service } = setupUser();
    await expectAppError(service.updateStatus(MISSING_ID, 'disabled', 0, adminCtx), 'USER_NOT_FOUND');
  });

  it('AC-F4-2: User v0 已禁用 → updateStatus(disabled, expectedVersion=99) → VERSION_CONFLICT（非 USER_ALREADY_DISABLED，证明版本校验先于业务规则）', async () => {
    const { service } = setupUser();
    // 先正常禁用 → version=1, status=disabled
    await service.updateStatus(TARGET_ID, 'disabled', 0, adminCtx);
    // 再用 stale v99 再次禁用：版本冲突应优先于"重复禁用"业务规则
    try {
      await service.updateStatus(TARGET_ID, 'disabled', 99, adminCtx);
      expect.unreachable('should throw VERSION_CONFLICT (guard before USER_ALREADY_DISABLED)');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      if (e instanceof AppError) {
        expect(e.code).toBe('VERSION_CONFLICT');
        expect(e.meta?.current_version).toBe(1);
      }
    }
  });

  it('AC-F4-3: service 源码注释含 B_version / 版本校验 守卫顺序文档化（user/role/notification）', () => {
    const userSrc = readFileSync(USER_SERVICE_SRC, 'utf8');
    const roleSrc = readFileSync(ROLE_SERVICE_SRC, 'utf8');
    const notificationSrc = readFileSync(NOTIFICATION_SERVICE_SRC, 'utf8');
    // 三域 service 源码均应在注释中标识 B_version 守卫（TECH-OPTIMISTIC-LOCKING-001 D9）
    expect(userSrc).toMatch(/B_version|版本校验/);
    expect(roleSrc).toMatch(/B_version|版本校验/);
    expect(notificationSrc).toMatch(/B_version|版本校验/);
  });
});

// ===========================================================================
// 辅助：保留 userCtx 引用（setup pattern 一部分，本文件 AC 未直接使用，避免未用告警）
// ===========================================================================
describe('辅助 · ctx 形状', () => {
  it('adminCtx/userCtx/recipientCtx 角色字段符合预期', () => {
    expect(adminCtx.user.role).toBe('admin');
    expect(userCtx.user.role).toBe('user');
    expect(recipientCtx.user.id).toBe(RECIPIENT_ID);
  });
});

// ---------------------------------------------------------------------------
// ①类契约测 · errorCodeSchema + errorResponseSchema（AI-006 ①类，Tech-Spec §9）
// ---------------------------------------------------------------------------
describe('①类契约测 · errorCodeSchema + errorResponseSchema（AI-006 ①类）', () => {
  it('errorCodeSchema 含 VERSION_REQUIRED 与 VERSION_CONFLICT（SSOT 派生，跨域联动①）', () => {
    const allCodes = [...errorCodeSchema.options];
    expect(allCodes).toContain('VERSION_REQUIRED');
    expect(allCodes).toContain('VERSION_CONFLICT');
    // 既有码不被破坏
    expect(allCodes).toContain('VALIDATION_ERROR');
    expect(allCodes).toContain('FORBIDDEN');
  });

  it('errorResponseSchema 接受含 current_version 的 VERSION_CONFLICT 响应（.strict）', () => {
    expect(
      errorResponseSchema.safeParse({
        code: 'VERSION_CONFLICT',
        message: '版本冲突',
        current_version: 1,
      }).success,
    ).toBe(true);
  });

  it('errorResponseSchema 接受不含 current_version 的标准错误响应（向后兼容）', () => {
    expect(
      errorResponseSchema.safeParse({
        code: 'VALIDATION_ERROR',
        message: '入参非法',
      }).success,
    ).toBe(true);
  });

  it('errorResponseSchema 拒绝多余字段（.strict）', () => {
    expect(
      errorResponseSchema.safeParse({
        code: 'VERSION_CONFLICT',
        message: '版本冲突',
        current_version: 1,
        extra: 'bad',
      }).success,
    ).toBe(false);
  });
});
