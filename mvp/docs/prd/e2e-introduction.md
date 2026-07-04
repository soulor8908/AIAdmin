---
doc_type: PRD
id: PRD-E2E-INTRODUCTION-001
title: R20 引入 Playwright E2E 测试 + 闭合 S-5（vitest projects 模式分离 unit/e2e 环境）
status: decided
owner: ba@team
created: 2026-07-04
aligns: [PRD-WEB-AUTH-USER-001, PRD-USER-001, PRD-ROLE-001, PRD-TRANSFER-001]
prd_ref: RETRO-ROUND19-001
# Q&A 决策结果摘要：
# Q1=E2E 测试目录放 apps/e2e/（独立 app，与 api/web 平级，跨 api+web 边界，不归属 web） /
# Q2=真实后端用 Playwright webServer 配置启动 npm start（端口 3000，自动管理生命周期：启动/健康检查/优雅关闭） /
# Q3=E2E 不计入 vitest 默认 npm test，独立 npm run test:e2e（playwright test）；CI 两阶段编排 test → test:e2e /
# Q4=CI 用 npx playwright install --with-deps chromium（仅 chromium 单浏览器，缓存 ~/.cache/ms-playwright） /
# Q5=E2E 数据隔离用独立临时 DB（DB_PATH 指向 e2e 隔离库，不污染开发库 ./data/admin.db；每 run 全新 seed admin）
---

# R20 引入 Playwright E2E 测试 + 闭合 S-5（vitest projects 模式分离 unit/e2e 环境）

> 本轮（R20）承接 R19 retro 明确的两项测试基础设施改进：
> - **E2E 引入**：R19 retro 已明确核心流覆盖范围（login → user 列表 → role 操作 → transfer → 登出全链路），当前仓库仅有 vitest 单测（mock fetch / spawn server embedding），缺真实浏览器 + 真实后端的端到端验证。`@playwright/test` 已在根 `package.json` devDependencies（`^1.61.1`）但尚未启用，本轮正式引入。
> - **S-5 闭合**：R12 遗留 advisory——`vitest.config.ts` 用单一 `environment='node'`（后端测试需 node）+ 单一 `setupFiles=['apps/web/test/setup.ts']`（jest-dom matcher 全局注入），导致后端测试环境被 DOM 相关全局副作用污染。闭合方向：vitest projects 模式分离 api（node 环境，无 jest-dom setup）与 web（jsdom 环境 + jest-dom setup）。
>
> **PRD 边界**：BA 仅产出本 PRD（含验收标准 + Q&A BLOCKING 决策），不写实现代码、不预定义 Playwright config 字段细节（属 Tech Lead 阶段产物，ARCH-002 同源约束）。AC 描述"验收什么"，不描述"怎么实现"。

## 1 · 背景与目标

### 1.1 R20 双任务来源

R19 retro 将两项测试基础设施改进列为 R20 目标：
1. **E2E 引入**：引入 Playwright E2E 测试（真实浏览器 + 真实后端），覆盖 R19 retro 已明确的核心流。
2. **S-5 闭合**：闭合 R12 遗留 advisory——setupFiles 全局副作用，改用 vitest projects 模式分离 unit/e2e 环境。

### 1.2 E2E 引入动机

当前测试矩阵：
- **后端**：vitest embedding 测试（spawn 真实 server + fetch），覆盖 HTTP 全链路但无浏览器、无前端。
- **前端**：vitest + jsdom + Testing Library（mock fetch），覆盖组件渲染与交互但无真实浏览器、无真实后端。

**缺口**：无"真实浏览器 + 真实后端 + 真实前端路由"三真实联调的端到端验证。SPA 7+ 路由页（`/login` `/users` `/roles` `/departments` `/audit-logs` `/notifications` `/reports` `/transfer`）的核心流（login → user 列表 → role 操作 → transfer → 登出）缺整链路验证，单测难以捕获前后端联调层 bug（如路由守卫、token 存储与清除、versioned If-Match 端到端 round-trip）。

`@playwright/test`（`^1.61.1`）已在 devDependencies，本轮正式启用，覆盖 R19 retro 已圈定的核心流（非全 7 页全覆盖——非核心页 departments/audit-logs/notifications/reports 列为 future，见 Out of scope）。

### 1.3 S-5 现状（R12 遗留 advisory）

**文件**：`/workspace/mvp/vitest.config.ts`

**问题根因**：单 vitest 配置同时服务后端与前端测试，但二者环境需求冲突：
- 后端测试（`apps/api/test/**`）需 `environment='node'`（node:sqlite、http server 等 Node 原生能力）。
- 前端测试（`apps/web/test/**`）需 `environment='jsdom'` + jest-dom matcher（`toBeInTheDocument` 等）。

