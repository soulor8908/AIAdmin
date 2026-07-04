---
doc_type: PRD
id: PRD-CROSS-BROWSER-E2E-001
title: R24 跨浏览器 E2E 覆盖（firefox + webkit 多浏览器扩展 + 核心流与 a11y 一致性验证）
status: decided
owner: ba@team
created: 2026-07-04
aligns: [PRD-E2E-INTRODUCTION-001, PRD-ACCESSIBILITY-DEEPENING-001]
prd_ref: RETRO-ROUND23-001
# Q&A 决策结果摘要（用户已拍板，2026-07-04）：
# Q1=① firefox + webkit 双浏览器（覆盖三大引擎 Chromium/Gecko/WebKit，22 E2E 浏览器无关零适配成本）
# Q2=① 核心 14 + a11y 8 全部跨浏览器（22 × 3 = 66 tests，核心流 + axe-core 多浏览器一致性双重验证）
# Q3=① CI 并行（workers: process.env.CI ? 3 : 1 + fullyParallel: false 保持）+ 本地仅 chromium（本地开发不拖慢）
# S-23 第三次触发评估：R24 仅扩展 projects 数组，不引入新第三方库，应不触发（BA 声明，§1.4 + §6.2 详述）
---

# R24 跨浏览器 E2E 覆盖 + 验证核心流与 a11y 多浏览器一致性

> 本轮（R24）承接 R23 retro §6 候选清单第 1 项——跨浏览器 E2E 覆盖。R20 已建立 chromium 单浏览器 E2E 基础设施（playwright.config.ts + webServer 双进程 + 临时 DB 隔离 + 14 核心流 E2E），R23 已建立 @axe-core/playwright a11y 扫描（8 用例）。R24 在此基础上扩展为 firefox + webkit 多浏览器覆盖，验证核心流 + a11y 在多浏览器下的一致性。
>
> **既有 E2E 基础设施现状盘点**（基于实际 Read 探索，§2 详述）：playwright.config.ts 位于根目录（非 apps/e2e/，R20 D1 决策），现 chromium 单 project（`devices['Desktop Chrome']`）+ 顶层 `use.browserName: 'chromium'` + `workers: 1` + `fullyParallel: false` + webServer 双进程（api 3000 + vite 5173）+ 临时 DB 隔离（`os.tmpdir()` + globalTeardown 清理）。22 E2E 用例（14 核心流 login/users/roles/transfer/logout + 8 a11y 页面扫描）全部使用浏览器无关 Playwright API（`page.goto` / `page.getByLabel` / `page.getByRole` / `page.route` / `AxeBuilder.analyze` 等），零硬编码 `browserType()` / `chromium.launch()` 引用（grep `chromium` 在 apps/e2e/ 仅 1 处注释，非代码）。
>
> **S-23 第三次触发评估**（R21 固化，R22/R23 已两次触发验证）：R24 仅扩展 playwright.config.ts projects 数组（chromium → chromium + firefox + webkit 三 project），不引入新第三方库（`@playwright/test@^1.61.1` R20 已装 + `@axe-core/playwright@^4.12.1` R23 已装），应不触发 S-23（BA 声明，§1.4 + §6.2 详述）。
>
> **PRD 边界**：BA 仅产出本 PRD（含验收标准 + Q&A BLOCKING 决策），不写实现代码、不预定义 projects 数组字段细节（属 Tech Lead 阶段产物，ARCH-002 同源约束）。AC 描述"验收什么"，不描述"怎么实现"。R23 3 项 Reviewer Suggestion（form 缩进 cosmetic / NotificationForm 仅测 create / region 组件级禁用）均属 cosmetic / 测试覆盖扩展类，留 R25 项目维护轮（§5 声明）。R22 Advisory #1（TS baseUrl 弃用）非 R24 引入，留 R25（§5 声明）。

## 1 · 背景与目标

### 1.1 R24 跨浏览器 E2E 覆盖动机

当前 E2E 测试矩阵（apps/e2e 核验，§2 详述）：

- **单浏览器覆盖**：playwright.config.ts 现 chromium 单 project（file:///workspace/mvp/playwright.config.ts:59-64），22 E2E 用例（14 核心流 + 8 a11y）仅在 chromium 引擎下验证。firefox（Gecko 引擎）与 webkit（Safari 引擎）的渲染差异、API 行为差异、CORS/cookie/storage 差异未被覆盖。
- **跨浏览器一致性缺口**：管理后台 MVP 虽以 chromium 为主要目标浏览器（R20 Q4 决策），但跨浏览器一致性是 E2E 标准实践——firefox/webkit 下可能的差异（如 `selectOption` 行为、`page.route` 拦截时序、`localStorage` 持久化、`toHaveURL` 正则匹配、axe-core 规则在不同引擎下的检测结果）未被验证。
- **a11y 多浏览器验证缺口**：R23 @axe-core/playwright 8 用例仅在 chromium 下扫描，firefox/webkit 下 axe-core 规则集（WCAG 2.1 A/AA）的检测结果一致性未验证（axe-core 本身浏览器无关，但渲染时 violation 可能在不同引擎下表现不同）。
- **既有基础设施已为多浏览器扩展打好基础**：R20 playwright.config.ts projects 数组模式天然支持多 project 扩展（Playwright 官方跨浏览器模式），R23 @axe-core/playwright API（`AxeBuilder({ page })`）浏览器无关，R20 `_helpers.ts`（`loginAsAdmin` + `apiCreate*`）全部使用浏览器无关 Playwright API，零跨浏览器适配成本。

### 1.2 R20 / R23 既有成果协同

R20 已建立的 chromium E2E 基础设施 + R23 已建立的 @axe-core/playwright a11y 扫描在 R24 协同扩展（非冲突）：

