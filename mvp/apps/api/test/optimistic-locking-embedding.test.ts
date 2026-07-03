// apps/api/test/optimistic-locking-embedding.test.ts —— TECH-OPTIMISTIC-LOCKING-001 HTTP/端到端验收测试
//
// 覆盖：
//   F2 · If-Match 条件请求解析（AC-F2-1~F2-4）—— 缺失/非法/负数/合法 If-Match header 的 server.ts 解析行为（D18）
//   端到端 · Lost Update 防护（AC-F3-6 HTTP level）—— 并发写丢失更新防护
//   端到端 · current_version 返回（AC-F3-2 HTTP level）—— 冲突响应含 current_version（D11/D19）
//   端到端 · 冲突不修改实体（AC-F3-5 HTTP level）—— 版本冲突时实体不被修改
//   端到端 · Notification send 版本校验 —— send 路径版本校验（B_version）先于状态转移校验（B6）
//
// 测试方式：通过 node:child_process 启动真实 HTTP server（npx tsx apps/api/src/server.ts），
// 用 fetch 发起 HTTP 请求，断言响应状态码与 body。这是真正的端到端测试，覆盖 server.ts 的
// If-Match header 解析（D18）、错误响应合并 meta（D19）、路由 versioned 标记（D17）等工程脚手架行为。
//
// 独立性：每个 mutating 测试新建独立实体（user/notification），避免测试间状态耦合；
// F2-1~F2-3 仅校验 If-Match 解析（parseIfMatch 在 safeParse 前拦截，不触达 service 层），
// 使用 alice 作为 target 不产生副作用；F2-4 改用新建用户以避免禁用 alice 后影响
// notification send 测试的收件人 active 校验（B8）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';

const TEST_PORT = 3999;
const BASE_URL = `http://localhost:${TEST_PORT}`;
// TECH-AUTH-001 D3：server.ts 已切换为 Bearer 验签，embedding 测试须 login 获取 token
// （原 X-User-Id/X-User-Role header mock 不再被 buildCtx 接受）
const AUTH_SECRET = 'test-optimistic-secret';
// 临时文件 DB（TECH-PERSIST-001：spawn 真实 server 须传 DB_PATH，避免内存版 + 隔离测试间状态）
const DB_PATH = join(tmpdir(), `optimistic-embed-${randomUUID()}.db`);
const ALICE_ID = '00000000-0000-4000-8000-000000000002';

let serverProcess: ChildProcess | undefined;
let emailCounter = 0;
let authToken: string | undefined;

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
  // Wait for server to be ready (poll /health)
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
    body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }),
  });
  if (!loginRes.ok) {
    throw new Error(`admin login failed (${loginRes.status}). Server output:\n${serverOutput}`);
  }
  const loginBody = (await loginRes.json()) as { token?: string };
  authToken = loginBody.token;
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
  current_version?: number;
  version?: number;
  status?: string;
  id?: string;
  items?: UserLike[];
}

async function fetchJson(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: ResponseBody }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  return { status: res.status, body };
}

function uniqueEmail(): string {
  emailCounter += 1;
  return `test-${Date.now()}-${emailCounter}@example.com`;
}

interface UserLike {
  id: string;
  version: number;
  status: string;
  name: string;
  email: string;
}

async function createUser(name = 'testuser'): Promise<UserLike> {
  const { status, body } = await fetchJson('/v1/users', {
    method: 'POST',
    body: JSON.stringify({ name, email: uniqueEmail() }),
  });
  expect(status).toBe(200);
  return body as UserLike;
}

async function findUserById(id: string): Promise<UserLike | undefined> {
  const { status, body } = await fetchJson('/v1/users?page=1&pageSize=100');
  expect(status).toBe(200);
  return (body.items as UserLike[]).find((u) => u.id === id);
}

