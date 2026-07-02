// apps/api/test/etag-caching-embedding.test.ts —— TECH-ETAG-CACHING-001 端到端 HTTP 验收测试
//
// 覆盖 PRD-ETAG-CACHING-001 端到端 HTTP 协商缓存（含 AC-F4-3 全链路）：
//   - F1 detail ETag（AC-F1-1）：GET /v1/notifications/:id + GET /v1/roles/:id → 200 + ETag header
//   - F1 list ETag（AC-F1-1）：GET /v1/users → 200 + ETag "total-maxVersion" 格式
//   - F2 If-None-Match 协商（AC-F2-1~F2-4）：匹配→304 / 不匹配→200 / 缺失→200 / 非法→200
//   - F3 list If-None-Match 协商（AC-F3-2/F3-3）：匹配→304 / create 后变化→200
//   - F4 缓存失效（AC-F4-1/F4-2）：update 后 detail 304→200 / delete 后 list 304→200
//   - AC-F4-3 全链路：GET(无INM)→200+ETag1 → GET(INM)→304 → update→v1 → GET(旧INM)→200+ETag2 → GET(新INM)→304
//
// 测试方式：通过 node:child_process 启动真实 HTTP server（npx tsx apps/api/src/server.ts），
// 用 fetch 发起 HTTP 请求，断言响应状态码 + ETag header + body。这是真正的端到端测试，覆盖
// server.ts 的 ETag 生成（D7）、If-None-Match 解析（D8）、304 协商决策（D9）等 HTTP 层行为。
//
// 端口选择：使用 4000（R9 optimistic-locking-embedding.test.ts 占用 3999，避免并行测试端口冲突）。
//
// 独立性：每个 mutating 测试新建独立实体（notification/user），避免测试间状态耦合；
// list ETag 测试从 body 计算 total+maxVersion 验证 ETag 值，避免依赖硬编码条数（其他测试可能已新增实体）。
//
// TDD RED 阶段：本测试文件在 impl-writer 完成 src/etag.ts + server.ts ETag/If-None-Match 集成前
// 全部失败（ETag header 缺失 / If-None-Match 被忽略 → 304 测试得到 200），符合 AI-002 测试先行。
//
// CODE-001：无 any 类型标注或断言，用 unknown + 类型守卫 + 具体接口。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';

const TEST_PORT = 4000;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const ADMIN_HEADERS = {
  'X-User-Id': '00000000-0000-4000-8000-000000000001',
  'X-User-Role': 'admin',
};
const ALICE_ID = '00000000-0000-4000-8000-000000000002';

let serverProcess: ChildProcess | undefined;
let emailCounter = 0;

