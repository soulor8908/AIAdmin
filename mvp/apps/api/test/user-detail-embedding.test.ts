// apps/api/test/user-detail-embedding.test.ts —— ③类新增 GET /v1/users/:id 端到端 HTTP 验收测试
//                                          （TECH-USER-DETAIL-WIRE-001 §9 T3，AI-007 端到端验收）
//
// 覆盖 AC（PRD-USER-DETAIL-WIRE-001）：
//   - AC-G1（200 GET detail 返回 userSchema + ETag header，端到端）
//   - AC-G2（404 USER_NOT_FOUND，wire code 字段）
//   - AC-G3（400 VALIDATION_ERROR，wire code 字段，id 非 uuid）
//   - AC-G4（401 UNAUTHORIZED，无 Authorization header）
//   - AC-G5（401 TOKEN_INVALID / TOKEN_EXPIRED / TOKEN_REVOKED，鉴权守卫复用既有 buildCtx G1-G5）
//   - AC-G7（200 + ETag header，detailEtag 格式 "version"）
//   - AC-G8（304 If-None-Match 匹配 + 空 body）
//   - AC-G9（200 If-None-Match 不匹配 / 缺失 / 非法格式 → 200 + 新 ETag，parseIfNoneMatch 宽容解析）
//   - AC-G10（路由无冲突：GET /v1/users/:id 命中详情而非列表/状态/调岗）
//   - AC-G11（路由表新增：GET / 返回 endpoints 含 "GET /v1/users/:id"，路由已注册）
//   - AC-W1/W2/W5/W6（wire 字段名 code 在新端点错误响应中正确，D10 已消除）
//
// 测试方式（AI-007 端到端验收）：通过 node:child_process 启动真实 HTTP server
//   （npx tsx apps/api/src/server.ts），用 fetch 发起 HTTP 请求，断言响应状态码 + ETag header + body。
//   覆盖 server.ts 路由注册（D2/D9）、buildCtx 鉴权守卫（D4）、handle() ETag 304 协商（D5）、
//   wire 字段名对齐（D1，server.ts 7 处 error→code）等 HTTP 层行为。
//
// 端口选择：使用 4890（避开既有 3999 optimistic-locking-embed / 4000 etag-caching-embed /
//   4888 auth-embed / 4889 persist-embed，避免并行测试端口冲突）。
//
// TDD RED 阶段（AI-002）：本测试在 impl-writer 完成 server.ts 改造（GET /v1/users/:id 路由注册 +
//   wire 字段名 error→code）前全部失败：
//   - GET /v1/users/:id 路由未注册 → 404 { error: 'NOT_FOUND' }（既有 D10 wire 字段名 error）
//     而非期望的 200 / 404 { code: 'USER_NOT_FOUND' }（断言级红，非导入级红）
//   - wire 字段名仍为 error → body.error 而非 body.code（断言级红）
//   - AC-G7 ETag header 缺失 / AC-G8 304 协商未触发（断言级红）
//   - 路由表 endpoints 不含 "GET /v1/users/:id"（AC-G11 断言级红）
//
// CODE-001：无 any 类型标注或断言，用 unknown + 类型守卫 + 具体接口。
// SEC-003b：测试中不 console.log/记录 password 或 token 字符串。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { signToken } from '../src/domain/auth.js';

const TEST_PORT = 4890;
const BASE_URL = `http://localhost:${TEST_PORT}`;
// 与 server spawn 注入的 AUTH_SECRET 一致（D10），便于 AC-G5 用同 secret 签发过期 token
const AUTH_SECRET = 'test-user-detail-embedding-secret';
// 临时文件 DB（TECH-PERSIST-001：spawn 真实 server 须传 DB_PATH，避免内存版 + 隔离测试间状态）
const DB_PATH = join(tmpdir(), `user-detail-embed-${randomUUID()}.db`);
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'admin123';
const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const MISSING_ID = '00000000-0000-4000-8000-000000000099';

let serverProcess: ChildProcess | undefined;
let authToken: string | undefined;
let emailCounter = 0;

/** 返回 Bearer 鉴权 header（login 后填充；beforeAll 前为空）。 */
function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