// ---------------------------------------------------------------------------
// F2 · If-Match 条件请求解析（AC-F2-1~F2-4，server.ts D18 parseIfMatch）
// ---------------------------------------------------------------------------
describe('F2 · If-Match 条件请求解析（server.ts D18 parseIfMatch）', () => {
  it('AC-F2-1 缺失 If-Match → 400 VERSION_REQUIRED', async () => {
    const res = await fetchJson(`/v1/users/${ALICE_ID}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
      // No If-Match header
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VERSION_REQUIRED');
  });

  it("AC-F2-2 If-Match 格式非法 ('abc') → 400 VALIDATION_ERROR", async () => {
    const res = await fetchJson(`/v1/users/${ALICE_ID}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
      headers: { 'If-Match': 'abc' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it("AC-F2-3 If-Match 负数 ('-1') → 400 VALIDATION_ERROR", async () => {
    const res = await fetchJson(`/v1/users/${ALICE_ID}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
      headers: { 'If-Match': '-1' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it("AC-F2-4 If-Match 合法 ('0') → 200, version=1（版本递增）", async () => {
    // 使用新建用户而非 alice：F2-4 会禁用目标用户，若禁用 alice 则后续
    // notification send 测试（收件人=alice）会因 B8 收件人禁用校验而失败。
    // 新建用户 version=0，If-Match='0' 匹配，PATCH 成功后 version 递增为 1。
    const user = await createUser('f2-4-user');
    const res = await fetchJson(`/v1/users/${user.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
      headers: { 'If-Match': '0' },
    });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.status).toBe('disabled');
  });
});

// ---------------------------------------------------------------------------
// 端到端 · Lost Update 防护（AC-F3-6 HTTP level）
// ---------------------------------------------------------------------------
describe('端到端 · Lost Update 防护（HTTP level）', () => {
  it('Client A 成功写入后，Client B 携带过期 If-Match → 409 VERSION_CONFLICT，A 的变更保留', async () => {
    // 新建用户（version=0, status=active）
    const user = await createUser('lost-update-user');
    // Client A: PATCH with If-Match='0' → 200, version=1
    const resA = await fetchJson(`/v1/users/${user.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
      headers: { 'If-Match': '0' },
    });
    expect(resA.status).toBe(200);
    expect(resA.body.version).toBe(1);
    // Client B: PATCH with stale If-Match='0' → 409 VERSION_CONFLICT
    const resB = await fetchJson(`/v1/users/${user.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
      headers: { 'If-Match': '0' },
    });
    expect(resB.status).toBe(409);
    expect(resB.body.error).toBe('VERSION_CONFLICT');
    expect(resB.body.current_version).toBe(1);
    // 验证：A 的变更保留（status=disabled, version=1）
    const finalUser = await findUserById(user.id);
    expect(finalUser).toBeDefined();
    expect(finalUser?.status).toBe('disabled');
    expect(finalUser?.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 端到端 · current_version 返回（AC-F3-2 HTTP level）
// ---------------------------------------------------------------------------
describe('端到端 · current_version 返回（HTTP level）', () => {
  it('版本冲突响应含 current_version（供客户端 GET 最新资源后重试）', async () => {
    const user = await createUser('current-version-user');
    // 第一次更新成功 v0→v1
    const res1 = await fetchJson(`/v1/users/${user.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
      headers: { 'If-Match': '0' },
    });
    expect(res1.status).toBe(200);
    expect(res1.body.version).toBe(1);
    // 用过期 If-Match='0' 再次更新 → 409, current_version=1
    const res2 = await fetchJson(`/v1/users/${user.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
      headers: { 'If-Match': '0' },
    });
    expect(res2.status).toBe(409);
    expect(res2.body.error).toBe('VERSION_CONFLICT');
    expect(res2.body.current_version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 端到端 · 冲突不修改实体（AC-F3-5 HTTP level）
// ---------------------------------------------------------------------------
describe('端到端 · 冲突不修改实体（HTTP level）', () => {
  it('版本冲突时实体不被修改（status/version 保持原值）', async () => {
    const user = await createUser('no-mutation-user');
    // 用错误 If-Match='99' → 409
    const res = await fetchJson(`/v1/users/${user.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
      headers: { 'If-Match': '99' },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('VERSION_CONFLICT');
    // 验证：用户 status 仍 active, version 仍 0
    const finalUser = await findUserById(user.id);
    expect(finalUser).toBeDefined();
    expect(finalUser?.status).toBe('active');
    expect(finalUser?.version).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 端到端 · Notification send 版本校验
// ---------------------------------------------------------------------------
describe('端到端 · Notification send 版本校验', () => {
  it('send 成功后再次 send 携带错误 If-Match → 409 VERSION_CONFLICT（版本校验先于状态转移校验）', async () => {
    // 创建通知（recipient_id=alice，alice 仍 active —— F2-4 使用新建用户未禁用 alice）
    const createRes = await fetchJson('/v1/notifications', {
      method: 'POST',
      body: JSON.stringify({
        title: 'test notif',
        content: 'hello',
        recipient_id: ALICE_ID,
      }),
    });
    expect(createRes.status).toBe(200);
    expect(createRes.body.version).toBe(0);
    expect(createRes.body.status).toBe('draft');
    const notifId = createRes.body.id as string;
    // send with If-Match='0' → 200, version=1
    const send1 = await fetchJson(`/v1/notifications/${notifId}/send`, {
      method: 'POST',
      headers: { 'If-Match': '0' },
    });
    expect(send1.status).toBe(200);
    expect(send1.body.version).toBe(1);
    expect(send1.body.status).toBe('sent');
    // 再次 send with If-Match='99'（错误版本）→ 409 VERSION_CONFLICT
    // 版本校验（B_version）先于状态转移校验（B6），故返回 VERSION_CONFLICT 而非 NOTIFICATION_INVALID_TRANSITION
    const send2 = await fetchJson(`/v1/notifications/${notifId}/send`, {
      method: 'POST',
      headers: { 'If-Match': '99' },
    });
    expect(send2.status).toBe(409);
    expect(send2.body.error).toBe('VERSION_CONFLICT');
    expect(send2.body.current_version).toBe(1);
  });
});
