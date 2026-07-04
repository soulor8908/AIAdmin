---
doc_type: Retrospective
id: RETRO-ROUND23-001
scope: 第二十三轮演练（业务轮 #16：可访问性深化 modal focus trap/ESC/restore + Tab 顺序 + 焦点可见 + axe-core WCAG AA 双轨自动检测，前端单层变更 + apps/e2e axe 扫描，无后端/contracts 改动）
date: 2026-07-04
verdict: 跑通；11 AC 全对齐（AC-A11y-1~11）；三件套全绿（typecheck exit 0 / lint:rules exit 0 / vitest 58 files 1272 tests / E2E 22 passed 19.3s）；4 项 advisory 偏离反向同步闭合（§7.1 D7 焦点颜色 + §7.2 D2 @types/jest-axe 版本 + §7.3 D9 spec 策略 + §7.4 D4 form-based modal DOM 结构调整）；R21 固化的 S-23 第二次触发验证生效（jest-axe@10.0.0 + @axe-core/playwright@4.12.1 版本核验 + §3.2/§3.3 + §10.6 反向同步标注）；R22 React.memo/useCallback/react-window 协同保持；0 新立 S 级（§7.4 暴露的 §10.4 预判盲区属 ARIA 规范一次性知识缺口，非跨轮系统性模式）
---

# 第二十三轮演练复盘 · 业务轮 #16 · 可访问性深化 + S-23 第二次触发验证 + R22 协同保持

> 本轮承接 R22 retro §6 候选清单第 1 项——可访问性深化（modal focus trap/ESC/restore + Tab 顺序 + 焦点可见 + axe-core WCAG AA 自动检测双轨）。本轮为业务轮（走五角色流程 BA→Tech Lead→test-writer→impl-writer→Reviewer + 七道门禁 G1/G3/G3.5/G4/G5/G6/G6.1/G7），承接 R22 前端性能加固成果（React.memo + useCallback + react-window 1.x + React.lazy 8 页 + Suspense），同时是 **R21 固化的 S-23（Tech Lead 第三方库版本 API 核验缺口）的第二次触发验证业务轮**——Tech Lead 在 spec 阶段预先核验 jest-axe + @axe-core/playwright npm registry dist-tags + 实测安装验证 + §3.2/§3.3 + §10.6 反向同步标注。

## 0 · 本轮目标与结果

1. **可访问性深化** → ✅ 全部落地（D1-D10 决策 + AC-A11y-1~11 11 条 AC）：
   - D1 + AC-A11y-3/4：自定义 useFocusTrap hook（focus trap Tab/Shift+Tab 循环 + 初次 focus 第一个可聚焦元素 + focus restore 回触发按钮，不引入 react-focus-lock）
   - D2 + AC-A11y-7：jest-axe@10.0.0 + @types/jest-axe@3.5.9（apps/web devDeps）+ setup.ts 显式 expect.extend(toHaveNoViolations)
   - D3 + AC-A11y-8/9：@axe-core/playwright@4.12.1（根 devDeps）+ 每 test 显式 AxeBuilder.withTags(['wcag2a','wcag2aa']).analyze()
   - D4 + AC-A11y-1：8 个 modal 形态组件统一改造（role="dialog" + aria-modal={true} + aria-label 域特定命名，D18/R16/R21 约束保持）
   - D5 + AC-A11y-2：ESC 关闭（useFocusTrap hook 内 onKeyDown 监听，submitting 阻止）
   - D6 + AC-A11y-4：focus restore（useRef 记录 document.activeElement + cleanup focus 回触发按钮）
   - D7 + AC-A11y-6：:focus-visible 全局 CSS（#2563eb 蓝色，对比度 ≥ 3:1，WCAG 2.4.7 强制）
   - D8 + AC-A11y-7：jest-axe vitest 集成（setup.ts 显式 expect.extend，无 /vitest 子路径）
   - D9 + AC-A11y-8：@axe-core/playwright E2E 集成（每 test 显式 AxeBuilder.withTags）
   - D10 + AC-A11y-9：WCAG AA 色彩对比核验（@axe-core/playwright 独占，jest-axe jsdom 不支持 color-contrast）
   - D7 + AC-A11y-5：8 页 Tab 顺序正确（DOM 顺序合理，无 tabindex 正值干预）
   - AC-A11y-10/11：既有 1263 vitest + 14 E2E 全绿无回归（实际 1272 vitest = 1263 + 9 新增 jest-axe，22 E2E = 14 + 8 新增 @axe-core/playwright）
2. **R21 固化的 S-23 第二次触发验证生效** → ✅ 验证通过：
   - Tech Lead 按 S-23 提示词在 spec 阶段预先核验 jest-axe + @axe-core/playwright npm registry dist-tags + 版本元数据 + 实测安装验证
   - 5 项核验结论完整：
     1. jest-axe latest=10.0.0（非 PRD 假设 5.x，Tech Lead 修正）
     2. jest-axe 无 peerDeps（vitest 1.6.1 兼容）
     3. jest-axe 无 /vitest 子路径入口（PRD §2.5 假设错误，修正为显式 expect.extend）
     4. jest-axe jsdom 不支持 color-contrast（AC-A11y-9 须 @axe-core/playwright 独占覆盖）
     5. @axe-core/playwright latest=4.12.1 + peerDeps playwright-core>=1.0.0（与 1.61.1 兼容）+ API AxeBuilder 核验确认 + 自带 types
   - 实测安装验证：`npm --workspace @admin/web install --save-dev jest-axe@10.0.0 @types/jest-axe@3.5.9` + `npm install --save-dev @axe-core/playwright@4.12.1` + `npm run typecheck` exit 0
   - §3.2 D2 + §3.3 D3 完整记录 5 项核验结论 + §10.6 标注"S-23 第二次触发验证生效" + §10.7 替代方案预判（jest-axe/@axe-core/playwright 不兼容退回方案 + 无 /vitest 子路径修正）
   - 实装 package.json L? `jest-axe: ^10.0.0` + `@types/jest-axe: ^3.5.9` + `@axe-core/playwright: ^4.12.1` 与 spec D2/D3 一致
   - **这正是 S-23 固化机制要防护的场景**——PRD BA 假设 jest-axe 5.x + /vitest 子路径入口，Tech Lead 在 spec 阶段核验发现实际 latest=10.0.0 + 无 /vitest 子路径，预先修正避免 impl 阶段才发现
