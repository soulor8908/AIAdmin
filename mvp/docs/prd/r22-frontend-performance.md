---
doc_type: PRD
id: PRD-FRONTEND-PERFORMANCE-001
title: R22 前端性能加固（React.memo/useMemo/useCallback + 虚拟列表 react-window + 代码分割 React.lazy）+ 顺带闭合 R20 Review 5 项 Suggestion
status: decided
owner: ba@team
created: 2026-07-04
aligns: [PRD-WEB-AUTH-USER-001, PRD-USER-001, PRD-ROLE-001, PRD-TRANSFER-001]
prd_ref: RETRO-ROUND21-001
# Q&A 决策结果摘要：
# Q1=代码层静态改进 + 既有 1256 测试全绿 + 新增性能专项测试（不引入 benchmark 基准，vitest+jsdom 环境下性能数值不准） /
# Q2=react-window 8.x（社区成熟，~6KB，FixedSizeList 适合固定行高，须 S-23 版本核验 @types/react-window 配套） /
# Q3=R20 Review 5 项 Suggestion 全部顺带闭合（#1 AC-E7 强断言 / #2-#5 文档同步类）
---

# R22 前端性能加固 + 顺带闭合 R20 Review 5 项 Suggestion

> 本轮（R22）承接 R21 retro §6 候选清单第 1 项——前端性能加固。当前前端代码（apps/web/src/）无任何 React.memo / useMemo / useCallback 优化，App.tsx 全静态 import 无代码分割，UserListPage / RoleListPage 等 7 页全部一次性加载。本轮引入三项性能加固：①React.memo 包裹行组件 + useMemo/useCallback 稳定引用 ②react-window 虚拟列表（UserListPage / RoleListPage 行数 > 100 时启用）③React.lazy + Suspense 代码分割（7 页按路由懒加载）。
>
> **顺带闭合 R20 Review 5 项 Suggestion**（Q3 BLOCKING 决策全部闭合）：①AC-E7 父子关系断言强化（API GET 复核 parent_id）②playwright.config.ts retries=0 spec 偏离反向同步 ③Tech-Spec §2.3 @playwright/test devDeps 描述修正 ④Tech-Spec §7.2/§2.4 stale Admin@123 消除 ⑤task 文件数误差修正。
>
> **S-23 首次触发验证**（R21 固化）：react-window 是第三方库，Tech Lead 须在 spec 阶段预先核验 package.json 固定版本 + react-window 8.x API 文档（FixedSizeList / VariableSizeList / @types/react-window 配套），§10 预判替代方案。
>
> **PRD 边界**：BA 仅产出本 PRD（含验收标准 + Q&A BLOCKING 决策），不写实现代码、不预定义 react-window API 字段细节（属 Tech Lead 阶段产物，ARCH-002 同源约束）。AC 描述"验收什么"，不描述"怎么实现"。

## 1 · 背景与目标

### 1.1 R22 性能加固动机

当前前端性能现状（apps/web/src/ 核验）：

- **无 React.memo**：UserRow / RoleListPage 行内 `<tr>` 等子组件未 memo 包裹，父组件任意 state 变化（如 searchKeyword / loading）触发全表 re-render。
- **无 useMemo / useCallback**：UserListPage / RoleListPage 的 `handleToggleStatus` / `handleDelete` 等回调每次 render 重建新引用，传给子组件时即便子组件 memo 也无效（props 引用变化）。
- **无虚拟列表**：UserListPage / RoleListPage 用 `items.map((u) => <UserRow .../>)` 全量渲染，pageSize=20 当前不触发瓶颈，但角色列表潜在超 100 行场景（如继承链展开）会卡顿。
- **无代码分割**：App.tsx 全静态 import 7 页（Login/UserList/RoleList/DeptTree/AuditLog/NotificationList/Report/Transfer），首屏加载全部 chunk，首屏 TTFB 浪费。
- **客户端搜索无 useMemo**：RoleListPage L165-168 `filteredItems = keyword ? items.filter(...) : items` 每次 render 重算（即便 keyword 未变）。

**性能加固三方向**（Q1 静态改进路径）：
1. **React.memo + useMemo + useCallback**：行组件 memo 包裹 + 回调 useCallback 稳定引用 + 派生值 useMemo 缓存。
2. **react-window 虚拟列表**：UserListPage / RoleListPage 行数 > 阈值时启用 FixedSizeList（仅渲染可视区行）。
3. **React.lazy + Suspense 代码分割**：7 页按路由懒加载，首屏仅加载 /login chunk。

