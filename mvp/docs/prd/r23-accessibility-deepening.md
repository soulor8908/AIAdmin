---
doc_type: PRD
id: PRD-ACCESSIBILITY-DEEPENING-001
title: R23 可访问性深化（modal 焦点陷阱 + ESC 关闭 + Tab 顺序 + 焦点可见 + axe-core 自动 WCAG 检测）
status: decided
owner: ba@team
created: 2026-07-04
aligns: [PRD-WEB-AUTH-USER-001, PRD-WEB-ROLE-DEPT-AUDIT-001, PRD-WEB-NOTIFICATION-REPORT-001, PRD-WEB-TRANSFER-INHERITANCE-001, PRD-FRONTEND-PERFORMANCE-001]
prd_ref: RETRO-ROUND22-001
# Q&A 决策结果摘要（用户已拍板，2026-07-04）：
# Q1=③ axe-core WCAG AA 自动检测 + 键盘导航（screen reader 端到端人工核验留 R26+ future，CI 不可重复 + 成本高）
# Q2=① jest-axe（vitest 单测集成）+ @axe-core/playwright（E2E 集成）双轨，S-23 在 R23 第二次触发（R22 react-window 1.x 之后）
# Q3=② 全页面 8 页所有交互 + modal focus trap/ESC/restore，虚拟列表（react-window FixedSizeList）键盘导航留 R24+ future（复杂度高 + 仅 > 50 行启用）
---

# R23 可访问性深化 + 闭合 R22 性能加固遗留的协同缺口

> 本轮（R23）承接 R22 retro §6 候选清单第 1 项——可访问性深化。R22 已建立前端性能加固成果（React.memo + react-window 1.x 虚拟列表 + React.lazy 8 页 + Suspense），R23 在此基础上深化可访问性：① 8 页键盘导航（Tab 顺序 + 焦点可见）② modal 焦点陷阱 + ESC 关闭 + 焦点恢复（7-9 个 modal 形态组件统一补齐 role="dialog" + aria-modal + focus trap）③ axe-core 自动 WCAG AA 检测（jest-axe vitest 单测 + @axe-core/playwright E2E 双轨）。
>
> **既有可访问性现状盘点**（基于实际 grep/Read 探索，§2 详述）：既有 aria-label 域特定命名（D18/R16 约束）55 处覆盖 14 个文件 + role="alert" 14 处 + role="dialog" 仅 1 处（CreateUserModal）+ **零 tabIndex / 零 onKeyDown / 零 onKeyPress**（apps/web/src 全量 grep 确认，是 R23 键盘可访问性最大缺口）+ 7-9 个 modal 形态组件仅 1 个补齐 role="dialog"，其余 6-8 个缺 role + aria-modal + ESC + focus trap + focus restore + 既有 14 E2E 测试零 keyboard/axe 断言。
>
> **S-23 第二次触发验证**（R21 固化，R22 react-window 首次触发）：R23 引入 jest-axe + @axe-core/playwright 第三方库，Tech Lead 须在 spec 阶段预先核验 npm registry dist-tags + 版本元数据 + API（参照 R22 react-window 模式），§6 预判替代方案（@axe-core/playwright 4.x API 差异 / jest-axe 5.x vitest 集成）。
>
> **PRD 边界**：BA 仅产出本 PRD（含验收标准 + Q&A BLOCKING 决策），不写实现代码、不预定义 axe-core 规则配置细节（属 Tech Lead 阶段产物，ARCH-002 同源约束）。AC 描述"验收什么"，不描述"怎么实现"。R22 Advisory #1（TS baseUrl 弃用）非 R23 引入，留 R25 项目维护轮（§5 声明）。

## 1 · 背景与目标

### 1.1 R23 可访问性深化动机

当前前端可访问性现状（apps/web/src/ 核验，§2 详述）：

- **零键盘事件处理**：apps/web/src 全量 grep `tabIndex|onKeyDown|onKeyPress` 零匹配（参照 file:///workspace/mvp/apps/web/src/）。modal 全部依赖 `onClose` 按钮关闭，无 ESC 关闭；无 focus trap（Tab/Shift+Tab 焦点可逃逸到背景 DOM）；无 focus restore（关闭后焦点丢失而非回到触发按钮）。
- **modal role 缺口**：`role="dialog"` 仅 1 处（`CreateUserModal.tsx:103`），其余 modal 形态组件（`SetParentModal` / `UserRolesPanel` / `EffectivePermissionsPanel` / `InheritanceChainPanel` / `RoleForm` / `NotificationForm` / `TransferForm` / `DeptForm`）均无 `role="dialog"`，无 `aria-modal="true"`，screen reader 无法识别为弹窗。
- **零 WCAG 自动检测**：apps/web/package.json 无 `axe-core` / `jest-axe` / `@axe-core/playwright` 依赖（file:///workspace/mvp/apps/web/package.json 核验），既有 1263 vitest + 14 E2E 测试零 axe 扫描断言。
- **既有 aria-label 域特定命名已建立**（D18/R16/R21 约束）：55 处 aria-label 覆盖 14 个文件，包括"有效权限"/"父角色"/"继承链"/"用户 ID"/"目标部门"/"原角色"/"新角色"/"提交调岗"/"通知标题"/"通知内容"/"收件人 ID"/"实体类型"/"操作者"/"开始"/"结束"/"状态筛选"/"邮箱"/"密码" 等域特定命名（§2.1 详述）。R23 在此基础上深化，不破坏既有 aria-label 域特定约束。
- **既有 react-window 虚拟列表**（R22 D2）：UserListPage / RoleListPage 行数 > 50 启用 FixedSizeList，行数 ≤ 50 回退普通 `<table><tr><td>`。R23 须考虑 react-window 行键盘导航与既有 1263 测试的协同（虚拟列表键盘导航留 future，§5 声明）。
- **既有 E2E 测试零可访问性断言**：apps/e2e/tests 全量 grep `keyboard|press|tab\(|focus|aria|accessibility|axe` 仅 4 处注释（无实际断言），既有 14 E2E 全部经 `page.getByLabel` / `page.getByRole` 定位（依赖既有 aria-label 域特定命名），R23 须在不破坏既有断言前提下新增 axe 扫描。

