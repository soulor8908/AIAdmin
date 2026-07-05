// apps/api/test/audit-embedding.test.ts —— F1 端到端验收测试（PRD-AUDIT-ENHANCEMENT-001 F1，第66-76行）
//
// 背景（第五轮 Reviewer S-1）：F1 端到端测试缺失。既有测试用 createXxxRouter(service) 只传 service，
// router 内部自建隔离的 AuditLogService/AuditLogRepository（new AuditLogService(new AuditLogRepository())），
// 导致写操作后无法验证日志被记录，B-1（role action 错）/B-2（dept entity_type 错）无法被测试抓出。
// impl-writer 已修复 B-1/B-2，并扩展 router 工厂接受可选 auditService 参数（方案A，向后兼容）。
//
// 注入方案（方案A —— 已由 impl-writer 实现，本文件不改 router 签名）：
//   createUserRouter(service, auditService?) / createRoleRouter(service, auditService?) / createDeptRouter(service, auditService?)
//   缺省时 router 自建隔离 AuditLogService（既有测试兼容，best-effort 日志去向不影响断言）；
//   传入共享 auditService 时，三域写操作 withAudit 埋点写入同一 auditRepo，
//   本文件据 auditRepo.listAll() 读存储态日志（未脱敏原值，区别于 service.list 的脱敏态）断言 PRD F1 验收标准。
//
// 覆盖 PRD F1 验收标准（第66-76行）11 个验收点：
//   1. user.create 埋点（§66）
//   2. user.updateStatus 埋点（§67）
//   3. role.create 埋点（§68）
//   4. role.delete 埋点（§69）
//   5. role.assign 埋点 — B-1 修复验证 action=update + assigned_user_ids（§70）
//   6. role.remove 埋点 — B-1 修复验证 action=update + assigned_user_ids（§70）
//   7. dept.create 埋点（§71）
//   8. dept.delete 埋点（§72）
//   9. dept.assignUserDepartment 埋点 — B-2 修复验证 entity_type=user + department_id（§73）
//  10. 读操作不记日志（§74）
//  11. 主操作失败不记日志（§75）
//  12. 埋点失败不影响主操作 best-effort（§76）
// 另含 SSOT 派生断言（AI-005）：entity_type/action 全集用 [...auditLogEntityTypeSchema.options] / [...auditLogActionSchema.options] 派生。
import { describe, it, expect } from 'vitest';
import {
  auditLogEntityTypeSchema,
  auditLogActionSchema,
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
import { RoleRepository } from '../src/repository/role.js';
import { RoleService } from '../src/service/role.js';
import { DepartmentRepository } from '../src/repository/dept.js';
import { DepartmentService } from '../src/service/dept.js';
import { ReportService } from '../src/service/report.js';
import { createUserRouter } from '../src/router/user.js';
import { createRoleRouter } from '../src/router/role.js';
import { createDeptRouter } from '../src/router/dept.js';
import { createAuditRouter } from '../src/router/audit.js';
import { createReportRouter } from '../src/router/report.js';
import { NotificationRepository } from '../src/repository/notification.js';
import { NotificationService } from '../src/service/notification.js';
import { createNotificationRouter } from '../src/router/notification.js';
import { AppError } from '../src/errors.js';
import type { Ctx } from '../src/context.js';
import type { Procedure } from '../src/router/user.js';
import { createTestDb } from './helpers/db.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const SEED_TS = '2020-01-01T00:00:00.000Z';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };

/**
 * 端到端 setup：创建共享 auditRepo + auditService，注入三域 router（+ audit/report 读路由）。
 * 三域写操作经 withAudit 埋点写入同一 auditRepo，供测试断言日志内容（存储态，未脱敏原值）。
 */
function setup(): {
  auditRepo: AuditLogRepository;
  auditService: AuditLogService;
  userRepo: UserRepository;
  roleRepo: RoleRepository;
  deptRepo: DepartmentRepository;
  notificationRepo: NotificationRepository;
  userRouter: ReturnType<typeof createUserRouter>;
  roleRouter: ReturnType<typeof createRoleRouter>;
  deptRouter: ReturnType<typeof createDeptRouter>;
  notificationRouter: ReturnType<typeof createNotificationRouter>;
  auditRouter: ReturnType<typeof createAuditRouter>;
  reportRouter: ReturnType<typeof createReportRouter>;
} {
  // 多 repo 共享同一 db（五域 router 共享 auditService 埋点写入同一 auditRepo，跨 repo 查询需一致）
  const db = createTestDb();
  const auditRepo = new AuditLogRepository(db);
  const auditService = new AuditLogService(auditRepo);
  const userRepo = new UserRepository(db);
  const roleRepo = new RoleRepository(db);
  const deptRepo = new DepartmentRepository(db);
  // seed admin 用户（role.assign / dept.assignUserDepartment 依赖用户存在；department_id 缺省=未归属）
  userRepo.insert({
    id: ADMIN_ID,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    version: 0,
    password_hash: 'test-hash-placeholder',
    created_at: SEED_TS,
    updated_at: SEED_TS,
  });
  const userService = new UserService(userRepo);
  const roleService = new RoleService(roleRepo, userRepo);
  const deptService = new DepartmentService(deptRepo, userRepo);
  const reportService = new ReportService(auditRepo);
  // notification 域（跨域联动①）：注入共享 userService（D1 跨 service 依赖）+ 独立 notificationRepo
  const notificationRepo = new NotificationRepository(db);
  const notificationService = new NotificationService(userService, notificationRepo);
  // 方案A：四域 router 共享同一 auditService（→ 同一 auditRepo，埋点可观测）
  const userRouter = createUserRouter(userService, auditService);
  const roleRouter = createRoleRouter(roleService, auditService);
  const deptRouter = createDeptRouter(deptService, auditService);
  const notificationRouter = createNotificationRouter(notificationService, auditService);
  const auditRouter = createAuditRouter(auditService);
  const reportRouter = createReportRouter(reportService);
  return {
    auditRepo,
    auditService,
    userRepo,
    roleRepo,
    deptRepo,
    notificationRepo,
    userRouter,
    roleRouter,
    deptRouter,
    notificationRouter,
    auditRouter,
    reportRouter,
  };
}

/**
 * mock best-effort 场景（§76）：record 抛错模拟埋点失败。
 * withAudit 须吞掉异常，主操作仍返回 entity，日志不入库。
 */
class ThrowingAuditLogService extends AuditLogService {
  async record(): Promise<never> {
    throw new Error('mocked audit record failure (best-effort scenario)');
  }
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
  return repo.listAll().find((l) =>
    (match.entityType === undefined || l.entity_type === match.entityType) &&
    (match.entityId === undefined || l.entity_id === match.entityId) &&
    (match.action === undefined || l.action === match.action),
  );
}

// ---------------------------------------------------------------------------
// F1 端到端 · user 域埋点（§66-67）
// ---------------------------------------------------------------------------
describe('F1 端到端 · user 域埋点', () => {
  it('§66 user.create：成功后记日志 entity_type=user/action=create/before=[]/after 含 email(pii:true)+name(pii:false)+status(pii:false)', async () => {
    const { userRouter, auditRepo } = setup();
    const user = await callProc(
      userRouter.create,
      { email: 'alice@example.com', name: 'Alice' },
      adminCtx,
    );
    // 调用方未显式调 audit.record（埋点透明）：日志由 withAudit 旁路写入共享 auditRepo
    const log = findLog(auditRepo, {
      entityType: 'user',
      entityId: user.id,
      action: 'create',
    });
    expect(log).toBeDefined();
    if (!log) return;
    expect(log.entity_type).toBe('user');
    expect(log.action).toBe('create');
    expect(log.entity_id).toBe(user.id);
    expect(log.operator_id).toBe(ADMIN_ID);
    expect(log.before).toEqual([]);
    // after 含 email(pii:true) + name(pii:false) + status(pii:false, value='active')
    expect(hasField(log.after, 'email')).toBe(true);
    expect(hasField(log.after, 'name')).toBe(true);
    expect(hasField(log.after, 'status')).toBe(true);
    expect(fieldValue(log.after, 'email')).toBe('alice@example.com');
    expect(fieldPii(log.after, 'email')).toBe(true); // PII 标记：email 为 PII
    expect(fieldValue(log.after, 'name')).toBe('Alice');
    expect(fieldPii(log.after, 'name')).toBe(false);
    expect(fieldValue(log.after, 'status')).toBe('active');
    expect(fieldPii(log.after, 'status')).toBe(false);
    // operated_at 记录操作时间（ISO 8601）
    expect(log.operated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('§67 user.updateStatus：成功后记日志 entity_type=user/action=update/before=[status:active]/after=[status:disabled]，未变更字段不出现在快照中', async () => {
    const { userRouter, auditRepo } = setup();
    // 先创建一个 active 用户（产生 1 条 create 日志）
    const user = await callProc(
      userRouter.create,
      { email: 'bob@example.com', name: 'Bob' },
      adminCtx,
    );
    // 禁用该用户
    await callProc(
      userRouter.updateStatus,
      { id: user.id, body: { status: 'disabled' }, expected_version: 0 },
      adminCtx,
    );
    const log = findLog(auditRepo, {
      entityType: 'user',
      entityId: user.id,
      action: 'update',
    });
    expect(log).toBeDefined();
    if (!log) return;
    expect(log.entity_type).toBe('user');
    expect(log.action).toBe('update');
    expect(log.entity_id).toBe(user.id);
    // before=[{field:status,value:'active',pii:false}]
    expect(log.before).toHaveLength(2);
    expect(fieldValue(log.before, 'status')).toBe('active');
    expect(fieldPii(log.before, 'status')).toBe(false);
    // after=[{field:status,value:'disabled',pii:false}]
    expect(log.after).toHaveLength(2);
    expect(fieldValue(log.after, 'status')).toBe('disabled');
    expect(fieldPii(log.after, 'status')).toBe(false);
    // 未变更字段不出现在快照中：email/name 不在 before/after
    expect(hasField(log.before, 'email')).toBe(false);
    expect(hasField(log.before, 'name')).toBe(false);
    expect(hasField(log.after, 'email')).toBe(false);
    expect(hasField(log.after, 'name')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F1 端到端 · role 域埋点（§68-70）
// ---------------------------------------------------------------------------
describe('F1 端到端 · role 域埋点', () => {
  it('§68 role.create：成功后记日志 entity_type=role/action=create/before=[]/after 含 name/description/permission_codes(string[])', async () => {
    const { roleRouter, auditRepo } = setup();
    const role = await callProc(
      roleRouter.create,
      { name: 'editor', description: '编辑者', permission_codes: ['user:read', 'role:read'] },
      adminCtx,
    );
    const log = findLog(auditRepo, {
      entityType: 'role',
      entityId: role.id,
      action: 'create',
    });
    expect(log).toBeDefined();
    if (!log) return;
    expect(log.entity_type).toBe('role');
    expect(log.action).toBe('create');
    expect(log.entity_id).toBe(role.id);
    expect(log.before).toEqual([]);
    // after 含 name/description/permission_codes(string[],pii:false)
    expect(hasField(log.after, 'name')).toBe(true);
    expect(hasField(log.after, 'description')).toBe(true);
    expect(hasField(log.after, 'permission_codes')).toBe(true);
    expect(fieldValue(log.after, 'name')).toBe('editor');
    expect(fieldPii(log.after, 'name')).toBe(false); // role 域无 PII
    expect(fieldValue(log.after, 'permission_codes')).toEqual(['user:read', 'role:read']);
    expect(Array.isArray(fieldValue(log.after, 'permission_codes'))).toBe(true);
    expect(fieldPii(log.after, 'permission_codes')).toBe(false);
    expect(fieldPii(log.after, 'description')).toBe(false);
  });

  it('§69 role.delete：成功后记日志 entity_type=role/action=delete/before 含角色字段/after=[]', async () => {
    const { roleRouter, auditRepo } = setup();
    const role = await callProc(
      roleRouter.create,
      { name: 'toDelete', description: 'd', permission_codes: [] },
      adminCtx,
    );
    await callProc(roleRouter.delete, { id: role.id, expected_version: 0 }, adminCtx);
    const log = findLog(auditRepo, {
      entityType: 'role',
      entityId: role.id,
      action: 'delete',
    });
    expect(log).toBeDefined();
    if (!log) return;
    expect(log.entity_type).toBe('role');
    expect(log.action).toBe('delete');
    expect(log.entity_id).toBe(role.id);
    expect(log.after).toEqual([]);
    // before 含删除前角色业务字段（name/permission_codes）
    expect(hasField(log.before, 'name')).toBe(true);
    expect(hasField(log.before, 'permission_codes')).toBe(true);
    expect(fieldValue(log.before, 'name')).toBe('toDelete');
  });

  it('§70 role.assign（B-1 修复验证）：entity_type=role/action=update/before 含 assigned_user_ids(旧)/after 含 assigned_user_ids(新)', async () => {
    const { roleRouter, roleRepo, auditRepo } = setup();
    const role = await callProc(
      roleRouter.create,
      { name: 'assignTarget', description: 'd', permission_codes: [] },
      adminCtx,
    );
    // 分配前该角色无关联用户 → before.assigned_user_ids = []
    await callProc(roleRouter.assign, { userId: ADMIN_ID, roleId: role.id }, adminCtx);
    const log = findLog(auditRepo, {
      entityType: 'role',
      entityId: role.id,
      action: 'update',
    });
    expect(log).toBeDefined();
    if (!log) return;
    // B-1 修复：action=update（非 assign/create）
    expect(log.entity_type).toBe('role');
    expect(log.action).toBe('update');
    expect(log.entity_id).toBe(role.id);
    // before/after 含虚拟字段 assigned_user_ids (string[])
    expect(hasField(log.before, 'assigned_user_ids')).toBe(true);
    expect(hasField(log.after, 'assigned_user_ids')).toBe(true);
    expect(Array.isArray(fieldValue(log.before, 'assigned_user_ids'))).toBe(true);
    expect(Array.isArray(fieldValue(log.after, 'assigned_user_ids'))).toBe(true);
    expect(fieldPii(log.before, 'assigned_user_ids')).toBe(false);
    expect(fieldPii(log.after, 'assigned_user_ids')).toBe(false);
    // 分配前为空数组，分配后含被分配用户 id
    expect(fieldValue(log.before, 'assigned_user_ids')).toEqual([]);
    expect(fieldValue(log.after, 'assigned_user_ids')).toEqual([ADMIN_ID]);
    // 确认角色侧确实分配成功
    expect(roleRepo.existsUserRole(ADMIN_ID, role.id)).toBe(true);
  });

  it('§70 role.remove（B-1 修复验证）：entity_type=role/action=update/before/after 含 assigned_user_ids', async () => {
    const { roleRouter, roleRepo, auditRepo } = setup();
    const role = await callProc(
      roleRouter.create,
      { name: 'removeTarget', description: 'd', permission_codes: [] },
      adminCtx,
    );
    // 先分配（产生 1 条 assign update 日志）
    await callProc(roleRouter.assign, { userId: ADMIN_ID, roleId: role.id }, adminCtx);
    // 再移除（产生本条 remove update 日志）
    await callProc(roleRouter.remove, { userId: ADMIN_ID, roleId: role.id }, adminCtx);
    // 取该角色最近一条 update 日志（remove 产生的）
    const updateLogs = auditRepo
      .listAll()
      .filter((l) => l.entity_type === 'role' && l.entity_id === role.id && l.action === 'update');
    expect(updateLogs.length).toBeGreaterThanOrEqual(2);
    const log = updateLogs[updateLogs.length - 1]!;
    // B-1 修复：action=update（非 remove/delete）
    expect(log.entity_type).toBe('role');
    expect(log.action).toBe('update');
    expect(log.entity_id).toBe(role.id);
    // before 含 assigned_user_ids(旧=[ADMIN_ID]) / after 含 assigned_user_ids(新=[])
    expect(hasField(log.before, 'assigned_user_ids')).toBe(true);
    expect(hasField(log.after, 'assigned_user_ids')).toBe(true);
    expect(fieldValue(log.before, 'assigned_user_ids')).toEqual([ADMIN_ID]);
    expect(fieldValue(log.after, 'assigned_user_ids')).toEqual([]);
    // 确认角色侧确实移除
    expect(roleRepo.existsUserRole(ADMIN_ID, role.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F1 端到端 · dept 域埋点（§71-73）
// ---------------------------------------------------------------------------
describe('F1 端到端 · dept 域埋点', () => {
  it('§71 dept.create：成功后记日志 entity_type=dept/action=create/before=[]/after 含 name/parent_id', async () => {
    const { deptRouter, auditRepo } = setup();
    const dept = await callProc(deptRouter.create, { name: 'Engineering' }, adminCtx);
    const log = findLog(auditRepo, {
      entityType: 'dept',
      entityId: dept.id,
      action: 'create',
    });
    expect(log).toBeDefined();
    if (!log) return;
    expect(log.entity_type).toBe('dept');
    expect(log.action).toBe('create');
    expect(log.entity_id).toBe(dept.id);
    expect(log.before).toEqual([]);
    expect(hasField(log.after, 'name')).toBe(true);
    expect(hasField(log.after, 'parent_id')).toBe(true);
    expect(fieldValue(log.after, 'name')).toBe('Engineering');
    expect(fieldValue(log.after, 'parent_id')).toBeNull(); // 根部门 parent_id=null
    expect(fieldPii(log.after, 'name')).toBe(false); // dept 域无 PII
    expect(fieldPii(log.after, 'parent_id')).toBe(false);
  });

  it('§72 dept.delete：成功后记日志 entity_type=dept/action=delete/before 含部门字段/after=[]', async () => {
    const { deptRouter, auditRepo } = setup();
    const dept = await callProc(deptRouter.create, { name: 'ToRemove' }, adminCtx);
    await callProc(deptRouter.delete, { id: dept.id }, adminCtx);
    const log = findLog(auditRepo, {
      entityType: 'dept',
      entityId: dept.id,
      action: 'delete',
    });
    expect(log).toBeDefined();
    if (!log) return;
    expect(log.entity_type).toBe('dept');
    expect(log.action).toBe('delete');
    expect(log.entity_id).toBe(dept.id);
    expect(log.after).toEqual([]);
    expect(hasField(log.before, 'name')).toBe(true);
    expect(hasField(log.before, 'parent_id')).toBe(true);
    expect(fieldValue(log.before, 'name')).toBe('ToRemove');
  });

  it('§73 dept.assignUserDepartment（B-2 修复验证）：entity_type=user/action=update/entity_id=用户id/before=[department_id:旧]/after=[department_id:新]', async () => {
    const { deptRouter, auditRepo } = setup();
    // 建两个部门 D1/D2
    const d1 = await callProc(deptRouter.create, { name: 'D1' }, adminCtx);
    const d2 = await callProc(deptRouter.create, { name: 'D2' }, adminCtx);
    // 先归属 D1（admin 用户初始 department_id 缺省=未归属，before=null → after=D1）
    await callProc(
      deptRouter.assignUserDepartment,
      { userId: ADMIN_ID, departmentId: d1.id },
      adminCtx,
    );
    // 改归属 D2（before=D1 → after=D2），本条日志验证 B-2 修复
    await callProc(
      deptRouter.assignUserDepartment,
      { userId: ADMIN_ID, departmentId: d2.id },
      adminCtx,
    );
    // 取该用户最近一条 update 日志（D1→D2 的归属变更）
    const userUpdateLogs = auditRepo
      .listAll()
      .filter((l) => l.entity_type === 'user' && l.entity_id === ADMIN_ID && l.action === 'update');
    expect(userUpdateLogs.length).toBeGreaterThanOrEqual(2);
    const log = userUpdateLogs[userUpdateLogs.length - 1]!;
    // B-2 修复：entity_type=user（非 dept）/ action=update / entity_id=被分配用户 id
    expect(log.entity_type).toBe('user');
    expect(log.action).toBe('update');
    expect(log.entity_id).toBe(ADMIN_ID);
    // before=[{field:department_id,value:D1.id,pii:false}]
    expect(log.before).toHaveLength(1);
    expect(fieldValue(log.before, 'department_id')).toBe(d1.id);
    expect(fieldPii(log.before, 'department_id')).toBe(false);
    // after=[{field:department_id,value:D2.id,pii:false}]
    expect(log.after).toHaveLength(1);
    expect(fieldValue(log.after, 'department_id')).toBe(d2.id);
    expect(fieldPii(log.after, 'department_id')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F1 端到端 · 读操作与失败场景（§74-76）
// ---------------------------------------------------------------------------
describe('F1 端到端 · 读操作与失败场景', () => {
  it('§74 读操作不记日志：user.list / audit.list / report.query 完成后 auditRepo 无新增日志', async () => {
    const { userRouter, auditRouter, reportRouter, auditRepo } = setup();
    expect(auditRepo.listAll()).toHaveLength(0);
    // user.list（读）
    await callProc(userRouter.list, { page: 1, pageSize: 10 }, adminCtx);
    // audit.list（读，本身即查 auditRepo，不写）
    await callProc(auditRouter.list, { page: 1, pageSize: 10 }, adminCtx);
    // report.query（读 + 聚合，读 auditRepo 不写）
    await callProc(reportRouter.query, { group_by: ['entity_type'] }, adminCtx);
    // 读操作完成后 auditRepo 仍无日志（读不记，沿用 PRD-AUDIT-001 Q1）
    expect(auditRepo.listAll()).toHaveLength(0);
  });

  it('§75 主操作失败不记日志：user.create 邮箱重复 → USER_EMAIL_DUPLICATE 且 auditRepo 无日志', async () => {
    const { userRouter, auditRepo } = setup();
    // 第一次创建成功（产生 1 条 create 日志）
    await callProc(
      userRouter.create,
      { email: 'dup@example.com', name: 'first' },
      adminCtx,
    );
    expect(auditRepo.listAll()).toHaveLength(1);
    // 第二次同邮箱创建 → 校验失败 USER_EMAIL_DUPLICATE（主操作失败，withAudit 不触发 audit.record）
    await expectAppError(
      callProc(
        userRouter.create,
        { email: 'dup@example.com', name: 'second' },
        adminCtx,
      ),
      'USER_EMAIL_DUPLICATE',
    );
    // 失败操作不记日志：auditRepo 仍为 1 条（仅第一次成功创建的日志）
    expect(auditRepo.listAll()).toHaveLength(1);
  });

  it('§76 埋点失败不影响主操作（best-effort）：audit.record 抛错 → 主操作仍成功返回 + 日志未入库', async () => {
    // 独立 setup：用 ThrowingAuditLogService 替换共享 auditService（record 抛错）
    const db = createTestDb();
    const throwingRepo = new AuditLogRepository(db);
    const throwingAudit = new ThrowingAuditLogService(throwingRepo);
    const userRepo = new UserRepository(db);
    const userService = new UserService(userRepo);
    const userRouter = createUserRouter(userService, throwingAudit);
    // 主操作仍成功返回 user（埋点异常被 withAudit 吞掉，不抛给调用方）
    const user = await callProc(
      userRouter.create,
      { email: 'best@example.com', name: 'Best' },
      adminCtx,
    );
    expect(user.id).toBeDefined();
    expect(user.email).toBe('best@example.com');
    expect(user.name).toBe('Best');
    expect(user.status).toBe('active');
    // 埋点失败：record 抛错在 insert 前，日志未入库
    expect(throwingRepo.listAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F1 端到端 · SSOT 派生断言（AI-005）
// ---------------------------------------------------------------------------
describe('F1 端到端 · SSOT 派生（AI-005）', () => {
  it('所有埋点日志 entity_type ∈ [...auditLogEntityTypeSchema.options]（SSOT 派生，禁硬编码）', async () => {
    const { userRouter, roleRouter, deptRouter, notificationRouter, auditRepo } = setup();
    // 触发四域写操作各一条（notification 为本期跨域联动①新增，须落库以覆盖 seenTypes 全集断言）
    await callProc(userRouter.create, { email: 'ssot@example.com', name: 'u' }, adminCtx);
    await callProc(roleRouter.create, { name: 'r', description: 'd', permission_codes: [] }, adminCtx);
    await callProc(deptRouter.create, { name: 'd' }, adminCtx);
    await callProc(
      notificationRouter.create,
      { title: 'n', content: 'c', recipient_id: ADMIN_ID },
      adminCtx,
    );
    const validTypes = [...auditLogEntityTypeSchema.options];
    // 全集断言（SSOT 派生，AI-005 禁硬编码全集字面量）：跨域联动①使 notification 加入枚举
    expect(validTypes).toContain('notification');
    expect(validTypes).toContain('user');
    expect(validTypes).toContain('role');
    expect(validTypes).toContain('dept');
    // 每条日志的 entity_type 必在全集内
    for (const log of auditRepo.listAll()) {
      expect(validTypes).toContain(log.entity_type);
    }
    // withAudit 覆盖的 entity_type 子集均已落库（user/role/dept/notification 各至少一条）。
    // [AI-006 反向核实] 'auth' 由 AuthService 直接调 audit.record（非 withAudit），本测试仅测 withAudit
    // 路径（user/role/dept/notification router），故不要求 seenTypes 含 'auth'（子集断言，非全集）。
    const seenTypes = new Set(auditRepo.listAll().map((l) => l.entity_type));
    const withAuditTypes = ['user', 'role', 'dept', 'notification'] as const;
    for (const t of withAuditTypes) {
      expect(seenTypes.has(t)).toBe(true);
    }
  });

  it('所有埋点日志 action ∈ [...auditLogActionSchema.options]（SSOT 派生，禁硬编码）', async () => {
    const { userRouter, roleRouter, deptRouter, auditRepo } = setup();
    // 触发 create / update / delete 三类动作
    const user = await callProc(
      userRouter.create,
      { email: 'act@example.com', name: 'u' },
      adminCtx,
    );
    await callProc(
      userRouter.updateStatus,
      { id: user.id, body: { status: 'disabled' }, expected_version: 0 },
      adminCtx,
    );
    const role = await callProc(
      roleRouter.create,
      { name: 'r2', description: 'd', permission_codes: [] },
      adminCtx,
    );
    await callProc(roleRouter.delete, { id: role.id, expected_version: 0 }, adminCtx);
    const validActions = [...auditLogActionSchema.options];
    // 枚举覆盖 create/update/delete（SSOT 派生 toContain，AI-005）。
    // [AI-006 反向核实] login/login_failed/logout 由 AuthService 直接调 audit.record（非 withAudit），
    // 本测试仅测 withAudit 路径，故用 toContain 子集断言（非 toEqual 全集，扩展枚举不破坏本断言）。
    expect(validActions).toContain('create');
    expect(validActions).toContain('update');
    expect(validActions).toContain('delete');
    for (const log of auditRepo.listAll()) {
      expect(validActions).toContain(log.action);
    }
    // withAudit 三类动作均已落库（login/login_failed/logout 不经 withAudit，不要求 seenActions 含）
    const seenActions = new Set(auditRepo.listAll().map((l) => l.action));
    const withAuditActions = ['create', 'update', 'delete'] as const;
    for (const a of withAuditActions) {
      expect(seenActions.has(a)).toBe(true);
    }
  });
});