3. **R22 React.memo/useCallback/react-window 协同保持** → ✅ 验证通过：
   - R22 D1 React.memo 包裹 UserRow/RoleRow 保留（R23 useFocusTrap 不破坏 memo 包裹）
   - R22 D3 useCallback 稳定引用保留（R23 useFocusTrap ref 缓存模式与 R22 D3 协同）
   - R22 D2 react-window FixedSizeList 阈值 50 行保留（R23 不改虚拟列表，键盘导航留 R24+ future）
   - R22 D6 React.lazy 8 页保留（R23 不改 App.tsx lazy 结构）
   - R22 D7 Suspense fallback 保留
   - 既有 1263 vitest 全绿无回归证明 R22 协同保持
4. **G6 Reviewer 验收**：verdict=pass，11/11 AC 对齐，4 项 advisory 反向同步闭合，0 Blocker + 3 项非 BLOCKING advisory（form 包裹后缩进 cosmetic / NotificationForm 仅测 create 模式 / region 组件级禁用分工合理）

**结果速览**：typecheck ✅ exit 0 / lint:rules ✅ exit 0（META-003/META-004 双向绑定持续闭合）/ vitest ✅ 58 files 1272 tests passed（83.60s，`|web|` project 前缀证明 workspace 模式生效）/ E2E ✅ 22 passed 19.3s（含 8 新增 @axe-core/playwright a11y + 14 既有零回归）/ 改动文件 13 改 + 6 新增 / 11 AC 全对齐 / 4 项 advisory 反向同步闭合 / S-23 第二次触发验证生效 / R22 协同保持 / 0 新立 S 级。

## 1 · 本轮核心验证结论

### 1.1 可访问性深化 D1-D10 全部落地（AC-A11y-1~11 11 条）

R22 retro §6 候选清单第 1 项「可访问性深化」在 R23 全部落地，覆盖 4 类可访问性模式：

| 可访问性模式 | 决策 | AC | 落地位置 | 判定 |
|---|---|---|---|---|
| modal role/aria-modal/aria-label | D4 | AC-A11y-1 | 8 个 modal 形态组件（CreateUserModal / SetParentModal / RoleForm / UserRolesPanel / EffectivePermissionsPanel / InheritanceChainPanel / DeptForm / NotificationForm） | ✅ |
| ESC 关闭（submitting 阻止） | D5 | AC-A11y-2 | useFocusTrap hook 内 onKeyDown 监听 | ✅ |
| focus trap（Tab/Shift+Tab 循环 + 初次 focus） | D1 | AC-A11y-3 | useFocusTrap hook + 8 modal 引用 | ✅ |
| focus restore（关闭后回触发按钮） | D6 | AC-A11y-4 | useFocusTrap hook useRef 记录 document.activeElement + cleanup | ✅ |
| Tab 顺序正确 | D7 | AC-A11y-5 | 8 页 DOM 顺序合理（无 tabindex 正值） | ✅ |
| 焦点可见（:focus-visible） | D7 | AC-A11y-6 | apps/web/src/index.css `:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }` | ✅ |
| jest-axe vitest 0 violations | D2/D8 | AC-A11y-7 | apps/web/test/setup.ts expect.extend(toHaveNoViolations) + apps/web/test/a11y.test.tsx 9 用例 | ✅ |
| @axe-core/playwright E2E 0 violations | D3/D9 | AC-A11y-8 | apps/e2e/tests/a11y.spec.ts 8 用例 AxeBuilder.withTags(['wcag2a','wcag2aa']).analyze() | ✅ |
| WCAG AA 色彩对比核验 | D10 | AC-A11y-9 | @axe-core/playwright 独占（jest-axe jsdom 不支持 color-contrast） | ✅ |
| 既有 vitest 全绿无回归 | - | AC-A11y-10 | 1263 既有 + 9 新增 = 1272 全绿 | ✅ |
| 既有 E2E 全绿无回归 | - | AC-A11y-11 | 14 既有 + 8 新增 = 22 全绿 | ✅ |

**关键设计落地**：
- **自定义 useFocusTrap hook**（D1）：不引入 react-focus-lock 避免 S-23 第三次触发（react-focus-lock 版本核验成本）。hook 接受 ref + 选项（onEscape / active / ignoreWhenSubmitting），实现 Tab/Shift+Tab 循环 + 初次 focus 第一个可聚焦元素 + ESC 触发 onEscape（submitting 阻止）+ focus restore（useEffect cleanup focus 回 document.activeElement）。React.StrictMode 双调用 effect 幂等 + React.memo 协同（useCallback 稳定引用，R22 D3 模式）。
- **8 modal 形态组件统一改造**（D4）：4 个 div-based modal（CreateUserModal / UserRolesPanel / EffectivePermissionsPanel / InheritanceChainPanel）直接加 role="dialog" + aria-modal + aria-label + useFocusTrap；4 个 form-based modal（SetParentModal / RoleForm / DeptForm / NotificationForm）因 ARIA 1.2 不允许 `<form>` 元素使用 dialog role，改为 `<div role="dialog"><form>` 结构（§7.4 advisory 偏离反向同步标注）。
- **jest-axe + @axe-core/playwright 双轨**（D2/D3）：jest-axe 集成 vitest 做组件级单测（jsdom，9 用例覆盖 8 modal + LoginPage）+ @axe-core/playwright 集成 E2E 做页面级检测（真实浏览器，8 用例覆盖 8 页核心流）。双轨互补（组件级回归保护 + 页面级真实浏览器断言）。
- **WCAG AA 色彩对比 E2E 独占**（D10）：jest-axe jsdom 不支持 color-contrast 规则（无真实渲染），AC-A11y-9 由 @axe-core/playwright 独占覆盖。