**可访问性深化三方向**（Q1 推荐决策③，§3 详述）：
1. **键盘导航**：8 页所有交互（按钮/select/input/链接）Tab 顺序正确 + 焦点可见（outline 不被全局 CSS `*:focus { outline: none }` 去除）。
2. **modal 焦点陷阱 + ESC + restore**：7-9 个 modal 形态组件统一补齐 `role="dialog"` + `aria-modal="true"` + `aria-label`（域特定，D18）+ ESC 关闭 + focus trap + focus restore。
3. **axe-core 自动 WCAG AA 检测**：jest-axe 在 vitest 单测中集成（组件级 axe 扫描）+ @axe-core/playwright 在 E2E 中集成（页面级 axe 扫描），双轨覆盖 WCAG 2.1 Level A/AA 自动可检测规则（含色彩对比 color-contrast 规则）。

### 1.2 R22 性能加固成果协同

R22 已建立的性能加固成果在 R23 协同（非冲突）：

- **react-window 虚拟列表**（R22 D2 / AC-P4/P5）：UserListPage / RoleListPage 行数 > 50 启用 FixedSizeList。R23 不破坏 react-window 行渲染（虚拟列表键盘导航留 R24+ future，§5 声明），但 R23 须确保 react-window 渲染的行组件 `<UserRow>` / `<RoleRow>` 内部按钮的 Tab 顺序与焦点可见性正确（行内按钮 Tab 可达 + outline 可见）。
- **React.lazy 8 页**（R22 D6 / AC-P7）：App.tsx 8 页 lazy + Suspense fallback"加载中..."。R23 不破坏 lazy 行为，但须考虑 Suspense fallback 的焦点管理（懒加载完成后的焦点恢复，留 impl 阶段判断是否需要）。
- **React.memo + useCallback + useMemo**（R22 D1/D3/D4）：UserRow / RoleRow memo 包裹。R23 在 modal 引入 focus trap / ESC / focus restore 时须保持 memo 行为（避免 modal state 变化触发列表行 re-render），实现时 useCallback 稳定回调引用（参照 R22 D3 模式）。

### 1.3 S-23 第二次触发验证（R21 固化）

R21 固化的 S-23（Tech Lead 第三方库版本 API 核验缺口）在 R22 首次触发验证生效（react-window@1.8.11 + @types/react-window@1.8.8），R23 第二次触发：

- **R23 引入第三方库**：jest-axe（vitest 单测 axe-core 集成）+ @axe-core/playwright（E2E axe 扫描集成）。
- **Tech Lead 须在 spec 阶段预先核验**：
  - package.json 固定版本（jest-axe 建议核验 npm latest + 1.x/2.x 兼容性，@axe-core/playwright 同理）
  - jest-axe vitest 集成 API（`configureAxe` / `axe` matcher 形式，参照版本元数据非高版本文档假设）
  - @axe-core/playwright API（`AxeBuilder` 形式，与 Playwright 1.61 兼容性）
  - axe-core 规则集（WCAG 2.1 Level A/AA 自动可检测规则范围，color-contrast / aria-required-attr / aria-roles / taborder 等）
- **§6 预判替代方案**：若 jest-axe 最新版与 vitest 1.6.1 不兼容，退回直接 `import { axe } from 'axe-core'` 手动集成；若 @axe-core/playwright API 与 Playwright 1.61 不兼容，退回 playwright 自己的 accessibility assertions（`page.accessibility.snapshot()`）。

### 1.4 目标（可测的验收方向）

- **目标 P1**：8 页所有交互 Tab 顺序正确 + 焦点可见（无 tabindex > 0 跳序，outline 保留）。
- **目标 P2**：7-9 个 modal 形态组件统一补齐 role="dialog" + aria-modal="true" + aria-label（域特定，D18）+ ESC 关闭 + focus trap + focus restore。
- **目标 P3**：jest-axe 在 vitest 单测集成，对 8 页关键组件做 axe 扫描 0 violations（WCAG 2.1 Level A/AA 自动可检测规则）。
- **目标 P4**：@axe-core/playwright 在 E2E 集成，对 8 页关键流做 axe 扫描 0 violations。
- **目标 P5**：既有 1263 vitest + 14 E2E 测试全绿无回归（可访问性深化不破坏既有功能）。
- **目标 P6**：S-23 在 R23 第二次触发验证（Tech Lead spec 阶段核验 jest-axe + @axe-core/playwright 版本 + API + §6 预判替代方案）。
- **目标 P7**：既有 aria-label 域特定命名（D18/R16/R21 约束，55 处）不破坏（R23 在此基础上深化，不重命名既有 aria-label）。

## 2 · 既有可访问性现状盘点（基于实际 grep/Read 探索）

### 2.1 aria-label 域特定命名清单（D18/R16/R21 约束）

apps/web/src 全量 grep `aria-label` 55 处匹配，覆盖 14 个文件，域特定命名清单（R23 不破坏）：

