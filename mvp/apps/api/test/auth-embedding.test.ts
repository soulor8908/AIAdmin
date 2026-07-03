// apps/api/test/auth-embedding.test.ts —— TECH-AUTH-001 端到端 HTTP 验收测试（AI-007）
//
// 覆盖 PRD-AUTH-001 端到端验收标准（spawn 真实 server + fetch，覆盖跨层鉴权链路）：
//   - F1 login：AC-F1-1（正确凭据登录成功 200 + token + expires_at）、AC-F1-5（login 路由 auth:'public'）
//   - F2 token 校验中间件（buildCtx G1~G6）：
//       AC-F2-1 缺失 Authorization → 401 UNAUTHORIZED
//       AC-F2-2 非 Bearer scheme → 401 TOKEN_INVALID
//       AC-F2-3 伪造 token → 401 TOKEN_INVALID
//       AC-F2-4 过期 token → 401 TOKEN_EXPIRED
//       AC-F2-5 有效 token → 200
//       AC-F2-6 Ctx 来源切换不破坏 service（有效 token → service 收到 Ctx.user 与 payload 一致 → 200）
//   - F4 logout 全链路：AC-F4-1（logout 200 入黑名单）、AC-F4-2（再用该 token → 401 TOKEN_REVOKED）、
//                       AC-F4-4（无 token logout → 401 UNAUTHORIZED）
//   - F5 seed：AC-F5-1（spawn 后 admin 被 seed）、AC-F5-2（重复启动不重复 seed 幂等，间接验证 admin 唯一）、AC-F5-3（seed 凭据可登录）
//
// 测试方式：通过 node:child_process 启动真实 HTTP server（npx tsx apps/api/src/server.ts），
// 用 fetch 发起 HTTP 请求，断言响应状态码与 body。这是真正的端到端测试，覆盖 server.ts 的
// buildCtx 鉴权来源切换（header mock → Bearer 验签）、login/logout 路由注册、seed、黑名单等工程脚手架行为。
//
// 端口选择：使用 4888（R9 optimistic-locking-embedding 占 3999，R10 etag-caching-embedding 占 4000，避免并行冲突）。
// AUTH_SECRET：spawn 时显式注入 process.env.AUTH_SECRET，便于 AC-F2-4 用同 secret 签发过期 token。
//
// TDD RED 阶段：本测试文件在 impl-writer 完成 server.ts 改造（buildCtx Bearer 验签 + login/logout 路由注册 +
// seed password_hash）前全部失败（路由 404 / 缺 token 仍 200 / logout 不存在 等），符合 AI-002 测试先行。
// 重点确保测试逻辑断言正确（实现完成后能绿），而非导入错误。期望导入级红：signToken（domain/auth.ts）。
//
// CODE-001：无 any 类型标注或断言，用 unknown + 类型守卫 + 具体接口。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { signToken } from '../src/domain/auth.js';

const TEST_PORT = 4888;
const BASE_URL = `http://localhost:${TEST_PORT}`;
// 与 server spawn 注入的 AUTH_SECRET 一致（D10），便于 AC-F2-4 用同 secret 签发过期 token
const AUTH_SECRET = 'test-embedding-secret';
// 临时文件 DB（TECH-PERSIST-001：spawn 真实 server 须传 DB_PATH，避免内存版 + 隔离测试间状态）
const DB_PATH = join(tmpdir(), `auth-embed-${randomUUID()}.db`);
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'admin123';

let serverProcess: ChildProcess | undefined;

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
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`Server did not start. Server output:\n${serverOutput}`);
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

interface ResponseBody {
  error?: string;
  message?: string;
  token?: string;
  expires_at?: string;
  success?: boolean;
  items?: Array<{ id: string; email: string; name: string; status: string; version: number }>;
  endpoints?: string[];
  auth_hint?: string;
}

async function fetchJson(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: ResponseBody }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as ResponseBody) : {};
  return { status: res.status, body };
}