### 1.2 R20 Review 5 项 Suggestion 顺带闭合

R20 Review 报告（docs/review/e2e-introduction-review.md §7.2）5 项 Suggestion 非 blocking 但建议下轮闭合，R22 顺带闭合：

| # | Suggestion | 闭合方式 |
|---|---|---|
| 1 | AC-E7 父子关系断言强化（仅断言 modal 关闭，未直接验证 DB parent_id 更新） | R22 在 apps/e2e/tests/roles.spec.ts AC-E7 增 API GET `/v1/roles/:id` 复核 `parent_id === roleA.id`（参照 AC-E11 模式） |
| 2 | playwright.config.ts retries=0 偏离 spec §3.2 字面 `retries: CI ? 2 : 0` | R22 反向同步 e2e-introduction.tech.md §7 声明 retries=0 偏离理由（或恢复 spec 值，[advisory] 范围） |
| 3 | Tech-Spec §2.3 @playwright/test devDeps 描述误差（称"已在"但实际本轮才加入 devDeps） | R22 修正 e2e-introduction.tech.md §2.3 描述为"本轮新增 @playwright/test devDep" |
| 4 | Tech-Spec §7.2 / §2.4 stale 描述"PRD AC-E1 字面 Admin@123"（PRD 已修正为 admin123） | R22 更新 e2e-introduction.tech.md §7.2/§2.4 为"PRD AC-E1 已修正为 admin123"消除 stale |
| 5 | task 描述"新增 7 + 改动 5 = 12 文件"数字误差（实际 9 新增 + 5 改动 = 14） | R22 修正 task 文件数字（非 impl-writer 问题，文档同步） |

### 1.3 S-23 首次触发验证（R21 固化）

R21 固化的 S-23（Tech Lead 第三方库版本 API 核验缺口）在 R22 首次触发验证：react-window 是第三方库，Tech Lead 须在 spec 阶段预先核验：
- package.json 固定版本（react-window 待 Tech Lead 决策具体版本，建议 ^1.8.9 即 8.x 最新稳定版）
- react-window 8.x API 文档（FixedSizeList / VariableSizeList / fixedItemSize 属性 / children render prop）
- @types/react-window 配套版本（TypeScript 支持）
- §10 预判替代方案（若 react-window 8.x API 与预期不符，退回手写虚拟列表或 @tanstack/react-virtual）

若 Tech Lead 未在 spec 阶段核验版本 + §10 预判，impl 阶段发现 API 差异属 S-23 违规（R21 固化的"Tech Lead 版本核验缺口"），须按 §10.6 "impl-writer 须修复（非静默跳过）"落地并反向同步 Spec。

### 1.4 目标（可测的验收方向）

- **目标 P1**：React.memo + useMemo + useCallback 评估并落地，行组件 memo 包裹 + 回调稳定引用 + 派生值缓存。
- **目标 P2**：react-window 虚拟列表引入，UserListPage / RoleListPage 行数 > 阈值时启用 FixedSizeList。
- **目标 P3**：React.lazy + Suspense 代码分割，7 页按路由懒加载，首屏仅加载 /login。
- **目标 P4**：既有 1256 测试 + 14 E2E 测试全绿无回归（性能加固不破坏既有功能）。
- **目标 P5**：R20 Review 5 项 Suggestion 全部闭合。
- **目标 P6**：S-23 在 R22 首次触发验证（Tech Lead spec 阶段核验 react-window 版本 + §10 预判替代方案）。

## 2 · 性能加固验收标准（Given/When/Then）

> 全部 AC 须可通过 vitest 单测 + 既有 E2E 验证。AC 编号 P=Performance。性能数值基准不引入（Q1 决策，vitest+jsdom 环境下性能数值不准），验收以"代码层静态改进落地 + 既有测试全绿"为准。

### 2.1 React.memo + useMemo + useCallback

- **AC-P1 · 行组件 React.memo 包裹**：GIVEN UserRow / 角色行等行组件 / WHEN 父组件 state 变化（如 searchKeyword / loading）但行 props 未变 / THEN 行组件不 re-render（React.memo 浅比较 props 跳过）。
- **AC-P2 · 回调 useCallback 稳定引用**：GIVEN UserListPage 的 `handleToggleStatus` / `handleDelete` 等回调 / WHEN 父组件 re-render / THEN 回调引用稳定（useCallback 依赖数组正确，不每次 render 重建）。
- **AC-P3 · 派生值 useMemo 缓存**：GIVEN RoleListPage 的 `filteredItems`（L165-168 客户端搜索过滤结果）/ WHEN searchKeyword / items 未变 / THEN filteredItems 不重算（useMemo 缓存）。