| 组件/页面 | aria-label 域特定命名 | 约束来源 | 文件位置 |
|---|---|---|---|
| UserRow | `有效权限`（按钮文本"权限"+aria-label 消歧） | D18/R16 | file:///workspace/mvp/apps/web/src/components/UserRow.tsx:69 |
| CreateUserModal | `创建用户`（role="dialog" 唯一） + `邮箱` / `姓名` / `密码`（字段） | D21 | file:///workspace/mvp/apps/web/src/components/CreateUserModal.tsx:103,112,122,132 |
| SetParentModal | `父角色`（select 字段，D18；D21 跨组件唯一消歧于 RoleListPage"角色名称"） | D18/R15 S-14 | file:///workspace/mvp/apps/web/src/components/SetParentModal.tsx:129 |
| RoleForm | `名称` / `描述` / `权限` | D21 | file:///workspace/mvp/apps/web/src/components/RoleForm.tsx:98,107,116 |
| DeptForm | `名称` | D21 | file:///workspace/mvp/apps/web/src/components/DeptForm.tsx:91 |
| ReportFilter | `{dim}`（动态维度英文值）+ `开始时间` / `结束时间` / `操作者 ID` / `实体类型` / `动作` | D21/R14 S-10 | file:///workspace/mvp/apps/web/src/components/ReportFilter.tsx:126,140,149,158,169,182 |
| NotificationForm | `通知标题` / `通知内容` / `收件人 ID` | D21/R14 S-10 | file:///workspace/mvp/apps/web/src/components/NotificationForm.tsx:142,150,159 |
| TransferForm | `用户 ID` / `目标部门` / `原角色` / `新角色` / `提交调岗` | D18 | file:///workspace/mvp/apps/web/src/components/TransferForm.tsx:154,162,174,185,199 |
| DeptNode | `用户ID` | D21 | file:///workspace/mvp/apps/web/src/components/DeptNode.tsx:92 |
| LoginPage | `邮箱` / `密码` | D21 | file:///workspace/mvp/apps/web/src/pages/LoginPage.tsx:87,97 |
| UserListPage | `状态筛选` | D21 | file:///workspace/mvp/apps/web/src/pages/UserListPage.tsx:198 |
| NotificationListPage | `状态` | D21 | file:///workspace/mvp/apps/web/src/pages/NotificationListPage.tsx:194 |
| AuditLogPage | `实体类型` / `操作者` / `开始` / `结束` | D21 | file:///workspace/mvp/apps/web/src/pages/AuditLogPage.tsx:126,145,157,169 |

> RoleRow 行操作按钮"设置父角色"/"解除父角色"/"查看继承链"（file:///workspace/mvp/apps/web/src/components/RoleRow.tsx:48-68）已 [advisory] 移除 aria-label（R16 S-19），按钮文本即域特定 accessible name（getByRole('button', {name: ...}) 不受影响，无 aria-label 冗余）。
>
> EffectivePermissionsPanel / InheritanceChainPanel 注释声明 D18 aria-label="有效权限"/"继承链"（file:///workspace/mvp/apps/web/src/components/EffectivePermissionsPanel.tsx:15 + file:///workspace/mvp/apps/web/src/components/InheritanceChainPanel.tsx:14），实际组件需 R23 impl 阶段核验是否已落（§2.2 modal role 缺口推断可能未落）。

### 2.2 role= / aria-modal 现状盘点

apps/web/src 全量 grep `role=` 19 处匹配：

| role 类型 | 数量 | 位置 | R23 缺口 |
|---|---|---|---|
| `role="alert"` | 14 处 | ErrorBanner / DeptForm / RoleForm / UserRolesPanel / TransferForm / ReportFilter / InheritanceChainPanel / SetParentModal / NotificationForm / EffectivePermissionsPanel（错误提示） | 已合规，无缺口 |
| `role="dialog"` | **仅 1 处** | CreateUserModal.tsx:103 | 缺 `aria-modal="true"` |
| modal 形态组件无 role="dialog" | 6-8 个 | SetParentModal / UserRolesPanel / EffectivePermissionsPanel / InheritanceChainPanel / RoleForm / NotificationForm / TransferForm / DeptForm | **缺 role="dialog" + aria-modal="true" + aria-label**（R23 AC-A11y-1 闭合） |

> modal 形态组件判定依据：组件含 `onClose: () => void` props + 父组件通过条件渲染 `{showXxx && <XxxModal .../>}` 挂载。具体哪些组件属 modal 形态（vs drawer/panel）由 impl 阶段核验，BA 估算 7-9 个（CreateUserModal + SetParentModal + 4 个 Panel/Form + TransferForm + DeptForm + RoleForm + NotificationForm 中筛选）。

### 2.3 键盘事件盘点（最大缺口）

apps/web/src 全量 grep `tabIndex|onKeyDown|onKeyPress` **零匹配**（参照 file:///workspace/mvp/apps/web/src/）。这是 R23 键盘可访问性的最大缺口：

- **零 ESC 关闭**：所有 modal 依赖 `onClose` 按钮点击关闭，键盘用户无法用 ESC 关闭（WCAG 2.1.2 No Keyboard Trap 违规，modal 是焦点陷阱但无 ESC 退出）。
- **零 focus trap**：modal 打开后 Tab/Shift+Tab 焦点可逃逸到背景 DOM（背景按钮仍可 Tab 到达），WCAG 2.4.3 Focus Order 违规。
- **零 focus restore**：modal 关闭后焦点丢失到 `<body>`，而非回到触发按钮（WCAG 2.4.3 Focus Order 违规，键盘用户失去上下文）。
- **零 tabindex 管理**：无 `tabIndex={-1}` 用于 programmatically focus，无 `tabIndex={0}` 用于非原生可聚焦元素的可聚焦化。

### 2.4 E2E 基础设施现状

apps/e2e 现状（file:///workspace/mvp/apps/e2e/tests/_helpers.ts + 根 playwright.config.ts）：

- **playwright.config.ts 位置**：根目录 `/workspace/mvp/playwright.config.ts`（非 apps/e2e/，D1 决策）。
- **配置**：chromium 单 project / headless / retries=0 / workers=1 / webServer 双进程（api server 3000 + vite dev 5173）/ baseURL `http://localhost:5173` / actionTimeout=10s / navigationTimeout=15s。
- **测试文件**：5 个 spec（login / logout / users / roles / transfer）共 14 E2E 用例。
- **既有断言模式**：全部经 `page.getByLabel(...)` / `page.getByRole('button', { name: ... })` 定位（依赖既有 aria-label 域特定命名 + 按钮文本 accessible name）。
- **零可访问性断言**：grep `keyboard|press|tab\(|focus|aria|accessibility|axe` 仅 4 处注释（无实际断言），transfer-page.test.tsx 有 11 处 `user.tab()` 但用途是"触发失焦以触发 listUserRoles"（功能测试用途，**非键盘可访问性测试**）。

R23 在此基础上新增 @axe-core/playwright E2E 集成（AC-A11y-8），不破坏既有 14 E2E 断言。

### 2.5 vitest 测试环境现状

vitest.workspace.ts（file:///workspace/mvp/vitest.workspace.ts）+ apps/web/test/setup.ts（file:///workspace/mvp/apps/web/test/setup.ts）：

