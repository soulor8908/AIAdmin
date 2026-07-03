// apps/api/test/persist-embedding.test.ts —— TECH-PERSIST-001 端到端持久化验收（test-first）
//
// 覆盖 PRD-PERSIST-001 端到端 AC（spawn 真实 server.ts + fetch HTTP）：
//   AC-F1-2 文件持久化：写数据 → kill → respawn 同 DB_PATH → 数据仍在
//   AC-F1-3 DB_PATH env 配置：spawn env 传 DB_PATH → 文件被创建
//   AC-F7-2 seed 后可登录：首次启动 seed admin → login admin@example.com/admin123 → 200 token
//   AC-F7-3 seed 持久化：重启后 admin role id 不变（DB 文件持久化，非每次重建）
//   端到端约束映射：POST /v1/users 重复 email → 409 USER_EMAIL_DUPLICATE（无 SQLite 内部信息）
//   端到端事务：POST /v1/users/:userId/transfer 成功 → COMMIT → 角色变更持久化
//
// [spawn 配置]（参考 optimistic-locking-embedding.test.ts）：
//   spawn('npx', ['tsx', 'apps/api/src/server.ts'], { env: {PORT:4889, AUTH_SECRET, DB_PATH:临时文件}, cwd:'/workspace/mvp' })
//   端口 4889 避开 4888(auth-embedding)/3999(optimistic-locking)/4000(etag-caching)
//
// [两次 spawn 模式]：
//   describe('首次启动')：spawn server1 → login → 记录 admin role id + 创建测试用户 → kill server1
//   describe('重启持久化')：spawn server2（同 DB_PATH）→ login → 验证 admin id 不变 + 用户数据仍在 → kill server2 + 清理
//
// [预期红]（impl 未完成，server.ts 未读 DB_PATH + 内存版重启丢数据）：
//   - F1-3：server.ts 未 createDb(DB_PATH) → 文件不存在 → 断言级红
//   - F1-2/F7-3：内存版重启重建 admin（id 变）+ 丢用户数据 → 断言级红
//   - F7-2/约束映射/transfer：内存版 seed admin + service 前置校验 + 应用层补偿 → 可能绿（不依赖 DB）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';

const TEST_PORT = 4889;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const AUTH_SECRET = 'test-persist-embed-secret';
// 临时文件 DB（AC-F6-3：端到端用文件 DB 验证持久化语义，非 :memory:）
const DB_PATH = join(tmpdir(), `persist-embed-${randomUUID()}.db`);

let serverProcess: ChildProcess | undefined;
let authToken: string | undefined;
let emailCounter = 0;
// 跨 describe 共享：首次启动记录的 admin role id + 创建的用户 id（重启后验证持久化）
let firstAdminRoleId: string | undefined;
let firstCreatedUserId: string | undefined;
let firstCreatedUserEmail: string | undefined;

interface ResponseBody {
  error?: string;
  message?: string;
  current_version?: number;
  id?: string;
  name?: string;
  email?: string;
  version?: number;
  status?: string;
  is_builtin?: boolean;
  items?: Array<Record<string, unknown>>;
}

function uniqueEmail(): string {
  emailCounter += 1;
  return `persist-embed-${Date.now()}-${emailCounter}@example.com`;
}

function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

async function fetchJson(path: string, init: RequestInit = {}): Promise<{ status: number; body: ResponseBody }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as ResponseBody) : undefined;
  return { status: res.status, body: body ?? {} };
}

/** spawn server.ts 并轮询 /health 等 ready，然后 login admin 获取 token。
 * [重启语义] 开头先 kill 旧进程 + 等待端口释放，确保第二次调用是真正"重启"而非"假重启"。
 *   修复前的缺陷：第二次 spawn 不 kill 旧进程 → 端口 4889 仍被第一个进程占用 →
 *   第二个进程 listen 失败但测试轮询 /health 命中第一个进程（内存未重置）→
 *   F7-3/F1-2 误绿（admin id 不变 + 用户数据仍在，实为同一进程）。
 *   修复后：kill 旧进程 → 端口释放 → 第二个进程真正 listen → 内存版重启丢数据 → 断言级红。 */