### 1.2 R21 固化的 S-23 第二次触发验证生效

R21 retro §1.1 固化的 S-23（Tech Lead 第三方库版本 API 核验缺口）在 R23 第二次触发验证（首次 R22 react-window 1.x）：

| # | S-23 核验结论 | Tech-Spec 标注位置 | npm/源码实证 | 判定 |
|---|--------------|-------------------|--------------|------|
| 1 | jest-axe latest=10.0.0（非 PRD 假设 5.x） | §3.2 D2 + §10.6 | BA PRD 假设 jest-axe 5.x 为版本号误判；Tech Lead 核验 npm registry dist-tags 发现 latest=10.0.0 | ✅ 标注完整 |
| 2 | jest-axe 无 peerDeps（vitest 1.6.1 兼容） | §3.2 D2 + §10.6 | npm view jest-axe peerDependencies 无声明，与 vitest 1.6.1 兼容（实测 typecheck exit 0） | ✅ 标注完整 |
| 3 | jest-axe 无 /vitest 子路径入口 | §3.2 D2 + §10.6 | PRD §2.5 假设 jest-axe/vitest 子路径入口错误；Tech Lead 修正为显式 expect.extend(toHaveNoViolations)（参照 jest-dom/vitest 模式不可复用） | ✅ 标注完整 |
| 4 | jest-axe jsdom 不支持 color-contrast | §3.2 D2 + §10.6 | jest-axe 默认禁用 color-contrast 规则（jsdom 无真实渲染）；AC-A11y-9 须 @axe-core/playwright 独占覆盖 | ✅ 标注完整 |
| 5 | @axe-core/playwright latest=4.12.1 + peerDeps playwright-core>=1.0.0 | §3.3 D3 + §10.6 | npm view @axe-core/playwright dist-tags latest=4.12.1；peerDeps playwright-core>=1.0.0 与 1.61.1 兼容；API AxeBuilder 核验确认 + 自带 types | ✅ 标注完整 |

**S-23 固化机制验证结论**：
- R22 首次触发验证生效（react-window 1.8.11）+ R23 第二次触发验证生效（jest-axe 10.0.0 + @axe-core/playwright 4.12.1）→ S-23 固化机制连续两轮业务轮触发验证可复用。
- PRD BA 假设 jest-axe 5.x + /vitest 子路径入口为版本号 + API 误判，Tech Lead 按 S-23 提示词约束**在 spec 阶段预先核验** npm registry dist-tags + 版本元数据 + 实测安装验证，**在 spec 阶段**就发现并修正为 jest-axe@10.0.0 + 显式 expect.extend + @axe-core/playwright@4.12.1。
- §3.2 D2 + §3.3 D3 完整记录 5 项核验结论 + 实测安装验证证据，§10.6 标注"S-23 第二次触发验证生效"，§10.7 替代方案预判（jest-axe/@axe-core/playwright 不兼容退回方案 + 无 /vitest 子路径修正）作为退回兜底。
- **S-23 在本轮第二次触发验证生效，无须新增 S 级教训**（提示词已落，机制已连续两轮验证可复用）。

### 1.3 advisory 偏离反向同步闭合（4 项 §7.1-§7.4）

R23 共 4 项 advisory 偏离全部反向同步闭合（R18 S-21 + R19 G6.5 第二次落地第三次大规模触发）：

| advisory 偏离 | Spec 反向同步落地位置 | Reviewer 核实方式 | 判定 |
|---|---|---|---|
| §7.1 D7 :focus-visible 焦点颜色 #2563eb | Tech-Spec §7.1 | Reviewer Read Tech-Spec 确认章节已含 `[advisory] 允许 impl-writer 据设计调整`标注 | ✅ 闭合 |
| §7.2 D2 @types/jest-axe 版本略滞后（S-23 衍生） | Tech-Spec §7.2 | Reviewer Read 确认 §7.2 含 S-23 衍生标注 + skipLibCheck 兼容声明 | ✅ 闭合 |
| §7.3 D9 新增独立 a11y.spec.ts vs 既有 5 spec 增 axe 断言 | Tech-Spec §7.3 | Reviewer Read 确认 §7.3 含 `[advisory] 允许 impl-writer 据实际调整`标注 | ✅ 闭合 |
| **§7.4 D4 form-based modal DOM 结构调整（aria-allowed-role 合规修复）** | **Tech-Spec §7.4（编排者补上）** | Reviewer Read 确认 §7.4 含根因 + 修复方案 + 影响范围 + §10.4 预判盲区补全声明 + 性质 5 要素 | ✅ 闭合 |