- **3 个 project**：api（node 环境）/ web（jsdom + setupFiles=jest-dom）/ contracts（node 环境，预留）。
- **setup.ts 内容**：仅 `import '@testing-library/jest-dom/vitest'`（R20 闭合 S-5 反向同步，从 `@testing-library/jest-dom` 改为 `/vitest` 子路径入口）。
- **既有 web 测试规模**：57 files / 1263 tests（R22 +7 性能专项测后），R23 在 web project 新增 jest-axe 测试（AC-A11y-7）。
- **testTimeout=20000**（R15 S-15 固化，全局放宽，非 per-test）。

R23 在 setup.ts 增 `import 'jest-axe/vitest'`（或 `import { axe } from 'vitest-axe'`，由 S-23 核验决定具体 API）扩展 jest-dom matcher（`toHaveNoViolations()`），不破坏既有 jest-dom matcher 注册（参照 R20 S-5 模式，project 隔离的 module graph）。

### 2.6 react-window 虚拟列表与键盘导航协同

R22 D2 / AC-P4/P5 已落 react-window FixedSizeList（file:///workspace/mvp/apps/web/src/pages/UserListPage.tsx:217-241 + file:///workspace/mvp/apps/web/src/pages/RoleListPage.tsx:240-265）：

- **启用阈值**：`VIRTUAL_LIST_THRESHOLD=50`，行数 > 50 启用 FixedSizeList，≤ 50 回退普通 `<table><tr><td>` 保持既有 DOM 结构（R22 D5 advisory，避免破坏既有测试）。
- **行组件结构**：`<div style={style}><UserRow .../></div>`（react-window children render prop 须透传 style 到根 DOM 实现绝对定位虚拟化）。
- **react-window 1.x 内置键盘导航**：FixedSizeList 默认无键盘导航（无 `tabIndex` / `onKeyDown`），需自定义 `outerRef` + `scrollTo` + 方向键事件实现，复杂度高。
- **R23 决策**（Q3 推荐决策①）：虚拟列表键盘导航留 R24+ future（§5 声明）。R23 仅确保行内按钮（`UserRow` 的"禁用"/"角色"/"权限"按钮 + `RoleRow` 的"删除"/"设置父角色"/"解除父角色"/"查看继承链"按钮）Tab 可达 + 焦点可见，不实现方向键滚动 + 焦点记忆。

### 2.7 依赖与色彩现状

apps/web/package.json（file:///workspace/mvp/apps/web/package.json）核验：

- **既有依赖**：react / react-dom / react-router-dom / react-window / @types/react-window / @testing-library/jest-dom / @testing-library/react / @testing-library/user-event / jsdom / vitest。
- **零 axe 相关依赖**：无 `axe-core` / `jest-axe` / `@axe-core/playwright`，R23 新增（S-23 触发）。
- **既有 CSS / 色彩**：apps/web/src 全量 grep `outline|color:|background:|#[0-9a-f]{3,6}` 零匹配，说明组件使用浏览器默认样式 + 浏览器默认 outline（无 `*:focus { outline: none }` 全局去除），但既有 CSS 文件（如 `apps/web/src/index.css` 或 `App.css`）须 R23 impl 阶段 Read 核验色彩对比（WCAG AA 1.4.3 文本 ≥ 4.5:1 / 大文本 ≥ 3:1）。axe-core color-contrast 规则自动检测可覆盖（AC-A11y-9）。

### 2.8 R22 Advisory #1（TS baseUrl 弃用）现状

R22 retro §2 Advisory #1（file:///workspace/mvp/docs/retro/round22-retro.md §2）：根 `tsconfig.json` L16 `"baseUrl": "."` 在沙箱 TS 5.9.3 下报 `error TS5101: Option 'baseUrl' is deprecated`，**既有/环境性 TS 配置问题，非 R22 引入**（tsconfig + TS 版本均未被 R22 改动）。R23 不引入此问题（R23 不改 tsconfig），留 R25 项目维护轮处理（§5 声明）。

## 3 · BLOCKING Q&A（3 项，BA 推荐待用户拍板）

### Q1 · 可访问性范围？【BLOCKING】

**影响**：R23 范围 / 测试成本 / CI 可重复性 / 工作量。

**背景**：R22 retro §6 候选清单第 1 项原文"可访问性深化（screen reader 端到端测试 + 键盘导航 + 色彩对比 WCAG AA）"含三项，但 screen reader 端到端测试需要 NVDA/JAWS/VoiceOver 等真实屏幕阅读器，CI 环境无法运行，人工核验成本高且不可重复。

**方案**：
- ①三项全做（screen reader 端到端测试 + 键盘导航 + WCAG AA 色彩对比）：screen reader 须人工核验或集成 NVDA/VoiceOver CLI（CI 不可靠），键盘导航 + WCAG AA 走 axe-core 自动检测。
- ②只做键盘导航 + WCAG AA 色彩对比（screen reader 留 future）：axe-core 自动检测 WCAG 违规（含 color-contrast）+ 8 页键盘导航 Tab 顺序 + 焦点可见 + modal focus trap/ESC/restore。
- ③只做 axe-core WCAG AA 自动检测 + 键盘导航（screen reader 测试成本高留 future）：与②实质等价，但明确"WCAG AA 自动检测"覆盖范围（axe-core 自动可检测 30-50% 规则，非全 WCAG AA 人工核验）。

**BA 推荐：③只做 axe-core WCAG AA 自动检测 + 键盘导航（screen reader 端到端人工核验留 future）**。理由：
1. screen reader 端到端测试需要 NVDA/JAWS/VoiceOver 等真实屏幕阅读器环境，CI（vitest+jsdom + Playwright chromium headless）无法运行真实屏幕阅读器，人工核验成本极高且不可重复（违背 AI-007 端到端验收可重复原则）。
2. axe-core 是 W3C ARIA 标准的自动检测工具，覆盖 WCAG 2.1 Level A/AA 的 30-50% 自动可检测规则（含 color-contrast / aria-required-attr / aria-roles / taborder / region 等），可重复执行（vitest 单测 + E2E 双轨）。
3. 键盘导航覆盖 WCAG 2.1.1（键盘可访问）+ 2.1.2（无键盘陷阱，modal ESC 退出）+ 2.4.3（焦点顺序）+ 2.4.7（焦点可见）四项强制要求，是用户最直接可感知的可访问性改进。
4. ①screen reader 端到端人工核验留 R26+ future（需独立测试环境 + 人工核验流程，非业务轮范围）。
5. ②与③实质等价（都走 axe-core 自动检测），但③明确"自动检测"范围避免 PRD 字面"WCAG AA"被误解为"全 WCAG AA 人工核验"。
**阻塞下游**：Tech-Spec 测试策略（jest-axe vitest 单测 + @axe-core/playwright E2E 双轨）+ AC 范围（AC-A11y-1~11 共 11 条，不含 screen reader 人工核验）。

