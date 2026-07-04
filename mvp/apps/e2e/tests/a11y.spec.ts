// apps/e2e/tests/a11y.spec.ts —— R23 AC-A11y-8/9 @axe-core/playwright E2E 可访问性扫描
// （TECH-ACCESSIBILITY-DEEPENING-001 §4.8/§4.9 / D9 / D10）
//
// 覆盖 AC：
//   AC-A11y-8 · @axe-core/playwright E2E 集成 + 关键流 0 violations（8 页 axe 扫描）
//   AC-A11y-9 · WCAG AA 色彩对比核验（color-contrast 规则由 E2E 独占覆盖，jest-axe jsdom 不支持）
//
// 设计说明（D9）：
//   - 每 test 显式 `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()`（非全局 afterEach）。
//   - withTags(['wcag2a', 'wcag2aa']) 限定 WCAG 2.1 Level A/AA 规则集（含 color-contrast，D10）。
//   - 真实 chromium 浏览器渲染，覆盖 color-contrast（jest-axe jsdom 不支持，§3.10）+ 渲染时 violation。
//   - 新增独立 a11y.spec.ts（8 页 axe 扫描），既有 5 spec 不改（保持 14 E2E 既有断言零回归，AC-A11y-11）。
//   - 8 页：LoginPage / UserListPage / RoleListPage / TransferPage / AuditLogPage / DeptTreePage / ReportPage / NotificationListPage。
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './_helpers.js';

/** WCAG 2.1 A/AA 规则集 axe 扫描，断言 0 violations（D9/D10）。 */
async function assertNoA11yViolations(page: import('@playwright/test').Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
}

test.describe('R23 AC-A11y-8/9 @axe-core/playwright E2E 可访问性扫描', () => {
  // ---------- 未认证页面（LoginPage 无须登录）----------
  test.describe('未认证页面 axe 扫描', () => {
    test('LoginPage 应无 WCAG 2.1 AA 违规（AC-A11y-8/9）', async ({ page }) => {
      await page.goto('/login');
      // 等待登录表单渲染（避免扫描 Suspense fallback "加载中..."）
      await page.getByLabel('邮箱').waitFor({ state: 'visible' });
      await assertNoA11yViolations(page);
    });
  });

  // ---------- 认证页面（7 页须登录后扫描）----------
  test.describe('认证页面 axe 扫描', () => {
    test.beforeEach(async ({ page }) => {
      // 每 test 重新登录（每 test 隔离，[advisory] 非 storageState 注入，spec §3.7 允许）。
      await loginAsAdmin(page);
    });

    test('UserListPage 应无 WCAG 2.1 AA 违规（AC-A11y-8/9）', async ({ page }) => {
      await page.goto('/users');
      // 等待用户列表加载完成（表格渲染，避免扫描 loading 态）
      await page.locator('table').waitFor({ state: 'visible' });
      await assertNoA11yViolations(page);
    });

    test('RoleListPage 应无 WCAG 2.1 AA 违规（AC-A11y-8/9）', async ({ page }) => {
      await page.goto('/roles');
      // 等待角色列表加载完成（创建角色按钮可见，列表已渲染）
      await page.getByRole('button', { name: '创建角色' }).waitFor({ state: 'visible' });
      await assertNoA11yViolations(page);
    });

    test('TransferPage 应无 WCAG 2.1 AA 违规（AC-A11y-8/9）', async ({ page }) => {
      await page.goto('/transfer');
      // 等待调岗表单渲染（用户 ID 输入框可见）
      await page.getByLabel('用户 ID').waitFor({ state: 'visible' });
      await assertNoA11yViolations(page);
    });

    test('AuditLogPage 应无 WCAG 2.1 AA 违规（AC-A11y-8/9）', async ({ page }) => {
      await page.goto('/audit-logs');
      // 等待审计日志页渲染（实体类型筛选可见）
      await page.getByLabel('实体类型').first().waitFor({ state: 'visible' });
      await assertNoA11yViolations(page);
    });

    test('DeptTreePage 应无 WCAG 2.1 AA 违规（AC-A11y-8/9）', async ({ page }) => {
      await page.goto('/departments');
      // 等待部门树渲染（页面标题可见，避免扫描 loading 态）
      await page.getByRole('heading', { name: '部门树' }).waitFor({ state: 'visible' });
      await assertNoA11yViolations(page);
    });

    test('ReportPage 应无 WCAG 2.1 AA 违规（AC-A11y-8/9）', async ({ page }) => {
      await page.goto('/reports');
      // 等待报表页渲染（networkidle 等待 API 调用完成 + 组件渲染）
      await page.waitForLoadState('networkidle');
      await assertNoA11yViolations(page);
    });

    test('NotificationListPage 应无 WCAG 2.1 AA 违规（AC-A11y-8/9）', async ({ page }) => {
      await page.goto('/notifications');
      // 等待通知列表渲染（状态筛选可见）
      await page.getByLabel('状态').first().waitFor({ state: 'visible' });
      await assertNoA11yViolations(page);
    });
  });
});
