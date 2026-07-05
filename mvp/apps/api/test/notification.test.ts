// apps/api/test/notification.test.ts —— 测试先行（AI-002，test-writer 先于 impl-writer 产出）
// 本文件先于实现产出，覆盖 Tech-Spec TECH-NOTIFICATION-001 测试矩阵（单层 service/router 断言，非端到端）：
//   1. 单测 · domain 状态机 transitionStatus（合法/非法转移）+ ALLOWED_NOTIFICATION_TRANSITIONS 经 schema 校验
//   2. 契约测 · 入参 safeParse（create/update/list/transition）+ 出参 schema 匹配（.strict）
//   3. service 单层测 · create/update/send/markRead/delete 返回值 + 错误码
//   4. 权限测 · 非 admin 各 admin procedure → FORBIDDEN；markRead 收件人自服务（非 admin 收件人成功，非收件人 → FORBIDDEN）
//   5. SSOT 派生（AI-005）· 权限码/错误码/实体类型/状态全集用 [...schema.options] 派生，禁硬编码
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - NotificationRepository 构造签名：new NotificationRepository()（内存 Map，无 seed）。
//   - NotificationService 构造签名：new NotificationService(userService, notificationRepo)（跨 service 依赖 D1）。
//   - NotificationService 方法签名：
//       create(input, ctx): Promise<WriteResult<Notification>>
//       update(id, input, ctx): Promise<WriteResult<Notification>>
//       send(id, ctx): Promise<WriteResult<Notification>>
//       markRead(id, ctx): Promise<WriteResult<Notification>>  // SEC-002-exempt: recipient self-service
//       delete(id, ctx): Promise<WriteResult<void>>
//       list(query, ctx): Promise<NotificationListResult>
//       detail(id, ctx): Promise<Notification>
//   - UserService 新增 findByIds(ids, ctx): Promise<User[]>（②类签名变更，requireAdmin + 调 repo.findByIds）。
//   - UserRepository 新增 findByIds(ids): UserEntity[]（批量查，不存在 id 静默 omitted，保持插入顺序）。
//   - router 导出：createNotificationRouter / notificationIdProcedureInputSchema / updateNotificationProcedureInputSchema / Procedure / NotificationRouter。
//   - markRead procedure auth='public'（收件人自服务，不走 requireAdmin/permission 码），其余 procedure auth='admin' + permission。
//   - domain/notification.ts 导出 transitionStatus / ALLOWED_NOTIFICATION_TRANSITIONS / TransitionResult。
//   - F2 埋点的端到端断言在 notification-embedding.test.ts（AI-007），本文件不注入共享 auditRepo。
import { describe, it, expect } from 'vitest';
import {
  notificationStatusSchema,
  notificationSchema,
  createNotificationInputSchema,
  updateNotificationInputSchema,
  notificationTransitionSchema,
  listNotificationQuerySchema,
  notificationListResultSchema,
  permissionCodeSchema,
  errorCodeSchema,
  auditLogEntityTypeSchema,
  type ErrorCode,
  type Notification,
  type NotificationStatus,
} from '@admin/contracts';
import { UserRepository } from '../src/repository/user.js';
import { UserService } from '../src/service/user.js';
import { NotificationRepository } from '../src/repository/notification.js';
import { NotificationService } from '../src/service/notification.js';
import {
  createNotificationRouter,
  notificationIdProcedureInputSchema,
  updateNotificationProcedureInputSchema,
  type Procedure,
} from '../src/router/notification.js';
import { transitionStatus, ALLOWED_NOTIFICATION_TRANSITIONS } from '../src/domain/notification.js';
import { AppError } from '../src/errors.js';
import type { Ctx } from '../src/context.js';
import { createTestDb } from './helpers/db.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const U_VALID = '00000000-0000-4000-8000-000000000002';
const U_DISABLED = '00000000-0000-4000-8000-000000000003';
const U_OTHER = '00000000-0000-4000-8000-000000000004';
const U_MISSING = '00000000-0000-4000-8000-000000000099';
const SEED_TS = '2020-01-01T00:00:00.000Z';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };
const recipientCtx: Ctx = { user: { id: U_VALID, role: 'user' } };
const otherUserCtx: Ctx = { user: { id: U_OTHER, role: 'user' } };