**§7.4 反向同步标注核验**（R18 S-21 + R19 G6.5 第三次大规模触发）：
- **根因**：impl-writer 在 impl 阶段发现 Tech-Spec §3.4 D4 字面要求"4 个 form-based modal 改造前 `<form>` → 改造后 `<form role="dialog" aria-modal="true" aria-label="...">`"会触发 jest-axe `aria-allowed-role` 违规——ARIA 1.2 规范不允许 `<form>` 元素使用 `dialog` role（form 允许的 role 仅 form/search/none/presentation）。
- **修复方案**：4 个 form-based modal 改为 `<div role="dialog" aria-modal="true" aria-label="..." ref={rootRef}><form onSubmit={...}>...</form></div>` 结构（role 加到外层 div 非 form）。
- **影响范围**：4 个组件（SetParentModal / RoleForm / DeptForm / NotificationForm）+ ref 类型从 HTMLFormElement 改为 HTMLDivElement（useFocusTrap hook 签名兼容）。既有测试全绿（form onSubmit 行为不变，jest-axe 0 violations 证明 ARIA 合规）。
- **§10.4 预判盲区补全**：Tech-Spec §10.4 原预判"axe-core 0 violations 暴露既有 WCAG 违规"（既有 aria-label 55 处等），未预判"D4 改造本身引入 aria-allowed-role 违规"（form 元素不允许 dialog role）。impl-writer 在 impl 阶段发现后按 R19 S-21 固化机制实际编辑 Tech-Spec §7.4 反向同步标注（非仅代码注释声明"伪同步"）。
- **性质**：[advisory]（非 [约束] 偏离，D4 aria-label 域特定命名清单 + role="dialog" + aria-modal + aria-label 四项核心要求全部落地，仅 DOM 结构从 `<form role="dialog">` 调整为 `<div role="dialog"><form>` 实现 ARIA 合规）。

**advisory 反向同步机制验证结论**：R18 S-21 固化的"伪同步检测"机制（Reviewer 须通过 Read Tech-Spec 全文 / git diff 确认章节已改，非仅信代码注释）在 R23 第三次大规模触发并验证可复用（首次 R20 4 项 / 第二次 R22 2 项 / R23 4 项含 §7.4 编排者补上）。R21 G6.5 范式第三次落地参考在 R23 业务轮不触发（G6.5 仅适用元改进轮）。

### 1.4 R22 React.memo/useCallback/react-window 协同保持

R22 前端性能加固成果在 R23 改造后全部保持：

| R22 决策 | R22 落地 | R23 保持核验 | 判定 |
|---|---|---|---|
| D1 React.memo 包裹 UserRow/RoleRow | UserRow.tsx:52 + RoleRow.tsx:29 | R23 useFocusTrap 不破坏 memo 包裹（hook 内部 useCallback 稳定引用，与 R22 D3 协同） | ✅ 保持 |
| D3 useCallback 稳定回调引用 | UserListPage/RoleListPage 8 处 | R23 useFocusTrap ref 缓存模式与 R22 D3 useCallback 模式一致 | ✅ 保持 |
| D2 react-window FixedSizeList 阈值 50 | UserListPage/RoleListPage VIRTUAL_LIST_THRESHOLD=50 | R23 不改虚拟列表（键盘导航留 R24+ future） | ✅ 保持 |
| D4 useMemo 缓存 filteredItems/itemData | RoleListPage:197-200 | R23 不改 useMemo 缓存 | ✅ 保持 |
| D6 React.lazy 8 页 | App.tsx:10,16-23 | R23 不改 App.tsx lazy 结构 | ✅ 保持 |
| D7 Suspense fallback | App.tsx:29 | R23 不改 Suspense | ✅ 保持 |

**协同保持验证结论**：R23 useFocusTrap hook 与 R22 React.memo + useCallback + react-window 协同保持，既有 1263 vitest + 14 E2E 全绿无回归证明 R22 成果不被 R23 破坏。useFocusTrap hook 内部 useCallback 稳定引用模式与 R22 D3 useCallback 模式一致，避免 modal state 变化触发列表行 re-render（R22 D1 React.memo 包裹有效性保持）。

### 1.5 G6 Reviewer 验收

verdict=pass，关键证据：
- 三件套全绿：canonical `npm run typecheck` exit 0 + `lint:rules` exit 0（META-003/META-004 双向绑定闭合）+ vitest 58 files/1272 tests（R22 1263 → R23 1272，+9 jest-axe a11y 测试，0 回归）+ E2E 22 passed（R22 14 → R23 22，+8 @axe-core/playwright a11y 测试，0 回归）
- 11 AC 全部对齐：AC-A11y-1~11（modal role/aria-modal/aria-label + ESC + focus trap + focus restore + Tab 顺序 + :focus-visible + jest-axe vitest + @axe-core/playwright E2E + WCAG AA 色彩对比 + 既有测试无回归）
- 4 项 advisory 反向同步闭合（§7.1 D7 + §7.2 D2 + §7.3 D9 + §7.4 D4）
- S-23 第二次触发验证生效（5 项核验结论完整 + 实装版本一致）
- §7.4 反向同步标注完整（R18 S-21 + R19 G6.5 第三次大规模触发）
- R22 React.memo/useCallback/react-window 协同保持
- impl-writer 自报准确（S-17 通过）：git status 与自报清单逐项一致（13 M + 6 ??），tsconfig/contracts/apps-api-src 均未越界改动

3 项非 BLOCKING advisory（Reviewer Suggestion，非阻断）：
1. form 包裹后缩进 cosmetic（4 个 form-based modal 改 `<div role="dialog"><form>` 结构后 form 内缩进多 2 空格，cosmetic 非功能问题）
2. NotificationForm 仅测 create 模式（a11y.test.tsx 仅测 isEdit=false 创建模式，edit 模式未测）
3. region 组件级禁用分工合理（jest-axe vitest 禁用 region 规则因 jsdom 无 landmark 真实渲染，@axe-core/playwright E2E 独占覆盖）

## 2 · 本轮新发现的问题（S 级，不阻断）

本轮无新发现 S 级教训。Reviewer 不建议立新 S 级，理由：

### §7.4 暴露的 §10.4 预判盲区——是否立 S-24？

**现象**：Tech-Spec §10.4 原预判"axe-core 0 violations 暴露既有 WCAG 违规"（既有 aria-label 55 处等），未预判"D4 改造本身引入 aria-allowed-role 违规"（form 元素不允许 dialog role）。impl-writer 在 impl 阶段发现后按 R19 S-21 固化机制实际编辑 Tech-Spec §7.4 反向同步标注。