beforeAll(async () => {
  serverProcess = spawn('npx', ['tsx', 'apps/api/src/server.ts'], {
    env: { ...process.env, PORT: String(TEST_PORT) },
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
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
  }
});

// ===========================================================================
// 类型定义
// ===========================================================================

interface EntityLike {
  id: string;
  version: number;
  [key: string]: unknown;
}

interface ResponseBody {
  error?: string;
  message?: string;
  id?: string;
  version?: number;
  status?: string;
  title?: string;
  content?: string;
  recipient_id?: string;
  name?: string;
  is_builtin?: boolean;
  items?: EntityLike[];
  total?: number;
}

interface HttpResponse {
  status: number;
  etag: string | null;
  body: ResponseBody | undefined;
  text: string;
}

interface NotificationEntity {
  id: string;
  version: number;
  status: string;
  title: string;
  content: string;
  recipient_id: string;
}

interface UserEntity {
  id: string;
  name: string;
  email: string;
  status: string;
  version: number;
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
      ...ADMIN_HEADERS,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  const body: ResponseBody | undefined = text ? (JSON.parse(text) as ResponseBody) : undefined;
  return { status: res.status, etag: res.headers.get('etag'), body, text };
}

function uniqueEmail(): string {
  emailCounter += 1;
  return `etag-${Date.now()}-${emailCounter}@example.com`;
}

/** 创建用户（POST /v1/users），返回含 id+version 的实体。 */
async function createUser(name = 'etag-user'): Promise<UserEntity> {
  const res = await request('/v1/users', {
    method: 'POST',
    body: JSON.stringify({ name, email: uniqueEmail() }),
  });
  expect(res.status).toBe(200);
  return res.body as UserEntity;
}

/** 创建通知（POST /v1/notifications，recipient=alice），返回含 id+version 的实体。 */
async function createNotification(title = 'T', content = 'C'): Promise<NotificationEntity> {
  const res = await request('/v1/notifications', {
    method: 'POST',
    body: JSON.stringify({ title, content, recipient_id: ALICE_ID }),
  });
  expect(res.status).toBe(200);
  return res.body as NotificationEntity;
}

/** 查找内置 admin 角色 id（GET /v1/roles 后筛 is_builtin=true）。 */
async function findAdminRoleId(): Promise<string> {
  const res = await request('/v1/roles?page=1&pageSize=100');
  expect(res.status).toBe(200);
  const items = res.body?.items ?? [];
  const admin = items.find((r) => r.is_builtin === true);
  expect(admin).toBeDefined();
  return admin!.id;
}

// ===========================================================================
// F1 · detail ETag（端到端 HTTP）
// ===========================================================================
describe('F1 · detail ETag（端到端 HTTP）', () => {
  it('AC-F1-1: GET /v1/notifications/:id → 200 + ETag header（detailEtag 格式 "version"）', async () => {
    // 创建通知（version=0, draft）
    const notif = await createNotification('f1-detail-notif', 'content');
    // GET detail → 200 + ETag='"0"'（version=0）
    const res = await request(`/v1/notifications/${notif.id}`);
    expect(res.status).toBe(200);
    expect(res.etag).not.toBeNull();
    // ETag 格式：含双引号的 version（RFC 7232 强 ETag）
    expect(res.etag).toMatch(/^"\d+"$/);
    expect(res.etag).toBe('"0"');
  });

  it('AC-F1-1: GET /v1/roles/:id → 200 + ETag header（内置 admin version=0 → ETag="0"）', async () => {
    const adminRoleId = await findAdminRoleId();
    const res = await request(`/v1/roles/${adminRoleId}`);
    expect(res.status).toBe(200);
    expect(res.etag).not.toBeNull();
    expect(res.etag).toMatch(/^"\d+"$/);
    // 内置 admin role version=0 → ETag='"0"'
    expect(res.etag).toBe('"0"');
  });
});

// ===========================================================================
// F1 · list ETag（端到端 HTTP）
// ===========================================================================
describe('F1 · list ETag（端到端 HTTP）', () => {
  it('AC-F1-1: GET /v1/users → 200 + ETag "total-maxVersion" 格式', async () => {
    const res = await request('/v1/users?page=1&pageSize=100');
    expect(res.status).toBe(200);
    expect(res.etag).not.toBeNull();
    // ETag 格式："total-maxVersion"（含双引号）
    expect(res.etag).toMatch(/^"\d+-\d+"$/);
    // 从 body 计算 total + maxVersion，验证 ETag 值（不硬编码条数，避免其他测试新增用户导致失败）
    const items = res.body?.items ?? [];
    const total = res.body?.total ?? 0;
    const maxVersion = items.reduce((max, u) => Math.max(max, u.version), 0);
    expect(res.etag).toBe(`"${total}-${maxVersion}"`);
  });
});

// ===========================================================================
// F2 · If-None-Match 协商缓存（端到端 HTTP）
// ===========================================================================
describe('F2 · If-None-Match 协商缓存（端到端 HTTP）', () => {
  it('AC-F2-1: ETag 匹配 → 304 + 空 body', async () => {
    const notif = await createNotification('f2-1-match', 'content');
    // 第一次 GET → 200 + ETag1
    const res1 = await request(`/v1/notifications/${notif.id}`);
    expect(res1.status).toBe(200);
    expect(res1.etag).not.toBeNull();
    const etag = res1.etag as string;
    // 第二次 GET 携带匹配的 If-None-Match → 304 + 空 body
    const res2 = await request(`/v1/notifications/${notif.id}`, {
      headers: { 'If-None-Match': etag },
    });
    expect(res2.status).toBe(304);
    expect(res2.text).toBe('');
  });

  it('AC-F2-2: ETag 不匹配 → 200 + 新 ETag（update 后 version 递增）', async () => {
    const notif = await createNotification('f2-2-mismatch', 'content');
    // 第一次 GET → 200 + ETag1='"0"'
    const res1 = await request(`/v1/notifications/${notif.id}`);
    expect(res1.status).toBe(200);
    expect(res1.etag).toBe('"0"');
    // update（If-Match='0'）→ version=1
    const updateRes = await request(`/v1/notifications/${notif.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'updated-f2-2' }),
      headers: { 'If-Match': '0' },
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body?.version).toBe(1);
    // 携带旧 If-None-Match='"0"' → 200（ETag 不匹配）+ 新 ETag='"1"'
    const res2 = await request(`/v1/notifications/${notif.id}`, {
      headers: { 'If-None-Match': '"0"' },
    });
    expect(res2.status).toBe(200);
    expect(res2.etag).toBe('"1"');
  });

  it('AC-F2-3: 缺失 If-None-Match → 200（无条件 GET）', async () => {
    const notif = await createNotification('f2-3-missing', 'content');
    // 不携带 If-None-Match → 200 + ETag
    const res = await request(`/v1/notifications/${notif.id}`);
    expect(res.status).toBe(200);
    expect(res.etag).not.toBeNull();
    expect(res.etag).toBe('"0"');
  });

  it('AC-F2-4: If-None-Match 格式非法 → 忽略 200（非引号格式被 parseIfNoneMatch 拒绝）', async () => {
    const notif = await createNotification('f2-4-invalid', 'content');
    // If-None-Match='abc'（非引号格式）→ parseIfNoneMatch 返回 null → 忽略 → 200
    const res = await request(`/v1/notifications/${notif.id}`, {
      headers: { 'If-None-Match': 'abc' },
    });
    expect(res.status).toBe(200);
    expect(res.etag).not.toBeNull();
    expect(res.etag).toBe('"0"');
  });
});

// ===========================================================================
// F3 · list If-None-Match 协商缓存（端到端 HTTP）
// ===========================================================================
describe('F3 · list If-None-Match 协商缓存（端到端 HTTP）', () => {
  it('AC-F3-2: list ETag 匹配 → 304 + 空 body', async () => {
    // 第一次 GET list → 200 + ETag1
    const res1 = await request('/v1/users?page=1&pageSize=100');
    expect(res1.status).toBe(200);
    expect(res1.etag).not.toBeNull();
    const etag = res1.etag as string;
    // 第二次 GET list 携带匹配的 If-None-Match → 304 + 空 body
    const res2 = await request('/v1/users?page=1&pageSize=100', {
      headers: { 'If-None-Match': etag },
    });
    expect(res2.status).toBe(304);
    expect(res2.text).toBe('');
  });

  it('AC-F3-3: create 后 list ETag 变化 → 200（旧 If-None-Match 不匹配）', async () => {
    // 第一次 GET list → 200 + ETag1
    const res1 = await request('/v1/users?page=1&pageSize=100');
    expect(res1.status).toBe(200);
    expect(res1.etag).not.toBeNull();
    const etag1 = res1.etag as string;
    // create 新用户 → list ETag 变化（total+1）
    await createUser('f3-3-new');
    // 携带旧 If-None-Match → 200（ETag 不匹配）+ 新 ETag
    const res2 = await request('/v1/users?page=1&pageSize=100', {
      headers: { 'If-None-Match': etag1 },
    });
    expect(res2.status).toBe(200);
    expect(res2.etag).not.toBeNull();
    expect(res2.etag).not.toBe(etag1);
  });
});

// ===========================================================================
// F4 · 缓存失效语义（端到端 HTTP）
// ===========================================================================
describe('F4 · 缓存失效语义（端到端 HTTP）', () => {
  it('AC-F4-1: update 后 detail 304→200（旧 ETag 不匹配新 version）', async () => {
    const notif = await createNotification('f4-1-invalidate', 'content');
    // update 前：GET → 200 + ETag='"0"'，携带 If-None-Match='"0"' → 304
    const res1 = await request(`/v1/notifications/${notif.id}`);
    expect(res1.status).toBe(200);
    expect(res1.etag).toBe('"0"');
    const res2 = await request(`/v1/notifications/${notif.id}`, {
      headers: { 'If-None-Match': '"0"' },
    });
    expect(res2.status).toBe(304);
    // update（If-Match='0'）→ version=1
    const updateRes = await request(`/v1/notifications/${notif.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'updated-f4-1' }),
      headers: { 'If-Match': '0' },
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body?.version).toBe(1);
    // update 后：携带旧 If-None-Match='"0"' → 200（ETag='"1"' 不匹配）+ 新 ETag
    const res3 = await request(`/v1/notifications/${notif.id}`, {
      headers: { 'If-None-Match': '"0"' },
    });
    expect(res3.status).toBe(200);
    expect(res3.etag).toBe('"1"');
  });

  it('AC-F4-2: delete 后 list 304→200（total 变化致 ETag 变化）', async () => {
    // 创建一条可删除的 draft 通知
    const notif = await createNotification('f4-2-delete', 'content');
    // 捕获 list ETag1（含该通知）
    const res1 = await request('/v1/notifications?page=1&pageSize=100');
    expect(res1.status).toBe(200);
    expect(res1.etag).not.toBeNull();
    const etag1 = res1.etag as string;
    // 匹配 → 304
    const res2 = await request('/v1/notifications?page=1&pageSize=100', {
      headers: { 'If-None-Match': etag1 },
    });
    expect(res2.status).toBe(304);
    // 删除该通知（draft 可删，需 If-Match）
    const delRes = await request(`/v1/notifications/${notif.id}`, {
      method: 'DELETE',
      headers: { 'If-Match': String(notif.version) },
    });
    expect(delRes.status).toBe(204);
    // 删除后 list ETag 变化（total-1）→ 旧 If-None-Match 不匹配 → 200
    const res3 = await request('/v1/notifications?page=1&pageSize=100', {
      headers: { 'If-None-Match': etag1 },
    });
    expect(res3.status).toBe(200);
    expect(res3.etag).not.toBeNull();
    expect(res3.etag).not.toBe(etag1);
  });
});

