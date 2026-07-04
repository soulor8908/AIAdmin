// apps/e2e/tests/transfer.spec.ts —— AC-E9/E10/E11 调岗流（TECH-E2E-INTRODUCTION-001 §3.7）
//
// 覆盖 PRD AC-E9/E10/E11：
//   AC-E9 · 调岗表单渲染：已登录导航 /transfer → 表单渲染（含用户 ID、目标部门、原角色、新角色字段）
//   AC-E10 · 提交调岗：填合法数据 → 提交 → 响应 2xx（page.route 拦截断言非 4xx/5xx）
//   AC-E11 · 调岗成功确认：页面展示成功反馈 + 导航 /users 复核目标用户 department 已更新
//
// 调岗入参：{ userId, toDepartmentId, oldRoleId, newRoleId }（transferInputSchema，oldRoleId !== newRoleId）。
// AC-E10 page.route 拦截 POST /v1/users/:userId/transfer 断言响应非 4xx/5xx。
// AC-E11 调岗成功 → TransferPage 显示"调岗成功" + API GET /v1/users/:id 复核 department_id 已更新。
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  apiAssignRole,
  apiCreateDepartment,
  apiCreateRole,
  apiCreateUser,
  loginAsAdmin,
  uniqueSuffix,
} from './_helpers.js';

/** 后端 API 基址（与 _helpers.ts API_BASE 一致）。 */
const API_BASE = 'http://localhost:3000';

test.describe('调岗流', () => {
  let token: string;

  test.beforeEach(async ({ page }: { page: Page }) => {
    token = await loginAsAdmin(page);
  });

  test('AC-E9 · 调岗表单渲染（含用户 ID / 目标部门 / 原角色 / 新角色字段）', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto('/transfer');
    // TransferPage h1 "调岗管理"。
    await expect(page.getByRole('heading', { name: '调岗管理' })).toBeVisible();
    // TransferForm 4 字段（aria-label 域特定，D18）。
    await expect(page.getByLabel('用户 ID')).toBeVisible();
    await expect(page.getByLabel('目标部门')).toBeVisible();
    await expect(page.getByLabel('原角色')).toBeVisible();
    await expect(page.getByLabel('新角色')).toBeVisible();
    // 提交按钮 aria-label="提交调岗"。
    await expect(page.getByLabel('提交调岗')).toBeVisible();
  });

  test('AC-E10 · 提交调岗 → 响应 2xx（无 4xx/5xx）', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // ---- setup：用 API 创建调岗所需数据 ----
    // 1. 创建用户（默认无部门、无角色）
    const email = `e2e-transfer-${uniqueSuffix()}@example.com`;
    const user = await apiCreateUser(request, token, email);
    // 2. 创建原角色 oldRole + 新角色 newRole（oldRoleId !== newRoleId）
    const oldRole = await apiCreateRole(request, token, `E2E原角色-${uniqueSuffix()}`);
    const newRole = await apiCreateRole(request, token, `E2E新角色-${uniqueSuffix()}`);
    // 3. 创建目标部门
    const dept = await apiCreateDepartment(request, token, `E2E目标部门-${uniqueSuffix()}`);
    // 4. 为用户分配原角色 oldRole（调岗前须持有 oldRole，否则 TRANSFER_OLD_ROLE_NOT_ASSIGNED）
    await apiAssignRole(request, token, user.id, oldRole.id);

    // ---- E2E：导航 /transfer 填表提交 ----
    await page.goto('/transfer');
    await expect(page.getByLabel('用户 ID')).toBeVisible();

    // 注册 page.route 拦截 POST /v1/users/:userId/transfer，断言响应非 4xx/5xx。
    let responseStatus: number | null = null;
    await page.route('**/v1/users/*/transfer', async (route) => {
      const response = await route.fetch();
      responseStatus = response.status();
      await route.fulfill({ response });
    });

    // 填表：userId（自由文本）+ toDepartmentId（select）+ oldRoleId（select）+ newRoleId（select）。
    await page.getByLabel('用户 ID').fill(user.id);
    await page.getByLabel('目标部门').selectOption(dept.id);
    await page.getByLabel('原角色').selectOption(oldRole.id);
    await page.getByLabel('新角色').selectOption(newRole.id);
    await page.getByLabel('提交调岗').click();

    // 等待请求完成（responseStatus 被赋值）。
    await expect.poll(() => responseStatus, { timeout: 15000 }).not.toBeNull();

    // 断言响应非 4xx/5xx（AC-E10 关键验收点：请求成功无错误响应）。
    expect(responseStatus!).toBeGreaterThanOrEqual(200);
    expect(responseStatus!).toBeLessThan(400);
  });

  test('AC-E11 · 调岗成功 → 页面成功反馈 + 用户 department 已更新', async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // ---- setup：同 AC-E10 ----
    const email = `e2e-confirm-${uniqueSuffix()}@example.com`;
    const user = await apiCreateUser(request, token, email);
    const oldRole = await apiCreateRole(request, token, `E2E确认原-${uniqueSuffix()}`);
    const newRole = await apiCreateRole(request, token, `E2E确认新-${uniqueSuffix()}`);
    const dept = await apiCreateDepartment(request, token, `E2E确认部门-${uniqueSuffix()}`);
    await apiAssignRole(request, token, user.id, oldRole.id);

    // ---- E2E：提交调岗 ----
    await page.goto('/transfer');
    await page.getByLabel('用户 ID').fill(user.id);
    await page.getByLabel('目标部门').selectOption(dept.id);
    await page.getByLabel('原角色').selectOption(oldRole.id);
    await page.getByLabel('新角色').selectOption(newRole.id);
    await page.getByLabel('提交调岗').click();

    // AC-E11：页面展示成功反馈（TransferPage 显示"调岗成功"）。
    await expect(page.getByText('调岗成功')).toBeVisible({ timeout: 15000 });

    // AC-E11：调岗结果持久——API GET /v1/users/:id 复核目标用户 department_id 已更新。
    const detailRes = await request.get(`${API_BASE}/v1/users/${user.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(detailRes.ok()).toBeTruthy();
    const detail = (await detailRes.json()) as { department_id: string | null };
    // department_id 应为目标部门 id（调岗后归属已更新）。
    expect(detail.department_id).toBe(dept.id);
  });
});