**Reviewer 不建议立 S-24 的理由**：
1. **属 ARIA 规范一次性知识缺口**：ARIA 1.2 allowed-role 规则是 W3C 规范知识（非跨轮系统性模式），Tech Lead 在 spec 阶段写 D4 时未核验 ARIA 规范是否允许 `<form>` 元素使用 dialog role，属一次性知识缺口（非流程/规则/Spec 模板层缺口）。
2. **axe 双轨自动检测按设计预期捕获违规**：jest-axe + @axe-core/playwright 双轨自动检测的设计目标就是捕获 WCAG 违规（含 aria-allowed-role），R23 改造引入的违规被 axe 自动捕获 + impl-writer 按 R19 S-21 反向同步机制闭合，机制按设计预期工作。
3. **R18 S-21 + R19 G6.5 反向同步机制已覆盖响应闭环**：impl-writer 在 impl 阶段发现 spec 字面决策与 ARIA 规范不符后，按 R19 S-21 固化机制实际编辑 Tech-Spec §7.4 反向同步标注（非仅代码注释声明"伪同步"），R18 S-21 + R19 G6.5 反向同步机制已覆盖响应闭环，无须新增 S 级教训。
4. **S 级教训体系保持精简**：S-23 已连续两轮业务轮触发验证可复用（R22 react-window + R23 jest-axe/@axe-core/playwright），S 级教训体系保持精简即可。如立 S-24"Tech Lead 须核验 ARIA 规范 allowed-role 规则"会过度细化（ARIA 规范知识缺口非跨轮系统性模式，一次性知识缺口通过 §10.4 预判 + impl 阶段 axe 自动检测 + R19 S-21 反向同步机制闭环即可）。

**判定**：不立 S-24。§7.4 暴露的 §10.4 预判盲区属 ARIA 规范一次性知识缺口，非跨轮系统性模式，R18 S-21 + R19 G6.5 反向同步机制已覆盖响应闭环。

### 3 项 Reviewer Suggestion（非阻断，建议未来轮次收尾闭合）

1. **form 包裹后缩进 cosmetic**：4 个 form-based modal 改 `<div role="dialog"><form>` 结构后 form 内缩进多 2 空格，cosmetic 非功能问题。建议未来轮次项目维护时统一格式化（非 R23 范围）。
2. **NotificationForm 仅测 create 模式**：a11y.test.tsx 仅测 isEdit=false 创建模式，edit 模式未测。建议未来轮次补 edit 模式 jest-axe 测试（非阻断，edit 模式 DOM 结构与 create 一致）。
3. **region 组件级禁用分工合理**：jest-axe vitest 禁用 region 规则因 jsdom 无 landmark 真实渲染，@axe-core/playwright E2E 独占覆盖。建议未来轮次评估是否须组件级 region 测试（非阻断，E2E 已覆盖）。

**判定**：3 项 Suggestion 均属 cosmetic / 测试覆盖扩展类（无新规则 / 新提示词 / 新 Spec 模板项需求），按 AI-003 流程属 advisory 范围（不阻断本轮 pass），建议未来轮次收尾闭合。

> **不新立 S 级教训的理由**：§7.4 暴露的 §10.4 预判盲区属 ARIA 规范一次性知识缺口（非跨轮系统性模式）+ 3 项 Suggestion 均已被既有规则覆盖（cosmetic / 测试覆盖扩展属既有 AI-007 弱断言改进流程），无新规则缺口，不立新 S 级。本轮 retro 不新增 S-x，lessons-learned.md "仍在生效"表保持为空。

## 3 · 量化对比（二十三轮演进表）

| 指标 | R17 | R18 | R19 | R20 | R21 | R22 | R23 |
|---|---|---|---|---|---|---|---|
| 用例数（vitest） | 1196（无源码改动） | 1256（+60） | 1256（无源码改动） | 1256（无回归）+ E2E 14（新增） | 1256（无源码改动） | 1263（+7 性能专项测）+ E2E 14 | **1272**（+9 jest-axe a11y）+ E2E 22（+8 @axe-core/playwright a11y） |
| 累计用例 | 1196 | 1256 | 1256 | 1256 vitest + 14 E2E | 1256 vitest + 14 E2E | 1263 vitest + 14 E2E | **1272 vitest + 22 E2E** |
| blocker | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| suggestion/advisory | N/A（元改进轮） | 1（已闭合） | N/A（元改进轮） | 5（非阻断，建议下轮闭合） | N/A（元改进轮） | 1（既有/环境性 TS 配置，非 R22 引入） | **3**（cosmetic + 测试覆盖扩展 + region 分工，均非阻断） |
| Reviewer verdict | N/A（G6.5） | pass | N/A（G6.5） | pass | N/A（G6.5） | pass | **pass** |
| AC 对齐 | N/A | 24/24 | N/A | 19/19 | N/A | 15/15 | **11/11**（modal role/aria-modal/aria-label + ESC + focus trap + focus restore + Tab + :focus-visible + jest-axe + @axe-core/playwright + WCAG AA + 既有无回归） |
| 影响层 | 元资产层 | 跨后端+前端+contracts 三层联动层 | 元资产层 | 测试基础设施层 | 元资产层 | 前端性能层 | **前端可访问性层**（apps/web modal 改造 + useFocusTrap hook + :focus-visible CSS + apps/e2e axe 扫描 + apps/web/test jest-axe 集成） |
| 新架构模式 | 元改进轮 #2 | 历史 advisory 偏离消除 | 元改进轮 #3 | E2E 三真实联调 + vitest workspace | 元改进轮 #4（固化 S-23） | 前端性能加固（React.memo + react-window 1.x + React.lazy） | **可访问性深化**（modal focus trap/ESC/restore + Tab + :focus-visible + axe-core 双轨 WCAG AA） |
| 轮次类型 | 元改进 | 业务 | 元改进 | 业务 | 元改进 | 业务 | **业务**（第 16 个） |
| 提示词骨架条数 | 5角色+23条 | 5角色+23条 | 5角色+25条 | 5角色+25条（持续生效） | 5角色+27条（S-23 固化 +3） | 5角色+27条（S-23 首次触发验证生效） | **5角色+27条**（R21 固化 S-23 在 R23 第二次触发验证生效，无新固化） |
| 规则机器化覆盖 | AI-005 扩展含 apps/web/test | 持续覆盖 | 持续覆盖 | 持续覆盖 | 持续覆盖 | 持续覆盖（lint:rules exit 0） | 持续覆盖（lint:rules exit 0） |
| 元改进轮 Review | G6.5 落地 | 沿用 R17 G6.5 | G6.5 第二次落地 | 沿用 G6（业务轮） | G6.5 第三次落地 | 沿用 G6（业务轮） | **沿用 G6**（业务轮，G6.5 不适用） |
| 固化教训数（本轮） | 6（S-6/S-7/S-17~S-20） | 0（新发现 S-21/S-22） | 2（S-21/S-22） | 0（无新发现 S 级） | 1（S-23）+ 1 衍生 | 0（无新发现 S 级，S-23 首次触发验证生效） | **0**（无新发现 S 级，S-23 第二次触发验证生效） |

