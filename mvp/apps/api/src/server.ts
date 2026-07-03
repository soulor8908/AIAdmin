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
// - 鉴权（TECH-AUTH-001 D3/D8）：buildCtx 从 Authorization: Bearer <token> 验签构造 Ctx
//   （G1 缺失→UNAUTHORIZED；G2 非 Bearer→TOKEN_INVALID；G3 验签失败→TOKEN_INVALID；
//    G4 exp≤now→TOKEN_EXPIRED；G5 黑名单→TOKEN_REVOKED）。public 路由（login）跳过验签。
//   Ctx 接口不变（{ user: { id, role } }），service 层零改动（ARCH-001 闭合核心）。
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
import { TokenBlacklistRepository } from './repository/token-blacklist.js';
import { UserService } from './service/user.js';
import { RoleService } from './service/role.js';
import { DepartmentService } from './service/dept.js';
import { AuditLogService } from './service/audit.js';
import { ReportService } from './service/report.js';
import { NotificationService } from './service/notification.js';
import { TransferService } from './service/transfer.js';
import { AuthService } from './service/auth.js';
import { verifyToken, hashPassword } from './domain/auth.js';
import { createUserRouter, updateUserStatusProcedureInputSchema } from './router/user.js';
import { createAuthRouter } from './router/auth.js';
import { createRoleRouter, roleDetailProcedureInputSchema, roleDeleteProcedureInputSchema, listUserRolesProcedureInputSchema, setParentProcedureInputSchema, unsetParentProcedureInputSchema, inheritanceChainProcedureInputSchema, effectivePermissionsProcedureInputSchema } from './router/role.js';
import { createDeptRouter, deptDeleteProcedureInputSchema } from './router/dept.js';
import { createAuditRouter } from './router/audit.js';
import { createReportRouter } from './router/report.js';
import {
  createNotificationRouter,
  notificationIdProcedureInputSchema,
  notificationWriteIdProcedureInputSchema,
  updateNotificationProcedureInputSchema,
} from './router/notification.js';
import { createTransferRouter, transferProcedureInputSchema } from './router/transfer.js';
import { AppError, errorCodeToHttpStatus } from './errors.js';
import { detailEtag, listEtag, parseIfNoneMatch } from './etag.js';
import { createDb, applySchema, seedAdmin } from './db/connection.js';
import type { DatabaseSync } from 'node:sqlite';
import type { Ctx } from './context.js';
import type { Procedure } from './router/user.js';

// ============ 依赖组装（生产应替换为 DI 容器 / 真实 DB 连接） ============
// TECH-AUTH-001 D10：AUTH_SECRET 缺省值 + console.warn（生产须通过环境变量注入强随机密钥）
const AUTH_SECRET = process.env.AUTH_SECRET ?? 'dev-auth-secret-do-not-use-in-prod';
if (!process.env.AUTH_SECRET) {
  console.warn('[server] AUTH_SECRET 未设置，使用开发缺省值。生产环境须通过 AUTH_SECRET 环境变量注入强随机密钥。');
}

// TECH-PERSIST-001 D1/D3/D12/D15：建 DB 连接 + DDL 建表 + admin seed
// createDb 内部：DB_PATH env / 缺省 ./data/admin.db / mkdirSync 父目录 / PRAGMA foreign_keys=ON
const db: DatabaseSync = createDb();
applySchema(db);
seedAdmin(db);

const userRepo = new UserRepository(db);
const roleRepo = new RoleRepository(db);
const deptRepo = new DepartmentRepository(db);
const auditRepo = new AuditLogRepository(db);
const notificationRepo = new NotificationRepository(db);
// TECH-AUTH-001 D4：token 黑名单（DB 持久化，logout 吊销；重启不丢，TECH-PERSIST-001）
const tokenBlacklistRepo = new TokenBlacklistRepository(db);

const userService = new UserService(userRepo);
const roleService = new RoleService(roleRepo, userRepo);
const deptService = new DepartmentService(deptRepo, userRepo);
const auditService = new AuditLogService(auditRepo);
const reportService = new ReportService(auditRepo);
const notificationService = new NotificationService(userService, notificationRepo);
// TECH-AUTH-001：AuthService 注入共享 auditService（login/logout 直接记审计，不经 withAudit）
const authService = new AuthService(userService, userRepo, tokenBlacklistRepo, auditService, AUTH_SECRET);