当前配置取折中：`environment='node'`（满足后端）+ `setupFiles=['apps/web/test/setup.ts']`（全局注入 jest-dom）。后果：
- jest-dom 通过 `setupFiles` 加载到**所有测试**含后端测试，后端 node 环境被 DOM 相关全局副作用污染（`setup.ts` 内容仅 `import '@testing-library/jest-dom'`）。
- `environment='node'` 对前端 .tsx 测试是错配（前端需 jsdom），现侥幸工作是因为 Testing Library mock 在 node 环境也能跑，但非正确语义。

**S-5 闭合方向**：vitest projects 模式——声明两个独立 project，api project（`environment=node`，无 setupFiles）与 web project（`environment=jsdom`，setupFiles=jest-dom），环境与副作用严格隔离。

### 1.4 双任务合并一轮的判断

**决策：合并一轮**。理由：
1. **同源**：两项均源自 retro 指向的"测试基础设施改进"主题（R19 retro 圈定 E2E 范围，R12 retro 遗留 S-5）。
2. **测试基础设施同主题**：均围绕"测试环境与测试矩阵"，本轮一次性整理 vitest 配置 + 引入 Playwright，避免两轮各自触碰测试配置产生冲突。
3. **规模可控**：E2E 是新增（不动既有测试），S-5 是配置重构（既有 1256 测试须全绿验证），互不破坏，合并不增复杂度。

### 1.5 目标（可测的验收方向）

- **目标 E1**：引入 Playwright，建立真实浏览器 + 真实后端 E2E 测试能力，覆盖核心流全链路。
- **目标 E2**：E2E 与既有 vitest 单测分离（独立 runner、独立命令、独立目录），不污染既有快速反馈环。
- **目标 S5-1**：vitest.config.ts 改用 projects 模式，api/web 环境与 setupFiles 严格隔离。
- **目标 S5-2**：后端测试不再加载 jest-dom（无全局副作用污染），前端测试 jest-dom 仍生效。
- **目标 S5-3**：既有 1256 测试全绿无回归，S-5 advisory 反向同步移除。

## 2 · E2E 核心流验收标准（Given/When/Then）

> 全部 AC 须可被 Playwright 真实浏览器 + 真实后端（webServer 启动 `npm start`）端到端覆盖。AC 编号 E=E2E 核心流。核心流链路：login → user 列表 → role 操作 → transfer → 登出。

### 2.1 login 流

- **AC-E1 · 登录成功跳转**：GIVEN 后端 webServer 已就绪且 seed admin 用户存在（admin@example.com / admin123）/ WHEN 浏览器导航 `/login`，填写 admin@example.com / admin123 后提交登录 / THEN 登录成功，页面 URL 跳转至 `/users`，客户端持有有效 token（后续受保护路由请求可携带）。

### 2.2 user 列表流

- **AC-E2 · 用户列表渲染**：GIVEN 已登录（AC-E1 后持有 token）/ WHEN 导航 `/users` / THEN 页面渲染用户列表，列表非空（至少含 seed admin 用户）。
- **AC-E3 · 创建用户**：GIVEN 在 `/users` 页 / WHEN 触发创建用户，填写合法数据并提交 / THEN 列表新增一行，新创建用户在列表中可见（真实后端持久化）。
- **AC-E4 · 用户状态切换（versioned If-Match）**：GIVEN 列表存在某用户 version=N / WHEN 切换其状态（启用↔禁用）/ THEN 操作成功，请求携带 `If-Match: N`，后端返回新版本，UI 反映切换后的状态（versioned 写操作的端到端 round-trip 验证）。

### 2.3 role 操作流

- **AC-E5 · 角色列表渲染**：GIVEN 已登录 / WHEN 导航 `/roles` / THEN 页面渲染角色列表。
- **AC-E6 · 创建角色**：GIVEN 在 `/roles` 页 / WHEN 提交创建角色表单（合法数据）/ THEN 列表新增该角色（真实后端持久化）。
- **AC-E7 · 设置父角色（versioned If-Match）**：GIVEN 存在角色 A 与角色 B / WHEN 将 B 的父角色设为 A / THEN 操作成功，请求携带 `If-Match`，父子关系建立（versioned 写操作端到端 round-trip 验证）。
- **AC-E8 · 删除角色**：GIVEN 存在可删除角色 / WHEN 触发删除该角色 / THEN 该角色从列表消失（真实后端删除持久化）。

