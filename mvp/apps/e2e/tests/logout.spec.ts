// apps/e2e/tests/logout.spec.ts —— AC-E12/E13/E14 登出流（TECH-E2E-INTRODUCTION-001 §3.7）
//
// 覆盖 PRD AC-E12/E13/E14：
//   AC-E12 · 登出跳转：已登录点击登出 → URL 跳转至 /login
//   AC-E13 · token 清除：登出后 localStorage/sessionStorage 无 token 残留
//   AC-E14 · 登出后受保护路由守卫：直接访问 /users → 重定向回 /login，不展示 /users 内容
//
// token 清除验证（AC-E13）：page.evaluate 读 localStorage admin_token，断言 null。
// 路由守卫验证（AC-E14）：登出后 page.goto('/users') → RouteGuard 重定向 /login。
import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin } from './_helpers.js';

test.describe('登出流', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    // 每 test 重新登录（登出 test 须从登录态开始）。
    await loginAsAdmin(page);
  });

  test('AC-E12 · 登出跳转 /login', async ({ page }: { page: Page }) => {
    // 确保在 /users（登录后默认跳 /users）。
    await expect(page).toHaveURL(/\/users$/);

    // 点击"登出"按钮（UserListPage header 内）。
    await page.getByRole('button', { name: '登出' }).click();

    // URL 跳转至 /login（AuthContext.logout → navigate('/login')）。
    await expect(page).toHaveURL(/\/login$/);
  });

  test('AC-E13 · token 清除（localStorage 无残留）', async ({ page }: { page: Page }) => {
    // 确认登录态有 token（前置条件）。
    const tokenBefore = await page.evaluate(() => window.localStorage.getItem('admin_token'));
    expect(tokenBefore).toBeTruthy();

    // 点击"登出"。
    await page.getByRole('button', { name: '登出' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // 登出后 localStorage admin_token 应为 null（AuthContext.logout → tokenStore.clear）。
    const tokenAfter = await page.evaluate(() => window.localStorage.getItem('admin_token'));
    expect(tokenAfter).toBeNull();
  });

  test('AC-E14 · 登出后受保护路由守卫（直接访问 /users → 重定向 /login）', async ({
    page,
  }: {
    page: Page;
  }) => {
    // 先登出。
    await page.getByRole('button', { name: '登出' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // 直接访问 /users（无 token）。
    await page.goto('/users');

    // RouteGuard 检测无 token → 重定向 /login（AC-E14 关键验收点）。
    await expect(page).toHaveURL(/\/login$/);

    // 不展示 /users 受保护内容（"用户列表"标题不应出现）。
    await expect(page.getByRole('heading', { name: '用户列表' })).not.toBeVisible();
  });
});
