---
doc_type: Tech-Spec
id: TECH-ACCESSIBILITY-DEEPENING-001
title: R23 可访问性深化（modal focus trap/ESC/restore + 8 页键盘导航 + jest-axe + @axe-core/playwright 双轨 axe WCAG AA 检测）
prd_ref: PRD-ACCESSIBILITY-DEEPENING-001
status: ready-for-impl
owner: tech-lead@team
created: 2026-07-04
extends: TECH-FRONTEND-PERFORMANCE-001
aligns: [TECH-WEB-AUTH-USER-001, TECH-WEB-ROLE-DEPT-AUDIT-001, TECH-WEB-NOTIFICATION-REPORT-001, TECH-WEB-TRANSFER-INHERITANCE-001, TECH-E2E-INTRODUCTION-001]
---

# TECH-ACCESSIBILITY-DEEPENING-001 · R23 可访问性深化 Tech-Spec

> 派生自 PRD-ACCESSIBILITY-DEEPENING-001（status=decided，11 条 AC：AC-A11y-1~4 modal focus trap/ESC/restore 4 条 + AC-A11y-5~6 8 页键盘导航 2 条 + AC-A11y-7~9 axe-core 自动检测 3 条 + AC-A11y-10~11 既有测试全绿 2 条；3 项 BLOCKING Q&A 已拍板：Q1=③ axe-core WCAG AA 自动检测 + 键盘导航 / Q2=① jest-axe + @axe-core/playwright 双轨 / Q3=② 全页面 8 页 + modal focus trap/ESC/restore，不含虚拟列表键盘导航）。
> 本轮承接 R22 retro §6 候选清单第 1 项——可访问性深化。三方向：①8 页键盘导航（Tab 顺序 + 焦点可见）②7-8 个 modal 形态组件统一补齐 role="dialog" + aria-modal + focus trap + ESC + focus restore ③jest-axe vitest 单测 + @axe-core/playwright E2E 双轨 axe WCAG AA 自动检测。
> **S-23 第二次触发验证**（R21 固化，R22 react-window 首次触发）：R23 引入 jest-axe + @axe-core/playwright，Tech Lead 在 spec 阶段已实际核验 npm registry dist-tags + 版本元数据 + 安装产物文件结构 + 实测安装 + typecheck exit 0。**核心核验结论**：jest-axe npm latest=10.0.0（**非 PRD §1.3/§6.2 假设的 5.x**，Tech Lead 修正）+ jest-axe **不存在 `/vitest` 子路径入口**（**PRD §2.5/§6.2 假设 `import 'jest-axe/vitest'` 错误**，Tech Lead 修正为显式 `expect.extend(toHaveNoViolations)`）+ jest-axe **jsdom 不支持 color-contrast 规则**（jest-axe 已默认禁用 color-contrast，AC-A11y-9 色彩对比核验须由 @axe-core/playwright E2E 独占覆盖）；@axe-core/playwright npm latest=4.12.1（peerDeps `playwright-core>=1.0.0` 与 @playwright/test 1.61.1 兼容）+ API `AxeBuilder` 核验确认 + 自带 TypeScript 类型。详见 §3.2/§3.3 + §10.6。
> **contracts 本轮零变更**（§6）；**errors.ts 零变更**；**errorMapping.ts 零变更**；**server.ts / domain / repository / service 零变更**；**vitest.workspace.ts 零变更**；**playwright.config.ts 零变更**。改动范围：apps/web/src/ 前端层（8 个 modal 组件 role+aria-modal+aria-label + focus trap/ESC/restore 共享 useFocusTrap hook + 全局 :focus-visible CSS）+ apps/web/test/setup.ts（jest-axe matcher 注入）+ apps/web/test/a11y.test.tsx（新增 jest-axe 组件级扫描）+ apps/e2e/tests（既有 5 spec 增 axe 扫描断言）+ apps/web/package.json（新增 jest-axe + @types/jest-axe devDep）+ package.json（根新增 @axe-core/playwright devDep）。

## 1. 覆盖范围

### 1.1 可访问性深化三方向（PRD AC-A11y-1~9）

**方向 1：modal 焦点陷阱 + ESC + restore**（AC-A11y-1~4）
- 8 个 modal 形态组件统一补齐 `role="dialog"` + `aria-modal="true"` + `aria-label`（域特定，D18 约束，不重命名既有 aria-label）
- ESC 关闭（submitting 状态下阻止 ESC 关闭，对齐既有 onClose 按钮 `disabled={submitting}`）
- focus trap（Tab/Shift+Tab 在 modal 内可聚焦元素间循环，不逃逸到背景 DOM，WCAG 2.1.2 No Keyboard Trap）
- focus restore（关闭后焦点恢复到触发按钮，非 `<body>`，WCAG 2.4.3 Focus Order）
- 改造组件清单（D4 详述）：CreateUserModal（已 role，须补 aria-modal）/ SetParentModal / RoleForm / UserRolesPanel / EffectivePermissionsPanel / InheritanceChainPanel / DeptForm / NotificationForm 共 8 个

**方向 2：8 页键盘导航**（AC-A11y-5~6）
- 8 页（LoginPage / UserListPage / RoleListPage / TransferPage / AuditLogPage / DeptTreePage / ReportPage / NotificationListPage）所有交互元素 Tab 顺序正确（无 `tabIndex > 0` 跳序，react-window 行内按钮 Tab 可达）
- 焦点可见（outline 保留，无全局 `*:focus { outline: none }` 去除；新增 `:focus-visible` 全局规则强化 WCAG 2.4.7 Focus Visible）

**方向 3：axe-core 自动 WCAG AA 检测双轨**（AC-A11y-7~9）
- jest-axe vitest 单测（组件级 axe 扫描，jsdom 环境，覆盖 aria/region/taborder 等 jsdom 可检测规则）
- @axe-core/playwright E2E（页面级 axe 扫描，真实 chromium 浏览器，覆盖 color-contrast + 渲染时 violation）
- 双轨分工（S-23 核验关键发现，§3.10/D10 详述）：jest-axe 不支持 color-contrast（jsdom 无 layout/paint），color-contrast 规则由 @axe-core/playwright E2E 独占覆盖

### 1.2 R22 性能加固成果协同（不破坏）

R22 已建立的性能加固成果在 R23 协同（非冲突）：
- **react-window 虚拟列表**（R22 D2 / AC-P4/P5）：UserListPage / RoleListPage 行数 > 50 启用 FixedSizeList。R23 不破坏 react-window 行渲染，仅确保行内按钮（UserRow"禁用/角色/权限" + RoleRow"删除/设置父角色/解除父角色/查看继承链"）Tab 可达 + 焦点可见。虚拟列表键盘导航（方向键滚动 + 焦点记忆）留 R24+ future（PRD §5 声明，Q3 推荐②）。
- **React.lazy 8 页**（R22 D6 / AC-P7）：App.tsx 8 页 lazy + Suspense fallback"加载中..."。R23 不破坏 lazy 行为；Suspense fallback 的焦点管理留 impl 阶段判断（懒加载完成后的焦点恢复非强制，fallback 是 `<div>加载中...</div>` 无可聚焦元素）。
- **React.memo + useCallback + useMemo**（R22 D1/D3/D4）：UserRow / RoleRow memo 包裹。R23 引入 useFocusTrap hook 时须保持 memo 行为（hook 内 useCallback 稳定引用，参照 R22 D3 模式，避免 modal state 变化触发列表行 re-render）。

### 1.3 不改 contracts / errors / server / vitest.workspace / playwright.config（零联动）

本轮 **contracts 零变更**（§6）、**errors.ts 零变更**、**errorMapping.ts 零变更**、**server.ts / router / service / repository / domain 零变更**、**vitest.workspace.ts 零变更**（jest-axe matcher 经既有 web project setup.ts 注入，无须新增 project）、**playwright.config.ts 零变更**（@axe-core/playwright 经测试文件内 `import { AxeBuilder }` 使用，无须 config 改动）。所有改动在前端层（apps/web/src/）+ 测试层（apps/web/test + apps/e2e/tests）+ 依赖（apps/web/package.json + 根 package.json）。ARCH-002（contracts 纯净层）保持，ARCH-001（四层反向依赖）不触发，ARCH-003（apps/web 不 import apps/api/src + apps/e2e 通过 HTTP 交互）保持。

## 2. 既有可访问性现状核验（关键资产盘点）

> R10 S-2 教训：Spec 须核验既有现状。本节核验 8 项关键资产，确认改动边界。

### 2.1 modal 形态组件现状盘点（grep + Read 核验）

apps/web/src/components 全量 grep `onClose`（file:///workspace/mvp/apps/web/src/components）匹配 9 个文件，剔除 `DeptNode.tsx`（树节点非 modal，含 onClose 是关闭子树编辑）后 **8 个 modal 形态组件**（含 `onClose: () => void` props + 父组件通过 `{showXxx && <XxxModal .../>}` 条件渲染挂载）：

| # | 组件 | 根元素 | role="dialog" | aria-modal | aria-label | ESC | focus trap | focus restore | 文件位置 |
|---|------|--------|---------------|-----------|-----------|-----|-----------|----------------|----------|
| 1 | CreateUserModal | `<div>` | ✅（唯一） | ❌ 缺 | ✅"创建用户" | ❌ | ❌ | ❌ | file:///workspace/mvp/apps/web/src/components/CreateUserModal.tsx:103 |
| 2 | SetParentModal | `<form>` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | file:///workspace/mvp/apps/web/src/components/SetParentModal.tsx:124 |
| 3 | RoleForm | `<form>` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | file:///workspace/mvp/apps/web/src/components/RoleForm.tsx:90 |
| 4 | UserRolesPanel | `<div>` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | file:///workspace/mvp/apps/web/src/components/UserRolesPanel.tsx:89 |
| 5 | EffectivePermissionsPanel | `<div>` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | file:///workspace/mvp/apps/web/src/components/EffectivePermissionsPanel.tsx:92 |
| 6 | InheritanceChainPanel | `<div>` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | file:///workspace/mvp/apps/web/src/components/InheritanceChainPanel.tsx:64 |
| 7 | DeptForm | `<form>` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | file:///workspace/mvp/apps/web/src/components/DeptForm.tsx:83 |
| 8 | NotificationForm | `<form>` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | file:///workspace/mvp/apps/web/src/components/NotificationForm.tsx:134 |

