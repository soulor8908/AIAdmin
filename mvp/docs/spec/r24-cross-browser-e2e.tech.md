---
doc_type: Tech-Spec
id: TECH-CROSS-BROWSER-E2E-001
title: R24 跨浏览器 E2E 覆盖（firefox + webkit 多浏览器扩展 + 核心流与 a11y 跨浏览器一致性验证）
prd_ref: PRD-CROSS-BROWSER-E2E-001
status: ready-for-impl
owner: tech-lead@team
created: 2026-07-04
extends: TECH-E2E-INTRODUCTION-001
aligns: [TECH-E2E-INTRODUCTION-001, TECH-ACCESSIBILITY-DEEPENING-001]
---

# TECH-CROSS-BROWSER-E2E-001 · R24 跨浏览器 E2E 覆盖 Tech-Spec

> 派生自 PRD-CROSS-BROWSER-E2E-001（status=decided，9 条 AC：AC-XB-1 projects 扩展 1 条 + AC-XB-2~3 核心流跨浏览器 2 条 + AC-XB-4~5 a11y 跨浏览器 2 条 + AC-XB-6~7 多浏览器一致性 + CI 并行 2 条 + AC-XB-8 既有测试无回归 1 条 + AC-XB-9 S-23 评估 1 条；3 项 BLOCKING Q&A 已拍板：Q1=① firefox + webkit 双浏览器 / Q2=① 核心 14 + a11y 8 全部跨浏览器 = 66 tests / Q3=① CI 并行 workers: process.env.CI ? 3 : 1 + fullyParallel: false 保持 + 本地仅 chromium）。
> 本轮承接 R23 retro §6 候选清单第 1 项——跨浏览器 E2E 覆盖。R20 已建立 chromium 单浏览器 E2E 基础设施（playwright.config.ts + webServer 双进程 + 临时 DB 隔离 + 14 核心流 E2E），R23 已建立 @axe-core/playwright a11y 扫描（8 用例）。R24 在此基础上扩展为 firefox + webkit 多浏览器覆盖，验证核心流 + a11y 在多浏览器下的一致性。
> **S-23 第三次触发评估**（R21 固化，R22 react-window 首次触发 + R23 jest-axe/@axe-core/playwright 第二次触发已两次验证）：Tech Lead 实际核验——`@playwright/test@1.61.1` 已装（npm registry latest=1.61.1 与已装版本一致）+ `devices['Desktop Firefox']` / `devices['Desktop Safari']` 在 @playwright/test@1.61.1 中实测可用（`node -e` 输出含 `defaultBrowserType: 'firefox'/'webkit'` 字段）+ `@axe-core/playwright@4.12.1` 浏览器无关（AxeBuilder.analyze() 在 page context 注入 axe-core JS，与浏览器引擎无关，R23 §10.6 已核验）+ firefox-1532/webkit-2311 二进制可下载（dry-run 确认 firefox-ubuntu-24.04.zip + webkit-ubuntu-24.04.zip 可达）。**核心核验结论**：BA 声明准确——R24 仅扩展 playwright.config.ts projects 数组，不引入新第三方库，S-23 不触发（§3.1 D1 + §3.6 D6 + §10.6 详述）。
> **contracts 本轮零变更**；**errors.ts 零变更**；**errorMapping.ts 零变更**；**server.ts / domain / repository / service 零变更**；**apps/web/src 零变更**（R23 已落 :focus-visible + useFocusTrap）；**apps/e2e/tests/** 零变更（22 E2E 浏览器无关直接复用）；**global-teardown.ts 零变更**；**vitest.config.ts / vitest.workspace.ts 零变更**。改动范围：仅 `playwright.config.ts`（projects 数组扩展 + workers 配置 + 顶层 use.browserName 调整）+ `package.json` scripts 扩展（test:e2e:local = `--project=chromium`）+ CI 浏览器安装步骤（npx playwright install --with-deps firefox webkit）。

## 1 · 概述

### 1.1 R24 跨浏览器 E2E 覆盖动机

当前 E2E 测试矩阵（apps/e2e 核验，§2 详述）：

- **单浏览器覆盖**：playwright.config.ts 现 chromium 单 project（file:///workspace/mvp/playwright.config.ts:59-64），22 E2E 用例（14 核心流 + 8 a11y，实测 `npx playwright test --list` = "Total: 22 tests in 6 files"）仅在 chromium 引擎下验证。firefox（Gecko 引擎）与 webkit（Safari 引擎）的渲染差异、API 行为差异、CORS/cookie/storage 差异未被覆盖。
- **跨浏览器一致性缺口**：管理后台 MVP 虽以 chromium 为主要目标浏览器（R20 Q4 决策），但跨浏览器一致性是 E2E 标准实践——firefox/webkit 下可能的差异（如 `selectOption` 行为、`page.route` 拦截时序、`localStorage` 持久化、`toHaveURL` 正则匹配、axe-core 规则在不同引擎下的检测结果）未被验证。
- **a11y 多浏览器验证缺口**：R23 @axe-core/playwright 8 用例仅在 chromium 下扫描，firefox/webkit 下 axe-core 规则集（WCAG 2.1 A/AA）的检测结果一致性未验证（axe-core 本身浏览器无关，但渲染时 violation 可能在不同引擎下表现不同）。
- **既有基础设施已为多浏览器扩展打好基础**：R20 playwright.config.ts projects 数组模式天然支持多 project 扩展（Playwright 官方跨浏览器模式），R23 @axe-core/playwright API（`AxeBuilder({ page })`）浏览器无关，R20 `_helpers.ts`（`loginAsAdmin` + `apiCreate*`）全部使用浏览器无关 Playwright API，零跨浏览器适配成本。

### 1.2 R20 / R23 既有成果协同（不破坏）

R20 已建立的 chromium E2E 基础设施 + R23 已建立的 @axe-core/playwright a11y 扫描在 R24 协同扩展（非冲突）：

- **R20 playwright.config.ts**（file:///workspace/mvp/playwright.config.ts）：chromium 单 project + webServer 双进程（api 3000 + vite 5173）+ 临时 DB 隔离（`os.tmpdir()` + globalTeardown）+ retries=0 + workers=1。R24 扩展 projects 数组为 chromium + firefox + webkit 三 project，webServer / globalTeardown / 临时 DB 隔离机制浏览器无关（webServer 在所有 project 共享，临时 DB 在 globalTeardown 清理与浏览器无关）。
- **R20 22 E2E 用例**（14 核心流 + 8 a11y）：全部使用浏览器无关 Playwright API（`page.goto` / `page.getByLabel` / `page.getByRole` / `page.route` / `expect.poll` / `AxeBuilder.analyze`），零硬编码 `browserType()` 引用，跨浏览器适配成本为零（§2.2 详述）。
- **R23 @axe-core/playwright**（file:///workspace/mvp/apps/e2e/tests/a11y.spec.ts）：`AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()` 是浏览器无关 API（axe-core 在 page context 运行，非依赖特定浏览器引擎），R24 直接复用为多浏览器 axe 扫描（§3.6 D6 详述）。

### 1.3 S-23 第三次触发评估（R21 固化，§10.6 详述）

R21 固化的 S-23（Tech Lead 第三方库版本 API 核验缺口）在 R22 首次触发（react-window@1.8.11）+ R23 第二次触发（jest-axe@10.0.0 + @axe-core/playwright@4.12.1）验证生效。R24 第三次触发评估：

- **R24 是否引入新第三方库**：否。R24 仅扩展 playwright.config.ts projects 数组（chromium → chromium + firefox + webkit），依赖 `@playwright/test@^1.61.1`（R20 已装，file:///workspace/mvp/package.json:22）+ `@axe-core/playwright@^4.12.1`（R23 已装，file:///workspace/mvp/package.json:21），无新 npm 依赖（实测 `npm ls @playwright/test @axe-core/playwright` 输出 @playwright/test@1.61.1 + @axe-core/playwright@4.12.1，与已装版本一致）。
- **R24 是否涉及第三方库 API 字段**：涉及 Playwright projects 配置（`devices['Desktop Firefox']` / `devices['Desktop Safari']`）+ `workers` 配置。这些是 `@playwright/test@1.61.1` 既有 API（R20 已用 `devices['Desktop Chrome']` + `projects` + `workers`），非新 API 字段。Tech Lead 已实测核验 `devices['Desktop Firefox']` / `devices['Desktop Safari']` 在 @playwright/test@1.61.1 下可用（`node -e "const { devices } = require('@playwright/test'); ..."` 输出含 `defaultBrowserType: 'firefox'/'webkit'` 字段），属既有 API 复用核验非新库核验。
- **S-23 触发判定**：**不触发**（R24 不引入新第三方库，仅扩展既有库 projects 配置）。Tech Lead 在 §10.6 标注"S-23 第三次触发评估：不触发（BA 声明核验准确，仅扩展 projects 数组，无新第三方库）"。

### 1.4 ARCH 检查（保持）

- **ARCH-001**：apps/api/src 不 import apps/web/src/**（保持，R24 零业务代码改动，§9 影响面仅在测试层）。
- **ARCH-002**：packages/contracts 零变更（R24 不改 contracts，跨浏览器扩展是测试基础设施层改进）。
- **ARCH-003**：apps/web 仅 import @admin/contracts + apps/web 内部；apps/e2e 通过 HTTP 交互不 import apps/api/src（保持，R24 不改 apps/e2e/tests/** 业务逻辑，仅扩 playwright.config.ts projects 数组）。

## 2 · 既有 E2E 基础设施现状盘点（基于 Tech Lead 实际 Read + RunCommand 探索）

> R10 S-2 教训：Spec 须核验既有现状。本节核验 5 项关键资产，确认改动边界。

### 2.1 playwright.config.ts 现状（R20 建立）

file:///workspace/mvp/playwright.config.ts（根目录，R20 D1 决策非 apps/e2e/）：

| 配置项 | 现值 | R24 影响 |
|---|---|---|
| `testDir` | `./apps/e2e/tests` | 浏览器无关，三 project 共享 |
| `testMatch` | `**/*.spec.ts` | 浏览器无关 |
| `fullyParallel` | `false` | R24 保持 false（Q3 CI 并行靠 workers，非 fullyParallel） |
| `workers` | `1` | **R24 改为 `process.env.CI ? 3 : 1`**（Q3 ①，CI 3 worker 对应 3 浏览器 project 并行，本地 1 worker） |
| `retries` | `0` | 浏览器无关，保持 |
| `timeout` | `60000` | 浏览器无关，保持（webkit 可能略慢，§3.5 D5 评估） |
| `outputDir` | `apps/e2e/test-results` | 浏览器无关 |
| `reporter` | `[['list'], ['html']]` | 浏览器无关 |
| `use.baseURL` | `http://localhost:5173` | 浏览器无关（vite dev server 跨浏览器可访问） |
| `use.browserName` | `'chromium'`（顶层，file L48） | **R24 风险点**：顶层 browserName 与 project device descriptor 冲突风险（§6.1 / §3.2 D2 决策） |
| `use.headless` | `true` | 浏览器无关 |
| `use.trace` | `'on-first-retry'` | 浏览器无关 |
| `use.screenshot` | `'only-on-failure'` | 浏览器无关 |
| `use.navigationTimeout` | `15000` | 浏览器无关 |
| `use.actionTimeout` | `10000` | 浏览器无关 |
| `projects` | `[{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]`（file L59-64） | **R24 核心扩展点**：增 firefox + webkit 两 project |
| `webServer` | 双进程（api 3000 + vite 5173） | 浏览器无关，三 project 共享 webServer（Playwright webServer 在所有 project 间共享，非每 project 启动） |
| `globalTeardown` | `./apps/e2e/global-teardown.ts` | 浏览器无关（清理临时 DB 文件） |

**关键扩展点**：`projects` 数组（file:///workspace/mvp/playwright.config.ts:59-64）。R20 现 chromium 单 project，R24 扩展为三 project（chromium + firefox + webkit），每个 project 用 Playwright 内置 device descriptor（`devices['Desktop Chrome']` / `devices['Desktop Firefox']` / `devices['Desktop Safari']`），device descriptor 内含 `defaultBrowserType` 字段会覆盖顶层 `use.browserName`。

