---
doc_type: Tech-Spec
id: TECH-E2E-INTRODUCTION-001
title: R20 引入 Playwright E2E 测试 + 闭合 S-5（vitest projects 模式分离 unit/e2e 环境）Tech-Spec
prd_ref: PRD-E2E-INTRODUCTION-001
status: ready-for-impl
owner: tech-lead@team
created: 2026-07-04
extends: TECH-WEB-AUTH-USER-001
aligns: [TECH-PERSIST-001, TECH-AUTH-001, TECH-OPTIMISTIC-LOCKING-001, TECH-ETAG-CACHING-001]
---

# TECH-E2E-INTRODUCTION-001 · R20 引入 Playwright E2E 测试 + 闭合 S-5 Tech-Spec

> 派生自 PRD-E2E-INTRODUCTION-001（status=decided，19 条 AC：AC-E1~E14 共 14 条 E2E + AC-S5-1~S5-5 共 5 条 S-5 闭合 + 5 条 BLOCKING Q&A 全拍板）。
> 本轮承接 R19 retro 圈定的两项测试基础设施改进：
> - **E2E 引入**：`@playwright/test`（`^1.61.1`）已在根 devDependencies 但未启用，本轮正式引入 Playwright，覆盖 R19 retro 已圈定的核心流（login → users → roles → transfer → 登出全链路）。
> - **S-5 闭合**：R12 遗留 advisory——`vitest.config.ts` 单一 `environment='node'` + 单一 `setupFiles=['apps/web/test/setup.ts']` 全局副作用，改用 vitest projects 模式分离 api（node 环境，无 jest-dom）与 web（jsdom 环境 + jest-dom）。
> **contracts 本轮零变更**（§5）；**errors.ts 零变更**；**errorMapping.ts 零变更**；**server.ts / domain / repository / service 零变更**。改动范围：新增 `apps/e2e/`（Playwright config + tests + fixtures）+ `vitest.config.ts` 配置重构（projects 模式）+ `package.json` 追加 `test:e2e` 脚本 + `.gitignore` 追加 `/data/`。
> 本阶段只产本文档；Playwright config / E2E 测试用例 / vitest.config.ts 改动均由 impl-writer 阶段落地（§3 描述为设计 + 实现提示，不写实现代码）。

## 1. 覆盖范围

### 1.1 E2E 引入（Playwright + apps/e2e/ + webServer + 临时 DB）

引入 Playwright 作为 E2E 测试 runner，建立"真实浏览器（chromium headless）+ 真实后端（webServer 自动启动 `npm start`）+ 真实前端（vite dev server 端口 5173）"三真实联调的端到端验证能力，覆盖 R19 retro 圈定的 5 个核心流（login / users / roles / transfer / 登出，对应 PRD AC-E1~E14）。

E2E 测试目录独立为 `apps/e2e/`（与 `apps/api` / `apps/web` 平级，PRD Q1 BLOCKING 决策），跨 api+web 边界。数据隔离用独立临时 DB（`DB_PATH` 指向 `os.tmpdir()` 临时文件，每 run 全新 seed admin，PRD Q5 BLOCKING 决策），不污染开发库 `./data/admin.db`。

E2E 不计入默认 `npm test`（vitest run），独立 `npm run test:e2e`（`playwright test`，PRD Q3 BLOCKING 决策）；CI 浏览器仅 chromium（`npx playwright install --with-deps chromium`，PRD Q4 BLOCKING 决策）。

### 1.2 S-5 闭合（vitest projects 模式分离 api node / web jsdom）

闭合 R12 遗留 advisory——`vitest.config.ts`（§2.1）当前用单一 `environment='node'`（满足后端）+ 单一 `setupFiles=['apps/web/test/setup.ts']`（全局注入 jest-dom）。后果：jest-dom 通过 `setupFiles` 加载到所有测试含后端测试，后端 node 环境被 DOM 相关全局副作用污染；`environment='node'` 对前端 .tsx 测试是错配（侥幸工作因 Testing Library mock 在 node 也能跑）。

闭合方向（PRD AC-S5-1）：vitest projects 模式——声明两个独立 project：
- **api project**：`environment='node'`，`include=['apps/api/test/**']`，**无 setupFiles**（jest-dom 不注入，AC-S5-2）。
- **web project**：`environment='jsdom'`，`include=['apps/web/test/**']`，`setupFiles=['apps/web/test/setup.ts']`（jest-dom 在 jsdom 环境内生效，AC-S5-3）。

`setupFiles` 从全局（test 顶层）移入 web project 内（API 测试不再加载 jest-dom）。既有 1256 测试须全绿无回归（AC-S5-4）。

### 1.3 不改 contracts（零联动，ARCH-002 保持）

本轮 **contracts 零变更**（§5）、**errors.ts 零变更**、**errorMapping.ts 零变更**、**server.ts / router / service / repository / domain 零变更**。所有改动在测试基础设施层（新增 `apps/e2e/` + `vitest.config.ts` 配置重构 + `package.json` 脚本 + `.gitignore`），不触碰业务层与契约层。ARCH-002（contracts 纯净层）保持，ARCH-001（四层反向依赖）不触发（无 src/ 业务文件改动）。

## 2. 既有现状核验（关键资产盘点）

> R10 S-2 教训：Spec 须核验既有现状。本节核验 5 项关键资产，确认改动边界。

### 2.1 vitest.config.ts 现状（S-5 根因确认）

`/workspace/mvp/vitest.config.ts`（完整 52 行）：

```ts
export default defineConfig({
  plugins: [{ name: 'externalize-node-sqlite', enforce: 'pre', /* node:sqlite 拦截 */ }],
  test: {
    globals: true,
    environment: 'node',                       // ← S-5 根因：单一 node 环境（前端错配）
    testTimeout: 20000,                        // R15 impl-writer 提升（user-event 逐字符）
    include: ['apps/*/test/**/*.{test,spec}.{ts,tsx}', 'packages/*/test/**/*.test.ts'],
    setupFiles: ['apps/web/test/setup.ts'],     // ← S-5 根因：jest-dom 全局注入（污染后端）
    coverage: { /* v8, lines/functions 80, branches 70 */ },
  },
  resolve: { alias: { '@admin/contracts': '...' } },
});
```

**S-5 根因确认**：`environment='node'` + `setupFiles=['apps/web/test/setup.ts']` 均在 `test` 顶层（全局），对所有匹配 `include` 的测试生效（含 `apps/api/test/**` 后端测试）。后端测试加载 `apps/web/test/setup.ts`（仅 `import '@testing-library/jest-dom'`），jest-dom matcher 注入全局，污染后端 node 环境（PRD §1.3 现状确认）。

**S-5 闭合改动点**：`environment` 与 `setupFiles` 从 `test` 顶层移除，下沉到 `projects` 数组各 project 内（§3.5 / D4）。`test.globals` / `test.testTimeout` / `test.include` / `test.coverage` / `resolve.alias` / `plugins`（node:sqlite 拦截）保持不变（这些是跨 project 共享配置，须留顶层）。

### 2.2 vite.config.ts + apps/web/package.json（前端 dev 启动方式）

`/workspace/mvp/apps/web/vite.config.ts`：`plugins=[react()]` + `resolve.alias` + `server.proxy['/v1']='http://localhost:3000'`（dev proxy /v1 → 后端 3000 避免 CORS）。

`/workspace/mvp/apps/web/package.json` scripts：
```json
{ "dev": "vite", "build": "tsc --noEmit && vite build", "preview": "vite preview", "test": "vitest run" }
```

**关键结论**：vite dev server 默认端口 5173（vite 5.x 默认），可通过 `npm --workspace @admin/web run dev` 或 `npx vite --config apps/web/vite.config.ts` 启动。webServer 配置（D2）须启动 vite dev（5173）+ api server（3000）双进程，前端通过 dev proxy `/v1` → 3000 调后端，E2E baseURL 指向 `http://localhost:5173`（D7）。

### 2.3 package.json 根脚本与依赖

`/workspace/mvp/package.json`（根）scripts：`typecheck` / `test=vitest run` / `test:watch` / `lint:rules` / `gen:snapshot` / `gen:retro-index` / `start=tsx apps/api/src/server.ts` / `dev=tsx watch apps/api/src/server.ts`。

devDependencies 本轮新增 `@playwright/test: ^1.61.1`（R22 AC-S20-3 修正：原文称"已在 devDependencies"为误差，实际 R20 才加入 devDeps）。

**改动点**：scripts 追加 `"test:e2e": "playwright test"`（D5 / §3.6）。`npm test` 不变（仍 `vitest run`，AC-S5-4 全绿验证）。

### 2.4 server.ts 启动与 seed 现状（凭据差异标注）

`/workspace/mvp/apps/api/src/server.ts` 启动逻辑（L78-147）：

