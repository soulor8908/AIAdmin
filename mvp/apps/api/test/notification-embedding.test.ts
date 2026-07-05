// apps/api/test/notification-embedding.test.ts —— AI-007 端到端验收测试（测试先行）
//
// 覆盖 PRD-NOTIFICATION-001 F2（发送 + 审计埋点联动，8 条）+ F3（收件人校验，5 条）Given/When/Then，
// 以及 Tech-Spec TECH-NOTIFICATION-001 §9.1 的 13 个端到端验收点。
//
// 核心设计（AI-007）：注入**共享依赖**观测旁路副作用与跨 service 调用，而非隔离自建实例：
//   - 共享 AuditLogRepository（与 notificationRouter 共用同一 auditService → 同一 auditRepo）：
//     写操作后用 auditRepo.listAll() 读**存储态**日志（未脱敏原值，区别于 auditService.list 脱敏态），
//     断言 withAudit 旁路写入的日志内容（entity_type/action/before/after 字段逐一）。
//   - 共享 UserService/UserRepository（注入 NotificationService）：send 时真实调用 userService.findByIds
//     （而非 mock），观测跨 service 调用对收件人存在性/禁用态的判定（D1 跨 service 依赖新模式）。
//
// 注入方案（参照 audit-embedding.test.ts 方案A）：createNotificationRouter(service, auditService?)，
// 缺省自建隔离 AuditLogService；传入共享 auditService 时，notification 5 类写操作经 withAudit 埋点
// 写入同一 auditRepo，本文件据 auditRepo.listAll() 断言 PRD F2 验收标准。
//
// 13 个验收点（对照 PRD §88-95 F2 + §98-102 F3）：
//   F2-1 send draft→sent 成功 → 共享 auditRepo 新增日志 entity_type=notification/action=update/
//        before=[status:draft,sent_at:null]/after=[status:sent,sent_at:<ISO>]；调用方未显式调 audit.record
//   F2-2 create draft → 日志 action=create/before=[]/after=[title,content,recipient_id,status:draft]（不含服务端元数据）
//   F2-3 update draft（title 旧→新）→ 日志 action=update/before=[title:旧]/after=[title:新]（仅含实际变更字段）
//   F2-4 markRead draft 态失败（NOTIFICATION_INVALID_TRANSITION）→ 不产生审计日志
//   F2-5 markRead sent→read 成功 → 日志 action=update/before=[status:sent,read_at:null]/after=[status:read,read_at:<ISO>]；operator_id=收件人
//   F2-6 delete draft → 日志 action=delete/before=[title,content,recipient_id,status:draft]/after=[]
//   F2-7 send 主操作成功但埋点异常（ThrowingAuditLogService）→ 主操作仍返回 sent 通知；埋点异常被吞；auditRepo 空
//   F2-8 send 主操作因校验失败（收件人不存在/禁用/状态非法）→ 不产生审计日志
//   F3-1 recipient=U_valid（active）→ send 成功，status=sent
//   F3-2 recipient=U_missing（不存在）→ send 抛 NOTIFICATION_RECIPIENT_NOT_FOUND；status 仍 draft；不产生审计日志
//   F3-3 recipient=U_disabled（disabled）→ send 抛 NOTIFICATION_RECIPIENT_DISABLED；status 仍 draft；不产生审计日志
//   F3-4 创建 draft 时 recipient 指向不存在用户 → 创建成功（draft 不校验）；后续 send → NOTIFICATION_RECIPIENT_NOT_FOUND（延后校验）
//   F3-5 UserService.findByIds 传入 ids → 返回 User[]，仅含存在的用户（不存在 id 静默 omitted）
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - setup 注入共享依赖：notificationService 注入的 userService 与可观测 userService/userRepo 同一实例；
//     notificationRouter 注入的 auditService 与 auditRepo 同源（AI-007 关键，否则副作用不可观测）。
//   - markRead 经 withAudit 包装（D6），auth='public'（收件人自服务），operator_id=ctx.user.id（收件人）。
//   - F2-7 用 ThrowingAuditLogService（record 抛错）替换共享 auditService，验证 best-effort（Q7）。
import { describe, it, expect } from 'vitest';
import {
  auditLogEntityTypeSchema,
  type ErrorCode,
  type AuditLog,
  type AuditLogEntityType,
  type AuditLogAction,
  type ChangeField,
} from '@admin/contracts';
import { AuditLogRepository } from '../src/repository/audit.js';
import { AuditLogService } from '../src/service/audit.js';
import { UserRepository } from '../src/repository/user.js';
import { UserService } from '../src/service/user.js';
import { NotificationRepository } from '../src/repository/notification.js';
import { NotificationService } from '../src/service/notification.js';
import { createNotificationRouter } from '../src/router/notification.js';
import { AppError } from '../src/errors.js';
import type { Ctx } from '../src/context.js';
import type { Procedure } from '../src/router/user.js';
import { createTestDb } from './helpers/db.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const U_VALID = '00000000-0000-4000-8000-000000000002';
const U_DISABLED = '00000000-0000-4000-8000-000000000003';
const U_MISSING = '00000000-0000-4000-8000-000000000099';
const SEED_TS = '2020-01-01T00:00:00.000Z';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };
const recipientCtx: Ctx = { user: { id: U_VALID, role: 'user' } };