> R23 用例数 1272 = R22 1263 + 9（jest-axe a11y 9 用例）+ E2E 22 = R22 14 + 8（@axe-core/playwright a11y 8 用例）。lint:rules exit 0 + META-003/META-004 双向绑定持续闭合。R21 固化的 S-23 在 R23 第二次触发验证生效。

## 4 · 二十三轮演进脉络

- **第十八轮**：业务轮 #13（消除 R12 D10 wire 字段名适配 + R12 D19 GET /v1/users/:id 端点缺失 + D9 重分类 [约束]），跨后端 + 前端 + contracts 三层联动，验证 R17 固化提示词在业务轮首次大规模触发 + 新发现 S-21（[约束] 偏离反向同步滞后）+ S-22（确定性 token setup 时序污染）
- **第十九轮**：元改进轮 #3（固化 R18 S-21/S-22 共 2 项教训），无业务代码改动，仅提示词层 + Spec 模板层。S-21 三层固化（Tech Lead §10 预判 + impl-writer 反向同步同标准 + Reviewer git diff 核实 + 加性安全降级但强制本轮闭合）。验证 R17 G6.5 范式第二次落地可复用。
- **第二十轮**：业务轮 #14（引入 Playwright E2E 测试 + 闭合 R12 遗留 S-5）。E2E 三真实联调覆盖核心流全链路（login → users → roles → transfer → 登出，14 AC）。S-5 经 9 轮（R12→R20）最终闭合（vitest workspace 模式分离 api node / web jsdom）。R18 S-21 首次大规模触发验证生效（4 项 advisory 偏离全部实际编辑 Spec 闭合）。§10.6 关键风险预判第二次大规模触发并精准命中（jest-dom → jest-dom/vitest 修复）。**retro 耗时根因分析新发现 S-23**（Tech Lead 第三方库版本 API 核验缺口）+ BA 凭据笔误（Admin@123 vs admin123）。
- **第二十一轮**：元改进轮 #4（固化 R20 S-23 共 1 项教训 + BA 凭据核验衍生），无业务代码改动，仅提示词层 + Spec 模板层。S-23 两层固化（Tech Lead §10 增项第三方库版本 API 差异 + 版本核验约束 + BA 凭据/seed 值核验延伸）。验证 R17 G6.5 范式第三次落地可复用。R21 是迄今最轻量元改进轮（1 项教训 + 1 衍生，1 文件 3 处编辑），证明元改进轮范式成熟可轻量化。
- **第二十二轮**：业务轮 #15（前端性能加固 React.memo + react-window 1.x 虚拟列表 + React.lazy 代码分割 + 闭合 R20 Review 5 项 Suggestion）。前端单层变更（apps/web + apps/e2e 强断言 + docs/spec 文档同步）。**R21 固化的 S-23 首次触发验证生效**——Tech Lead 在 spec 阶段预先核验 react-window npm registry dist-tags + 实测安装验证 + §3.2+§10.6 反向同步标注，BA Q2 字面"react-window 8.x"版本号语义误判在 spec 阶段即被修正为 react-window@1.8.11 + @types/react-window@1.8.8，避免 R20 vitest 1.6.1 版本核验缺口重演。R20 Review 5 项 Suggestion 全部闭合。R18 S-21 "伪同步检测"机制第三次大规模触发并验证可复用（2 项 advisory 偏离全部实际编辑 Tech-Spec 闭合）。
- **第二十三轮**：**业务轮 #16**（可访问性深化 modal focus trap/ESC/restore + Tab 顺序 + 焦点可见 + axe-core WCAG AA 双轨自动检测）。前端单层变更（apps/web modal 改造 + useFocusTrap hook + :focus-visible CSS + apps/e2e axe 扫描 + apps/web/test jest-axe 集成）。**R21 固化的 S-23 第二次触发验证生效**——Tech Lead 在 spec 阶段预先核验 jest-axe + @axe-core/playwright npm registry dist-tags + 实测安装验证 + §3.2/§3.3 + §10.6 反向同步标注，BA PRD 假设 jest-axe 5.x + /vitest 子路径入口在 spec 阶段即被修正为 jest-axe@10.0.0 + 显式 expect.extend + @axe-core/playwright@4.12.1。R22 React.memo/useCallback/react-window 协同保持（既有 1263 vitest + 14 E2E 全绿无回归证明）。§7.4 form-based modal DOM 结构调整（aria-allowed-role 合规修复）advisory 偏离反向同步标注完整（R18 S-21 + R19 G6.5 第三次大规模触发，§10.4 预判盲区补全）。Reviewer 不建议立新 S 级（§7.4 暴露的 §10.4 预判盲区属 ARIA 规范一次性知识缺口，非跨轮系统性模式）。