beforeAll(async () => {
  serverProcess = spawn('npx', ['tsx', 'apps/api/src/server.ts'], {
    env: { ...process.env, PORT: String(TEST_PORT), AUTH_SECRET, DB_PATH },
    stdio: 'pipe',
    cwd: '/workspace/mvp',
  });
  let serverOutput = '';
  serverProcess.stdout?.on('data', (d) => {
    serverOutput += d.toString();
  });
  serverProcess.stderr?.on('data', (d) => {
    serverOutput += d.toString();
  });
  // 等待 server ready（轮询 /health）
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!ready) {
    throw new Error(`Server did not start. Server output:\n${serverOutput}`);
  }
  // login 获取 Bearer token（seed admin 凭据 admin@example.com/admin123）
  const loginRes = await fetch(`${BASE_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) {
    throw new Error(`admin login failed (${loginRes.status}). Server output:\n${serverOutput}`);
  }
  const loginBody = (await loginRes.json()) as { token?: string };
  authToken = loginBody.token;
  // [setup 修正，AI-002 允许] 等待 1.1s 跨秒边界：auth.ts login 的 token 为确定性函数
  //（signToken 同 sub+iat 秒级 → 相同 token 串）。AC-G5 logout 测试（line 386）会单独 login 取
  // 新 token 再 logout 入黑名单。若 beforeAll login 与 AC-G5 login 同秒，两 token 串完全相同 →
  // logout AC-G5 token 同时黑名单了全局 authToken，后续 AC-G7/G8/G9/G10 测试全 401 TOKEN_REVOKED。
  // 跨秒等待保证 iat 不同 → token 串不同 → 黑名单互不影响。仅改 setup 时序，不改任何断言。
  await new Promise((r) => setTimeout(r, 1100));
}, 30000);

afterAll(async () => {
  // [端口级 kill] npx tsx 会 fork node(server.ts) 子进程，serverProcess.kill('SIGTERM')
  // 只杀 npx 父进程，node 子进程（实际 server）继续 listen 端口 → 下次运行假连旧 server。
  // 用 lsof -ti:PORT -sTCP:LISTEN 杀所有 listen 该端口的进程，最可靠。
  if (serverProcess) {
    try {
      serverProcess.kill('SIGTERM');
    } catch { /* 进程可能已退出 */ }
  }
  try {
    execSync(`lsof -ti:${TEST_PORT} -sTCP:LISTEN | xargs -r kill -9 2>/dev/null || true`, { encoding: 'utf8' });
  } catch { /* lsof 不可用时忽略 */ }
  await new Promise((r) => setTimeout(r, 600));
  // 清理临时 DB 文件（避免 tmpdir 残留）
  if (existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
  }
});

// ===========================================================================
// 类型定义（CODE-001：无 any，用具体接口 + 类型守卫）
// ===========================================================================

interface UserBody {
  id: string;
  name: string;
  email: string;
  status: string;
  department_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

interface ResponseBody {
  // wire 字段名 code（D10 已消除，对齐 contracts errorResponseSchema.code）
  code?: string;
  message?: string;
  // [advisory] D21 issues 仍存在（Q7 不本轮消除），safeParse 失败时填充
  issues?: Array<{ path: string; message: string }>;
  // VERSION_CONFLICT 409 重试链 current_version（D9 [约束]）
  current_version?: number;
  // GET detail 成功响应体
  id?: string;
  name?: string;
  email?: string;
  status?: string;
  department_id?: string | null;
  created_at?: string;
  updated_at?: string;
  version?: number;
  // GET / 路由表
  endpoints?: string[];
  // GET /v1/users 列表响应（AC-G10 路由无冲突验证用）
  items?: Array<{ id: string; name: string; email: string; status: string; version: number }>;
  total?: number;
  // login 响应
  token?: string;
  expires_at?: string;
  // logout 响应
  success?: boolean;
}

interface HttpResponse {
  status: number;
  etag: string | null;
  body: ResponseBody | undefined;
  text: string;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

/** 发起 HTTP 请求，返回 status + ETag header + 解析后的 body + 原始 text。 */
async function request(path: string, init: RequestInit = {}): Promise<HttpResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  const body: ResponseBody | undefined = text ? (JSON.parse(text) as ResponseBody) : undefined;
  return { status: res.status, etag: res.headers.get('etag'), body, text };
}

function uniqueEmail(): string {
  emailCounter += 1;
  return `user-detail-${Date.now()}-${emailCounter}@example.com`;
}

/** 创建用户（POST /v1/users），返回含 id+version 的实体。 */
async function createUser(name = 'user-detail-embed'): Promise<UserBody> {
  const res = await request('/v1/users', {
    method: 'POST',
    body: JSON.stringify({ name, email: uniqueEmail() }),
  });
  expect(res.status).toBe(200);
  return res.body as unknown as UserBody;
}

/** 用 AUTH_SECRET 签发一个已过期的 token（AC-G5 TOKEN_EXPIRED）：iat/exp 均在 1 小时前。 */
function signExpiredToken(): string {
  const nowSec = Math.floor(Date.now() / 1000);
  return signToken(
    {
      sub: ADMIN_ID,
      role: 'admin',
      iat: nowSec - 7200,
      exp: nowSec - 3600,
    },
    AUTH_SECRET,
  );
}

// ===========================================================================
// AC-G10 / G11 · 路由表注册与无冲突（端到端 HTTP）
// ===========================================================================
describe('AC-G10 / G11 · 路由表注册与无冲突（端到端 HTTP）', () => {
  it('AC-G11: GET / 返回 endpoints 列表，含 "GET /v1/users/:id"（路由已注册）', async () => {
    const res = await request('/');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.endpoints)).toBe(true);
    // 路由表含新增的 GET /v1/users/:id（D2/D9 落地后端到端可见）
    expect(res.body?.endpoints).toContain('GET    /v1/users/:id');
  });

  it('AC-G10: 路由表无 method+pattern 重复（matchRoute 按 method+段数匹配，无冲突）', async () => {
    const res = await request('/');
    const endpoints = res.body?.endpoints ?? [];
    // 收集所有 GET /v1/users* 路由，验证无段数+method 重复
    const userGetRoutes = endpoints.filter((e) => e.startsWith('GET') && e.includes('/v1/users'));
    expect(userGetRoutes.length).toBeGreaterThanOrEqual(2); // 至少 GET /v1/users + GET /v1/users/:id
    // [setup 修正，AI-002 允许] 复合键去重：段数 + 字面段签名
    // 原 `pattern.split('/').length`（仅段数）不反映 matchRoute 真实匹配逻辑：server.ts matchPattern
    // 同时按段数 + 字面段位置匹配（L404 `else if (seg !== actual) return null`）。
    // GET /v1/users/:id/roles 与 GET /v1/users/:id/effective-permissions 段数同为 5，但末段字面不同
    // （roles vs effective-permissions），同一 pathname 不可能同时命中两者 → 实际无冲突。
    // 改用复合键（段数 | 字面段位置:值）反映 matchRoute 真实逻辑。仅改 setup 计算，不改 expect 断言。
    // endpoint 格式 `<method padEnd(6)> <pattern>`，用 split(/\s+/) 折叠空白后 [1]=pattern
    const segmentCounts = userGetRoutes.map((r) => {
      const [, pattern = ''] = r.split(/\s+/);
      const segments = pattern.split('/');
      const literalSignature = segments
        .map((s, i) => (s.startsWith(':') || s === '' ? '' : `${i}:${s}`))
        .filter(Boolean)
        .join(',');
      return `${segments.length}|${literalSignature}`;
    });
    expect(new Set(segmentCounts).size).toBe(segmentCounts.length);
  });

  it('AC-G11: GET /v1/users/:id 路由已注册 → 3 段 GET 路由命中（非 404 NOT_FOUND 通用路由）', async () => {
    // 路由未注册时 GET /v1/users/<uuid> 会命中通用 404 { code: 'NOT_FOUND' }（AC-W5）
    // 路由已注册时命中 detail procedure → 404 USER_NOT_FOUND（id 不存在）或 200（id 存在）
    const res = await request(`/v1/users/${MISSING_ID}`);
    expect(res.status).toBe(404);
    // 路由命中 detail procedure → service.getById 抛 USER_NOT_FOUND（contracts 码）
    // 而非通用 404 NOT_FOUND（非 contracts 码，client fallback）
    expect(res.body?.code).toBe('USER_NOT_FOUND');
    expect(res.body?.code).not.toBe('NOT_FOUND');
  });
});

// ===========================================================================
// AC-G1 · 查询成功（端到端 HTTP）
// ===========================================================================
describe('AC-G1 · 查询成功（端到端 HTTP）', () => {
  it('AC-G1: GET /v1/users/:id 已存在 → 200 + userSchema body + ETag header', async () => {
    const created = await createUser('g1-detail');
    const res = await request(`/v1/users/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body?.id).toBe(created.id);
    expect(res.body?.name).toBe('g1-detail');
    expect(res.body?.email).toBe(created.email);
    expect(res.body?.status).toBe('active');
    expect(res.body?.version).toBe(0);
    expect(res.body?.department_id).toBeNull();
    // ETag header 存在（AC-G7 联动，detailEtag 基于 version）
    expect(res.etag).not.toBeNull();
    expect(res.etag).toMatch(/^"\d+"$/);
    expect(res.etag).toBe('"0"'); // version=0
  });

  it('AC-G1: GET /v1/users/:id 返回 body 不含 password_hash（SEC-003a 端到端验证）', async () => {
    const created = await createUser('g1-pii');
    const res = await request(`/v1/users/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('password_hash');
    // 显式断言 body 不含 password_hash 字段（防 SEC-003a 回归）
    const body = res.body as unknown as { password_hash?: string };
    expect(body.password_hash).toBeUndefined();
  });

  it('AC-G1: GET /v1/users/:id 内置 admin 用户 → 200 + version=0 + ETag="0"', async () => {
    // 内置 admin 由 spawn 时 seed，id 固定为 ADMIN_ID（seed fixture）
    const res = await request(`/v1/users/${ADMIN_ID}`);
    expect(res.status).toBe(200);
    expect(res.body?.id).toBe(ADMIN_ID);
    expect(res.body?.email).toBe(ADMIN_EMAIL);
    expect(res.body?.version).toBe(0);
    expect(res.etag).toBe('"0"');
  });
});

// ===========================================================================
// AC-G2 · 不存在 → 404 USER_NOT_FOUND（端到端 HTTP + wire code 字段）
// ===========================================================================
describe('AC-G2 · 不存在 → 404 USER_NOT_FOUND（端到端 HTTP + wire）', () => {
  it('AC-G2: GET /v1/users/:missing → 404 + body.code="USER_NOT_FOUND"（wire D10 已消除，字段名 code 非 error）', async () => {
    const res = await request(`/v1/users/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.body?.code).toBe('USER_NOT_FOUND');
    // wire 字段名对齐（D10）：字段名 code，非 error
    expect(res.body).not.toHaveProperty('error');
    expect(typeof res.body?.message).toBe('string');
  });

  it('AC-W5: GET /v1/users/:missing → 404 body.code 字段（非通用 NOT_FOUND，detail 路由命中）', async () => {
    // detail 路由命中 → service.getById 抛 USER_NOT_FOUND（contracts 码）
    // 而非通用 404 NOT_FOUND（非 contracts 码，client fallback，D7）
    const res = await request(`/v1/users/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.body?.code).toBe('USER_NOT_FOUND');
    expect(res.body?.code).not.toBe('NOT_FOUND');
  });
});

// ===========================================================================
// AC-G3 · id 非 uuid → 400 VALIDATION_ERROR（端到端 HTTP + wire code 字段）
// ===========================================================================
describe('AC-G3 · id 非 uuid → 400 VALIDATION_ERROR（端到端 HTTP + wire）', () => {
  it('AC-G3: GET /v1/users/not-uuid → 400 + body.code="VALIDATION_ERROR"（safeParse 失败）', async () => {
    const res = await request('/v1/users/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('VALIDATION_ERROR');
    expect(res.body).not.toHaveProperty('error');
  });

  it('AC-W2: GET /v1/users/not-uuid → 400 body.code + issues 字段（D21 [advisory] 保留，Q7 不本轮消除）', async () => {
    const res = await request('/v1/users/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('VALIDATION_ERROR');
    // D21 issues 仍存在（Q7 不本轮消除），safeParse 失败时填充
    expect(Array.isArray(res.body?.issues)).toBe(true);
    expect(res.body?.issues?.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC-G4 / G5 · 鉴权守卫（端到端 HTTP，复用 buildCtx G1-G5）
// ===========================================================================
describe('AC-G4 / G5 · 鉴权守卫（端到端 HTTP，复用 buildCtx G1-G5）', () => {
  it('AC-G4: 无 Authorization header → 401 + body.code="UNAUTHORIZED"（buildCtx G1 缺失 token）', async () => {
    const res = await fetch(`${BASE_URL}/v1/users/${ADMIN_ID}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as ResponseBody;
    expect(body.code).toBe('UNAUTHORIZED');
    expect(body).not.toHaveProperty('error');
  });

  it('AC-G5: Authorization: Bearer <随机字符串> → 401 + body.code="TOKEN_INVALID"（G3 验签失败）', async () => {
    const res = await fetch(`${BASE_URL}/v1/users/${ADMIN_ID}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer totally-fake-token-string',
      },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as ResponseBody;
    expect(body.code).toBe('TOKEN_INVALID');
  });

  it('AC-G5: 过期 token（1 小时前签发，签名有效）→ 401 + body.code="TOKEN_EXPIRED"（G4 exp ≤ now）', async () => {
    const expiredToken = signExpiredToken();
    const res = await fetch(`${BASE_URL}/v1/users/${ADMIN_ID}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${expiredToken}`,
      },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as ResponseBody;
    expect(body.code).toBe('TOKEN_EXPIRED');
  });

  it('AC-G5: logout 后再用该 token 访问 GET /v1/users/:id → 401 + body.code="TOKEN_REVOKED"（G5 黑名单）', async () => {
    // 1. login 拿新 token（不复用 beforeAll 的全局 token，避免污染后续测试）
    const loginRes = await fetch(`${BASE_URL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as ResponseBody;
    const token = loginBody.token!;
    // 2. logout（携带该 token）→ 200 + success:true，token 入黑名单
    const logoutRes = await fetch(`${BASE_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(logoutRes.status).toBe(200);
    const logoutBody = (await logoutRes.json()) as ResponseBody;
    expect(logoutBody.success).toBe(true);
    // 3. 再用该 token 访问 GET /v1/users/:id → 401 TOKEN_REVOKED（命中黑名单 G5）
    const res = await fetch(`${BASE_URL}/v1/users/${ADMIN_ID}`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as ResponseBody;
    expect(body.code).toBe('TOKEN_REVOKED');
  });
});

// ===========================================================================
// AC-G7 / G8 / G9 · ETag 协商缓存（端到端 HTTP，复用 handle() cacheable 304 分支）
// ===========================================================================
describe('AC-G7 / G8 / G9 · ETag 协商缓存（端到端 HTTP）', () => {
  it('AC-G7: GET /v1/users/:id → 200 + ETag header（detailEtag 格式 "version"）', async () => {
    const created = await createUser('g7-etag');
    const res = await request(`/v1/users/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.etag).not.toBeNull();
    // ETag 格式：含双引号的 version（RFC 7232 强 ETag，D5）
    expect(res.etag).toMatch(/^"\d+"$/);
    expect(res.etag).toBe('"0"'); // version=0
  });

  it('AC-G8: If-None-Match 匹配 ETag → 304 + 空 body', async () => {
    const created = await createUser('g8-304');
    // 第一次 GET → 200 + ETag1='"0"'
    const res1 = await request(`/v1/users/${created.id}`);
    expect(res1.status).toBe(200);
    expect(res1.etag).toBe('"0"');
    const etag = res1.etag as string;
    // 第二次 GET 携带匹配的 If-None-Match → 304 + 空 body
    const res2 = await request(`/v1/users/${created.id}`, {
      headers: { 'If-None-Match': etag },
    });
    expect(res2.status).toBe(304);
    expect(res2.text).toBe('');
  });

  it('AC-G9: If-None-Match 不匹配 → 200 + body + 新 ETag', async () => {
    const created = await createUser('g9-mismatch');
    // 携带不匹配的 If-None-Match='"999"' → 200 + body + 正确 ETag='"0"'
    const res = await request(`/v1/users/${created.id}`, {
      headers: { 'If-None-Match': '"999"' },
    });
    expect(res.status).toBe(200);
    expect(res.etag).toBe('"0"');
    expect(res.body?.id).toBe(created.id);
  });

  it('AC-G9: 缺失 If-None-Match → 200 + ETag（无条件 GET）', async () => {
    const created = await createUser('g9-missing');
    const res = await request(`/v1/users/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.etag).not.toBeNull();
    expect(res.etag).toBe('"0"');
  });

  it('AC-G9: If-None-Match 非法格式（非引号）→ 忽略 200 + ETag（parseIfNoneMatch 宽容解析）', async () => {
    const created = await createUser('g9-invalid');
    // If-None-Match='abc'（非引号格式）→ parseIfNoneMatch 返回 null → 忽略 → 200
    const res = await request(`/v1/users/${created.id}`, {
      headers: { 'If-None-Match': 'abc' },
    });
    expect(res.status).toBe(200);
    expect(res.etag).not.toBeNull();
    expect(res.etag).toBe('"0"');
  });

  it('AC-G7/G8/G9 全链路：GET(无INM)→200+ETag1 → GET(INM匹配)→304 → GET(旧INM不匹配)→200+ETag1', async () => {
    const created = await createUser('g7-fullchain');
    // 步骤 1：GET（无 If-None-Match）→ 200 + ETag1='"0"'
    const step1 = await request(`/v1/users/${created.id}`);
    expect(step1.status).toBe(200);
    expect(step1.etag).toBe('"0"');
    const etag1 = step1.etag as string;
    // 步骤 2：GET（If-None-Match='"0"'）→ 304 + 空 body
    const step2 = await request(`/v1/users/${created.id}`, {
      headers: { 'If-None-Match': etag1 },
    });
    expect(step2.status).toBe(304);
    expect(step2.text).toBe('');
    // 步骤 3：GET（不匹配的 If-None-Match='"999"'）→ 200 + ETag1='"0"'（同一 version，ETag 不变）
    const step3 = await request(`/v1/users/${created.id}`, {
      headers: { 'If-None-Match': '"999"' },
    });
    expect(step3.status).toBe(200);
    expect(step3.etag).toBe(etag1);
    expect(step3.body?.id).toBe(created.id);
  });
});

// ===========================================================================
// AC-G10 · 路由无冲突验证（端到端 HTTP，区分 detail vs list vs status vs transfer）
// ===========================================================================
describe('AC-G10 · 路由无冲突验证（端到端 HTTP，3 段 GET 命中 detail）', () => {
  it('AC-G10: GET /v1/users（2 段列表）≠ GET /v1/users/:id（3 段详情），段数不同不冲突', async () => {
    // 列表
    const listRes = await request('/v1/users?page=1&pageSize=10');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body?.items)).toBe(true);
    // 详情（3 段）
    const detailRes = await request(`/v1/users/${ADMIN_ID}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body?.id).toBe(ADMIN_ID);
    // 二者返回结构不同（列表含 items[]，详情含 id 单字段）
    expect(listRes.body).not.toHaveProperty('id');
    expect(detailRes.body).not.toHaveProperty('items');
  });

  it('AC-G10: PATCH /v1/users/:id/status（4 段）≠ GET /v1/users/:id（3 段），method+段数不同不冲突', async () => {
    // PATCH status 走 4 段路由（带 If-Match）
    const patchRes = await request(`/v1/users/${ADMIN_ID}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
      headers: { 'If-Match': '0' },
    });
    // admin 自身禁用禁止（B6），但启用自身允许；这里 PATCH active 是 no-op（USER_ALREADY_ACTIVE 409）
    // 验证 PATCH /v1/users/:id/status 路由命中（非 GET detail 路由）
    expect(patchRes.status).not.toBe(404);
    // GET detail 走 3 段路由
    const detailRes = await request(`/v1/users/${ADMIN_ID}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body?.id).toBe(ADMIN_ID);
  });

  it('AC-G10: GET /v1/users/:id 命中 3 段 GET 详情，非 4 段子资源（roles / effective-permissions）', async () => {
    // GET /v1/users/:userId/roles（4 段）vs GET /v1/users/:id（3 段）段数不同
    const rolesRes = await request(`/v1/users/${ADMIN_ID}/roles`);
    expect(rolesRes.status).toBe(200);
    expect(Array.isArray(rolesRes.body)).toBe(true); // listUserRoles 返回裸数组
    // GET detail（3 段）
    const detailRes = await request(`/v1/users/${ADMIN_ID}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body?.id).toBe(ADMIN_ID);
    expect(detailRes.body).not.toHaveProperty('length'); // 非数组
  });
});
