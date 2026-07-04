// apps/e2e/tests/login.spec.ts —— AC-E1 登录成功跳转（TECH-E2E-INTRODUCTION-001 §3.7）
//
// 覆盖 PRD AC-E1：
//   GIVEN 后端 webServer 已就绪且 seed admin 用户存在（admin@example.com / admin123）
//   WHEN 浏览器导航 /login，填写 admin@example.com / admin123 后提交登录
//   THEN 登录成功，页面 URL 跳转至 /users，客户端持有有效 token
//
// 凭据采用 server.ts seedDemoData 实际值 admin@example.com / admin123
// （非 PRD AC-E1 字面 Admin@123，§7.2 反向同步——BA 笔误）。
import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './_helpers.js';

test.describe('AC-E1 登录流', () => {
  test('AC-E1 · 登录成功跳转 /users + token 持久', async ({ page }) => {
    // GIVEN：webServer 已就绪（playwright.config.ts webServer 自动管理），seed admin 已存在。
    // WHEN：导航 /login → 填表 → 提交。
    await page.goto('/login');
    await page.getByLabel('邮箱').fill(ADMIN_EMAIL);
    await page.getByLabel('密码').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录' }).click();

    // THEN：URL 跳转至 /users（RouteGuard 验证登录后跳 /users）。
    await expect(page).toHaveURL(/\/users$/);

    // THEN：localStorage 持有 admin_token（tokenStore.ts key=admin_token，存 {token, expires_at}）。
    const token = await page.evaluate(() => {
      const raw = window.localStorage.getItem('admin_token');
      if (!raw) return null;
      try {
        return (JSON.parse(raw) as { token: string; expires_at?: string }).token;
      } catch {
        return null;
      }
    });
    expect(token).toBeTruthy();
  });
});