### Q2 · screen reader 测试工具？【BLOCKING】

**影响**：依赖新增 / S-23 触发场景 / 测试集成方式。

**背景**：Q1 推荐③排除 screen reader 人工核验后，仍需选 axe-core 集成方式（vitest 单测 / E2E / 双轨）。S-23（R21 固化）要求 Tech Lead 在 spec 阶段预先核验版本 + API。

**方案**：
- ①jest-axe（vitest 单测集成）+ @axe-core/playwright（E2E 集成）双轨：jest-axe 在 vitest web project 集成 axe-core 扫描组件级 violations，@axe-core/playwright 在 E2E 集成页面级扫描，双轨覆盖（组件级 + 页面级）。
- ②仅 @axe-core/playwright（E2E 集成）：单轨 E2E 页面级 axe 扫描，不引入 jest-axe。
- ③仅 axe-core 静态规则检测（vitest 手动集成，不引入 jest-axe）：直接 `import { axe } from 'axe-core'` 手动调用，无 matcher 集成。
- ④不做 axe 自动检测（仅人工核验）：违背 Q1 推荐③，排除。

**BA 推荐：①jest-axe + @axe-core/playwright 双轨**。理由：
1. jest-axe 在 vitest web project 集成（参照 R20 S-5 模式扩展 setup.ts），与既有 1263 测试体系融合，新增组件级 axe 扫描覆盖 8 页关键组件（CreateUserModal / SetParentModal / RoleForm / UserListPage / RoleListPage / LoginPage / AuditLogPage / ReportPage），快速反馈（CI 单测阶段）。
2. @axe-core/playwright 在 E2E 集成（参照 R20 D2 webServer 双进程模式），页面级 axe 扫描覆盖 8 页关键流（login → users → roles → transfer → 登出等 14 既有 E2E 增 axe 扫描断言），真实浏览器渲染（非 jsdom）覆盖 jsdom 无法检测的渲染时 violation。
3. 双轨互补：jest-axe 覆盖组件级 + 快速反馈（vitest 阶段），@axe-core/playwright 覆盖页面级 + 真实浏览器（E2E 阶段），jsdom 局限（无 layout/paint）由 Playwright chromium 补齐。
4. ②仅 E2E 单轨：单测阶段无 axe 反馈，组件级 violation 须等 E2E 阶段发现，反馈慢。
5. ③手动集成 axe-core：无 `toHaveNoViolations()` matcher，断言写法冗长（手动对比 violations 数组），违背测试可读性。
6. S-23 触发：jest-axe 5.x + @axe-core/playwright 4.x 是 R23 新引入第三方库，Tech Lead 须在 spec 阶段按 S-23 提示词预先核验 npm registry dist-tags + 版本元数据 + API（参照 R22 react-window@1.8.11 模式），§6 预判替代方案（若 jest-axe 5.x 与 vitest 1.6.1 不兼容退回手动 axe-core / 若 @axe-core/playwright 4.x 与 Playwright 1.61 不兼容退回 page.accessibility.snapshot()）。
**阻塞下游**：Tech-Spec 依赖新增（jest-axe devDep + @axe-core/playwright devDep）+ §6 S-23 版本核验预判（jest-axe + @axe-core/playwright API + 替代方案）。

### Q3 · 键盘导航范围？【BLOCKING】

**影响**：R23 键盘导航 AC 范围 / react-window 协同 / 工作量。

**背景**：Q1 推荐③含键盘导航，但范围待定（仅列表页 / 全页面 / 仅 modal 三档）。react-window 虚拟列表（R22 D2）键盘导航复杂度高（须实现方向键滚动 + 焦点记忆 + 焦点恢复 + 焦点恢复后滚动到可视区），且仅行数 > 50 才启用（非核心场景）。

**方案**：
- ①全页面 8 页所有交互 + modal focus trap/ESC/restore + 虚拟列表键盘导航：覆盖 8 页所有交互（按钮/select/input/链接）Tab 顺序 + 焦点可见 + 7-9 个 modal focus trap/ESC/restore + react-window FixedSizeList 方向键导航 + 焦点记忆。
- ②全页面 8 页所有交互 + modal focus trap/ESC/restore（不含虚拟列表键盘导航）：与①区别在不实现 react-window 行方向键导航，仅确保行内按钮 Tab 可达 + 焦点可见。
- ③仅 modal focus trap/ESC/restore：仅闭合 modal 缺口（role="dialog" + aria-modal + ESC + focus trap + focus restore），8 页非 modal 交互 Tab 顺序留 future。
- ④仅列表页行操作（UserListPage / RoleListPage 行按钮 Tab 可达）：范围最窄。