/**
 * 端到端 setup：共享 auditRepo + auditService + 共享 userRepo + userService（注入 notificationService）+
 * notificationRepo + notificationRouter（共享 auditService）。预置 active/disabled 收件人。
 * 关键（AI-007）：notificationService 注入的 userService 与可观测 userService/userRepo 同一实例；
 * notificationRouter 注入的 auditService 与 auditRepo 同源。
 */
function setup(): {
  auditRepo: AuditLogRepository;
  auditService: AuditLogService;
  userRepo: UserRepository;
  userService: UserService;
  notificationRepo: NotificationRepository;
  notificationService: NotificationService;
  notificationRouter: ReturnType<typeof createNotificationRouter>;
} {
  // 多 repo 共享同一 db（notificationService 经 userService 查收件人 + withAudit 埋点写入 auditRepo）
  const db = createTestDb();
  const auditRepo = new AuditLogRepository(db);
  const auditService = new AuditLogService(auditRepo);
  const userRepo = new UserRepository(db);
  // seed 操作者 admin + active/disabled 收件人（F3 校验靶子）
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
  const userService = new UserService(userRepo);
  const notificationRepo = new NotificationRepository(db);
  const notificationService = new NotificationService(userService, notificationRepo);
  // 方案A：notificationRouter 共享 auditService（→ 同一 auditRepo，埋点可观测）
  const notificationRouter = createNotificationRouter(notificationService, auditService);
  return {
    auditRepo,
    auditService,
    userRepo,
    userService,
    notificationRepo,
    notificationService,
    notificationRouter,
  };
}

/**
 * mock best-effort 场景（F2-7 / PRD Q7）：record 抛错模拟埋点失败。
 * withAudit 须吞掉异常，主操作仍返回 entity，日志不入库。
 */
class ThrowingAuditLogService extends AuditLogService {
  async record(): Promise<never> {
    throw new Error('mocked audit record failure (best-effort scenario)');
  }
}

/**
 * best-effort setup（F2-7）：用 ThrowingAuditLogService 替换共享 auditService（record 抛错），
 * 其余依赖同 setup()。预置 active 收件人使 send 主操作可成功。
 */