async function spawnServer(): Promise<void> {
  await killServer();
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
  // 轮询 /health 等 ready
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
    throw new Error(`Server did not start on port ${TEST_PORT}. Output:\n${serverOutput}`);
  }
  // login admin（seed 凭据 admin@example.com/admin123）
  const loginRes = await fetch(`${BASE_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }),
  });
  if (!loginRes.ok) {
    throw new Error(`admin login failed (${loginRes.status}). Output:\n${serverOutput}`);
  }
  const loginBody = (await loginRes.json()) as { token?: string };
  authToken = loginBody.token;
}

async function killServer(): Promise<void> {
  // [端口级 kill] npx tsx 会 fork node(server.ts) 子进程，进程组 kill（process.kill(-pid)）
  // 无法可靠杀掉 tsx spawn 的 node 子进程（它可能不在 npx 进程组内），且之前测试运行可能
  // 遗留孤儿进程继续 listen 4889 → "假重启"（F7-3/F1-2 误绿，实为同一进程内存）。
  // 用 lsof -ti:4889 杀所有 listen 4889 的进程，最可靠（不管进程树结构）。
  // 4889 是 persist-embedding 专用端口，不会与其他测试冲突。
  if (serverProcess) {
    try {
      serverProcess.kill('SIGTERM');
    } catch { /* 进程可能已退出 */ }
    serverProcess = undefined;
  }
  try {
    // -sTCP:LISTEN 只返回 LISTEN 状态的进程，避免误杀 vitest 自己的 fetch() ESTABLISHED 连接
    // （lsof -ti:4889 默认返回所有打开 4889 的进程，含 vitest 的客户端连接 → kill -9 自杀）
    execSync('lsof -ti:4889 -sTCP:LISTEN | xargs -r kill -9 2>/dev/null || true', { encoding: 'utf8' });
  } catch { /* lsof 不可用时忽略 */ }
  await new Promise((r) => setTimeout(r, 600));
  authToken = undefined;
}

/** GET /v1/roles 找 admin 角色，返回其 id。 */
async function findAdminRoleId(): Promise<string | undefined> {
  const res = await fetchJson('/v1/roles?page=1&pageSize=100');
  expect(res.status).toBe(200);
  const admin = res.body.items?.find((r) => r.is_builtin === true || r.name === 'admin');
  return admin?.id as string | undefined;
}

/** POST /v1/users 创建用户，返回 {id, email}。 */
async function createUser(): Promise<{ id: string; email: string }> {
  const email = uniqueEmail();
  const res = await fetchJson('/v1/users', {
    method: 'POST',
    body: JSON.stringify({ name: 'persist-embed-user', email }),
  });
  expect(res.status).toBe(200);
  return { id: res.body.id as string, email };
}

// =====================================================================================================
// 端到端 · 首次启动：seed + DB_PATH + 约束映射 + transfer 事务
// =====================================================================================================
describe('端到端 · 首次启动（seed + DB_PATH + 约束映射 + 事务）', () => {
  beforeAll(async () => {
    await spawnServer();
    // 记录首次启动的 admin role id（重启后验证不变，F7-3）
    firstAdminRoleId = await findAdminRoleId();
    // 创建测试用户（重启后验证数据仍在，F1-2）
    const u = await createUser();
    firstCreatedUserId = u.id;
    firstCreatedUserEmail = u.email;
  }, 30000);

  afterAll(async () => {
    await killServer();
  });

  it('AC-F7-2 seed 后可登录：login admin@example.com/admin123 → 200 token', () => {
    // beforeAll 已 login 并设置 authToken；断言 token 非空
    expect(authToken).toBeDefined();
    expect(typeof authToken).toBe('string');
    expect(authToken!.length).toBeGreaterThan(0);
  });

  it('AC-F1-3 DB_PATH env 配置：spawn 传 DB_PATH → 文件被创建（server.ts createDb 落地）', () => {
    // server.ts 未读 DB_PATH/createDb 时文件不存在 → 断言级红
    expect(existsSync(DB_PATH)).toBe(true);
  });

  it('AC-F7-1 seed 幂等：admin 角色存在且唯一（is_builtin=true）', async () => {
    const res = await fetchJson('/v1/roles?page=1&pageSize=100');
    expect(res.status).toBe(200);
    const admins = (res.body.items ?? []).filter((r) => r.is_builtin === true);
    expect(admins.length).toBe(1);
    expect(admins[0]!.name).toBe('admin');
  });

  it('端到端约束映射：POST /v1/users 重复 email → 409 USER_EMAIL_DUPLICATE（无 SQLite 内部信息）', async () => {
    // 先创建一个用户
    const email = uniqueEmail();
    const create1 = await fetchJson('/v1/users', {
      method: 'POST',
      body: JSON.stringify({ name: 'dup-user', email }),
    });
    expect(create1.status).toBe(200);
    // 重复 email → 409 USER_EMAIL_DUPLICATE
    const create2 = await fetchJson('/v1/users', {
      method: 'POST',
      body: JSON.stringify({ name: 'dup-user-2', email }),
    });
    expect(create2.status).toBe(409);
    expect(create2.body.error).toBe('USER_EMAIL_DUPLICATE');
    // 无 SQLite 内部信息（AC-F5-3）
    expect(String(create2.body.message ?? '')).not.toMatch(/SQLITE|constraint/i);
  });

  it('端到端事务：POST /v1/users/:userId/transfer 成功 → COMMIT → 角色变更持久化', async () => {
    // 构造 transfer 场景：用户 + 部门 + oldRole + newRole + 分配 oldRole
    const user = await createUser();
    // 创建部门
    const deptRes = await fetchJson('/v1/departments', {
      method: 'POST',
      body: JSON.stringify({ name: `transfer-dept-${randomUUID().slice(0, 8)}` }),
    });
    expect(deptRes.status).toBe(200);
    const deptId = deptRes.body.id as string;
    // 创建 oldRole + newRole
    const oldRoleRes = await fetchJson('/v1/roles', {
      method: 'POST',
      body: JSON.stringify({
        name: `old-role-${randomUUID().slice(0, 8)}`,
        description: 'old',
        permission_codes: ['user:read'],
      }),
    });
    expect(oldRoleRes.status).toBe(200);
    const oldRoleId = oldRoleRes.body.id as string;
    const newRoleRes = await fetchJson('/v1/roles', {
      method: 'POST',
      body: JSON.stringify({
        name: `new-role-${randomUUID().slice(0, 8)}`,
        description: 'new',
        permission_codes: ['user:read'],
      }),
    });
    expect(newRoleRes.status).toBe(200);
    const newRoleId = newRoleRes.body.id as string;
    // 分配 oldRole 给用户
    const assignRes = await fetchJson(`/v1/users/${user.id}/roles/${oldRoleId}`, { method: 'POST' });
    expect(assignRes.status).toBe(200);
    // transfer: 部门=dept, oldRole→newRole
    const transferRes = await fetchJson(`/v1/users/${user.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toDepartmentId: deptId, oldRoleId, newRoleId }),
    });
    expect(transferRes.status).toBe(200);
    // 验证角色变更：GET /v1/users/:userId/roles 含 newRole 不含 oldRole
    // 注意：该路由返回 UserRole[]（数组，非 {items} 分页结构，RoleService.listUserRoles 直接返回数组）
    // UserRole 实体字段 = {id, user_id, role_id, assigned_at}；验证角色应用 role_id 而非关联记录 id
    const rolesRes = await fetchJson(`/v1/users/${user.id}/roles`);
    expect(rolesRes.status).toBe(200);
    const rawRolesBody = rolesRes.body as unknown;
    const roleIds = Array.isArray(rawRolesBody)
      ? (rawRolesBody as Array<{ role_id: string }>).map((r) => r.role_id)
      : [];
    expect(roleIds).toContain(newRoleId);
    expect(roleIds).not.toContain(oldRoleId);
  });
});