- **R20 playwright.config.ts**（file:///workspace/mvp/playwright.config.ts）：chromium 单 project + webServer 双进程（api 3000 + vite 5173）+ 临时 DB 隔离（`os.tmpdir()` + globalTeardown）+ retries=0 + workers=1。R24 扩展 projects 数组为 chromium + firefox + webkit 三 project，webServer / globalTeardown / 临时 DB 隔离机制浏览器无关（webServer 在所有 project 共享，临时 DB 在 globalTeardown 清理与浏览器无关）。
- **R20 22 E2E 用例**（14 核心流 + 8 a11y）：全部使用浏览器无关 Playwright API（`page.goto` / `page.getByLabel` / `page.getByRole` / `page.route` / `expect.poll` / `AxeBuilder.analyze`），零硬编码 `browserType()` 引用，跨浏览器适配成本为零（§2.2 详述）。
- **R23 @axe-core/playwright**（file:///workspace/mvp/apps/e2e/tests/a11y.spec.ts）：`AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()` 是浏览器无关 API（axe-core 在 page context 运行，非依赖特定浏览器引擎），R24 直接复用为多浏览器 axe 扫描。

### 1.3 R23 retro §6 候选清单第 1 项承接

R23 retro §6 候选清单（file:///workspace/mvp/docs/retro/round23-retro.md:254-258）三项：

1. **R24 跨浏览器 E2E 覆盖**（firefox/webkit，R20 chromium 基础设施已就绪 + R23 @axe-core/playwright 已为多浏览器验证打好基础）—— E2E 扩展，playwright.config projects 数组增 firefox/webkit 项即可，R23 a11y.spec.ts 可复用为多浏览器 axe 扫描。← **本轮承接**
2. R25 项目维护轮（修复 R22 Advisory #1 TS baseUrl 弃用 + R23 3 项 Suggestion 收尾闭合 + 其他既有/环境性配置问题）—— 元改进轮 #5。
3. R26 screen reader 端到端人工核验（须搭建真实 NVDA/JAWS/VoiceOver 环境，CI 不可重复，成本最高）—— R23 已留 future。

R24 承接第 1 项，聚焦跨浏览器 E2E 扩展，不闭合 R23 3 项 Suggestion（留 R25，§5 声明）。

### 1.4 S-23 第三次触发评估（R21 固化）

R21 固化的 S-23（Tech Lead 第三方库版本 API 核验缺口）在 R22 首次触发（react-window@1.8.11）+ R23 第二次触发（jest-axe@10.0.0 + @axe-core/playwright@4.12.1）验证生效。R24 第三次触发评估：

- **R24 是否引入新第三方库**：否。R24 仅扩展 playwright.config.ts projects 数组（chromium → chromium + firefox + webkit），依赖 `@playwright/test@^1.61.1`（R20 已装，file:///workspace/mvp/package.json:22）+ `@axe-core/playwright@^4.12.1`（R23 已装，file:///workspace/mvp/package.json:21），无新 npm 依赖。
- **R24 是否涉及第三方库 API 字段**：涉及 Playwright projects 配置（`devices['Desktop Firefox']` / `devices['Desktop Safari']`）+ `workers` 配置。这些是 `@playwright/test@1.61.1` 既有 API（R20 已用 `devices['Desktop Chrome']` + `projects` + `workers`），非新 API 字段。Tech Lead 仍须在 spec 阶段按 S-23 提示词核验 `devices['Desktop Firefox']` / `devices['Desktop Safari']` 在 @playwright/test@1.61.1 下可用（参照 R20 chromium 模式），但属既有 API 复用核验非新库核验。
- **S-23 触发判定**：**不触发**（R24 不引入新第三方库，仅扩展既有库 projects 配置）。Tech Lead 须在 Tech-Spec §10 标注"S-23 第三次触发评估：R24 不引入新第三方库，仅扩展 @playwright/test@1.61.1 既有 projects API，S-23 不触发"（§6.2 详述）。

### 1.5 目标（可测的验收方向）

- **目标 XB1**：playwright.config.ts projects 数组扩展为 chromium + firefox + webkit 三 project，22 E2E × 3 浏览器 = 66 tests 全绿。
- **目标 XB2**：14 核心流 E2E 在 firefox + webkit 下全绿（跨浏览器行为一致性）。
- **目标 XB3**：8 a11y E2E 在 firefox + webkit 下 0 violations（axe-core 多浏览器一致性）。
- **目标 XB4**：CI 并行执行配置 + 本地仅 chromium 策略（避免本地开发拖慢）。
- **目标 XB5**：既有 22 E2E chromium + 1272 vitest 全绿无回归（跨浏览器扩展不破坏既有功能）。
- **目标 XB6**：S-23 第三次触发评估完成（不触发声明 + Tech Lead spec 阶段核验既有 API 复用）。

## 2 · 既有 E2E 基础设施盘点（基于实际 Read 探索）

### 2.1 playwright.config.ts 现状（R20 建立）

file:///workspace/mvp/playwright.config.ts（根目录，R20 D1 决策非 apps/e2e/）：

| 配置项 | 现值 | R24 影响 |
|---|---|---|
| `testDir` | `./apps/e2e/tests` | 浏览器无关，三 project 共享 |
| `testMatch` | `**/*.spec.ts` | 浏览器无关 |
| `fullyParallel` | `false` | R24 须评估是否放开（Q3 CI 并行） |
| `workers` | `1` | R24 须评估 CI 并行 workers 数（Q3） |
| `retries` | `0` | 浏览器无关，保持 |
| `timeout` | `60000` | 浏览器无关，保持（firefox/webkit 可能略慢，impl 阶段核验） |
| `outputDir` | `apps/e2e/test-results` | 浏览器无关 |
| `reporter` | `[['list'], ['html']]` | 浏览器无关 |
| `use.baseURL` | `http://localhost:5173` | 浏览器无关（vite dev server 跨浏览器可访问） |
| `use.browserName` | `'chromium'`（顶层） | **R24 风险点**：顶层 browserName 会被 project 级 device descriptor 覆盖，但保留可能误导，impl 阶段须核验是否需移除或保留（§6.1 详述） |
| `use.headless` | `true` | 浏览器无关 |
| `use.trace` | `'on-first-retry'` | 浏览器无关 |
| `use.screenshot` | `'only-on-failure'` | 浏览器无关 |
| `use.navigationTimeout` | `15000` | 浏览器无关 |
| `use.actionTimeout` | `10000` | 浏览器无关 |
| `projects` | `[{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]` | **R24 核心扩展点**：增 firefox + webkit 两 project |
| `webServer` | 双进程（api 3000 + vite 5173） | 浏览器无关，三 project 共享 webServer（Playwright webServer 在所有 project 间共享，非每 project 启动） |
| `globalTeardown` | `./apps/e2e/global-teardown.ts` | 浏览器无关（清理临时 DB 文件） |