### 2.2 react-window 虚拟列表

- **AC-P4 · UserListPage 虚拟列表启用**：GIVEN UserListPage 行数 > 阈值（如 > 50 行，PRD 不定具体阈值，属 Tech Lead 实现细节）/ WHEN 渲染用户列表 / THEN 启用 react-window FixedSizeList 仅渲染可视区行（非全量 map）。
- **AC-P5 · RoleListPage 虚拟列表启用**：GIVEN RoleListPage 行数 > 阈值 / WHEN 渲染角色列表 / THEN 启用 react-window FixedSizeList 仅渲染可视区行。
- **AC-P6 · 虚拟列表行数 ≤ 阈值回退普通渲染**：GIVEN 行数 ≤ 阈值 / WHEN 渲染列表 / THEN 回退普通 `items.map` 渲染（避免小列表引入 react-window 不必要开销）。

### 2.3 React.lazy + Suspense 代码分割

- **AC-P7 · 路由级懒加载**：GIVEN App.tsx 7 页路由 / WHEN 构建产物 / THEN 每页独立 chunk（React.lazy + Suspense 包裹，首屏仅加载 /login chunk，其他页按需加载）。
- **AC-P8 · Suspense fallback**：GIVEN 懒加载组件加载中 / WHEN 用户导航到懒加载路由 / THEN 显示 Suspense fallback（如"加载中..."），不白屏。

### 2.4 既有测试全绿

- **AC-P9 · 既有 1256 vitest 测试全绿**：GIVEN 性能加固改动 / WHEN 运行 `npm test` / THEN 既有 1256 测试全部通过（无回归，性能加固不破坏既有功能）。
- **AC-P10 · 既有 14 E2E 测试全绿**：GIVEN 性能加固改动 / WHEN 运行 `npm run test:e2e` / THEN 既有 14 E2E 测试全部通过（核心流不受性能加固影响）。

## 3 · R20 Review 5 项 Suggestion 闭合验收标准

> 全部 AC 须可通过 git diff / Read 核验。AC 编号 S20=R20 Suggestion 闭合。

- **AC-S20-1 · AC-E7 父子关系断言强化**：GIVEN R20 Review Suggestion #1 / WHEN 修改 apps/e2e/tests/roles.spec.ts AC-E7 / THEN 增 API GET `/v1/roles/:id` 复核 `parent_id === roleA.id`（参照 AC-E11 模式，强断言替代 modal 关闭弱断言）。
- **AC-S20-2 · playwright.config.ts retries=0 spec 偏离反向同步**：GIVEN R20 Review Suggestion #2 / WHEN 反向同步 e2e-introduction.tech.md §7 / THEN §7 声明 retries=0 偏离 spec §3.2 字面 `retries: CI ? 2 : 0` 的理由（或恢复 spec 值，[advisory] 范围）。
- **AC-S20-3 · Tech-Spec §2.3 devDeps 描述修正**：GIVEN R20 Review Suggestion #3 / WHEN 修正 e2e-introduction.tech.md §2.3 / THEN 描述为"本轮新增 @playwright/test devDep"（消除"已在"误差）。
- **AC-S20-4 · Tech-Spec §7.2/§2.4 stale Admin@123 消除**：GIVEN R20 Review Suggestion #4 / WHEN 更新 e2e-introduction.tech.md §7.2/§2.4 / THEN 描述为"PRD AC-E1 已修正为 admin123"（消除 stale Admin@123）。
- **AC-S20-5 · task 文件数误差修正**：GIVEN R20 Review Suggestion #5 / WHEN 修正本轮 task 文件数字 / THEN task 描述与 impl-writer 自报清单一致（9 新增 + 5 改动 = 14 源文件，非 12）。

## 4 · Q&A 决策（全 BLOCKING，未回答不进入 Spec）

### Q1 · R22 性能加固验收方式？【BLOCKING】

**影响**：验收边界 / 测试策略 / 是否引入 benchmark 基准。

**背景**：性能加固传统验收是 benchmark 基准（render 次数 / TTI / FCP 等），但 vitest+jsdom 环境下性能数值不准（jsdom 非真实浏览器，无 layout/paint）。