**BA 推荐：②全页面 8 页所有交互 + modal focus trap/ESC/restore（不含虚拟列表键盘导航）**。理由：
1. modal 缺口是最严重的可访问性违规（WCAG 2.1.2 No Keyboard Trap 强制要求 + 2.4.3 Focus Order）：7-9 个 modal 中 6-8 个缺 role="dialog" + aria-modal + ESC + focus trap + focus restore，screen reader 无法识别为弹窗 + 键盘用户无法 ESC 退出 + 焦点逃逸到背景 DOM，是 R23 必闭合的核心缺口。
2. 8 页所有交互 Tab 顺序 + 焦点可见覆盖 WCAG 2.1.1（键盘可访问）+ 2.4.3（焦点顺序）+ 2.4.7（焦点可见）三项强制要求，是用户最直接可感知的改进，且工作量可控（核验无 tabindex > 0 跳序 + 无全局 `*:focus { outline: none }` 去除）。
3. ①虚拟列表键盘导航复杂度高：react-window 1.x FixedSizeList 默认无键盘导航，须自定义 `outerRef` + `scrollTo` + 方向键事件 + 焦点记忆 + 焦点恢复后 `scrollToItem` 滚动到可视区，且仅行数 > 50 启用（非核心场景，行数 ≤ 50 走普通 `<table>` Tab 顺序天然覆盖）。
4. ④仅列表页范围过窄，无法闭合 modal 缺口（最严重违规）。
5. ③仅 modal 范围适中但未覆盖 8 页非 modal 交互 Tab 顺序 + 焦点可见（WCAG 2.1.1/2.4.3/2.4.7 三项强制要求未闭合）。
6. ②虚拟列表键盘导航留 R24+ future（§5 声明），R23 确保行内按钮 Tab 可达 + 焦点可见（不实现方向键导航）。
**阻塞下游**：Tech-Spec 键盘导航 AC 范围（AC-A11y-1~6 modal + Tab 顺序 + 焦点可见）+ react-window 协同声明（虚拟列表键盘导航留 future，R23 仅确保行内按钮 Tab 可达）。

## 4 · 验收标准（Given/When/Then）

> 全部 AC 须可通过 vitest 单测（jest-axe 扫描）+ 既有 E2E（@axe-core/playwright 扫描 + 键盘交互断言）+ git diff 核验。AC 编号 A11y=Accessibility。R22 性能加固成果（react-window / React.lazy / React.memo）协同不破坏。

### 4.1 modal 焦点陷阱 + ESC + restore（AC-A11y-1~4）

- **AC-A11y-1 · modal role="dialog" + aria-modal="true" + aria-label 补齐**：GIVEN 7-9 个 modal 形态组件（CreateUserModal / SetParentModal / UserRolesPanel / EffectivePermissionsPanel / InheritanceChainPanel / RoleForm / NotificationForm / TransferForm / DeptForm 中 impl 阶段核验属 modal 形态的组件）/ WHEN 渲染 modal / THEN 根元素含 `role="dialog"` + `aria-modal="true"` + `aria-label`（域特定，D18 约束，不重命名既有 aria-label，新增 modal 沿用域特定命名如"设置父角色"/"创建用户"/"角色分配"等）。
- **AC-A11y-2 · modal ESC 关闭**：GIVEN modal 打开 + 焦点在 modal 内 / WHEN 用户按 ESC 键（onKeyDown Escape）/ THEN 调 `onClose()` 关闭 modal（submitting 状态下 ESC 不关闭避免误操作，对齐既有 onClose 按钮的 `disabled={submitting}` 行为）。
- **AC-A11y-3 · modal focus trap**：GIVEN modal 打开 + 焦点在 modal 内 / WHEN 用户按 Tab / Shift+Tab / THEN 焦点在 modal 内可聚焦元素间循环（不逃逸到背景 DOM，WCAG 2.1.2 No Keyboard Trap 强制要求 + 2.4.3 Focus Order）；首个可聚焦元素 Tab 到末元素后回到首元素，Shift+Tab 在首元素回到末元素。
- **AC-A11y-4 · modal focus restore**：GIVEN 用户点击触发按钮打开 modal / WHEN modal 关闭（ESC / onClose 按钮 / 提交成功）/ THEN 焦点恢复到触发按钮（非 `<body>`，WCAG 2.4.3 Focus Order 强制要求，键盘用户保持上下文）。

### 4.2 8 页键盘导航（AC-A11y-5~6）

- **AC-A11y-5 · 8 页 Tab 顺序正确**：GIVEN 8 页（LoginPage / UserListPage / RoleListPage / TransferPage / AuditLogPage / DeptTreePage / ReportPage / NotificationListPage）所有交互元素（按钮/select/input/链接）/ WHEN 用户按 Tab 遍历 / THEN Tab 顺序符合 DOM 顺序（无 `tabIndex > 0` 跳序，无 `tabIndex={-1}` 误去除可聚焦元素，react-window 行内按钮 Tab 可达）。
- **AC-A11y-6 · 8 页焦点可见**：GIVEN 8 页所有交互元素 / WHEN 元素获得焦点（Tab 或点击）/ THEN 焦点可见（outline 保留，无全局 `*:focus { outline: none }` 去除；若有 CSS 自定义 outline 须满足 WCAG 2.4.7 Focus Visible 焦点指示器对比度 ≥ 3:1）。

### 4.3 axe-core 自动 WCAG AA 检测（AC-A11y-7~9）

- **AC-A11y-7 · jest-axe vitest 单测集成 + 关键组件 0 violations**：GIVEN jest-axe 在 vitest web project 集成（setup.ts 增 `import 'jest-axe/vitest'` 或等价 API，S-23 核验具体形式）/ WHEN 对 8 页关键组件（CreateUserModal / SetParentModal / RoleForm / UserListPage / RoleListPage / LoginPage / AuditLogPage / ReportPage）做 axe 扫描 / THEN 0 violations（WCAG 2.1 Level A/AA 自动可检测规则全部通过，含 color-contrast / aria-required-attr / aria-roles / taborder / region 等）。
- **AC-A11y-8 · @axe-core/playwright E2E 集成 + 关键流 0 violations**：GIVEN @axe-core/playwright 在 E2E 集成 / WHEN 对 8 页关键流（login → users 列表 → roles 列表 → transfer → 登出等 14 既有 E2E + 新增 axe 扫描断言）做 axe 扫描 / THEN 0 violations（页面级真实浏览器渲染，覆盖 jsdom 无法检测的渲染时 violation）。
- **AC-A11y-9 · WCAG AA 色彩对比核验**：GIVEN 8 页 CSS 文件（apps/web/src 全量 CSS / 既有 index.css 或 App.css 由 impl 阶段 Read 核验）/ WHEN axe-core color-contrast 规则扫描 / THEN 文本对比度 ≥ 4.5:1（WCAG 2.1 AA 1.4.3 文本对比度，正常文本）+ 大文本（≥ 18pt 或 ≥ 14pt bold）≥ 3:1 + 非文本 UI 组件 ≥ 3:1（WCAG 2.1 AA 1.4.11）。

### 4.4 既有测试全绿（AC-A11y-10~11）

