---
doc_type: Review
id: REVIEW-FRONTEND-PERFORMANCE-001
title: R22「前端性能加固 + 闭合 R20 Review 5 项 Suggestion」G6 验收 Review 报告
prd_ref: PRD-FRONTEND-PERFORMANCE-001
spec_ref: TECH-FRONTEND-PERFORMANCE-001
round: R22
verdict: pass
created: 2026-07-04
reviewer: reviewer@team
---

# R22「前端性能加固（React.memo + react-window 1.x + React.lazy）+ 闭合 R20 Review 5 项 Suggestion」G6 验收 Review 报告

## §0 速览

| 维度 | 结果 |
|------|------|
| **verdict** | **pass** |
| Blocker 数 | 0 |
| Advisory 数 | 1（既有/环境性 TS 配置，非 R22 引入） |
| AC 对齐数 | 15/15（AC-P1~P10 性能 10 条 ✅ + AC-S20-1~S20-5 R20 Suggestion 闭合 5 条 ✅） |
| typecheck（canonical `npm run typecheck`） | exit 0 ✅ |
| lint:rules（根 `node scripts/check-rules.mjs`） | exit 0 ✅（META-003/META-004 双向绑定闭合；6 条 AI-005 + 3 条 SEC-002 均既有非本轮新增） |
| vitest | 57 files / 1263 tests passed（76.86s）✅（R20 1256 → R22 1263，+7 = performance.test.tsx 7 用例，0 回归） |
| E2E | 14 passed（14.3s，AC-E1~E14 全绿，含 AC-E7 强断言增强后通过）✅ |
| advisory 反向同步 | D5 阈值（§7.1+§10.3）+ D2 react-window 版本（§3.2+§10.6 S-23）均闭合 ✅ |
| S-23 首次触发验证生效 | Tech-Spec §3.2 + §10.6 反向同步标注完整 + package.json 实装版本一致 ✅ |
| ARCH-002 | contracts 零变更 ✅（git status 确认 packages/contracts/ 未在改动列表） |
| ARCH-003 | apps/web/ 不 import apps/api/src/** ✅（前端层 + E2E HTTP 交互） |
| tsconfig 是否被 R22 改动 | 否（`git diff HEAD -- tsconfig` 为空）→ baseUrl 弃用失败非 R22 引入 |

**通过判定**：三件套全绿（canonical typecheck exit 0 / lint:rules exit 0 / vitest 1263 全绿 / E2E 14 全绿）+ 15 AC 对齐 + 2 项 advisory 反向同步闭合 + S-23 首次触发验证生效 + impl-writer 自报准确（S-17 通过）+ ARCH 检查通过 + 无 Blocker → **pass**。

> 唯一 Advisory：`pnpm --filter @admin/web run build`（`tsc --noEmit && vite build`）的 tsc 步骤在沙箱 TS 5.9.3 下报 `baseUrl` 弃用 error TS5101。经独立核验：tsconfig.json 未被 R22 改动 + lockfile 中 typescript 版本（5.9.3）未被 R22 bump → **既有/环境性 TS 配置问题**，非 R22 引入。R22 源码本身 typecheck 干净（canonical `npm run typecheck` exit 0 + workspace tsc 从 apps/web 直接跑 exit 0），vite build 单独跑成功产出 8 个 lazy chunk。详见 §3 / §9 Advisory #1。

---

## §1 验收范围与产物清单

### 1.1 核心产物（已 Read 全文核验）

| 产物 | 路径 | status | 核验结论 |
|------|------|--------|----------|
| PRD | `docs/prd/r22-frontend-performance.md` | decided | 15 AC（AC-P1~P10 + AC-S20-1~S20-5）+ 3 BLOCKING Q&A 全拍板 ✅ |
| Tech-Spec | `docs/spec/r22-frontend-performance.tech.md` | ready-for-impl | D1-D8 决策 + §10.6 S-23 反向同步标注 + §10.7 替代方案预判 ✅ |
| 工作流模板 | `docs/workflow/spec-first-workflow.md` | — | R21 固化的 S-23（Tech Lead §10 增项 + 版本核验约束 + BA 凭据核验）已落，R22 首次触发验证 ✅ |
| R21 retro | `docs/retro/round21-retro.md` | — | G6.5 第三次落地范式参考（R22 业务轮 → G6.5 不适用，仅声明） |
| R20 retro | `docs/retro/round20-retro.md` | — | 5 项 Suggestion 来源 + S-23 来源 ✅ |

### 1.2 改动文件（git status 实跑核验，与 impl-writer 自报一致）

```
 M apps/e2e/tests/_helpers.ts          （+23 行：apiGetRole 函数）
 M apps/e2e/tests/roles.spec.ts        （+6 行：AC-E7 强断言 L103-106）
 M apps/web/package.json               （±4 行：react-window@^1.8.11 + @types/react-window@^1.8.8）
 M apps/web/src/App.tsx                （8 页 React.lazy + Suspense）
 M apps/web/src/components/UserRow.tsx  （memo 包裹）
 M apps/web/src/pages/RoleListPage.tsx  （useMemo + useCallback + FixedSizeList + RoleRow 引用）
 M apps/web/src/pages/UserListPage.tsx  （同上）
 M docs/spec/e2e-introduction.tech.md  （3 处文档同步：§2.3 / §2.4+§7.2 / §7.4）
 M package-lock.json                   （npm install 附属，+react-window 1.8.11 / @types/react-window 1.8.8 / 1 传递依赖；typescript 5.9.3 未变）
?? apps/web/src/components/RoleRow.tsx  （新增 memo 行组件）
?? apps/web/test/performance.test.tsx  （7 用例性能专项测）
?? docs/prd/r22-frontend-performance.md
?? docs/spec/r22-frontend-performance.tech.md
```

**git status 与任务清单逐项一致**（9 M + 4 ??），tsconfig.json 未出现在改动列表。详见 §6 git diff 抽样核验。

---

## §2 15 AC 逐条对齐表（AI-007）

### 2.1 性能 AC（AC-P1~P10，10 条）

| AC | 描述 | 实现位置 | 验证证据 | 结论 |
|----|------|----------|----------|------|
| **AC-P1** | 行组件 React.memo 包裹 | `apps/web/src/components/UserRow.tsx:30,52` + `apps/web/src/components/RoleRow.tsx:16,29` | `export const UserRow = memo(function UserRow(...) {...})`；`export const RoleRow = memo(function RoleRow(...) {...})`；performance.test.tsx L109-138 核验 `$$typeof === Symbol.for('react.memo')` + `compare === null`（默认浅比较）+ L142-170 行为核验（同 props 引用不触发 re-render） | ✅ pass |
| **AC-P2** | 回调 useCallback 稳定引用 | `UserListPage.tsx:112,155,165`（handleToggleStatus/handleToggleRoles/handleViewEffectivePermissions）+ `RoleListPage.tsx:115,140,159,168,177`（handleDelete/handleUnsetParent/handleSetParentUpdated/handleSetParent/handleViewChain） | 8 处 useCallback 依赖数组完整（handleToggleStatus 依赖 [refresh]→refresh 依赖 [page,statusFilter]；handleToggleRoles/handleSetParent/handleViewChain 空数组无外部依赖） | ✅ pass |
| **AC-P3** | 派生值 useMemo 缓存 filteredItems | `RoleListPage.tsx:197-200` | `const filteredItems = useMemo(() => { const keyword = searchKeyword.trim().toLowerCase(); return keyword ? items.filter(...) : items; }, [items, searchKeyword])`；依赖数组 `[items, searchKeyword]` 完整 | ✅ pass |
| **AC-P4** | UserListPage 行数 > 阈值启用 FixedSizeList | `UserListPage.tsx:41,172,217-241` | `VIRTUAL_LIST_THRESHOLD = 50`；`useVirtualList = items.length > 50`；`<FixedSizeList height=600 itemSize=48 width="100%" itemData overscanCount=5>` + children render prop 透传 `style` 到根 `<div style={style}>`（§10.1 约束满足）；performance.test.tsx L179-197 核验 51 行启用虚拟列表（User50 viewport 外未渲染 + 无 `<table>`） | ✅ pass |
| **AC-P5** | RoleListPage 行数 > 阈值启用 FixedSizeList | `RoleListPage.tsx:40,204,240-265` | 同 AC-P4 模式，`filteredItems.length > 50` 启用 FixedSizeList + style 透传（L254） | ✅ pass |
| **AC-P6** | 行数 ≤ 阈值回退普通 map | `UserListPage.tsx:242-265` + `RoleListPage.tsx:266-291` | ≤50 路径渲染 `<table><thead><tbody>{items.map(...)}</tbody>` 保持既有 `<table><tr><td>` DOM 结构；performance.test.tsx L206-224 核验 5 行回退普通 map（`<table>` 存在 + 全量 5 行可见） | ✅ pass |
| **AC-P7** | 路由级懒加载（每页独立 chunk） | `apps/web/src/App.tsx:10,16-23` | `import { lazy, Suspense } from 'react'`；8 页全部 `lazy(() => import(...).then((m) => ({ default: m.XxxPage })))`（named→default 转换，§3.5 约束满足）；**vite build 产物核验**：8 个独立 chunk（LoginPage-1.23KB / UserListPage-7.61KB / RoleListPage-7.25KB / TransferPage-2.70KB / AuditLogPage-2.74KB / DeptTreePage-3.21KB / ReportPage-4.03KB / NotificationListPage-5.84KB）；performance.test.tsx L229-253 静态源码核验 8 页 lazy 包装 | ✅ pass |
| **AC-P8** | Suspense fallback 文案"加载中..." | `apps/web/src/App.tsx:29` | `<Suspense fallback={<div>加载中...</div>}>`；performance.test.tsx L255-261 正则核验 `import { lazy, Suspense } from 'react'` + `<Suspense fallback={<div>加载中...</div>}>` | ✅ pass |
| **AC-P9** | 既有 vitest 测试全绿无回归 | `npm test`（根 `vitest run`） | **57 files / 1263 tests passed**（76.86s）；R20 1256 → R22 1263（+7 = performance.test.tsx 7 用例），既有 1256 无回归 | ✅ pass |
| **AC-P10** | 既有 14 E2E 全绿 | `npm run test:e2e`（根 `playwright test`） | **14 passed（14.3s）**，AC-E1~E14 全绿，含 AC-E7 强断言增强后仍通过（roles.spec.ts:57） | ✅ pass |

> AC-P7 注：PRD §1.1 字面"7 页"指首屏后按需加载的 7 个业务页，实现将 LoginPage 亦 lazy 包裹统一（首屏 chunk + 与其他页一致 lazy 形式），performance.test.tsx L231-232 显式声明此解释。8 页 lazy + 8 chunk 产物一致，无偏离。

### 2.2 R20 Review Suggestion 闭合（AC-S20-1~S20-5，5 条）

| AC | 描述 | 实现位置 | 验证证据 | 结论 |
|----|------|----------|----------|------|
| **AC-S20-1** | AC-E7 父子关系断言强化（API GET 复核 parent_role_id） | `apps/e2e/tests/_helpers.ts:100-112`（apiGetRole 新增）+ `apps/e2e/tests/roles.spec.ts:103-106` | `apiGetRole(request, token, roleB.id)` → `expect(updated.parent_role_id).toBe(roleA.id)`（强断言替代 modal 关闭弱断言，参照 AC-E11 模式）；既有 If-Match header 强断言保留（roles.spec.ts:94-98）；E2E 14 passed 证明强断言通过 | ✅ pass |
| **AC-S20-2** | retries=0 spec 偏离反向同步 | `docs/spec/e2e-introduction.tech.md` §7.4（L442-455 新增章节） | git diff 显示新增 §7.4 `[advisory] retries=0 偏离 spec §3.2 字面 retries: CI ? 2 : 0`，含 5 条偏离理由（task spec 要求 / 加性安全场景 / E2E 14 passed 证明可行 / CI 时间优化 / future 升级路径）+ 合规论证 | ✅ pass |
| **AC-S20-3** | Tech-Spec §2.3 devDeps 描述修正 | `docs/spec/e2e-introduction.tech.md` §2.3（L88） | git diff：`devDependencies 已含 @playwright/test` → `devDependencies 本轮新增 @playwright/test: ^1.61.1（R22 AC-S20-3 修正：原文称"已在 devDependencies"为误差，实际 R20 才加入 devDeps）` | ✅ pass |
| **AC-S20-4** | Tech-Spec §7.2/§2.4 stale Admin@123 消除 | `docs/spec/e2e-introduction.tech.md` §2.4（L110/L112）+ §7.2（L428-436） | git diff：§2.4 `PRD AC-E1 字面写凭据 ... Admin@123` → `PRD AC-E1 已修正为凭据 ... admin123（R22 AC-S20-4 消除 stale Admin@123）`；§7.2 同步更新"反向同步目标（已闭合）"；stale Admin@123 描述已消除 | ✅ pass |
| **AC-S20-5** | task 文件数误差修正 | Tech-Spec §1.2 表第 5 行声明 | "本轮 task 描述准确，无历史文件改"——R22 task 描述与 impl-writer 自报清单一致（git status 实跑 9 M + 4 ?? 与自报一致）；R20 历史 task 文件非本轮编辑范围（属已闭合的历史遗留，本轮 task 直接准确） | ✅ pass（声明闭合，无历史文件需改） |

**15 AC 全部对齐 ✅。**

---

## §3 三件套独立核验结果

> Reviewer 独立实跑（非仅信赖编排者），命令在 `/workspace/mvp` 执行。

| 核验项 | 命令 | 结果 | 判定 |
|--------|------|------|------|
| **typecheck（canonical）** | `npm run typecheck`（根 `tsc -p tsconfig.json --noEmit`） | ROOT_TYPECHECK_EXIT=0，无 error 输出 | ✅ exit 0 |
| **typecheck（R22 源码本身）** | workspace tsc 二进制从 apps/web 直接跑 `/workspace/mvp/node_modules/.bin/tsc --noEmit` | WORKSPACE_TSC_EXIT=0，无 error 输出 | ✅ R22 代码类型健全 |
| **lint:rules** | `npm run lint:rules`（根 `node scripts/check-rules.mjs`） | exit 0；enforcement 覆盖 AI-005/ARCH-001/002/003/CODE-001~004/META-001/003/004/SEC-001/002/003a；**双向绑定 META-003(声明即实现)+META-004(实现即声明) 已校验**；3 条 SEC-002 豁免（audit.ts/auth.ts/notification.ts 均既有）+ 6 条 AI-005 建议（role-inheritance 测试枚举字面量，均既有非本轮新增） | ✅ exit 0 |
| **vitest** | `npm test`（根 `vitest run`） | **57 files / 1263 tests passed**（76.86s）；`|web|` project 前缀证明 workspace 模式生效；R20 1256 → R22 1263（+7 = performance.test.tsx） | ✅ 全绿 |
| **E2E** | `npm run test:e2e`（根 `playwright test`） | **14 passed（14.3s）**，AC-E1~E14 全绿，含 AC-E7（roles.spec.ts:57 强断言增强后通过） | ✅ 全绿 |
| **vite build 产物** | `npx vite build`（apps/web） | exit 0，98 模块，2.10s；**8 个 lazy chunk 产物**（LoginPage/UserListPage/RoleListPage/TransferPage/AuditLogPage/DeptTreePage/ReportPage/NotificationListPage 各独立 chunk）+ index 主 chunk 230KB | ✅ 产物含 vite build |
| **pnpm web build（全脚本）** | `pnpm --filter @admin/web run build`（`tsc --noEmit && vite build`） | **tsc 步骤失败**：`tsconfig.json(3,3): error TS5101: Option 'baseUrl' is deprecated`（exit 2，vite build 未执行） | ⚠️ 见下方说明（非 R22 引入） |

### §3.1 pnpm web build 失败的根因判定（非 R22 引入）

`pnpm --filter @admin/web run build` 在 tsc 步骤报 `baseUrl` 弃用 error。独立核验证据：

1. **tsconfig.json 未被 R22 改动**：`git diff HEAD -- tsconfig` 为空（根 `tsconfig.json` + `apps/web/tsconfig.json` 均未改）。根 tsconfig.json L16 `"baseUrl": "."` 是既有配置，apps/web/tsconfig.json L2 `extends: "../../tsconfig.json"` 继承之。
2. **TypeScript 版本未被 R22 bump**：lockfile 中 `node_modules/typescript` 版本 5.9.3（`^5.4.0` 解析），`git diff HEAD -- package-lock.json` 中 typescript 版本行无 `+` 前缀（diff 新增 `+` 行仅 react-window 1.8.11 / @types/react-window 1.8.8 / 1 传递依赖 5.2.1）。
3. **R22 源码本身 typecheck 干净**：canonical `npm run typecheck`（exit 0）+ workspace tsc 二进制从 apps/web 直接跑（exit 0）均无 error。
4. **根因**：TS 5.5+ 将 deprecated compilerOption（baseUrl）升级为 error TS5101（无 `ignoreDeprecations` 时）。沙箱解析 `^5.4.0` → 5.9.3 触发。pnpm 递归 run 在 apps/web 解析 extends 链时命中继承的 baseUrl 并报 error；直接 workspace tsc 调用未触发（调用上下文差异）。

**结论**：该失败是**既有/环境性 TS 配置问题**（baseUrl 在 TS 5.5+ 弃用升级为 error），与 R22 改动无关——tsconfig + TS 版本均未被 R22 改动，R22 源码类型健全，vite build 产物正确。属 Advisory 范围（§9 Advisory #1），非 R22 Blocker。canonical typecheck gate（`npm run typecheck`）exit 0 满足验收。

---

## §4 advisory 偏离反向同步核验（AI-003）

> Reviewer 通过 Read Tech-Spec 全文 + git diff 核实章节已实际编辑（非仅代码注释，R19 S-21 固化的"伪同步检测"）。

### 4.1 D5 react-window 启用阈值 50 行（[advisory]）

- **Tech-Spec §7.1**（L306-308）：`D5 阈值 50 行属实现细节（BA Q1 不定具体阈值），[advisory] 允许 impl-writer 据实际性能测试调整阈值`。impl-writer 若偏离 50 须列偏离理由。
- **Tech-Spec §10.3**（L348-349）：`react-window 阈值 50 行（D5）单处使用，符合 S-19 ≤3 处阈值`（组合副作用预判中声明）。
- **实现落地**：`UserListPage.tsx:41` + `RoleListPage.tsx:40` 均为 `const VIRTUAL_LIST_THRESHOLD = 50`，与 spec 一致，未偏离。

**判定**：D5 advisory 反向同步闭合 ✅（§7.1 + §10.3 双标注，实现未偏离 50）。

### 4.2 D2 react-window 版本核验（[R22 §10.6 S-23 反向同步]）

- **Tech-Spec §3.2**（L133-145）：完整 `[R22 §10.6 S-23 反向同步]` 引用块——含 6 条 npm registry 核验结论（不存在 8.x 系列 / npm latest 指向 2.2.7 / 1.x 最新 1.8.11 / 1.x 非原生 TS 须装 @types / 2.x 原生 TS 但 API 重写 / @types/react-window 1.x 最新 1.8.8）+ 实测安装验证（`npm install react-window@1.8.11 @types/react-window@1.8.8` + `npm run typecheck` exit 0）。
- **Tech-Spec §10.6**（L359-367）：`[R22 §10.6 S-23 首次触发验证生效]` 标注，Tech Lead spec 阶段预先核验版本 + 反向同步 Spec。
- **Tech-Spec §7.2**（L310-312）：`D2 react-window@1.8.11（非 BA Q2 字面"8.x"）属 S-23 触发的 Tech Lead 版本核验修正，已在 §3.2 + §2.3 + §10.6 标注`。
- **实现落地**：`apps/web/package.json` L18 `"react-window": "^1.8.11"` + L14 `"@types/react-window": "^1.8.8"`，与 spec D2 决策一致。

**判定**：D2 advisory 反向同步闭合 ✅（§3.2 + §10.6 + §7.2 三处标注，实现版本一致）。

---

## §5 S-23 首次触发验证生效证据

> R21 固化的 S-23（Tech Lead 第三方库版本 API 核验缺口）在 R22 首次触发验证。Reviewer 逐条核验 Tech-Spec §3.2 D2 决策 + §10.6 反向同步标注的 5 项核验结论。

| # | S-23 核验结论 | Tech-Spec 标注位置 | npm/源码实证 | 判定 |
|---|--------------|-------------------|--------------|------|
| 1 | react-window 不存在 8.x 系列（1.8.x 中"8"是 MINOR 非 major） | §3.2 L141 + §10.6 L362 | BA Q2 字面"react-window 8.x"为版本号语义误判；1.x 系列 1.0.0→1.8.11，"8"是 MINOR | ✅ 标注完整 |
| 2 | npm latest tag 指向 2.2.7（2.x 重写删除 FixedSizeList） | §3.2 L142 + §10.6 L363 | 2.x API 重写（FixedSizeList 已删，改用 List+rowComponent），迁移成本高 | ✅ 标注完整 |
| 3 | 1.x 最新稳定版 1.8.11（peerDeps 含 React 18/19） | §3.2 L143 + §10.6 L364 | `apps/web/package.json` L18 `react-window: ^1.8.11` 实装一致；vite build + 1263 测试证明 1.8.11 FixedSizeList API 可用 | ✅ 实装一致 |
| 4 | 1.x 非原生 TypeScript（源码 Flow 类型），须装 @types/react-window | §3.2 L144 + §10.6 L365 | `apps/web/package.json` L14 `@types/react-window: ^1.8.8` devDep 实装；typecheck exit 0 证明 TS 类型可用 | ✅ 实装一致 |
| 5 | @types/react-window 1.x 最新只到 1.8.8（非与主版本严格对齐） | §3.2 L143（"非与 react-window 主版本严格对齐，@types 最新 1.8.8 + 2.0.0 stub"）+ §10.6 | `apps/web/package.json` L14 `@types/react-window: ^1.8.8` 实装 1.8.8（非 1.8.11 严格对齐，符合 DefinitelyTyped 实际） | ✅ 实装一致 |

**替代方案预判**（§10.7）：若 impl 阶段发现 1.8.11 API 与 spec 不符（极低概率，已 S-23 核验），退回方案 A `@tanstack/react-virtual@3.14.3` / 方案 B 手写虚拟列表 / 方案 C 降低阈值。本轮未触发退回（1.8.11 FixedSizeList 可用，1263 测试全绿证明）。

**结论**：S-23 固化机制在 R22 首次触发验证生效 ✅——Tech Lead 在 spec 阶段预先核验 npm registry dist-tags + 实测安装验证 + §3.2+§10.6 反向同步标注，避免 impl 阶段才发现 API 差异（R20 vitest 1.6.1 版本核验缺口重演被规避）。5 项核验结论全部标注完整 + package.json 实装版本与 spec D2 决策一致。**S-23 在本轮首次触发验证生效，无须新增 S 级教训。**

---

## §6 git diff 抽样核验（impl-writer 自报准确性，R16 S-17）

### 6.1 git status 实跑（与任务清单逐项对比）

`git status --short` 实跑结果与任务声明的"改动文件（git status 已核验）"清单**逐项一致**（9 M + 4 ??）：

| 文件 | 任务声明 | git status 实跑 | 一致 |
|------|----------|-----------------|------|
| apps/e2e/tests/_helpers.ts | M（新增 apiGetRole） | M（+23 行） | ✅ |
| apps/e2e/tests/roles.spec.ts | M（AC-E7 强断言 L103-106） | M（+6 行） | ✅ |
| apps/web/package.json | M（react-window + @types） | M（±4 行） | ✅ |
| apps/web/src/App.tsx | M（8 页 lazy + Suspense） | M（166 行） | ✅ |
| apps/web/src/components/UserRow.tsx | M（memo 包裹） | M（+9 行） | ✅ |
| apps/web/src/pages/RoleListPage.tsx | M（FixedSizeList + useCallback + useMemo） | M（173 行） | ✅ |
| apps/web/src/pages/UserListPage.tsx | M（同上） | M（145 行） | ✅ |
| docs/spec/e2e-introduction.tech.md | M（3 处文档同步） | M（29 行） | ✅ |
| package-lock.json | M | M（+40 行，npm install 附属） | ✅ |
| apps/web/src/components/RoleRow.tsx | ??（新增 memo 行组件） | ?? | ✅ |
| apps/web/test/performance.test.tsx | ??（7 用例） | ?? | ✅ |
| docs/prd/r22-frontend-performance.md | ?? | ?? | ✅ |
| docs/spec/r22-frontend-performance.tech.md | ?? | ?? | ✅ |

### 6.2 抽样 diff 内容核验

- **_helpers.ts**：+`apiGetRole(request, token, roleId)` 函数（L100-112），返回 `{ id, name, parent_role_id, version }`，签名对齐 apiCreateRole/apiCreateUser 模式。与自报"新增 apiGetRole 函数"一致 ✅
- **roles.spec.ts**：+L103-106 `const updated = await apiGetRole(request, token, roleB.id); expect(updated.parent_role_id).toBe(roleA.id);`。与自报"AC-E7 强断言增强 L103-106"一致 ✅
- **App.tsx**：8 页 `lazy(() => import(...).then((m) => ({ default: m.XxxPage })))` + `<Suspense fallback={<div>加载中...</div>}>`。与自报"8 页 React.lazy + Suspense"一致 ✅
- **UserRow.tsx**：`import { memo } from 'react'` + `export const UserRow = memo(function UserRow(...))`。与自报"memo 包裹"一致 ✅
- **e2e-introduction.tech.md**：3 处编辑（§2.3 devDeps 描述 / §2.4+§7.2 stale Admin@123 / §7.4 新增 retries 偏离章节）。与自报"3 处文档同步"一致 ✅
- **package.json (web)**：+`react-window: ^1.8.11`（dependencies）+ `@types/react-window: ^1.8.8`（devDependencies）。与自报一致 ✅

### 6.3 隐性偏离核验

- **tsconfig.json**：git diff 为空（未改）→ R22 未触碰 tsconfig，baseUrl 弃用失败非 R22 引入 ✅
- **lockfile typescript 版本**：5.9.3 未变（diff 中无 `+` typescript 版本行）→ R22 未 bump TS ✅
- **contracts**：git status 无 packages/contracts/ 改动 → ARCH-002 保持 ✅
- **apps/api/src/**：无改动 → ARCH-001 不触发 ✅

**判定**：impl-writer 自报清单准确，无虚报/漏报/越界。**S-17 自报准确性通过 ✅。**

---

## §7 G6.5 元改进轮 Review checklist 适用性声明（R17 范式）

R22 是**业务轮**（前端性能加固 + R20 Suggestion 闭合，走五角色流程 BA→Tech Lead→test-writer→impl-writer→Reviewer + 七道门禁），**非元改进轮**。G6.5 元改进轮 Review checklist（R17 首次落地 / R19 第二次 / R21 第三次）仅适用于元改进轮（无标准 PRD→Spec 五角色流程，纯提示词/规则/Spec 模板层固化）。

**G6.5 适用性声明**：R22 业务轮 → **G6.5 不适用**，本轮走标准 G6 业务 Review（含 G1/G3/G3.5/G4/G5/G6/G6.1/G7 门禁）。R21 retro §1.3 固化的 G6.5 范式第三次落地参考在 R22 不触发（R22 非元改进轮），下一元改进轮（如有）将继续走 G6.5。

> 注：R22 反而是 S-23（R21 固化）的**首次触发验证业务轮**——S-23 提示词已落（Tech Lead §10 增项 + 版本核验约束 + BA 凭据核验延伸），R22 涉及第三方库 react-window 触发验证，§5 已核验生效。

---

## §8 综合结论

| 维度 | 结果 |
|------|------|
| verdict | **pass** |
| Blocker | 0 |
| Advisory | 1（既有/环境性 TS 配置，非 R22 引入） |
| AC 对齐 | 15/15 |
| typecheck（canonical） | exit 0 ✅ |
| lint:rules | exit 0 ✅ |
| vitest | 57 files / 1263 tests ✅ |
| E2E | 14 passed ✅ |
| advisory 反向同步 | D5 + D2 闭合 ✅ |
| S-23 首次触发验证 | 生效 ✅ |
| impl-writer 自报（S-17） | 准确 ✅ |
| G6.5 | 不适用（业务轮） |
| ARCH-002 / ARCH-003 | 保持 ✅ |

**verdict = pass**。理由：

1. **三件套全绿**：canonical `npm run typecheck` exit 0 + `lint:rules` exit 0（META-003/META-004 双向绑定闭合）+ vitest 57 files/1263 tests 全绿（R20 1256 → R22 1263，+7 性能专项测，0 回归）+ E2E 14 passed（AC-E7 强断言增强后仍通过）。
2. **15 AC 全部对齐**：AC-P1~P10 性能 10 条（React.memo 包裹 UserRow+RoleRow / useCallback 8 处 / useMemo filteredItems + itemData / react-window FixedSizeList 阈值 50 + ≤50 回退 / React.lazy 8 页 + Suspense "加载中..."）+ AC-S20-1~S20-5 R20 Suggestion 5 条（AC-E7 强断言 + 3 处文档同步 + task 声明闭合）。
3. **advisory 反向同步闭合**：D5 阈值（§7.1+§10.3）+ D2 react-window 版本（§3.2+§10.6+§7.2 S-23）均实际编辑 Tech-Spec 章节闭合（非伪同步）。
4. **S-23 首次触发验证生效**：Tech Lead spec 阶段预先核验 npm registry dist-tags + 实测安装 + §3.2+§10.6 反向同步标注，5 项核验结论完整，package.json 实装 react-window@1.8.11 + @types/react-window@1.8.8 与 spec D2 一致。R20 vitest 1.6.1 版本核验缺口重演被规避。
5. **impl-writer 自报准确（S-17）**：git status 与自报清单逐项一致，无虚报/漏报/越界；tsconfig + contracts + apps/api/src 均未越界改动。
6. **ARCH 检查通过**：ARCH-002（contracts 零变更）+ ARCH-003（apps/web 不 import apps/api/src）保持。
7. **vite build 产物确凿**：8 个 lazy chunk 独立产物（AC-P7 落地证据）。

### §8.1 唯一 Advisory 说明

`pnpm --filter @admin/web run build`（`tsc --noEmit && vite build`）的 tsc 步骤在沙箱 TS 5.9.3 下报 `baseUrl` 弃用 error TS5101。经独立核验：tsconfig.json 未被 R22 改动 + lockfile 中 typescript 版本（5.9.3）未被 R22 bump → **既有/环境性 TS 配置问题**，非 R22 引入。R22 源码本身 typecheck 干净（canonical `npm run typecheck` exit 0 + workspace tsc 从 apps/web 直接跑 exit 0），vite build 单独跑成功产出 8 个 lazy chunk。canonical typecheck gate 满足验收。详见 §3.1 + §9 Advisory #1。

---

## §9 Advisory（改进建议，非阻断）

### Advisory #1 · 既有/环境性 TS 配置：baseUrl 弃用在 TS 5.5+ 升级为 error（非 R22 引入，建议项目级修复）

**现象**：`pnpm --filter @admin/web run build`（`tsc --noEmit && vite build`）在沙箱 TS 5.9.3 下报 `tsconfig.json(3,3): error TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0`，exit 2，vite build 未执行。

**根因**：根 `tsconfig.json` L16 `"baseUrl": "."`（既有配置，apps/web/tsconfig.json 经 extends 继承）。TS 5.5+ 将 deprecated compilerOption 升级为 error TS5101（无 `ignoreDeprecations` 时）。沙箱解析 `typescript: ^5.4.0` → 5.9.3 触发。

**非 R22 引入证据**：
- `git diff HEAD -- tsconfig` 为空（tsconfig 未被 R22 改动）
- `git diff HEAD -- package-lock.json` 中 typescript 版本行无 `+` 前缀（5.9.3 未被 R22 bump）
- R22 源码本身 typecheck 干净：canonical `npm run typecheck` exit 0 + workspace tsc 二进制从 apps/web 直接跑 exit 0

**影响**：仅影响 `pnpm --filter @admin/web run build` 全脚本（tsc 步骤）；canonical typecheck gate（`npm run typecheck`）exit 0 满足验收；vite build 单独跑成功（8 lazy chunk 产物正确）。不影响 R22 任何 AC 验收。

**建议修复**（项目级，out of R22 scope，建议下一轮或项目维护时处理）：
- 方案 A（最小改动）：根 `tsconfig.json` compilerOptions 追加 `"ignoreDeprecations": "5.0"`（抑制 5.x 弃用 error）
- 方案 B（长期）：迁移 paths 为相对解析，移除 baseUrl（TS 7.0 将删除 baseUrl）
- 方案 C：固定 typescript 精确版本（如 `5.4.5`）避免解析到 5.9.3

**性质**：advisory（非阻断），R22 pass 不受影响。该问题在 R20 时期即已潜在存在（R20 retro 报"typecheck ✅ exit 0"指 canonical `npm run typecheck`，未跑 web build 全脚本），非 R22 回归。

---

## G6 自检声明

- **实跑核对完成**：`npm run typecheck` exit 0 ✅；`npm run lint:rules` exit 0 ✅；`npm test` 57 files/1263 tests ✅；`npm run test:e2e` 14 passed ✅；`npx vite build` 8 lazy chunk ✅；`git status` + `git diff --stat HEAD` 实跑 ✅；workspace tsc 从 apps/web 直接跑 exit 0 ✅。
- **PRD 15 AC 逐条核对完成**：AC-P1~P10（10 条性能）+ AC-S20-1~S20-5（5 条 R20 Suggestion 闭合）全部 ✅ 对齐，每条有证据（文件:行 + 断言 + 测试）。
- **advisory 偏离反向同步核实完成**：D5（§7.1+§10.3）+ D2（§3.2+§10.6+§7.2）均通过 Read Tech-Spec 全文 + git diff 确认章节已实际编辑（非仅代码注释，R19 S-21 固化的"伪同步检测"机制在本轮 advisory 场景复用）。
- **S-23 首次触发验证核实完成**：Tech-Spec §3.2 + §10.6 反向同步标注 5 项核验结论完整 + package.json 实装版本与 spec D2 一致 ✅。
- **ARCH/SEC 检查完成**：ARCH-002（contracts 零变更）git status 确认 ✅；ARCH-003（apps/web 不 import apps/api/src）✅；SEC-002/SEC-003a 3 条豁免均既有非本轮新增。
- **S-17 自报准确性核对完成**：impl-writer 自报清单（9 M + 4 ??）与 git status 实际逐项一致 ✅；tsconfig/contracts/apps-api-src 均未越界改动。
- **G6.5 适用性声明完成**：R22 业务轮 → G6.5 不适用（仅声明），走标准 G6 业务 Review。
- **verdict 判定**：**pass**（三件套全绿 + 15 AC 对齐 + 2 项 advisory 反向同步闭合 + S-23 首次触发验证生效 + impl-writer 自报准确 + ARCH 检查通过 + 无 Blocker；唯一 Advisory 为既有/环境性 TS 配置非 R22 引入）。