// =====================================================================================================
// 端到端 · 重启持久化（F1-2 / F7-3）
// =====================================================================================================
describe('端到端 · 重启持久化（F1-2 / F7-3）', () => {
  beforeAll(async () => {
    // respawn 同 DB_PATH（验证文件 DB 持久化语义）
    await spawnServer();
  }, 30000);

  afterAll(async () => {
    await killServer();
    // 清理临时 DB 文件
    if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  });

  it('AC-F7-3 seed 持久化：重启后 admin role id 不变（DB 文件持久化，非每次重建）', async () => {
    // 内存版重启重建 admin → id 变（randomUUID）→ 断言级红
    // DB 版持久化 → id 不变 → 绿
    expect(firstAdminRoleId).toBeDefined();
    const restartedAdminId = await findAdminRoleId();
    expect(restartedAdminId).toBeDefined();
    expect(restartedAdminId).toBe(firstAdminRoleId);
  });

  it('AC-F1-2 文件持久化：重启后首次启动创建的用户数据仍在', async () => {
    // 内存版重启丢数据 → 用户不存在 → 断言级红
    // DB 版持久化 → 用户仍在 → 绿
    expect(firstCreatedUserId).toBeDefined();
    const res = await fetchJson('/v1/users?page=1&pageSize=100');
    expect(res.status).toBe(200);
    const found = (res.body.items ?? []).find((u) => u.id === firstCreatedUserId);
    expect(found).toBeDefined();
    expect(found?.email).toBe(firstCreatedUserEmail);
  });

  it('AC-F7-2 重启后 admin 仍可登录（login 200 token）', async () => {
    // beforeAll 已 login；断言 token 非空
    expect(authToken).toBeDefined();
    expect(authToken!.length).toBeGreaterThan(0);
  });
});