- **AC-A11y-10 · 既有 1263 vitest 测试全绿**：GIVEN 可访问性深化改动 / WHEN 运行 `npm test` / THEN 既有 1263 测试全部通过（无回归，可访问性深化不破坏既有功能；新增 jest-axe 测试不计入既有 1263）+ 新增 jest-axe 测试全绿。
- **AC-A11y-11 · 既有 14 E2E 测试全绿**：GIVEN 可访问性深化改动 / WHEN 运行 `npm run test:e2e` / THEN 既有 14 E2E 测试全部通过（核心流不受可访问性深化影响）+ 新增 @axe-core/playwright axe 扫描断言全绿。

## 5 · Out of scope（范围外）

- **screen reader 端到端人工核验** —— Q1 推荐③决策，留 R26+ future（需 NVDA/JAWS/VoiceOver 真实屏幕阅读器环境 + 人工核验流程，CI 不可重复，非业务轮范围）。
- **react-window 虚拟列表键盘导航** —— Q3 推荐②决策，留 R24+ future（react-window 1.x FixedSizeList 默认无键盘导航，须自定义 outerRef + scrollTo + 方向键事件 + 焦点记忆 + 焦点恢复后 scrollToItem，复杂度高 + 仅行数 > 50 启用非核心场景；R23 仅确保行内按钮 Tab 可达 + 焦点可见）。
- **R22 Advisory #1 TS baseUrl 弃用** —— R22 retro §2 Advisory #1 既有/环境性 TS 配置问题（非 R22 引入，非 R23 引入），留 R25 项目维护轮处理（方案 A 加 `ignoreDeprecations: "5.0"` / 方案 B 迁移 paths / 方案 C 固定 TS 版本，R22 retro §2 已详述）。
- **跨浏览器 E2E 覆盖（firefox/webkit）** —— R22 retro §6 候选清单第 2 项（R24 候选），R23 仅 chromium 单浏览器 axe 扫描。
- **WCAG AAA 级合规** —— R23 仅覆盖 WCAG 2.1 Level A/AA 自动可检测规则（axe-core 30-50% 覆盖），WCAG AAA + 人工核验剩余规则留 future。
- **移动端可访问性（触摸目标尺寸 / 响应式 ARIA）** —— 管理后台 MVP 仅桌面端，不做移动视口可访问性（与 R22 §5 out of scope 一致）。
- **contracts 改动** —— R23 零 contracts 变更（与 R22 一致，可访问性是前端层改进）。
- **新规则 / check-rules.mjs 改动** —— R23 无规则改动（可访问性规则不在 .trae/rules/ 范围，属前端实现层改进）。
- **国际化的 aria-label 调整** —— R23 不重命名既有 aria-label 域特定命名（D18/R16/R21 约束 55 处保持），仅新增 modal aria-label 沿用域特定命名模式。
- **真实屏幕阅读器自动化测试（Narrator/VoiceOver CLI）** —— CI 不可靠，留 future。

## 6 · 风险预判

### 6.1 react-window 虚拟列表与键盘导航协同风险

**风险**：R23 在 UserListPage / RoleListPage 行内按钮（UserRow"禁用/角色/权限" + RoleRow"删除/设置父角色/解除父角色/查看继承链"）Tab 可达性核验时，react-window FixedSizeList 的绝对定位 + overscanCount=5 可能使 Tab 顺序异常（行不在可视区时按钮仍 Tab 可达但不可见，WCAG 2.4.7 Focus Visible 违规）。

**预判**：impl 阶段须核验 react-window FixedSizeList 渲染的行（行数 > 50 场景）Tab 顺序：
- 若行数 ≤ 50 走普通 `<table><tr><td>`（R22 D5 回退路径），Tab 顺序天然正确。
- 若行数 > 50 走 FixedSizeList，绝对定位行仍在 DOM（react-window 仅渲染可视区 + overscan，非可视区行不渲染 → Tab 不可达，符合预期）。
- 风险点：overscanCount=5 边界行的 Tab 可达性 + 可见性核验，impl 阶段须 E2E 验证（新增 axe 扫描 + Tab 顺序测试覆盖行数 > 50 场景，参照 R22 AC-P9 既有测试不破坏原则）。

**§10 替代方案**（若 FixedSizeList Tab 顺序异常）：①降低 VIRTUAL_LIST_THRESHOLD 阈值（如 50 → 100，减少虚拟列表触发场景）；②回退普通 `<table>` 渲染（牺牲 R22 性能加固成果，违背 R22 D5 advisory）；③实现虚拟列表键盘导航（超出 Q3 推荐②范围，违背 out of scope 声明）。

### 6.2 axe-core 集成引入新依赖风险（S-23 第二次触发）

**风险**：jest-axe 5.x 与 vitest 1.6.1 集成可能不兼容（参照 R20 S-5 jest-dom 6.x + vitest projects 兼容性坑），@axe-core/playwright 4.x 与 Playwright 1.61 可能 API 差异（AxeBuilder 形式变化）。

**预判**：S-23（R21 固化）在 R23 第二次触发验证，Tech Lead 须在 spec 阶段预先核验：
- jest-axe npm latest dist-tag + 1.x/2.x/5.x 兼容性 + vitest 1.6.1 setupFiles 集成 API（`import 'jest-axe/vitest'` vs `import { axe } from 'vitest-axe'`）
- @axe-core/playwright npm latest dist-tag + 4.x API（`AxeBuilder` 形式）+ Playwright 1.61 兼容性
- axe-core 规则集（WCAG 2.1 Level A/AA 自动可检测规则范围，color-contrast / aria-required-attr / aria-roles / taborder / region 等）

**§10 替代方案**（若 jest-axe 与 vitest 1.6.1 不兼容）：①退回直接 `import { axe } from 'axe-core'` 手动集成（无 matcher，断言写法冗长但功能等价）；②升级 vitest 到 2.x（引入 test.projects，违背 R20 S-5 既有 workspace 模式，跨轮 advisory 范围）；③仅用 @axe-core/playwright E2E 单轨（放弃单测阶段 axe 反馈）。