**关键扩展点**：`projects` 数组（file:///workspace/mvp/playwright.config.ts:59-64）。R20 现 chromium 单 project，R24 扩展为三 project（chromium + firefox + webkit），每个 project 用 Playwright 内置 device descriptor（`devices['Desktop Chrome']` / `devices['Desktop Firefox']` / `devices['Desktop Safari']`），device descriptor 内含 `browserName` 字段会覆盖顶层 `use.browserName`。

### 2.2 22 E2E 用例清单 + 浏览器无关性核验

R20 14 核心流 E2E + R23 8 a11y E2E = 22 E2E（file:///workspace/mvp/apps/e2e/tests/）：

| spec 文件 | AC 覆盖 | 用例数 | 浏览器无关性核验 |
|---|---|---|---|
| `login.spec.ts` | AC-E1 | 1 | ✅ `page.goto` / `page.getByLabel` / `page.getByRole` / `expect(page).toHaveURL` / `page.evaluate` 全浏览器无关 |
| `logout.spec.ts` | AC-E12/E13/E14 | 3 | ✅ `page.getByRole` / `expect(page).toHaveURL` / `page.evaluate` 全浏览器无关 |
| `users.spec.ts` | AC-E2/E3/E4 | 3 | ✅ `page.goto` / `page.locator` / `page.getByRole` / `page.getByLabel` / `page.route` / `expect.poll` 全浏览器无关 |
| `roles.spec.ts` | AC-E5/E6/E7/E8 | 4 | ✅ `page.goto` / `page.locator` / `page.getByRole` / `page.getByLabel` / `selectOption` / `page.route` / `expect.poll` 全浏览器无关 |
| `transfer.spec.ts` | AC-E9/E10/E11 | 3 | ✅ `page.goto` / `page.getByLabel` / `selectOption` / `page.route` / `route.fetch` / `expect.poll` 全浏览器无关 |
| `a11y.spec.ts` | AC-A11y-8/9 | 8 | ✅ `AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).analyze()` 浏览器无关（axe-core 在 page context 运行）+ `page.goto` / `page.getByLabel` / `page.locator` / `page.getByRole` / `page.waitForLoadState` 全浏览器无关 |

**grep `chromium` 在 apps/e2e/ 核验**：仅 1 处匹配——`a11y.spec.ts:11` 注释"真实 chromium 浏览器渲染"（file:///workspace/mvp/apps/e2e/tests/a11y.spec.ts:11），属文档注释非代码逻辑，无硬编码 `browserType()` / `chromium.launch()` / `page.browser()` 引用。