**方案**：①代码层静态改进 + 既有测试全绿 + 新增性能专项测试（React.memo 落地核验 + lazy chunk 产物核验，不引入 benchmark）；②引入 benchmark 基准测试（react-performance-testing / @testing-library/react-hooks render count 测量，定量验证 memo 效果）；③仅 React.memo 评估不动代码（性能评估文档 + 标记可优化点）。

**决策：①代码层静态改进 + 既有测试全绿**。理由：vitest+jsdom 环境下性能数值不准（jsdom 非真实浏览器，无 layout/paint），benchmark 基准在单元测试层不可靠；代码层静态改进（React.memo 包裹 + useCallback 稳定引用 + useMemo 缓存 + react-window 虚拟列表 + React.lazy 代码分割）的"落地核验"可通过单测验证组件 memo 属性 / lazy chunk 产物存在，无需性能数值；既有 1256 + 14 E2E 测试全绿保证性能加固不破坏既有功能。②benchmark 复杂度高且 vitest 环境不稳定，列为 future（真实浏览器性能测试可走 Playwright + Lighthouse CI，非本轮范围）。③仅评估不动代码无法闭合 R20 Suggestion #1（AC-E7 强断言增强）。**阻塞下游：Tech-Spec 测试策略（新增性能专项测试 + 既有测试全绿验证，不引入 benchmark）。**

### Q2 · 虚拟列表库选择？【BLOCKING】

**影响**：依赖新增 / API 形式 / S-23 触发场景。

**背景**：虚拟列表是 R22 性能加固的核心第三方库，引入须选具体库 + 版本。S-23（R21 固化）要求 Tech Lead 在 spec 阶段预先核验版本 API。

**方案**：①react-window 8.x（社区成熟，~6KB，FixedSizeList 适合固定行高，@types/react-window 配套）；②@tanstack/react-virtual 3.x（更现代，支持动态行高，API 较重，包体积略大）；③不引入虚拟列表（仅 memo + 代码分割，虚拟列表列为 future）。

**决策：①react-window 8.x**。理由：UserListPage / RoleListPage 行高固定（单行按钮+文本），FixedSizeList 足够；react-window 8.x 社区成熟稳定，包体积小（~6KB），API 简单（FixedSizeList + itemSize + children render prop）；@types/react-window 配套 TypeScript 支持。②@tanstack/react-virtual 过重（动态行高场景未来才需要），当前固定行高用不上。③不引入虚拟列表无法验证 S-23 在第三方库场景的触发（R21 固化目标）。**阻塞下游：Tech-Spec 依赖新增（react-window + @types/react-window devDeps）+ §10 S-23 版本核验预判（react-window 8.x API + 替代方案）。**

### Q3 · R20 Review 5 项 Suggestion 是否在 R22 顺带闭合？【BLOCKING】

**影响**：R22 范围 / 跨轮遗留 / 工作量。

**背景**：R20 Review 5 项 Suggestion 非 blocking 但建议下轮闭合，R22 是否顺带闭合全部。

**方案**：①全部闭合（#1 AC-E7 强断言 + #2-#5 文档同步）；②仅闭合文档类（#2-#5），#1 单独轮；③本轮不顺带闭合（专注性能加固）。

**决策：①全部闭合**。理由：#1 AC-E7 强断言增强属 E2E 测试增强（参照 AC-E11 模式加 API GET 复核 parent_id），与 R22 性能加固同属"前端层改进"，可顺带闭合；#2-#5 文档同步类工作量极小（编辑 e2e-introduction.tech.md 几行）；跨轮遗留违背 R18 S-21 固化的"加性安全场景须本轮收尾闭合（不允许跨轮遗留）"原则。②#1 单独轮增加轮次开销不必要。③跨轮遗留违背 S-21 原则。**阻塞下游：Tech-Spec 范围含 R20 Suggestion 5 项闭合（§9 受影响清单含 e2e-introduction.tech.md）。**

## 5 · 影响面估算

### 5.1 跨层文件清单

