// apps/api/src/server.ts —— HTTP 运行时入口（工程脚手架，非业务功能）
//
// [advisory] 本文件为运行时入口（工程基础设施），不在任何 PRD/Spec 范围内。
//   按 AI-003 advisory 偏离机制：此处显式声明偏离 spec-first（AI-001），理由为
//   "补齐 HTTP 运行时入口"是工程脚手架而非业务功能，不产生新的业务契约/领域逻辑。
//   文件位于 src/ 根目录，layerOf 返回 null，不受 ARCH-001 四层反向依赖约束；
//   SEC-002 仅扫 service/，本文件不扫；CODE-001~004 全适用。
//
// 设计：
// - 零新 HTTP 框架依赖（Node 内置 http），仅加 tsx 执行 TS。
// - 声明式路由注册表：每条 route = { method, pattern, buildInput, ...procedure }，
//   procedure 的 inputSchema/handler/auth 直接展开复用，无重复声明。
// - 鉴权桩：从 X-User-Id / X-User-Role header 构造 Ctx（MVP 无真实 JWT），
//   缺省为 admin（方便演示）。生产应替换为真实认证中间件。
// - 错误：AppError → errorCodeToHttpStatus；Zod 失败 → 400；其余 → 500。
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  listUserQuerySchema,
  createUserInputSchema,
  updateUserStatusInputSchema,
  listRoleQuerySchema,
  createRoleInputSchema,
  assignRoleInputSchema,
  departmentTreeQuerySchema,
  createDepartmentInputSchema,
  assignUserDepartmentInputSchema,
  listAuditLogQuerySchema,
  reportQuerySchema,
  listNotificationQuerySchema,
  createNotificationInputSchema,
  updateNotificationInputSchema,
} from '@admin/contracts';
import { UserRepository } from './repository/user.js';
import { RoleRepository } from './repository/role.js';
import { DepartmentRepository } from './repository/dept.js';
import { AuditLogRepository } from './repository/audit.js';
import { NotificationRepository } from './repository/notification.js';
import { UserService } from './service/user.js';
import { RoleService } from './service/role.js';
import { DepartmentService } from './service/dept.js';
import { AuditLogService } from './service/audit.js';
import { ReportService } from './service/report.js';
import { NotificationService } from './service/notification.js';
import { TransferService } from './service/transfer.js';
import { createUserRouter, updateUserStatusProcedureInputSchema } from './router/user.js';
import { createRoleRouter, roleDetailProcedureInputSchema, listUserRolesProcedureInputSchema, setParentProcedureInputSchema, unsetParentProcedureInputSchema, inheritanceChainProcedureInputSchema, effectivePermissionsProcedureInputSchema } from './router/role.js';
import { createDeptRouter, deptDeleteProcedureInputSchema } from './router/dept.js';
import { createAuditRouter } from './router/audit.js';
import { createReportRouter } from './router/report.js';
import {
  createNotificationRouter,
  notificationIdProcedureInputSchema,
  updateNotificationProcedureInputSchema,
} from './router/notification.js';
import { createTransferRouter, transferProcedureInputSchema } from './router/transfer.js';
import { AppError, errorCodeToHttpStatus } from './errors.js';
import type { Ctx } from './context.js';
import type { Procedure } from './router/user.js';

// ============ 依赖组装（生产应替换为 DI 容器 / 真实 DB 连接） ============
const userRepo = new UserRepository();
const roleRepo = new RoleRepository();
const deptRepo = new DepartmentRepository();
const auditRepo = new AuditLogRepository();
const notificationRepo = new NotificationRepository();

const userService = new UserService(userRepo);
const roleService = new RoleService(roleRepo, userRepo);
const deptService = new DepartmentService(deptRepo, userRepo);
const auditService = new AuditLogService(auditRepo);
const reportService = new ReportService(auditRepo);
const notificationService = new NotificationService(userService, notificationRepo);

// 共享 auditService 聚合所有写操作旁路日志（advisory：router 缺省会自建独立实例，
// 此处显式注入共享实例以聚合日志到同一 auditRepo，便于 report 聚合演示）
const userRouter = createUserRouter(userService, auditService);
const roleRouter = createRoleRouter(roleService, auditService);
const deptRouter = createDeptRouter(deptService, auditService);
const auditRouter = createAuditRouter(auditService);
const reportRouter = createReportRouter(reportService);
const notificationRouter = createNotificationRouter(notificationService, auditService);
const transferService = new TransferService(userService, deptService, roleService, userRepo, roleRepo, deptRepo);
const transferRouter = createTransferRouter(transferService, auditService);

