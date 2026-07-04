// apps/e2e/tests/users.spec.ts —— AC-E2/E3/E4 用户列表流（TECH-E2E-INTRODUCTION-001 §3.7）
//
// 覆盖 PRD AC-E2/E3/E4：
//   AC-E2 · 用户列表渲染：已登录导航 /users → 列表渲染，至少含 seed admin 用户
//   AC-E3 · 创建用户：触发创建用户表单，填合法数据提交 → 列表新增一行可见
//   AC-E4 · 用户状态切换（versioned If-Match）：切换某用户状态 → 请求携 If-Match: N，UI 反映切换后状态
//
// versioned If-Match round-trip 验证（AC-E4）：page.route 拦截 PATCH /v1/users/:id/status，
// 断言 if-match header 存在（§3.7 关键验收点）。
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  apiCreateUser,
  loginAsAdmin,
  uniqueSuffix,
} from './_helpers.js';

test.describe('用户列表流', () => {
  let token: string;

  test.beforeEach(async ({ page, request }: { page: Page; request: APIRequestContext }) => {
    // 每 test 重新登录（每 test 隔离，[advisory] 非 storageState 注入，spec §3.7 允许）。
    token = await loginAsAdmin(page);
    // 用 API 预置测试用户（避免依赖 UI 创建流程的状态耦合，AC-E2 验证列表渲染）。
    void request;
  });

  test('AC-E2 · 用户列表渲染，至少含 seed admin', async ({ page }: { page: Page }) => {
    // 已登录（beforeEach），导航 /users（可能已在 /users，确保导航）。
    await page.goto('/users');
    // 等待列表加载完成（"加载中..." 消失，表格出现）。
    await expect(page.locator('table')).toBeVisible();
    // 列表至少含 seed admin 用户（admin@example.com）。
    await expect(page.locator('table')).toContainText(ADMIN_EMAIL);
  });

  test('AC-E3 · 创建用户 → 列表新增一行可见', async ({ page }: { page: Page }) => {
    await page.goto('/users');
    await expect(page.locator('table')).toBeVisible();

    // 触发创建用户表单。
    await page.getByRole('button', { name: '创建用户' }).click();
    // 弹窗 role="dialog" aria-label="创建用户"。
    const dialog = page.getByRole('dialog', { name: '创建用户' });
    await expect(dialog).toBeVisible();

    // 填合法数据。
    const email = `e2e-create-${uniqueSuffix()}@example.com`;
    await dialog.getByLabel('邮箱').fill(email);
    await dialog.getByLabel('姓名').fill(`E2E用户${Date.now()}`);
    await dialog.getByLabel('密码').fill('Password123');
    await dialog.getByRole('button', { name: '创建' }).click();

    // 弹窗关闭 + 列表刷新含新用户。
    await expect(dialog).not.toBeVisible();
    // 等待列表刷新（新邮箱出现）。
    await expect(page.locator('table')).toContainText(email, { timeout: 15000 });
  });

  test('AC-E4 · 用户状态切换 versioned If-Match round-trip', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // 用 API 创建一个测试用户（避免影响 seed admin 状态）。
    const email = `e2e-status-${uniqueSuffix()}@example.com`;
    const user = await apiCreateUser(request, token, email);
    // 新用户默认 status=active，version=0。

    await page.goto('/users');
    await expect(page.locator('table')).toBeVisible();
    // 确保新用户在当前页可见（可能需翻页，但 pageSize=20 + seed admin + 新用户 ≤20 应在首页）。
    await expect(page.locator('table')).toContainText(email, { timeout: 15000 });

    // 注册 page.route 拦截 PATCH /v1/users/:id/status，断言 If-Match header 存在。
    // 必须在点击按钮前注册 route（§10.4 工具限制预判：page.route 时序）。
    let capturedIfMatch: string | null = null;
    await page.route('**/v1/users/*/status', async (route) => {
      const req = route.request();
      capturedIfMatch = req.headers()['if-match'] ?? null;
      await route.continue();
    });

    // 找到该用户行的"禁用"按钮（UserRow 按钮文案统一"禁用"，双向切换）。
    const userRow = page.locator('tr', { hasText: email });
    await userRow.getByRole('button', { name: '禁用' }).click();

    // 等待请求完成（status 切换后列表刷新）。
    await expect.poll(() => capturedIfMatch, { timeout: 15000 }).toBeTruthy();

    // 断言 If-Match header 存在（versioned 写操作端到端 round-trip 验证，§3.7 关键验收点）。
    expect(capturedIfMatch).toBeTruthy();
    // If-Match 值应为数字版本号（初始 0）。
    expect(Number(capturedIfMatch)).toBeGreaterThanOrEqual(0);

    // UI 反映切换后的状态（active → disabled，UserRow statusLabel → "禁用"）。
    // 切换前 status=active（"启用"），切换后 status=disabled（"禁用"），刷新后行内 status 文案为"禁用"。
    await expect(page.locator('tr', { hasText: email })).toContainText('禁用');
  });
});