```ts
const db = createDb();            // createDb 读 process.env.DB_PATH ?? './data/admin.db'
applySchema(db);                 // DDL 建表（CREATE IF NOT EXISTS，幂等）
seedAdmin(db);                   // 幂等 seed 内置 admin 角色（INSERT OR IGNORE）
// ... repository / service 组装 ...
seedDemoData();                  // 幂等 seed admin 用户（admin@example.com / admin123）
function seedDemoData() {
  if (userRepo.findByEmail('admin@example.com')) return;  // 幂等
  userRepo.insert({ id: ADMIN_USER_ID, name: 'admin', email: 'admin@example.com',
    status: 'active', password_hash: hashPassword('admin123'), /* ... */ });
}
// ... PORT = Number(process.env.PORT ?? 3000); server.listen(PORT, ...) ...
```

**关键发现（load-bearing，须 impl-writer 关注）**：PRD AC-E1 已修正为凭据 `admin@example.com / admin123`（R22 AC-S20-4 消除 stale Admin@123：原 PRD 字面 `Admin@123` 是 BA 文档笔误，PRD 已被 R20 编排者修正为 `admin123`）。server.ts `seedDemoData()` 实际 seed 凭据为 `admin@example.com / admin123`（小写 a、无 `@`，L133 注释明示"seed admin 凭据 admin@example.com/admin123"），与 PRD 已对齐。

**E2E 登录凭据采用实际 seed 值 `admin@example.com / admin123`**（与 server.ts 一致，否则 AC-E1 登录必失败）。PRD AC-E1 已修正为 `admin123`（R22 AC-S20-4 消除 stale Admin@123：原 BA 文档笔误 `Admin@123` 已由 R20 编排者修正）。

`createDb`（apps/api/src/db/connection.ts L26-38）读 `process.env.DB_PATH ?? './data/admin.db'`，故 webServer env 注入 `DB_PATH=<os.tmpdir()>/e2e-<pid>-<ts>.db` 即可使 server 启动时建临时库 + seed（D3 / §3.3）。

### 2.5 .gitignore 现状（/data 未忽略）

`/workspace/mvp/.gitignore`：`node_modules/` / `dist/` / `build/` / `*.log` / `.env` / `.env.local` / `.DS_Store` / `coverage/` / `.vitest-cache/`。

**未含 `/data/`**。dev `npm start` 会在仓库根创建 `./data/admin.db`（createDb mkdirSync recursive），该文件目前未被 gitignore 忽略，存在被误提交风险。本轮虽通过 DB_PATH 隔离确保 E2E 不触碰 `./data/admin.db`，但 dev `npm start` 仍会创建该文件。**[advisory] 本轮追加 `/data/` 到 .gitignore**（§3.8 / D8），闭合 dev DB 文件未忽略的工程隐患（与 E2E 数据隔离同源——均避免 DB 文件污染版本库）。

## 3. 实现方案（Playwright + apps/e2e/ + 临时 DB + webServer + vitest projects）

> 每节显式标注 `[约束]`（默认禁止偏离，偏离须经 AI-003 流程 + Reviewer 确认）或 `[advisory]`（允许偏离，须反向同步 §7）。本节为设计 + 实现提示，不写实现代码（impl-writer 职责）。

### 3.1 `[约束]` apps/e2e/ 目录结构（PRD Q1）

新增 `apps/e2e/`（与 `apps/api` / `apps/web` 平级），目录结构：

```
apps/e2e/
├── fixtures/                  # E2E fixtures（如登录态注入、API helper）
│   └── auth.ts                # （可选）login fixture：执行 AC-E1 登录后注入 storageState
├── tests/                     # E2E 测试用例（每条 AC 对应一个 test）
│   ├── login.spec.ts          # AC-E1（登录成功跳转）
│   ├── users.spec.ts          # AC-E2/E3/E4（列表/创建/状态切换 versioned）
│   ├── roles.spec.ts          # AC-E5/E6/E7/E8（列表/创建/设父 versioned/删除）
│   ├── transfer.spec.ts       # AC-E9/E10/E11（表单渲染/提交/持久确认）
│   └── logout.spec.ts         # AC-E12/E13/E14（登出跳转/token 清除/路由守卫）
└── playwright.config.ts       # Playwright 配置（D1 决策位置，§3.2）
```

**`[约束]` 理由**：PRD Q1 BLOCKING 决策——E2E 跨 api+web 边界（真实浏览器调真实后端），是独立"应用"（Playwright config + 真实浏览器 + 真实后端编排），与 monorepo `apps/*` 平级对齐既有结构。放 `apps/web/test/e2e/` 会暗示"仅测 web"语义错误；根目录 `e2e/` 违背 apps/* 约定。

**E2E 测试文件组织（AC 映射，§3.7）**：按核心流分 5 个 `.spec.ts` 文件（login / users / roles / transfer / logout），每文件含若干 test，覆盖 PRD AC-E1~E14。test 间状态依赖通过 `storageState` 注入登录态（AC-E1 后持 token），或每 test 内重新登录（更隔离但更慢，[advisory] 优先 storageState 注入）。

### 3.2 `[约束]` Playwright config（位置 + testDir + webServer + baseURL + retries + use.trace）

Playwright config 关键字段设计（impl-writer 据此落地，详见 D1-D8 决策理由）：

- **config 位置**（D1）：根目录 `playwright.config.ts`（细化 Q1，理由见 D1）。
- **testDir**：`'./apps/e2e/tests'`（指向 §3.1 测试目录）。
- **testMatch**：`'**/*.spec.ts'`（与 vitest `*.test.ts` 区分，避免 runner 误抓）。
- **webServer**（D2）：数组配置双进程——
  - 进程 1（api server）：`command='npm start'`，`port=3000`，`env={ DB_PATH: '<os.tmpdir()>/e2e-<pid>-<ts>.db', PORT: '3000' }`，`reuseExistingServer=!CI`（本地可复用已起 server，CI 强制新起）。
  - 进程 2（vite dev）：`command='npm --workspace @admin/web run dev'`，`port=5173`，`cwd='.'`（根目录，workspace 路由到 apps/web）。
- **baseURL**（D7）：`'http://localhost:5173'`（前端 dev，vite dev proxy `/v1` → 3000 调后端）。
- **use**：`{ headless: true, trace: 'on-first-retry', screenshot: 'only-on-failure' }`（trace 仅首次重试时录，避免 CI artifact 膨胀；screenshot 仅失败时截，避免凭据泄露到 artifact——§6.3）。
- **projects**（D6）：单 project `[{ name: 'chromium', use: { browserName: 'chromium' } }]`（仅 chromium，PRD Q4）。
- **retries**：`CI ? 2 : 0`（CI 重试 2 次容错 flaky，本地 0 次快速反馈）。
- **globalSetup / globalTeardown**（D3）：可选——`globalSetup` 创建临时 DB 文件路径写入环境变量 / 检查端口空闲；`globalTeardown` 删除临时 DB 文件。或简化方案：webServer env 直接注入 `DB_PATH=<os.tmpdir()>/e2e-<pid>.db`，server 启动时建库 + seed（§3.3，[advisory] 优先简化方案）。

### 3.3 `[约束]` 临时 DB 方案（DB_PATH → os.tmpdir() + 每 run 全新 seed）

PRD Q5 BLOCKING 决策：独立临时 DB，每 run 全新 seed admin，不污染 `./data/admin.db`。

**简化方案（推荐，[约束]）**：webServer 进程 1（api server）env 注入 `DB_PATH`，指向 `os.tmpdir()` 下临时文件：

- 路径格式：`<os.tmpdir()>/e2e-admin-<pid>-<timestamp>.db`（pid + ts 保证并发 run 不冲突）。
- server 启动时 `createDb()` 读 `process.env.DB_PATH`（connection.ts L27）→ 建临时库文件 → `applySchema` 建表 → `seedAdmin` seed admin 角色 → `seedDemoData` seed admin 用户（admin@example.com / admin123）。
- 每 run 启动前若临时库已存在则删除（确保全新 seed），webServer teardown 时 server 关闭后删除临时库文件。
- **不污染 `./data/admin.db`**：DB_PATH 指向 os.tmpdir()，server 不读 `./data/admin.db`。

**清理时机（[advisory]）**：Playwright webServer 进程结束时自动 kill api server 进程，但临时 DB 文件残留。两种清理策略任选其一（impl-writer 决定）：
- 策略 A：`globalTeardown` 删除临时 DB 文件（推荐，干净）。
- 策略 B：webServer 启动前删除既有临时文件（next run 自清理，残留容忍）。

**幂等性保障**：`seedAdmin` / `seedDemoData` 均幂等（INSERT OR IGNORE / findByEmail 早返），即便临时库未清空重复 seed 也只一条记录（connection.ts L61 / server.ts L121）。

### 3.4 `[约束]` webServer 双进程编排（vite dev 5173 + api server 3000）

webServer 数组配置两进程（D2），Playwright 自动管理生命周期（启动 → 等待端口就绪 → 测试运行 → 优雅关闭）：

- **进程 1 api server**：`command='npm start'`（= `tsx apps/api/src/server.ts`），`port=3000`，`timeout=30000`（首次 tsx 编译 + DB 建表 + seed，预留 30s），`env` 注入 `DB_PATH`（§3.3）+ `PORT=3000`。
- **进程 2 vite dev**：`command='npm --workspace @admin/web run dev'`（= 在 apps/web 跑 `vite`），`port=5173`，`timeout=30000`（vite 首次冷启动 + esbuild 预构建）。
- **启动顺序**：Playwright 默认按数组顺序启动 + 等待 port 就绪，无显式 dependsOn 需求（api 与 vite 独立，前端通过 dev proxy 调后端，运行时才依赖）。
- **`reuseExistingServer`**：`process.env.CI ? false : true`（本地复用已起 server 加速，CI 强制新起保证隔离）。