**_helpers.ts 浏览器无关性核验**（file:///workspace/mvp/apps/e2e/tests/_helpers.ts）：
- `loginAsAdmin(page)`：`page.goto` / `page.getByLabel` / `page.getByRole('button', { name: '登录' }).click` / `page.waitForURL` / `page.evaluate` 全浏览器无关。
- `apiCreateUser/Role/Department` + `apiAssignRole` + `apiLogin` + `apiGetRole`：`request.post/get`（APIRequestContext）全浏览器无关（HTTP 调用与浏览器引擎无关）。
- `uniqueSuffix()`：纯函数，浏览器无关。
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` 常量：与 server.ts seedDemoData 一致（admin@example.com / admin123），浏览器无关。

**结论**：22 E2E 用例 + _helpers.ts 全部浏览器无关，R24 扩展 projects 数组后零代码改动成本（22 E2E 直接复用为多浏览器测试）。

### 2.3 依赖现状

file:///workspace/mvp/package.json 核验：

| 依赖 | 版本 | 引入轮次 | R24 是否需新增 |
|---|---|---|---|
| `@playwright/test` | `^1.61.1` | R20 | 否（已装，R24 仅扩展 projects 配置） |
| `@axe-core/playwright` | `^4.12.1` | R23 | 否（已装，R24 复用 a11y.spec.ts） |
| `@types/node` / `tsx` / `typescript` / `vitest` | 既有 | R12+ | 否 |

**结论**：R24 零新 npm 依赖（S-23 不触发依据，§1.4 + §6.2 详述）。

### 2.4 Playwright 浏览器二进制安装现状

`npx playwright install --dry-run` + `ls ~/.cache/ms-playwright/` 核验：

| 浏览器 | 版本 | 安装状态 | R24 需求 |
|---|---|---|---|
| chromium | 1228（Chrome 149） | ✅ 已装 | 既有，无需安装 |
| chromium_headless_shell | 1228 | ✅ 已装 | 既有 |
| firefox | 1532（Firefox 151） | ❌ **未装** | R24 须 `npx playwright install firefox` |
| webkit | 2311（WebKit 26.5） | ❌ **未装** | R24 须 `npx playwright install webkit` |
| ffmpeg | 1011 | ✅ 已装 | 既有 |

**结论**：R24 须安装 firefox + webkit 浏览器二进制（本地 + CI 均须，§6.3 风险预判）。

### 2.5 webServer / globalTeardown 浏览器无关性核验

- **webServer 双进程**（file:///workspace/mvp/playwright.config.ts:65-90）：api server（`npm start` port 3000）+ vite dev（`npm --workspace @admin/web run dev` port 5173）。Playwright webServer 在所有 project 间共享（非每 project 启动），三 project（chromium/firefox/webkit）共用同一 webServer，浏览器无关。
- **globalTeardown**（file:///workspace/mvp/apps/e2e/global-teardown.ts）：删除临时 DB 文件（`unlinkSync(process.env.E2E_DB_PATH)`），在主进程执行，与浏览器引擎无关。
- **临时 DB 隔离**（file:///workspace/mvp/playwright.config.ts:21-25）：`E2E_DB_PATH = ${tmpdir()}/e2e-admin-${process.pid}-${Date.now()}.db`，每 run 全新临时 DB，三 project 共享同一临时 DB（非每 project 独立 DB），浏览器无关。

**结论**：webServer + globalTeardown + 临时 DB 隔离全部浏览器无关，R24 扩展 projects 数组后无需改动 webServer / globalTeardown 配置。

## 3 · BLOCKING Q&A（3 项，BA 推荐待用户拍板）

### Q1 · 跨浏览器覆盖范围？【BLOCKING】

**影响**：R24 范围 / CI 时间 / 浏览器二进制下载 / 测试矩阵规模。

**背景**：R20 Q4 决策仅 chromium 单浏览器（管理后台 MVP 主要目标浏览器），跨浏览器覆盖列为 future（R20 §5 out of scope）。R24 承接 R23 retro §6 候选第 1 项，扩展范围待定。

**方案**：
- ①firefox + webkit 双浏览器（chromium 已有，覆盖三大引擎 Chromium/Gecko/WebKit）：22 E2E × 3 浏览器 = 66 tests。
- ②仅 firefox（Gecko 引擎，chromium + firefox 双引擎）：22 E2E × 2 浏览器 = 44 tests。
- ③仅 webkit（WebKit 引擎，chromium + webkit 双引擎）：22 E2E × 2 浏览器 = 44 tests。

**BA 推荐：①firefox + webkit 双浏览器**。理由：
1. 跨浏览器 E2E 标准实践是覆盖三大引擎（Chromium / Gecko / WebKit），任一缺失都留一致性盲区。firefox（Gecko）与 webkit（Safari）渲染引擎差异最大（vs chromium 都是 Chromium 系），双引擎覆盖才能验证跨浏览器一致性。
2. R20 22 E2E 全部浏览器无关（§2.2 核验），扩展为 firefox + webkit 零代码改动成本（仅 projects 数组增 2 项），边际成本仅浏览器二进制下载（firefox ~80MB + webkit ~60MB）+ CI 时间（Q3 优化）。
3. ②仅 firefox 或 ③仅 webkit 留另一引擎盲区，违背跨浏览器 E2E 覆盖初衷（R23 retro §6 候选第 1 项原文"跨浏览器 E2E 覆盖"含多浏览器语义）。
4. 66 tests 规模可控（22 E2E × 3，CI 并行后时间增量可控，Q3 优化）。
**阻塞下游**：Tech-Spec projects 数组扩展项（chromium + firefox + webkit 三 project）+ CI 浏览器安装步骤（`npx playwright install firefox webkit`）+ AC 范围（AC-XB-2~6 跨浏览器一致性）。

### Q2 · E2E 用例覆盖范围？【BLOCKING】

**影响**：R24 AC 范围 / 测试矩阵规模 / a11y 多浏览器验证。

**背景**：22 E2E 分两类——14 核心流（login/users/roles/transfer/logout，R20）+ 8 a11y（8 页 axe 扫描，R23）。跨浏览器覆盖范围待定（全做 / 仅核心流 / 仅 a11y）。

**方案**：
- ①核心流 14 + a11y 8 全部跨浏览器（22 × 3 = 66 tests）：验证核心流 + a11y 在多浏览器下一致性，覆盖最全。
- ②仅核心流 14 跨浏览器（14 × 3 = 42 tests）：验证核心流多浏览器一致性，a11y 仅 chromium。
- ③仅 a11y 8 跨浏览器（8 × 3 = 24 tests）：验证 a11y 多浏览器一致性，核心流仅 chromium。

**BA 推荐：①核心流 14 + a11y 8 全部跨浏览器**。理由：
1. 核心流 + a11y 在多浏览器下的一致性是 R24 双重目标（核心流行为一致性 + a11y 扫描一致性），任一缺失都留验证盲区。
2. 22 E2E 全部浏览器无关（§2.2 核验），a11y.spec.ts 的 `AxeBuilder.analyze()` 浏览器无关（axe-core 在 page context 运行），跨浏览器复用零代码改动成本。
3. a11y 多浏览器验证有独立价值：axe-core 规则集（WCAG 2.1 A/AA）在不同引擎下的渲染时 violation 检测结果可能不同（如 firefox/webkit 下 color-contrast 计算差异、aria 属性处理差异），多浏览器扫描能捕获 chromium 未暴露的 a11y 问题。
4. ②仅核心流留 a11y 多浏览器盲区（R23 @axe-core/playwright 仅 chromium 验证，跨浏览器 a11y 一致性未验证，R24 须闭合）。
5. ③仅 a11y 留核心流多浏览器盲区（firefox/webkit 下 login/users/roles/transfer/logout 核心流行为一致性未验证，跨浏览器 E2E 覆盖不完整）。
6. 66 tests 规模可控（Q3 CI 并行优化）。
**阻塞下游**：Tech-Spec AC 范围（AC-XB-2~6 全部跨浏览器）+ 测试矩阵规模（66 tests）。

### Q3 · CI 时间优化策略？【BLOCKING】

**影响**：CI 执行时间 / 本地开发反馈环 / workers 配置。

**背景**：R20 现 `workers: 1` + `fullyParallel: false`（单浏览器串行，临时 DB 单文件并发写竞争规避）。R24 扩展为三浏览器后，66 tests 串行 CI 时间约 60s+（22 × ~3s × 1 worker），可能拖慢 CI。优化策略待定。

**方案**：
- ①CI 并行（`workers: process.env.CI ? 4 : 1` 或 `'50%'`）+ 本地仅 chromium（默认或文档说明 `--project=chromium`）：CI 多浏览器并行加速，本地开发仅 chromium 不拖慢。
- ②串行执行（`workers: 1` 保持）：66 tests 串行，CI 时间约 60s+，本地开发也跑三浏览器（拖慢）。
- ③仅 CI 跑 firefox + webkit（本地仅 chromium）：CI 跑全三浏览器，本地只 chromium，但 CI 仍串行（`workers: 1`）。

**BA 推荐：①CI 并行 + 本地仅 chromium**。理由：
1. R20 `workers: 1` + `fullyParallel: false` 的根因是"临时 DB 单文件，并发写竞争可能冲突"（file:///workspace/mvp/playwright.config.ts:32-33）。R24 评估：每 test 重新登录 + 临时 DB 每 run 全新 seed（非每 test 独立 DB），并发 worker 共享同一临时 DB 的写竞争风险仍在。但 Playwright 默认按 test 文件并行（`fullyParallel: false` 时文件间串行、文件内 test 串行），若放开 `fullyParallel: true` + `workers > 1`，多个 test 文件并发跑可能产生 DB 写竞争（如 AC-E3 创建用户 + AC-E6 创建角色并发写入同一临时 DB）。
2. **关键风险**：临时 DB 并发写竞争。R20 `workers: 1` 规避此风险。R24 若 CI 并行须评估：
   - 方案 a：保持 `fullyParallel: false` + `workers: process.env.CI ? 3 : 1`（3 worker 对应 3 浏览器 project，Playwright 按 project 分配 worker，同 project 内仍串行，跨 project 并行）——**此方案 DB 写竞争风险最低**（每个 project 跑同一组 test 但不同浏览器，DB 操作时序与单浏览器一致）。
   - 方案 b：`fullyParallel: true` + `workers: '50%'`——同 project 内 test 文件并发，DB 写竞争风险高（不推荐）。
   - BA 推荐方案 a（project 间并行 + project 内串行），既加速 CI（三浏览器 project 并行）又规避 DB 写竞争。
3. 本地仅 chromium：开发者本地 `npm run test:e2e` 默认跑 chromium（或文档说明 `--project=chromium`），避免本地装 firefox/webkit 二进制 + 拖慢反馈环（本地改一行前端代码不应等三浏览器 66 tests）。
4. ②串行 CI 时间约 60s+ 可接受但不优化，本地开发也拖慢（违背快速反馈原则）。
5. ③仅 CI 跑 firefox + webkit 但串行，CI 时间未优化。
**阻塞下游**：Tech-Spec workers 配置（`process.env.CI ? 3 : 1` + `fullyParallel: false` 保持）+ 本地默认 chromium project 策略 + CI workflow 浏览器安装步骤。

## 4 · 验收标准（Given/When/Then）

> 全部 AC 须可通过 Playwright 真实浏览器（chromium + firefox + webkit）+ 真实后端（webServer 双进程）端到端验证。AC 编号 XB=Cross-Browser。R20 22 E2E + R23 a11y 协同不破坏。

### 4.1 projects 数组扩展（AC-XB-1）

- **AC-XB-1 · playwright.config.ts projects 数组扩展为 chromium + firefox + webkit 三 project**：GIVEN 现 playwright.config.ts chromium 单 project（`devices['Desktop Chrome']`，file:///workspace/mvp/playwright.config.ts:59-64）/ WHEN 扩展 projects 数组为三 project——chromium（`devices['Desktop Chrome']`）+ firefox（`devices['Desktop Firefox']`）+ webkit（`devices['Desktop Safari']`）/ THEN 三 project 各自独立运行，`npx playwright test --list` 列出 66 tests（22 E2E × 3 浏览器），每个 test 标注所属 project（chromium/firefox/webkit）。验证方式：`npx playwright test --list | wc -l` ≥ 66 + `npx playwright test --project=firefox --list` 列出 22 tests。

### 4.2 核心流跨浏览器一致性（AC-XB-2~3）

- **AC-XB-2 · 14 核心流 E2E 在 firefox 下全绿**：GIVEN firefox project 配置（`devices['Desktop Firefox']`）+ webServer 双进程就绪 / WHEN 运行 `npx playwright test --project=firefox`（覆盖 login.spec.ts AC-E1 + logout.spec.ts AC-E12/E13/E14 + users.spec.ts AC-E2/E3/E4 + roles.spec.ts AC-E5/E6/E7/E8 + transfer.spec.ts AC-E9/E10/E11）/ THEN 14 核心流 E2E 在 firefox 下全部通过（跨浏览器行为一致性，含登录跳转 / token 持久 / 列表渲染 / 创建用户/角色 / versioned If-Match round-trip / 调岗 / 登出 / 路由守卫）。验证方式：`npx playwright test --project=firefox tests/login.spec.ts tests/logout.spec.ts tests/users.spec.ts tests/roles.spec.ts tests/transfer.spec.ts` exit 0 + 14 passed。
- **AC-XB-3 · 14 核心流 E2E 在 webkit 下全绿**：GIVEN webkit project 配置（`devices['Desktop Safari']`）+ webServer 双进程就绪 / WHEN 运行 `npx playwright test --project=webkit`（覆盖 5 spec 14 用例）/ THEN 14 核心流 E2E 在 webkit 下全部通过。验证方式：`npx playwright test --project=webkit tests/login.spec.ts tests/logout.spec.ts tests/users.spec.ts tests/roles.spec.ts tests/transfer.spec.ts` exit 0 + 14 passed。

### 4.3 a11y 跨浏览器一致性（AC-XB-4~5）

- **AC-XB-4 · 8 a11y E2E 在 firefox 下 0 violations**：GIVEN firefox project + @axe-core/playwright 4.12.1 / WHEN 运行 `npx playwright test --project=firefox tests/a11y.spec.ts`（覆盖 LoginPage / UserListPage / RoleListPage / TransferPage / AuditLogPage / DeptTreePage / ReportPage / NotificationListPage 8 页 axe 扫描）/ THEN 8 页在 firefox 下 axe 扫描（`AxeBuilder.withTags(['wcag2a','wcag2aa']).analyze()`）0 violations（WCAG 2.1 A/AA 多浏览器一致性）。验证方式：`npx playwright test --project=firefox tests/a11y.spec.ts` exit 0 + 8 passed + 0 violations。
- **AC-XB-5 · 8 a11y E2E 在 webkit 下 0 violations**：GIVEN webkit project + @axe-core/playwright 4.12.1 / WHEN 运行 `npx playwright test --project=webkit tests/a11y.spec.ts` / THEN 8 页在 webkit 下 axe 扫描 0 violations。验证方式：`npx playwright test --project=webkit tests/a11y.spec.ts` exit 0 + 8 passed + 0 violations。

### 4.4 多浏览器一致性 + CI 并行（AC-XB-6~7）

- **AC-XB-6 · 三浏览器全量 E2E 一致性（66 tests 全绿）**：GIVEN chromium + firefox + webkit 三 project 配置 + webServer 双进程就绪 / WHEN 运行 `npm run test:e2e`（无 `--project` 过滤，跑全三 project）/ THEN 66 tests（22 E2E × 3 浏览器）全部通过，三浏览器行为一致（核心流 + a11y 跨浏览器无差异）。验证方式：`npm run test:e2e` exit 0 + 66 passed。
- **AC-XB-7 · CI 并行执行配置 + 本地仅 chromium 策略**：GIVEN Q3 推荐①CI 并行 + 本地仅 chromium / WHEN playwright.config.ts 配置 `workers: process.env.CI ? 3 : 1`（CI 3 worker 对应 3 浏览器 project 并行，本地 1 worker）+ `fullyParallel: false` 保持（规避临时 DB 并发写竞争）+ 本地默认 chromium project（文档说明或 `test:e2e:local` script 限定 `--project=chromium`）/ THEN CI 三浏览器 project 间并行执行（同 project 内 test 串行，DB 写竞争规避），本地开发仅跑 chromium 不拖慢反馈环。验证方式：CI 环境 `CI=true npx playwright test` 三 project 并行（日志可见 3 worker）+ 本地 `npm run test:e2e` 仅 chromium（或 `npm run test:e2e:local` = `playwright test --project=chromium`）。

### 4.5 既有测试无回归 + S-23 评估（AC-XB-8~9）

- **AC-XB-8 · 既有 22 E2E chromium + 1272 vitest 全绿无回归**：GIVEN 跨浏览器扩展改动（playwright.config.ts projects 数组 + workers 配置）/ WHEN 运行 `npx playwright test --project=chromium` + `npm test`（vitest run 全量）/ THEN 既有 22 E2E chromium 全部通过（核心流 14 + a11y 8，R20/R23 成果不破坏）+ 既有 1272 vitest 全部通过（无回归，跨浏览器扩展不改 apps/web / apps/api / packages/contracts 源码）。验证方式：`npx playwright test --project=chromium` exit 0 + 22 passed + `npm test` exit 0 + 1272 passed。
- **AC-XB-9 · S-23 第三次触发评估（不触发声明）**：GIVEN R24 仅扩展 playwright.config.ts projects 数组 + workers 配置 / WHEN 核验依赖——`@playwright/test@^1.61.1`（R20 已装）+ `@axe-core/playwright@^4.12.1`（R23 已装）无新 npm 依赖 / THEN S-23（Tech Lead 第三方库版本 API 核验缺口）不触发（R24 不引入新第三方库，仅扩展既有库 projects 配置），Tech Lead 须在 Tech-Spec §10 标注"S-23 第三次触发评估：R24 不引入新第三方库，仅扩展 @playwright/test@1.61.1 既有 projects API + devices['Desktop Firefox'] / devices['Desktop Safari'] 既有 API 复用，S-23 不触发"+ 核验 `devices['Desktop Firefox']` / `devices['Desktop Safari']` 在 @playwright/test@1.61.1 下可用（参照 R20 chromium 模式，属既有 API 复用核验非新库核验）。验证方式：Read Tech-Spec §10 含 S-23 不触发声明 + `npm ls @playwright/test @axe-core/playwright` 无新依赖。

## 5 · Out of scope（范围外）

- **R23 3 项 Reviewer Suggestion** —— R23 retro §3 三项（form 包裹后缩进 cosmetic / NotificationForm 仅测 create 模式 / region 组件级禁用分工合理）均属 cosmetic / 测试覆盖扩展类，留 R25 项目维护轮收尾闭合（R24 聚焦跨浏览器 E2E，不顺带闭合以保持范围聚焦）。
- **R22 Advisory #1 TS baseUrl 弃用** —— R22 retro §2 Advisory #1 既有/环境性 TS 配置问题（非 R22/R23 引入，非 R24 引入），留 R25 项目维护轮处理（方案 A 加 `ignoreDeprecations: "5.0"` / 方案 B 迁移 paths / 方案 C 固定 TS 版本，R22 retro §2 已详述）。
- **移动端浏览器 E2E（iOS Safari / Android Chrome）** —— 管理后台 MVP 仅桌面端，不做移动端视口 E2E（与 R20/R22/R23 §5 out of scope 一致）。Playwright `devices['Pixel 7']` / `devices['iPhone 14']` 等移动端 device descriptor 列为 future。
- **Edge / Opera 等其他 Chromium 系浏览器** —— Edge/Opera 基于 Chromium 引擎，与 chromium project 行为一致，无独立验证价值（chromium project 已覆盖 Chromium 引擎）。如需显式 Edge project 可走 Playwright `channel: 'msedge'`，列为 future。
- **视觉回归 / 截图对比测试** —— R24 跨浏览器 E2E 仅功能流 + a11y 一致性验证，不做像素级视觉对比（与 R20 §5 out of scope 一致）。
- **性能 / 压力测试** —— R24 跨浏览器 E2E 非性能测试，不做多浏览器性能对比（与 R20/R22 §5 out of scope 一致）。
- **contracts 改动** —— R24 零 contracts 变更（跨浏览器扩展是测试基础设施层改进，不改 packages/contracts）。
- **新规则 / check-rules.mjs 改动** —— R24 无规则改动（跨浏览器 E2E 规则不在 .trae/rules/ 范围）。
- **非核心页 E2E 覆盖扩展** —— R20 核心流 5 spec（login/users/roles/transfer/logout）+ R23 a11y 8 页已覆盖核心场景，departments/audit-logs/notifications/reports 页的非 a11y E2E 列为 future（与 R20 §5 一致）。
- **screen reader 端到端人工核验** —— R23 retro §6 候选第 3 项，留 R26+ future（需 NVDA/JAWS/VoiceOver 真实屏幕阅读器环境 + 人工核验流程，CI 不可重复）。

## 6 · 风险预判

### 6.1 顶层 use.browserName 与 project device descriptor 冲突风险

**风险**：playwright.config.ts 顶层 `use.browserName: 'chromium'`（file:///workspace/mvp/playwright.config.ts:48）会被 project 级 device descriptor 的 `browserName` 覆盖（`devices['Desktop Firefox']` 含 `browserName: 'firefox'`，`devices['Desktop Safari']` 含 `browserName: 'webkit'`），但保留顶层 `browserName: 'chromium'` 可能误导（看似强制 chromium）或与 project 级冲突（若 project 未显式 device descriptor）。

**预判**：impl 阶段须核验：
- 方案 a：移除顶层 `use.browserName: 'chromium'`，由 project 级 device descriptor 提供浏览器类型（推荐，语义清晰，每个 project 显式声明 browserName）。
- 方案 b：保留顶层 `use.browserName: 'chromium'`，project 级 device descriptor 覆盖（Playwright 语义：project 级 use 覆盖顶层 use，功能正确但顶层字段冗余可能误导）。
- BA 推荐：方案 a（移除顶层 browserName，由 project 显式声明），但属 Tech Lead 实现细节（AC-XB-1 描述"验收什么"不描述"怎么实现"）。

**§10 替代方案**（若 device descriptor 与顶层冲突导致 firefox/webkit 误用 chromium 引擎）：①显式在每个 project use 内声明 `browserName`（如 `{ name: 'firefox', use: { ...devices['Desktop Firefox'], browserName: 'firefox' } }`）；②移除顶层 `use.browserName`；③按 Playwright 官方跨浏览器示例重构（参照 Playwright 官方 `projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, ...]` 模式）。

### 6.2 S-23 第三次触发评估（不触发声明）

**风险**：R24 扩展 projects 数组涉及 `devices['Desktop Firefox']` / `devices['Desktop Safari']` API 字段，若 @playwright/test@1.61.1 下这些 device descriptor 不可用或字段差异，属 Tech Lead 版本核验缺口（S-23 触发）。

**预判**：S-23 第三次触发评估：
- **R24 不引入新第三方库**：`@playwright/test@^1.61.1`（R20 已装）+ `@axe-core/playwright@^4.12.1`（R23 已装）无新 npm 依赖（§2.3 核验）。
- **R24 涉及既有 API 复用**：`devices['Desktop Firefox']` / `devices['Desktop Safari']` 是 @playwright/test 内置 device descriptor（与 R20 已用的 `devices['Desktop Chrome']` 同源），属既有 API 复用非新 API 字段。
- **S-23 触发判定**：**不触发**。但 Tech Lead 仍须在 spec 阶段按 S-23 提示词核验 `devices['Desktop Firefox']` / `devices['Desktop Safari']` 在 @playwright/test@1.61.1 下可用（参照 R20 chromium 模式），属既有 API 复用核验（非新库核验），在 Tech-Spec §10 标注"S-23 第三次触发评估：不触发（R24 不引入新第三方库，仅扩展既有 @playwright/test@1.61.1 projects API）"。

**§10 替代方案**（若 `devices['Desktop Firefox']` / `devices['Desktop Safari']` 在 @playwright/test@1.61.1 下不可用或字段差异）：①显式声明 `{ name: 'firefox', use: { browserName: 'firefox', viewport: { width: 1280, height: 720 } } }`（手动配置非用 device descriptor）；②升级 @playwright/test（跨轮 advisory，违背 R20 既有版本约束）；③回退仅 chromium（放弃跨浏览器覆盖，违背 R24 目标）。

### 6.3 firefox/webkit 浏览器二进制未装风险

**风险**：firefox-1532 + webkit-2311 二进制未装（§2.4 核验），R24 须 `npx playwright install firefox webkit` 安装。本地开发 + CI 均须安装，否则 `npx playwright test --project=firefox/webkit` 报"browser not found"。

**预判**：
- 本地开发：开发者首次跑 firefox/webkit E2E 须 `npx playwright install firefox webkit`（~140MB 下载）。
- CI：CI workflow 须增 `npx playwright install --with-deps firefox webkit` 步骤（R20 Q4 决策仅 chromium + `--with-deps`，R24 扩展为三浏览器 + `--with-deps`），缓存 `~/.cache/ms-playwright` 加速后续 run（R20 已缓存 chromium，R24 增 firefox/webkit 缓存）。
- 系统依赖：firefox/webkit 须 `--with-deps` 装系统依赖（libnss3 / libgtk-3 / libasound2 等），CI 镜像须支持。

**§10 替代方案**（若 CI 镜像不支持 firefox/webkit 系统依赖）：①改 CI 镜像为 Playwright 官方镜像（`mcr.microsoft.com/playwright`）；②本地开发装 firefox/webkit 但 CI 仅跑 chromium（违背 Q1 跨浏览器目标）；③用 Docker 容器跑 firefox/webkit E2E（增加复杂度）。

### 6.4 firefox strictSSL / webkit CORS 差异风险

**风险**：firefox 默认 `strictSSL` 可能影响 webServer 自签证书场景（R20 webServer 用 `http://localhost` 非 https，应不受影响，但须核验）；webkit（Safari 引擎）CORS / cookie / localStorage 行为可能与 chromium 差异（如 `SameSite` cookie 策略、`localStorage` 持久化时机）。