/**
 * 单层 setup：创建 userRepo（预置 active/disabled 收件人）+ userService + notificationRepo + notificationService + notificationRouter。
 * 不注入共享 auditService（router 缺省自建隔离 AuditLogService，本文件不断言埋点，F2 端到端在 notification-embedding.test.ts）。
 * NotificationService 注入的 userService 与 setup 中可观测的 userService 同一实例（跨 service 依赖 D1）。
 */
function setup(): {
  userRepo: UserRepository;
  userService: UserService;
  notificationRepo: NotificationRepository;
  notificationService: NotificationService;
  router: ReturnType<typeof createNotificationRouter>;
} {
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
    id: U_VALID,
    name: 'valid',
    email: 'valid@example.com',
    status: 'active',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 0,
    password_hash: 'test-hash-placeholder',
  });
  userRepo.insert({
    id: U_DISABLED,
    name: 'disabled',
    email: 'disabled@example.com',
    status: 'disabled',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 0,
    password_hash: 'test-hash-placeholder',
  });
  userRepo.insert({
    id: U_OTHER,
    name: 'other',
    email: 'other@example.com',
    status: 'active',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 0,
    password_hash: 'test-hash-placeholder',
  });
  const userService = new UserService(userRepo);
  const notificationRepo = new NotificationRepository(db);
  const notificationService = new NotificationService(userService, notificationRepo);
  const router = createNotificationRouter(notificationService);
  return { userRepo, userService, notificationRepo, notificationService, router };
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'T',
    content: 'C',
    recipient_id: U_VALID,
    status: 'draft',
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 0,
    sent_at: null,
    read_at: null,
    ...overrides,
  };
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

/** 创建一条 draft 通知（admin），返回 service 返回的 entity。供后续 send/markRead/update/delete 复用。 */
async function createDraft(
  service: NotificationService,
  recipientId: string = U_VALID,
): Promise<Notification> {
  const result = await service.create(
    { title: 'T', content: 'C', recipient_id: recipientId },
    adminCtx,
  );
  return result.entity;
}

// ---------------------------------------------------------------------------
// 1. 单测 · domain 状态机 transitionStatus
// ---------------------------------------------------------------------------
describe('单测 · domain 状态机 transitionStatus', () => {
  it('draft → sent 合法转移，next=sent', () => {
    const r = transitionStatus('draft', 'sent');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('sent');
  });

  it('sent → read 合法转移，next=read', () => {
    const r = transitionStatus('sent', 'read');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('read');
  });

  it('draft → read 非法（跳过 sent）→ NOTIFICATION_INVALID_TRANSITION', () => {
    const r = transitionStatus('draft', 'read');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('NOTIFICATION_INVALID_TRANSITION');
  });

  it('draft → draft 非法（同态）→ NOTIFICATION_INVALID_TRANSITION', () => {
    const r = transitionStatus('draft', 'draft');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('NOTIFICATION_INVALID_TRANSITION');
  });

  it('sent → sent 非法（同态）→ NOTIFICATION_INVALID_TRANSITION', () => {
    const r = transitionStatus('sent', 'sent');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('NOTIFICATION_INVALID_TRANSITION');
  });

  it('read → read 非法（同态）→ NOTIFICATION_INVALID_TRANSITION', () => {
    const r = transitionStatus('read', 'read');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('NOTIFICATION_INVALID_TRANSITION');
  });

  it('read → sent 非法（回退，read 为终态）→ NOTIFICATION_INVALID_TRANSITION', () => {
    const r = transitionStatus('read', 'sent');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('NOTIFICATION_INVALID_TRANSITION');
  });

  it('read → draft 非法（回退）→ NOTIFICATION_INVALID_TRANSITION', () => {
    const r = transitionStatus('read', 'draft');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('NOTIFICATION_INVALID_TRANSITION');
  });

  it('sent → draft 非法（回退）→ NOTIFICATION_INVALID_TRANSITION', () => {
    const r = transitionStatus('sent', 'draft');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('NOTIFICATION_INVALID_TRANSITION');
  });
});