**端口冲突预判**：本地 dev 若已起 `npm start`（3000）+ `npm --workspace @admin/web run dev`（5173），E2E 复用既有进程（reuseExistingServer=true），但既有 server 用的是 `./data/admin.db`（非临时库）——E2E 测试会污染 dev 库。**[约束] 本地复用须显式禁用**：`reuseExistingServer: !process.env.CI && false`（即始终 false，强制新起 server 用临时 DB，保证数据隔离）。或 impl-writer 选择 `reuseExistingServer: !CI`（本地容忍污染 dev 库，[advisory] 偏离须在 §7 声明）。本 Spec 取 `[约束]` 始终新起（reuseExistingServer=false），数据隔离优先。

### 3.5 `[约束]` vitest projects 模式（api node + web jsdom，setupFiles 移入 web project）

`vitest.config.ts` 改用 projects 模式（PRD AC-S5-1，闭合 S-5）：

- **移除**：`test.environment`（顶层）、`test.setupFiles`（顶层）。
- **保留顶层（跨 project 共享）**：`test.globals`、`test.testTimeout`、`test.include`（或下沉到各 project，[advisory] 优先保留顶层避免重复）、`test.coverage`、`resolve.alias`、`plugins`（node:sqlite 拦截，跨 project 共享）。
- **[advisory] R20 反向同步（vitest 1.6.1 API 差异，§10.6 触发）**：spec 原文写"新增 `test.projects` 数组"，但 vitest 1.6.1（仓库固定版本 devDependencies `vitest: ^1.6.0`）不支持 `test.projects` 字段（vitest 2.x 才引入），vitest 1.6.1 静默忽略该字段 → 所有测试用顶层默认（environment=node，无 setupFiles）→ 140 web 测试 `Invalid Chai property: toBeInTheDocument`。impl-writer 改用 `vitest.workspace.ts` + `defineWorkspace()` 机制（vitest 1.6.1 源码 `WORKSPACES_NAMES=['vitest.workspace','vitest.projects']` + `resolveWorkspace()`），各 project 通过 `extends: './vitest.config.ts'` 继承共享配置。`vitest.config.ts` 降级为共享基座（plugins / resolve.alias / globals / testTimeout / coverage），projects 声明移到 `vitest.workspace.ts`。属加性配置（功能等价，仅 API 形式不同），AC-S5-1/S5-2/S5-3 满足 + AC-S5-4 既有 1256 测试全绿验证闭合。
- **新增 `vitest.workspace.ts` + `defineWorkspace()` 数组**：
  - **api project**：`{ extends: './vitest.config.ts', test: { name: 'api', environment: 'node', include: ['apps/api/test/**/*.{test,spec}.{ts,tsx}'] } }`（**无 setupFiles**，AC-S5-2）。
  - **web project**：`{ extends: './vitest.config.ts', test: { name: 'web', environment: 'jsdom', setupFiles: ['apps/web/test/setup.ts'], include: ['apps/web/test/**/*.{test,spec}.{ts,tsx}'] } }`（jest-dom 在 jsdom 内生效，AC-S5-3）。
  - **contracts project**：`{ extends: './vitest.config.ts', test: { name: 'contracts', environment: 'node', include: ['packages/*/test/**/*.test.ts'] } }`（contracts 测试纯 schema 解析，node 环境足够；当前无 contracts 测试文件，留 project 为 future 扩展）。

**关键不变项**：`apps/web/test/setup.ts` 内容不变（仍 `import '@testing-library/jest-dom'`），仅引用位置从全局 setupFiles 移入 web project 内。node:sqlite 拦截 plugin 留顶层（api project 后端测试仍需 node:sqlite 解析，跨 project 共享）。

**`include` 边界**：现 `include=['apps/*/test/**', 'packages/*/test/**']` 跨 api/web/contracts。projects 模式下各 project 的 `include` 须互斥（api project 只匹配 `apps/api/test/**`，web project 只匹配 `apps/web/test/**`），避免同一测试被多 project 重复跑。impl-writer 须确认 `apps/*/test/**` glob 在 project 内收窄到对应 app。

### 3.6 `[约束]` test:e2e 脚本（package.json scripts 追加）

`package.json` scripts 追加：

```json
"test:e2e": "playwright test"
```