| 层 | 文件/目录 | 改动性质 | 改动点（WHAT 级，非 HOW） |
|----|-----------|----------|---------------------------|
| 前端组件 | `apps/web/src/components/UserRow.tsx` 等 | ②类重构 | React.memo 包裹行组件 |
| 前端页面 | `apps/web/src/pages/UserListPage.tsx` / `RoleListPage.tsx` | ②类重构 | useMemo/useCallback + react-window FixedSizeList 启用阈值判断 |
| 前端路由 | `apps/web/src/App.tsx` | ②类重构 | React.lazy + Suspense 包裹 7 页路由 |
| 前端依赖 | `apps/web/package.json` | ③类新增 dep | react-window + @types/react-window |
| 前端测试 | `apps/web/test/**/*.test.tsx` | ③类新增 + ②类改造 | 新增性能专项测试（memo 落地核验 / lazy chunk 产物核验）+ 既有测试适配 memo 行为 |
| E2E 测试 | `apps/e2e/tests/roles.spec.ts` | ②类改造 | AC-E7 增 API GET 复核 parent_id（AC-S20-1） |
| 文档同步 | `docs/spec/e2e-introduction.tech.md` | ②类改造 | §7.2/§2.4 stale Admin@123 消除 + §2.3 devDeps 描述修正 + §7 retries 偏离同步（AC-S20-2/3/4） |

### 5.2 ①类 contracts 联动

**0 文件**。性能加固不改 contracts（packages/contracts），无 errorCodeSchema / 域 schema 变更，无 containment 断言失效。

### 5.3 测试影响（AI-006 两类标注）

| 文件 | 影响类型 | 说明 |
|------|----------|------|
| `apps/web/test/**/*.test.tsx`（新增） | ③类新增 | 性能专项测试（memo 落地核验 / lazy chunk 产物核验） |
| 既有 1256 单测 | ②类配置驱动验证 | memo/useCallback 改动后须全绿（AC-P9），断言本身不改（除非 memo 改变 render 行为，如 useEffect 依赖数组变化） |
| 既有 14 E2E | ②类验证 | react-window 虚拟列表可能改变 DOM 结构（行可能不在 viewport），E2E 须适配（AC-P10） |

## G1 自检声明

- **PRD 完整性**：章节齐全（背景与目标 / 性能 AC / R20 Suggestion AC / Q&A 决策 / 影响面估算）+ frontmatter（id/status=decided/Q&A 摘要）+ Out of scope。
- **验收标准可测**：15 条 AC（AC-P1~P10 共 10 条性能 + AC-S20-1~S20-5 共 5 条 Suggestion 闭合），每条 Given/When/Then 可被 vitest 单测 / E2E / git diff 验证。
- **BLOCKING 项已拍板**：Q1-Q3 全部决策（status=decided 前提满足），每个 Q 给出决策①方案。
- **既有现状核验**：读 `UserListPage.tsx` 确认无 memo/useMemo/useCallback + 客户端搜索 `filteredItems` 每次 render 重算；读 `RoleListPage.tsx` 确认同；读 `App.tsx` 确认全静态 import 7 页无 lazy；读 `apps/web/package.json` 确认无 react-window 依赖；读 R20 Review 报告 §7.2 确认 5 项 Suggestion 明细。
- **边界遵守**：未预定义 react-window API 字段细节（ARCH-002 同源，属 Tech Lead）；未写实现代码；AC 描述"验收什么"不描述"怎么实现"。
- **Out of scope 明确**：benchmark 基准测试 / 真实浏览器性能测试（Lighthouse CI） / 移动端性能 / 服务端渲染（SSR） / 状态管理库引入（Redux/Zustand）均列为 out of scope。

## Out of scope

- **benchmark 基准测试** —— vitest+jsdom 环境下性能数值不准，本轮不引入（Q1 决策）。
- **真实浏览器性能测试（Lighthouse CI / Playwright trace 性能分析）** —— 列为 future，本轮仅代码层静态改进。
- **移动端性能优化** —— 管理后台 MVP 仅桌面端，不做移动视口性能。
- **服务端渲染（SSR） / 静态生成（SSG）** —— 本轮仅客户端性能加固，不引入 SSR/SSG。
- **状态管理库引入（Redux/Zustand/Jotai）** —— 当前 useState 足够，性能加固不引入状态管理库（§5.3 D5 约束保持）。
- **Web Worker / 并发渲染（useTransition/useDeferredValue）** —— React 18 并发特性列为 future，本轮仅 memo + lazy + 虚拟列表。
- **contracts 改动** —— 本轮零 contracts 变更（§5.2）。
- **新规则 / check-rules.mjs 改动** —— 本轮无规则改动。
- **可访问性深化（screen reader / WCAG AA）** —— 列为 R23 候选，本轮不顺带。
- **跨浏览器 E2E（firefox/webkit）** —— 列为 R24 候选，本轮不顺带。