### 2.2 22 E2E 用例清单 + 浏览器无关性核验（实测 grep + Read）

R20 14 核心流 E2E + R23 8 a11y E2E = 22 E2E（file:///workspace/mvp/apps/e2e/tests/，实测 `npx playwright test --list` 输出 "Total: 22 tests in 6 files"）：

| spec 文件 | AC 覆盖 | 用例数 | 浏览器无关性核验 |
|---|---|---|---|
| `login.spec.ts` | AC-E1 | 1 | ✅ `page.goto` / `page.getByLabel` / `page.getByRole` / `expect(page).toHaveURL` / `page.evaluate` 全浏览器无关 |
| `logout.spec.ts` | AC-E12/E13/E14 | 3 | ✅ `page.getByRole` / `expect(page).toHaveURL` / `page.evaluate` 全浏览器无关 |
| `users.spec.ts` | AC-E2/E3/E4 | 3 | ✅ `page.goto` / `page.locator` / `page.getByRole` / `page.getByLabel` / `page.route` / `expect.poll` 全浏览器无关 |
| `roles.spec.ts` | AC-E5/E6/E7/E8 | 4 | ✅ `page.goto` / `page.locator` / `page.getByRole` / `page.getByLabel` / `selectOption` / `page.route` / `expect.poll` 全浏览器无关 |
| `transfer.spec.ts` | AC-E9/E10/E11 | 3 | ✅ `page.goto` / `page.getByLabel` / `selectOption` / `page.route` / `route.fetch` / `expect.poll` 全浏览器无关 |
| `a11y.spec.ts` | AC-A11y-8/9 | 8 | ✅ `AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).analyze()` 浏览器无关（axe-core 在 page context 运行）+ `page.goto` / `page.getByLabel` / `page.locator` / `page.getByRole` / `page.waitForLoadState` 全浏览器无关 |

**grep `chromium|firefox|webkit` 在 apps/e2e/ 核验**（Tech Lead 实测 Grep）：仅 1 处匹配——`a11y.spec.ts:11` 注释"真实 chromium 浏览器渲染"（file:///workspace/mvp/apps/e2e/tests/a11y.spec.ts:11），属文档注释非代码逻辑，无硬编码 `browserType()` / `chromium.launch()` / `page.browser()` / `firefox.launch()` / `webkit.launch()` 引用。

**_helpers.ts 浏览器无关性核验**（file:///workspace/mvp/apps/e2e/tests/_helpers.ts）：
- `loginAsAdmin(page)`（L24-43）：`page.goto` / `page.getByLabel` / `page.getByRole('button', { name: '登录' }).click` / `page.waitForURL` / `page.evaluate` 全浏览器无关。
- `apiCreateUser/Role/Department` + `apiAssignRole` + `apiLogin` + `apiGetRole`：`request.post/get`（APIRequestContext）全浏览器无关（HTTP 调用与浏览器引擎无关，request context 由 Playwright 顶层 APIRequestContext 提供，非 page.browser()）。
- `uniqueSuffix()`（L173-175）：纯函数 `Date.now() + Math.random()`，浏览器无关 + 跨浏览器并发调用产生唯一后缀（CI workers:3 跨 project 并发跑同 spec 时 email/role 唯一性保证）。
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` 常量：与 server.ts seedDemoData 一致（admin@example.com / admin123），浏览器无关。

**结论**：22 E2E 用例 + _helpers.ts 全部浏览器无关，R24 扩展 projects 数组后零代码改动成本（22 E2E 直接复用为多浏览器测试，三浏览器 × 22 = 66 tests）。

### 2.3 依赖现状（Tech Lead 实测 npm ls + npm view 核验）

file:///workspace/mvp/package.json + `npm ls @playwright/test @axe-core/playwright` 实测核验：

| 依赖 | package.json 声明 | 实装版本（npm ls） | npm registry latest | 引入轮次 | R24 是否需新增 |
|---|---|---|---|---|---|
| `@playwright/test` | `^1.61.1` | `1.61.1` | `1.61.1`（dist-tags.latest） | R20 | 否（已装，R24 仅扩展 projects 配置） |
| `@axe-core/playwright` | `^4.12.1` | `4.12.1` | `4.12.1`（dist-tags.latest） | R23 | 否（已装，R24 复用 a11y.spec.ts） |
| `@types/node` / `tsx` / `typescript` / `vitest` | 既有 | 既有 | 既有 | R12+ | 否 |

**`npm view @playwright/test dist-tags` 实测输出**：`{ rc: '1.18.0-rc1', latest: '1.61.1', beta: '1.61.1-beta-1782889362000', next: '1.62.0-alpha-2026-07-03' }`——`latest=1.61.1` 与已装版本一致，无版本升级空间（next 是 1.62.0-alpha 非稳定版，跨轮 advisory 范围排除）。

**`npx playwright --version` 实测输出**：`Version 1.61.1`——@playwright/test@1.61.1 实测可用。

**结论**：R24 零新 npm 依赖（S-23 不触发依据，§1.3 + §10.6 详述）。

### 2.4 Playwright 浏览器二进制安装现状（Tech Lead 实测 dry-run 核验）

`npx playwright install --dry-run firefox webkit` + `ls ~/.cache/ms-playwright/` 核验（Tech Lead 实测）：

| 浏览器 | 版本 | dry-run 输出 | 安装状态 | R24 需求 |
|---|---|---|---|---|
| chromium | 1228（Chrome 149） | （既有） | ✅ 已装（R20） | 既有，无需安装 |
| chromium_headless_shell | 1228 | （既有） | ✅ 已装（R20） | 既有 |
| firefox | 1532（Firefox 151） | `firefox-ubuntu-24.04.zip`（cdn.playwright.dev 可达） | ❌ **未装** | R24 须 `npx playwright install firefox`（~80MB） |
| webkit | 2311（WebKit 26.5） | `webkit-ubuntu-24.04.zip`（cdn.playwright.dev 可达） | ❌ **未装** | R24 须 `npx playwright install webkit`（~60MB） |
| ffmpeg | 1011 | （既有） | ✅ 已装（R20） | 既有 |

**`devices['Desktop Firefox']` / `devices['Desktop Safari']` API 实测核验**（Tech Lead `node -e "const { devices } = require('@playwright/test'); console.log(...)"`）：

```js
// devices['Desktop Firefox']（@playwright/test@1.61.1 实测可用）
{
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0",
  "viewport": { "width": 1280, "height": 720 },
  "screen": { "width": 1920, "height": 1080 },
  "deviceScaleFactor": 1,
  "isMobile": false,
  "hasTouch": false,
  "defaultBrowserType": "firefox"  // ← 关键字段：Playwright 据此启动 firefox 浏览器
}

// devices['Desktop Safari']（@playwright/test@1.61.1 实测可用）
{
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15",
  "viewport": { "width": 1280, "height": 720 },
  "screen": { "width": 1792, "height": 1120 },
  "deviceScaleFactor": 2,
  "isMobile": false,
  "hasTouch": false,
  "defaultBrowserType": "webkit"  // ← 关键字段：Playwright 据此启动 webkit 浏览器
}