// ============ Seed（演示数据，让 list 不为空） ============
const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000001';
const DEMO_USER_ID = '00000000-0000-4000-8000-000000000002';
seedDemoData();

function seedDemoData(): void {
  const now = new Date().toISOString();
  userRepo.insert({
    id: ADMIN_USER_ID,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    department_id: null,
    created_at: now,
    updated_at: now,
  });
  userRepo.insert({
    id: DEMO_USER_ID,
    name: 'alice',
    email: 'alice@example.com',
    status: 'active',
    department_id: null,
    created_at: now,
    updated_at: now,
  });
}

// ============ 路由注册表 ============
type MatchCtx = {
  path: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
};

type Route = {
  method: string;
  pattern: string;
  buildInput: (m: MatchCtx) => unknown;
  inputSchema: z.ZodType<unknown, z.ZodTypeDef, unknown>;
  handler: (input: unknown, ctx: Ctx) => Promise<unknown>;
  auth: 'admin' | 'public';
};

/** 从 procedure + 路由元数据构造 Route（复用 procedure 的 inputSchema/handler/auth，无重复声明）。 */
function defineRoute<I>(
  method: string,
  pattern: string,
  buildInput: (m: MatchCtx) => unknown,
  procedure: Procedure<I, unknown>,
): Route {
  return {
    method,
    pattern,
    buildInput,
    inputSchema: procedure.input as z.ZodType<unknown, z.ZodTypeDef, unknown>,
    handler: procedure.handler as (input: unknown, ctx: Ctx) => Promise<unknown>,
    auth: procedure.auth,
  };
}

/** query string → 对象（单值取首个；数字字段保留字符串由 Zod transform 钳制）。 */
function queryToObject(query: URLSearchParams): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const key of query.keys()) {
    const vals = query.getAll(key);
    obj[key] = vals.length > 1 ? vals : vals[0];
  }
  return obj;
}