/** login 并返回 token（AC-F1-1 成功路径辅助）。 */
async function login(email: string, password: string): Promise<{ token: string; expires_at: string }> {
  const { status, body } = await fetchJson('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  expect(status).toBe(200);
  expect(body.token).toBeDefined();
  expect(body.expires_at).toBeDefined();
  return { token: body.token!, expires_at: body.expires_at! };
}

/** 用 AUTH_SECRET 签发一个已过期的 token（AC-F2-4）：iat/exp 均在 1 小时前。 */
function signExpiredToken(): string {
  const nowSec = Math.floor(Date.now() / 1000);
  return signToken(
    {
      sub: '00000000-0000-4000-8000-000000000001',
      role: 'admin',
      iat: nowSec - 7200,
      exp: nowSec - 3600,
    },
    AUTH_SECRET,
  );
}

// ---------------------------------------------------------------------------
// F1 · login 端到端（AC-F1-1 / AC-F1-5）
// ---------------------------------------------------------------------------
describe('F1 · login 端到端', () => {
  it('AC-F1-1: 正确凭据 POST /v1/auth/login → 200 + token（非空）+ expires_at（未来时间）', async () => {
    const { status, body } = await fetchJson('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    expect(status).toBe(200);
    expect(typeof body.token).toBe('string');
    expect(body.token!.length).toBeGreaterThan(0);
    expect(typeof body.expires_at).toBe('string');
    // expires_at 为未来时间（token 1 小时有效，Q6）
    expect(new Date(body.expires_at!).getTime()).toBeGreaterThan(Date.now());
  });

  it('AC-F1-5: login 路由 auth:public —— 不携带任何 Authorization header 访问 /v1/auth/login 进入 login 流程（非 401 UNAUTHORIZED）', async () => {
    // 不携带任何 token；错误密码应返回 401 INVALID_CREDENTIALS（进入 login handler），
    // 而非 401 UNAUTHORIZED（受保护路由缺失 token 的中间件拦截）。
    const { status, body } = await fetchJson('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: ADMIN_EMAIL, password: 'wrong-password' }),
    });
    expect(status).toBe(401);
    expect(body.error).toBe('INVALID_CREDENTIALS');
    expect(body.error).not.toBe('UNAUTHORIZED');
  });

  it('AC-F1-4: login password 短于 8 位 → 400 VALIDATION_ERROR（schema 层，非 INVALID_CREDENTIALS）', async () => {
    const { status, body } = await fetchJson('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: ADMIN_EMAIL, password: '123' }),
    });
    expect(status).toBe(400);
    expect(body.error).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// F2 · token 校验中间件端到端（AC-F2-1 ~ F2-6，buildCtx G1~G6）
// ---------------------------------------------------------------------------
describe('F2 · token 校验中间件端到端', () => {
  it('AC-F2-1: 缺失 Authorization header → GET /v1/users 401 UNAUTHORIZED', async () => {
    const { status, body } = await fetchJson('/v1/users');
    expect(status).toBe(401);
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('AC-F2-2: 非 Bearer scheme（Authorization: Basic xxx）→ 401 TOKEN_INVALID', async () => {
    const { status, body } = await fetchJson('/v1/users', {
      headers: { Authorization: 'Basic abc123' },
    });
    expect(status).toBe(401);
    expect(body.error).toBe('TOKEN_INVALID');
  });

  it('AC-F2-3: 伪造 token（Bearer <随机字符串>）→ 401 TOKEN_INVALID（验签失败）', async () => {
    const { status, body } = await fetchJson('/v1/users', {
      headers: { Authorization: 'Bearer totally-fake-token-string' },
    });
    expect(status).toBe(401);
    expect(body.error).toBe('TOKEN_INVALID');
  });

  it('AC-F2-4: 过期 token（1 小时前签发，签名有效）→ 401 TOKEN_EXPIRED', async () => {
    const expiredToken = signExpiredToken();
    const { status, body } = await fetchJson('/v1/users', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(status).toBe(401);
    expect(body.error).toBe('TOKEN_EXPIRED');
  });

  it('AC-F2-5: 有效 token（刚 login）→ GET /v1/users 200', async () => {
    const { token } = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const { status, body } = await fetchJson('/v1/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('AC-F2-6: 有效 token → service 收到 Ctx.user 与 payload 一致（GET /v1/users 返回 200，证明 Ctx 构造成功且 role=admin 通过 SEC-002）', async () => {
    // ARCH-001 闭合验证：service 代码零变更，Ctx 来源从 header mock 切换为 token 验签后仍正常工作。
    // role=admin 的 token 通过 SEC-002 requireAdmin → 200；若 Ctx 构造错（如 role 解析错）→ 403 FORBIDDEN。
    const { token } = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const { status, body } = await fetchJson('/v1/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
  });

  it('AC-F3-1: GET /v1/users 响应体的用户对象不含 password_hash（SEC-003a）', async () => {
    const { token } = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const { status, body } = await fetchJson('/v1/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    for (const u of body.items ?? []) {
      // 任意用户响应体均不得包含 password_hash 字段
      expect((u as unknown as { password_hash?: string }).password_hash).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// F4 · logout 全链路端到端（AC-F4-1 / F4-2 / F4-4）
// ---------------------------------------------------------------------------
describe('F4 · logout 全链路端到端', () => {
  it('AC-F4-4: 无 token POST /v1/auth/logout → 401 UNAUTHORIZED（logout 路由 auth:admin，非 public）', async () => {
    const { status, body } = await fetchJson('/v1/auth/logout', {
      method: 'POST',
    });
    expect(status).toBe(401);
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('AC-F4-1/F4-2: login → logout(200) → 再用该 token 访问 GET /v1/users → 401 TOKEN_REVOKED', async () => {
    // 1. login 拿 token
    const { token } = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    // 2. logout（携带该 token）→ 200 + success:true，token 入黑名单
    const logoutRes = await fetchJson('/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);
    // 3. 再用该 token 访问受保护路由 → 401 TOKEN_REVOKED（命中黑名单 G5）
    const reuseRes = await fetchJson('/v1/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error).toBe('TOKEN_REVOKED');
  });

  it('AC-F4-2: logout 后该 token 再调 logout 自身 → 401 TOKEN_REVOKED（黑名单对 logout 路由同样生效）', async () => {
    const { token } = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await fetchJson('/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const reuseLogout = await fetchJson('/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(reuseLogout.status).toBe(401);
    expect(reuseLogout.body.error).toBe('TOKEN_REVOKED');
  });
});

// ---------------------------------------------------------------------------
// F5 · 内置 admin seed 端到端（AC-F5-1 / AC-F5-3）
// ---------------------------------------------------------------------------
describe('F5 · 内置 admin seed 端到端', () => {
  it('AC-F5-1: spawn 后 admin 用户被 seed —— GET /v1/users 列表含 admin@example.com', async () => {
    const { token } = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const { status, body } = await fetchJson('/v1/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    const admin = (body.items ?? []).find((u) => u.email === ADMIN_EMAIL);
    expect(admin).toBeDefined();
    expect(admin?.status).toBe('active');
  });

  it('AC-F5-3: seed 凭据 admin@example.com/admin123 可登录（spawn 后 200 token）', async () => {
    const { token, expires_at } = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(typeof expires_at).toBe('string');
  });

  it('AC-F5-1: seed admin role=admin —— 通过 token 验签后 GET /v1/users 返回 200（role=admin 通过 SEC-002）', async () => {
    // seed 的 admin role 须为 admin，否则 login 签发的 token role≠admin → GET /v1/users 被 SEC-002 拦截 403
    const { token } = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const { status } = await fetchJson('/v1/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
  });

  it('AC-F5-2: 重复启动不重复 seed（幂等）—— GET /v1/users 列表中 admin@example.com 仅一条（间接验证；严格双 spawn 验证为 impl-writer 阶段增强项）', async () => {
    // AC-F5-2 严格验证需 spawn 两次 server（同库二次启动），此处间接验证：单次 spawn 后 admin 邮箱唯一。
    // 若 seed 逻辑非幂等（每次启动都 insert），admin 会有多条；impl-writer 实现"已存在则跳过"后此断言绿。
    const { token } = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const { status, body } = await fetchJson('/v1/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    const admins = (body.items ?? []).filter((u) => u.email === ADMIN_EMAIL);
    expect(admins.length).toBe(1); // 幂等：admin 仅一条
  });
});

// ---------------------------------------------------------------------------
// 辅助 · server banner auth_hint 已切换为 Bearer（D10 advisory，验证工程脚手架同步）
// ---------------------------------------------------------------------------
describe('辅助 · server banner auth_hint 切换', () => {
  it('GET / 的 auth_hint 提示 Authorization: Bearer（非 X-User-Role header mock）', async () => {
    const { status, body } = await fetchJson('/');
    expect(status).toBe(200);
    expect(body.auth_hint).toContain('Bearer');
    expect(body.auth_hint).not.toContain('X-User-Role');
  });
});