> **TransferForm 排除**（file:///workspace/mvp/apps/web/src/components/TransferForm.tsx:146）：props 无 `onClose`（仅 `onSubmitted?`），根元素 `<form>` 内嵌 TransferPage 非条件渲染弹窗，属 inline form 非 modal 形态。PRD §2.2 列 TransferForm 为 modal 候选由 impl 阶段核验，Tech Lead 核验结论：**TransferForm 非 modal，R23 不改造其 role/aria-modal**（但其 Tab 顺序 + 焦点可见仍属 AC-A11y-5/6 范围）。
>
> **既有 aria-label 域特定命名不破坏**（D18/R16/R21 约束）：CreateUserModal aria-label="创建用户"（既有，保留）；SetParentModal select aria-label="父角色"（既有，保留）；RoleForm aria-label="名称/描述/权限"（既有，保留）；EffectivePermissionsPanel/InheritanceChainPanel 注释声明 D18 aria-label="有效权限"/"继承链"（file:///workspace/mvp/apps/web/src/components/EffectivePermissionsPanel.tsx:15 + file:///workspace/mvp/apps/web/src/components/InheritanceChainPanel.tsx:14），**实际组件根元素未落 aria-label**（注释与实现不符，R23 impl 须落 role="dialog" + aria-modal 时同步落 aria-label 域特定命名）。

### 2.2 role= / aria-modal / 键盘事件现状盘点

apps/web/src 全量 grep（PRD §2.2/§2.3 已核验，Tech Lead 复核确认）：
- `role=` 19 处匹配：14 处 `role="alert"`（ErrorBanner / DeptForm / RoleForm / UserRolesPanel / TransferForm / ReportFilter / InheritanceChainPanel / SetParentModal / NotificationForm / EffectivePermissionsPanel 错误提示）+ 1 处 `role="dialog"`（CreateUserModal.tsx:103 唯一）+ 4 处变量名 role=（非语义 role）。
- `tabIndex|onKeyDown|onKeyPress` **零匹配**（file:///workspace/mvp/apps/web/src/ 全量 grep 确认）—— R23 键盘可访问性最大缺口：零 ESC 关闭 + 零 focus trap + 零 focus restore + 零 tabindex 管理。
- `aria-modal` **零匹配**（CreateUserModal 有 role="dialog" 但无 aria-modal="true"，screen reader 仍可能不识别为模态）。

### 2.3 CSS / outline / 色彩现状盘点（Tech Lead 实际核验）

Tech Lead 实际核验（PRD §2.7 推断"零 CSS"由 Tech Lead 复核确认）：
- `apps/web/src/**/*.css` 全量 Glob → **零 CSS 文件**（file:///workspace/mvp/apps/web/src/ 无任何 .css 文件）。
- apps/web/src 全量 grep `outline|focus|:focus` → **零匹配**（无 `*:focus { outline: none }` 全局去除，浏览器默认 `:focus` outline 保留，AC-A11y-6 焦点可见基线天然满足）。
- apps/web/src 全量 grep `color:|background:|#[0-9a-f]{3,6}` → **零匹配**（无自定义色彩，使用浏览器默认黑底白字，对比度天然满足 WCAG AA 1.4.3）。

**结论**：既有零 CSS → AC-A11y-6（焦点可见）+ AC-A11y-9（色彩对比）基线天然满足，R23 须新增 `:focus-visible` 全局规则强化（D7）+ axe 扫描验证零违规（AC-A11y-7/8/9）。impl 阶段须核验 main.tsx 入口是否 import CSS（若无须新增 apps/web/src/index.css + main.tsx import；若已 import 既有 CSS 则追加 :focus-visible 规则）。

### 2.4 vitest 测试环境现状（setup.ts + workspace）

apps/web/test/setup.ts（file:///workspace/mvp/apps/web/test/setup.ts）当前仅一行：
```ts
import '@testing-library/jest-dom/vitest';
```

vitest.workspace.ts（file:///workspace/mvp/vitest.workspace.ts）3 个 project：api（node）/ web（jsdom + setupFiles=jest-dom）/ contracts（node 预留）。web project setupFiles 指向 `apps/web/test/setup.ts`，R23 在该 setup.ts 增 jest-axe matcher 注入（D8），对所有 web .tsx 测试生效（project 隔离的 module graph，参照 R20 S-5 模式）。

既有 web 测试规模 57 files / 1263 tests（PRD §2.5 声明），R23 在 web project 新增 jest-axe 测试（AC-A11y-7），既有 1263 测试不可回归（AC-A11y-10）。testTimeout=20000（R15 S-15 固化）。

### 2.5 E2E 基础设施现状

playwright.config.ts 位置根目录（file:///workspace/mvp/playwright.config.ts，D1 决策非 apps/e2e/）。配置：chromium 单 project / headless / retries=0 / workers=1 / webServer 双进程（api server 3000 + vite dev 5173）/ baseURL `http://localhost:5173` / actionTimeout=10s / navigationTimeout=15s。测试文件 5 个 spec（login / logout / users / roles / transfer）共 14 E2E 用例（PRD §2.4 声明）。

既有断言模式：全部经 `page.getByLabel(...)` / `page.getByRole('button', { name: ... })` 定位（依赖既有 aria-label 域特定命名 + 按钮文本 accessible name）。零可访问性断言（grep `keyboard|press|tab\(|focus|aria|accessibility|axe` 仅 4 处注释无实际断言）。

@playwright/test 已在根 devDependencies `^1.61.1`（file:///workspace/mvp/package.json:21），R23 新增 @axe-core/playwright devDep 与之同位（D3）。tsconfig.json `include` 含 `apps/e2e`（file:///workspace/mvp/tsconfig.json:22），@axe-core/playwright 自带 types（./dist/index.d.ts）在 apps/e2e 可解析。

### 2.6 依赖现状（apps/web/package.json + 根 package.json）

apps/web/package.json（file:///workspace/mvp/apps/web/package.json）dependencies：`@admin/contracts` / `@types/react-window ^1.8.8` / `react ^18.3.0` / `react-dom ^18.3.0` / `react-router-dom ^6.26.0` / `react-window ^1.8.11`（R22 已落）。devDependencies：`@testing-library/*` / `@types/react` / `@types/react-dom` / `@vitejs/plugin-react` / `jsdom` / `typescript` / `vite` / `vitest ^1.6.0`。**零 axe 相关依赖**（无 axe-core / jest-axe / @axe-core/playwright），R23 新增（S-23 第二次触发）。

根 package.json（file:///workspace/mvp/package.json）devDependencies：`@playwright/test ^1.61.1` / `@types/node` / `tsx` / `typescript` / `vitest ^1.6.0`。R23 在根 devDependencies 新增 `@axe-core/playwright`（与 @playwright/test 同位，因 E2E 测试在 apps/e2e 经根 node_modules 解析）。

## 3. D1-D10 决策（含 S-23 第二次触发核验结论）

> 每节显式标注 `[约束]`（默认禁止偏离，偏离须经 AI-003 流程 + Reviewer 确认）或 `[advisory]`（允许偏离，须反向同步 §7）。D2/D3 含 S-23 第二次触发核验结论（§10.6 反向同步）。

### 3.1 `[约束]` D1：modal focus trap 实现方式——自定义 useFocusTrap hook

**选项**：
- A. 自定义 `useFocusTrap` hook（apps/web/src/hooks/useFocusTrap.ts，~30 行：可聚焦元素查询 + Tab/Shift+Tab 循环 + ESC 关闭 + focus restore）
- B. 第三方库 `react-focus-lock`（成熟，但引入第三个 S-23 触发核验场景，与 R23 S-23 第二次触发同轮叠加过重）

**选择：A 自定义 useFocusTrap hook**。

**理由**：
1. 8 个 modal 形态组件 ≥ R16 S-19 阈值（≤3 重复定义，≥4 提取共享），须提取共享 hook（非每 modal 重复定义）。
2. 自定义 hook 实现简单（querySelectorAll 可聚焦元素选择器 + keydown Tab/Shift+Tab 焦点循环 + ESC 触发 onClose + useRef 记录触发按钮 focus restore），~30 行单文件，无第三方依赖。
3. 引入 react-focus-lock（选项 B）将触发 S-23 第三次核验（react-focus-lock 版本 + 与 React 18.3 兼容性 + API），与 R23 S-23 第二次触发（jest-axe + @axe-core/playwright）同轮叠加，超出 Tech Lead 单轮核验合理范围；且 react-focus-lock 不内置 focus restore（须自定义），不内置 submitting 时禁用 ESC（须自定义），收益有限。
4. 与 R22 React.memo 协同（R22 D1）：hook 内 `useCallback` 稳定引用（参照 R22 D3 模式），避免 modal state 变化触发列表行 re-render。
5. 与 react-window 协同（R22 D2）：modal 打开时 focus trap 限制在 modal 内，背景 react-window FixedSizeList 行不可 Tab 到达（trap 范围正确），无须额外处理 react-window 行 tabindex。

### 3.2 `[约束]` D2：jest-axe 版本 + 安装位置（S-23 第二次触发核验）