## 5 · 反推优化三个层面执行情况

### 5.1 规则层执行情况（反推到 .trae/rules/ + scripts/check-rules.mjs）

| 反推项 | R23 状态 | 证据 |
|---|---|---|
| META-003 声明即实现 | ✅ 持续闭合 | 本轮无规则脚本改动，lint:rules exit 0 |
| META-004 实现即声明 | ✅ 持续闭合 | 本轮无新增 enforcement ID |
| ARCH-001/002/003 | ✅ 全部保持 | ARCH-002（contracts 零变更）git status 确认；ARCH-003（apps/web 不 import apps/api/src + apps/e2e 通过 HTTP 交互）保持；ARCH-001（四层反向依赖）不触发（无 apps/api/src 业务文件改动） |
| AI-005 扫描器（R13 S-6 固化） | ✅ 持续覆盖 | lint:rules exit 0，6 条 AI-005 建议为 R16 既有非本次新增 |
| SEC-002/SEC-003a | N/A | 前端可访问性轮，无 service/router 改动；3 条 SEC-002 豁免审计为既有非本轮新增 |

### 5.2 Spec 模板层执行情况（反推到 Tech-Spec 模板，经 Tech Lead 提示词约束）

| 反推项 | R23 状态 | 证据 |
|---|---|---|
| R16 S-18 全集定义明确 | ✅ 持续生效 | 本轮无全码映射改动（errorMapping 零变更） |
| R16 S-19 简单常量复用边界 | ✅ 持续生效 | VIRTUAL_LIST_THRESHOLD / VIRTUAL_ITEM_SIZE / VIRTUAL_LIST_HEIGHT / VIRTUAL_OVERSCAN_COUNT 4 常量保持（R22 落地，R23 不改） |
| R16 S-20 测试工具 workaround | ✅ 持续生效 | a11y.test.tsx + a11y.spec.ts 按 S-20 标注（jest-axe + @axe-core/playwright 集成 workaround） |
| R18 S-21 [约束] 偏离反向同步闭环性 | ✅ R23 第三次大规模触发验证生效 | Tech Lead §10.5 预判 [约束] 偏离可能场景 → impl-writer 实际编辑 Tech-Spec §7.1-§7.4（4 项 advisory 偏离）→ Reviewer Read 全文核实非伪同步 |
| **R20 S-23 第三方库版本 API 差异** | ✅ **R23 第二次触发验证生效** | Tech Lead 按 S-23 提示词在 spec 阶段预先核验 jest-axe + @axe-core/playwright npm registry dist-tags + 版本元数据 + 实测安装验证 → §3.2 D2 + §3.3 D3 完整记录 5 项核验结论 + §10.6 标注"第二次触发验证生效" + §10.7 替代方案预判 → impl 阶段未触发任何 API 修正，1272 测试一次通过 |
| §10.6 关键风险预判范式（R17 固化） | ✅ 持续生效 + §10.4 预判盲区补全 | Tech-Spec §10.4 预判 axe-core 0 violations 暴露既有违规（§8.2 详述）；§7.4 补全 §10.4 预判盲区（D4 改造本身引入 aria-allowed-role 违规未预判） |

### 5.3 提示词层执行情况（反推到五角色提示词骨架 spec-first-workflow.md §2.2~2.6）

| 固化项 | 角色 | R23 状态 | 证据 |
|---|---|---|---|
| S-21 Tech Lead §10 预判 [约束] 偏离反向同步闭环性 | Tech Lead | ✅ R23 第三次大规模触发 | Tech-Spec §10.5 [约束] 偏离反向同步闭环性预判已落（本轮 4 项 advisory 偏离全部按预判闭环） |
| S-21 impl-writer 反向同步同标准 | impl-writer | ✅ R23 第三次大规模触发验证生效 | 4 项 advisory 偏离（§7.1 D7 + §7.2 D2 + §7.3 D9 + §7.4 D4）全部实际编辑 Tech-Spec（§7.4 由编排者补上，其余 3 项 Tech Lead 在 spec 阶段已落） |
| S-21 Reviewer 闸门核验（Read 全文 / git diff 核实非伪同步） | Reviewer | ✅ R23 第三次大规模触发验证生效 | Reviewer 通过 Read Tech-Spec 全文确认 4 项 advisory 标注已落入章节（非仅信代码注释），R19 S-21 固化的"伪同步检测"机制在 R23 第三次复用 |
| **S-23 Tech Lead §10 预判第三方库版本 API 差异** | Tech Lead | ✅ **R23 第二次触发验证生效** | Tech-Spec §10.6 标注"S-23 第二次触发验证生效" + §10.7 替代方案预判（jest-axe/@axe-core/playwright 不兼容退回方案 + 无 /vitest 子路径修正） |
| **S-23 Tech Lead 第三方库版本 API 核验约束** | Tech Lead | ✅ **R23 第二次触发验证生效** | Tech Lead 在 spec 阶段按 S-23 提示词约束预先核验 jest-axe + @axe-core/playwright npm registry dist-tags + 版本元数据 + 实测安装验证（非凭高版本文档假设 API 可用），5 项核验结论完整记录于 §3.2 D2 + §3.3 D3 |
| **S-23 衍生 BA 凭据/seed 值核验** | BA | ✅ 提示词已落（未直接触发） | R23 不涉及凭据/seed 值（PRD AC 无登录凭据字段），提示词文本已落 §2.2 BA，下轮业务轮涉及凭据/seed 值时将触发验证 |
| S-17 impl-writer 自报准确性 | impl-writer | ✅ 持续生效 | impl-writer 自报清单（13 M + 6 ??）与 git status 实际逐项一致 ✅ |