**§10 替代方案**（若 @axe-core/playwright 与 Playwright 1.61 不兼容）：①退回 Playwright 自己的 `page.accessibility.snapshot()` API（覆盖度低，仅 ARIA tree 非完整 WCAG）；②升级 Playwright（跨轮 advisory）；③仅用 jest-axe vitest 单测（放弃页面级真实浏览器扫描）。

### 6.3 modal focus trap 实现复杂度风险

**风险**：7-9 个 modal 形态组件统一补齐 focus trap / ESC / focus restore 可能引入共享 hook（如 `useFocusTrap` / `useFocusRestore`），新增抽象层。R23 在引入共享 hook 时须考虑：
- 共享 hook 跨 modal 复用边界（参照 R16 S-19 简单常量复用边界，≤3 处可重复定义，≥4 处提取共享）。
- React.memo 协同（R22 D1 UserRow / RoleRow memo 包裹）：modal state 变化不应触发列表行 re-render，hook 须 useCallback 稳定引用（参照 R22 D3 模式）。
- focus trap 与 react-window 协同：modal 打开时背景 react-window 行应不可 Tab 到达（focus trap 限制在 modal 内），实现须确保 trap 范围正确。

**预判**：impl 阶段若引入共享 `useFocusTrap` hook，须在 Tech-Spec §10 标注 [约束] / [advisory] 偏离可能性 + 反向同步闭环性（R18 S-21）。若 ≤3 处 modal 可重复定义 focus trap 逻辑（R16 S-19），若 ≥4 处须提取共享（impl-writer 据 modal 数量实际决定）。

### 6.4 既有 aria-label 域特定命名不破坏风险

**风险**：R23 新增 modal aria-label 时可能与既有 aria-label 域特定命名冲突（如新增 SetParentModal aria-label="设置父角色" 与 SetParentModal select aria-label="父角色" 同含"父角色"导致 findByLabelText 多匹配，R16 S-19 已踩坑）。

**预判**：R23 新增 modal aria-label 须沿用 D18/R16/R21 域特定命名模式 + R15 S-14 跨组件唯一约束（aria-label 不与既有 55 处 aria-label 冲突）。具体命名由 impl 阶段决定，BA 推荐：
- CreateUserModal aria-label="创建用户"（既有，不破坏）
- SetParentModal aria-label="继承设置"（与 select aria-label="父角色" 消歧，参照 SetParentModal.tsx:125 既有 `<h2>继承设置</h2>` 文案）
- 其他 modal aria-label 由 impl 阶段据域特定命名 + 跨组件唯一原则决定。

### 6.5 既有测试不破坏风险（R22 1263 + E2E 14）

**风险**：R23 在 modal 补 role="dialog" + aria-modal + focus trap / ESC / restore 时可能改变既有 DOM 结构（如新增 `<div role="dialog">` 包裹层），破坏既有 1263 vitest 测试的 `getByRole` / `getByLabelText` 断言。

**预判**：
- 既有 1263 vitest 测试 + 14 E2E 测试须全绿（AC-A11y-10/11）。
- impl 阶段须按 R16 S-17 自报准确性原则通过 `git diff HEAD --stat -- apps/web/test/` 实跑核对自报改动范围，若需改既有测试 setup 须显式列出理由（参照 R20 S-5 模式）。
- 若 modal role="dialog" 包裹层破坏既有 `getByRole('button', { name: ... })` 断言（DOM 层级变化），impl 阶段须反向同步 Tech-Spec §10 标注 [advisory] 偏离（参照 R12 S-2 advisory 反向同步边界）。

## G1 自检声明

- **PRD 完整性**：章节齐全（背景与目标 / 既有可访问性现状盘点 / BLOCKING Q&A / AC 列表 / 范围外 / 风险预判）+ frontmatter（id/status=draft/Q&A 摘要）+ Out of scope。
- **验收标准可测**：11 条 AC（AC-A11y-1~4 modal focus trap/ESC/restore 4 条 + AC-A11y-5~6 8 页键盘导航 2 条 + AC-A11y-7~9 axe-core 自动检测 3 条 + AC-A11y-10~11 既有测试全绿 2 条），每条 Given/When/Then 可被 vitest 单测（jest-axe）/ E2E（@axe-core/playwright + 键盘交互）/ git diff 验证。
- **BLOCKING 项待拍板**：Q1-Q3 全部待用户拍板（status=draft 前提），每个 Q 给出 BA 推荐方案（Q1=③ / Q2=① / Q3=②）+ 理由 + 阻塞下游。
- **既有现状核验**：grep `aria-label` 在 apps/web/src 55 处匹配覆盖 14 文件（§2.1 详述）；grep `role=` 19 处匹配（14 处 role="alert" + 1 处 role="dialog" + 4 处变量名 role=）；grep `tabIndex|onKeyDown|onKeyPress` 零匹配（§2.3 详述，最大缺口）；Read playwright.config.ts（根目录）+ _helpers.ts + setup.ts + vitest.workspace.ts + App.tsx + UserRow + RoleRow + CreateUserModal + SetParentModal + UserListPage 虚拟列表段；grep `keyboard|press|tab\(|focus|aria|accessibility|axe` 在 apps/e2e/tests 4 处注释无实际断言；Read apps/web/package.json 确认无 axe-core / jest-axe / @axe-core/playwright 依赖；grep server.ts seedDemoData 确认 admin@example.com/admin123 seed（R23 不涉及凭据字段，S-23 衍生要求确认）。
- **边界遵守**：未预定义 jest-axe / @axe-core/playwright API 字段细节（ARCH-002 同源，属 Tech Lead + S-23 核验）；未写实现代码；AC 描述"验收什么"不描述"怎么实现"。
- **Out of scope 明确**：screen reader 端到端人工核验 / react-window 虚拟列表键盘导航 / R22 Advisory #1 TS baseUrl 弃用 / 跨浏览器 E2E / WCAG AAA / 移动端可访问性 / contracts 改动 / 新规则改动 / 国际化 aria-label 调整 / 真实屏幕阅读器自动化测试 均列为 out of scope。
- **既有测试不破坏约束**：AC-A11y-10/11 明确既有 1263 vitest + 14 E2E 全绿无回归（R22 性能加固成果协同，react-window / React.lazy / React.memo 不破坏）。