> **[R23 §10.6 S-23 第二次触发验证生效]**：BA PRD §1.3/§6.2 字面假设"jest-axe 5.x"，Tech Lead 实际核验 npm registry dist-tags 发现：
> - **jest-axe npm latest = 10.0.0**（2025-03-04 发布，**非 PRD 假设的 5.x**，Tech Lead 修正）。jest-axe 版本号演进：1.x → 2.x → ... → 5.x → 6.x → 7.x → 8.x → 9.x → 10.x（latest=10.0.0）。
> - **jest-axe 无 peerDependencies**（package.json 无 peerDeps 字段，loose 约束），与 vitest 1.6.1 兼容（无须 jest peer，jest-matcher-utils 29.2.2 是 jest 内部工具但 vitest 提供兼容 expect.extend API）。
> - **jest-axe 不存在 `/vitest` 子路径入口**——package.json `files` 字段仅 `['index.js', 'extend-expect.js']`，无 `vitest` 子路径。**PRD §2.5/§6.2 假设 `import 'jest-axe/vitest'` 错误**（参照 R20 S-5 jest-dom `/vitest` 子路径模式假设 jest-axe 同形，但 jest-axe 未提供）。Tech Lead 修正为显式 `import { axe, toHaveNoViolations } from 'jest-axe'; expect.extend(toHaveNoViolations);`（D8 详述）。
> - **jest-axe jsdom 不支持 color-contrast 规则**——jest-axe README 明示"Color contrast checks do not work in JSDOM so are turned off in jest-axe"。**AC-A11y-9 色彩对比核验须由 @axe-core/playwright E2E 独占覆盖**（D10 详述），jest-axe 覆盖 aria-required-attr / aria-roles / region / taborder 等 jsdom 可检测规则。
> - **jest-axe 10.0.0 不自带 TypeScript 类型**（package.json 无 `types` 字段），须装社区 `@types/jest-axe`（latest=3.5.9，deps `axe-core ^3.5.5` 版本略滞后但 tsconfig `skipLibCheck: true` 兼容，[advisory] 版本略滞后）。
> - **实测安装验证**：`npm --workspace @admin/web install --save-dev jest-axe@10.0.0` 安装成功（58 packages added）+ `npm run typecheck` exit 0（TS 类型可用，jest-axe 10.0.0 经 @types/jest-axe 3.5.9 类型解析，skipLibCheck 兼容版本略滞后）。S-23 第二次触发核验闭环。

**选择：jest-axe@10.0.0 + @types/jest-axe@3.5.9 安装在 apps/web devDependencies**。

**理由**：
1. jest-axe 仅在 vitest web project（jsdom 环境）使用，安装到 apps/web/package.json devDependencies 与既有 `@testing-library/*` / `jsdom` / `vitest` 同位（ARCH-003 保持：apps/web 不引入 apps/api 依赖）。
2. @types/jest-axe 装到 apps/web devDependencies（tsconfig `include` 含 `apps/web/test`，types 在 web test 解析）。
3. [advisory] @types/jest-axe 3.5.9 deps 声明 `axe-core ^3.5.5`（jest-axe 10.0.0 实际 deps `axe-core 4.10.2`），版本略滞后但 jest-axe 公共 API（`axe` 函数 + `toHaveNoViolations` matcher）签名跨版本稳定，skipLibCheck=true 不阻断编译，impl 阶段若发现类型不符可加局部 `as` 断言或本地 .d.ts 声明（[advisory] 范围）。

### 3.3 `[约束]` D3：@axe-core/playwright 版本 + 安装位置（S-23 第二次触发核验）

> **[R23 §10.6 S-23 第二次触发验证生效]**：BA PRD §1.3/§6.2 字面假设"@axe-core/playwright 4.x"，Tech Lead 实际核验 npm registry dist-tags 发现：
> - **@axe-core/playwright npm latest = 4.12.1**（与 PRD 假设 4.x 一致，Tech Lead 确认）。版本号策略：major.minor 对齐 axe-core（4.12.x 对应 axe-core 4.12.x），patch 版本含 bug fix + 新 API 特性（无 breaking change）。
> - **peerDependencies = `{ 'playwright-core': '>= 1.0.0' }`**（loose，与 @playwright/test 1.61.1 兼容，1.61 ≥ 1.0.0）。
> - **dependencies = `{ 'axe-core': '~4.12.1' }`**（自带 axe-core 4.12.1，不与 jest-axe 的 axe-core 4.10.2 冲突——分别在不同 node_modules 层级 + 不同测试运行时，vitest web project 用 jest-axe 的 axe-core 4.10.2，E2E 用 @axe-core/playwright 的 axe-core 4.12.1）。
> - **API 核验确认**（Read dist/index.d.ts）：`AxeBuilder` 类，constructor `{ page, axeSource? }`，方法 `analyze(): Promise<AxeResults>` + `withTags(tags: string|string[]): this` + `withRules(rules)` + `disableRules(rules)` + `include(selector)` + `exclude(selector)` + `options(options)` + `setLegacyMode(legacyMode?)`。链式 API，与 Playwright Page 集成。
> - **自带 TypeScript 类型**（package.json `types: './dist/index.d.ts'`，exports.types 指向），无须 @types/@axe-core/playwright。
> - **实测安装验证**：`npm install --save-dev @axe-core/playwright@4.12.1` 安装成功（28 packages added）+ `npm run typecheck` exit 0（TS 类型可用，AxeBuilder 类型在 apps/e2e 可解析，tsconfig include 含 apps/e2e）。S-23 第二次触发核验闭环。

**选择：@axe-core/playwright@4.12.1 安装在根 devDependencies**。

**理由**：
1. @axe-core/playwright 仅在 E2E 测试（apps/e2e/tests）使用，E2E 测试经根 node_modules 解析（playwright.config.ts 在根目录，`@playwright/test ^1.61.1` 已在根 devDependencies），@axe-core/playwright 与之同位安装到根 package.json devDependencies。
2. 不装到 apps/e2e/package.json（apps/e2e 无独立 package.json，E2E 依赖统一在根 package.json devDependencies，与 R20 D2 webServer 双进程模式一致）。
3. 自带 types，无须额外 @types 包。

### 3.4 `[约束]` D4：modal role="dialog" + aria-modal + aria-label 改造范围

**选择：8 个 modal 形态组件统一改造**（§2.1 盘点清单），TransferForm 排除（非 modal）。

**改造细则**（每组件根元素加 `role="dialog"` + `aria-modal="true"` + `aria-label` 域特定命名）：

| # | 组件 | 改造前根元素 | 改造后根元素 | aria-label 域特定命名（D18 约束 + 跨组件唯一 D21/R15 S-14） |
|---|------|--------------|--------------|-----------------------------------------------------------|
| 1 | CreateUserModal | `<div role="dialog" aria-label="创建用户">` | `<div role="dialog" aria-modal="true" aria-label="创建用户">` | "创建用户"（既有保留） |
| 2 | SetParentModal | `<form>` | `<form role="dialog" aria-modal="true" aria-label="继承设置">` | "继承设置"（对齐既有 `<h2>继承设置</h2>` 文案 file:///workspace/mvp/apps/web/src/components/SetParentModal.tsx:125 + 消歧于 select aria-label="父角色"） |
| 3 | RoleForm | `<form>` | `<form role="dialog" aria-modal="true" aria-label="创建角色">` | "创建角色"（对齐既有 `<h2>创建角色</h2>` 文案 file:///workspace/mvp/apps/web/src/components/RoleForm.tsx:91） |
| 4 | UserRolesPanel | `<div>` | `<div role="dialog" aria-modal="true" aria-label="用户角色分配">` | "用户角色分配"（对齐既有 `<h2>用户角色分配</h2>` 文案 file:///workspace/mvp/apps/web/src/components/UserRolesPanel.tsx:90 + 消歧于 UserListPage"角色"按钮） |
| 5 | EffectivePermissionsPanel | `<div>` | `<div role="dialog" aria-modal="true" aria-label="有效权限">` | "有效权限"（D18 既有约束 file:///workspace/mvp/apps/web/src/components/EffectivePermissionsPanel.tsx:15，注释已声明实际未落，R23 落地） |
| 6 | InheritanceChainPanel | `<div>` | `<div role="dialog" aria-modal="true" aria-label="继承链">` | "继承链"（D18 既有约束 file:///workspace/mvp/apps/web/src/components/InheritanceChainPanel.tsx:14，注释已声明实际未落，R23 落地） |
| 7 | DeptForm | `<form>` | `<form role="dialog" aria-modal="true" aria-label="创建部门">` | "创建部门"（对齐既有 `<h2>创建部门</h2>` 文案 file:///workspace/mvp/apps/web/src/components/DeptForm.tsx:84） |
| 8 | NotificationForm | `<form>` | `<form role="dialog" aria-modal="true" aria-label={isEdit ? '编辑通知' : '创建通知'}>` | "创建通知"/"编辑通知"（对齐既有 `<h2>{isEdit ? '编辑通知' : '创建通知'}</h2>` 动态文案 file:///workspace/mvp/apps/web/src/components/NotificationForm.tsx:135） |

**关键约束**：
- `[约束]` aria-label 须沿用 D18/R16/R21 域特定命名模式 + R15 S-14 跨组件唯一约束（不与既有 55 处 aria-label 冲突，§2.1 核验：新增 modal aria-label 与既有 select/input aria-label 消歧，如 SetParentModal modal aria-label="继承设置" vs select aria-label="父角色" 不冲突）。
- `[约束]` 不重命名既有 aria-label（D18/R16/R21 约束 55 处保持，PRD §5 声明）。
- `[约束]` EffectivePermissionsPanel / InheritanceChainPanel 的 `onClose` 是 optional（`onClose?: () => void`），impl 须核验父组件是否传 onClose（UserListPage 行操作"有效权限"按钮 / RoleListPage 行操作"查看继承链"按钮触发时传 onClose）。focus trap/ESC/restore 仅在 onClose 存在时启用（hook 内 `if (!onClose) return`）。

### 3.5 `[约束]` D5：ESC 关闭实现——onKeyDown 监听（useFocusTrap hook 内统一）

**选择：在 useFocusTrap hook 内统一 onKeyDown 监听 ESC 触发 onClose**（非第三方库内置）。

**理由**：
1. 与 D1 一致（自定义 hook），ESC 监听与 focus trap 同属键盘事件处理，统一在 hook 内避免每 modal 重复。
2. submitting 状态下阻止 ESC 关闭（对齐既有 onClose 按钮 `disabled={submitting}` 行为，AC-A11y-2）：hook 内 `if (e.key === 'Escape' && !submitting) onClose()`。
3. ESC 监听须绑在 modal 根元素（非 document）——避免背景 DOM 的 ESC 误触发（modal 内 keydown 冒泡到根元素时处理）。

### 3.6 `[约束]` D6：focus restore 实现——useRef 记录触发按钮

**选择：useRef 记录 `document.activeElement`（modal 打开时的触发按钮）+ modal 关闭时 focus 回触发按钮**。

**实现要点**（useFocusTrap hook 内）：
- hook 挂载时（useEffect mount）记录 `const triggerRef = useRef(document.activeElement)`（触发按钮，modal 打开前的焦点元素）。
- modal 关闭时（onClose 调用前 / useEffect cleanup）`triggerRef.current?.focus()`（焦点恢复到触发按钮，WCAG 2.4.3 Focus Order）。
- 若 `triggerRef.current` 为 null（极少数场景，如程序化打开 modal 无触发按钮），回退到 `document.body.focus()`（非空指针，避免 focus 丢失到 `<html>`）。