// 共享 auditService 聚合所有写操作旁路日志（advisory：router 缺省会自建独立实例，
// 此处显式注入共享实例以聚合日志到同一 auditRepo，便于 report 聚合演示）
const userRouter = createUserRouter(userService, auditService);
const roleRouter = createRoleRouter(roleService, auditService);
const deptRouter = createDeptRouter(deptService, auditService);
const auditRouter = createAuditRouter(auditService);
const reportRouter = createReportRouter(reportService);
const notificationRouter = createNotificationRouter(notificationService, auditService);
// TECH-PERSIST-001 D8：TransferService 注入 db 用于 withTransaction 包裹 A/B/C 三步（§3.1）
const transferService = new TransferService(userService, deptService, roleService, userRepo, roleRepo, deptRepo, db);
const transferRouter = createTransferRouter(transferService, auditService);
const authRouter = createAuthRouter(authService);

// ============ Seed（演示数据，让 list 不为空） ============
const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000001';
const DEMO_USER_ID = '00000000-0000-4000-8000-000000000002';
seedDemoData();

function seedDemoData(): void {
  // TECH-AUTH-001 D11 / AC-F5-2：幂等 —— admin 已存在则跳过全部 seed（重复启动不重复 insert）
  if (userRepo.findByEmail('admin@example.com')) return;
  const now = new Date().toISOString();
  userRepo.insert({
    id: ADMIN_USER_ID,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    department_id: null,
    created_at: now,
    updated_at: now,
    // [约束] TECH-OPTIMISTIC-LOCKING-001 D8：seed 数据 version=0。
    version: 0,
    // TECH-AUTH-001 D11：seed admin 凭据 admin@example.com/admin123（scrypt 哈希存储）
    password_hash: hashPassword('admin123'),
  });
  userRepo.insert({
    id: DEMO_USER_ID,
    name: 'alice',
    email: 'alice@example.com',
    status: 'active',
    department_id: null,
    created_at: now,
    updated_at: now,
    // [约束] TECH-OPTIMISTIC-LOCKING-001 D8：seed 数据 version=0。
    version: 0,
  });
}

// ============ 路由注册表 ============
type MatchCtx = {
  path: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  // TECH-AUTH-001：logout buildInput 从 Authorization header 提取 token 注入 input
  headers: IncomingMessage['headers'];
};

type Route = {
  method: string;
  pattern: string;
  buildInput: (m: MatchCtx) => unknown;
  inputSchema: z.ZodType<unknown, z.ZodTypeDef, unknown>;
  handler: (input: unknown, ctx: Ctx) => Promise<unknown>;
  auth: 'admin' | 'public';
  /**
   * 是否为版本化写路由（乐观锁，TECH-OPTIMISTIC-LOCKING-001 D17/D18）。
   * versioned=true 时，handle() 在 safeParse 之前解析 If-Match header：
   * 缺失 → VERSION_REQUIRED(400)；格式非法 → VALIDATION_ERROR(400)；合法 → 注入 expected_version。
   */
  versioned: boolean;
  /**
   * 是否支持 ETag 协商缓存（TECH-ETAG-CACHING-001 D6）。
   * cacheable=true 时，handle() 在 handler 成功后生成 ETag + 比对 If-None-Match：
   * 匹配 → 304 Not Modified（空体 + ETag header）；不匹配/缺失 → 200 + body + ETag header。
   */
  cacheable: boolean;
  /**
   * ETag 生成函数（cacheable=true 时必填）。输入为 handler 返回值，输出为 ETag 字符串（含引号，如 "0" / "3-5"）。
   */
  buildEtag?: (result: unknown) => string;
};

/** 从 procedure + 路由元数据构造 Route（复用 procedure 的 inputSchema/handler/auth，无重复声明）。
 * [约束] TECH-OPTIMISTIC-LOCKING-001 D17：versioned 标记由 server.ts 声明式注入（路由层 procedure 不感知 HTTP header）。
 * [约束] TECH-ETAG-CACHING-001 D6：cacheable 标记 + buildEtag 由 server.ts 声明式注入。
 * @param versioned 写路由传 true（解析 If-Match），读路由缺省 false。
 * @param cacheable 读路由传 true（生成 ETag + 比对 If-None-Match），写路由缺省 false。
 * @param buildEtag cacheable=true 时传入 ETag 生成函数（detailEtag / listEtag）。 */