**预判**：
- R20 webServer 用 `http://localhost:5173`（vite dev）+ `http://localhost:3000`（api server），非 https，firefox strictSSL 不触发（仅 https 场景才校验证书）。
- webkit CORS：R20 server.ts 已启用 CORS（`Access-Control-Allow-Origin`），跨域 fetch 在 webkit 下应正常。impl 阶段须 E2E 验证 webkit 下 login（POST /v1/auth/login 跨域 fetch）+ API setup（page.request 跨域调用）正常。
- webkit localStorage：R20 _helpers.ts `loginAsAdmin` 从 localStorage 读 admin_token（file:///workspace/mvp/apps/e2e/tests/_helpers.ts:32-40），webkit 下 localStorage 持久化时机可能延迟（如页面跳转后立即读可能未写入），impl 阶段须核验 `page.waitForURL('**/users')` 后 localStorage 已写入（R20 已有 `waitForURL` 等待，应覆盖）。

**§10 替代方案**（若 webkit localStorage 读取时机问题）：①增 `page.waitForFunction(() => !!window.localStorage.getItem('admin_token'))` 显式等待；②改用 `storageState` 注入（R20 [advisory] 非 storageState，改 storageState 偏离 R20 决策，advisory 反向同步）；③放宽 actionTimeout（webKit 慢）。