describe('单测 · ALLOWED_NOTIFICATION_TRANSITIONS 经 notificationTransitionSchema 校验', () => {
  it('每条合法转移均符合 notificationTransitionSchema（{from, to} 形状，.strict）', () => {
    for (const t of ALLOWED_NOTIFICATION_TRANSITIONS) {
      expect(notificationTransitionSchema.safeParse(t).success).toBe(true);
    }
  });

  it('ALLOWED_NOTIFICATION_TRANSITIONS 恰含 draft→sent 与 sent→read 两条', () => {
    expect(ALLOWED_NOTIFICATION_TRANSITIONS).toEqual([
      { from: 'draft', to: 'sent' },
      { from: 'sent', to: 'read' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. 契约测 · 入参 safeParse 合法/非法样本
// ---------------------------------------------------------------------------
describe('契约测 · 入参 safeParse', () => {
  describe('notificationStatusSchema', () => {
    it('draft/sent/read 均合法', () => {
      for (const s of notificationStatusSchema.options) {
        expect(notificationStatusSchema.safeParse(s).success).toBe(true);
      }
    });
    it('unknown 非法', () => {
      expect(notificationStatusSchema.safeParse('unknown').success).toBe(false);
    });
  });

  describe('createNotificationInputSchema', () => {
    it('合法样本通过', () => {
      expect(
        createNotificationInputSchema.safeParse({
          title: 'T',
          content: 'C',
          recipient_id: U_VALID,
        }).success,
      ).toBe(true);
    });
    it('title 空串非法', () => {
      expect(
        createNotificationInputSchema.safeParse({ title: '', content: 'C', recipient_id: U_VALID }).success,
      ).toBe(false);
    });
    it('title 超 128 字符非法', () => {
      expect(
        createNotificationInputSchema.safeParse({
          title: 'x'.repeat(129),
          content: 'C',
          recipient_id: U_VALID,
        }).success,
      ).toBe(false);
    });
    it('content 空串非法', () => {
      expect(
        createNotificationInputSchema.safeParse({ title: 'T', content: '', recipient_id: U_VALID }).success,
      ).toBe(false);
    });
    it('content 超 4000 字符非法', () => {
      expect(
        createNotificationInputSchema.safeParse({
          title: 'T',
          content: 'x'.repeat(4001),
          recipient_id: U_VALID,
        }).success,
      ).toBe(false);
    });
    it('recipient_id 非 uuid 非法', () => {
      expect(
        createNotificationInputSchema.safeParse({ title: 'T', content: 'C', recipient_id: 'not-uuid' }).success,
      ).toBe(false);
    });
    it('多余字段 status 非法（.strict，服务端生成字段不入输入）', () => {
      expect(
        createNotificationInputSchema.safeParse({
          title: 'T',
          content: 'C',
          recipient_id: U_VALID,
          status: 'draft',
        }).success,
      ).toBe(false);
    });
    it('多余字段 id 非法（.strict）', () => {
      expect(
        createNotificationInputSchema.safeParse({
          title: 'T',
          content: 'C',
          recipient_id: U_VALID,
          id: U_VALID,
        }).success,
      ).toBe(false);
    });
  });

  describe('updateNotificationInputSchema', () => {
    it('仅 title 通过（partial）', () => {
      expect(updateNotificationInputSchema.safeParse({ title: 'newT' }).success).toBe(true);
    });
    it('title + content + recipient_id 通过（partial）', () => {
      expect(
        updateNotificationInputSchema.safeParse({
          title: 'newT',
          content: 'newC',
          recipient_id: U_OTHER,
        }).success,
      ).toBe(true);
    });
    it('空对象通过（partial，全缺省）', () => {
      expect(updateNotificationInputSchema.safeParse({}).success).toBe(true);
    });
    it('多余字段 status 非法（.strict，status 不可由调用方改）', () => {
      expect(updateNotificationInputSchema.safeParse({ status: 'sent' }).success).toBe(false);
    });
    it('多余字段 sent_at 非法（.strict）', () => {
      expect(updateNotificationInputSchema.safeParse({ sent_at: SEED_TS }).success).toBe(false);
    });
    it('title 空串非法', () => {
      expect(updateNotificationInputSchema.safeParse({ title: '' }).success).toBe(false);
    });
  });

  describe('listNotificationQuerySchema', () => {
    it('空对象合法（默认 page=1 pageSize=10）', () => {
      expect(listNotificationQuerySchema.safeParse({}).success).toBe(true);
    });
    it('page=0 非法', () => {
      expect(listNotificationQuerySchema.safeParse({ page: 0, pageSize: 10 }).success).toBe(false);
    });
    it('pageSize=101 非法（上限 100）', () => {
      expect(listNotificationQuerySchema.safeParse({ page: 1, pageSize: 101 }).success).toBe(false);
    });
    it('status 非枚举非法', () => {
      expect(
        listNotificationQuerySchema.safeParse({ page: 1, pageSize: 10, status: 'invalid' }).success,
      ).toBe(false);
    });
    it('status=draft 合法', () => {
      expect(
        listNotificationQuerySchema.safeParse({ page: 1, pageSize: 10, status: 'draft' }).success,
      ).toBe(true);
    });
  });

  describe('notificationTransitionSchema', () => {
    it('{from: draft, to: sent} 合法（schema 只校验形状，不校验转移合法性）', () => {
      expect(notificationTransitionSchema.safeParse({ from: 'draft', to: 'sent' }).success).toBe(true);
    });
    it('{from: draft, to: read} 形状合法（合法性由 domain transitionStatus 裁决）', () => {
      expect(notificationTransitionSchema.safeParse({ from: 'draft', to: 'read' }).success).toBe(true);
    });
    it('from 非枚举非法', () => {
      expect(notificationTransitionSchema.safeParse({ from: 'unknown', to: 'sent' }).success).toBe(false);
    });
    it('多余字段非法（.strict）', () => {
      expect(
        notificationTransitionSchema.safeParse({ from: 'draft', to: 'sent', extra: 1 }).success,
      ).toBe(false);
    });
  });

  describe('procedure 入参 schema', () => {
    it('notificationIdProcedureInputSchema: id 非 uuid 非法', () => {
      expect(notificationIdProcedureInputSchema.safeParse({ id: 'not-uuid' }).success).toBe(false);
    });
    it('notificationIdProcedureInputSchema: 合法样本通过', () => {
      expect(notificationIdProcedureInputSchema.safeParse({ id: U_VALID }).success).toBe(true);
    });
    it('updateNotificationProcedureInputSchema: id 非 uuid 非法', () => {
      expect(
        updateNotificationProcedureInputSchema.safeParse({ id: 'not-uuid', body: { title: 'x' } }).success,
      ).toBe(false);
    });
    it('updateNotificationProcedureInputSchema: body 含非法字段非合法', () => {
      expect(
        updateNotificationProcedureInputSchema.safeParse({ id: U_VALID, body: { status: 'sent' } }).success,
      ).toBe(false);
    });
    it('updateNotificationProcedureInputSchema: 合法样本通过', () => {
      expect(
        updateNotificationProcedureInputSchema.safeParse({ id: U_VALID, body: { title: 'x' }, expected_version: 0 }).success,
      ).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. 契约测 · 出参 schema .strict
// ---------------------------------------------------------------------------
describe('契约测 · 出参 schema .strict', () => {
  it('notificationSchema: 合法样本通过', () => {
    expect(() => notificationSchema.parse(makeNotification())).not.toThrow();
  });
  it('notificationSchema: status=sent + sent_at 非空 通过', () => {
    expect(() =>
      notificationSchema.parse(makeNotification({ status: 'sent', sent_at: SEED_TS })),
    ).not.toThrow();
  });
  it('notificationSchema: status=read + sent_at/read_at 非空 通过', () => {
    expect(() =>
      notificationSchema.parse(
        makeNotification({ status: 'read', sent_at: SEED_TS, read_at: SEED_TS }),
      ),
    ).not.toThrow();
  });
  it('notificationSchema: 多余字段非法（.strict）', () => {
    expect(
      notificationSchema.safeParse({ ...makeNotification(), extra: 1 }).success,
    ).toBe(false);
  });
  it('notificationSchema: sent_at 非法（非 datetime/null）→ 拒绝', () => {
    expect(
      notificationSchema.safeParse({ ...makeNotification(), sent_at: 'not-datetime' }).success,
    ).toBe(false);
  });
  it('notificationListResultSchema: 合法样本通过', () => {
    expect(() =>
      notificationListResultSchema.parse({
        items: [makeNotification()],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }),
    ).not.toThrow();
  });
  it('notificationListResultSchema: 多余字段非法（.strict）', () => {
    expect(
      notificationListResultSchema.safeParse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
        extra: 1,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. service 单层测 · create
// ---------------------------------------------------------------------------
describe('service 单层测 · create', () => {
  it('合法 input → status=draft / sent_at=null / read_at=null / created_at/updated_at 非空 ISO', async () => {
    const { notificationService } = setup();
    const result = await notificationService.create(
      { title: 'T', content: 'C', recipient_id: U_VALID },
      adminCtx,
    );
    expect(result.entity.status).toBe('draft');
    expect(result.entity.sent_at).toBeNull();
    expect(result.entity.read_at).toBeNull();
    expect(result.entity.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.entity.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.entity.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.entity.recipient_id).toBe(U_VALID);
    // 返回值匹配 notificationSchema
    expect(() => notificationSchema.parse(result.entity)).not.toThrow();
    // changes（after 快照）含 title/content/recipient_id/status:draft（不含 id/时间戳，沿用 audit Q3）
    expect(result.changes.find((f) => f.field === 'title')?.value).toBe('T');
    expect(result.changes.find((f) => f.field === 'content')?.value).toBe('C');
    expect(result.changes.find((f) => f.field === 'recipient_id')?.value).toBe(U_VALID);
    expect(result.changes.find((f) => f.field === 'status')?.value).toBe('draft');
    // create 无 before
    expect(result.before).toBeUndefined();
  });

  it('recipient_id 指向不存在用户 → 创建成功（draft 不校验收件人存在性，延后至 send，Q8）', async () => {
    const { notificationService } = setup();
    const result = await notificationService.create(
      { title: 'T', content: 'C', recipient_id: U_MISSING },
      adminCtx,
    );
    expect(result.entity.status).toBe('draft');
    expect(result.entity.recipient_id).toBe(U_MISSING);
  });
});

// ---------------------------------------------------------------------------
// 5. service 单层测 · update
// ---------------------------------------------------------------------------
describe('service 单层测 · update', () => {
  it('draft 态 update title → 返回更新后的通知，updated_at 刷新；changes 仅含变更字段', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService);
    const result = await notificationService.update(
      draft.id,
      { title: 'newT' },
      0,
      adminCtx,
    );
    expect(result.entity.title).toBe('newT');
    expect(result.entity.updated_at).not.toBe(draft.updated_at);
    expect(result.entity.status).toBe('draft');
    // before/after 仅含 title（实际变更字段）
    expect(result.before?.find((f) => f.field === 'title')?.value).toBe('T');
    expect(result.changes.find((f) => f.field === 'title')?.value).toBe('newT');
    expect(result.before?.some((f) => f.field === 'content')).toBe(false);
    expect(result.changes.some((f) => f.field === 'content')).toBe(false);
  });

  it('sent 态 update → NOTIFICATION_INVALID_TRANSITION（仅 draft 可编辑，状态守卫）', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService);
    await notificationService.send(draft.id, 0, adminCtx);
    await expectAppError(
      notificationService.update(draft.id, { title: 'x' }, 1, adminCtx),
      'NOTIFICATION_INVALID_TRANSITION',
    );
  });

  it('read 态 update → NOTIFICATION_INVALID_TRANSITION（read 为终态，append-only）', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService);
    await notificationService.send(draft.id, 0, adminCtx);
    await notificationService.markRead(draft.id, 1, recipientCtx);
    await expectAppError(
      notificationService.update(draft.id, { title: 'x' }, 2, adminCtx),
      'NOTIFICATION_INVALID_TRANSITION',
    );
  });

  it('不存在通知 update → NOTIFICATION_NOT_FOUND', async () => {
    const { notificationService } = setup();
    await expectAppError(
      notificationService.update(U_MISSING, { title: 'x' }, 0, adminCtx),
      'NOTIFICATION_NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// 6. service 单层测 · send
// ---------------------------------------------------------------------------
describe('service 单层测 · send', () => {
  it('draft + active 收件人 → status=sent / sent_at 非空 ISO / read_at 仍 null', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService);
    const result = await notificationService.send(draft.id, 0, adminCtx);
    expect(result.entity.status).toBe('sent');
    expect(result.entity.sent_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.entity.read_at).toBeNull();
    // before=[status:draft, sent_at:null] / after=[status:sent, sent_at:ISO]（read_at 未变更不入快照）
    expect(result.before?.find((f) => f.field === 'status')?.value).toBe('draft');
    expect(result.before?.find((f) => f.field === 'sent_at')?.value).toBeNull();
    expect(result.changes.find((f) => f.field === 'status')?.value).toBe('sent');
    expect(result.changes.find((f) => f.field === 'sent_at')?.value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.before?.some((f) => f.field === 'read_at')).toBe(false);
    expect(result.changes.some((f) => f.field === 'read_at')).toBe(false);
  });

  it('draft + 不存在收件人 → NOTIFICATION_RECIPIENT_NOT_FOUND（通知仍 draft）', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService, U_MISSING);
    await expectAppError(
      notificationService.send(draft.id, 0, adminCtx),
      'NOTIFICATION_RECIPIENT_NOT_FOUND',
    );
    // 主操作失败不改状态
    const detail = await notificationService.detail(draft.id, adminCtx);
    expect(detail.status).toBe('draft');
  });

  it('draft + disabled 收件人 → NOTIFICATION_RECIPIENT_DISABLED（通知仍 draft）', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService, U_DISABLED);
    await expectAppError(
      notificationService.send(draft.id, 0, adminCtx),
      'NOTIFICATION_RECIPIENT_DISABLED',
    );
    const detail = await notificationService.detail(draft.id, adminCtx);
    expect(detail.status).toBe('draft');
  });

  it('sent 态 send → NOTIFICATION_INVALID_TRANSITION（同态非法，仅 draft 可 send）', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService);
    await notificationService.send(draft.id, 0, adminCtx);
    await expectAppError(
      notificationService.send(draft.id, 1, adminCtx),
      'NOTIFICATION_INVALID_TRANSITION',
    );
  });

  it('不存在通知 send → NOTIFICATION_NOT_FOUND', async () => {
    const { notificationService } = setup();
    await expectAppError(
      notificationService.send(U_MISSING, 0, adminCtx),
      'NOTIFICATION_NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// 7. service 单层测 · markRead
// ---------------------------------------------------------------------------
describe('service 单层测 · markRead', () => {
  it('sent + 收件人 ctx → status=read / read_at 非空 ISO（收件人自服务，非 admin 通过）', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService);
    await notificationService.send(draft.id, 0, adminCtx);
    // 收件人自服务：recipientCtx.user.id === recipient_id（U_VALID），role='user' 非 admin
    const result = await notificationService.markRead(draft.id, 1, recipientCtx);
    expect(result.entity.status).toBe('read');
    expect(result.entity.read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // before=[status:sent, read_at:null] / after=[status:read, read_at:ISO]（sent_at 未变更不入快照）
    expect(result.before?.find((f) => f.field === 'status')?.value).toBe('sent');
    expect(result.before?.find((f) => f.field === 'read_at')?.value).toBeNull();
    expect(result.changes.find((f) => f.field === 'status')?.value).toBe('read');
    expect(result.changes.find((f) => f.field === 'read_at')?.value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('draft 态 markRead → NOTIFICATION_INVALID_TRANSITION（不可跳过 sent，状态守卫）', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService);
    await expectAppError(
      notificationService.markRead(draft.id, 0, recipientCtx),
      'NOTIFICATION_INVALID_TRANSITION',
    );
  });

  it('read 态 markRead → NOTIFICATION_INVALID_TRANSITION（同态非法）', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService);
    await notificationService.send(draft.id, 0, adminCtx);
    await notificationService.markRead(draft.id, 1, recipientCtx);
    await expectAppError(
      notificationService.markRead(draft.id, 2, recipientCtx),
      'NOTIFICATION_INVALID_TRANSITION',
    );
  });

  it('非收件人 markRead → FORBIDDEN（不论是否 admin；admin 不可代收件人标记已读）', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService);
    await notificationService.send(draft.id, 0, adminCtx);
    // otherUserCtx.user.id === U_OTHER !== recipient_id(=U_VALID)
    await expectAppError(
      notificationService.markRead(draft.id, 1, otherUserCtx),
      'FORBIDDEN',
    );
    // admin 代标记亦拒绝（adminCtx.user.id === ADMIN_ID !== U_VALID）
    await expectAppError(
      notificationService.markRead(draft.id, 1, adminCtx),
      'FORBIDDEN',
    );
  });

  it('不存在通知 markRead → NOTIFICATION_NOT_FOUND（先于收件人校验）', async () => {
    const { notificationService } = setup();
    await expectAppError(
      notificationService.markRead(U_MISSING, 0, recipientCtx),
      'NOTIFICATION_NOT_FOUND',
    );
  });

  it('校验顺序：不存在通知 + 非收件人同时命中 → 先 NOTIFICATION_NOT_FOUND（B5 优先 B4）', async () => {
    const { notificationService } = setup();
    await expectAppError(
      notificationService.markRead(U_MISSING, 0, otherUserCtx),
      'NOTIFICATION_NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// 8. service 单层测 · delete
// ---------------------------------------------------------------------------
describe('service 单层测 · delete', () => {
  it('draft 态 delete → entity=undefined / changes=[] / before 含草稿字段', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService);
    const result = await notificationService.delete(draft.id, 0, adminCtx);
    expect(result.entity).toBeUndefined();
    expect(result.changes).toEqual([]);
    // before 含 title/content/recipient_id/status:draft
    expect(result.before?.find((f) => f.field === 'title')?.value).toBe('T');
    expect(result.before?.find((f) => f.field === 'content')?.value).toBe('C');
    expect(result.before?.find((f) => f.field === 'recipient_id')?.value).toBe(U_VALID);
    expect(result.before?.find((f) => f.field === 'status')?.value).toBe('draft');
  });

  it('sent 态 delete → NOTIFICATION_INVALID_TRANSITION（append-only，sent 后不可删）', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService);
    await notificationService.send(draft.id, 0, adminCtx);
    await expectAppError(
      notificationService.delete(draft.id, 1, adminCtx),
      'NOTIFICATION_INVALID_TRANSITION',
    );
  });

  it('read 态 delete → NOTIFICATION_INVALID_TRANSITION（read 为终态，append-only）', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService);
    await notificationService.send(draft.id, 0, adminCtx);
    await notificationService.markRead(draft.id, 1, recipientCtx);
    await expectAppError(
      notificationService.delete(draft.id, 2, adminCtx),
      'NOTIFICATION_INVALID_TRANSITION',
    );
  });

  it('不存在通知 delete → NOTIFICATION_NOT_FOUND', async () => {
    const { notificationService } = setup();
    await expectAppError(
      notificationService.delete(U_MISSING, 0, adminCtx),
      'NOTIFICATION_NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// 9. service 单层测 · list / detail
// ---------------------------------------------------------------------------
describe('service 单层测 · list / detail', () => {
  it('list 返回匹配 notificationListResultSchema，分页计算 total/totalPages', async () => {
    const { notificationService } = setup();
    for (let i = 0; i < 25; i++) {
      await notificationService.create(
        { title: `T${i}`, content: 'C', recipient_id: U_VALID },
        adminCtx,
      );
    }
    const result = await notificationService.list({ page: 2, pageSize: 10 }, adminCtx);
    expect(() => notificationListResultSchema.parse(result)).not.toThrow();
    expect(result.items).toHaveLength(10);
    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });

  it('list 空库 → items=[] total=0 totalPages=0', async () => {
    const { notificationService } = setup();
    const result = await notificationService.list({ page: 1, pageSize: 10 }, adminCtx);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it('list status=sent 过滤后仅返回 sent 通知', async () => {
    const { notificationService } = setup();
    const d1 = await createDraft(notificationService);
    const d2 = await createDraft(notificationService);
    await notificationService.send(d1.id, 0, adminCtx); // d1 → sent
    // d2 仍 draft
    const sentOnly = await notificationService.list(
      { page: 1, pageSize: 10, status: 'sent' },
      adminCtx,
    );
    expect(sentOnly.items).toHaveLength(1);
    expect(sentOnly.items[0]?.id).toBe(d1.id);
    expect(sentOnly.total).toBe(1);
    const all = await notificationService.list({ page: 1, pageSize: 10 }, adminCtx);
    expect(all.total).toBe(2);
  });

  it('detail 返回匹配 notificationSchema', async () => {
    const { notificationService } = setup();
    const draft = await createDraft(notificationService);
    const result = await notificationService.detail(draft.id, adminCtx);
    expect(() => notificationSchema.parse(result)).not.toThrow();
    expect(result.id).toBe(draft.id);
    expect(result.status).toBe('draft');
  });

  it('detail 不存在 → NOTIFICATION_NOT_FOUND', async () => {
    const { notificationService } = setup();
    await expectAppError(
      notificationService.detail(U_MISSING, adminCtx),
      'NOTIFICATION_NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// 10. 权限测 · SEC-002
// ---------------------------------------------------------------------------
describe('权限 · SEC-002', () => {
  it('非 admin 调 list → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.list, { page: 1, pageSize: 10 }, otherUserCtx), 'FORBIDDEN');
  });

  it('非 admin 调 detail → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.detail, { id: U_VALID }, otherUserCtx), 'FORBIDDEN');
  });

  it('非 admin 调 create → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.create, { title: 'T', content: 'C', recipient_id: U_VALID }, otherUserCtx),
      'FORBIDDEN',
    );
  });

  it('非 admin 调 update → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.update, { id: U_VALID, body: { title: 'x' }, expected_version: 0 }, otherUserCtx),
      'FORBIDDEN',
    );
  });

  it('非 admin 调 send → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.send, { id: U_VALID, expected_version: 0 }, otherUserCtx), 'FORBIDDEN');
  });

  it('非 admin 调 delete → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.delete, { id: U_VALID, expected_version: 0 }, otherUserCtx), 'FORBIDDEN');
  });

  it('markRead 非收件人（含 admin 代标记）→ FORBIDDEN（自服务守卫，非 admin 守卫）', async () => {
    const { router, notificationService } = setup();
    const draft = await createDraft(notificationService);
    await notificationService.send(draft.id, 0, adminCtx);
    // 非收件人 user
    await expectAppError(callProc(router.markRead, { id: draft.id, expected_version: 1 }, otherUserCtx), 'FORBIDDEN');
    // admin 代标记亦拒绝
    await expectAppError(callProc(router.markRead, { id: draft.id, expected_version: 1 }, adminCtx), 'FORBIDDEN');
  });

  it('markRead 收件人（非 admin）→ 成功（自服务，不走 requireAdmin/permission 码）', async () => {
    const { router, notificationService } = setup();
    const draft = await createDraft(notificationService);
    await notificationService.send(draft.id, 0, adminCtx);
    // recipientCtx.user.id === U_VALID === recipient_id，role='user' 非 admin
    const result = await callProc(router.markRead, { id: draft.id, expected_version: 1 }, recipientCtx);
    expect(result.status).toBe('read');
    expect(result.read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// 11. SSOT 派生（AI-005）
// ---------------------------------------------------------------------------
describe('SSOT 派生（AI-005）', () => {
  it('permissionCodeSchema 含 notification:read 与 notification:write（跨域联动①，加性扩展）', () => {
    const allCodes = [...permissionCodeSchema.options];
    expect(allCodes).toContain('notification:read');
    expect(allCodes).toContain('notification:write');
    // 既有码不被破坏
    expect(allCodes).toContain('user:read');
    expect(allCodes).toContain('audit:read');
    expect(allCodes).toContain('report:read');
  });

  it('errorCodeSchema 含 4 个 NOTIFICATION_* 码（跨域联动①）', () => {
    const allCodes = [...errorCodeSchema.options];
    expect(allCodes).toContain('NOTIFICATION_NOT_FOUND');
    expect(allCodes).toContain('NOTIFICATION_RECIPIENT_NOT_FOUND');
    expect(allCodes).toContain('NOTIFICATION_RECIPIENT_DISABLED');
    expect(allCodes).toContain('NOTIFICATION_INVALID_TRANSITION');
    // 既有码不被破坏
    expect(allCodes).toContain('VALIDATION_ERROR');
    expect(allCodes).toContain('FORBIDDEN');
  });

  it('auditLogEntityTypeSchema 含 notification（跨域联动①，使 withAudit 可记 notification 埋点）', () => {
    const allTypes = [...auditLogEntityTypeSchema.options];
    expect(allTypes).toContain('notification');
    // 既有类型不被破坏
    expect(allTypes).toContain('user');
    expect(allTypes).toContain('role');
    expect(allTypes).toContain('dept');
  });

  it('notificationStatusSchema 全集为 [draft, sent, read]（SSOT 派生，禁硬编码）', () => {
    const allStatuses = [...notificationStatusSchema.options];
    expect(allStatuses).toEqual(['draft', 'sent', 'read']);
  });

  it('UserService.findByIds 为 ②类签名变更落点：admin 返回存在的 User[]（不存在 id 静默 omitted）', async () => {
    const { userService } = setup();
    // U_VALID 存在 active，U_MISSING 不存在 → 返回长度=1，仅含 U_VALID
    const users = await userService.findByIds([U_VALID, U_MISSING], adminCtx);
    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe(U_VALID);
    expect(users[0]?.status).toBe('active');
  });

  it('UserService.findByIds 非 admin → FORBIDDEN（SEC-002，admin 守卫）', async () => {
    const { userService } = setup();
    await expectAppError(
      userService.findByIds([U_VALID], otherUserCtx),
      'FORBIDDEN',
    );
  });
});