function defineRoute<I>(
  method: string,
  pattern: string,
  buildInput: (m: MatchCtx) => unknown,
  procedure: Procedure<I, unknown>,
  versioned = false,
  cacheable = false,
  buildEtag?: (result: unknown) => string,
): Route {
  return {
    method,
    pattern,
    buildInput,
    inputSchema: procedure.input as z.ZodType<unknown, z.ZodTypeDef, unknown>,
    handler: procedure.handler as (input: unknown, ctx: Ctx) => Promise<unknown>,
    auth: procedure.auth,
    versioned,
    cacheable,
    buildEtag,
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
  // ---- auth（TECH-AUTH-001）----
  // login：public 路由，不携带 token 即可访问（AC-F1-5）；buildCtx 跳过验签返回 anonCtx
  defineRoute('POST', '/v1/auth/login', (m) => m.body, authRouter.login),
  // logout：admin 路由，须携带有效 Bearer token（AC-F4-4）。
  // buildInput 从 Authorization header 提取 token 注入 input（buildCtx 已验签同一 token 构造 Ctx）
  defineRoute('POST', '/v1/auth/logout', (m) => {
    const authHeader = m.headers['authorization'] as string | undefined;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';
    return { token };
  }, {
    input: authRouter.logout.input,
    handler: authRouter.logout.handler,
    auth: authRouter.logout.auth,
  }),

  // ---- user ----
  defineRoute('GET', '/v1/users', (m) => queryToObject(m.query), userRouter.list, false, true, listEtag),
  defineRoute('POST', '/v1/users', (m) => m.body, userRouter.create),
  defineRoute('PATCH', '/v1/users/:id/status', (m) => ({ id: m.path.id, body: m.body }), {
    input: updateUserStatusProcedureInputSchema,
    handler: userRouter.updateStatus.handler,
    auth: userRouter.updateStatus.auth,
  }, true),

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
  defineRoute('GET', '/v1/roles', (m) => queryToObject(m.query), roleRouter.list, false, true, listEtag),
  defineRoute('POST', '/v1/roles', (m) => m.body, roleRouter.create),
  defineRoute('GET', '/v1/roles/:id', (m) => ({ id: m.path.id }), {
    input: roleDetailProcedureInputSchema,
    handler: roleRouter.detail.handler,
    auth: roleRouter.detail.auth,
  }, false, true, detailEtag),
  defineRoute('DELETE', '/v1/roles/:id', (m) => ({ id: m.path.id }), {
    input: roleDeleteProcedureInputSchema,
    handler: roleRouter.delete.handler,
    auth: roleRouter.delete.auth,
  }, true),
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
  }, true),
  defineRoute('DELETE', '/v1/roles/:roleId/parent', (m) => ({ roleId: m.path.roleId }), {
    input: unsetParentProcedureInputSchema,
    handler: roleRouter.unsetParent.handler,
    auth: roleRouter.unsetParent.auth,
  }, true),
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
  defineRoute('GET', '/v1/notifications', (m) => queryToObject(m.query), notificationRouter.list, false, true, listEtag),
  defineRoute('POST', '/v1/notifications', (m) => m.body, notificationRouter.create),
  defineRoute('GET', '/v1/notifications/:id', (m) => ({ id: m.path.id }), {
    input: notificationIdProcedureInputSchema,
    handler: notificationRouter.detail.handler,
    auth: notificationRouter.detail.auth,
  }, false, true, detailEtag),
  defineRoute('PATCH', '/v1/notifications/:id', (m) => ({ id: m.path.id, body: m.body }), {
    input: updateNotificationProcedureInputSchema,
    handler: notificationRouter.update.handler,
    auth: notificationRouter.update.auth,
  }, true),
  defineRoute('POST', '/v1/notifications/:id/send', (m) => ({ id: m.path.id }), {
    input: notificationWriteIdProcedureInputSchema,
    handler: notificationRouter.send.handler,
    auth: notificationRouter.send.auth,
  }, true),
  defineRoute('POST', '/v1/notifications/:id/read', (m) => ({ id: m.path.id }), {
    input: notificationWriteIdProcedureInputSchema,
    handler: notificationRouter.markRead.handler,
    auth: notificationRouter.markRead.auth,
  }, true),
  defineRoute('DELETE', '/v1/notifications/:id', (m) => ({ id: m.path.id }), {
    input: notificationWriteIdProcedureInputSchema,
    handler: notificationRouter.delete.handler,
    auth: notificationRouter.delete.auth,
  }, true),
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