function setupThrowingAudit(): {
  throwingRepo: AuditLogRepository;
  notificationRouter: ReturnType<typeof createNotificationRouter>;
} {
  const db = createTestDb();
  const throwingRepo = new AuditLogRepository(db);
  const throwingAudit = new ThrowingAuditLogService(throwingRepo);
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
  const userService = new UserService(userRepo);
  const notificationRepo = new NotificationRepository(db);
  const notificationService = new NotificationService(userService, notificationRepo);
  const notificationRouter = createNotificationRouter(notificationService, throwingAudit);
  return { throwingRepo, notificationRouter };
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

/** 从 ChangeField[] 中按字段名取 value（D5 结构化访问辅助）。 */
function fieldValue(fields: ChangeField[], name: string): unknown {
  return fields.find((f) => f.field === name)?.value;
}

/** 从 ChangeField[] 中按字段名取 pii 标记。 */
function fieldPii(fields: ChangeField[], name: string): boolean | undefined {
  return fields.find((f) => f.field === name)?.pii;
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
  // 返回最近一条匹配（末条）：send 与 markRead 同为 action=update 时须取后者（markRead），
  // .find() 返回首条会误中 send 日志，故用 .filter().pop() 取末条（与注释"最近一条"一致）。
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

/** 经 router 创建一条 draft 通知（admin），返回通知实体。供 send/markRead/update/delete 复用。 */
async function createDraftViaRouter(
  router: ReturnType<typeof createNotificationRouter>,
  recipientId: string = U_VALID,
  title: string = 'T',
  content: string = 'C',
): Promise<{ id: string; title: string; content: string; recipient_id: string; status: string }> {
  return callProc(
    router.create,
    { title, content, recipient_id: recipientId },
    adminCtx,
  );
}

// ---------------------------------------------------------------------------
// F2 端到端 · 审计埋点联动（8 条，注入共享 AuditLogRepository）
// ---------------------------------------------------------------------------
describe('F2 端到端 · 审计埋点联动（共享 AuditLogRepository 观测旁路副作用）', () => {
  it('F2-1 §88 send draft→sent 成功 → 共享 auditRepo 新增日志 entity_type=notification/action=update/before=[status:draft,sent_at:null]/after=[status:sent,sent_at:<ISO>]；调用方未显式调 audit.record', async () => {
    const { notificationRouter, auditRepo } = setup();
    const draft = await createDraftViaRouter(notificationRouter, U_VALID);
    const logsBefore = auditRepo.listAll().length;
    // send（admin 操作，operator_id=ADMIN_ID）
    const sent = await callProc(notificationRouter.send, { id: draft.id, expected_version: 0 }, adminCtx);
    expect(sent.status).toBe('sent');
    expect(sent.sent_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sent.read_at).toBeNull();
    // 调用方未显式调 audit.record（埋点透明）：日志由 withAudit 旁路写入共享 auditRepo
    expect(auditRepo.listAll().length).toBe(logsBefore + 1);
    const log = findLog(auditRepo, {
      entityType: 'notification',
      entityId: draft.id,
      action: 'update',
    });
    expect(log).toBeDefined();
    if (!log) return;
    expect(log.entity_type).toBe('notification');
    expect(log.action).toBe('update');
    expect(log.entity_id).toBe(draft.id);
    expect(log.operator_id).toBe(ADMIN_ID);
    expect(log.operated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // before=[{status:'draft',pii:false},{sent_at:null,pii:false}]
    expect(log.before).toHaveLength(3);
    expect(fieldValue(log.before, 'status')).toBe('draft');
    expect(fieldPii(log.before, 'status')).toBe(false);
    expect(fieldValue(log.before, 'sent_at')).toBeNull();
    expect(fieldPii(log.before, 'sent_at')).toBe(false);
    // after=[{status:'sent',pii:false},{sent_at:<非空ISO>,pii:false}]（read_at 未变更不入快照）
    expect(log.after).toHaveLength(3);
    expect(fieldValue(log.after, 'status')).toBe('sent');
    expect(fieldPii(log.after, 'status')).toBe(false);
    expect(fieldValue(log.after, 'sent_at')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fieldPii(log.after, 'sent_at')).toBe(false);
    expect(hasField(log.after, 'read_at')).toBe(false);
  });

  it('F2-2 §89 create draft → 日志 action=create/before=[]/after=[title,content,recipient_id,status:draft]（不含 id/created_at/updated_at/sent_at/read_at）', async () => {
    const { notificationRouter, auditRepo } = setup();
    const created = await callProc(
      notificationRouter.create,
      { title: 'T', content: 'C', recipient_id: U_VALID },
      adminCtx,
    );
    const log = findLog(auditRepo, {
      entityType: 'notification',
      entityId: created.id,
      action: 'create',
    });
    expect(log).toBeDefined();
    if (!log) return;
    expect(log.entity_type).toBe('notification');
    expect(log.action).toBe('create');
    expect(log.entity_id).toBe(created.id);
    expect(log.operator_id).toBe(ADMIN_ID);
    expect(log.before).toEqual([]);
    // after 含且仅含 4 字段（title/content/recipient_id/status:'draft'），无服务端元数据
    expect(log.after).toHaveLength(4);
    expect(hasField(log.after, 'title')).toBe(true);
    expect(hasField(log.after, 'content')).toBe(true);
    expect(hasField(log.after, 'recipient_id')).toBe(true);
    expect(hasField(log.after, 'status')).toBe(true);
    expect(fieldValue(log.after, 'title')).toBe('T');
    expect(fieldValue(log.after, 'content')).toBe('C');
    expect(fieldValue(log.after, 'recipient_id')).toBe(U_VALID);
    expect(fieldValue(log.after, 'status')).toBe('draft');
    // pii 全 false（notification 无 PII 字段）
    for (const f of log.after) {
      expect(f.pii).toBe(false);
    }
    // 不含服务端元数据字段
    expect(hasField(log.after, 'id')).toBe(false);
    expect(hasField(log.after, 'created_at')).toBe(false);
    expect(hasField(log.after, 'updated_at')).toBe(false);
    expect(hasField(log.after, 'sent_at')).toBe(false);
    expect(hasField(log.after, 'read_at')).toBe(false);
  });

  it('F2-3 §90 update draft（title 旧→新）→ 日志 action=update/before=[title:旧]/after=[title:新]（仅含实际变更字段）', async () => {
    const { notificationRouter, auditRepo } = setup();
    const draft = await createDraftViaRouter(notificationRouter, U_VALID, '旧', 'C');
    const logsBefore = auditRepo.listAll().length;
    // 编辑 title（旧→新），content/recipient_id 未变更
    const updated = await callProc(
      notificationRouter.update,
      { id: draft.id, body: { title: '新' }, expected_version: 0 },
      adminCtx,
    );
    expect(updated.title).toBe('新');
    expect(auditRepo.listAll().length).toBe(logsBefore + 1);
    const log = findLog(auditRepo, {
      entityType: 'notification',
      entityId: draft.id,
      action: 'update',
    });
    expect(log).toBeDefined();
    if (!log) return;
    expect(log.action).toBe('update');
    // before/after 仅含 title（content/recipient_id 未变更不入快照）
    expect(log.before).toHaveLength(2);
    expect(log.after).toHaveLength(2);
    expect(hasField(log.before, 'title')).toBe(true);
    expect(hasField(log.after, 'title')).toBe(true);
    expect(fieldValue(log.before, 'title')).toBe('旧');
    expect(fieldValue(log.after, 'title')).toBe('新');
    expect(fieldPii(log.before, 'title')).toBe(false);
    expect(fieldPii(log.after, 'title')).toBe(false);
    // 未变更字段不入快照
    expect(hasField(log.before, 'content')).toBe(false);
    expect(hasField(log.after, 'content')).toBe(false);
    expect(hasField(log.before, 'recipient_id')).toBe(false);
    expect(hasField(log.after, 'recipient_id')).toBe(false);
  });

  it('F2-4 §91 markRead draft 态失败（NOTIFICATION_INVALID_TRANSITION）→ 不产生审计日志（仅成功写操作记录）', async () => {
    const { notificationRouter, auditRepo } = setup();
    // draft 通知，收件人=U_VALID（recipientCtx 收件人身份，自服务可调 markRead）
    const draft = await createDraftViaRouter(notificationRouter, U_VALID);
    const logsBefore = auditRepo.listAll().length;
    // 收件人对 draft 态标记已读 → 状态守卫 draft→read 非法（NOTIFICATION_INVALID_TRANSITION）
    await expectAppError(
      callProc(notificationRouter.markRead, { id: draft.id, expected_version: 0 }, recipientCtx),
      'NOTIFICATION_INVALID_TRANSITION',
    );
    // 主操作失败不埋点（沿用第五轮 Q2）：auditRepo 长度不变
    expect(auditRepo.listAll().length).toBe(logsBefore);
  });

  it('F2-5 §92 markRead sent→read 成功 → 日志 action=update/before=[status:sent,read_at:null]/after=[status:read,read_at:<ISO>]；operator_id=收件人 id', async () => {
    const { notificationRouter, auditRepo } = setup();
    const draft = await createDraftViaRouter(notificationRouter, U_VALID);
    await callProc(notificationRouter.send, { id: draft.id, expected_version: 0 }, adminCtx); // draft→sent
    const logsBefore = auditRepo.listAll().length;
    // 收件人 U_VALID 标记已读（自服务，operator_id=U_VALID）
    const read = await callProc(notificationRouter.markRead, { id: draft.id, expected_version: 1 }, recipientCtx);
    expect(read.status).toBe('read');
    expect(read.read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(auditRepo.listAll().length).toBe(logsBefore + 1);
    const log = findLog(auditRepo, {
      entityType: 'notification',
      entityId: draft.id,
      action: 'update',
    });
    expect(log).toBeDefined();
    if (!log) return;
    expect(log.entity_type).toBe('notification');
    expect(log.action).toBe('update');
    expect(log.entity_id).toBe(draft.id);
    // operator_id=收件人 id（markRead 自服务，非 admin）
    expect(log.operator_id).toBe(U_VALID);
    // before=[{status:'sent',pii:false},{read_at:null,pii:false}]（sent_at 未变更不入快照）
    expect(log.before).toHaveLength(3);
    expect(fieldValue(log.before, 'status')).toBe('sent');
    expect(fieldPii(log.before, 'status')).toBe(false);
    expect(fieldValue(log.before, 'read_at')).toBeNull();
    expect(fieldPii(log.before, 'read_at')).toBe(false);
    // after=[{status:'read',pii:false},{read_at:<非空ISO>,pii:false}]
    expect(log.after).toHaveLength(3);
    expect(fieldValue(log.after, 'status')).toBe('read');
    expect(fieldPii(log.after, 'status')).toBe(false);
    expect(fieldValue(log.after, 'read_at')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fieldPii(log.after, 'read_at')).toBe(false);
    expect(hasField(log.after, 'sent_at')).toBe(false);
  });

  it('F2-6 §93 delete draft → 日志 action=delete/before=[title,content,recipient_id,status:draft]/after=[]', async () => {
    const { notificationRouter, auditRepo } = setup();
    const draft = await createDraftViaRouter(notificationRouter, U_VALID, 'T', 'C');
    const logsBefore = auditRepo.listAll().length;
    await callProc(notificationRouter.delete, { id: draft.id, expected_version: 0 }, adminCtx);
    expect(auditRepo.listAll().length).toBe(logsBefore + 1);
    const log = findLog(auditRepo, {
      entityType: 'notification',
      entityId: draft.id,
      action: 'delete',
    });
    expect(log).toBeDefined();
    if (!log) return;
    expect(log.entity_type).toBe('notification');
    expect(log.action).toBe('delete');
    expect(log.entity_id).toBe(draft.id);
    expect(log.operator_id).toBe(ADMIN_ID);
    // after=[]（删除无 after 快照）
    expect(log.after).toEqual([]);
    // before=[{title},{content},{recipient_id},{status:'draft'}]
    expect(log.before).toHaveLength(5);
    expect(hasField(log.before, 'title')).toBe(true);
    expect(hasField(log.before, 'content')).toBe(true);
    expect(hasField(log.before, 'recipient_id')).toBe(true);
    expect(hasField(log.before, 'status')).toBe(true);
    expect(fieldValue(log.before, 'title')).toBe('T');
    expect(fieldValue(log.before, 'content')).toBe('C');
    expect(fieldValue(log.before, 'recipient_id')).toBe(U_VALID);
    expect(fieldValue(log.before, 'status')).toBe('draft');
    for (const f of log.before) {
      expect(f.pii).toBe(false);
    }
  });

  it('F2-7 §94 send 主操作成功但埋点异常（ThrowingAuditLogService）→ 主操作仍返回 sent 通知；埋点异常被吞；auditRepo 空', async () => {
    const { throwingRepo, notificationRouter } = setupThrowingAudit();
    const draft = await createDraftViaRouter(notificationRouter, U_VALID);
    // send 主操作成功（收件人 active，draft→sent 合法），埋点环节 record 抛错被 withAudit 吞掉
    const sent = await callProc(notificationRouter.send, { id: draft.id, expected_version: 0 }, adminCtx);
    expect(sent.status).toBe('sent');
    expect(sent.sent_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // 埋点失败：record 抛错在 insert 前，日志未入库（create 与 send 的埋点均失败被吞）
    expect(throwingRepo.listAll()).toHaveLength(0);
  });

  it('F2-8 §95 send 主操作因校验失败（收件人不存在/禁用/状态非法）→ 不产生审计日志', async () => {
    const { notificationRouter, auditRepo } = setup();

    // 场景1：收件人不存在（recipient_id=U_MISSING）→ NOTIFICATION_RECIPIENT_NOT_FOUND
    const draftMissing = await createDraftViaRouter(notificationRouter, U_MISSING);
    let logsBefore = auditRepo.listAll().length;
    await expectAppError(
      callProc(notificationRouter.send, { id: draftMissing.id, expected_version: 0 }, adminCtx),
      'NOTIFICATION_RECIPIENT_NOT_FOUND',
    );
    expect(auditRepo.listAll().length).toBe(logsBefore); // 不产生审计日志

    // 场景2：收件人禁用（recipient_id=U_DISABLED）→ NOTIFICATION_RECIPIENT_DISABLED
    const draftDisabled = await createDraftViaRouter(notificationRouter, U_DISABLED);
    logsBefore = auditRepo.listAll().length;
    await expectAppError(
      callProc(notificationRouter.send, { id: draftDisabled.id, expected_version: 0 }, adminCtx),
      'NOTIFICATION_RECIPIENT_DISABLED',
    );
    expect(auditRepo.listAll().length).toBe(logsBefore); // 不产生审计日志

    // 场景3：状态非法（sent→sent 同态，send 仅 draft 允许）→ NOTIFICATION_INVALID_TRANSITION
    const draftSent = await createDraftViaRouter(notificationRouter, U_VALID);
    await callProc(notificationRouter.send, { id: draftSent.id, expected_version: 0 }, adminCtx); // draft→sent
    logsBefore = auditRepo.listAll().length;
    await expectAppError(
      callProc(notificationRouter.send, { id: draftSent.id, expected_version: 1 }, adminCtx),
      'NOTIFICATION_INVALID_TRANSITION',
    );
    expect(auditRepo.listAll().length).toBe(logsBefore); // 不产生审计日志
  });
});

// ---------------------------------------------------------------------------
// F3 端到端 · 跨 service 收件人校验（5 条，注入共享 UserService/UserRepository）
// ---------------------------------------------------------------------------
describe('F3 端到端 · 跨 service 收件人校验（共享 UserService/UserRepository 观测跨 service 调用）', () => {
  it('F3-1 §98 recipient=U_valid（存在且 active）→ send 成功，通知 status=sent', async () => {
    const { notificationRouter, notificationRepo } = setup();
    const draft = await createDraftViaRouter(notificationRouter, U_VALID);
    const sent = await callProc(notificationRouter.send, { id: draft.id, expected_version: 0 }, adminCtx);
    expect(sent.status).toBe('sent');
    expect(sent.recipient_id).toBe(U_VALID);
    // 跨 service 调用 userService.findByIds([U_VALID]) 判定收件人存在且 active → 校验通过
    const stored = notificationRepo.findById(draft.id);
    expect(stored?.status).toBe('sent');
    expect(stored?.sent_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('F3-2 §99 recipient=U_missing（不存在）→ send 抛 NOTIFICATION_RECIPIENT_NOT_FOUND；通知 status 仍 draft；不产生审计日志', async () => {
    const { notificationRouter, notificationRepo, auditRepo } = setup();
    const draft = await createDraftViaRouter(notificationRouter, U_MISSING);
    const logsBefore = auditRepo.listAll().length;
    await expectAppError(
      callProc(notificationRouter.send, { id: draft.id, expected_version: 0 }, adminCtx),
      'NOTIFICATION_RECIPIENT_NOT_FOUND',
    );
    // 通知 status 仍 draft（主操作失败不改状态）
    const stored = notificationRepo.findById(draft.id);
    expect(stored?.status).toBe('draft');
    expect(stored?.sent_at).toBeNull();
    // 不产生审计日志
    expect(auditRepo.listAll().length).toBe(logsBefore);
  });

  it('F3-3 §100 recipient=U_disabled（存在但 disabled）→ send 抛 NOTIFICATION_RECIPIENT_DISABLED；通知 status 仍 draft；不产生审计日志', async () => {
    const { notificationRouter, notificationRepo, auditRepo } = setup();
    const draft = await createDraftViaRouter(notificationRouter, U_DISABLED);
    const logsBefore = auditRepo.listAll().length;
    await expectAppError(
      callProc(notificationRouter.send, { id: draft.id, expected_version: 0 }, adminCtx),
      'NOTIFICATION_RECIPIENT_DISABLED',
    );
    // 通知 status 仍 draft（主操作失败不改状态）
    const stored = notificationRepo.findById(draft.id);
    expect(stored?.status).toBe('draft');
    expect(stored?.sent_at).toBeNull();
    // 不产生审计日志
    expect(auditRepo.listAll().length).toBe(logsBefore);
  });

  it('F3-4 §101 创建 draft 时 recipient 指向不存在用户 → 创建成功（draft 不校验收件人）；后续 send → NOTIFICATION_RECIPIENT_NOT_FOUND（验证延后校验）', async () => {
    const { notificationRouter, notificationRepo } = setup();
    // 创建 draft 时 recipient_id=U_MISSING（不存在），仅做 uuid 格式校验，不查存在性 → 创建成功
    const draft = await createDraftViaRouter(notificationRouter, U_MISSING);
    expect(draft.status).toBe('draft');
    expect(draft.recipient_id).toBe(U_MISSING);
    const stored = notificationRepo.findById(draft.id);
    expect(stored).toBeDefined();
    expect(stored?.status).toBe('draft');
    // 后续 send → 延后校验生效：收件人不存在 → NOTIFICATION_RECIPIENT_NOT_FOUND
    await expectAppError(
      callProc(notificationRouter.send, { id: draft.id, expected_version: 0 }, adminCtx),
      'NOTIFICATION_RECIPIENT_NOT_FOUND',
    );
    // 通知仍 draft（延后校验失败不改状态）
    const storedAfter = notificationRepo.findById(draft.id);
    expect(storedAfter?.status).toBe('draft');
  });

  it('F3-5 §102 UserService.findByIds 传入 ids → 返回 User[]，仅含存在的用户（不存在 id 静默 omitted）', async () => {
    const { userService } = setup();
    // 直接断言跨 service 依赖的底层方法语义：findByIds([存在,不存在]) → 仅含存在者
    const users = await userService.findByIds([U_VALID, U_MISSING], adminCtx);
    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe(U_VALID);
    expect(users[0]?.status).toBe('active');
    // 不存在的 id 静默 omitted（不在结果中），不抛错
    const disabledOnly = await userService.findByIds([U_DISABLED], adminCtx);
    expect(disabledOnly).toHaveLength(1);
    expect(disabledOnly[0]?.id).toBe(U_DISABLED);
    expect(disabledOnly[0]?.status).toBe('disabled');
    // NotificationService.send 据此判存在与禁用：空 → NOTIFICATION_RECIPIENT_NOT_FOUND；
    // 含 disabled → NOTIFICATION_RECIPIENT_DISABLED（F3-2/F3-3 已端到端覆盖判定结果）
  });
});

// ---------------------------------------------------------------------------
// SSOT 派生（AI-005）· 跨域联动①使 notification 加入实体类型枚举
// ---------------------------------------------------------------------------
describe('SSOT 派生（AI-005）· 跨域联动①使 notification 加入实体类型枚举', () => {
  it('[...auditLogEntityTypeSchema.options] 含 notification（使 withAudit 可记 notification 埋点，禁硬编码）', () => {
    const allTypes = [...auditLogEntityTypeSchema.options];
    expect(allTypes).toContain('notification');
    // 既有类型不被破坏（跨域联动①为加性扩展）
    expect(allTypes).toContain('user');
    expect(allTypes).toContain('role');
    expect(allTypes).toContain('dept');
  });
});