### 2.4 transfer 流

- **AC-E9 · 调岗表单渲染**：GIVEN 已登录 / WHEN 导航 `/transfer` / THEN 调岗表单渲染（含用户选择、目标部门等必填字段）。
- **AC-E10 · 提交调岗**：GIVEN 调岗表单已填合法数据 / WHEN 提交调岗 / THEN 请求成功（无 4xx/5xx 错误响应）。
- **AC-E11 · 调岗成功确认**：GIVEN 调岗提交成功 / THEN 页面展示成功反馈，且调岗结果持久——导航 `/users` 复核，目标用户 department 已更新为新部门。

### 2.5 登出流

- **AC-E12 · 登出跳转**：GIVEN 已登录 / WHEN 点击登出 / THEN 页面 URL 跳转至 `/login`。
- **AC-E13 · token 清除**：GIVEN 登出后 / THEN 客户端持有的鉴权 token 被清除（localStorage / sessionStorage 中无残留 token，后续请求不再携带 Authorization）。
- **AC-E14 · 登出后受保护路由守卫**：GIVEN 登出后（无 token）/ WHEN 直接访问 `/users` / THEN 受保护路由守卫生效，重定向回 `/login`，不展示 `/users` 受保护内容。

## 3 · S-5 闭合验收标准（vitest projects 模式）

> 全部 AC 须可通过 `npm test`（vitest run 全量）验证。AC 编号 S5=S-5 闭合。

- **AC-S5-1 · vitest projects 模式分离**：GIVEN 现有 `vitest.config.ts`（单一 `environment='node'` + 单一 `setupFiles=['apps/web/test/setup.ts']`）/ WHEN 改用 projects 模式声明两个独立 project——api project（`environment=node`，无 setupFiles）与 web project（`environment=jsdom`，setupFiles 加载 `apps/web/test/setup.ts`）/ THEN 两个 project 配置独立，api 测试与 web 测试的运行环境及 setupFiles 严格隔离（互不污染）。
- **AC-S5-2 · 后端测试无 jest-dom 污染**：GIVEN api project 配置（node 环境，无 setupFiles）/ WHEN 运行 `apps/api/test/**` 后端测试 / THEN 不加载 `apps/web/test/setup.ts`，jest-dom matcher 不注入全局，后端 node 测试环境纯净（无 DOM 相关全局副作用）。
- **AC-S5-3 · 前端测试 jest-dom 仍生效**：GIVEN web project 配置（jsdom 环境 + setupFiles）/ WHEN 运行 `apps/web/test/**` 前端测试 / THEN jest-dom matcher（如 `toBeInTheDocument`）在 jsdom 环境内正常生效，前端断言不回归。
- **AC-S5-4 · 既有测试全绿无回归**：GIVEN 既有 1256 测试 / WHEN 运行 `npm test`（vitest run 全量）/ THEN 全部测试通过（绿），通过数不少于 1256（无回归，无测试被静默跳过）。
- **AC-S5-5 · S-5 advisory 反向同步移除**：GIVEN Tech-Spec 反向同步 / THEN S-5 [advisory]（setupFiles 全局副作用）标注移除或改为"已消除"历史记录，`vitest.config.ts` 不再含单一 `setupFiles` 全局注入措辞。

## 4 · Q&A 决策（全 BLOCKING，未回答不进入 Spec）

### Q1 · E2E 测试目录位置？【BLOCKING】
**影响**：测试组织 / monorepo 结构 / Playwright config 位置 / 影响面边界。

**背景**：monorepo 现有 `apps/api`、`apps/web`、`packages/contracts` 结构，测试位于 `apps/*/test/`。E2E 跨 api+web 边界（真实浏览器调真实后端），归属需明确。

**方案**：①独立 `apps/e2e/`（与 api/web 平级，Playwright config + test/ 在内）；②放 `apps/web/test/e2e/`（归属 web，因 E2E 主要测 web 流）；③根目录 `e2e/`（Playwright 社区惯例，跳出 apps/ 结构）。