### 6.5 临时 DB 并发写竞争风险（Q3 CI 并行）

**风险**：Q3 推荐①CI 并行（`workers: process.env.CI ? 3 : 1`），若 `fullyParallel: true` + `workers > 1`，多个 test 文件并发跑同一临时 DB 产生写竞争（如 AC-E3 创建用户 + AC-E6 创建角色并发写入，主键冲突或 WAL 锁竞争）。

**预判**：
- BA 推荐方案 a：`fullyParallel: false` 保持 + `workers: process.env.CI ? 3 : 1`（3 worker 对应 3 浏览器 project，Playwright 按 project 分配 worker，同 project 内 test 串行，跨 project 并行）——**此方案 DB 写竞争风险最低**（每个 project 跑同一组 test 但不同浏览器，DB 操作时序与单浏览器一致，三 project 共享 DB 但操作不并发）。
- 关键：三 project（chromium/firefox/webkit）共享同一临时 DB（file:///workspace/mvp/playwright.config.ts:21），若三 project 并发跑同一 test（如三浏览器同时跑 AC-E3 创建用户），三浏览器同时 POST /v1/users 写同一临时 DB，可能产生并发写（邮箱唯一性约束可能冲突，但 R20 `uniqueSuffix()` 用 `Date.now() + Math.random()` 保证唯一，应不冲突；但 WAL 锁竞争可能）。
- impl 阶段须 E2E 验证 CI 并行下 66 tests 全绿（AC-XB-6 + AC-XB-7 验证）。