const routes: Route[] = [
  // ---- user ----
  defineRoute('GET', '/v1/users', (m) => queryToObject(m.query), userRouter.list),
  defineRoute('POST', '/v1/users', (m) => m.body, userRouter.create),
  defineRoute('PATCH', '/v1/users/:id/status', (m) => ({ id: m.path.id, body: m.body }), {
    input: updateUserStatusProcedureInputSchema,
    handler: userRouter.updateStatus.handler,
    auth: userRouter.updateStatus.auth,
  }),

  // ---- transfer（调岗事务，POST /v1/users/:userId/transfer） ----
  defineRoute('POST', '/v1/users/:userId/transfer', (m) => {
    const body = (m.body ?? {}) as Record<string, string>;
    return {
      userId: m.path.userId,
      toDepartmentId: body.toDepartmentId,
      oldRoleId: body.oldRoleId,
      newRoleId: body.newRoleId,
    };
  }, {
    input: transferProcedureInputSchema,
    handler: transferRouter.transfer.handler,
    auth: transferRouter.transfer.auth,
  }),

  // ---- role ----
  defineRoute('GET', '/v1/roles', (m) => queryToObject(m.query), roleRouter.list),
  defineRoute('POST', '/v1/roles', (m) => m.body, roleRouter.create),
  defineRoute('GET', '/v1/roles/:id', (m) => ({ id: m.path.id }), {
    input: roleDetailProcedureInputSchema,
    handler: roleRouter.detail.handler,
    auth: roleRouter.detail.auth,
  }),
  defineRoute('DELETE', '/v1/roles/:id', (m) => ({ id: m.path.id }), {
    input: roleDetailProcedureInputSchema,
    handler: roleRouter.delete.handler,
    auth: roleRouter.delete.auth,
  }),
  defineRoute('GET', '/v1/users/:userId/roles', (m) => ({ userId: m.path.userId }), {
    input: listUserRolesProcedureInputSchema,
    handler: roleRouter.listUserRoles.handler,
    auth: roleRouter.listUserRoles.auth,
  }),
  defineRoute('POST', '/v1/users/:userId/roles/:roleId', (m) => ({ userId: m.path.userId, roleId: m.path.roleId }), {
    input: assignRoleInputSchema,
    handler: roleRouter.assign.handler,
    auth: roleRouter.assign.auth,
  }),
  defineRoute('DELETE', '/v1/users/:userId/roles/:roleId', (m) => ({ userId: m.path.userId, roleId: m.path.roleId }), {
    input: assignRoleInputSchema,
    handler: roleRouter.remove.handler,
    auth: roleRouter.remove.auth,
  }),
  // ---- role-inheritance（TECH-ROLE-INHERITANCE-001 F1/F2/F3）----
  // [advisory] 工程脚手架同步（AI-003 advisory 偏离：补齐 HTTP 路由入口，非业务功能）
  defineRoute('POST', '/v1/roles/:roleId/parent', (m) => {
    const body = (m.body ?? {}) as Record<string, string>;
    return { roleId: m.path.roleId, parentRoleId: body.parentRoleId };
  }, {
    input: setParentProcedureInputSchema,
    handler: roleRouter.setParent.handler,
    auth: roleRouter.setParent.auth,
  }),
  defineRoute('DELETE', '/v1/roles/:roleId/parent', (m) => ({ roleId: m.path.roleId }), {
    input: unsetParentProcedureInputSchema,
    handler: roleRouter.unsetParent.handler,
    auth: roleRouter.unsetParent.auth,
  }),
  defineRoute('GET', '/v1/roles/:roleId/inheritance-chain', (m) => ({ roleId: m.path.roleId }), {
    input: inheritanceChainProcedureInputSchema,
    handler: roleRouter.getInheritanceChain.handler,
    auth: roleRouter.getInheritanceChain.auth,
  }),
  defineRoute('GET', '/v1/users/:userId/effective-permissions', (m) => ({ userId: m.path.userId }), {
    input: effectivePermissionsProcedureInputSchema,
    handler: roleRouter.getEffectivePermissions.handler,
    auth: roleRouter.getEffectivePermissions.auth,
  }),

  // ---- dept ----
  defineRoute('GET', '/v1/departments/tree', (m) => queryToObject(m.query), deptRouter.tree),
  defineRoute('POST', '/v1/departments', (m) => m.body, deptRouter.create),
  defineRoute('DELETE', '/v1/departments/:id', (m) => ({ id: m.path.id }), {
    input: deptDeleteProcedureInputSchema,
    handler: deptRouter.delete.handler,
    auth: deptRouter.delete.auth,
  }),
  defineRoute('POST', '/v1/departments/:departmentId/users/:userId', (m) => ({
    userId: m.path.userId,
    departmentId: m.path.departmentId,
  }), {
    input: assignUserDepartmentInputSchema,
    handler: deptRouter.assignUserDepartment.handler,
    auth: deptRouter.assignUserDepartment.auth,
  }),

  // ---- audit ----
  defineRoute('GET', '/v1/audit-logs', (m) => queryToObject(m.query), auditRouter.list),

  // ---- report ----
  defineRoute('GET', '/v1/reports/operations', (m) => {
    // group_by 在 query string 可多值；schema 要求 array，故始终转数组
    const obj = queryToObject(m.query);
    const gbs = m.query.getAll('group_by');
    if (gbs.length > 0) obj.group_by = gbs;
    return obj;
  }, reportRouter.query),

  // ---- notification ----
  defineRoute('GET', '/v1/notifications', (m) => queryToObject(m.query), notificationRouter.list),
  defineRoute('POST', '/v1/notifications', (m) => m.body, notificationRouter.create),
  defineRoute('GET', '/v1/notifications/:id', (m) => ({ id: m.path.id }), {
    input: notificationIdProcedureInputSchema,
    handler: notificationRouter.detail.handler,
    auth: notificationRouter.detail.auth,
  }),
  defineRoute('PATCH', '/v1/notifications/:id', (m) => ({ id: m.path.id, body: m.body }), {
    input: updateNotificationProcedureInputSchema,
    handler: notificationRouter.update.handler,
    auth: notificationRouter.update.auth,
  }),
  defineRoute('POST', '/v1/notifications/:id/send', (m) => ({ id: m.path.id }), {
    input: notificationIdProcedureInputSchema,
    handler: notificationRouter.send.handler,
    auth: notificationRouter.send.auth,
  }),
  defineRoute('POST', '/v1/notifications/:id/read', (m) => ({ id: m.path.id }), {
    input: notificationIdProcedureInputSchema,
    handler: notificationRouter.markRead.handler,
    auth: notificationRouter.markRead.auth,
  }),
  defineRoute('DELETE', '/v1/notifications/:id', (m) => ({ id: m.path.id }), {
    input: notificationIdProcedureInputSchema,
    handler: notificationRouter.delete.handler,
    auth: notificationRouter.delete.auth,
  }),
];