**理由**：
1. WCAG 2.4.3 Focus Order 强制要求（键盘用户保持上下文）。
2. 简单实现（~5 行），无须第三方库。
3. 与 D5 ESC 关闭协同：ESC / onClose 按钮 / 提交成功三种关闭路径都经 onClose 回调，hook 在 onClose 触发后统一 focus restore。

### 3.7 `[约束]` D7：Tab 顺序 + 焦点可见 CSS——全局 :focus-visible

**选择：新增全局 `:focus-visible` CSS 规则（强化焦点可见，WCAG 2.4.7 Focus Visible）+ 不引入 tabindex 管理（核验无 tabindex>0 跳序）**。

**实现要点**：
- impl 阶段核验 main.tsx 入口是否 import CSS（Tech Lead 核验 apps/web/src 无任何 .css 文件，§2.3）。若 main.tsx 未 import CSS，新增 `apps/web/src/index.css` + main.tsx `import './index.css'`；若已 import 既有 CSS 文件（impl 阶段核验），追加规则到既有文件。
- `:focus-visible` 规则内容（强化焦点指示器，对比度 ≥ 3:1 满足 WCAG 2.4.7）：
  ```css
  :focus-visible {
    outline: 2px solid #2563eb; /* 蓝色焦点指示器，对比度 ≥ 3:1 */
    outline-offset: 2px;
  }
  ```
- 不引入 `tabindex` 管理：核验既有零 `tabIndex` 使用（§2.2 grep 确认），8 页所有交互元素（按钮/select/input/链接）天然 DOM 顺序 Tab，无 `tabIndex > 0` 跳序（AC-A11y-5）。react-window 行内按钮 Tab 可达（行在 DOM 内即可 Tab，非可视区行 react-window 不渲染 → Tab 不可达，符合预期，§8.1 风险预判）。

**理由**：
1. 既有零 CSS + 零 `*:focus { outline: none }` 去除 → 浏览器默认 `:focus` outline 保留，AC-A11y-6 基线天然满足（§2.3 核验）。
2. `:focus-visible` 比 `:focus` 更精确（鼠标点击不显示 outline 仅键盘 Tab 显示，UX 更好，现代浏览器支持），强化 WCAG 2.4.7 Focus Visible。
3. 项目未用 Tailwind（apps/web/package.json 无 tailwind 依赖），全局 CSS 是最简实现。
4. [advisory] 焦点指示器颜色 `#2563eb`（蓝色）属实现细节，impl 阶段可调整（须满足对比度 ≥ 3:1，axe color-contrast 规则自动核验）。

### 3.8 `[约束]` D8：jest-axe vitest 集成方式——setup.ts 全局注入（显式 expect.extend）

**选择：apps/web/test/setup.ts 显式注入 `expect.extend(toHaveNoViolations)` + 导出 `axe` 供测试用**。

**实现**（setup.ts 改造）：
```ts
// apps/web/test/setup.ts（R23 改造）
import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import { toHaveNoViolations } from 'jest-axe';

// R23 D8：jest-axe matcher 注入（显式 expect.extend，绑定到 vitest expect 实例）
// [R23 §10.6 S-23 反向同步]：jest-axe 无 /vitest 子路径入口（PRD §2.5 假设错误），
// 须显式 import { expect } from 'vitest' + expect.extend（参照 R20 S-5 jest-dom/vitest 模式适配）。
expect.extend(toHaveNoViolations);
```

测试文件用法（apps/web/test/a11y.test.tsx，新增）：
```ts
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { CreateUserModal } from '../src/components/CreateUserModal.js';

it('CreateUserModal 应无 WCAG 违规', async () => {
  const { container } = render(<CreateUserModal onClose={() => {}} onCreated={() => {}} />);
  expect(await axe(container)).toHaveNoViolations();
});
```

**理由**：
1. S-23 核验关键发现：jest-axe **无 `/vitest` 子路径入口**（PRD §2.5/§6.2 假设 `import 'jest-axe/vitest'` 错误），须显式 `import { expect } from 'vitest'; expect.extend(toHaveNoViolations)`（参照 R20 S-5 jest-dom `/vitest` 子路径模式，但 jest-axe 未提供该子路径，Tech Lead 修正）。
2. setup.ts 全局注入一次（web project setupFiles 指向），所有 web .tsx 测试可用 `toHaveNoViolations` matcher（project 隔离的 module graph，不污染 api / contracts project，参照 R20 S-5）。
3. `expect.extend` 在 vitest globals=true + 显式 `import { expect } from 'vitest'` 下绑定到 vitest expect 实例（R20 S-5 jest-dom 同模式，project 模式下 matcher 正确注册）。
4. 不用 `extend-expect.js` 子路径（`import 'jest-axe/extend-expect'` 自动 extend 全局 expect，但隐式 + 依赖全局 expect 在 setup 上下文可见，显式 `expect.extend` 更清晰 + 与既有 jest-dom 注入风格一致）。

### 3.9 `[约束]` D9：@axe-core/playwright E2E 集成方式——每 test 显式 analyze + withTags

**选择：每个关键流 test 内显式 `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()` + 断言 `violations.length === 0`**（非全局 afterEach）。

**实现**（apps/e2e/tests/*.spec.ts 增 axe 扫描断言，例）：
```ts
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('用户列表页应无 WCAG 2.1 AA 违规', async ({ page }) => {
  await loginAsAdmin(page);
  await page.waitForURL('**/users');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
```

**理由**：
1. 每页交互不同（login 页 vs users 列表页 vs transfer 表单页），全局 afterEach 无法定制 include/exclude（如 transfer 页须 exclude 动态加载的 select options 而非整页扫描）。
2. 显式断言可读性好（每 test 明确标注"该页 WCAG AA 零违规"），便于 Reviewer 核对 AC-A11y-8 逐条覆盖。
3. `withTags(['wcag2a', 'wcag2aa'])` 限定 WCAG 2.1 Level A/AA 规则集（覆盖 AC-A11y-9 色彩对比 color-contrast 规则，jest-axe jsdom 不支持 color-contrast 由 @axe-core/playwright 真实浏览器独占覆盖，D10）。
4. 不用全局 afterEach（`test.afterEach` 内 analyze）——afterEach 须处理 login/setup 状态，且 axe 扫描失败时无法定位是哪页违规（断言粒度过粗）。
5. 新增独立 axe spec 文件（apps/e2e/tests/a11y.spec.ts）+ 既有 5 spec 不破坏（既有 14 E2E 仅增 axe 扫描断言可选，避免破坏既有断言 AC-A11y-11）。impl 阶段建议：新增独立 a11y.spec.ts（8 页 axe 扫描，~8 test），既有 5 spec 不改（保持 14 E2E 既有断言零回归）。

### 3.10 `[约束]` D10：WCAG AA 色彩对比核验方式——@axe-core/playwright 独占（jest-axe 不支持）

**选择：@axe-core/playwright color-contrast 规则自动检测（E2E 真实 chromium 浏览器独占覆盖 AC-A11y-9）+ 既有零 CSS 天然满足 AA**。

**双轨分工**（S-23 核验关键发现）：

| 检测维度 | jest-axe（vitest jsdom） | @axe-core/playwright（E2E chromium） |
|----------|--------------------------|--------------------------------------|
| color-contrast（WCAG 1.4.3/1.4.11） | ❌ **不支持**（jsdom 无 layout/paint，jest-axe 默认禁用 color-contrast 规则） | ✅ 真实浏览器渲染，支持 color-contrast |
| aria-required-attr / aria-roles | ✅ jsdom 可检测 | ✅ |
| region / taborder / landmarks | ✅ jsdom 可检测（部分） | ✅ |
| 渲染时 violation（CSS 计算 / 动态 ARIA） | ❌ jsdom 无渲染 | ✅ |
| 反馈速度 | ✅ 快（vitest 单测阶段，秒级） | ❌ 慢（E2E 阶段，分钟级） |

**理由**：
1. S-23 核验关键发现（§3.2 D2）：jest-axe README 明示"Color contrast checks do not work in JSDOM so are turned off in jest-axe"。jest-axe 覆盖 aria/region/taborder 等 jsdom 可检测规则（AC-A11y-7），color-contrast 须由 @axe-core/playwright E2E 独占覆盖（AC-A11y-8/9）。
2. 既有零 CSS（§2.3 核验）→ 浏览器默认黑底白字对比度天然满足 WCAG AA 1.4.3（正常文本 ≥ 4.5:1）+ 1.4.11（非文本 UI 组件 ≥ 3:1）+ 2.4.7（焦点指示器 ≥ 3:1，D7 :focus-visible #2563eb 蓝色满足）。
3. AC-A11y-9 WCAG AA 色彩对比核验 = @axe-core/playwright color-contrast 规则自动检测（withTags wcag2aa 含 color-contrast）+ 既有零 CSS 零违规风险。

## 4. 实现细节（每 AC 对应实现位置 + 代码骨架）

> 本节为设计 + 实现提示，不写完整实现代码（impl-writer 职责）。每 AC 标注实现位置 + 关键约束。

### 4.1 AC-A11y-1：modal role="dialog" + aria-modal + aria-label 补齐

**实现位置**：8 个 modal 形态组件根元素（§3.4 D4 改造清单）。
**关键约束**：
- `[约束]` aria-label 域特定命名（D18）+ 跨组件唯一（R15 S-14），§3.4 清单已定。
- `[约束]` 不重命名既有 aria-label（55 处保持）。
- `[约束]` EffectivePermissionsPanel / InheritanceChainPanel 的 onClose optional，role/aria-modal/aria-label 仍落（focus trap/ESC 仅 onClose 存在时启用）。

### 4.2 AC-A11y-2：modal ESC 关闭

**实现位置**：apps/web/src/hooks/useFocusTrap.ts（新增，D1/D5）。
**代码骨架**：
```ts
// useFocusTrap.ts（新增，~30 行）
import { useEffect, useRef } from 'react';