**§10 替代方案**（若 CI 并行 DB 写竞争）：①降级为 `workers: 1`（串行，CI 时间约 60s+，违背 Q3 优化目标）；②每 project 独立临时 DB（`E2E_DB_PATH` 含 project name 后缀，但 webServer 在 project 间共享无法每 project 独立 DB，除非每 project 启动独立 webServer，违背 Playwright webServer 共享语义）；③`fullyParallel: false` + `workers: 3`（project 间并行，同 project 内串行，BA 推荐方案 a）。

### 6.6 firefox/webkit 下 page.route 拦截时序差异风险

**风险**：R20 核心流 E2E 用 `page.route` 拦截 PATCH/POST 请求断言 If-Match header（file:///workspace/mvp/apps/e2e/tests/users.spec.ts:81-85 + roles.spec.ts:76-80 + transfer.spec.ts:73-77），firefox/webkit 下 `page.route` 拦截时序可能与 chromium 差异（如注册 route 后立即点击按钮，firefox 可能在 route 注册前发起请求）。

**预判**：R20 已在点击按钮前注册 route（`await page.route(...)` 在 `await click()` 前），firefox/webkit 应一致。但 impl 阶段须 E2E 验证 firefox/webkit 下 `expect.poll(() => capturedIfMatch, { timeout: 15000 }).toBeTruthy()` 能捕获（R20 已用 `expect.poll` + 15s timeout 容错，应覆盖时序差异）。