// ============ Ctx 构造（TECH-AUTH-001 D3/D8 Bearer 验签） ============
/**
 * 从 Authorization: Bearer <token> 验签构造 Ctx（D3 来源切换，Ctx 接口不变）。
 * 守卫顺序（D8 / D9）：
 *   public 路由 → 跳过验签，返回 anonCtx（login 路由不携带 token 即可访问，AC-F1-5）
 *   G1 缺失 Authorization header → UNAUTHORIZED
 *   G2 非 Bearer scheme → TOKEN_INVALID
 *   G3 验签失败（签名错/格式错/payload 非法）→ TOKEN_INVALID
 *   G4 exp ≤ now → TOKEN_EXPIRED
 *   G5 黑名单命中 → TOKEN_REVOKED
 * [约束] verifyToken 仅验签 + 解析 payload，不检查过期（G4 在本函数完成，对齐 domain/auth.ts 注释）。
 * @throws AppError（UNAUTHORIZED / TOKEN_INVALID / TOKEN_EXPIRED / TOKEN_REVOKED）
 */
function buildCtx(req: IncomingMessage, routeAuth: 'admin' | 'public'): Ctx {
  // public 路由（login）：不携带 token 即可访问，返回 anonCtx（service 层 login 忽略 ctx.user）
  if (routeAuth === 'public') {
    return { user: { id: '', role: 'user' } };
  }
  // G1: 缺失 Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader === undefined || (typeof authHeader === 'string' && authHeader.trim() === '')) {
    throw new AppError('UNAUTHORIZED', '缺失 Authorization header');
  }
  const headerStr = Array.isArray(authHeader) ? authHeader[0] ?? '' : authHeader;
  // G2: 非 Bearer scheme
  if (!headerStr.startsWith('Bearer ')) {
    throw new AppError('TOKEN_INVALID', 'Authorization 须为 Bearer scheme');
  }
  const token = headerStr.slice('Bearer '.length).trim();
  if (!token) {
    throw new AppError('TOKEN_INVALID', 'token 为空');
  }
  // G3: 验签（verifyToken 不检查过期，仅签名 + payload 结构）
  const verified = verifyToken(token, AUTH_SECRET);
  if (!verified.ok) {
    throw new AppError('TOKEN_INVALID', 'token 验签失败');
  }
  // G4: 过期判定（exp ≤ now）
  const nowSec = Math.floor(Date.now() / 1000);
  if (verified.payload.exp <= nowSec) {
    throw new AppError('TOKEN_EXPIRED', 'token 已过期');
  }
  // G5: 黑名单（logout 吊销）
  if (tokenBlacklistRepo.has(token)) {
    throw new AppError('TOKEN_REVOKED', 'token 已被吊销');
  }
  return { user: { id: verified.payload.sub, role: verified.payload.role } };
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

/**
 * 发送 JSON 响应 + ETag header（TECH-ETAG-CACHING-001 D10）。
 * 用于 cacheable 路由的 200 响应（body + ETag header）。
 */
function sendJsonWithEtag(res: ServerResponse, status: number, body: unknown, etag: string): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'ETag': etag,
  });
  res.end(payload);
}

/**
 * 解析 If-Match header 为乐观锁 version（TECH-OPTIMISTIC-LOCKING-001 D18）。
 * 接受纯非负整数字符串（如 "3"）；不采用 ETag 引号格式（MVP 简化）。
 * @returns ok=true 携带 version；ok=false 携带 errorCode（VERSION_REQUIRED / VALIDATION_ERROR）。
 */