// ===========================================================================
// AC-F4-3 · 全链路（端到端 HTTP，核心验收）
// ===========================================================================
describe('AC-F4-3 · 全链路（端到端 HTTP）', () => {
  it('GET(无INM)→200+ETag1 → GET(INM)→304 → update→v1 → GET(旧INM)→200+ETag2 → GET(新INM)→304', async () => {
    // 准备：创建通知（version=0, draft）
    const notif = await createNotification('f4-3-fullchain', 'content');

    // 步骤 1：GET（无 If-None-Match）→ 200 + ETag1='"0"'
    const step1 = await request(`/v1/notifications/${notif.id}`);
    expect(step1.status).toBe(200);
    expect(step1.etag).toBe('"0"');
    const etag1 = step1.etag as string;

    // 步骤 2：GET（If-None-Match='"0"'）→ 304 + 空 body
    const step2 = await request(`/v1/notifications/${notif.id}`, {
      headers: { 'If-None-Match': etag1 },
    });
    expect(step2.status).toBe(304);
    expect(step2.text).toBe('');

    // 步骤 3：update（If-Match='0'）→ 200, version=1
    const step3 = await request(`/v1/notifications/${notif.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'updated-f4-3' }),
      headers: { 'If-Match': '0' },
    });
    expect(step3.status).toBe(200);
    expect(step3.body?.version).toBe(1);

    // 步骤 4：GET（旧 If-None-Match='"0"'）→ 200 + ETag2='"1"'（ETag 变化，缓存失效）
    const step4 = await request(`/v1/notifications/${notif.id}`, {
      headers: { 'If-None-Match': etag1 },
    });
    expect(step4.status).toBe(200);
    expect(step4.etag).toBe('"1"');
    const etag2 = step4.etag as string;

    // 步骤 5：GET（新 If-None-Match='"1"'）→ 304 + 空 body（新 ETag 匹配）
    const step5 = await request(`/v1/notifications/${notif.id}`, {
      headers: { 'If-None-Match': etag2 },
    });
    expect(step5.status).toBe(304);
    expect(step5.text).toBe('');
  });
});