export function useFocusTrap(
  rootRef: React.RefObject<HTMLElement>,
  onClose: (() => void) | undefined,
  enabled: boolean,
  submitting: boolean,
): void {
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled || !onClose) return;
    triggerRef.current = document.activeElement as HTMLElement;
    const root = rootRef.current;
    if (!root) return;

    // 首个可聚焦元素 focus
    const focusables = getFocusables(root);
    focusables[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Tab/Shift+Tab 循环
      const current = getFocusables(root);
      if (current.length === 0) return;
      const first = current[0]!;
      const last = current[current.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    root.addEventListener('keydown', handleKeyDown);
    return () => {
      root.removeEventListener('keydown', handleKeyDown);
      // focus restore（D6）
      (triggerRef.current ?? document.body).focus();
    };
  }, [enabled, onClose, submitting, rootRef]);
}

function getFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null); // 排除隐藏元素
}
```

**关键约束**：
- `[约束]` submitting 状态下 ESC 不关闭（对齐既有 onClose 按钮 `disabled={submitting}`，AC-A11y-2）。
- `[约束]` ESC 监听绑 modal 根元素（非 document），避免背景 DOM ESC 误触发。

### 4.3 AC-A11y-3：modal focus trap

**实现位置**：useFocusTrap hook（§4.2 handleKeyDown Tab/Shift+Tab 循环逻辑）。
**关键约束**：
- `[约束]` Tab 在末元素 → 回到首元素；Shift+Tab 在首元素 → 回到末元素（WCAG 2.1.2 No Keyboard Trap）。
- `[约束]` 可聚焦元素选择器须覆盖 a[href] / button / input / select / textarea / [tabindex]（非 -1）+ 排除 disabled + 排除隐藏（offsetParent === null）。
- `[约束]` 与 react-window 协同（R22 D2）：modal 打开时背景 FixedSizeList 行不可 Tab 到达（focus trap 限制在 modal 内，hook 内 root.addEventListener 限定 trap 范围）。

### 4.4 AC-A11y-4：modal focus restore

**实现位置**：useFocusTrap hook（§4.2 useEffect cleanup `triggerRef.current?.focus()`）。
**关键约束**：
- `[约束]` 记录触发按钮 `document.activeElement`（modal 打开时，useEffect mount 阶段）。
- `[约束]` 三种关闭路径（ESC / onClose 按钮 / 提交成功）都经 onClose 回调，hook cleanup 统一 focus restore。
- `[约束]` triggerRef 为 null 时回退 `document.body.focus()`（非空指针）。

### 4.5 AC-A11y-5：8 页 Tab 顺序正确

**实现位置**：8 页组件（LoginPage / UserListPage / RoleListPage / TransferPage / AuditLogPage / DeptTreePage / ReportPage / NotificationListPage）。
**关键约束**：
- `[约束]` 无 `tabIndex > 0` 跳序（既有零 tabIndex 使用，§2.2 核验）。
- `[约束]` react-window 行内按钮 Tab 可达（行在 DOM 内即可 Tab；非可视区行 react-window 不渲染 → Tab 不可达符合预期，§8.1 风险预判）。
- `[约束]` impl 阶段须 E2E 验证 8 页 Tab 顺序（新增 a11y.spec.ts keyboard tab test，或 axe 扫描 taborder 规则覆盖）。

### 4.6 AC-A11y-6：8 页焦点可见

**实现位置**：apps/web/src/index.css（新增，D7）+ main.tsx import。
**关键约束**：
- `[约束]` `:focus-visible` 全局规则（outline 2px solid #2563eb + offset 2px，对比度 ≥ 3:1 WCAG 2.4.7）。
- `[约束]` 无 `*:focus { outline: none }` 全局去除（§2.3 核验既有零 outline 去除，浏览器默认 :focus 保留作基线）。
- `[advisory]` 焦点指示器颜色 #2563eb 属实现细节，impl 可调整（须满足对比度 ≥ 3:1）。

### 4.7 AC-A11y-7：jest-axe vitest 单测集成 + 关键组件 0 violations

**实现位置**：apps/web/test/setup.ts（D8 改造）+ apps/web/test/a11y.test.tsx（新增）。
**测试覆盖**：8 个关键组件 axe 扫描（CreateUserModal / SetParentModal / RoleForm / UserRolesPanel / EffectivePermissionsPanel / InheritanceChainPanel / DeptForm / NotificationForm）+ 关键页面（LoginPage / UserListPage / RoleListPage / AuditLogPage / ReportPage）。
**关键约束**：
- `[约束]` jest-axe 覆盖 jsdom 可检测规则（aria-required-attr / aria-roles / region / taborder），**不覆盖 color-contrast**（jsdom 不支持，§3.2 S-23 核验）。
- `[约束]` 0 violations（WCAG 2.1 Level A/AA 自动可检测规则全部通过，AC-A11y-7）。
- `[约束]` 测试 setup 须 mock API 调用（listRoles / getEffectivePermissions / getInheritanceChain 等，避免 axe 扫描时网络请求 pending 导致 loading 态 DOM 不完整）。

### 4.8 AC-A11y-8：@axe-core/playwright E2E 集成 + 关键流 0 violations

**实现位置**：apps/e2e/tests/a11y.spec.ts（新增，D9）。
**测试覆盖**：8 页关键流 axe 扫描（login → users 列表 → roles 列表 → transfer → audit-logs → departments → notifications → reports）。
**关键约束**：
- `[约束]` `withTags(['wcag2a', 'wcag2aa'])` 限定 WCAG 2.1 A/AA 规则集。
- `[约束]` 真实 chromium 浏览器渲染，覆盖 color-contrast（jest-axe 不支持，§3.10）+ 渲染时 violation。
- `[约束]` 0 violations（页面级，AC-A11y-8）。
- `[约束]` 既有 14 E2E 不破坏（既有 5 spec 不改，新增独立 a11y.spec.ts，AC-A11y-11）。

### 4.9 AC-A11y-9：WCAG AA 色彩对比核验

**实现位置**：apps/e2e/tests/a11y.spec.ts（@axe-core/playwright color-contrast 规则，D10）。
**关键约束**：
- `[约束]` color-contrast 规则由 @axe-core/playwright 独占覆盖（jest-axe 不支持，§3.2/§3.10）。
- `[约束]` 既有零 CSS → 浏览器默认黑底白字对比度天然满足 AA 1.4.3（正常文本 ≥ 4.5:1）+ 1.4.11（非文本 UI ≥ 3:1）。
- `[约束]` D7 :focus-visible #2563eb 蓝色焦点指示器对比度 ≥ 3:1（WCAG 2.4.7）。

### 4.10 AC-A11y-10/11：既有测试全绿

**实现位置**：apps/web/test/**（既有 1263）+ apps/e2e/tests/**（既有 14）。
**关键约束**：
- `[约束]` 既有 1263 vitest 不可回归（AC-A11y-10，可访问性深化不破坏既有功能）。
- `[约束]` 既有 14 E2E 不可回归（AC-A11y-11，既有 5 spec 不改，新增 a11y.spec.ts 不影响既有）。
- `[约束]` impl-writer 须按 R16 S-17 通过 `git diff HEAD --stat -- apps/web/test/ apps/e2e/tests/` 实跑核对自报改动范围（§5 测试策略详述回归风险）。

## 5. 测试策略

### 5.1 jest-axe vitest 单测（新增 apps/web/test/a11y.test.tsx）

- **setup**：apps/web/test/setup.ts 注入 `expect.extend(toHaveNoViolations)`（D8）。
- **覆盖**：8 个 modal 组件 + 关键页面 axe 扫描（AC-A11y-7）。
- **断言**：`expect(await axe(container)).toHaveNoViolations()`（0 violations）。
- **不覆盖 color-contrast**（jsdom 不支持，§3.2 S-23 核验）。
- **mock 策略**：modal 内 listRoles / getEffectivePermissions / getInheritanceChain 等 API 调用须 mock（vi.mock 或 MSW），避免 loading 态 DOM 不完整导致 axe 误报。

### 5.2 @axe-core/playwright E2E（新增 apps/e2e/tests/a11y.spec.ts）

- **集成**：每 test 显式 `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()`（D9）。
- **覆盖**：8 页关键流 axe 扫描（AC-A11y-8）+ color-contrast（AC-A11y-9）。
- **断言**：`expect(results.violations).toEqual([])`（0 violations）。
- **新增独立 spec**：a11y.spec.ts（~8 test，每页 1 test），既有 5 spec 不改（保持 14 E2E 既有断言零回归，AC-A11y-11）。

### 5.3 既有测试回归风险预判（AC-A11y-10/11）

**风险 1：modal role="dialog" 包裹层破坏既有 getByRole 断言**
- 既有 E2E 用 `page.getByRole('button', { name: ... })` 定位 modal 内按钮（如 CreateUserModal"创建"按钮 / SetParentModal"提交"按钮）。modal 根元素加 `role="dialog"` 不改变内层按钮的 role，getByRole('button') 仍可达（role="dialog" 是容器语义，不影响子元素查询）。
- 既有 vitest 用 `getByRole('dialog')` 查询 modal？——核验：既有测试若用 `getByRole('dialog')` 仅 CreateUserModal 匹配（唯一 role="dialog"），R23 改造后 8 个 modal 都有 role="dialog" → 若某测试用 `getByRole('dialog')` 无 name 过滤会多匹配抛错。impl 阶段须 grep 既有测试 `getByRole('dialog')` 用法，若有须加 `{ name: ... }` 过滤消歧（参照 R16 S-19 跨组件唯一约束）。

**风险 2：aria-modal="true" 影响 queryByRole**
- aria-modal="true" 不改变 role 查询语义（仅标记模态），不破坏既有 queryByRole 断言。低风险。

**风险 3：focus trap 改变 Tab 行为**
- 既有 E2E transfer-page.test.tsx 有 11 处 `user.tab()`（PRD §2.4 核验，用途是"触发失焦以触发 listUserRoles"，非键盘可访问性测试）。modal focus trap 不影响 TransferPage（TransferForm 非 modal，§3.4 排除），既有 user.tab() 行为不变。低风险。

**风险 4：:focus-visible CSS 不影响既有测试**
- :focus-visible 仅视觉样式（outline），不改变 DOM 结构 / role / 语义，既有测试断言不涉及 outline。零风险。

**回归保障**：
- impl-writer 须实跑 `npm test`（vitest，1263 测试）+ `npm run test:e2e`（playwright，14 E2E）确认全绿（AC-A11y-10/11）。
- impl-writer 须按 R16 S-17 通过 `git diff HEAD --stat -- apps/web/test/ apps/e2e/tests/` 实跑核对自报改动范围，若需改既有测试 setup 须显式列出理由（参照 R20 S-5 模式）。
- 若 modal role="dialog" 改造破坏既有 `getByRole('dialog')` 断言，impl 阶段须反向同步 Tech-Spec §10 标注 [advisory] 偏离（参照 R12 S-2 advisory 反向同步边界）。

## 6. 替代方案（S-23 衍生，§10.7 详述）

### 6.1 jest-axe 不兼容 vitest 1.6.1 退回方案（S-23 核验已确认兼容，预判低概率）

S-23 核验结论：jest-axe 10.0.0 无 peerDeps（loose）+ 实测安装 + typecheck exit 0 → **兼容 vitest 1.6.1**。但预判若 impl 阶段发现 jest-axe matcher 在 vitest project 模式下未注册（参照 R20 S-5 jest-dom 6.x 坑）：
- **方案 A**（推荐退回）：退回直接 `import { axe } from 'axe-core'` 手动集成（axe-core 是 jest-axe 的依赖，可直接 import；无 toHaveNoViolations matcher，断言写法 `expect((await axe(container)).violations).toEqual([])` 冗长但功能等价）。
- **方案 B**：升级 vitest 到 2.x（引入 test.projects，违背 R20 S-5 既有 workspace 模式，跨轮 advisory 范围，排除）。
- **方案 C**：仅用 @axe-core/playwright E2E 单轨（放弃单测阶段 axe 反馈，违背 Q2 推荐①双轨决策，排除）。

### 6.2 @axe-core/playwright 不兼容 Playwright 1.61.1 退回方案（S-23 核验已确认兼容，预判低概率）

S-23 核验结论：@axe-core/playwright 4.12.1 peerDeps `playwright-core >= 1.0.0` + 实测安装 + typecheck exit 0 → **兼容 @playwright/test 1.61.1**。但预判若 impl 阶段发现 AxeBuilder API 与 Playwright 1.61 不兼容（极低概率）：
- **方案 A**（推荐退回）：退回 Playwright 自己的 `page.accessibility.snapshot()` API（覆盖度低，仅 ARIA tree 非完整 WCAG，但无外部依赖）。
- **方案 B**：升级 Playwright（跨轮 advisory，排除）。
- **方案 C**：仅用 jest-axe vitest 单测（放弃页面级真实浏览器扫描 + color-contrast，违背 Q2 推荐①双轨 + AC-A11y-9 色彩对比，排除）。

## 7. advisory 偏离反向同步

### 7.1 D7 :focus-visible 焦点指示器颜色（[advisory]）

D7 焦点指示器颜色 `#2563eb`（蓝色）属实现细节（PRD AC-A11y-6 仅要求"焦点可见 outline 保留 + 对比度 ≥ 3:1"，不定具体颜色），[advisory] 允许 impl-writer 据设计调整（须满足对比度 ≥ 3:1，axe color-contrast 规则自动核验）。impl-writer 若偏离 #2563eb，须在交付报告列"偏离理由 + 调整后颜色 + 对比度合规论证"。