// ============ 路径匹配 ============
function matchRoute(method: string, pathname: string): { route: Route; pathParams: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const pathParams = matchPattern(route.pattern, pathname);
    if (pathParams) return { route, pathParams };
  }
  return null;
}

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean);
  const ap = pathname.split('/').filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i]!;
    const actual = ap[i]!;
    if (seg.startsWith(':')) {
      params[seg.slice(1)] = decodeURIComponent(actual);
    } else if (seg !== actual) {
      return null;
    }
  }
  return params;
}

// ============ Ctx 构造（鉴权桩） ============
function buildCtx(req: IncomingMessage): Ctx {
  // MVP 桩：从 header 读 user；缺省为 admin（演示用）。生产应替换为 JWT/session 校验。
  const id = req.headers['x-user-id'] as string | undefined;
  const role = req.headers['x-user-role'] as string | undefined;
  return {
    user: {
      id: id && id.trim() ? id : ADMIN_USER_ID,
      role: role === 'user' ? 'user' : 'admin',
    },
  };
}

// ============ 请求处理 ============
async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'DELETE') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError('VALIDATION_ERROR', '请求体不是合法 JSON');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;
  const method = (req.method ?? 'GET').toUpperCase();

  // 健康检查 + API 目录
  if (method === 'GET' && (pathname === '/health' || pathname === '/')) {
    if (pathname === '/health') {
      sendJson(res, 200, { status: 'ok', time: new Date().toISOString() });
    } else {
      sendJson(res, 200, {
        name: 'admin-system-mvp',
        version: '0.1.0',
        endpoints: routes.map((r) => `${r.method.padEnd(6)} ${r.pattern}`),
        health: '/health',
        auth_hint: 'MVP 桩：通过 X-User-Id / X-User-Role header 模拟身份，缺省为 admin',
      });
    }
    return;
  }

  const matched = matchRoute(method, pathname);
  if (!matched) {
    sendJson(res, 404, { error: 'NOT_FOUND', message: `无路由匹配: ${method} ${pathname}` });
    return;
  }
  const { route, pathParams } = matched;

  try {
    const body = await readBody(req);
    const rawInput = route.buildInput({ path: pathParams, query: url.searchParams, body });
    const parsed = route.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      sendJson(res, 400, {
        error: 'VALIDATION_ERROR',
        message: '输入校验失败',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    const ctx = buildCtx(req);
    const result = await route.handler(parsed.data, ctx);
    // void 返回（delete/remove）→ 204；否则 200
    if (result === undefined) {
      res.writeHead(204, { 'Content-Length': 0 });
      res.end();
      return;
    }
    sendJson(res, 200, result);
  } catch (e) {
    if (e instanceof AppError) {
      const status = errorCodeToHttpStatus[e.code] ?? 500;
      sendJson(res, status, { error: e.code, message: e.message });
      return;
    }
    // 非预期错误：log + 500（CODE-002：catch 须非空且非仅 console）
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[server] unhandled error', e);
    sendJson(res, 500, { error: 'INTERNAL_ERROR', message: msg });
  }
}

// ============ 启动 ============
const PORT = Number(process.env.PORT ?? 3000);
const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('[server] fatal', e);
    if (!res.headersSent) sendJson(res, 500, { error: 'INTERNAL_ERROR', message: 'fatal' });
  });
});

server.listen(PORT, () => {
  console.log(`\n  ┌─────────────────────────────────────────────┐`);
  console.log(`  │  admin-system-mvp · HTTP server running     │`);
  console.log(`  │  http://localhost:${PORT}                        │`);
  console.log(`  │  health: GET /health                        │`);
  console.log(`  │  api dir: GET /                             │`);
  console.log(`  │  auth (桩): X-User-Id / X-User-Role header  │`);
  console.log(`  └─────────────────────────────────────────────┘\n`);
});

process.on('SIGINT', () => {
  console.log('\n[server] shutting down...');
  server.close(() => process.exit(0));
});