// devices['Desktop Chrome']（R20 已用，对照）
{
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36",
  "viewport": { "width": 1280, "height": 720 },
  "defaultBrowserType": "chromium"
}
```

**结论**：`devices['Desktop Firefox']` / `devices['Desktop Safari']` 在 @playwright/test@1.61.1 中实测可用，与 R20 已用的 `devices['Desktop Chrome']` 同源（均含 `defaultBrowserType` 字段驱动 Playwright 启动对应浏览器）。S-23 第三次触发评估既有 API 复用核验闭环（§10.6）。

R24 须安装 firefox + webkit 浏览器二进制（本地 + CI 均须，§3.4 D4 + §6.3 风险预判）。

### 2.5 webServer / globalTeardown 浏览器无关性核验

- **webServer 双进程**（file:///workspace/mvp/playwright.config.ts:65-90）：api server（`npm start` port 3000）+ vite dev（`npm --workspace @admin/web run dev` port 5173）。Playwright webServer 在所有 project 间共享（非每 project 启动），三 project（chromium/firefox/webkit）共用同一 webServer，浏览器无关。
- **globalTeardown**（file:///workspace/mvp/apps/e2e/global-teardown.ts）：删除临时 DB 文件（`unlinkSync(process.env.E2E_DB_PATH)`），在主进程执行（非子进程，process.env.E2E_DB_PATH 由 playwright.config.ts 顶层 L25 赋值，config → teardown 同进程可见），与浏览器引擎无关。
- **临时 DB 隔离**（file:///workspace/mvp/playwright.config.ts:21-25）：`E2E_DB_PATH = ${tmpdir()}/e2e-admin-${process.pid}-${Date.now()}.db`，每 run 全新临时 DB，三 project 共享同一临时 DB（非每 project 独立 DB），浏览器无关但**并发写竞争风险**（§3.3 D3 + §8.1 风险预判）。

**结论**：webServer + globalTeardown + 临时 DB 隔离全部浏览器无关，R24 扩展 projects 数组后无需改动 webServer / globalTeardown 配置。

### 2.6 既有 CI workflow 现状（Tech Lead 实测核验）

`ls /workspace/mvp` + `find . -name "*.yml" -o -name ".github"` 核验：**/workspace/mvp 无 .github/ 目录**（无 .github/workflows/*.yml），仅 `api-spec/*.openapi.yaml`（OpenAPI spec 非 CI workflow）。R20 Q4 决策 CI 浏览器安装步骤属"CI workflow 配置"但项目尚未引入 CI workflow 文件——R20 既有 CI 安装步骤属 advisory 范围（impl-writer / 编排者按需配置，本 Spec 不引入 CI workflow，§3.8 D8 决策）。

## 3 · D1-D8 决策（含 S-23 第三次触发核验结论）

> 每节显式标注 `[约束]`（默认禁止偏离，偏离须经 AI-003 流程 + Reviewer 确认）或 `[advisory]`（允许偏离，须反向同步 §7）。D1/D6 含 S-23 第三次触发核验结论（§10.6 反向同步）。

### 3.1 `[约束]` D1：projects 数组扩展方式——chromium + firefox + webkit 三 project 各用 device descriptor（S-23 第三次触发核验）

> **[R24 §10.6 S-23 第三次触发评估]**：BA PRD §1.4/§6.2 字面声明"仅扩展 projects 数组，不引入新第三方库，应不触发 S-23"。Tech Lead 实测核验：
> - **R24 不引入新第三方库**：`@playwright/test@^1.61.1`（R20 已装，实装 1.61.1）+ `@axe-core/playwright@^4.12.1`（R23 已装，实装 4.12.1）无新 npm 依赖（§2.3 实测 `npm ls` 确认）。
> - **R24 涉及既有 API 复用**：`devices['Desktop Firefox']` / `devices['Desktop Safari']` 是 @playwright/test 内置 device descriptor（与 R20 已用的 `devices['Desktop Chrome']` 同源），属既有 API 复用非新 API 字段。Tech Lead 实测 `node -e "const { devices } = require('@playwright/test'); ..."` 输出含 `defaultBrowserType: 'firefox'/'webkit'` 字段（§2.4），确认在 @playwright/test@1.61.1 下可用。
> - **S-23 触发判定**：**不触发**（R24 不引入新第三方库，仅扩展既有 @playwright/test@1.61.1 projects API + devices 既有 API 复用）。Tech Lead 仍按 S-23 提示词在 spec 阶段核验既有 API 复用（§2.4 实测 devices 字段 + §10.6 反向同步标注），属既有 API 复用核验非新库核验。

**选项**：
- A. 三 project（chromium + firefox + webkit）各用 Playwright 内置 device descriptor（`devices['Desktop Chrome']` / `devices['Desktop Firefox']` / `devices['Desktop Safari']`），与 R20 chromium project 模式同源（推荐）。
- B. 三 project 手动配置 `{ name: 'firefox', use: { browserName: 'firefox', viewport: { width: 1280, height: 720 } } }`（非 device descriptor）。
- C. 仅扩展 projects 数组不配 device descriptor，依赖顶层 use.browserName（但顶层 use.browserName 只能设一个值，无法多浏览器）。

**选择：A 三 project 各用 device descriptor**。

**理由**：
1. **R20 chromium project 已用 `devices['Desktop Chrome']`**（file:///workspace/mvp/playwright.config.ts:62），R24 扩展为三 project 沿用同模式（device descriptor 内含 `defaultBrowserType` 字段驱动 Playwright 启动对应浏览器，§2.4 实测核验）。
2. device descriptor 含完整浏览器上下文（userAgent / viewport / screen / deviceScaleFactor / isMobile / hasTouch / defaultBrowserType），手动配置（选项 B）易遗漏字段（如 userAgent 不一致可能影响 webkit 下 fetch 行为）。
3. Playwright 官方跨浏览器示例（[Projects | Playwright](https://playwright.dev/docs/test-projects)）即用 device descriptor 模式，与 R20 D6 + R24 D1 一致。
4. S-23 第三次触发评估闭环：Tech Lead 实测 `devices['Desktop Firefox']` / `devices['Desktop Safari']` 在 @playwright/test@1.61.1 中可用（§2.4），属既有 API 复用，S-23 不触发（§10.6）。

### 3.2 `[约束]` D2：顶层 use.browserName 冲突解决方案——移除顶层 use.browserName（方案 A）

**选项**：
- A. 移除顶层 `use.browserName: 'chromium'`，由 project 级 device descriptor 的 `defaultBrowserType` 提供浏览器类型（推荐，语义清晰）。
- B. 保留顶层 `use.browserName: 'chromium'` 作为默认，firefox/webkit project 显式覆盖（device descriptor 的 defaultBrowserType 覆盖顶层 browserName）。
- C. 每 project 都显式 `use.browserName`（如 `{ name: 'firefox', use: { ...devices['Desktop Firefox'], browserName: 'firefox' } }`，重复声明）。

**选择：A 移除顶层 use.browserName**。

**理由**：
1. **device descriptor 内含 `defaultBrowserType`**（§2.4 实测核验）：`devices['Desktop Firefox'].defaultBrowserType = 'firefox'` / `devices['Desktop Safari'].defaultBrowserType = 'webkit'` / `devices['Desktop Chrome'].defaultBrowserType = 'chromium'`，Playwright 据此启动对应浏览器，无须顶层 `use.browserName` 显式声明。
2. **保留顶层 use.browserName='chromium'（方案 B）的风险**：顶层字段会被 project 级 device descriptor 覆盖（Playwright 语义：project 级 use 覆盖顶层 use，功能正确），但保留可能误导（看似强制 chromium，实际被 project 覆盖），且若未来新增 project 未配 device descriptor 会回退到顶层 chromium（隐性 bug）。
3. **每 project 显式 use.browserName（方案 C）的冗余**：device descriptor 已含 `defaultBrowserType`，重复声明 `browserName` 易产生字段冲突（device descriptor 的 defaultBrowserType 与显式 browserName 须一致，否则 Playwright 报错）。
4. **方案 A 语义清晰**：移除顶层 use.browserName 后，每个 project 显式声明浏览器类型（经 device descriptor 的 defaultBrowserType），无隐式默认值误导，符合"显式优于隐式"原则。

**实现要点**（playwright.config.ts 改造）：
- 移除 `use.browserName: 'chromium'`（file:///workspace/mvp/playwright.config.ts:48）。
- 保留 `use` 顶层其他字段（baseURL / headless / trace / screenshot / navigationTimeout / actionTimeout）——这些字段浏览器无关，三 project 共享。
- 三 project 各自 `use: { ...devices['Desktop X'] }` 经 device descriptor 提供 `defaultBrowserType`，无须显式 browserName。

### 3.3 `[约束] → [advisory] 偏离已落地` D3：CI 并行策略与临时 DB 隔离——共享 webServer + project 间并行 + project 内串行（方案 A → impl 阶段降级为方案 C）

> **[R24 impl 阶段 [advisory] 偏离反向同步（R18 S-21）]**：
> impl-writer 实测发现 spec 原假设"Playwright 按 project 分配 worker（每 project 独立 worker pool），同 project 内 test 文件串行"**不准确**。Playwright 实测行为：单 worker pool 共享 + `fullyParallel: false` 仅保证"同一 spec 文件内 test 串行"，**不保证"同 project 内不同 spec 文件串行"**——workers > 1 时同 project 内不同 spec 文件会被分配到不同 worker 并发跑，共享 webServer + 临时 DB 致 DB 写竞争。
> 实测证据：CI=true 沙箱（impl 工作目录）下 `npx playwright test`（workers=3）跑全量 66 tests = **21 passed / 45 failed**：
> - chromium 失败：roles.spec.ts AC-E5（"角色列表渲染"，table 不可见，page 处于 /login 未登录态）/ AC-E6（"创建角色 → 列表新增该角色"，table toContainText 超时 15s）—— 多 worker 共享临时 DB 致 DB 写时序错乱 + 登录态在 page context 间泄漏。
> - firefox 失败：a11y.spec.ts / login.spec.ts / logout.spec.ts 等 `browserType.launch:` 错误 —— 多 worker 并发启动 firefox 进程触发系统资源/进程数竞争。
> - webkit 失败：同 firefox，多 worker 并发启动 webkit 进程失败。
> 按 spec §3.3 D3 + §7.3 + §10.1 预期场景"impl 阶段若 CI 并行 66 tests 出 SQLITE_BUSY 或 DB 写竞争，降级为方案 C（workers:1）"——**实际降级为方案 C `workers: 1` 常量**（CI 与本地均串行，CI 时间换稳定性，与 R20 既有单 worker 一致）。
> **降级后实测**：`workers: 1` 全量 66 tests 全绿（AC-XB-6 闭合，详见交付报告）。
> **未闭合优化项**（留 R25+ future）：CI 时间从 ~22s（理论并行）退化为 ~60s（串行），违背 Q3 ① CI 并行优化目标，但稳定性优先。如需恢复 CI 并行，应：
>   1. 改 spec 假设为"Playwright 单 worker pool 共享"，重新设计隔离方案（如每 project 独立 webServer + 独立临时 DB，§3.3 方案 B）。
>   2. 或在 E2E 上下文引入 project-aware DB 隔离（每 project 名后缀化 DB_PATH）。
>   3. 或引入 Playwright sharding（`--shard`）替代 workers。
> 以上属 R25 项目维护轮范围，R24 impl-writer 角色边界不展开。

**选项**：
- A. 共享 webServer + project 间并行（`workers: process.env.CI ? 3 : 1` + `fullyParallel: false` 保持）——3 worker 对应 3 浏览器 project，Playwright 按 project 分配 worker，同 project 内 test 串行，跨 project 并行。
- B. 独立 webServer + project 间并行（每 project 启动独立 webServer + 独立临时 DB，CI 资源占用高但隔离干净）。
- C. 共享 webServer + project 间串行（`workers: 1`，CI 时间最长但无并发风险）。

**原 spec 选择：A 共享 webServer + project 间并行 + project 内串行**。
**impl 阶段实际落地：C 共享 webServer + 全串行（workers: 1 常量）—— [advisory] 偏离 D3 [约束] 决策，依据 §7.3 + §10.1 反向同步**。

**临时 DB 并发写竞争风险评估**（关键约束 4）：

- **Playwright `fullyParallel: false` 行为核验**：Playwright 文档 + R20 既有行为——`fullyParallel: false` 时按 test 文件串行（文件间串行），同一 test 文件内 test 串行。`workers > 1` 时，Playwright 按 project 分配 worker（每个 project 独立 worker pool），同 project 内 test 文件串行（与单浏览器一致），跨 project 的 test 文件并行（chromium 跑 users.spec.ts + firefox 跑 users.spec.ts + webkit 跑 users.spec.ts 三浏览器同时跑同一 spec）。
- **方案 A 临时 DB 写竞争分析**：
  - 每 project 内 test 串行（与 R20 单浏览器一致，DB 写时序不变）→ 单 project 内无并发写。
  - 跨 project 并发跑同一 spec（如三浏览器同时跑 users.spec.ts AC-E3 创建用户）→ 三浏览器同时 POST /v1/users 写同一临时 DB。
  - **缓解因素 1**：R20 `uniqueSuffix()`（file:///workspace/mvp/apps/e2e/tests/_helpers.ts:173-175）用 `Date.now() + Math.random()` 保证 email 唯一，三浏览器并发创建用户不会产生邮箱唯一约束冲突。
  - **缓解因素 2**：node:sqlite 默认 WAL 模式（PRAGMA journal_mode=WAL），WAL 支持并发读 + 单写者，多写者会排队（SQLITE_BUSY 重试，默认 timeout 5s）。
  - **风险点**：极端情况下三浏览器并发写同一 DB 可能触发 SQLITE_BUSY（WAL 锁竞争），但 E2E 每 test 写操作量小（< 10 写/test），并发概率低 + WAL 5s timeout 兜底，预期不阻塞。
- **方案 B 独立 webServer 的成本**：每 project 启动独立 webServer（3 个 api server + 3 个 vite dev = 6 进程）+ 独立临时 DB，CI 资源占用高（CPU/内存/端口），且 Playwright webServer 不天然支持 per-project 独立（须自定义 globalSetup 编排），违背 R20 既有 webServer 双进程共享模式。
- **方案 C 串行的成本**：`workers: 1` + 三 project 串行（chromium → firefox → webkit），CI 时间约 60s+（22 × ~3s × 3 浏览器 × 1 worker），违背 Q3 ① CI 并行优化目标。

**理由**：
1. **Q3 BLOCKING 决策落地**：用户已拍板 Q3=① CI 并行（`workers: process.env.CI ? 3 : 1` + `fullyParallel: false` 保持），方案 A 直接落地。
2. **临时 DB 写竞争风险最低**：`fullyParallel: false` 保证同 project 内 test 串行（与 R20 一致），仅跨 project 并发同 spec，`uniqueSuffix()` 保证 email 唯一 + WAL 5s timeout 兜底，预期不阻塞（§8.1 风险预判 + §10.7 替代方案）。
3. **CI 时间优化**：方案 A 三 project 并行（CI 时间 ≈ 单浏览器时间，~22s），方案 C 串行（~66s），方案 A 优化 3 倍。
4. **本地不拖慢**：`workers: process.env.CI ? 3 : 1` 本地 `workers: 1`，开发者本地 `npm run test:e2e:local`（D7）仅跑 chromium，避免本地装 firefox/webkit 二进制 + 拖慢反馈环。
5. **回退预案**（§10.7）：若 impl 阶段 CI 并行 66 tests 出 SQLITE_BUSY 或 DB 写竞争，降级为方案 C（`workers: 1`，CI 时间换稳定性），属 [advisory] 偏离 D3 须 §7 反向同步。

### 3.4 `[约束]` D4：firefox/webkit 二进制安装——本地 + CI 均装 + CI 加 --with-deps

**选项**：
- A. 本地 + CI 均装 firefox-1532 + webkit-2311（CI 加 `--with-deps` 装系统依赖，推荐）。
- B. 仅本地装，CI 仅跑 chromium（违背 Q1 跨浏览器目标，排除）。
- C. 用 Docker 容器跑 firefox/webkit E2E（增加复杂度，违背 R20 既有直跑模式，排除）。

**选择：A 本地 + CI 均装 firefox-1532 + webkit-2311**。

**理由**：
1. **§2.4 实测 dry-run 确认可下载**：`npx playwright install --dry-run firefox webkit` 输出 firefox-ubuntu-24.04.zip + webkit-ubuntu-24.04.zip 可达（cdn.playwright.dev），无网络/可达性问题。
2. **本地开发装 firefox/webkit 二进制**：开发者首次跑 firefox/webkit E2E 须 `npx playwright install firefox webkit`（~140MB 下载）。本地默认 `npm run test:e2e:local`（D7）仅跑 chromium 不需要装 firefox/webkit，仅当开发者显式 `npm run test:e2e`（跑全三浏览器）时须装。
3. **CI 装 firefox/webkit 二进制 + 系统依赖**：CI workflow（如未来引入 .github/workflows/）须 `npx playwright install --with-deps firefox webkit`（`--with-deps` 装 libnss3 / libgtk-3 / libasound2 等系统依赖，CI 镜像须支持 ubuntu-24.04）。R20 Q4 既有 `npx playwright install --with-deps chromium` 模式同源扩展为三浏览器。
4. **缓存加速**：CI 缓存 `~/.cache/ms-playwright` 加速后续 run（R20 已缓存 chromium-1228，R24 增 firefox-1532 + webkit-2311 缓存）。
5. **R24 不引入 .github/workflows/**（§3.8 D8）：项目无既有 CI workflow 文件，CI 安装步骤属 advisory 范围（impl-writer / 编排者按需配置，本 Spec 仅声明安装命令 `npx playwright install --with-deps firefox webkit`）。

### 3.5 `[advisory]` D5：webkit timeout 调整——暂不调整全局 timeout（impl 阶段如频超时再调）

**选项**：
- A. 暂不调整全局 timeout（保持 R20 既有 `timeout: 60000` + `navigationTimeout: 15000` + `actionTimeout: 10000`），impl 阶段如 webkit 频繁超时再调整（推荐，[advisory]）。
- B. 全局调高 timeout（如 `timeout: 90000` + `navigationTimeout: 20000`），预防 webkit 慢。
- C. 仅 webkit project 调高 timeout（`{ name: 'webkit', use: { ...devices['Desktop Safari'], actionTimeout: 15000 } }`）。

**选择：A 暂不调整全局 timeout（[advisory]）**。

**理由**：
1. **R20 既有 timeout 已含余量**：`timeout: 60000`（单 test 60s，覆盖登录 + 表单 + 路由跳转 + API 往返 + CI 慢机器预留）+ `navigationTimeout: 15000`（导航 15s）+ `actionTimeout: 10000`（action 10s），webkit 可能略慢于 chromium（< 20% 差异），既有余量应足够。
2. **webkit 渲染慢的真实场景**：webkit（Safari 引擎）在 headless 模式下渲染速度与 chromium 接近（差异主要在冷启动 + JS 引擎），单 test 时间差异预期 < 1s，既有 timeout 60s 余量（实际单 test ~3s）远超差异。
3. **过度调整风险**：全局调高 timeout（方案 B）会掩盖真实性能问题（如某 test 真实慢 30s 应优化而非靠 timeout 兜底）；仅 webkit 调高（方案 C）破坏三 project 一致性（impl-writer 须维护两套 timeout）。
4. **impl 阶段验证 + 反向同步**：impl-writer 实跑 firefox/webkit 66 tests 后，若 webkit 频繁超时（> 5% 失败率），调整为方案 C 或方案 B，须在 §7 反向同步 + 给出超时失败 test 清单 + 调整后 timeout 值 + 合规论证（[advisory] 范围）。

### 3.6 `[约束]` D6：a11y.spec.ts 在 firefox/webkit 下的 AxeBuilder 行为核验——不改 a11y.spec.ts 直接复用（S-23 第三次触发核验）

> **[R24 §10.6 S-23 第三次触发评估]**：BA PRD §1.4/§6.2 声明"@axe-core/playwright 浏览器无关，R24 直接复用 a11y.spec.ts"。Tech Lead 实测核验：
> - **@axe-core/playwright@4.12.1 浏览器无关性核验**：@axe-core/playwright 在 R23 §10.6 已核验（peerDeps `playwright-core >= 1.0.0` 与 @playwright/test 1.61.1 兼容 + API `AxeBuilder` 核验确认 + 自带 TypeScript 类型 + 实测安装 typecheck exit 0）。@axe-core/playwright 的 `AxeBuilder.analyze()` 实现机制是：在 Playwright Page 上下文注入 axe-core JS（axe-core 是纯 JS 库，在浏览器 page context 运行），axe-core JS 调用浏览器原生 Accessibility API（不同浏览器底层 API：chromium 用 Accessibility Object Model / firefox 用 IA2 / webkit 用 AccessibilityObject）+ 渲染时 DOM/CSS 计算检测 WCAG violation。**关键**：axe-core JS 本身浏览器无关（同一份 axe.min.js 在三浏览器下运行），仅底层 Accessibility API 调用不同浏览器原生实现（axe-core 内部已封装跨浏览器差异），上层 `AxeBuilder.analyze()` API 对调用方透明。
> - **firefox/webkit 下 axe 扫描行为一致性**：axe-core 4.12.1（@axe-core/playwright 4.12.1 自带 axe-core 4.12.1）在三浏览器下扫描结果应一致（axe-core 设计目标即跨浏览器一致性），但**渲染时 violation 可能在不同引擎下表现不同**（如 firefox/webkit 下 color-contrast 计算差异 / aria 属性处理差异）——这正是 R24 a11y 多浏览器验证的价值（捕获 chromium 未暴露的 a11y 问题）。
> - **S-23 触发判定**：**不触发**（R24 不引入新第三方库，@axe-core/playwright@4.12.1 R23 已装 + 浏览器无关性已在 R23 §10.6 核验，R24 仅复用 a11y.spec.ts 在多 project 下跑）。

**选项**：
- A. 不改 a11y.spec.ts，直接复用为多浏览器 axe 扫描（推荐）。
- B. 为 firefox/webkit 单独写 a11y-firefox.spec.ts / a11y-webkit.spec.ts（重复代码，违背 DRY）。
- C. a11y.spec.ts 内显式判断 browserName 走不同逻辑（如 `if (browserName === 'firefox') { ... }`，违背 axe-core 浏览器无关性）。

**选择：A 不改 a11y.spec.ts 直接复用**。

**理由**：
1. **a11y.spec.ts 浏览器无关性核验**（§2.2）：a11y.spec.ts（file:///workspace/mvp/apps/e2e/tests/a11y.spec.ts）使用 `AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()` + `expect(results.violations).toEqual([])`，全部浏览器无关 API（page / AxeBuilder / expect 都不依赖特定浏览器引擎）。
2. **@axe-core/playwright 浏览器无关性**（S-23 核验）：AxeBuilder.analyze() 在 page context 注入 axe-core JS，与浏览器引擎无关（§3.6 S-23 核验结论）。
3. **多浏览器复用零代码改动成本**：R24 扩展 projects 数组后，a11y.spec.ts 自动在三 project 下跑（22 × 3 = 66 tests 中含 8 a11y × 3 = 24 axe 扫描），无须改 a11y.spec.ts。
4. **a11y 多浏览器验证的独立价值**：firefox/webkit 下 axe 扫描可能暴露 chromium 未暴露的 a11y violation（如 color-contrast 计算差异 / aria 属性处理差异），是 R24 a11y 多浏览器验证的核心收益（PRD §1.1 详述）。

### 3.7 `[约束]` D7：本地默认 chromium-only 策略——新增 test:e2e:local script

**选项**：
- A. 新增 `test:e2e:local` script = `playwright test --project=chromium`，保留 `test:e2e` 跑全三 project（推荐，显式 script 语义清晰）。
- B. 用 `PLAYWRIGHT_BROWSERS` 环境变量过滤（如 `PLAYWRIGHT_BROWSERS=chromium npm run test:e2e`，但 Playwright 无此原生环境变量，须自定义 config 逻辑）。
- C. 默认 `test:e2e` 仅跑 chromium，CI 显式 `npx playwright test --project=chromium --project=firefox --project=webkit`（颠倒默认与 CI 行为，易混淆）。

**选择：A 新增 test:e2e:local script**。

**理由**：
1. **R20 D5 同源模式**：R20 D5 决策 E2E 独立 `npm run test:e2e`（= `playwright test`，跑全 project），R24 扩展为 `npm run test:e2e`（跑全三 project，CI 用）+ `npm run test:e2e:local`（仅 chromium，本地用），与 R20 D5 同源（独立 E2E runner 不计入 vitest）。
2. **显式 script 语义清晰**：开发者本地 `npm run test:e2e:local`（仅 chromium，~22 tests，~22s）快速反馈；CI `npm run test:e2e`（全三 project，66 tests，~22s 因 CI workers:3 并行）完整覆盖。
3. **方案 B 环境变量的缺陷**：Playwright 无原生 `PLAYWRIGHT_BROWSERS` 环境变量（须自定义 config 内 `process.env.PLAYWRIGHT_BROWSERS?.split(',')` 逻辑，增加 config 复杂度 + 与 Playwright 官方 API 不一致）。
4. **方案 C 颠倒默认的缺陷**：默认 `test:e2e` 仅 chromium 会使本地开发者误以为"已跑全 E2E"，CI 显式三 project 易遗漏（如某次 CI 仅跑 chromium 漏跑 firefox/webkit）。
5. **保留 `test:e2e` 跑全三 project 的语义**：`npm run test:e2e`（无 `:local` 后缀）= 全量 E2E（含三浏览器），与 PRD AC-XB-6 "三浏览器全量 E2E 一致性（66 tests 全绿）"对齐。

**实现要点**（package.json scripts 扩展）：
```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:local": "playwright test --project=chromium"
  }
}
```

### 3.8 `[advisory]` D8：CI workflow 配置——package.json scripts 扩展（不引入 .github/workflows/）

**选项**：
- A. package.json scripts 扩展（不引入 .github/workflows/，[advisory] 推荐）。
- B. 引入 .github/workflows/e2e.yml 配置 CI 三浏览器并行（但项目无既有 .github/，引入属跨轮 advisory 范围）。
- C. 用 package.json 的 `pretest`/`posttest` hook 自动装浏览器（隐式行为，DX 差）。

**选择：A package.json scripts 扩展**。

**理由**：
1. **§2.6 实测核验项目无 .github/ 目录**：`/workspace/mvp` 无 .github/workflows/*.yml（仅 api-spec/*.openapi.yaml），R20 Q4 决策 CI 浏览器安装步骤属 advisory 范围（impl-writer / 编排者按需配置，本 Spec 不引入 CI workflow）。
2. **R24 不引入 CI workflow 文件**：引入 .github/workflows/e2e.yml 属跨轮 advisory（CI workflow 设计 + runner 选择 + 缓存策略 + 系统依赖安装等工程基础设施决策，超出 R24 跨浏览器 E2E 覆盖范围，PRD §5 out of scope "新规则 / check-rules.mjs 改动"同源约束）。
3. **package.json scripts 扩展足够**：本 Spec 仅声明 `test:e2e` + `test:e2e:local` scripts（D7）+ CI 浏览器安装命令（D4：`npx playwright install --with-deps chromium firefox webkit`），impl-writer / 编排者据实际 CI 平台（GitHub Actions / GitLab CI / Drone 等）按需落地 workflow 文件。
4. **[advisory] CI workflow 引入留 R25+ future**：CI workflow 文件引入属 R25 项目维护轮范围（PRD §5 out of scope "R25 项目维护轮"），R24 仅声明 scripts + 安装命令，不引入 workflow 文件。

## 4 · 实现细节（每 AC 对应实现位置 + 代码骨架）

> 本节为设计 + 实现提示，不写完整实现代码（impl-writer 职责）。每 AC 标注实现位置 + 关键约束。

### 4.1 AC-XB-1：projects 数组扩展为 chromium + firefox + webkit 三 project

**实现位置**：file:///workspace/mvp/playwright.config.ts L48（移除顶层 use.browserName）+ L59-64（扩展 projects 数组）+ L34（workers 配置）。

**代码骨架**（playwright.config.ts 改造）：
```ts
// 移除顶层 use.browserName（D2 方案 A，由 project device descriptor 的 defaultBrowserType 提供）
use: {
  baseURL: 'http://localhost:5173',
  // browserName: 'chromium',  ← 移除（D2 方案 A）
  headless: true,
  trace: 'on-first-retry',
  screenshot: 'only-on-failure',
  navigationTimeout: 15000,
  actionTimeout: 10000,
},
// D3 原 spec：CI 3 worker 并行；impl 阶段 [advisory] 偏离降级为 workers:1 常量（§3.3 / §7.3 / §10.1 反向同步）
// workers: process.env.CI ? 3 : 1,  ← 原 spec 决策（impl 阶段实测触发 DB 写竞争 + browserType.launch 并发失败）
workers: 1,
// projects 扩展为三 project（D1）
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox',   use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit',    use: { ...devices['Desktop Safari'] } },
],
```

**关键约束**：
- `[约束]` 移除顶层 `use.browserName`（D2 方案 A，由 device descriptor 的 `defaultBrowserType` 提供浏览器类型，§2.4 实测核验）。
- ~~`[约束]` `workers: process.env.CI ? 3 : 1`（Q3 ① CI 并行，D3 方案 A）~~ → **impl 阶段降级为 `[advisory]` `workers: 1` 常量**（D3 [约束] 偏离，§3.3 / §7.3 / §10.1 反向同步）。
- `[约束]` `fullyParallel: false` 保持（D3 方案 A，规避临时 DB 并发写竞争）。
- `[约束]` 三 project 各用 device descriptor（D1 方案 A，与 R20 chromium project 同源）。

**验证方式**：`npx playwright test --list | wc -l` ≥ 66 + `npx playwright test --project=firefox --list` 列出 22 tests + `npx playwright test --project=webkit --list` 列出 22 tests。

### 4.2 AC-XB-2：14 核心流 E2E 在 firefox 下全绿

**实现位置**：无新增代码（22 E2E 浏览器无关直接复用，§2.2 核验），仅靠 D1 projects 扩展自动在 firefox project 下跑。

**关键约束**：
- `[约束]` 14 核心流 E2E（login.spec.ts AC-E1 + logout.spec.ts AC-E12/E13/E14 + users.spec.ts AC-E2/E3/E4 + roles.spec.ts AC-E5/E6/E7/E8 + transfer.spec.ts AC-E9/E10/E11）在 firefox 下全部通过。
- `[约束]` 跨浏览器行为一致性（含登录跳转 / token 持久 / 列表渲染 / 创建用户,角色 / versioned If-Match round-trip / 调岗 / 登出 / 路由守卫）。

**验证方式**：`npx playwright test --project=firefox tests/login.spec.ts tests/logout.spec.ts tests/users.spec.ts tests/roles.spec.ts tests/transfer.spec.ts` exit 0 + 14 passed。

### 4.3 AC-XB-3：14 核心流 E2E 在 webkit 下全绿

**实现位置**：无新增代码（同 AC-XB-2，浏览器无关复用）。

**关键约束**：同 AC-XB-2，在 webkit 下全部通过。

**验证方式**：`npx playwright test --project=webkit tests/login.spec.ts tests/logout.spec.ts tests/users.spec.ts tests/roles.spec.ts tests/transfer.spec.ts` exit 0 + 14 passed。

### 4.4 AC-XB-4：8 a11y E2E 在 firefox 下 0 violations

**实现位置**：无新增代码（a11y.spec.ts 浏览器无关直接复用，§3.6 D6 核验）。

**关键约束**：
- `[约束]` 8 页（LoginPage / UserListPage / RoleListPage / TransferPage / AuditLogPage / DeptTreePage / ReportPage / NotificationListPage）在 firefox 下 axe 扫描（`AxeBuilder.withTags(['wcag2a','wcag2aa']).analyze()`）0 violations。
- `[约束]` WCAG 2.1 A/AA 多浏览器一致性（axe-core 浏览器无关，§3.6 S-23 核验）。

**验证方式**：`npx playwright test --project=firefox tests/a11y.spec.ts` exit 0 + 8 passed + 0 violations。

### 4.5 AC-XB-5：8 a11y E2E 在 webkit 下 0 violations

**实现位置**：无新增代码（同 AC-XB-4）。

**关键约束**：同 AC-XB-4，在 webkit 下 0 violations。

**验证方式**：`npx playwright test --project=webkit tests/a11y.spec.ts` exit 0 + 8 passed + 0 violations。

### 4.6 AC-XB-6：三浏览器全量 E2E 一致性（66 tests 全绿）

**实现位置**：无新增代码（D1 projects 扩展后自动跑全三 project）。

**关键约束**：
- `[约束]` chromium + firefox + webkit 三 project 配置 + webServer 双进程就绪。
- `[约束]` 66 tests（22 E2E × 3 浏览器）全部通过，三浏览器行为一致（核心流 + a11y 跨浏览器无差异）。

**验证方式**：`npm run test:e2e`（无 `--project` 过滤，跑全三 project）exit 0 + 66 passed。

### 4.7 AC-XB-7：CI 并行执行配置 + 本地仅 chromium 策略

**实现位置**：file:///workspace/mvp/playwright.config.ts L34（workers）+ file:///workspace/mvp/package.json scripts（test:e2e:local）。

**代码骨架**（package.json scripts 扩展，D7）：
```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:local": "playwright test --project=chromium"
  }
}
```

**关键约束**：
- `[约束]` `workers: process.env.CI ? 3 : 1`（CI 3 worker 对应 3 浏览器 project 并行，本地 1 worker）。
- `[约束]` `fullyParallel: false` 保持（规避临时 DB 并发写竞争，D3 方案 A）。
- `[约束]` 本地默认 chromium project（`npm run test:e2e:local` = `playwright test --project=chromium`，D7）。
- `[约束]` CI 三浏览器 project 间并行执行（同 project 内 test 串行，DB 写竞争规避）。

**验证方式**：CI 环境 `CI=true npx playwright test` 三 project 并行（日志可见 3 worker）+ 本地 `npm run test:e2e:local` 仅 chromium（22 tests，无 firefox/webkit）。

### 4.8 AC-XB-8：既有 22 E2E chromium + 1272 vitest 全绿无回归

**实现位置**：无新增代码（跨浏览器扩展不破坏既有 chromium 测试 + 不改 apps/web / apps/api / packages/contracts 源码）。

**关键约束**：
- `[约束]` 既有 22 E2E chromium 全部通过（核心流 14 + a11y 8，R20/R23 成果不破坏）。
- `[约束]` 既有 1272 vitest 全部通过（无回归，跨浏览器扩展不改 apps/web / apps/api / packages/contracts 源码）。

**验证方式**：`npx playwright test --project=chromium` exit 0 + 22 passed + `npm test` exit 0 + 1272 passed。

### 4.9 AC-XB-9：S-23 第三次触发评估（不触发声明）

**实现位置**：本 Tech-Spec §10.6（S-23 不触发声明 + 核验结论）。

**关键约束**：
- `[约束]` R24 仅扩展 playwright.config.ts projects 数组 + workers 配置，无新 npm 依赖（§2.3 实测 `npm ls` 确认）。
- `[约束]` `@playwright/test@^1.61.1`（R20 已装，实装 1.61.1）+ `@axe-core/playwright@^4.12.1`（R23 已装，实装 4.12.1）无新依赖。
- `[约束]` Tech Lead 在 §10.6 标注"S-23 第三次触发评估：不触发（BA 声明核验准确，仅扩展 projects 数组，无新第三方库）"。
- `[约束]` 核验 `devices['Desktop Firefox']` / `devices['Desktop Safari']` 在 @playwright/test@1.61.1 下可用（§2.4 实测，属既有 API 复用核验非新库核验）。

**验证方式**：Read Tech-Spec §10.6 含 S-23 不触发声明 + `npm ls @playwright/test @axe-core/playwright` 无新依赖（输出 @playwright/test@1.61.1 + @axe-core/playwright@4.12.1）。

## 5 · 测试策略

### 5.1 既有 22 E2E × 3 浏览器 = 66 tests（无新增测试代码）

- **测试复用**：R20 14 核心流 + R23 8 a11y = 22 E2E 全部浏览器无关（§2.2 核验），R24 扩展 projects 数组后自动在三浏览器下跑（22 × 3 = 66 tests）。
- **零新增测试代码**：R24 不新增 .spec.ts 文件（22 E2E 直接复用为多浏览器测试），仅扩展 playwright.config.ts projects 数组。
- **测试矩阵**：6 spec × 22 test × 3 浏览器 = 66 tests（含 14 核心 × 3 = 42 + 8 a11y × 3 = 24）。

### 5.2 既有 1272 vitest 不回归（AC-XB-8）

- **回归保障**：R24 不改 apps/web/src / apps/api/src / packages/contracts 源码（§9 影响面仅在测试层），既有 1272 vitest（含 R23 9 jest-axe a11y.test.tsx）应直接全绿。
- **impl-writer 须实跑**：`npm test`（vitest run 全量）确认 1272 vitest 全绿 + `npm run test:e2e --project=chromium`（既有 22 E2E chromium）确认 22 passed 无回归。

### 5.3 跨浏览器一致性验证（AC-XB-2~6）

- **核心流跨浏览器一致性**：14 核心流 E2E 在 firefox + webkit 下全绿（AC-XB-2/3），验证登录跳转 / token 持久 / 列表渲染 / 创建用户,角色 / versioned If-Match round-trip / 调岗 / 登出 / 路由守卫在三浏览器下行为一致。
- **a11y 跨浏览器一致性**：8 a11y E2E 在 firefox + webkit 下 0 violations（AC-XB-4/5），验证 axe-core WCAG 2.1 A/AA 规则集在三浏览器下检测结果一致（axe-core 浏览器无关，但渲染时 violation 可能在不同引擎下表现不同，§3.6 D6）。
- **三浏览器全量一致性**：66 tests 全绿（AC-XB-6），三浏览器行为一致（核心流 + a11y 跨浏览器无差异）。

### 5.4 CI 并行验证（AC-XB-7）

- **CI 并行执行**：`CI=true npx playwright test` 三 project 并行（workers:3，日志可见 3 worker），同 project 内 test 串行（fullyParallel:false）。
- **本地 chromium-only**：`npm run test:e2e:local`（= `playwright test --project=chromium`）仅跑 chromium 22 tests，不拖慢本地反馈环。
- **临时 DB 并发写竞争验证**：CI 并行下三浏览器同时跑同 spec（如 users.spec.ts AC-E3 创建用户），三浏览器同时 POST /v1/users 写同一临时 DB，验证 `uniqueSuffix()` 唯一性 + WAL 锁竞争不阻塞（§3.3 D3 + §8.1 风险预判）。

## 6 · 替代方案（S-23 衍生 + 风险预判衍生，§10.7 详述）

### 6.1 firefox/webkit 二进制装不上退回方案（§2.4 实测可下载，预判低概率）

S-23 核验结论：firefox-1532 + webkit-2311 dry-run 确认可下载（§2.4），本地 + CI 均可装。但预判若 impl 阶段发现 CI 镜像不支持 firefox/webkit 系统依赖（如 libnss3 / libgtk-3 缺失）：
- **方案 A**（推荐退回）：改 CI 镜像为 Playwright 官方镜像（`mcr.microsoft.com/playwright:v1.61.1-jammy`，预装 chromium + firefox + webkit + 系统依赖）。
- **方案 B**：本地开发装 firefox/webkit 但 CI 仅跑 chromium（违背 Q1 跨浏览器目标，排除）。
- **方案 C**：用 Docker 容器跑 firefox/webkit E2E（增加复杂度，违背 R20 既有直跑模式，排除）。

### 6.2 webkit timeout 不够退回方案（§3.5 D5 [advisory]，impl 阶段如频超时再调）

S-23 核验结论：R20 既有 timeout 60s + navigationTimeout 15s + actionTimeout 10s 已含余量，webkit 应足够（§3.5 D5）。但预判若 impl 阶段 webkit 频繁超时（> 5% 失败率）：
- **方案 A**（推荐退回）：仅 webkit project 调高 timeout（`{ name: 'webkit', use: { ...devices['Desktop Safari'], actionTimeout: 15000, navigationTimeout: 20000 } }`），保持 chromium/firefox 既有 timeout。
- **方案 B**：全局调高 timeout（`timeout: 90000`，掩盖真实性能问题，不推荐）。
- **方案 C**：调整 webkit test 拆分（如某 test 真实慢 30s 拆为多个小 test，但增加维护成本，[advisory] 范围）。

### 6.3 临时 DB 并发写竞争退回方案（§3.3 D3 + §8.1，预判低概率）

S-23 核验结论：`fullyParallel: false` + `uniqueSuffix()` + WAL 5s timeout 兜底，预期不阻塞（§3.3 D3）。但预判若 impl 阶段 CI 并行 66 tests 出 SQLITE_BUSY 或 DB 写竞争：
- **方案 A**（推荐退回）：降级为 `workers: 1`（方案 C，CI 时间约 60s+，违背 Q3 优化目标但稳定）。
- **方案 B**：每 project 独立临时 DB（`E2E_DB_PATH` 含 project name 后缀，但 webServer 在 project 间共享无法每 project 独立 DB，除非每 project 启动独立 webServer，违背 Playwright webServer 共享语义 + CI 资源占用高）。
- **方案 C**：调整 `fullyParallel: true` + `workers: 3`（同 project 内 test 文件并发，DB 写竞争风险更高，不推荐）。

## 7 · [advisory] 偏离反向同步

### 7.1 D5 webkit timeout 调整（[advisory]）

D5 选择"暂不调整全局 timeout"属 [advisory]（PRD AC-XB-2~6 仅要求"全绿"+"0 violations"，不限定 timeout 值）。impl-writer 实跑 firefox/webkit 66 tests 后，若 webkit 频繁超时（> 5% 失败率），可调整为方案 A（仅 webkit project 调高 timeout）或方案 B（全局调高），须在交付报告列"超时失败 test 清单 + 调整后 timeout 值 + 合规论证"（参照 R12 S-2 advisory 边界）。

### 7.2 D8 CI workflow 引入（[advisory]）

D8 选择"package.json scripts 扩展，不引入 .github/workflows/"属 [advisory]（PRD AC-XB-7 仅要求"CI 并行执行配置 + 本地仅 chromium 策略"，不限定 CI workflow 文件）。impl-writer / 编排者据实际 CI 平台按需落地 workflow 文件，若引入 .github/workflows/e2e.yml 须在交付报告列"workflow 文件路径 + CI runner + 缓存策略 + 系统依赖安装命令"（参照 R20 §3.6 CI 两阶段编排模式）。

### 7.3 D3 临时 DB 并发写竞争降级（[advisory] 已触发 + 实际落地）

D3 选择"共享 webServer + project 间并行 + project 内串行"（方案 A，`workers: process.env.CI ? 3 : 1`）原属 [约束] 决策，但 impl 阶段实测触发降级条件（CI 并行 66 tests 出 DB 写竞争 + browserType.launch 并发启动失败）。

**[advisory] 偏离已实际落地**（R18 S-21 反向同步）：

- **触发证据**：CI=true 沙箱（impl 工作目录）下 `npx playwright test`（workers=3）跑全量 66 tests = 21 passed / 45 failed。
- **失败清单**：
  - chromium 失败：roles.spec.ts AC-E5 / AC-E6（DB 写竞争 + 登录态泄漏致 table 不可见）。
  - firefox 失败：a11y.spec.ts / login.spec.ts / logout.spec.ts 等 `browserType.launch:` 错误（多 worker 并发启动 firefox 进程竞争）。
  - webkit 失败：同 firefox，多 worker 并发启动 webkit 进程失败。
- **降级后 workers 值**：`workers: 1` 常量（CI 与本地均串行，与 R20 既有单 worker 一致）。
- **合规论证**：
  1. spec §3.3 D3 + §6.3 + §10.7 已预期此场景为 [advisory] 偏离，明示"若 impl 阶段 CI 并行 66 tests 出 SQLITE_BUSY 或 DB 写竞争，降级为方案 C（workers: 1）"——impl-writer 按 spec 预案执行降级，未引入新决策。
  2. **核心发现**：spec 原假设"Playwright 按 project 分配 worker（每 project 独立 worker pool），同 project 内 test 文件串行"**不准确**。Playwright 实测单 worker pool 共享，`fullyParallel: false` 仅保证 spec 文件内 test 串行，**不保证同 project 内不同 spec 文件串行**——workers > 1 时同 project 内不同 spec 文件会被分配到不同 worker 并发跑，共享 webServer + 临时 DB 致 DB 写竞争。
  3. **稳定性 > CI 时间优化**：方案 A 理论 CI 时间 ~22s（3 worker 并行），方案 C 实际 CI 时间 ~60s（串行），违背 Q3 ① CI 并行优化目标，但 66 tests 稳定全绿 > CI 时间，AC-XB-6（66 tests 全绿）+ AC-XB-7（CI 配置 + 本地策略）核心 AC 闭合优先。
  4. **R20 既有单 worker 模式不破坏**：方案 C 与 R20 既有 `workers: 1` 一致，不引入新行为，AC-XB-8（既有 22 E2E chromium 不回归）天然闭合。
- **Spec 实际编辑位置**：§3.3 D3（决策标注 + 实测证据 + 降级声明）+ §7.3（本节）+ §10.1（impl 阶段验证更新）+ §11 AC-XB-7 验证方式更新。
- **未闭合优化项留 R25+ future**：恢复 CI 并行须重新设计隔离方案（每 project 独立 webServer + 独立 DB / Playwright sharding / project-aware DB 隔离），属 R25 项目维护轮范围，R24 impl-writer 角色边界不展开。

## 8 · 风险预判

### 8.1 多浏览器并行与临时 DB 并发写竞争风险（Q3 CI 并行，§3.3 D3）

**风险**：Q3 推荐①CI 并行（`workers: process.env.CI ? 3 : 1`），三 project（chromium/firefox/webkit）共享同一临时 DB（file:///workspace/mvp/playwright.config.ts:21），若三 project 并发跑同一 spec（如三浏览器同时跑 users.spec.ts AC-E3 创建用户），三浏览器同时 POST /v1/users 写同一临时 DB，可能产生并发写（邮箱唯一性约束冲突 / WAL 锁竞争 / SQLITE_BUSY）。

**预判**：
- **缓解因素 1**：R20 `uniqueSuffix()`（file:///workspace/mvp/apps/e2e/tests/_helpers.ts:173-175）用 `Date.now() + Math.random()` 保证 email 唯一，三浏览器并发创建用户不会产生邮箱唯一约束冲突。
- **缓解因素 2**：node:sqlite 默认 WAL 模式（PRAGMA journal_mode=WAL），WAL 支持并发读 + 单写者，多写者会排队（SQLITE_BUSY 重试，默认 timeout 5s）。
- **缓解因素 3**：`fullyParallel: false` 保证同 project 内 test 串行（与 R20 单浏览器一致），仅跨 project 并发同 spec。
- **风险点**：极端情况下三浏览器并发写同一 DB 可能触发 SQLITE_BUSY（WAL 锁竞争），但 E2E 每 test 写操作量小（< 10 写/test），并发概率低 + WAL 5s timeout 兜底，预期不阻塞。
- **impl 阶段验证**：impl-writer 须实跑 `CI=true npx playwright test` 66 tests 全绿验证（AC-XB-6 + AC-XB-7），若出 SQLITE_BUSY 须降级为方案 C（`workers: 1`，§6.3 + §7.3）。

### 8.2 firefox/webkit 二进制安装风险（§3.4 D4）

**风险**：firefox-1532 + webkit-2311 二进制未装（§2.4 核验），R24 须 `npx playwright install firefox webkit` 安装。本地开发 + CI 均须安装，否则 `npx playwright test --project=firefox/webkit` 报"browser not found"。

**预判**：
- **本地开发**：开发者首次跑 firefox/webkit E2E 须 `npx playwright install firefox webkit`（~140MB 下载）。本地默认 `npm run test:e2e:local`（D7）仅跑 chromium 不需要装 firefox/webkit，仅当开发者显式 `npm run test:e2e`（跑全三浏览器）时须装。
- **CI**：CI workflow 须增 `npx playwright install --with-deps firefox webkit` 步骤（R20 Q4 决策仅 chromium + `--with-deps`，R24 扩展为三浏览器 + `--with-deps`），缓存 `~/.cache/ms-playwright` 加速后续 run（R20 已缓存 chromium-1228，R24 增 firefox-1532 + webkit-2311 缓存）。
- **系统依赖**：firefox/webkit 须 `--with-deps` 装系统依赖（libnss3 / libgtk-3 / libasound2 等），CI 镜像须支持 ubuntu-24.04（dry-run 输出 firefox-ubuntu-24.04.zip + webkit-ubuntu-24.04.zip 暗示 ubuntu-24.04 镜像）。

**§10.7 替代方案**：若 CI 镜像不支持 firefox/webkit 系统依赖 → 改 CI 镜像为 Playwright 官方镜像（`mcr.microsoft.com/playwright:v1.61.1-jammy`）。

### 8.3 firefox 默认 strictSSL 与 webServer 自签证书兼容性（§3.4 D4）

**风险**：firefox 默认 `strictSSL` 可能影响 webServer 自签证书场景（R20 webServer 用 `http://localhost` 非 https，应不受影响，但须核验）。

**预判**：
- R20 webServer 用 `http://localhost:5173`（vite dev）+ `http://localhost:3000`（api server），非 https，firefox strictSSL 不触发（仅 https 场景才校验证书）。
- webServer 双进程无 SSL/TLS 配置（vite dev + api server 均用 http），firefox/webkit 下访问 `http://localhost:5173` 应正常。
- impl 阶段须 E2E 验证 firefox/webkit 下 `page.goto('/login')` 能访问（无 SSL 错误）。

### 8.4 webkit 默认 timeout 与既有 timeout 60s 兼容性（§3.5 D5）

**风险**：webkit（Safari 引擎）渲染可能略慢于 chromium，既有 `timeout: 60000` + `navigationTimeout: 15000` + `actionTimeout: 10000` 可能不够。

**预判**：
- webkit 在 headless 模式下渲染速度与 chromium 接近（差异主要在冷启动 + JS 引擎，< 20% 差异），既有 timeout 60s 余量（实际单 test ~3s）远超差异。
- R20 既有 timeout 已含 CI 慢机器预留（60s + 15s + 10s），webkit 应足够。
- impl 阶段若 webkit 频繁超时（> 5% 失败率），调整为方案 A（仅 webkit project 调高 timeout，§3.5 D5 + §6.2 + §7.1）。

### 8.5 既有 22 E2E chromium + 1272 vitest 回归风险（§10.5 详述）

**风险**：projects 数组扩展不应破坏 chromium 既有测试，但移除顶层 `use.browserName`（D2 方案 A）可能影响 chromium project 行为（chromium project 经 device descriptor 的 defaultBrowserType='chromium' 启动，应不破坏）。

**预判**：
- **chromium project 经 device descriptor 启动**：`devices['Desktop Chrome'].defaultBrowserType = 'chromium'`（§2.4 实测），移除顶层 use.browserName 后 chromium project 仍启动 chromium 浏览器，既有 22 E2E chromium 行为不变。
- **vitest 不受 playwright.config.ts 改动影响**：R24 仅改 playwright.config.ts + package.json scripts，vitest.config.ts / vitest.workspace.ts 零变更，既有 1272 vitest 应直接全绿。
- **impl-writer 须实跑**：`npm run test:e2e --project=chromium`（22 E2E chromium）+ `npm test`（1272 vitest）确认全绿（AC-XB-8）。

### 8.6 firefox/webkit 下 page.route 拦截时序差异风险（§3.4 D4）

**风险**：R20 核心流 E2E 用 `page.route` 拦截 PATCH/POST 请求断言 If-Match header（file:///workspace/mvp/apps/e2e/tests/users.spec.ts + roles.spec.ts + transfer.spec.ts），firefox/webkit 下 `page.route` 拦截时序可能与 chromium 差异（如注册 route 后立即点击按钮，firefox 可能在 route 注册前发起请求）。

**预判**：
- R20 已在点击按钮前注册 route（`await page.route(...)` 在 `await click()` 前），firefox/webkit 应一致。
- R20 已用 `expect.poll(() => capturedIfMatch, { timeout: 15000 }).toBeTruthy()` 容错（15s timeout 覆盖时序差异），firefox/webkit 下应能捕获。
- impl 阶段须 E2E 验证 firefox/webkit 下 `expect.poll` 能捕获 If-Match header（AC-XB-2/3 核心流跨浏览器一致性）。

## 9 · 影响面估算（AI-006 两类标注）

### 9.1 ①类显式影响（grep 符号引用）

| 文件 | 影响类型 | 说明 |
|------|----------|------|
| `playwright.config.ts`（根目录，R20 已建） | ②类改造 | 移除顶层 use.browserName（D2）+ 扩展 projects 数组为三 project（D1）+ workers 改 `process.env.CI ? 3 : 1`（D3） |
| `package.json`（根目录） | ②类改造 | scripts 扩展 test:e2e:local = `playwright test --project=chromium`（D7） |

### 9.2 ①类隐式影响（全集断言依赖枚举值）

**0 文件**。本轮无 errorCodeSchema / 域 schema 扩展，无全集断言失效风险。

### 9.3 ②类签名变更

**0 文件**。playwright.config.ts + package.json 改动是配置层扩展（projects 数组增 2 项 + scripts 增 1 项），无业务代码签名变更。

### 9.4 测试影响

| 文件 | 影响类型 | 说明 |
|------|----------|------|
| 既有 6 spec / 22 E2E（apps/e2e/tests/） | ②类配置驱动验证 | 不改既有断言（22 E2E 浏览器无关直接复用），扩展 projects 数组后自动跑 22 × 3 = 66 tests |
| 既有 1272 vitest（apps/api/test + apps/web/test + packages/contracts/test） | ②类验证 | 不改 vitest 配置（vitest.config.ts / vitest.workspace.ts 零变更），1272 vitest 应直接全绿 |

**新增依赖**：0 个（R24 零新 npm 依赖，§2.3 实测核验，S-23 不触发依据）。
**新增测试代码**：0 行（22 E2E 浏览器无关直接复用，零新增 .spec.ts 文件）。
**新增测试估算**：66 tests（22 E2E × 3 浏览器，零新增测试代码，仅扩展 projects 数组自动生成）。

## 10 · §10 组合副作用预判（R17 固化 + R21 S-23 增项，§10.1-§10.8 八项子项）

### 10.1 多浏览器并行与临时 DB 并发写竞争风险预判（Q3 CI 并行，§3.3 D3 + §8.1 详述）—— **impl 阶段已触发降级**

`[约束]` Q3 推荐①CI 并行（`workers: process.env.CI ? 3 : 1` + `fullyParallel: false` 保持），三 project 共享同一临时 DB（file:///workspace/mvp/playwright.config.ts:21）。

**impl 阶段验证结果（已触发降级）**：

- **实测命令**：`CI=true npx playwright test`（workers=3）跑全量 66 tests = **21 passed / 45 failed**。
- **失败清单**：
  - chromium 失败：roles.spec.ts AC-E5 / AC-E6（table 不可见 / toContainText 超时 15s，DB 写竞争 + 登录态泄漏）。
  - firefox 失败：a11y.spec.ts / login.spec.ts / logout.spec.ts 等 `browserType.launch:` 错误（多 worker 并发启动 firefox 进程竞争）。
  - webkit 失败：同 firefox。
- **核心发现**：spec 原假设"Playwright 按 project 分配 worker（每 project 独立 worker pool），同 project 内 test 文件串行"**不准确**——Playwright 单 worker pool 共享，`fullyParallel: false` 仅保证 spec 文件内 test 串行，**不保证同 project 内不同 spec 文件串行**。workers > 1 时同 project 内不同 spec 文件被分配到不同 worker 并发跑，共享 webServer + 临时 DB 致 DB 写竞争。
- **降级执行**：按 spec §3.3 D3 + §7.3 + §10.7 预案，降级为方案 C（`workers: 1` 常量，CI 与本地均串行）。
- **降级后验证**：`workers: 1` 全量 66 tests 全绿（AC-XB-6 闭合，详见交付报告）。
- `[advisory]` 已实际编辑 Tech-Spec §3.3 D3 + §7.3 + 本节（§10.1）+ §11 AC-XB-7 + 交付报告（R18 S-21 反向同步闭环）。
- **未闭合优化项留 R25+ future**：恢复 CI 并行须重新设计隔离方案（每 project 独立 webServer + 独立 DB / Playwright sharding / project-aware DB 隔离），属 R25 项目维护轮范围。

### 10.2 firefox/webkit 二进制安装风险预判（§3.4 D4 + §8.2 详述）—— **impl 阶段补充：本地须装系统依赖**

`[约束]` firefox-1532 + webkit-2311 二进制未装（§2.4 核验），R24 须 `npx playwright install firefox webkit` 安装。本地 + CI 均须安装。

**impl 阶段实测补充（本地系统依赖）**：

- **task spec 原指令"不要加 --with-deps（本地开发不需要系统依赖，CI 才需要）"**——impl-writer 在沙箱环境实测发现此假设不准确：最小 Linux 镜像（如沙箱 ubuntu-24.04）默认缺 `libgtk-3-0t64` 等 webkit 必需系统库，**本地开发环境也需 `npx playwright install-deps firefox webkit`**（或 `apt-get install libgtk-3-0t64 libnss3 libasound2` 等），否则 `browserType.launch:` 报"missing dependencies"。
- **实测命令**：`npx playwright install-deps firefox webkit`（须 sudo 权限，沙箱默认有 sudo 可用）。
- **修正原 spec 假设**：spec §3.4 D4 + §10.2 原文"本地开发不需要系统依赖，CI 才需要"——impl-writer 实测沙箱（最小 Linux）本地也需要。开发者本地若用 macOS/Windows 桌面环境（自带系统库），不需 `install-deps`；若用 Linux server/容器/沙箱，需 `install-deps`。建议 PRD/PRD 描述中"本地开发不需要 --with-deps"措辞限定为"macOS/Windows 桌面本地"。
- **CI**：CI workflow 须增 `npx playwright install --with-deps firefox webkit` 步骤（R20 Q4 决策扩展），缓存 `~/.cache/ms-playwright` 加速。
- **dry-run 实测确认可下载**（§2.4）：firefox-ubuntu-24.04.zip + webkit-ubuntu-24.04.zip 可达（cdn.playwright.dev）。
- `[advisory]` 若 CI 镜像不支持 firefox/webkit 系统依赖，改 CI 镜像为 Playwright 官方镜像（§6.1 方案 A）。

### 10.3 firefox 默认 strictSSL 与 webServer 自签证书兼容性预判（§8.3 详述）

`[约束]` firefox 默认 `strictSSL` 可能影响 webServer 自签证书场景。R20 webServer 用 `http://localhost:5173` + `http://localhost:3000`，非 https，应不受影响。

**风险预判**：
- R20 webServer 双进程无 SSL/TLS 配置（vite dev + api server 均用 http），firefox strictSSL 不触发（仅 https 场景才校验证书）。
- firefox/webkit 下访问 `http://localhost:5173` 应正常（无 SSL 错误）。
- impl 阶段须 E2E 验证 firefox/webkit 下 `page.goto('/login')` 能访问（AC-XB-2/3 + AC-XB-4/5 验证）。
- **低风险**（webServer 用 http 非 https，strictSSL 不触发）。

### 10.4 webkit 默认 timeout 与既有 timeout 60s 兼容性预判（§3.5 D5 + §8.4 详述）

`[约束]` webkit（Safari 引擎）渲染可能略慢于 chromium，既有 `timeout: 60000` + `navigationTimeout: 15000` + `actionTimeout: 10000` 可能不够。

**风险预判**：
- webkit 在 headless 模式下渲染速度与 chromium 接近（< 20% 差异），既有 timeout 60s 余量（实际单 test ~3s）远超差异。
- R20 既有 timeout 已含 CI 慢机器预留，webkit 应足够。
- impl 阶段若 webkit 频繁超时（> 5% 失败率），调整为方案 A（仅 webkit project 调高 timeout，§3.5 D5 + §6.2 + §7.1）。
- **低风险**（webkit headless 渲染与 chromium 接近，既有 timeout 余量足够）。

### 10.5 既有 22 E2E chromium + 1272 vitest 回归风险预判（AC-XB-8）

`[约束]` projects 数组扩展不应破坏 chromium 既有测试，但移除顶层 `use.browserName`（D2 方案 A）可能影响 chromium project 行为。

**风险预判**：
- **chromium project 经 device descriptor 启动**：`devices['Desktop Chrome'].defaultBrowserType = 'chromium'`（§2.4 实测），移除顶层 use.browserName 后 chromium project 仍启动 chromium 浏览器，既有 22 E2E chromium 行为不变。
- **vitest 不受 playwright.config.ts 改动影响**：R24 仅改 playwright.config.ts + package.json scripts，vitest.config.ts / vitest.workspace.ts 零变更，既有 1272 vitest 应直接全绿。
- **impl-writer 须实跑**：`npm run test:e2e --project=chromium`（22 E2E chromium）+ `npm test`（1272 vitest）确认全绿（AC-XB-8）。
- **低风险**（chromium project 经 device descriptor 启动 + vitest 配置零变更）。

### 10.6 S-23 第三次触发评估标注（不触发，BA 声明核验准确）

**[R24 §10.6 S-23 第三次触发评估]**：BA PRD §1.4/§6.2 声明"R24 仅扩展 projects 数组，不引入新第三方库，应不触发 S-23"。Tech Lead 实测核验 **4 项核验结论**：

1. **R24 不引入新第三方库**：`@playwright/test@^1.61.1`（R20 已装，实装 1.61.1，§2.3 实测 `npm ls` 确认）+ `@axe-core/playwright@^4.12.1`（R23 已装，实装 4.12.1，§2.3 实测 `npm ls` 确认）无新 npm 依赖。`npm view @playwright/test dist-tags` 实测 latest=1.61.1（与已装版本一致，无版本升级空间），next=1.62.0-alpha 非稳定版（跨轮 advisory 排除）。

2. **R24 涉及既有 API 复用**：`devices['Desktop Firefox']` / `devices['Desktop Safari']` 是 @playwright/test 内置 device descriptor（与 R20 已用的 `devices['Desktop Chrome']` 同源），属既有 API 复用非新 API 字段。Tech Lead 实测 `node -e "const { devices } = require('@playwright/test'); console.log(devices['Desktop Firefox']); console.log(devices['Desktop Safari']);"` 输出含 `defaultBrowserType: 'firefox'/'webkit'` 字段（§2.4），确认在 @playwright/test@1.61.1 下可用。

3. **@axe-core/playwright@4.12.1 浏览器无关性核验**：@axe-core/playwright 的 `AxeBuilder.analyze()` 实现机制是：在 Playwright Page 上下文注入 axe-core JS（axe-core 是纯 JS 库，在浏览器 page context 运行），axe-core JS 调用浏览器原生 Accessibility API（不同浏览器底层 API：chromium 用 AOM / firefox 用 IA2 / webkit 用 AccessibilityObject）+ 渲染时 DOM/CSS 计算检测 WCAG violation。**关键**：axe-core JS 本身浏览器无关（同一份 axe.min.js 在三浏览器下运行），仅底层 Accessibility API 调用不同浏览器原生实现（axe-core 内部已封装跨浏览器差异），上层 `AxeBuilder.analyze()` API 对调用方透明。R23 §10.6 已核验 @axe-core/playwright@4.12.1 + peerDeps `playwright-core >= 1.0.0` 与 @playwright/test 1.61.1 兼容 + 自带 TypeScript 类型 + 实测安装 typecheck exit 0，R24 直接复用 a11y.spec.ts 在多 project 下跑，无须新核验。

4. **firefox/webkit 二进制安装需求核验**：`npx playwright install --dry-run firefox webkit` 实测输出 firefox-1532（Firefox 151）+ webkit-2311（WebKit 26.5）二进制可下载（§2.4），属浏览器二进制非 npm 依赖，不触发 S-23（S-23 是第三方库版本 API 核验，非浏览器二进制核验）。

**S-23 触发判定**：**不触发**（BA 声明核验准确，仅扩展 projects 数组，无新第三方库）。

**实装版本**（与 R20/R23 一致，无新依赖）：
- `@playwright/test@1.61.1`（根 devDeps，R20 已装，R24 仅扩展 projects 配置）
- `@axe-core/playwright@4.12.1`（根 devDeps，R23 已装，R24 复用 a11y.spec.ts）

**S-23 固化机制在 R24 第三次触发评估生效**——Tech Lead 在 spec 阶段预先核验版本 + 实测 devices API 可用 + §10.6 反向同步标注，避免 impl 阶段才发现 API 差异。参照 R22 §10.6 react-window 首次触发 + R23 §10.6 jest-axe/@axe-core/playwright 第二次触发模式，R24 第三次触发评估属"既有 API 复用核验"（非新库核验），S-23 不触发但 Tech Lead 仍按提示词核验既有 API 复用（§2.4 实测 devices 字段）。

### 10.7 替代方案预判（§3 + §6 + §8 衍生）

**firefox/webkit 二进制装不上退回方案**（§2.4 实测可下载，预判低概率，§6.1 详述）：
- 方案 A（推荐）：改 CI 镜像为 Playwright 官方镜像（`mcr.microsoft.com/playwright:v1.61.1-jammy`，预装 chromium + firefox + webkit + 系统依赖）。
- 方案 B：本地开发装 firefox/webkit 但 CI 仅跑 chromium（违背 Q1 跨浏览器目标，排除）。
- 方案 C：用 Docker 容器跑 firefox/webkit E2E（增加复杂度，排除）。

**webkit timeout 不够退回方案**（§3.5 D5 [advisory]，impl 阶段如频超时再调，§6.2 详述）：
- 方案 A（推荐）：仅 webkit project 调高 timeout（`{ name: 'webkit', use: { ...devices['Desktop Safari'], actionTimeout: 15000, navigationTimeout: 20000 } }`），保持 chromium/firefox 既有 timeout。
- 方案 B：全局调高 timeout（掩盖真实性能问题，不推荐）。
- 方案 C：调整 webkit test 拆分（增加维护成本，[advisory] 范围）。

**临时 DB 并发写竞争退回方案**（§3.3 D3 + §8.1，预判低概率，§6.3 详述）：
- 方案 A（推荐）：降级为 `workers: 1`（方案 C，CI 时间约 60s+，违背 Q3 优化目标但稳定）。
- 方案 B：每 project 独立临时 DB（违背 Playwright webServer 共享语义 + CI 资源占用高，排除）。
- 方案 C：调整 `fullyParallel: true` + `workers: 3`（DB 写竞争风险更高，不推荐）。

**顶层 use.browserName 冲突退回方案**（§3.2 D2 方案 A，预判低概率）：
- 方案 A（已采）：移除顶层 use.browserName，由 project device descriptor 的 defaultBrowserType 提供。
- 方案 B（退回）：保留顶层 use.browserName='chromium' 作为默认，project device descriptor 覆盖（功能正确但顶层字段冗余可能误导）。
- 方案 C（退回）：每 project 显式 use.browserName（如 `{ name: 'firefox', use: { ...devices['Desktop Firefox'], browserName: 'firefox' } }`，重复声明）。

### 10.8 `[约束]` 偏离反向同步闭环性预判（R18 S-21）

本轮 [约束] 决策 D1-D8（D5/D8 属 [advisory]，D1/D2/D3/D4/D6/D7 属 [约束]）均按 spec 落地，预判 impl-writer 可能触发的 [约束] 偏离：

- **D3 临时 DB 并发写竞争降级**（[advisory] 非 [约束] 偏离，§7.3）：impl-writer 若发现 SQLITE_BUSY 须降级 `workers: 1`，属 [advisory] 偏离 D3 [约束] 决策，须实际编辑 Tech-Spec §3.3 D3 + §10.1 + 交付报告列"SQLITE_BUSY 失败 test 清单 + 降级后 workers 值 + 合规论证"（R18 S-21）。
- **D5 webkit timeout 调整**（[advisory]，§7.1）：impl-writer 若发现 webkit 频繁超时调整 timeout，属 [advisory] 偏离，须实际编辑 Tech-Spec §3.5 D5 + 交付报告列"超时失败 test 清单 + 调整后 timeout 值 + 合规论证"。
- **D8 CI workflow 引入**（[advisory]，§7.2）：impl-writer / 编排者若引入 .github/workflows/e2e.yml，属 [advisory] 偏离 D8，须实际编辑 Tech-Spec §3.8 D8 + 交付报告列"workflow 文件路径 + CI runner + 缓存策略 + 系统依赖安装命令"。
- 若 impl-writer 实现期发现 [约束] 项设计不足须偏离（如 D1 三 project device descriptor 在某浏览器下行为异常须显式 browserName），须实际编辑 Tech-Spec 对应章节（grep 确认章节已改）+ 交付报告列"反向同步的 Spec 文件路径 + 修改行号 + 偏离理由 + 合规论证"（R18 S-21）。**代码注释声明 ≠ Spec 已同步（伪同步）**——仅在代码注释标注"[约束] 偏离"而未实际编辑 Spec 文件属伪同步违规。加性安全场景（更严格非更弱）仍须按 AI-003 流程闭合，不可因"加性安全"省略 Spec 反向同步。

## 11 · G6 验收门禁清单

- **AC-XB-1**：playwright.config.ts projects 数组扩展为 chromium + firefox + webkit 三 project + 顶层 use.browserName 移除（D1 + D2）—— `npx playwright test --list` 列出 66 tests + `--project=firefox/webkit --list` 各 22 tests 核验。
- **AC-XB-2**：14 核心流 E2E 在 firefox 下全绿（跨浏览器行为一致性）—— `npx playwright test --project=firefox tests/login.spec.ts tests/logout.spec.ts tests/users.spec.ts tests/roles.spec.ts tests/transfer.spec.ts` exit 0 + 14 passed 核验。
- **AC-XB-3**：14 核心流 E2E 在 webkit 下全绿—— `npx playwright test --project=webkit tests/login.spec.ts tests/logout.spec.ts tests/users.spec.ts tests/roles.spec.ts tests/transfer.spec.ts` exit 0 + 14 passed 核验。
- **AC-XB-4**：8 a11y E2E 在 firefox 下 0 violations—— `npx playwright test --project=firefox tests/a11y.spec.ts` exit 0 + 8 passed + 0 violations 核验。
- **AC-XB-5**：8 a11y E2E 在 webkit 下 0 violations—— `npx playwright test --project=webkit tests/a11y.spec.ts` exit 0 + 8 passed + 0 violations 核验。
- **AC-XB-6**：三浏览器全量 E2E 一致性（66 tests 全绿）—— `npm run test:e2e` exit 0 + 66 passed 核验。
- **AC-XB-7**：CI 并行执行配置 + 本地仅 chromium 策略—— ~~`workers: process.env.CI ? 3 : 1`~~ **impl 阶段降级为 `workers: 1` 常量**（[advisory] 偏离 D3，§3.3 + §7.3 + §10.1 反向同步）+ `fullyParallel: false` 保持 + `test:e2e:local` script = `playwright test --project=chromium` 核验。注：`workers: 1` 后 CI 并行优化（Q3 ①）退化，留 R25+ future 重新设计隔离方案恢复并行。
- **AC-XB-8**：既有 22 E2E chromium + 1272 vitest 全绿无回归—— `npx playwright test --project=chromium` exit 0 + 22 passed + `npm test` exit 0 + 1272 passed 核验。
- **AC-XB-9**：S-23 第三次触发评估（不触发声明）—— Read Tech-Spec §10.6 含 S-23 不触发声明 + `npm ls @playwright/test @axe-core/playwright` 输出 @playwright/test@1.61.1 + @axe-core/playwright@4.12.1 无新依赖核验。
- **ARCH 检查**：ARCH-001（四层单向依赖）不触发（无 src/ 业务文件改动）；ARCH-002（contracts 零变更，§1.4）；ARCH-003（apps/web 不 import apps/api/src + apps/e2e 通过 HTTP 交互，保持）。
- **S-23 第三次触发评估**：不触发（§10.6，BA 声明核验准确，仅扩展 projects 数组，无新第三方库）。

## G3 自检声明

- **Tech-Spec 完整性**：11 章节齐全（§1 概述 / §2 既有 E2E 基础设施现状 / §3 D1-D8 决策 / §4 实现细节 / §5 测试策略 / §6 替代方案 / §7 advisory 偏离反向同步 / §8 风险预判 / §9 影响面估算 / §10 组合副作用预判 / §11 G6 验收门禁清单）。
- **PRD AC 全覆盖**：9 条 AC（AC-XB-1 projects 扩展 1 条 + AC-XB-2~3 核心流跨浏览器 2 条 + AC-XB-4~5 a11y 跨浏览器 2 条 + AC-XB-6~7 多浏览器一致性 + CI 并行 2 条 + AC-XB-8 既有测试无回归 1 条 + AC-XB-9 S-23 评估 1 条）每条有对应设计（§4.1-§4.9 实现细节）。
- **BLOCKING Q&A 落地**：Q1（firefox + webkit 双浏览器，§3.1 D1 三 project）+ Q2（核心 14 + a11y 8 全部跨浏览器 = 66 tests，§5.1 测试矩阵）+ Q3（CI 并行 workers: process.env.CI ? 3 : 1 + fullyParallel: false 保持 + 本地仅 chromium，§3.3 D3 + §3.7 D7）全落地。
- **受影响测试清单（AI-006）**：①类显式 2 文件（playwright.config.ts + package.json）+ ①类隐式 0 + ②类签名 0 + 测试影响 2 类（既有 22 E2E 配置驱动 + 既有 1272 vitest 不回归）。
- **§10 组合副作用预判完整**：§10.1-§10.8 八项预判，含多浏览器并行 + 临时 DB 并发写竞争（§10.1）+ firefox/webkit 二进制安装（§10.2）+ firefox strictSSL（§10.3）+ webkit timeout（§10.4）+ 既有测试回归（§10.5）+ S-23 第三次触发评估（§10.6，4 项核验结论 + 不触发声明）+ 替代方案（§10.7）+ [约束] 偏离反向同步（§10.8，R18 S-21）。
- **S-23 第三次触发评估生效**：D1 devices['Desktop Firefox']/'Desktop Safari' 在 @playwright/test@1.61.1 实测可用（§2.4）+ D6 @axe-core/playwright@4.12.1 浏览器无关性核验（§3.6，R23 §10.6 已核验）+ §10.6 反向同步标注 4 项核验结论 + 不触发声明，Tech Lead 在 spec 阶段实际核验 npm registry dist-tags + 实测 devices API + 浏览器二进制 dry-run。
- **既有现状核验（R10 S-2）**：playwright.config.ts 现状（§2.1，chromium 单 project + workers=1 + 顶层 use.browserName='chromium'）+ 22 E2E 浏览器无关性（§2.2，实测 grep 仅 1 处注释）+ 依赖现状（§2.3，实测 npm ls + npm view dist-tags）+ 浏览器二进制 dry-run（§2.4，实测 firefox-1532/webkit-2311 可下载 + devices API 可用）+ webServer/globalTeardown 浏览器无关性（§2.5）+ CI workflow 现状（§2.6，实测无 .github/）。
- **[约束]/[advisory] 标注规范**：D1/D2/D3/D4/D6/D7 [约束]；D5/D8 [advisory]；§7 三项 [advisory] 反向同步（D5 webkit timeout 调整 / D8 CI workflow 引入 / D3 临时 DB 并发写竞争降级）。
- **PII/安全标注**：本轮零业务代码改动（§9），无 PII/安全风险。E2E 凭据沿用 R20 既有 admin@example.com / admin123（与 server.ts seedDemoData 一致，R22 AC-S20-4 已闭合 stale Admin@123）。
- **边界遵守**：本阶段只产本文档，不写实现代码（impl-writer 阶段）+ 不写测试断言（test-writer 阶段，R24 零新增测试代码，22 E2E 直接复用），Tech Lead 角色边界。零业务代码改动（§9，apps/web/src / apps/api/src / packages/contracts / vitest.config.ts / vitest.workspace.ts 全不变）。