### 7.2 D2 @types/jest-axe 版本略滞后（[advisory] + S-23 衍生）

D2 @types/jest-axe 3.5.9 deps 声明 `axe-core ^3.5.5`（jest-axe 10.0.0 实际 deps `axe-core 4.10.2`），版本略滞后属 S-23 触发的 Tech Lead 版本核验发现。skipLibCheck=true 兼容不阻断编译。impl 阶段若发现类型不符（如 `axe` 函数签名差异），可加局部 `as` 断言或本地 .d.ts 声明（[advisory] 范围），须在交付报告列出。**S-23 第二次触发验证生效**——Tech Lead 在 spec 阶段核验版本 + 实测安装 + §10.6 反向同步标注。

### 7.3 D9 新增独立 a11y.spec.ts vs 既有 5 spec 增 axe 断言（[advisory]）

D9 选择新增独立 a11y.spec.ts（~8 test）而非既有 5 spec 增 axe 断言，属实现策略选择（PRD AC-A11y-8 不限定集成方式）。[advisory] 允许 impl-writer 据实际调整为既有 5 spec 增 axe 断言（须不破坏既有 14 E2E 断言，AC-A11y-11）。impl-writer 若调整，须在交付报告列"调整理由 + 既有 14 E2E 全绿验证"。

### 7.4 D4 form-based modal DOM 结构调整（aria-allowed-role 合规修复，[advisory] + §10.4 预判盲区补全）