function parseIfMatch(headerValue: string | undefined):
  | { ok: true; version: number }
  | { ok: false; errorCode: 'VERSION_REQUIRED' | 'VALIDATION_ERROR' } {
  if (headerValue === undefined || headerValue.trim() === '') {
    return { ok: false, errorCode: 'VERSION_REQUIRED' };
  }
  const trimmed = headerValue.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, errorCode: 'VALIDATION_ERROR' };
  }
  return { ok: true, version: Number(trimmed) };
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
        auth_hint: 'Bearer token 鉴权：POST /v1/auth/login 获取 token，请求携带 Authorization: Bearer <token>',
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
    // TECH-AUTH-001 D3/D8：buildCtx 在 buildInput/safeParse 之前执行 Bearer 验签（G1-G5）。
    // public 路由（login）跳过验签返回 anonCtx；admin 路由验签失败抛 AppError（401 系列），
    // 由 catch 块转 HTTP 响应。先于 safeParse 确保 AC-F4-4（无 token logout → 401 UNAUTHORIZED，非 400）。
    const ctx = buildCtx(req, route.auth);
    const body = await readBody(req);
    const rawInput = route.buildInput({ path: pathParams, query: url.searchParams, body, headers: req.headers });
    // [约束] TECH-OPTIMISTIC-LOCKING-001 D18：versioned 路由在 safeParse 之前解析 If-Match header。
    // 缺失 → VERSION_REQUIRED(400)；格式非法 → VALIDATION_ERROR(400)；合法 → 注入 expected_version 到入参。
    let finalInput = rawInput;
    if (route.versioned) {
      const ifMatch = req.headers['if-match'] as string | undefined;
      const versionResult = parseIfMatch(ifMatch);
      if (!versionResult.ok) {
        if (versionResult.errorCode === 'VERSION_REQUIRED') {
          sendJson(res, 400, { error: 'VERSION_REQUIRED', message: '写操作须携带 If-Match header（非负整数）' });
        } else {
          sendJson(res, 400, { error: 'VALIDATION_ERROR', message: 'If-Match header 须为非负整数字符串' });
        }
        return;
      }
      finalInput = { ...(rawInput as Record<string, unknown>), expected_version: versionResult.version };
    }
    const parsed = route.inputSchema.safeParse(finalInput);
    if (!parsed.success) {
      sendJson(res, 400, {
        error: 'VALIDATION_ERROR',
        message: '输入校验失败',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    const result = await route.handler(parsed.data, ctx);
    // void 返回（delete/remove）→ 204；否则 200
    if (result === undefined) {
      res.writeHead(204, { 'Content-Length': 0 });
      res.end();
      return;
    }
    // [约束] TECH-ETAG-CACHING-001 D9：cacheable 路由在 handler 成功后生成 ETag + 比对 If-None-Match。
    // 匹配 → 304 Not Modified（空体 + ETag header，Q3/Q6 决策①）；不匹配/缺失/非法 → 200 + body + ETag header。
    if (route.cacheable && route.buildEtag) {
      const etag = route.buildEtag(result);
      const ifNoneMatch = parseIfNoneMatch(req.headers['if-none-match'] as string | undefined);
      if (ifNoneMatch !== null && ifNoneMatch === etag) {
        res.writeHead(304, { 'ETag': etag, 'Content-Length': 0 });
        res.end();
        return;
      }
      sendJsonWithEtag(res, 200, result, etag);
      return;
    }
    sendJson(res, 200, result);
  } catch (e) {
    if (e instanceof AppError) {
      const status = errorCodeToHttpStatus[e.code] ?? 500;
      // [约束] TECH-OPTIMISTIC-LOCKING-001 D13：合并 e.meta 到响应体（如 VERSION_CONFLICT 的 current_version）。
      const respBody: Record<string, unknown> = { error: e.code, message: e.message };
      if (e.meta) Object.assign(respBody, e.meta);
      sendJson(res, status, respBody);
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
  console.log(`  │  auth: Bearer token (POST /v1/auth/login)   │`);
  console.log(`  └─────────────────────────────────────────────┘\n`);
});

process.on('SIGINT', () => {
  console.log('\n[server] shutting down...');
  // TECH-PERSIST-001 §7：shutdown 关闭 db 连接（advisory，确保文件 DB 刷盘）
  try {
    db.close();
  } catch {
    // db 已关闭或未建则忽略（best-effort 刷盘）
  }
  server.close(() => process.exit(0));
});