**§10 替代方案**（若 firefox/webkit route 拦截时序问题）：①增 `page.waitForLoadState('networkidle')` 后再注册 route；②用 `page.routeFromHAR` 替代（增加 HAR 维护成本）；③放宽 `expect.poll` timeout（webKit/firefox 慢）。

## G1 自检声明

- **PRD 完整性**：章节齐全（背景与目标 / 既有 E2E 基础设施盘点 / BLOCKING Q&A / AC 列表 / 范围外 / 风险预判）+ frontmatter（id/status=draft/Q&A 摘要/S-23 评估声明）+ Out of scope。
- **验收标准可测**：9 条 AC（AC-XB-1 projects 扩展 1 条 + AC-XB-2~3 核心流跨浏览器 2 条 + AC-XB-4~5 a11y 跨浏览器 2 条 + AC-XB-6~7 多浏览器一致性 + CI 并行 2 条 + AC-XB-8 既有测试无回归 1 条 + AC-XB-9 S-23 评估 1 条），每条 Given/When/Then 可被 Playwright 真实浏览器（chromium + firefox + webkit）端到端验证 + `npm test` vitest 全量验证 + Read Tech-Spec §10 S-23 声明核验。
- **BLOCKING 项待拍板**：Q1-Q3 全部待用户拍板（status=draft 前提），每个 Q 给出 BA 推荐方案（Q1=① firefox + webkit 双浏览器 / Q2=① 核心 14 + a11y 8 全部跨浏览器 / Q3=① CI 并行 + 本地仅 chromium）+ 理由 + 阻塞下游。
- **既有现状核验**：Read playwright.config.ts（根目录，非 apps/e2e/，§2.1 核验 chromium 单 project + webServer 双进程 + workers=1 + 顶层 use.browserName='chromium'）+ Read _helpers.ts（§2.2 浏览器无关性核验，loginAsAdmin + apiCreate* 全浏览器无关）+ Read a11y.spec.ts（§2.2 AxeBuilder 浏览器无关）+ Read login/logout/users/roles/transfer.spec.ts（§2.2 22 E2E 全部浏览器无关）+ Read global-teardown.ts（§2.5 浏览器无关）+ Read package.json（§2.3 @playwright/test@^1.61.1 + @axe-core/playwright@^4.12.1 已装，无新依赖）+ Grep `chromium` 在 apps/e2e/（§2.2 仅 1 处注释非代码）+ `npx playwright install --dry-run` + `ls ~/.cache/ms-playwright/`（§2.4 firefox/webkit 未装，须安装）+ Read R23 retro §6（§1.3 候选第 1 项确认）+ Read R23 PRD（模板参照）+ Read R20 PRD（AC-E1~E14 编号参照）+ Read spec-first-workflow.md §2.2 BA 提示词（BA 角色职责参照）。
- **边界遵守**：未预定义 projects 数组字段细节（ARCH-002 同源，属 Tech Lead）；未写实现代码；AC 描述"验收什么"不描述"怎么实现"；S-23 衍生约束——R24 不涉及凭据/seed 值（22 E2E 复用 R20 既有凭据 admin@example.com/admin123，不新增凭据字段），S-23 衍生凭据核验不触发。
- **Out of scope 明确**：R23 3 项 Suggestion / R22 Advisory #1 TS baseUrl 弃用 / 移动端浏览器 / Edge Opera / 视觉回归 / 性能测试 / contracts 改动 / 新规则改动 / 非核心页 E2E / screen reader 人工核验 均列为 out of scope。
- **既有测试不破坏约束**：AC-XB-8 明确既有 22 E2E chromium + 1272 vitest 全绿无回归（R20 22 E2E + R23 a11y 协同，跨浏览器扩展不改 apps/web / apps/api / packages/contracts 源码）。
- **S-23 第三次触发评估**：AC-XB-9 + §1.4 + §6.2 声明 R24 不引入新第三方库（仅扩展既有 @playwright/test@1.61.1 projects API），S-23 不触发，Tech Lead 须在 Tech-Spec §10 标注评估结论 + 核验 `devices['Desktop Firefox']` / `devices['Desktop Safari']` 既有 API 复用。