> **[R23 §7.4 反向同步]**：impl-writer 在 impl 阶段发现 Tech-Spec §3.4 D4 字面要求"4 个 form-based modal（SetParentModal / RoleForm / DeptForm / NotificationForm）改造前根元素 `<form>` → 改造后 `<form role="dialog" aria-modal="true" aria-label="...">`"会触发 jest-axe `aria-allowed-role` 违规——ARIA 1.2 规范不允许 `<form>` 元素使用 `dialog` role（form 允许的 role 仅 form/search/none/presentation，参见 [ARIA in HTML - Allowed ARIA Roles](https://www.w3.org/TR/html-aria/#form)）。

**修复方案**：4 个 form-based modal 改为 `<div role="dialog" aria-modal="true" aria-label="..." ref={rootRef}><form onSubmit={...}>...</form></div>` 结构：
- `role="dialog"` 加到外层 `<div>`（非 `<form>`），符合 ARIA 1.2 allowed-role 规则
- `<form onSubmit>` 保留原 submit 行为（form 元素本身不破坏，仅 role 改挂 div）
- `rootRef` 类型从 `HTMLFormElement` 改为 `HTMLDivElement`（useFocusTrap hook 签名 `React.RefObject<HTMLElement>` 兼容，readonly 协变）
- 4 个 div-based modal（CreateUserModal / UserRolesPanel / EffectivePermissionsPanel / InheritanceChainPanel）无需调整（`<div role="dialog">` 原本合规）

**影响范围**：
- 仅 4 个组件（SetParentModal.tsx / RoleForm.tsx / DeptForm.tsx / NotificationForm.tsx）+ ref 类型
- 既有组件测试（role-form.test.tsx / dept-form.test.tsx / set-parent-modal.test.tsx / notification-form.test.tsx）全部通过（form onSubmit 行为不变，jest-axe 0 violations 证明 ARIA 合规）
- D4 的 aria-label 域特定命名清单全部保留不变（"继承设置" / "创建角色" / "创建部门" / "创建通知"/"编辑通知"）
- 1272 vitest（1263 既有 + 9 新增 jest-axe a11y）+ 22 E2E（14 既有 + 8 新增 @axe-core/playwright a11y）全绿证明修复有效

**§10.4 预判盲区补全**：Tech-Spec §10.4 原预判"axe-core 0 violations 暴露既有 WCAG 违规"（既有 aria-label 55 处等），未预判"D4 改造本身引入 aria-allowed-role 违规"（form 元素不允许 dialog role）。impl-writer 在 impl 阶段发现后按 R19 S-21 固化机制实际编辑 Tech-Spec §7.4 反向同步标注（非仅代码注释声明"伪同步"）。

**性质**：[advisory]（非 [约束] 偏离，D4 aria-label 域特定命名清单 + role="dialog" + aria-modal + aria-label 四项核心要求全部落地，仅 DOM 结构从 `<form role="dialog">` 调整为 `<div role="dialog"><form>` 实现 ARIA 合规）。impl-writer 自报准确性通过（S-17）：4 个 form-based modal 改动已在 git status 列出，无虚报/漏报。

## 8. 风险预判

### 8.1 react-window 虚拟列表与 Tab 顺序协同风险（R22 D2 协同）

**风险**：R23 在 UserListPage / RoleListPage 行内按钮 Tab 可达性核验时，react-window FixedSizeList 的绝对定位 + overscanCount=5 可能使 Tab 顺序异常（行不在可视区时按钮不在 DOM → Tab 不可达，符合预期；但 overscanCount=5 边界行的 Tab 可达性 + 可见性须 E2E 验证）。

**预判**：
- 行数 ≤ 50 走普通 `<table><tr><td>`（R22 D5 回退路径），Tab 顺序天然正确。
- 行数 > 50 走 FixedSizeList，绝对定位行仅在可视区 + overscan 渲染（非可视区行不渲染 → Tab 不可达，符合预期，WCAG 2.4.3 Focus Order 不违规因虚拟列表设计如此）。
- 风险点：overscanCount=5 边界行的 Tab 可达性 + 可见性，impl 阶段须 E2E 验证（新增 axe 扫描 + Tab 顺序测试覆盖行数 > 50 场景，参照 R22 AC-P9 既有测试不破坏原则）。
- **虚拟列表键盘导航（方向键滚动 + 焦点记忆）留 R24+ future**（PRD §5 声明，Q3 推荐②）。

### 8.2 axe-core 0 violations 暴露既有 WCAG 违规风险

**风险**：jest-axe + @axe-core/playwright 扫描可能暴露既有 WCAG 违规（如既有 aria-label 域特定命名 55 处中某处不规范 / 既有 role="alert" 用法 / 既有 form 缺 label 关联等），导致 AC-A11y-7/8 0 violations 失败。

**预判**：
- §2.3 核验既有零 CSS → color-contrast 天然满足（AC-A11y-9 低风险）。
- §2.1 核验既有 aria-label 55 处域特定命名（D18/R16/R21 约束）→ aria-label 规则低风险。
- 风险点：既有 form label 关联（`<label>邮箱<input/></label>` 包裹式 label，CreateUserModal / RoleForm / DeptForm 用包裹式，TransferForm / SetParentModal 用 aria-label 式）—— axe `label` 规则可能对 aria-label 式 select 提示改进建议。impl 阶段若 axe 报既有违规，须评估：
  - 若属 R23 引入的新违规（如 modal role/aria-modal 改造引入）→ 修复。
  - 若属既有违规（非 R23 引入）→ 修复 or [advisory] 豁免（须在交付报告列"既有违规 + 豁免理由 + 是否留 future"，参照 R12 S-2 advisory 边界）。

### 8.3 modal focus trap 实现复杂度风险（useFocusTrap hook）

**风险**：自定义 useFocusTrap hook 跨 8 个 modal 复用，可能引入边界 case（如 modal 内无可聚焦元素 / focusables 动态变化 / React.StrictMode 双调用 effect）。

**预判**：
- 8 个 modal 都含可聚焦元素（按钮 + input / select），focusables 为空极低概率（hook 内 `if (current.length === 0) return` 守卫）。
- React 18 StrictMode dev 双调用 effect：triggerRef 记录 + cleanup focus restore 须幂等（useEffect cleanup 设计为可重复执行，参照 R22 D2 ref 守卫模式 `if (listRef.current) ...`）。
- 与 R22 React.memo 协同（R22 D1）：hook useCallback 稳定引用（D1 理由 4），避免 modal state 变化触发列表行 re-render。
- impl 阶段须单测覆盖：focus trap 循环（Tab 末→首 / Shift+Tab 首→末）+ ESC 关闭（submitting 阻止）+ focus restore（关闭后焦点回触发按钮）。

### 8.4 既有 getByRole('dialog') 断言多匹配风险（§5.3 风险 1 详述）

**风险**：既有 vitest 若用 `getByRole('dialog')` 无 name 过滤，R23 改造后 8 个 modal 都有 role="dialog" → 多匹配抛错。

**预判**：impl 阶段须 grep 既有测试 `getByRole('dialog')` / `queryByRole('dialog')` 用法：
- 若仅 CreateUserModal 测试用且无 name 过滤 → 须加 `{ name: '创建用户' }` 过滤消歧。
- 若无既有用法 → 零风险。
- impl-writer 须在交付报告列 grep 结果 + 调整（若有）。

## 9. 影响面估算（AI-006 两类标注）

### 9.1 ①类显式影响（grep 符号引用）

| 文件 | 影响类型 | 说明 |
|------|----------|------|
| `apps/web/src/hooks/useFocusTrap.ts`（新增） | ③类新增 | focus trap + ESC + restore 共享 hook（D1/D5/D6） |
| `apps/web/src/components/CreateUserModal.tsx` | ②类改造 | 补 aria-modal + 接入 useFocusTrap（D4） |
| `apps/web/src/components/SetParentModal.tsx` | ②类改造 | 加 role/aria-modal/aria-label + 接入 useFocusTrap |
| `apps/web/src/components/RoleForm.tsx` | ②类改造 | 同上 |
| `apps/web/src/components/UserRolesPanel.tsx` | ②类改造 | 同上 |
| `apps/web/src/components/EffectivePermissionsPanel.tsx` | ②类改造 | 同上 + 落实 aria-label="有效权限"（注释已声明未落） |
| `apps/web/src/components/InheritanceChainPanel.tsx` | ②类改造 | 同上 + 落实 aria-label="继承链"（注释已声明未落） |
| `apps/web/src/components/DeptForm.tsx` | ②类改造 | 同上 |
| `apps/web/src/components/NotificationForm.tsx` | ②类改造 | 同上 + 动态 aria-label（create/edit） |
| `apps/web/src/index.css`（新增） | ③类新增 | :focus-visible 全局规则（D7） |
| `apps/web/src/main.tsx` | ②类改造 | import index.css（D7，impl 阶段核验既有 import 状态） |
| `apps/web/test/setup.ts` | ②类改造 | jest-axe matcher 注入（D8） |
| `apps/web/test/a11y.test.tsx`（新增） | ③类新增 | jest-axe 组件级 axe 扫描（AC-A11y-7） |
| `apps/e2e/tests/a11y.spec.ts`（新增） | ③类新增 | @axe-core/playwright 页面级 axe 扫描（AC-A11y-8/9） |
| `apps/web/package.json` | ③类新增 dep | jest-axe@^10.0.0 + @types/jest-axe@^3.5.9 devDep（D2） |
| `package.json`（根） | ③类新增 dep | @axe-core/playwright@^4.12.1 devDep（D3） |

### 9.2 ①类隐式影响（全集断言依赖枚举值）

**0 文件**。本轮无 errorCodeSchema / 域 schema 扩展，无全集断言失效风险。

### 9.3 ②类签名变更

**0 文件**。8 个 modal 组件改动是内部实现改造（加 role/aria-modal/aria-label + 接入 hook），对外签名（export 的组件名 + props 类型）不变。useFocusTrap hook 是新增内部 hook，不 export 公共 API。

### 9.4 测试影响

| 文件 | 影响类型 | 说明 |
|------|----------|------|
| `apps/web/test/**/*.test.tsx`（既有 57 files / 1263 tests） | ②类配置驱动验证 | modal role/aria-modal + focus trap 改动后须全绿（AC-A11y-10）；若既有 getByRole('dialog') 多匹配须加 name 过滤（§8.4） |
| `apps/web/test/a11y.test.tsx`（新增） | ③类新增 | jest-axe 8 组件 + 关键页面 axe 扫描（AC-A11y-7） |
| `apps/e2e/tests/a11y.spec.ts`（新增） | ③类新增 | @axe-core/playwright 8 页 axe 扫描（AC-A11y-8/9） |
| 既有 5 spec / 14 E2E | ②类验证 | 不改既有断言（D9 新增独立 a11y.spec.ts），react-window 虚拟列表 + role="dialog" 改造后须全绿（AC-A11y-11） |

**新增依赖**：jest-axe@^10.0.0 + @types/jest-axe@^3.5.9（apps/web devDeps）+ @axe-core/playwright@^4.12.1（根 devDeps）共 3 个。
**新增测试估算**：jest-axe 单测 ~13 test（8 modal + 5 关键页面）+ E2E axe 扫描 ~8 test（8 页）共 ~21 新增 test。

## 10. §10 组合副作用预判（R18 S-21 + R21 S-23 固化）

### 10.1 react-window 虚拟列表与键盘导航交互预判（R22 D2 协同）

`[约束]` react-window FixedSizeList 默认无键盘导航（无 tabIndex / onKeyDown），R23 不实现方向键滚动 + 焦点记忆（虚拟列表键盘导航留 R24+ future，PRD §5 声明）。R23 仅确保行内按钮（UserRow / RoleRow 内按钮）Tab 可达 + 焦点可见：
- 行数 ≤ 50 走普通 `<table><tr><td>`（R22 D5 回退），Tab 顺序天然正确。
- 行数 > 50 走 FixedSizeList，非可视区行不渲染 → Tab 不可达（符合预期，虚拟列表设计如此）。
- 风险点：overscanCount=5 边界行 Tab 可达性 + 可见性，impl 阶段 E2E 验证（§8.1）。

### 10.2 modal focus trap 实现复杂度预判（D1 useFocusTrap hook）

`[约束]` 自定义 useFocusTrap hook 跨 8 个 modal 复用（≥4 处须提取共享，R16 S-19 边界满足）。hook 内须处理：
- 可聚焦元素查询（a[href] / button / input / select / textarea / [tabindex] 非 -1）+ 排除 disabled + 排除隐藏（offsetParent === null）。
- Tab/Shift+Tab 焦点循环（首↔末）。
- ESC 关闭（submitting 阻止）。
- focus restore（useRef 记录触发按钮 + cleanup focus）。
- React 18 StrictMode dev 双调用 effect 幂等（参照 R22 D2 ref 守卫模式）。
- 与 R22 React.memo 协同（useCallback 稳定引用，避免列表行 re-render）。
- [advisory] 若 impl 阶段发现 hook 边界 case（如 modal 内无可聚焦元素），须反向同步 §10.2 + 交付报告列修复（R18 S-21）。

### 10.3 既有 1263 vitest + 14 E2E 回归风险预判（AC-A11y-10/11）

`[约束]` modal 加 role="dialog" + aria-modal 可能影响既有 getByRole 断言：
- `getByRole('dialog')` 无 name 过滤会多匹配（R23 改造后 8 个 modal 都有 role="dialog"）→ impl 须 grep 既有用法 + 加 `{ name: ... }` 过滤消歧（§8.4）。
- `aria-modal="true"` 不改变 role 查询语义（仅标记模态），不破坏既有 queryByRole 断言（低风险）。
- `:focus-visible` CSS 仅视觉样式，不改变 DOM / role / 语义（零风险）。
- 既有 14 E2E 用 `page.getByLabel` / `page.getByRole('button', { name })` 定位（PRD §2.4），modal role/aria-modal 不影响内层元素查询（§5.3 风险 1）。
- `[约束]` impl-writer 须实跑 `npm test` + `npm run test:e2e` 确认全绿（AC-A11y-10/11）+ `git diff HEAD --stat -- apps/web/test/ apps/e2e/tests/` 实跑核对自报改动范围（R16 S-17）。

### 10.4 axe-core 0 violations 暴露既有 WCAG 违规预判（§8.2 详述）

`[约束]` jest-axe + @axe-core/playwright 扫描可能暴露既有 WCAG 违规（既有 aria-label 55 处中某处不规范 / 既有 form label 关联 / 既有 role="alert" 用法）。impl 阶段须评估：
- R23 引入的新违规（modal role/aria-modal 改造引入）→ 修复。
- 既有违规（非 R23 引入）→ 修复 or [advisory] 豁免（须在交付报告列"既有违规 + 豁免理由 + 是否留 future"，参照 R12 S-2 advisory 边界）。
- §2.3 核验既有零 CSS → color-contrast 天然满足（AC-A11y-9 低风险）。
- §2.1 核验既有 aria-label 55 处域特定命名 → aria-label 规则低风险。

### 10.5 `[约束]` 偏离反向同步闭环性预判（R18 S-21）

本轮 [约束] 决策 D1-D10 均按 spec 落地，预判 impl-writer 可能触发的 [约束] 偏离：
- D7 :focus-visible 颜色 #2563eb 调整（[advisory] 非 [约束] 偏离，§7.1）。
- D9 新增独立 a11y.spec.ts vs 既有 5 spec 增 axe 断言（[advisory] 非 [约束] 偏离，§7.3）。
- 若 impl-writer 实现期发现 [约束] 项设计不足须偏离（如 useFocusTrap hook 边界 case 须加守卫 / 既有 getByRole('dialog') 多匹配须改既有测试断言），须实际编辑 Tech-Spec 对应章节（grep 确认章节已改）+ 交付报告列"反向同步的 Spec 文件路径 + 修改行号 + 偏离理由 + 合规论证"（R18 S-21）。**代码注释声明 ≠ Spec 已同步（伪同步）**——仅在代码注释标注"[约束] 偏离"而未实际编辑 Spec 文件属伪同步违规。加性安全场景（更严格非更弱）仍须按 AI-003 流程闭合，不可因"加性安全"省略 Spec 反向同步。

### 10.6 S-23 第二次触发验证标注（jest-axe + @axe-core/playwright 版本核验）

**[R23 §10.6 S-23 第二次触发验证生效]**：BA PRD §1.3/§6.2 字面假设"jest-axe 5.x + @axe-core/playwright 4.x"，Tech Lead 实际核验 npm registry dist-tags + 安装产物文件结构 + 实测安装 + typecheck，**5 项核验结论**：

1. **jest-axe npm latest = 10.0.0**（非 PRD 假设 5.x，Tech Lead 修正）。版本演进 1.x→...→5.x→6.x→7.x→8.x→9.x→10.x。jest-axe 10.0.0（2025-03-04 发布）+ @types/jest-axe 3.5.9（社区类型，版本略滞后 [advisory]）。
2. **jest-axe 无 peerDependencies**（loose 约束），与 vitest 1.6.1 兼容（无须 jest peer，jest-matcher-utils 29.2.2 是 jest 内部工具但 vitest 提供兼容 expect.extend API）。**实测安装**：`npm --workspace @admin/web install --save-dev jest-axe@10.0.0` 成功（58 packages added）。
3. **jest-axe 不存在 `/vitest` 子路径入口**——package.json `files` 字段仅 `['index.js', 'extend-expect.js']`，无 `vitest` 子路径。**PRD §2.5/§6.2 假设 `import 'jest-axe/vitest'` 错误**（参照 R20 S-5 jest-dom `/vitest` 子路径模式假设 jest-axe 同形，但 jest-axe 未提供）。Tech Lead 修正为显式 `import { expect } from 'vitest'; import { toHaveNoViolations } from 'jest-axe'; expect.extend(toHaveNoViolations);`（D8）。
4. **jest-axe jsdom 不支持 color-contrast 规则**——jest-axe README 明示"Color contrast checks do not work in JSDOM so are turned off in jest-axe"。**AC-A11y-9 色彩对比核验须由 @axe-core/playwright E2E 独占覆盖**（D10），jest-axe 覆盖 aria/region/taborder 等 jsdom 可检测规则。
5. **@axe-core/playwright npm latest = 4.12.1**（与 PRD 假设 4.x 一致）+ peerDeps `{ 'playwright-core': '>= 1.0.0' }` 与 @playwright/test 1.61.1 兼容 + API `AxeBuilder` 核验确认（dist/index.d.ts Read）+ 自带 TypeScript 类型。**实测安装**：`npm install --save-dev @axe-core/playwright@4.12.1` 成功（28 packages added）。

**实测安装验证**：`npm run typecheck`（tsc -p tsconfig.json --noEmit）**exit 0**（jest-axe 10.0.0 经 @types/jest-axe 3.5.9 类型解析 + @axe-core/playwright 4.12.1 自带 types 在 apps/e2e 解析，skipLibCheck=true 兼容 @types/jest-axe 版本略滞后）。S-23 第二次触发核验闭环。

**实装版本**（与 spec D 决策一致）：
- jest-axe@10.0.0（apps/web devDeps，D2）
- @types/jest-axe@3.5.9（apps/web devDeps，D2 [advisory] 版本略滞后）
- @axe-core/playwright@4.12.1（根 devDeps，D3）

**S-23 固化机制在 R23 第二次触发验证生效**——Tech Lead 在 spec 阶段预先核验版本 + 实测安装验证 + §10.6 反向同步标注，避免 impl 阶段才发现 API 差异（PRD §2.5/§6.2 假设 `import 'jest-axe/vitest'` 错误若到 impl 阶段才发现 → 重演 R20 vitest 1.6.1 版本核验缺口，被规避）。参照 R22 §10.6 react-window 首次触发验证模式（BA Q2 字面"react-window 8.x"误判被 Tech Lead 核验修正为 1.8.11），R23 jest-axe 版本号核验（10.0.0 非 5.x）+ 子路径核验（无 /vitest）是 S-23 第二次触发的同形修正。

### 10.7 替代方案预判（§10.6 衍生）

**jest-axe 不兼容 vitest 1.6.1 退回方案**（S-23 核验已确认兼容，预判低概率，§6.1 详述）：
- 方案 A（推荐）：退回 `import { axe } from 'axe-core'` 手动集成（axe-core 是 jest-axe 依赖，可直接 import；无 toHaveNoViolations matcher，断言 `expect((await axe(container)).violations).toEqual([])` 冗长但功能等价）。
- 方案 B：升级 vitest 到 2.x（违背 R20 S-5，排除）。
- 方案 C：仅 @axe-core/playwright E2E 单轨（违背 Q2 推荐①双轨，排除）。

**@axe-core/playwright 不兼容 Playwright 1.61.1 退回方案**（S-23 核验已确认兼容，预判低概率，§6.2 详述）：
- 方案 A（推荐）：退回 Playwright `page.accessibility.snapshot()` API（覆盖度低，仅 ARIA tree 非完整 WCAG，无外部依赖）。
- 方案 B：升级 Playwright（跨轮 advisory，排除）。
- 方案 C：仅 jest-axe vitest 单测（放弃 color-contrast，违背 AC-A11y-9，排除）。

**jest-axe 无 /vitest 子路径退回方案**（S-23 核验已确认无该子路径，D8 已修正，无须退回）：
- 显式 `expect.extend(toHaveNoViolations)`（D8 已采，参照 R20 S-5 jest-dom/vitest 模式适配）。

## 11. G6 验收门禁清单

- **AC-A11y-1**：8 个 modal 形态组件根元素含 `role="dialog"` + `aria-modal="true"` + `aria-label`（域特定，§3.4 D4 清单）—— git diff + axe 扫描核验。
- **AC-A11y-2**：modal ESC 关闭（submitting 阻止）—— useFocusTrap hook 单测 + E2E keyboard ESC test 核验。
- **AC-A11y-3**：modal focus trap（Tab/Shift+Tab 循环）—— useFocusTrap hook 单测 + E2E keyboard Tab test 核验。
- **AC-A11y-4**：modal focus restore（关闭后焦点回触发按钮）—— useFocusTrap hook 单测 + E2E focus restore test 核验。
- **AC-A11y-5**：8 页 Tab 顺序正确（无 tabIndex>0 跳序，react-window 行内按钮 Tab 可达）—— E2E keyboard Tab test + axe taborder 规则核验。
- **AC-A11y-6**：8 页焦点可见（:focus-visible 全局规则，对比度 ≥ 3:1）—— axe :focus-visible CSS + color-contrast 规则核验。
- **AC-A11y-7**：jest-axe vitest 单测 0 violations（8 关键组件 + 页面，jsdom 可检测规则）—— `npm test` 全绿 + a11y.test.tsx 0 violations。
- **AC-A11y-8**：@axe-core/playwright E2E 0 violations（8 页关键流，真实浏览器 + color-contrast）—— `npm run test:e2e` 全绿 + a11y.spec.ts 0 violations。
- **AC-A11y-9**：WCAG AA 色彩对比核验（color-contrast 由 @axe-core/playwright 独占，既有零 CSS 天然满足）—— a11y.spec.ts color-contrast 规则 0 violations。
- **AC-A11y-10**：既有 1263 vitest 全绿（无回归）—— `npm test` 1263 + 新增 jest-axe 全绿。
- **AC-A11y-11**：既有 14 E2E 全绿（无回归）—— `npm run test:e2e` 14 + 新增 a11y.spec.ts 全绿。
- **ARCH 检查**：ARCH-001（四层单向依赖）不触发（无 src/ 业务文件改动）；ARCH-002（contracts 零变更，§6）；ARCH-003（apps/web 不 import apps/api/src + apps/e2e 通过 HTTP 交互，保持）。
- **S-23 第二次触发验证**：jest-axe@10.0.0 + @types/jest-axe@3.5.9 + @axe-core/playwright@4.12.1 实测安装 + typecheck exit 0（§10.6）。

## G3 自检声明

- **tsc 编译**：本轮无 contracts/errors 改动，jest-axe + @axe-core/playwright 实测安装 + typecheck exit 0（§10.6），impl-writer 阶段须再验证全绿。
- **Spec 与契约 1:1**：本轮无 contracts 改动，无 1:1 校验需求。
- **边界覆盖**：§1 覆盖范围明确（可访问性三方向 + R22 协同）+ §2 既有现状核验（8 项资产：modal 组件盘点 / role 现状 / CSS 现状 / vitest 环境 / E2E 基础设施 / 依赖现状）+ §9 受影响清单（AI-006 两类标注完整：①类显式 16 文件 + ①类隐式 0 + ②类签名 0 + 测试影响 4 类）。
- **受影响清单两类完整**：§9.1 ①类显式影响（16 文件）+ §9.2 ①类隐式影响（0 文件）+ §9.3 ②类签名变更（0 文件）+ §9.4 测试影响（4 类）。
- **§10 组合副作用预判完整**：§10.1-§10.7 七项预判，含 react-window 协同（§10.1）+ focus trap 实现复杂度（§10.2）+ 既有测试回归（§10.3）+ axe 暴露既有违规（§10.4）+ [约束] 偏离反向同步（§10.5，R18 S-21）+ S-23 第二次触发（§10.6，5 项核验结论 + 实装版本）+ 替代方案（§10.7）。
- **S-23 第二次触发验证生效**：D2 jest-axe@10.0.0（非 PRD 假设 5.x）+ D3 @axe-core/playwright@4.12.1 版本核验 + D8 jest-axe 无 /vitest 子路径修正 + D10 jest-axe 不支持 color-contrast 双轨分工 + §3.2/§3.3 + §10.6 反向同步标注，Tech Lead 在 spec 阶段实际核验 npm registry dist-tags + 安装产物 + 实测安装 + typecheck exit 0。
- **advisory 偏离反向同步**：§7.1 D7 焦点指示器颜色 + §7.2 D2 @types/jest-axe 版本略滞后（S-23 衍生）+ §7.3 D9 新增独立 spec 策略选择。
