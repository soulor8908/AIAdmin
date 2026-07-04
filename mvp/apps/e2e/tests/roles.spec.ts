// apps/e2e/tests/roles.spec.ts —— AC-E5/E6/E7/E8 角色操作流（TECH-E2E-INTRODUCTION-001 §3.7）
//
// 覆盖 PRD AC-E5/E6/E7/E8：
//   AC-E5 · 角色列表渲染：已登录导航 /roles → 列表渲染
//   AC-E6 · 创建角色：提交创建角色表单 → 列表新增该角色
//   AC-E7 · 设置父角色（versioned If-Match）：存在角色 A、B → B 父角色设为 A → 请求携 If-Match
//   AC-E8 · 删除角色：触发删除 → 列表中消失
//
// versioned If-Match round-trip 验证（AC-E7）：page.route 拦截 POST /v1/roles/:roleId/parent，
// 断言 if-match header 存在（§3.7 关键验收点）。
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  ADMIN_EMAIL,
  apiCreateRole,
  loginAsAdmin,
  uniqueSuffix,
} from './_helpers.js';

// Admin 角色在列表中可见（seedAdmin 内置 admin 角色）。
const ADMIN_ROLE_NAME = 'admin';

test.describe('角色操作流', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await loginAsAdmin(page);
  });

  test('AC-E5 · 角色列表渲染', async ({ page }: { page: Page }) => {
    await page.goto('/roles');
    // 等待列表加载完成（表格出现）。
    await expect(page.locator('table')).toBeVisible();
    // 列表至少含 seed admin 内置角色。
    await expect(page.locator('table')).toContainText(ADMIN_ROLE_NAME);
  });

  test('AC-E6 · 创建角色 → 列表新增该角色', async ({ page }: { page: Page }) => {
    await page.goto('/roles');
    await expect(page.locator('table')).toBeVisible();

    // 触发创建角色表单。
    await page.getByRole('button', { name: '创建角色' }).click();
    // RoleForm 有 h2 "创建角色"。
    const form = page.locator('form', { hasText: '创建角色' });
    await expect(form).toBeVisible();

    // 填合法数据（name + description，permission_codes 可空）。
    const roleName = `E2E角色-${uniqueSuffix()}`;
    await form.getByLabel('名称').fill(roleName);
    await form.getByLabel('描述').fill('E2E 测试创建的角色');
    await form.getByRole('button', { name: '创建' }).click();

    // 表单关闭 + 列表刷新含新角色。
    await expect(form).not.toBeVisible();
    await expect(page.locator('table')).toContainText(roleName, { timeout: 15000 });
  });

  test('AC-E7 · 设置父角色 versioned If-Match round-trip', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // 用 API 创建两个测试角色 A、B（避免依赖 UI 创建的状态耦合）。
    const token = await getToken(page);
    const roleA = await apiCreateRole(request, token, `E2E父A-${uniqueSuffix()}`);
    const roleB = await apiCreateRole(request, token, `E2E子B-${uniqueSuffix()}`);

    await page.goto('/roles');
    await expect(page.locator('table')).toBeVisible();
    // 确保 roleB 在列表可见。
    await expect(page.locator('table')).toContainText(roleB.name, { timeout: 15000 });

    // 注册 page.route 拦截 POST /v1/roles/:roleId/parent，断言 If-Match header 存在。
    let capturedIfMatch: string | null = null;
    await page.route('**/v1/roles/*/parent', async (route) => {
      const req = route.request();
      capturedIfMatch = req.headers()['if-match'] ?? null;
      await route.continue();
    });

    // 找到 roleB 行的"设置父角色"按钮。
    const roleBRow = page.locator('tr', { hasText: roleB.name });
    await roleBRow.getByRole('button', { name: '设置父角色' }).click();

    // SetParentModal select aria-label="父角色"。
    const parentSelect = page.getByLabel('父角色');
    await expect(parentSelect).toBeVisible();
    // 选 roleA 作为父角色。
    await parentSelect.selectOption(roleA.id);
    await page.getByRole('button', { name: '提交' }).click();

    // 等待请求完成（设置成功后 modal 关闭 + 列表刷新）。
    await expect.poll(() => capturedIfMatch, { timeout: 15000 }).toBeTruthy();

    // 断言 If-Match header 存在（versioned 写操作端到端 round-trip 验证，§3.7 关键验收点）。
    expect(capturedIfMatch).toBeTruthy();
    expect(Number(capturedIfMatch)).toBeGreaterThanOrEqual(0);

    // 父子关系建立：modal 关闭（设置成功）。
    await expect(parentSelect).not.toBeVisible({ timeout: 15000 });
  });

  test('AC-E8 · 删除角色 → 列表中消失', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // 用 API 创建一个可删除角色。
    const token = await getToken(page);
    const role = await apiCreateRole(request, token, `E2E删除-${uniqueSuffix()}`);

    await page.goto('/roles');
    await expect(page.locator('table')).toBeVisible();
    // 确保角色在列表可见。
    await expect(page.locator('table')).toContainText(role.name, { timeout: 15000 });

    // 找到该角色行的"删除"按钮并点击。
    const roleRow = page.locator('tr', { hasText: role.name });
    await roleRow.getByRole('button', { name: '删除' }).click();

    // 列表刷新后该角色消失（真实后端删除持久化）。
    await expect(page.locator('table')).not.toContainText(role.name, { timeout: 15000 });
  });
});

/** 从 localStorage 读 admin token（beforeEach loginAsAdmin 已写入）。 */
async function getToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = window.localStorage.getItem('admin_token');
    if (!raw) return null;
    try {
      return (JSON.parse(raw) as { token: string }).token;
    } catch {
      return null;
    }
  });
  if (!token) throw new Error('未在 localStorage 找到 admin_token');
  return token;
}

// ADMIN_EMAIL 在 _helpers.ts 导出，本文件引入仅为断言 AC-E5 含 seed admin 角色名（非登录用）。
void ADMIN_EMAIL;