- **`npm test` 不变**（仍 `vitest run`，AC-S5-4 全绿验证）。
- **`npm run test:e2e`** = `playwright test`（默认读根目录 `playwright.config.ts`，D1）。
- **CI 两阶段编排**：`npm test` → `npm run test:e2e`（PRD Q3，E2E 失败不阻塞已绿单测）。
- **typecheck**：E2E 测试文件（apps/e2e/tests/*.spec.ts）须纳入 `tsc -p tsconfig.json --noEmit` 范围（impl-writer 确认 tsconfig include 是否覆盖 apps/e2e/，若未覆盖则 [advisory] 追加 include 或新建 apps/e2e/tsconfig.json extends 根 tsconfig）。

### 3.7 `[约束]` E2E 测试用例结构（AC-E1~E14 映射）

E2E 测试用例覆盖 PRD AC-E1~E14，按核心流分 5 个 `.spec.ts` 文件（§3.1）。每条 AC 对应一个 `test()`，断言用 Playwright `expect(page).toHaveURL()` / `expect(locator).toBeVisible()` / `expect(locator).toHaveText()` 等。

| 文件 | AC | test 描述（设计级，非实现） |
|------|----|---------------------------|
| login.spec.ts | AC-E1 | 导航 /login，填 admin@example.com / **admin123**（实际 seed，§2.4），提交 → URL 跳 /users，localStorage/sessionStorage 持 token |
| users.spec.ts | AC-E2 | 已登录（storageState 注入）→ 导航 /users → 列表渲染，至少含 seed admin 行 |
| users.spec.ts | AC-E3 | 在 /users → 触发创建用户表单，填合法数据提交 → 列表新增一行可见 |
| users.spec.ts | AC-E4 | 列表存在用户 version=N → 切换状态 → 请求携 If-Match: N（page.route 拦截断言 header），UI 反映切换后状态 |
| roles.spec.ts | AC-E5 | 已登录 → 导航 /roles → 角色列表渲染 |
| roles.spec.ts | AC-E6 | 在 /roles → 提交创建角色 → 列表新增该角色 |
| roles.spec.ts | AC-E7 | 存在角色 A、B → 将 B 父角色设为 A → 请求携 If-Match，父子关系建立 |
| roles.spec.ts | AC-E8 | 存在可删除角色 → 触发删除 → 列表中消失 |
| transfer.spec.ts | AC-E9 | 已登录 → 导航 /transfer → 调岗表单渲染（含用户选择、目标部门必填字段） |
| transfer.spec.ts | AC-E10 | 调岗表单填合法数据 → 提交 → 响应 2xx（page.route 拦截断言非 4xx/5xx） |
| transfer.spec.ts | AC-E11 | 调岗提交成功 → 页面成功反馈 + 导航 /users 复核目标用户 department 已更新 |
| logout.spec.ts | AC-E12 | 已登录 → 点击登出 → URL 跳 /login |
| logout.spec.ts | AC-E13 | 登出后 → localStorage/sessionStorage 无 token 残留（page.evaluate 读 storage 断言空） |
| logout.spec.ts | AC-E14 | 登出后 → 直接访问 /users → 重定向回 /login，不展示 /users 内容 |

**versioned If-Match 端到端 round-trip 验证（AC-E4/E7）**：用 `page.route('**/v1/users/*/status', route => { const req = route.request(); expect(req.headers()['if-match']).toBeDefined(); route.continue(); })` 拦截断言 If-Match header 携带，验证前端 versioned 写操作端到端 round-trip（PRD AC-E4/E7 关键验收点）。

**storageState 登录态注入（[advisory]）**：AC-E2~E14 均需登录态。优先用 Playwright `storageState`（globalSetup 执行 AC-E1 登录后保存 storageState.json，后续 test `use: { storageState: 'apps/e2e/.auth/storageState.json' }` 注入），避免每 test 重复登录（加速）。或每 test 内重新登录（更隔离但慢）。impl-writer 据实际 flaky 程度选择。

### 3.8 `[advisory]` .gitignore 追加 /data/ 与 E2E 临时产物

`.gitignore` 追加：

```
/data/
apps/e2e/.auth/
apps/e2e/test-results/
playwright-report/
```

- `/data/`：dev `npm start` 创建的 `./data/admin.db`（§2.5，闭合 dev DB 未忽略隐患，与 E2E 数据隔离同源）。
- `apps/e2e/.auth/`：storageState.json 含 token（PII / 凭据相关，§6.3，不入版本库）。
- `apps/e2e/test-results/` + `playwright-report/`：Playwright 失败截图 / trace artifact（可能含页面快照，不入版本库）。

**`[advisory]` 理由**：本轮核心是 E2E 引入 + S-5 闭合，.gitignore 追加是工程基础设施收尾（避免临时产物 + dev DB 入版本库），不属 PRD AC 验收范围但与数据隔离（Q5）同源。允许 impl-writer 据实际产物路径调整（如 storageState 路径不同），须在 §7 反向同步。

## 4. 架构决策（D1-D9）

> 每个决策显式标注 `[约束]`（默认禁止偏离，偏离须经 AI-003 流程 + Reviewer 确认）或 `[advisory]`（允许偏离，须反向同步 §7）。每个决策含理由 + 合规论证。

### D1 · Playwright config 位置 = 根目录 playwright.config.ts `[约束]`

**决策**：Playwright config 放仓库根目录 `/workspace/mvp/playwright.config.ts`，`testDir='./apps/e2e/tests'`。

**理由**：
1. **Playwright 默认 config 解析**：`playwright test` 默认从 cwd 读 `playwright.config.ts`，根目录 config 使 `npm run test:e2e`（= `playwright test`）无需 `--config` 标志，DX 简洁。
2. **webServer cwd = 根目录**：webServer 启动 `npm start` / `npm --workspace @admin/web run dev` 须从根目录执行（workspace 路由 + npm scripts 解析），config 在根目录使 webServer cwd 默认为根，无 cwd 配置负担。
3. **细化 PRD Q1**：Q1 BLOCKING 决策"apps/e2e/（与 api/web 平级，Playwright config + test/ 在内）"——本 Spec 将"apps/e2e/"理解为"E2E 测试 + fixtures 的家"（§3.1 目录结构含 tests/ + fixtures/），config 放根目录是 Tech Lead 工程编排细节（ARCH-002 同源：BA 定义 apps/e2e/ 为 E2E 测试组织单元，Tech Lead 决定 config 位置）。**理由成立**：Q1 的核心约束是"apps/e2e/ 平级独立 app"+"不归属 web"，config 在根目录不违背此核心约束（apps/e2e/ 仍是测试 + fixtures 家，config 是跨 app 编排入口）。
4. **替代方案（apps/e2e/playwright.config.ts）**：需 `npm run test:e2e` = `playwright test --config=apps/e2e/playwright.config.ts`，webServer cwd 须显式配 `cwd='.'` 才能从根起 npm scripts，DX 略繁。本 Spec 取根目录简化。

**合规论证**：Q1 BLOCKING 核心约束（apps/e2e/ 独立 + 平级 + 不归属 web）满足；config 位置是 Tech Lead 工程编排细节（ARCH-002 同源），不违背 Q1 字面"config + test/ 在内"的精神（apps/e2e/ 含 tests/ + fixtures/，config 在根编排）。若 Reviewer 认为 config 须严格在 apps/e2e/ 内，impl-writer 可改用 `--config` 标志（[advisory] 偏离本决策须 §7 反向同步）。

### D2 · webServer 配置 = 双进程（vite dev 5173 + api server 3000）`[约束]`

**决策**：webServer 数组配置两进程（api server 3000 + vite dev 5173），Playwright 自动管理生命周期。

**理由**：
1. **E2E 测前端页面交互**（PRD AC-E1~E14 均为浏览器导航 + UI 交互），须启动 vite dev server 提供前端页面（5173）。仅启 api server（3000）无前端页面可测。
2. **dev proxy /v1 → 3000**（vite.config.ts）：前端 vite dev 通过 proxy 调后端，E2E baseURL 指向 5173，前端 fetch `/v1/...` 经 proxy 到 3000，符合真实开发架构。
3. **PRD Q2 BLOCKING**：真实后端用 webServer 启动（`npm start`，端口 3000），自动管理生命周期。本决策扩展为双进程（vite + api），是 Tech Lead 对"真实前端"的补全（PRD Q2 仅明确后端，前端启动方式属 Tech Lead 细节）。
4. **替代方案（仅启 vite + 用 vite proxy 转发到 mock）**：违背"真实后端"原则（PRD Q2 要求真实后端），不取。

**合规论证**：Q2 满足（api server 经 webServer 启动）；vite dev 双进程是"真实前端"补全，不违背任何 BLOCKING 决策。impl-writer 须保证 webServer 数组两进程均配 port + timeout + reuseExistingServer（§3.4）。

### D3 · 临时 DB 隔离 = DB_PATH → os.tmpdir() 临时文件 + 每 run 全新 seed `[约束]`

**决策**：webServer 进程 1（api server）env 注入 `DB_PATH=<os.tmpdir()>/e2e-admin-<pid>-<ts>.db`，server 启动时建临时库 + seed（admin 角色 + admin@example.com / admin123 用户），不污染 `./data/admin.db`。

**理由**：
1. **PRD Q5 BLOCKING**：独立临时 DB，每 run 全新 seed admin，不污染开发库。DB_PATH 指向 os.tmpdir() 临时文件是 Q5 的直接落地。
2. **server.ts createDb 读 DB_PATH**（connection.ts L27）：env 注入 DB_PATH 即可使 server 用临时库，无需改 server.ts / connection.ts 代码（零业务代码改动，§1.3）。
3. **幂等 seed**：`seedAdmin` / `seedDemoData` 均幂等（INSERT OR IGNORE / findByEmail 早返），临时库即使残留重复 seed 也只一条，但本决策要求每 run 全新（启动前删旧文件），保证测试间状态解耦。
4. **替代方案（每 test 文件独立 DB）**：PRD Q5 列为方案③，过重（DB 初始化开销），不取。
5. **替代方案（globalSetup 建库 + teardown 清库）**：可行但增加复杂度；本 Spec 取简化方案（webServer env 注入 DB_PATH，server 自建库 + seed，§3.3），globalSetup/teardown 仅用于清理临时文件（[advisory] 可选）。

**合规论证**：Q5 满足（独立临时 DB + 每 run 全新 seed + 不污染 ./data/admin.db）。impl-writer 须保证临时 DB 文件路径含 pid+ts（并发 run 不冲突）+ 启动前删旧文件（全新 seed）+ teardown 清理（§3.3 清理时机）。

### D4 · vitest projects 模式 = 分离 api node / web jsdom `[约束]`

**决策**：`vitest.config.ts` 改用多 project 模式，声明 api project（node 环境，无 setupFiles）+ web project（jsdom 环境，setupFiles=jest-dom）+ contracts project（node 环境），`environment` 与 `setupFiles` 从顶层移除。

**[advisory] R20 反向同步（vitest 1.6.1 API 差异）**：spec 原文写 `test.projects` 数组，但 vitest 1.6.1 不支持 `test.projects` 字段（vitest 2.x 才引入），静默忽略。impl-writer 改用 `vitest.workspace.ts` + `defineWorkspace()` 机制（vitest 1.6.1 workspace 文件模式），各 project 通过 `extends: './vitest.config.ts'` 继承共享配置。`vitest.config.ts` 降级为共享基座（plugins / alias / globals / testTimeout / coverage），projects 声明移到 `vitest.workspace.ts`。属加性配置（功能等价，仅 API 形式不同），AC-S5-1/S5-2/S5-3/S5-4 全部满足（详见 §3.5 反向同步标注）。

**理由**：
1. **PRD AC-S5-1 BLOCKING**：projects 模式声明两个独立 project，api 与 web 配置独立，环境与 setupFiles 严格隔离。
2. **S-5 闭合核心**：setupFiles 从全局移入 web project 内（AC-S5-2 后端无 jest-dom 污染 + AC-S5-3 前端 jest-dom 仍生效）。
3. **`include` 互斥**：各 project 的 include 须收窄到对应 app（api → apps/api/test/**，web → apps/web/test/**），避免同一测试被多 project 重复跑。
4. **node:sqlite plugin 留顶层**：api project 后端测试仍需 node:sqlite 解析拦截（vitest.config.ts L4-26 plugin），plugin 跨 project 共享留顶层。
5. **contracts project**：packages/contracts 测试纯 schema 解析，node 环境 + 无 jest-dom，归 api-like project（或独立 contracts project）。

**合规论证**：AC-S5-1/S5-2/S5-3 满足。impl-writer 须实跑 `npm test` 验证既有 1256 测试全绿（AC-S5-4），若 jsdom 化暴露隐藏环境依赖（§10.6），impl-writer 须修复（非静默跳过）。

### D5 · E2E 不计入 vitest = 独立 npm run test:e2e `[约束]`

**决策**：E2E 用 `playwright test` 独立 runner，`package.json` 新增 `test:e2e` 脚本，`npm test` 不变（仍 `vitest run`）。CI 两阶段编排 `npm test` → `npm run test:e2e`。

**理由**：
1. **PRD Q3 BLOCKING**：E2E 慢（浏览器启动 + 真实后端 + 真实交互，分钟级），混入默认 `npm test`（vitest 秒级）拖慢本地快速反馈。开发者改一行单测不应等 E2E。
2. **不同 runner**：Playwright 与 Vitest 是不同 runner（不共享 config），天然分离。
3. **CI 两阶段**：`npm test` → `npm run test:e2e`，E2E 失败不阻塞已绿单测反馈。

**合规论证**：Q3 满足。impl-writer 须保证 `npm test` 仍跑 1256 单测全绿（AC-S5-4）+ `npm run test:e2e` 跑 E2E（AC-E1~E14）。

### D6 · E2E 浏览器 = chromium headless（单 project）`[约束]`

**决策**：Playwright `projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]`，`use.headless: true`，CI 用 `npx playwright install --with-deps chromium`（仅 chromium）。

**理由**：
1. **PRD Q4 BLOCKING**：仅 chromium，跨浏览器覆盖列为 future（Out of scope）。
2. **管理后台 MVP 主要目标浏览器**：Chromium 是管理后台主要目标，单浏览器足以验证核心流。
3. **CI 时间**：全浏览器（chromium+firefox+webkit）三倍 CI 时间但边际价值低。
4. **headless**：CI 无显示，headless 必须；本地也 headless（避免占用桌面）。

**合规论证**：Q4 满足。impl-writer 须配 `use.headless: true` + 单 chromium project。

### D7 · baseURL = http://localhost:5173（前端 dev）`[约束]`

**决策**：Playwright `baseURL='http://localhost:5173'`（vite dev 默认端口），E2E `page.goto('/login')` 解析为 `http://localhost:5173/login`。

**理由**：
1. **E2E 测前端页面交互**（D2），baseURL 指向前端 dev server（5173）。
2. **dev proxy /v1 → 3000**：前端 fetch `/v1/...` 经 vite proxy 到后端 3000，符合真实开发架构（无需 E2E 直连后端）。
3. **替代方案（baseURL=3000 后端）**：违背"测前端页面"原则（后端无 HTML 页面），不取。

**合规论证**：与 D2 webServer 双进程一致（vite 5173 + api 3000）。impl-writer 须保证 webServer 进程 2（vite dev）port 与 baseURL 一致（5173）。

### D8 · E2E 数据隔离 = 每 run 全新 DB + seed admin，不污染 ./data/admin.db `[约束]`

**决策**：每 run 启动前临时 DB 文件不存在或删除，server 启动时全新建库 + seed admin（角色 + 用户），E2E 不触碰 `./data/admin.db`。`.gitignore` 追加 `/data/`（§3.8）闭合 dev DB 未忽略隐患。

**理由**：
1. **PRD Q5 BLOCKING**：每 run 全新 seed admin，不污染开发库。
2. **测试间状态解耦**：每 run 全新 DB，前次 run 残留不影响后次（如 AC-E3 创建的用户不污染下次 AC-E2 列表断言）。
3. **`.gitignore` /data/ 追加**：dev `npm start` 创建 `./data/admin.db`，未忽略有误提交风险（§2.5）。本决策同源闭合（数据隔离 + 版本库洁净）。
4. **`reuseExistingServer` 始终 false**（§3.4 [约束]）：本地不复用已起 server（避免用 dev 库），强制新起 server 用临时 DB。

**合规论证**：Q5 满足 + .gitignore 收尾。impl-writer 须保证 webServer reuseExistingServer=false（始终新起）+ DB_PATH 指向临时文件 + 启动前删旧文件。

### D9 · E2E 覆盖范围 = 本轮核心流 5 个，不覆盖全部 7 页 `[advisory]`

**决策**：本轮 E2E 覆盖 R19 retro 圈定的 5 个核心流（login / users / roles / transfer / 登出，对应 AC-E1~E14），不覆盖非核心页（departments / audit-logs / notifications / reports）。

**理由**：
1. **PRD Out of scope**：非核心页 E2E 覆盖列为 future（PRD §Out of scope 第 4 项）。
2. **核心流优先**：R19 retro 明确核心流为 login → users → roles → transfer → 登出，本轮聚焦此 5 流。
3. **规模可控**：5 流 14 AC 已覆盖关键路径（含 versioned If-Match 端到端 round-trip），非核心页（departments/audit-logs/notifications/reports）单测已覆盖，E2E 边际价值低。

**`[advisory]` 理由**：允许未来轮次扩 E2E 覆盖（非核心页 / 跨浏览器 / 视觉回归），本轮不强制全覆盖。impl-writer / test-writer 据本决策产出 5 流 14 AC 的 E2E 测试，不扩范围。若 Reviewer 要求扩范围，须 §7 反向同步本决策（升级为 [约束] 或扩 AC）。

## 5. contracts 联动（零变更声明 + 理由）

### 5.1 零变更声明

`packages/contracts/` **本轮零变更**：

| 资产 | 现状 | 本轮处置 | 理由 |
|------|------|----------|------|
| `errorCodeSchema` | 含全部域码 | 零变更 | E2E 不引入新错误码，S-5 是配置重构不改契约 |
| `errorResponseSchema` | 字段名 code | 零变更 | 已对齐，无需改 |
| 各域 schema（user/role/department/audit/notification/report/transfer/auth） | 现状 | 零变更 | E2E 消费既有端点，不改契约 |
| `permissionCodeSchema` | 现状 | 零变更 | E2E 不引入新权限 |

`apps/api/src/errors.ts` **零变更**：errorCodeToHttpStatus 映射不变。
`apps/api/src/server.ts` **零变更**：routes / handler / buildCtx / seedDemoData 全不变（E2E 通过 DB_PATH env 隔离，不改 server 代码）。
`apps/api/src/db/connection.ts` **零变更**：createDb 已读 DB_PATH（L27），E2E env 注入即可，无需改。
`apps/web/src/` **零变更**：前端代码（pages/components/api/client.ts/errorMapping.ts）全不变，E2E 测既有页面。

### 5.2 零变更理由（ARCH-002 保持）

本轮目标是测试基础设施改进（E2E 引入 + S-5 闭合），非业务功能/契约变更。ARCH-002（contracts 纯净层）保持，ARCH-001（四层反向依赖）不触发（无 src/ 业务文件改动）。所有改动在测试层（apps/e2e/ 新增 + vitest.config.ts 配置 + package.json 脚本 + .gitignore），不污染业务层。

## 6. PII / 安全标注

### 6.1 E2E 凭据 = admin@example.com / admin123（与 server seed 一致）

E2E 登录用凭据 `admin@example.com / admin123`（server.ts L133 seedDemoData 实际值，§2.4）。**非 PRD AC-E1 字面 `Admin@123`**（BA 笔误，§7.2 反向同步）。凭据是 seed demo 数据（非真实生产凭据），E2E 用其登录验证 AC-E1，无 PII 风险。

### 6.2 临时 DB 不含真实 PII（每 run 销毁）

临时 DB（os.tmpdir() 文件）仅含 seed admin 用户（demo 数据，非真实 PII）+ E2E 测试创建的虚构数据。每 run 启动前删除 + teardown 清理，不残留。临时 DB 不入版本库（.gitignore /data/ + 临时路径在 os.tmpdir() 外仓库）。

### 6.3 E2E artifact 不含凭据泄露

- `use.trace='on-first-retry'`：trace 仅首次重试时录，避免每次 run 录 trace 膨胀 artifact。
- `use.screenshot='only-on-failure'`：截图仅失败时截，避免成功 run 截图含页面状态。
- **凭据不入 artifact**：登录步骤（填密码）的 trace / screenshot 可能含密码字段值。impl-writer 须保证登录 test 标 `@auth` 标签或用 `test.skip()` 跳过 trace 录制（或 Playwright 默认 mask password input，须 impl-writer 确认 `<input type="password">` 被 mask）。
- **storageState.json 含 token**：`apps/e2e/.auth/storageState.json` 含登录后 token，gitignore 追加（§3.8），不入版本库。

## 7. advisory 偏离反向同步

> AI-003：advisory 偏离须反向同步 Spec / PRD。本轮涉及 3 项反向同步。

### 7.1 S-5 [advisory] 移除（vitest projects 模式闭合）

**反向同步目标**：
- 既有 Tech-Spec 中 S-5 [advisory] 标注（setupFiles 全局副作用）移除或改为"R20 已消除"历史记录。
- `vitest.config.ts` 顶部注释（如有"setupFiles 全局注入"措辞）更新为"R20 projects 模式分离 api/web"。

**消除后状态**：vitest projects 模式生效，api project 无 setupFiles（AC-S5-2），web project setupFiles 在 jsdom 环境内生效（AC-S5-3）。S-5 advisory 闭合（PRD AC-S5-5）。

**执行者**：impl-writer 阶段落地（AI-003：advisory 偏离消除须反向同步 Spec）。本 Spec 仅声明同步目标。

### 7.2 `[advisory]` PRD AC-E1 凭据字面差异（Admin@123 → admin123）反向同步

**差异（R22 AC-S20-4 消除 stale Admin@123）**：原 PRD AC-E1 字面写凭据 `admin@example.com / Admin@123`（大写 A、含 `@`），与 server.ts seedDemoData 实际 seed 凭据 `admin@example.com / admin123`（小写 a、无 `@`，L133 注释明示）不符。**PRD 已被 R20 编排者修正为 `admin123`**，本 Spec §2.4 stale 描述已在 R22 同步消除。

**本 Spec 处置**：E2E 登录采用实际 seed 凭据 `admin@example.com / admin123`（与 server.ts 一致，否则 AC-E1 登录必失败）。原 PRD AC-E1 的 `Admin@123` 视为 BA 文档笔误，已由 R20 编排者修正。

**反向同步目标（已闭合）**：PRD AC-E1 凭据字面已由 R20 编排者反向同步修正为 `admin@example.com / admin123`（与 server.ts seed 一致）。R22 AC-S20-4 同步消除本 Spec §2.4 / §7.2 中残留的 stale Admin@123 描述。

**`[advisory]` 理由**：E2E 测试须用真实 seed 凭据才能登录成功，原 PRD 字面凭据是笔误非设计意图。允许偏离原 PRD 字面（用 admin123），BA 已反向同步修正 PRD（R20 闭合）。

### 7.3 `[advisory]` .gitignore /data/ 追加（D8 同源）

**反向同步目标**：本 Spec §3.8 / D8 决定 .gitignore 追加 `/data/`（闭合 dev DB 未忽略隐患），属工程基础设施收尾，非 PRD AC 验收范围。impl-writer 据 §3.8 落地，若实际产物路径不同（如 storageState 路径）可调整，须在本 Spec §3.8 反向同步。

### 7.4 `[advisory]` retries=0 偏离 spec §3.2 字面 `retries: CI ? 2 : 0`（R22 AC-S20-2 反向同步）

**差异**：本 Spec §3.2 / D6 设计写 `retries: CI ? 2 : 0`（CI 重试 2 次容错 flaky，本地 0 次快速反馈），但 R20 impl-writer 实际落地 `playwright.config.ts` 取 `retries: 0`（本地与 CI 一致，均不重试，task spec 要求简化）。R22 闭合 R20 Review Suggestion #2：本节正式反向同步声明此偏离。

**偏离理由**：
1. **task spec 要求简化**：R20 task spec 明确要求 `retries: 0`（非 `CI ? 2 : 0`），impl-writer 据此落地。
2. **加性安全场景（更严格非更弱）**：retries=0 比 retries=2 更严格——失败立即暴露，不靠重试掩盖 flaky 测试。CI 重试 2 次可能掩盖真实问题（如时序竞争 / 状态污染），retries=0 强制开发者直面 flaky 根因。
3. **E2E 14 passed 证明可行**：R20 14 E2E 全部 passed（无重试），证明当前测试稳定性足够支持 retries=0，无 flaky 风险。
4. **CI 时间优化**：retries=2 最坏情况 CI 时间翻 3 倍（首次 + 2 次重试），retries=0 控制 CI 时间，加快反馈。
5. **future 升级路径**：若未来出现 flaky 测试无法立即修复，可临时升级为 `retries: CI ? 1 : 0`（CI 容错 1 次），但本轮不取。

**`[advisory]` 范围**：retries 数字属实现细节（spec §3.2 字面 `CI ? 2 : 0` 非 PRD AC 验收范围，PRD 未定 retries 具体值）。允许偏离 spec 字面（取 retries=0），须在本节反向同步声明理由 + 合规论证。

**合规论证**：retries=0 是加性安全场景（更严格非更弱），E2E 14 passed 证明可行，task spec 明确要求简化。R22 AC-S20-2 闭合 R20 Review Suggestion #2，本节同步声明 retries=0 偏离 spec §3.2 字面的理由。

## 8. Out of scope

- **跨浏览器 E2E（firefox/webkit）** —— PRD Q4 决策仅 chromium，跨浏览器覆盖列为 future。
- **视觉回归 / 截图对比测试** —— 本轮 E2E 仅功能流验证，不做像素级视觉对比。
- **性能 / 压力测试** —— E2E 非性能测试，本轮不涉及。
- **非核心页 E2E 覆盖** —— departments / audit-logs / notifications / reports 页的 E2E 列为 future（D9 [advisory]）。
- **移动端视口测试** —— 管理后台 MVP 仅桌面端，不做移动视口。
- **vitest 内嵌 Playwright 集成** —— 两 runner 保持独立（Q3），不做 vitest runner 内的 playwright 集成。
- **既有单测的 jsdom 化重构** —— S-5 仅切换 web project 环境为 jsdom，不重写既有前端测试逻辑（断言不改，AC-S5-4 全绿验证）。
- **contracts 改动** —— 本轮零 contracts 变更（§5）。
- **新规则 / check-rules.mjs 改动** —— 本轮无规则改动。
- **server.ts / connection.ts / domain / repository / service 改动** —— 本轮零业务代码改动（§1.3，E2E 通过 DB_PATH env 隔离）。
- **E2E 测试用例实现代码** —— 本 Spec 仅设计 + AC 映射（§3.7），实现代码由 impl-writer / test-writer 落地。

## 9. 受影响测试清单（AI-006 三类标注 + S-5 闭合影响）

> 严格遵守 AI-006：①类分显式 + 隐式两个子类 + ②类签名/行为变更 + ③类新增。本轮 contracts 零变更（§5），①类预期为 0。

### 9.1 ①类：contracts 联动驱动 —— 0 文件

**①-A 显式影响（grep 符号引用）—— 0 文件**：grep `errorCodeSchema|errorResponseSchema|<域>Schema` 在 apps/e2e/ 与 vitest.config.ts 无命中（E2E 测试用 Playwright API + page.route 拦截，不 import contracts schema；vitest.config.ts 是配置文件不引用 schema）。本轮 contracts 零变更（§5），schema 定义与导出不变。**零显式影响。**

**①-B 隐式影响（全集断言依赖枚举值，R11 S-2）—— 0 文件**：本轮 errorCodeSchema 零扩展（§5），既有 SSOT 派生断言（`[...errorCodeSchema.options]` containment）位于 notification/report/role-inheritance/optimistic-locking/error-mapping 测试，枚举值不变 → containment 断言不失效。**零隐式影响。**

> **显式声明（G3 自检）**：①类隐式影响子类本次为 **0 文件**。根因：contracts 冻结（§5），errorCodeSchema 零扩展，枚举值不变。

①类小结：**0 文件受影响**（显式 0 + 隐式 0）。根因：contracts 冻结 + E2E/vitest 配置不引用 contracts schema。

### 9.2 ②类：既有签名/行为变更驱动 —— 0 文件

本轮无 service / repository / router / handler / client / errorMapping 签名变更（§1.3 零业务代码改动）。vitest.config.ts 改 projects 模式是**配置层重构**（environment/setupFiles 重组，非断言改动），属 ③类新增配置驱动（§9.3）而非 ②类签名变更。**②类 0 文件。**

> 注：vitest.config.ts 改 projects 模式后，既有 1256 测试断言本身不改（matcher / 期望值不变），仅运行环境从 node 全局切换到 project 级（api=node / web=jsdom）。若 jsdom 化暴露隐藏环境依赖（§10.6），impl-writer 须修复（属 ②类配置驱动修复，须在本节追加清单，AI-006 反向核实）。

### 9.3 ③类：新增 —— apps/e2e/tests/*.spec.ts + playwright.config.ts + vitest.config.ts 改动

| # | 文件 | 类型 | 覆盖 AC |
|---|------|------|---------|
| 1 | `playwright.config.ts`（新增，根目录，D1） | ③类 新增配置 | AC-E1~E14 编排（webServer + baseURL + projects） |
| 2 | `apps/e2e/tests/login.spec.ts`（新增） | ③类 新增 E2E | AC-E1 |
| 3 | `apps/e2e/tests/users.spec.ts`（新增） | ③类 新增 E2E | AC-E2/E3/E4（含 versioned If-Match round-trip） |
| 4 | `apps/e2e/tests/roles.spec.ts`（新增） | ③类 新增 E2E | AC-E5/E6/E7/E8（含 versioned If-Match round-trip） |
| 5 | `apps/e2e/tests/transfer.spec.ts`（新增） | ③类 新增 E2E | AC-E9/E10/E11 |
| 6 | `apps/e2e/tests/logout.spec.ts`（新增） | ③类 新增 E2E | AC-E12/E13/E14（token 清除 + 路由守卫） |
| 7 | `apps/e2e/fixtures/auth.ts`（新增，[advisory] 可选） | ③类 新增 fixture | storageState 登录态注入（AC-E2~E14 复用） |
| 8 | `vitest.config.ts`（改动，projects 模式） | ③类 配置重构 | AC-S5-1/S5-2/S5-3（api node + web jsdom 分离） |
| 9 | `package.json`（改动，scripts 追加 test:e2e） | ③类 脚本新增 | D5（独立 npm run test:e2e） |
| 10 | `.gitignore`（改动，追加 /data/ + e2e 产物） | ③类 配置追加 | D8（dev DB 隔离 + artifact 不入版本库） |

③类小结：**10 项**（7 新增文件 + 3 改动文件）。覆盖 PRD AC-E1~E14（E2E）+ AC-S5-1~S5-3（projects 模式）。

### 9.4 S-5 闭合影响：vitest.config.ts 改 projects 模式 → 既有 1256 测试须全绿

**核心影响**：vitest.config.ts 从单一 `environment='node'` + 全局 `setupFiles` 切换到 projects 模式（api=node 无 setupFiles / web=jsdom + setupFiles）。既有 1256 测试（PRD §1.3 / AC-S5-4）须全绿无回归。

**关键风险（§10.6 详述）**：既有前端测试（apps/web/test/**）一直在 `environment='node'` + jest-dom 下跑（S-5 现状），切换到 `environment='jsdom'` + jest-dom 后，可能暴露之前隐藏的环境依赖问题：
- **window / document / localStorage / sessionStorage**：node 环境下未定义（被 Testing Library / jsdom polyfill mock），jsdom 下原生存在行为可能不同（如 localStorage 写入实际持久化 vs mock 抛错）。
- **DOM API 行为差异**：jsdom 的 DOM 实现与 Testing Library 在 node 下的 mock 可能细微差异（如 event 冒泡、focus 行为）。
- **既有测试侥幸工作**：部分前端测试在 node 环境下"侥幸"通过（因 mock 兜底），jsdom 化后 mock 与真实 jsdom 行为冲突可能暴露。

**验证要求**：impl-writer 须实跑 `npm test`（vitest run 全量）验证 1256 测试全绿（AC-S5-4）。若 jsdom 化暴露隐藏环境依赖导致测试红，impl-writer 须：
1. **优先修复测试**（调整 mock / 显式 polyfill / 修正断言以适配 jsdom 真实行为），非静默跳过；
2. **若修复涉及断言弱化**（如 `toBeVisible` 改 `toBeTruthy`），须按 AI-002 边界声明 + §7 反向同步（②类配置驱动修复，§9.2 追加清单）；
3. **若发现既有测试有环境依赖 bug**（如测试本身错误依赖 node 全局副作用），修复测试本身（非弱化断言）。

**预期**：大部分前端测试在 jsdom 下应直接绿（因 Testing Library + jest-dom 已为 jsdom 设计），少数依赖 window/localStorage 的测试可能需调整 mock。impl-writer 实跑后据实际红数评估是否需 §7 反向同步。

### 9.5 AI-006 反向核实声明

- **①类显式**：0 文件（contracts 冻结，E2E/vitest 配置不引用 contracts schema）；
- **①类隐式**：0 文件（errorCodeSchema 零扩展，containment 断言不失效——**显式声明为空**）；
- **②类**：0 文件（零业务代码签名变更；vitest.config.ts 改 projects 是 ③类配置重构非 ②类签名变更；若 jsdom 化暴露隐藏依赖需修复，impl-writer 阶段追加清单）；
- **③类**：10 项（7 新增 + 3 改动，覆盖 AC-E1~E14 + AC-S5-1~S5-3）；
- **S-5 闭合影响**：既有 1256 测试须全绿（AC-S5-4），jsdom 化隐藏依赖风险预判见 §10.6。

test-writer / impl-writer 反向核实：若发现清单外影响点（如 jsdom 化暴露的 ②类配置驱动修复），须显式列出（AI-006）。

## 10. 组合副作用预判（含 R19 固化的 S-21 + R16 S-18/S-19/S-20）

> 提前标注多约束组合 + 全集定义 + 常量复用 + 测试工具 workaround + [约束] 偏离反向同步闭环性的潜在副作用，impl-writer 实现时须规避，偏离按 AI-003 反向同步。

### 10.1 多 [约束] 组合副作用（R11/R12 范式，S-17 增项）—— 本轮工程基础设施，无业务 [约束] 组合

本轮是工程基础设施轮（E2E 引入 + S-5 闭合），所有 [约束] 决策（D1-D8）均在测试基础设施层（Playwright config / vitest projects / 脚本 / gitignore），无业务层 [约束]（server.ts / domain / service / contracts 零改动，§1.3）。故无"业务多 [约束] 组合"副作用预判项（如 R18 的「wire 对齐 + 409 重试」组合）。

工程层组合预判：
1. **「webServer 双进程（D2）+ 临时 DB（D3）+ baseURL 5173（D7）」组合**：vite dev（5173）+ api server（3000，DB_PATH 指向临时库）双进程，前端经 dev proxy /v1 → 3000 调后端。须保证两进程均启动 + 端口就绪后才开始 E2E（Playwright webServer 自动等待 port）。impl-writer 须保证 webServer 数组两进程 port 与 timeout 配置正确（§3.4）。
2. **「vitest projects（D4）+ node:sqlite plugin 顶层（§3.5）」组合**：node:sqlite 拦截 plugin 留顶层（跨 project 共享），api project（node 环境）需 node:sqlite 解析。须保证 plugin 在 projects 模式下仍对所有 project 生效（vitest plugin 配置在顶层对 projects 数组内 project 均生效，impl-writer 须实跑验证 api 测试 node:sqlite 解析不报错）。
3. **「E2E 独立 runner（D5）+ CI 两阶段（§3.6）」组合**：CI `npm test`（vitest）→ `npm run test:e2e`（playwright）两阶段，E2E 失败不阻塞已绿单测。须保证 CI workflow 两阶段串行（非并行，避免端口冲突）+ E2E 阶段前 `npx playwright install --with-deps chromium`（Q4）。
4. **「reuseExistingServer=false（D8）+ 临时 DB（D3）」组合**：始终新起 server（不复用本地 dev server）+ DB_PATH 指向临时库，保证数据隔离。impl-writer 须保证 reuseExistingServer=false（即便本地已起 server 也强制新起用临时 DB）。

### 10.2 全码映射收尾全集定义（R16 S-18 增项）—— N/A

`errorMapping.ts` 全码映射的"全集"定义须明确为"前端可能触发的域码全集"。本轮判定：
- **errorMapping.ts 零变更**（§1.3 / §5），全码映射收尾状态不变（R16 已完成）；
- E2E 测试触发既有错误码（如 401 UNAUTHORIZED / 403 FORBIDDEN / 409 VERSION_CONFLICT / 404 USER_NOT_FOUND），均已在 SPECIFIC_MESSAGES 映射；
- 本轮无新错误码引入（contracts 冻结）。

**结论**：本轮无全码映射收尾动作，状态维持 R16 收尾后的稳态。N/A。

### 10.3 简单常量跨组件复用边界（R16 S-19 增项）—— N/A

简单常量（如 UUID_RE 正则、单字段 schema）跨组件复用边界：≤3 处使用场景且常量简单可 [advisory] 沿用重复定义；≥4 处使用场景或常量复杂须提取 lib/ 共享。本轮判定：
- E2E 测试用 Playwright API（page / expect / locator），无 contracts schema 跨组件复用；
- vitest.config.ts 改 projects 模式，include glob 字符串在各 project 内重复（'apps/api/test/**' / 'apps/web/test/**'），2 处简单字符串，按 S-19 可 [advisory] 沿用重复定义，不提取共享。

**结论**：本轮无简单常量跨组件复用边界动作。N/A（vitest include glob 重复定义符合 S-19 阈值）。

### 10.4 测试工具限制 workaround（R16 S-20 增项）—— N/A（E2E 用 Playwright 非 user-event）

测试工具限制 workaround：如 user-event v14.6.1 selectOptions 自动过滤 disabled option。本轮判定：
- **E2E 用 Playwright**（非 @testing-library/user-event），不受 user-event workaround 影响；
- E2E 工具限制预判：
  - **storageState token 过期**：globalSetup 登录获 token 写 storageState.json，若 E2E run 时间超 token 过期时间（TECH-AUTH-001 token 有 exp），后续 test 用 storageState 可能 401。impl-writer 须保证 token exp 足够长（覆盖 E2E 全 run）或每 test 重新登录（[advisory]）。
  - **page.route 拦截 If-Match header 断言**（AC-E4/E7）：page.route 须在 route.continue() 前读 route.request().headers()['if-match']，且须在 page.goto / click 前注册 route（避免错过请求）。
  - **localStorage / sessionStorage 读取**（AC-E13）：用 page.evaluate(() => localStorage.getItem('token')) 读 storage，须在登出后读（断言 null / undefined）。

**结论**：本轮无 user-event workaround 需求（E2E 用 Playwright）。E2E 工具限制预判项 impl-writer 须规避（storageState token exp / page.route 时序 / storage 读取）。

### 10.5 `[约束]` 偏离反向同步闭环性（R19 固化 S-21）—— 本轮无 [约束] 偏离预判

R19 固化 S-21：[约束] 偏离须经 AI-003 流程 + Reviewer 确认 + 反向同步闭环。本轮判定：
- **本轮所有 [约束] 决策（D1-D8）均在测试基础设施层**（Playwright config / vitest projects / 脚本 / gitignore），无业务层 [约束]（server.ts / domain / service / contracts 零改动）；
- **vitest.config.ts 改 projects 模式是配置层 [约束]**（D4），非业务 [约束]——配置层改动不触发 ARCH-001 四层反向依赖 / SEC-002 越权 / SEC-003a PII 等业务 [约束] 偏离预判；
- **本轮无 [约束] 偏离预判项**：所有 [约束] 决策均按本 Spec §3 / §4 落地，无预期偏离。

**`[advisory]` 偏离项**（允许偏离，须 §7 反向同步）：
- D9（E2E 覆盖范围 5 流非全 7 页）—— [advisory]，§7 已声明；
- §7.2（PRD AC-E1 凭据字面差异 Admin@123 → admin123）—— [advisory]，§7.2 已声明；
- §7.3（.gitignore /data/ 追加）—— [advisory]，§7.3 已声明；
- §3.8 storageState 路径 / globalSetup 可选 —— [advisory]，impl-writer 据实际调整。

**结论**：本轮无 [约束] 偏离预判（工程基础设施轮，所有改动在 [advisory] 范围内 + 配置层 [约束] 非业务 [约束]）。S-21 闭环性满足（[advisory] 偏离均 §7 反向同步声明）。

### 10.6 vitest projects 切换副作用：jsdom 化隐藏依赖暴露预判（关键风险）

**核心风险**：既有前端测试（apps/web/test/**）一直在 `environment='node'` + jest-dom 下跑（S-5 现状），切换到 `environment='jsdom'` + jestdom 后（D4 web project），可能暴露之前隐藏的环境依赖问题：

1. **window / document / navigator 全局**：node 环境下未定义（被 Testing Library / jsdom polyfill 提供），jsdom 下原生存在。既有测试若显式 `global.window = ...` mock，jsdom 下可能与原生 window 冲突（mock 覆盖原生）。
2. **localStorage / sessionStorage**：node 环境下未定义（被测试 mock 或跳过），jsdom 下原生存在（实际持久化到内存）。既有测试若 mock localStorage，jsdom 下 mock 可能与原生行为冲突（如 mock 抛错 vs 原生写入成功）。
3. **DOM API 行为差异**：jsdom 的 DOM 实现（如 event 冒泡 / focus / getBoundingClientRect）与 Testing Library 在 node 下的 mock 可能细微差异。既有测试若依赖 mock 行为，jsdom 下可能断言失败。
4. **既有测试"侥幸"通过**：部分前端测试在 node 环境下"侥幸"通过（因 mock 兜底），jsdom 化后 mock 与真实 jsdom 行为冲突可能暴露（如测试本身错误依赖 node 全局副作用）。

**impl-writer 须实跑验证**：`npm test`（vitest run 全量）后，若前端测试在 jsdom 下出现红：
- **优先修复测试**（调整 mock / 移除冗余 polyfill / 修正断言以适配 jsdom 真实行为），非静默跳过；
- **若修复涉及断言弱化**（AI-002 边界），须 §7 反向同步 + §9.2 追加 ②类清单；
- **若发现既有测试有环境依赖 bug**（如测试本身错误依赖 node 全局），修复测试本身（非弱化断言）；
- **若 jsdom 化导致大量红**（如 >10 测试红），impl-writer 须暂停 + 上报 Tech Lead / Reviewer 评估是否回退 web project 为 node 环境（[advisory] 偏离 D4，须 §7 反向同步 + 重新评估 S-5 闭合方向）。

**预期**：大部分前端测试在 jsdom 下应直接绿（因 Testing Library + jest-dom 已为 jsdom 设计，jsdom 是它们的原生运行环境）。少数依赖 window/localStorage mock 的测试可能需调整。impl-writer 实跑后据实际红数评估。

**回退预案**（[advisory]）：若 jsdom 化暴露的隐藏依赖过多导致修复成本超本轮规模，impl-writer 可回退 web project 为 `environment='node'`（保留 S-5 现状），仅闭合"setupFiles 全局污染"部分（setupFiles 移入 web project 内，environment 仍 node）。此回退是 [advisory] 偏离 D4，须 §7 反向同步 + S-5 部分闭合声明（setupFiles 隔离闭合，environment 隔离 defer future）。但本 Spec 优先取完整 jsdom 化（D4 [约束]），回退仅预案。

## 11. 上下文文件清单（最小上下文包）

> impl-writer / test-writer 据此最小上下文包落地，无需读全仓库。

| # | 文件 | 用途 | 关键阅读点 |
|---|------|------|-----------|
| 1 | `/workspace/mvp/docs/prd/e2e-introduction.md` | PRD（19 AC + 5 Q&A BLOCKING） | 全文（19 AC 验收标准 + Q1-Q5 决策 + Out of scope） |
| 2 | `/workspace/mvp/docs/spec/e2e-introduction.tech.md` | 本 Spec | 全文（§3 实现方案 + D1-D9 决策 + §9 受影响清单 + §10 副作用） |
| 3 | `/workspace/mvp/vitest.config.ts` | S-5 现状 + projects 改动目标 | 全文 52 行（environment='node' + setupFiles 全局，改 projects 模式） |
| 4 | `/workspace/mvp/apps/web/vite.config.ts` | 前端 dev proxy 配置 | server.proxy['/v1']='http://localhost:3000'（D2 webServer vite dev 依据） |
| 5 | `/workspace/mvp/apps/web/test/setup.ts` | jest-dom setup（web project setupFiles 引用） | 全文（仅 `import '@testing-library/jest-dom'`，内容不变） |
| 6 | `/workspace/mvp/apps/web/package.json` | 前端 dev 脚本 | scripts.dev='vite'（D2 webServer vite 启动命令） |
| 7 | `/workspace/mvp/package.json` | 根脚本 + 依赖 | scripts（追加 test:e2e）+ devDependencies（@playwright/test ^1.61.1 已在） |
| 8 | `/workspace/mvp/apps/api/src/server.ts` | 后端启动 + seed 逻辑 | L78-147（createDb / applySchema / seedAdmin / seedDemoData / PORT）+ 凭据 admin@example.com / admin123（§2.4，非 PRD 字面 Admin@123） |
| 9 | `/workspace/mvp/apps/api/src/db/connection.ts` | createDb DB_PATH 解析 + seedAdmin 幂等 | L26-38（createDb 读 process.env.DB_PATH）+ L61-74（seedAdmin INSERT OR IGNORE 幂等） |
| 10 | `/workspace/mvp/.gitignore` | 追加 /data/ + e2e 产物 | 全文（追加 /data/ + apps/e2e/.auth/ + test-results/ + playwright-report/） |
| 11 | `/workspace/mvp/docs/spec/user-detail-and-wire-alignment.tech.md` | Tech-Spec 结构范例（参考） | frontmatter + §1 概述 + D 决策 + §9 受影响清单 + §10 副作用 + G3 自检（结构对齐） |

## G3 自检声明

- **Tech-Spec 完整性**：11 章节齐全（§1 覆盖范围 / §2 既有现状核验 / §3 实现方案 / §4 D1-D9 决策 / §5 contracts 联动零变更 / §6 PII 安全 / §7 advisory 反向同步 / §8 Out of scope / §9 受影响测试清单 / §10 组合副作用预判 / §11 上下文文件清单）。
- **PRD AC 全覆盖**：19 条 AC（E1-E14 共 14 条 E2E + S5-1~S5-5 共 5 条 S-5 闭合）每条有对应设计（§3.7 AC-E1~E14 映射 + §3.5/§9.4 AC-S5-1~S5-4 + §7.1 AC-S5-5 反向同步）。
- **BLOCKING Q&A 落地**：Q1（apps/e2e/ 独立，§3.1/D1 细化 config 位置）+ Q2（webServer 启动 npm start，§3.4/D2）+ Q3（独立 npm run test:e2e，§3.6/D5）+ Q4（chromium headless，§3.2/D6）+ Q5（临时 DB + 每 run seed，§3.3/D3/D8）全落地。
- **受影响测试清单（AI-006）**：①类显式 0 + ①类隐式 **0（显式声明为空，根因 contracts 冻结）** + ②类 0（零业务签名变更；jsdom 化隐藏依赖修复若出现须 §9.2 追加）+ ③类 10 项（7 新增 + 3 改动）+ S-5 闭合影响（1256 测试须全绿，jsdom 化风险 §10.6）。
- **§10 组合副作用预判**：含 R19 S-21（[约束] 偏离反向同步闭环性，本轮无 [约束] 偏离）+ R16 S-18（全码映射收尾 N/A）+ R16 S-19（简单常量复用 N/A）+ R16 S-20（测试工具 workaround N/A，E2E 用 Playwright 非 user-event）+ S-17（多约束组合 4 条工程层预判）+ §10.6 vitest projects 切换 jsdom 化隐藏依赖风险预判（关键风险，impl-writer 须实跑验证）。
- **既有现状核验（R10 S-2）**：vitest.config.ts 现状（§2.1）+ vite.config.ts / apps/web/package.json（§2.2）+ package.json 根（§2.3）+ server.ts 启动 seed（§2.4，凭据差异标注）+ .gitignore（§2.5，/data 未忽略）。
- **[约束]/[advisory] 标注规范**：D1-D8 全标 [约束]；D9 [advisory]（E2E 覆盖范围 5 流非全 7 页）；§7 三项 [advisory] 反向同步（S-5 移除 / PRD 凭据差异 / .gitignore 追加）；§10.6 回退预案 [advisory]。
- **PII/安全标注**：E2E 凭据 admin@example.com / admin123（§6.1，与 server seed 一致非 PRD 笔误 Admin@123）+ 临时 DB 不含真实 PII（§6.2）+ artifact 不含凭据泄露（§6.3，trace/screenshot/storageState 处置）。
- **边界遵守**：本阶段只产本文档，不写实现代码（impl-writer 阶段）+ 不写测试断言（test-writer 阶段），Tech Lead 角色边界。零业务代码改动（§1.3，server.ts / connection.ts / domain / repository / service / contracts 全不变）。