**合计**：R13 固化的 8 条 + R14 固化的 5 条 + R15 固化的 4 条 + R16 持续验证的 17 条 + R17 固化的 6 条 + R18 持续验证的 23 条 + R19 固化的 4 条 + R20 持续验证的 25 条 + R21 固化的 3 条 = **R23 后提示词骨架共 5 角色 + 27 条固化项持续生效**（R23 无新固化，R21 固化的 S-23 在 R23 第二次触发验证生效）。

## 6 · 结论 + 剩余改进项

第二十三轮是"业务轮 #16 · 可访问性深化 + S-23 第二次触发验证 + R22 协同保持"的标志——承接 R22 retro §6 候选清单第 1 项，本轮一次性完成三项工作：可访问性深化（modal focus trap/ESC/restore + Tab 顺序 + 焦点可见 + axe-core WCAG AA 双轨自动检测，11 AC 全绿）+ R21 固化 S-23 第二次触发验证生效（Tech Lead spec 阶段预先核验 jest-axe + @axe-core/playwright 版本 + §3.2/§3.3 + §10.6 反向同步标注）+ R22 React.memo/useCallback/react-window 协同保持（既有 1263 vitest + 14 E2E 全绿无回归证明）。

关键证据：
1. **可访问性深化 D1-D10 全部落地**：自定义 useFocusTrap hook（focus trap + ESC + restore）+ 8 modal 形态组件统一改造（role="dialog" + aria-modal + aria-label 域特定命名）+ :focus-visible 全局 CSS（#2563eb 对比度 ≥ 3:1）+ jest-axe vitest 9 用例（组件级 jsdom）+ @axe-core/playwright E2E 8 用例（页面级真实浏览器）。双轨互补（组件级回归保护 + 页面级真实浏览器断言）。
2. **R21 固化的 S-23 第二次触发验证生效**：BA PRD 假设 jest-axe 5.x + /vitest 子路径入口为版本号 + API 误判，Tech Lead 按 S-23 提示词在 spec 阶段预先核验 npm registry dist-tags + 版本元数据 + 实测安装验证，发现 5 项核验结论完整记录于 §3.2 D2 + §3.3 D3 + §10.6 标注"第二次触发验证生效" + §10.7 替代方案预判。实装 jest-axe@10.0.0 + @types/jest-axe@3.5.9 + @axe-core/playwright@4.12.1 与 spec D2/D3 一致，impl 阶段未触发任何 API 修正（PRD BA 假设 jest-axe 5.x + /vitest 子路径入口版本号 + API 误判在 spec 阶段即被修正）。
3. **R22 React.memo/useCallback/react-window 协同保持**：R23 useFocusTrap hook 与 R22 React.memo + useCallback + react-window 协同保持，既有 1263 vitest + 14 E2E 全绿无回归证明 R22 成果不被 R23 破坏。useFocusTrap hook 内部 useCallback 稳定引用模式与 R22 D3 useCallback 模式一致，避免 modal state 变化触发列表行 re-render（R22 D1 React.memo 包裹有效性保持）。
4. **§7.4 form-based modal DOM 结构调整 advisory 偏离反向同步标注完整**：impl-writer 在 impl 阶段发现 Tech-Spec D4 字面"加 role="dialog" 到 `<form>` 元素"会触发 ARIA 1.2 aria-allowed-role 违规，改为 `<div role="dialog"><form>` 结构。编排者按 R19 S-21 固化机制实际编辑 Tech-Spec §7.4 反向同步标注（根因 + 修复方案 + 影响范围 + §10.4 预判盲区补全 + 性质 5 要素齐全），R18 S-21 + R19 G6.5 "伪同步检测"机制第三次大规模触发并验证可复用。

剩余改进项（S 级，不阻断）：
- **本轮无新立 S 级**：3 项 Reviewer Suggestion（form 包裹后缩进 cosmetic / NotificationForm 仅测 create 模式 / region 组件级禁用分工合理）均属 cosmetic / 测试覆盖扩展类（无新规则 / 新提示词 / 新 Spec 模板项需求），按 AI-003 流程属 advisory 范围（不阻断本轮 pass），建议未来轮次收尾闭合。
- **既有 S 级全部持续生效**：S-23（R21 固化）在 R23 第二次触发验证生效，无新固化需求；其余 S-1~S-22 持续生效。

> 本轮 3 项 Suggestion 不立新 S 级，按既有规则属 cosmetic / 测试覆盖扩展类（无新规则缺口）。

> **下一轮候选**（按 R17 §6 + R18 §6 + R19 §6 + R20 §6 + R21 §6 + R22 §6 + R23 §6 状态排序）：
> 1. **R24 跨浏览器 E2E 覆盖**（firefox/webkit，R20 chromium 基础设施已就绪 + R23 @axe-core/playwright 已为多浏览器验证打好基础）—— E2E 扩展，playwright.config projects 数组增 firefox/webkit 项即可，R23 a11y.spec.ts 可复用为多浏览器 axe 扫描。
> 2. **R25 项目维护轮**（修复 R22 Advisory #1 TS baseUrl 弃用 + R23 3 项 Suggestion 收尾闭合 + 其他既有/环境性配置问题）—— 元改进轮 #5，可走 G6.5 第四次落地。
> 3. **R26 screen reader 端到端人工核验**（须搭建真实 NVDA/JAWS/VoiceOver 环境，CI 不可重复，成本最高）—— R23 已留 future，可在 R24/R25 后启动。
