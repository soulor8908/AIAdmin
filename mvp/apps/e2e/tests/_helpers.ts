// apps/e2e/tests/_helpers.ts —— E2E 测试辅助函数（login + API setup，[advisory] 内部辅助，非测试文件）
//
// 设计原则：
// - 不 import apps/api/src/**（ARCH-003：E2E 通过 HTTP 交互，不 import）。
// - login 用真实浏览器交互（page.fill + page.click），与 AC-E1 行为一致（非 storageState 注入，
//   每 test 重新登录，更隔离但慢；spec §3.7 [advisory] 优先 storageState，本 impl 取每 test 登录简化）。
// - API setup 用 page.request（Playwright APIRequestContext，HTTP 调用真实后端）创建 transfer/role setup 数据。
//
// E2E 凭据：admin@example.com / admin123（与 server.ts seedDemoData 一致非 PRD 字面 Admin@123，§7.2 反向同步）。
import type { APIRequestContext, Page } from '@playwright/test';

/** 后端 API 基址（与 client.ts BASE_URL 一致，跨域 fetch CORS 已启用）。 */
const API_BASE = 'http://localhost:3000';

/** E2E 登录凭据（server.ts seedDemoData 实际值）。 */
export const ADMIN_EMAIL = 'admin@example.com';
export const ADMIN_PASSWORD = 'admin123';

/**
 * 真实浏览器登录：导航 /login → 填表 → 提交 → 断言跳 /users（AC-E1 等价路径）。
 * 用于所有需要登录态的 E2E test（除 logout 外的 test 在 beforeEach 调用）。
 * 返回 admin token（从 localStorage 读，便于后续 API setup 调用）。
 */
export async function loginAsAdmin(page: Page): Promise<string> {
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(ADMIN_EMAIL);
  await page.getByLabel('密码').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  // 等 URL 跳转到 /users（RouteGuard 验证登录后跳 /users）
  await page.waitForURL('**/users', { timeout: 15000 });
  // 从 localStorage 读 admin token（tokenStore.ts key=admin_token，存 {token, expires_at}）
  const token = await page.evaluate(() => {
    const raw = window.localStorage.getItem('admin_token');
    if (!raw) return null;
    try {
      return (JSON.parse(raw) as { token: string }).token;
    } catch {
      return null;
    }
  });
  if (!token) throw new Error('登录后未在 localStorage 找到 admin_token');
  return token;
}

/**
 * 用 API 创建用户（setup 用，非 UI 验证）。
 * @param request Playwright APIRequestContext
 * @param token admin token（Authorization: Bearer）
 * @param emailUnique 邮箱（须唯一，调用方传唯一值避免冲突）
 * @param password 可选密码（默认 'Password123'，>=8 字符满足 schema）
 * @returns 创建的 User（含 id）
 */
export async function apiCreateUser(
  request: APIRequestContext,
  token: string,
  email: string,
  password = 'Password123',
): Promise<{ id: string; email: string; name: string }> {
  const res = await request.post(`${API_BASE}/v1/users`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { email, name: email.split('@')[0], password },
  });
  if (!res.ok()) {
    throw new Error(`apiCreateUser failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as { id: string; email: string; name: string };
}

/**
 * 用 API 创建角色（setup 用）。
 * @param request Playwright APIRequestContext
 * @param token admin token
 * @param name 角色名（须唯一）
 * @returns 创建的 Role（含 id, version）
 */
export async function apiCreateRole(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<{ id: string; name: string; version: number }> {
  const res = await request.post(`${API_BASE}/v1/roles`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, description: `E2E setup role: ${name}`, permission_codes: [] },
  });
  if (!res.ok()) {
    throw new Error(`apiCreateRole failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as { id: string; name: string; version: number };
}

/**
 * 用 API 创建部门（setup 用）。
 * @param request Playwright APIRequestContext
 * @param token admin token
 * @param name 部门名（须唯一）
 * @returns 创建的 Department（含 id）
 */
export async function apiCreateDepartment(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const res = await request.post(`${API_BASE}/v1/departments`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  if (!res.ok()) {
    throw new Error(`apiCreateDepartment failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as { id: string; name: string };
}

/**
 * 用 API 为用户分配角色（setup 用）。
 * POST /v1/users/:userId/roles/:roleId（path 参数，body 空）。
 */
export async function apiAssignRole(
  request: APIRequestContext,
  token: string,
  userId: string,
  roleId: string,
): Promise<void> {
  const res = await request.post(`${API_BASE}/v1/users/${userId}/roles/${roleId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok() && res.status() !== 204) {
    throw new Error(`apiAssignRole failed: ${res.status()} ${await res.text()}`);
  }
}

/**
 * 用 API 登录获取 token（setup 用，不通过 UI）。
 * 用于 setup 阶段创建数据（无需 page 上下文）。
 */
export async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_BASE}/v1/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`apiLogin failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { token: string };
  return body.token;
}

/**
 * 生成唯一字符串（用于邮箱/角色名/部门名后缀避免冲突）。
 * 格式：`e2e-<ts>-<rand>`，确保同一 run 多次创建不冲突。
 */
export function uniqueSuffix(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