**决策：①独立 `apps/e2e/`**。理由：E2E 是独立"应用"（Playwright config + 真实浏览器 + 真实后端编排），跨 api+web 边界，放 web 下会暗示"仅测 web"语义错误；与 monorepo `apps/*` 平级对齐既有结构（apps/api apps/web → apps/e2e），Playwright config 与 test 文件同处 `apps/e2e/`。③根目录跳出 apps/ 违背本仓库 apps/* 约定。**阻塞下游：Tech-Spec Playwright config 路径（apps/e2e/playwright.config.ts）、test 目录结构、CI 工作目录。**

### Q2 · 真实后端启动方式？【BLOCKING】
**影响**：E2E 验收前置条件 / CI 编排 / 生命周期管理。

**背景**：E2E 须连真实后端（`npm start` = `tsx apps/api/src/server.ts`，端口 3000，首次启动建表 + seed admin）。启动方式决定 CI/本地是否需手动管理 server 生命周期。

**方案**：①Playwright `webServer` 配置自动启动 `npm start`（自动管理启动/健康检查/优雅关闭）；②手动启动（CI 与本地均需先 `npm start` 后台再跑 E2E）；③在 test fixture 内用 `child_process` spawn server。

**决策：①Playwright webServer 配置**。理由：Playwright 原生支持 webServer，自动管理生命周期（启动 → 等待端口就绪 → 测试运行 → 优雅关闭），CI/本地一致无需手动；`child_process` spawn 重复造轮子且易泄漏进程；手动启动违背"一键可复现"原则。baseURL 指向 `http://localhost:3000`，DB 隔离见 Q5。**阻塞下游：Tech-Spec playwright.config webServer 字段、baseURL、CI 端口冲突处理。**

### Q3 · E2E 是否计入 vitest 默认 `npm test` 命令？【BLOCKING】
**影响**：开发者本地反馈环 / CI 编排 / 命令矩阵。

**背景**：现 `npm test` = `vitest run`（1256 单测，秒级）。E2E（浏览器 + 真实后端）慢数十倍，是否混入默认 test 影响 DX。

**方案**：①不计入，独立 `npm run test:e2e`（playwright test），`npm test` 仍只跑 vitest；②计入，`npm test` 同时跑 vitest + playwright（一条命令全跑）；③合并为单一 `npm test` 但内部串两阶段。

**决策：①不计入，独立 `npm run test:e2e`**。理由：E2E 慢（浏览器启动 + 真实后端 + 真实交互），混入默认 test 拖慢本地快速反馈（vitest 秒级 vs E2E 分钟级），开发者改一行单测不应等 E2E；Playwright 与 Vitest 是不同 runner（不共享 config），天然分离；CI 可两阶段编排（`npm test` → `npm run test:e2e`），E2E 失败不阻塞已绿的快速单测反馈。新增 `package.json` script `test:e2e`（命令本身属 Tech Lead 细节，BA 仅定方向）。**阻塞下游：Tech-Spec package.json scripts 增项、CI workflow 两阶段编排。**

### Q4 · CI 环境 browser 下载策略？【BLOCKING】
**影响**：CI 执行时间 / CI 镜像体积 / 跨浏览器覆盖范围。

**背景**：Playwright 首次运行须下载浏览器二进制（chromium/firefox/webkit 各数十 MB）+ 系统依赖（libnss3 等）。CI 无浏览器时 E2E 无法跑。

**方案**：①`npx playwright install --with-deps chromium`（仅 chromium）；②`npx playwright install --with-deps`（全浏览器 chromium+firefox+webkit）；③CI 预装浏览器镜像 / `PLAYWRIGHT_BROWSERS_PATH` 缓存目录。

**决策：①仅 chromium + --with-deps，并缓存 `~/.cache/ms-playwright`**。理由：E2E 覆盖核心流，单浏览器足以验证（Chromium 是管理后台 MVP 主要目标浏览器，无跨浏览器兼容需求）；全浏览器三倍 CI 时间但边际价值低；`--with-deps` 装系统依赖。CI 缓存 `~/.cache/ms-playwright` 加速后续 run（避免重复下载）。跨浏览器 E2E 列为 future（Out of scope）。**阻塞下游：Tech-Spec CI workflow install 步骤、缓存配置、playwright.config projects（仅 chromium 单 project）。**

### Q5 · E2E 数据隔离策略？【BLOCKING】
**影响**：E2E 可重复性 / 开发库污染 / 测试间状态耦合。

**背景**：E2E 会创建/删除真实数据（create user / create role / delete role / transfer），若复用开发库 `./data/admin.db` 将污染本地数据且测试间状态耦合（前次 run 残留影响后次）。

**方案**：①独立临时 DB（`DB_PATH` 指向 e2e 隔离库，每 run 全新 seed admin，不污染 `./data/admin.db`）；②复用开发库 `./data/admin.db`（共享，不隔离）；③每 test 文件独立 DB（粒度更细但慢）。

**决策：①独立临时 DB**。理由：E2E 写真实数据，复用开发库污染本地状态且测试间耦合；每 test 文件独立 DB 过重（DB 初始化开销）；独立临时 DB 通过 `DB_PATH` 环境变量指向隔离路径（具体路径与清理时机属 Tech Lead 实现细节，BA 仅定方向：隔离 + 每 run 全新 seed admin）。凭据固定 admin@example.com / admin123（seed 行为，E2E 登录用）。**阻塞下游：Tech-Spec webServer env（DB_PATH）、globalSetup/teardown 数据清理、gitignore 隔离库。**

## 5 · 影响面估算

### 5.1 跨层文件清单

| 层 | 文件/目录 | 改动性质 | 改动点（WHAT 级，非 HOW） |
|----|-----------|----------|---------------------------|
| 新增 E2E app | `apps/e2e/`（含 playwright.config.ts + test/） | ③类新增 | Playwright config + 核心流 E2E 测试文件（覆盖 AC-E1~E14） |
| 测试配置 | `vitest.config.ts` | ②类重构 | 单 config 改 projects 模式（api node + web jsdom 两 project），消除单一 setupFiles 全局注入（AC-S5-1~S5-3） |
| 包脚本 | `package.json` | ③类新增 script | 新增 `test:e2e`（Q3），`test` 不变 |
| 前端 setup | `apps/web/test/setup.ts` | 零变更 | 仍由 web project setupFiles 引用（jest-dom 注入不变） |
| 依赖 | `package.json` devDeps | 零变更 | `@playwright/test` 已在（`^1.61.1`），无需新增 |

### 5.2 ①类 contracts 联动

**0 文件**。E2E 引入 + S-5 闭合均不改 contracts（packages/contracts），无 errorCodeSchema / 域 schema 变更，无 containment 断言失效。

### 5.3 测试影响（AI-006 两类标注）

| 文件 | 影响类型 | 说明 |
|------|----------|------|
| `apps/e2e/test/**`（新增） | ③类新增 | 覆盖 AC-E1~E14（核心流 E2E） |
| 既有 1256 单测 | ②类配置驱动验证 | projects 模式重构后须全绿（AC-S5-4），断言本身不改 |

## G1 自检声明

- **PRD 完整性**：章节齐全（背景与目标 / E2E AC / S-5 AC / Q&A 决策 / 影响面估算）+ frontmatter（id/status=decided/Q&A 摘要）+ Out of scope。
- **验收标准可测**：19 条 AC（AC-E1~E14 共 14 条 E2E + AC-S5-1~S5-5 共 5 条 S-5 闭合），每条 Given/When/Then 可被端到端验证（E2E：Playwright 真实浏览器 + 真实后端；S-5：`npm test` 全量验证）。
- **BLOCKING 项已拍板**：Q1-Q5 全部决策（status=decided 前提满足），每个 Q 给出决策①方案。
- **既有现状核验**：读 `vitest.config.ts` 确认 S-5 现状（`environment='node'` + `setupFiles=['apps/web/test/setup.ts']`，§1.3）；读 `apps/web/test/setup.ts` 确认仅 `import '@testing-library/jest-dom'`；读 `package.json` 确认 `@playwright/test` 已在 devDeps、`npm start` 启动方式、`npm test`=vitest run。
- **边界遵守**：未预定义 Playwright config 字段细节（ARCH-002 同源，属 Tech Lead）；未写实现代码；AC 描述"验收什么"不描述"怎么实现"。
- **Out of scope 明确**：跨浏览器 / 视觉回归 / 性能测试 / 非核心页 E2E / 移动端视口均列为 out of scope 或 future。

## Out of scope

- **跨浏览器 E2E（firefox/webkit）** —— Q4 决策仅 chromium，跨浏览器覆盖列为 future。
- **视觉回归 / 截图对比测试** —— 本轮 E2E 仅功能流验证，不做像素级视觉对比。
- **性能 / 压力测试** —— E2E 非性能测试，本轮不涉及。
- **非核心页 E2E 覆盖** —— departments / audit-logs / notifications / reports 页的 E2E 列为 future（本轮核心流为 R19 retro 圈定的 login → users → roles → transfer → 登出）。
- **移动端视口测试** —— 管理后台 MVP 仅桌面端，不做移动视口。
- **vitest 内嵌 Playwright 集成** —— 两 runner 保持独立（Q3），不做 vitest runner 内的 playwright 集成。
- **既有单测的 jsdom 化重构** —— S-5 仅切换 web project 环境为 jsdom，不重写既有前端测试逻辑（断言不改）。
- **contracts 改动** —— 本轮零 contracts 变更（§5.2）。
- **新规则 / check-rules.mjs 改动** —— 本轮无规则改动。
