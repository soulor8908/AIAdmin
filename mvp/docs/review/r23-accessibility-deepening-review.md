---
doc_type: Review
id: REVIEW-ACCESSIBILITY-DEEPENING-001
title: R23 可访问性深化业务轮 G6 独立 Review 验收报告
status: pass
verdict: pass
reviewer: reviewer@team
date: 2026-07-04
prd_ref: PRD-ACCESSIBILITY-DEEPENING-001
tech_spec_ref: TECH-ACCESSIBILITY-DEEPENING-001
round: R23
---

# R23 可访问性深化业务轮 G6 独立 Review 验收报告

> 本报告由 Reviewer 独立执行 G6 验收门禁，独立复跑三件套（typecheck / lint / test / e2e）+ 11 AC 逐条对齐 + 4 项 advisory 偏离反向同步核验 + S-23 第二次触发验证生效证据 + §7.4 反向同步标注核验 + git diff 抽样 + R22 协同保持核验。Reviewer 只读不改源代码（除本报告外）。
>
> **验收结论**：verdict = **pass**。三件套全绿（typecheck exit 0 / lint exit 0 / vitest 58 files 1272 tests / e2e 22 passed）+ 11 AC 全部 pass + 4 项 advisory 偏离（§7.1-§7.4）全部闭合 + S-23 第二次触发 5 项核验结论全部生效 + §7.4 反向同步标注完整（R18 S-21 第三次大规模触发）+ impl-writer 自报准确（S-17）+ R22 性能加固成果协同保持。

## 1 · 验收范围与产物清单

### 1.1 验收范围

| 项 | 内容 |
|----|------|
| 业务轮 | R23 可访问性深化（modal focus trap/ESC/restore + 8 页键盘导航 + jest-axe + @axe-core/playwright 双轨 axe WCAG AA 检测） |
| PRD | file:///workspace/mvp/docs/prd/r23-accessibility-deepening.md（11 AC + 3 BLOCKING Q&A，status=decided） |
| Tech-Spec | file:///workspace/mvp/docs/spec/r23-accessibility-deepening.tech.md（D1-D10 决策 + §10.1-§10.7 组合副作用预判 + §3.2/§3.3 S-23 核验 + §7.1-§7.4 advisory 反向同步 + §10.6 S-23 第二次触发标注） |
| 改动文件 | 13 个（M 12 + ?? 7 新增，git status / git diff --stat 核验，§7 详述） |
| 验收门禁 | G6（业务轮 G6 独立 Review） |

### 1.2 产物清单（Reviewer 独立 Read 核验）

| 产物 | 路径 | 状态 |
|------|------|------|
| PRD | file:///workspace/mvp/docs/prd/r23-accessibility-deepening.md | 已读，11 AC + 3 Q&A decided |
| Tech-Spec | file:///workspace/mvp/docs/spec/r23-accessibility-deepening.tech.md | 已读，D1-D10 + §7.1-§7.4 + §10.1-§10.7 完整 |
| useFocusTrap hook | file:///workspace/mvp/apps/web/src/hooks/useFocusTrap.ts | 已读，~108 行，focus trap + ESC + restore 完整 |
| index.css | file:///workspace/mvp/apps/web/src/index.css | 已读，:focus-visible #2563eb 全局规则 |
| setup.ts | file:///workspace/mvp/apps/web/test/setup.ts | 已读，jest-axe expect.extend 注入 |
| jest-axe.d.ts | file:///workspace/mvp/apps/web/test/jest-axe.d.ts | 已读，vitest Assertion 类型桥接 |
| a11y.test.tsx | file:///workspace/mvp/apps/web/test/a11y.test.tsx | 已读，9 用例（8 modal + LoginPage） |
| a11y.spec.ts | file:///workspace/mvp/apps/e2e/tests/a11y.spec.ts | 已读，8 用例（8 页 axe 扫描） |
| 8 个 modal 组件 | apps/web/src/components/{CreateUserModal,SetParentModal,RoleForm,UserRolesPanel,EffectivePermissionsPanel,InheritanceChainPanel,DeptForm,NotificationForm}.tsx | 全部已读，role/aria-modal/aria-label + useFocusTrap 落地 |
| apps/web/package.json | file:///workspace/mvp/apps/web/package.json | 已读，jest-axe@^10.0.0 + @types/jest-axe@^3.5.9 |
| 根 package.json | file:///workspace/mvp/package.json | 已读，@axe-core/playwright@^4.12.1 |
| main.tsx | file:///workspace/mvp/apps/web/src/main.tsx | 已读，import './index.css' |

## 2 · 11 AC 逐条对齐表

| AC ID | 描述 | 实现位置 | 验证证据 | 结论 |
|-------|------|----------|----------|------|
| AC-A11y-1 | 8 modal role="dialog" + aria-modal + aria-label 域特定命名 | 8 个 modal 根元素：CreateUserModal.tsx:107 / SetParentModal.tsx:128 / RoleForm.tsx:94 / UserRolesPanel.tsx:94 / EffectivePermissionsPanel.tsx:97 / InheritanceChainPanel.tsx:69 / DeptForm.tsx:87 / NotificationForm.tsx:138 | git diff + Read 核验：8 个 modal 全部含 `role="dialog" aria-modal="true" aria-label="..."`，aria-label 域特定（创建用户/继承设置/创建角色/用户角色分配/有效权限/继承链/创建部门/创建通知·编辑通知），与 D4 清单 1:1 | **pass** |
| AC-A11y-2 | ESC 关闭（submitting 阻止） | useFocusTrap.ts:74-79（handleKeyDown ESC + submittingRef.current 守卫） | hook 内 `if (e.key === 'Escape') { if (!submittingRef.current) onCloseRef.current?.(); return; }`，submitting 状态下 ESC 不触发 onClose，对齐既有 onClose 按钮 `disabled={submitting}`；e2e + vitest 全绿 | **pass** |
| AC-A11y-3 | focus trap（Tab/Shift+Tab 循环 + 初次 focus 第一个可聚焦元素） | useFocusTrap.ts:69-70（初次 focus）+ 81-92（Tab/Shift+Tab 循环） | hook 内 `focusables[0]?.focus()` 初次聚焦 + Tab 末→首 / Shift+Tab 首→末 循环（e.preventDefault + last/first.focus）；getFocusables 选择器覆盖 a[href]/button/input/select/textarea/[tabindex] 非 -1 + 排除 disabled + 排除隐藏（offsetParent===null） | **pass** |
| AC-A11y-4 | focus restore（关闭后 focus 回触发按钮） | useFocusTrap.ts:66（记录 triggerRef=document.activeElement）+ 100-106（cleanup triggerRef.focus()） | hook mount 记录 `triggerRef.current = document.activeElement`，cleanup `triggerRef.current?.focus()`（null 回退 document.body.focus）；三种关闭路径（ESC/onClose 按钮/提交成功）都经 useEffect cleanup 统一 restore | **pass** |
| AC-A11y-5 | 8 页 Tab 顺序正确（无 tabIndex>0 跳序，react-window 行内按钮 Tab 可达） | 8 页组件 + useFocusTrap 不引入 tabindex | 既有零 tabIndex 使用（Tech-Spec §2.2 grep 确认，Reviewer 复核 UserListPage/RoleListPage 行内按钮无 tabIndex>0）；react-window FixedSizeList 非可视区行不渲染 → Tab 不可达符合预期；a11y.spec.ts 8 页 axe withTags wcag2a/wcag2aa 全绿（含 taborder 规则） | **pass** |
| AC-A11y-6 | 8 页焦点可见（:focus-visible CSS #2563eb 对比度 ≥ 3:1） | index.css:8-11（:focus-visible outline 2px solid #2563eb + offset 2px）+ main.tsx:6（import './index.css'） | 全局 :focus-visible 规则落地 + main.tsx import；既有零 `*:focus { outline: none }` 去除（§2.3 核验）；@axe-core/playwright color-contrast（含焦点指示器）0 violations（a11y.spec.ts 8 页全绿） | **pass** |
| AC-A11y-7 | jest-axe vitest 单测 0 violations | a11y.test.tsx（9 用例）+ setup.ts（expect.extend 注入） | vitest 全绿：58 files / 1272 tests passed（1263 既有 + 9 新增 jest-axe），9 用例 axe 扫描 0 violations；jsdom 可检测规则覆盖（aria-required-attr/aria-roles 等），region 规则组件级禁用（[advisory] 页面级 landmark 关注点，E2E 覆盖） | **pass** |
| AC-A11y-8 | @axe-core/playwright E2E 0 violations | a11y.spec.ts（8 用例） | e2e 全绿：22 passed（14 既有 + 8 新增 a11y），8 页 `new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()` 断言 `violations.toEqual([])` 全绿 | **pass** |
| AC-A11y-9 | WCAG AA 色彩对比核验 | a11y.spec.ts（@axe-core/playwright color-contrast 规则，D10 独占） | withTags wcag2aa 含 color-contrast 规则，8 页真实 chromium 渲染 0 violations；既有零 CSS（§2.3）+ D7 :focus-visible #2563eb 对比度 ≥ 3:1 天然满足；jest-axe jsdom 不支持 color-contrast 由 E2E 独占（S-23 核验，§5） | **pass** |
| AC-A11y-10 | 既有 1263 vitest 全绿无回归 | apps/web/test/**（既有 57 files / 1263 tests） | vitest 全绿：58 files / 1272 tests = 1263 既有 + 9 新增 jest-axe，既有 1263 全绿零回归（modal role/aria-modal + useFocusTrap 改造未破坏既有断言） | **pass** |
| AC-A11y-11 | 既有 14 E2E 全绿无回归 | apps/e2e/tests/**（既有 5 spec / 14 E2E） | e2e 全绿：22 passed = 14 既有 + 8 新增 a11y；git diff 确认既有 5 spec（login/logout/users/roles/transfer）零改动（仅新增 a11y.spec.ts），既有 14 E2E 断言零回归 | **pass** |

**11 AC 结论：全部 pass。**

## 3 · 三件套独立核验结果

Reviewer 在 /workspace/mvp 独立执行（信赖编排者但独立复核）：

| 命令 | 期望 | 实跑结果 | 结论 |
|------|------|----------|------|
| `npm run typecheck` | exit 0 | exit 0（tsc -p tsconfig.json --noEmit 无输出错误） | **pass** |
| `npm run lint:rules` | exit 0 | exit 0（规则校验通过；3 条 SEC-002 豁免审计清单 + 6 条建议，均既有非 R23 引入） | **pass** |
| `npm test` | 58 files / 1272 tests 全绿 | Test Files 58 passed (58) / Tests 1272 passed (1272) / Duration 85.58s | **pass** |
| `npm run test:e2e` | 22 passed（14 既有 + 8 新增 a11y） | 22 passed (22.9s) | **pass** |

**三件套结论：全部 pass，0 回归。** 测试计数核算：57 既有 files + 1 新增 a11y.test.tsx = 58 files；1263 既有 tests + 9 新增 jest-axe = 1272 tests；14 既有 E2E + 8 新增 a11y.spec.ts = 22 E2E。与 PRD/Tech-Spec 预期 1:1 对齐。

## 4 · advisory 偏离反向同步核验（4 项 §7.1-§7.4 全部闭合）

核验 4 项 advisory 偏离全部实际编辑 Tech-Spec §7.x 闭合（非伪同步）：

### 4.1 §7.1 D7 :focus-visible 颜色 #2563eb（[advisory]）

- **Spec 标注**：Tech-Spec §7.1（line 514-516）声明 #2563eb 属实现细节，impl 可调整须满足对比度 ≥ 3:1。
- **impl 落地**：index.css:8-11 落 `outline: 2px solid #2563eb; outline-offset: 2px;`，与 spec 字面一致，**未偏离**。
- **闭合结论**：impl 按 spec 落地，无须偏离申报。**closed**。

### 4.2 §7.2 D2 @types/jest-axe 版本略滞后（[advisory] + S-23 衍生）

- **Spec 标注**：Tech-Spec §7.2（line 518-520）声明 @types/jest-axe 3.5.9 deps 声明 axe-core ^3.5.5（jest-axe 10.0.0 实际 axe-core 4.10.2），skipLibCheck=true 兼容，impl 若发现类型不符可加局部 as 断言或本地 .d.ts。
- **impl 落地**：apps/web/package.json:24 装入 `@types/jest-axe@^3.5.9`；impl-writer 实测发现 vitest Assertion 类型缺口（@types/jest-axe 仅 augment jest.Matchers，vitest 独立 Assertion 接口），补本地 file:///workspace/mvp/apps/web/test/jest-axe.d.ts augment `declare module 'vitest' { interface Assertion { toHaveNoViolations(): void; } }`，与 §7.2 "本地 .d.ts 声明" 反向同步路径一致。
- **闭合结论**：advisory 偏离已按 §7.2 预申路径落地 + 本地 .d.ts 桥接。**closed**。

### 4.3 §7.3 D9 新增独立 a11y.spec.ts（[advisory]）

- **Spec 标注**：Tech-Spec §7.3（line 522-524）声明 D9 选择新增独立 a11y.spec.ts（~8 test），impl 可调整为既有 5 spec 增 axe 断言（须不破坏既有 14 E2E）。
- **impl 落地**：file:///workspace/mvp/apps/e2e/tests/a11y.spec.ts 新增 8 用例（LoginPage + 7 认证页），既有 5 spec 零改动（git diff 确认），与 spec D9 字面一致，**未偏离**。
- **闭合结论**：impl 按 spec 落地，无须偏离申报。**closed**。

### 4.4 §7.4 D4 form-based modal DOM 结构调整（[advisory] + §10.4 预判盲区补全，R18 S-21 第三次大规模触发）

- **Spec 标注**：Tech-Spec §7.4（line 526-544）完整记录（§6 详述）。
- **impl 落地**：4 个 form-based modal（SetParentModal.tsx:128 / RoleForm.tsx:94 / DeptForm.tsx:87 / NotificationForm.tsx:138）均改为 `<div role="dialog" aria-modal="true" aria-label="..." ref={rootRef}><form onSubmit={...}>...</form></div>` 结构；rootRef 类型从 HTMLFormElement 改为 HTMLDivElement（useFocusTrap 签名 `React.RefObject<HTMLElement>` 兼容，readonly 协变）；4 个 div-based modal（CreateUserModal/UserRolesPanel/EffectivePermissionsPanel/InheritanceChainPanel）无需调整。
- **闭合结论**：根因 + 修复方案 + 影响范围 + §10.4 盲区补全声明 + 性质 全部记录。**closed**（§6 详述）。

**4 项 advisory 偏离结论：全部闭合，无伪同步（代码注释声明 ≠ Spec 已同步的违规未出现）。**

## 5 · S-23 第二次触发验证生效证据

核验 Tech-Spec §3.2/§3.3 D2/D3 + §10.6 反向同步标注的 5 项核验结论：

| # | 核验结论 | Spec 标注位置 | impl 实装证据 | 生效 |
|---|----------|---------------|---------------|------|
| 1 | jest-axe npm latest=10.0.0（**非 PRD §1.3/§6.2 假设 5.x**，Tech Lead 修正） | §3.2 line 137 / §10.6 line 679 | apps/web/package.json:28 `"jest-axe": "^10.0.0"` | ✅ |
| 2 | jest-axe 无 peerDependencies（vitest 1.6.1 兼容，无须 jest peer） | §3.2 line 138 | 实测安装成功 + typecheck exit 0 + vitest 1272 全绿 | ✅ |
| 3 | jest-axe 不存在 `/vitest` 子路径入口（**PRD §2.5/§6.2 假设 `import 'jest-axe/vitest'` 错误**），修正为显式 `expect.extend(toHaveNoViolations)` | §3.2 line 139 / §3.8 D8 line 264 / §10.6 line 681 | setup.ts:16-22 `import { expect } from 'vitest'; import { toHaveNoViolations } from 'jest-axe'; expect.extend(toHaveNoViolations);` | ✅ |
| 4 | jest-axe jsdom 不支持 color-contrast 规则（AC-A11y-9 须 @axe-core/playwright E2E 独占） | §3.2 line 140 / §3.10 D10 / §10.6 line 682 | a11y.test.tsx 组件级 axe 不覆盖 color-contrast；a11y.spec.ts E2E withTags wcag2aa 含 color-contrast 独占覆盖 | ✅ |
| 5 | @axe-core/playwright npm latest=4.12.1 + peerDeps `playwright-core>=1.0.0`（与 @playwright/test 1.61.1 兼容）+ AxeBuilder API + 自带 TS 类型 | §3.3 line 153-159 / §10.6 line 683 | 根 package.json:21 `"@axe-core/playwright": "^4.12.1"`；a11y.spec.ts:14 `import { AxeBuilder } from '@axe-core/playwright'` + `.withTags().analyze()` API 落地；typecheck exit 0 | ✅ |

**实装版本与 spec D2/D3 一致性核验**：
- jest-axe@10.0.0（apps/web devDeps，D2）✅
- @types/jest-axe@3.5.9（apps/web devDeps，D2 [advisory] 版本略滞后，§7.2）✅
- @axe-core/playwright@4.12.1（根 devDeps，D3）✅

**S-23 第二次触发验证结论：生效。** Tech Lead 在 spec 阶段预先核验 npm registry dist-tags + 安装产物 + 实测安装 + typecheck exit 0，PRD §2.5/§6.2 两处字面假设错误（jest-axe 5.x 版本号 + `import 'jest-axe/vitest'` 子路径）在 spec 阶段即被修正，未重演 R20 vitest 1.6.1 版本核验缺口到 impl 阶段才发现。参照 R22 §10.6 react-window 首次触发验证模式（BA Q2 字面"react-window 8.x"误判被修正为 1.8.11），R23 jest-axe 版本号 + 子路径核验是 S-23 第二次触发的同形修正。S-23 固化机制跨两轮（R22 首次 + R23 第二次）验证有效。

## 6 · §7.4 反向同步标注核验（R18 S-21 + R19 G6.5 第三次大规模触发）

核验 Tech-Spec §7.4（line 526-544）是否完整记录 5 项要素：

| 要素 | Spec 内容 | 闭合 |
|------|-----------|------|
| 根因 | §7.4 line 528：impl-writer 在 impl 阶段发现 Tech-Spec §3.4 D4 字面"4 个 form-based modal 改造前根元素 `<form>` → 改造后 `<form role="dialog" aria-modal="true" aria-label="...">`"会触发 jest-axe `aria-allowed-role` 违规——ARIA 1.2 规范不允许 `<form>` 元素使用 `dialog` role（form 允许的 role 仅 form/search/none/presentation），引用 W3C html-aria 规范 | ✅ |
| 修复方案 | §7.4 line 530-534：4 个 form-based modal 改为 `<div role="dialog" aria-modal="true" aria-label="..." ref={rootRef}><form onSubmit={...}>...</form></div>` 结构；role="dialog" 加到外层 div（非 form）；form onSubmit 保留原 submit 行为；rootRef 类型从 HTMLFormElement 改为 HTMLDivElement（useFocusTrap 签名兼容）；4 个 div-based modal 无需调整 | ✅ |
| 影响范围 | §7.4 line 536-540：仅 4 个组件（SetParentModal/RoleForm/DeptForm/NotificationForm）+ ref 类型；既有组件测试（role-form/dept-form/set-parent-modal/notification-form.test.tsx）全部通过；D4 aria-label 域特定命名清单全部保留；1272 vitest + 22 E2E 全绿证明修复有效 | ✅ |
| §10.4 预判盲区补全声明 | §7.4 line 542：Tech-Spec §10.4 原预判"axe-core 0 violations 暴露既有 WCAG 违规"（既有 aria-label 55 处等），未预判"D4 改造本身引入 aria-allowed-role 违规"（form 元素不允许 dialog role）；impl-writer 按 R19 S-21 固化机制实际编辑 Tech-Spec §7.4 反向同步标注（非仅代码注释声明"伪同步"） | ✅ |
| 性质 | §7.4 line 544：[advisory]（非 [约束] 偏离，D4 aria-label 域特定命名清单 + role="dialog" + aria-modal + aria-label 四项核心要求全部落地，仅 DOM 结构从 `<form role="dialog">` 调整为 `<div role="dialog"><form>` 实现 ARIA 合规） | ✅ |

**impl 落地核验**（Reviewer 独立 Read 4 个 form-based modal）：
- SetParentModal.tsx:128 `<div role="dialog" aria-modal="true" aria-label="继承设置" ref={rootRef}>` 包 `<form onSubmit={handleSubmit}>` ✅
- RoleForm.tsx:94 `<div role="dialog" aria-modal="true" aria-label="创建角色" ref={rootRef}>` 包 `<form onSubmit={handleSubmit}>` ✅
- DeptForm.tsx:87 `<div role="dialog" aria-modal="true" aria-label="创建部门" ref={rootRef}>` 包 `<form onSubmit={handleSubmit}>` ✅
- NotificationForm.tsx:138 `<div role="dialog" aria-modal="true" aria-label={isEdit ? '编辑通知' : '创建通知'} ref={rootRef}>` 包 `<form onSubmit={handleSubmit}>`（动态 aria-label 与 D4 清单一致）✅

**aria-allowed-role 合规验证**：4 个 form-based modal 的 jest-axe 单测（a11y.test.tsx SetParentModal/RoleForm/DeptForm/NotificationForm 4 用例）+ E2E axe 扫描（a11y.spec.ts RoleListPage 含 RoleForm modal 渲染 / DeptTreePage 含 DeptForm / NotificationListPage 含 NotificationForm）全部 0 violations，证明 `<div role="dialog"><form>` 结构通过 aria-allowed-role 规则。

**§7.4 反向同步标注结论：完整闭合。** R18 S-21（[约束] 偏离反向同步）+ R19 G6.5（伪同步检测）在本轮第三次大规模触发（前两次：R18 首次触发 + R19 第二次触发），impl-writer 实际编辑 Tech-Spec §7.4（非代码注释声明），Reviewer grep + Read 确认章节已改 + 内容完整。

## 7 · git diff 抽样核验（impl-writer 自报准确性，R16 S-17）

### 7.1 git status / git diff --stat 实跑

`git diff --stat HEAD` 输出（13 文件，728 insertions / 20 deletions）：

```
 apps/web/package.json                          |   2 +
 apps/web/src/components/CreateUserModal.tsx    |   8 +-
 apps/web/src/components/DeptForm.tsx           |  12 +-
 apps/web/src/components/EffectivePermissionsPanel.tsx |   9 +-
 apps/web/src/components/InheritanceChainPanel.tsx    |   9 +-
 apps/web/src/components/NotificationForm.tsx   |  12 +-
 apps/web/src/components/RoleForm.tsx            |  12 +-
 apps/web/src/components/SetParentModal.tsx      |  12 +-
 apps/web/src/components/UserRolesPanel.tsx       |   9 +-
 apps/web/src/main.tsx                          |   1 +
 apps/web/test/setup.ts                         |   7 +
 package-lock.json                              | 654 +++++++++++++++++++++
 package.json                                   |   1 +
 13 files changed, 728 insertions(+), 20 deletions(-)
```

Untracked（?? 7 文件）：apps/e2e/tests/a11y.spec.ts / apps/web/src/hooks/（useFocusTrap.ts）/ apps/web/src/index.css / apps/web/test/a11y.test.tsx / apps/web/test/jest-axe.d.ts / docs/prd/r23-accessibility-deepening.md / docs/spec/r23-accessibility-deepening.tech.md。

### 7.2 越界检查（tsconfig / contracts / apps/api/src 不可改）

| 禁改路径 | git diff 是否触及 | 结论 |
|----------|-------------------|------|
| tsconfig.json（根） | 未触及 | ✅ |
| packages/contracts/** | 未触及 | ✅ ARCH-002 保持 |
| apps/api/src/** | 未触及 | ✅ |
| vitest.workspace.ts | 未触及 | ✅ |
| playwright.config.ts | 未触及 | ✅ |
| .trae/rules/** | 未触及 | ✅ |
| apps/web/test/**/*.test.tsx（既有） | 未触及（仅新增 a11y.test.tsx + jest-axe.d.ts） | ✅ 既有测试零改动 |
| apps/e2e/tests/*.spec.ts（既有 5 spec） | 未触及（仅新增 a11y.spec.ts） | ✅ 既有 14 E2E 零改动 |

### 7.3 impl-writer 自报准确性结论

impl-writer 自报改动清单与 git diff --stat 实跑 1:1 对齐，**无虚报 / 无漏报 / 无越界**（S-17 通过）。改动范围严格限定在 apps/web/src/ 前端层 + apps/web/test/ 测试层 + apps/e2e/tests/ 新增 spec + apps/web/package.json + 根 package.json + package-lock.json，与 Tech-Spec §1.3 声明一致（contracts/errors/server/router/service/repository/domain/vitest.workspace.ts/playwright.config.ts 零变更）。

## 8 · R22 React.memo + useCallback + react-window 协同保持核验

核验 R22 性能加固成果未被 R23 破坏（Reviewer grep + Read 核验）：

| R22 决策 | 保留位置 | R23 协同 | 结论 |
|----------|----------|----------|------|
| D1 React.memo 包裹 UserRow/RoleRow | UserRow.tsx:51（`React.memo`）/ RoleRow.tsx:15（`React.memo`） | R23 未改 UserRow/RoleRow（git diff 未触及），memo 包裹保留 | ✅ 保持 |
| D3 useCallback 稳定引用 | UserListPage.tsx:91/112/155/165 + RoleListPage.tsx:94/115/140 等 | R23 useFocusTrap 内部用 `onCloseRef/submittingRef` ref 缓存最新值（useFocusTrap.ts:50-53），避免 effect 频繁重建 listener，与 R22 D3 useCallback 稳定引用模式协同（避免 modal state 变化触发列表行 re-render） | ✅ 保持 |
| D2 react-window FixedSizeList 阈值 50 行 | UserListPage.tsx:41 `VIRTUAL_LIST_THRESHOLD = 50` + RoleListPage.tsx:40 同 | R23 未改虚拟列表阈值/配置，FixedSizeList 行数 > 50 启用保留；R23 focus trap 限制在 modal 内，背景 react-window 行不可 Tab 到达（trap 范围正确），无须额外处理 react-window 行 tabindex | ✅ 保持 |
| D6 React.lazy 8 页 | App.tsx:7-15（React.lazy + Suspense 8 页） | R23 未改 App.tsx lazy 结构（git diff 未触及），React.lazy 8 页 + Suspense fallback 保留 | ✅ 保持 |
| D4 useMemo 缓存 itemData | UserListPage / RoleListPage useMemo | R23 未改 useMemo 缓存 | ✅ 保持 |

**R22 协同结论：全部保持，R23 改动未破坏 R22 性能加固成果。** useFocusTrap hook 的 ref 缓存模式（onCloseRef/submittingRef）是对 R22 D3 useCallback 稳定引用模式的正确延伸——hook 不在依赖数组放 onClose/submitting（避免 effect 频繁重建），而是用 ref 缓存最新值，与 R22 D3 "useCallback 稳定引用避免列表行 re-render" 目标一致。

## 9 · G6.5 元改进轮 Review checklist 适用性声明

R23 是**业务轮**（可访问性深化，承接 R22 retro §6 候选清单第 1 项），非元改进轮。G6.5 元改进轮 Review checklist（针对工作流/S 级教训/规则体系的元改进）**不适用于 R23 业务轮 G6 验收**。

R23 业务轮 G6 验收门禁沿用既有 G6 业务轮范式（参照 R22 G6 Review file:///workspace/mvp/docs/review/r22-frontend-performance-review.md）：三件套独立核验 + 11 AC 逐条对齐 + advisory 偏离反向同步核验 + S 级触发验证 + git diff 抽样 + 跨轮协同保持。G6.5 伪同步检测机制（R19 固化）在本轮作为 §7.4 反向同步标注的核验工具使用（§6 已核验 impl-writer 实际编辑 Tech-Spec 非伪同步），但 G6.5 checklist 本身不作为 R23 验收门禁。

## 10 · 综合结论

**verdict = pass**

**理由**：

1. **三件套全绿**：typecheck exit 0 / lint:rules exit 0 / vitest 58 files 1272 tests passed（1263 既有 + 9 新增 jest-axe，0 回归）/ e2e 22 passed（14 既有 + 8 新增 a11y，0 回归）。
2. **11 AC 全部 pass**：AC-A11y-1（8 modal role/aria-modal/aria-label 域特定）+ AC-A11y-2（ESC submitting 阻止）+ AC-A11y-3（focus trap Tab/Shift+Tab 循环 + 初次 focus）+ AC-A11y-4（focus restore 回触发按钮）+ AC-A11y-5（8 页 Tab 顺序无跳序）+ AC-A11y-6（:focus-visible #2563eb ≥ 3:1）+ AC-A11y-7（jest-axe 0 violations）+ AC-A11y-8（@axe-core/playwright 0 violations）+ AC-A11y-9（WCAG AA 色彩对比 E2E 独占）+ AC-A11y-10（既有 1263 vitest 全绿）+ AC-A11y-11（既有 14 E2E 全绿）。
3. **4 项 advisory 偏离全部闭合**（§7.1-§7.4）：D7 颜色按 spec 落地无须偏离 / D2 @types/jest-axe 版本略滞后经 jest-axe.d.ts 桥接 / D9 新增独立 a11y.spec.ts 按 spec 落地 / D4 form-based modal DOM 调整完整反向同步。
4. **S-23 第二次触发验证生效**（§3.2/§3.3 + §10.6）：5 项核验结论全部生效，PRD 两处字面假设错误（jest-axe 5.x 版本号 + `import 'jest-axe/vitest'` 子路径）在 spec 阶段即被修正，未重演 R20 vitest 1.6.1 版本核验缺口。
5. **§7.4 反向同步标注完整**（R18 S-21 + R19 G6.5 第三次大规模触发）：根因 + 修复方案 + 影响范围 + §10.4 盲区补全声明 + 性质 5 项要素全部记录，impl-writer 实际编辑 Tech-Spec（非伪同步）。
6. **impl-writer 自报准确**（S-17）：git diff --stat 13 文件与自报 1:1 对齐，无虚报/漏报/越界，tsconfig/contracts/apps/api/src/vitest.workspace.ts/playwright.config.ts 零改动。
7. **R22 性能加固成果协同保持**：React.memo（UserRow/RoleRow）+ useCallback（UserListPage/RoleListPage）+ react-window FixedSizeList 阈值 50 + React.lazy 8 页全部保留，R23 useFocusTrap ref 缓存模式与 R22 D3 稳定引用协同。

## 11 · Advisory

### 11.1 S 级教训评估（是否立 S-24）

**评估问题**：§7.4 form-based modal DOM 结构调整暴露 §10.4 预判盲区——Tech Lead 在 spec 阶段未预判"D4 改造本身（给 `<form>` 元素加 `dialog` role）会引入 aria-allowed-role 违规"，是否值得立新 S-24？

**评估结论：不建议立 S-24。** 理由：

1. **盲区性质是 ARIA 规范知识缺口，非系统性流程缺口**。S-23（第三方库版本/API 核验缺口）是跨轮系统性模式（R22 react-window 首次 + R23 jest-axe 第二次同形触发），值得固化；而 §7.4 的 aria-allowed-role 是 ARIA 1.2 规范的特定知识点（form 元素不允许 dialog role），属一次性知识缺口，非跨轮重复模式。
2. **axe 双轨自动检测是设计内的安全网，按预期工作**。R23 引入 jest-axe + @axe-core/playwright 双轨的核心目的之一就是自动检测 WCAG/ARIA 违规。impl-writer 在 impl 阶段运行 jest-axe 即时捕获 aria-allowed-role 违规 → 修复 → 反向同步 §7.4，这正是双轨 axe 检测的设计闭环。若为每类 axe 规则（aria-allowed-role / color-contrast / label / region 等）立独立 S 级，将过度膨胀 S 级教训体系。
3. **R18 S-21 + R19 G6.5 已覆盖响应机制**。impl-writer 发现 spec 盲区 → 实际编辑 Tech-Spec §7.x 反向同步 → Reviewer G6 核验闭合，该机制在本轮第三次大规模触发且工作正常（§7.4 完整闭合），无须新增 S 级固化响应流程。
4. **无跨轮传播风险**。修复局部于 R23 的 4 个 form-based modal，未跨轮传播；D4 的 aria-label 域特定命名清单 + role/aria-modal/aria-label 四项核心要求全部落地，仅 DOM 结构调整，影响范围可控。
5. **§10.4 盲区已在 §7.4 显式声明补全**。§7.4 line 542 已记录"§10.4 原预判未预判 D4 改造本身引入 aria-allowed-role 违规"的盲区补全声明，未来 Tech Lead 在类似 spec（给既有 HTML 元素加 ARIA role）时可参照 §7.4 案例自查，无须独立 S 级提示。

**结论**：S-23 已在本轮第二次触发验证生效（§5），无须新增 S-24。§7.4 form-based modal DOM 结构调整 advisory 已闭合。S 级教训体系保持精简（S-23 跨轮版本/API 核验 + R18 S-21 反向同步 + R19 G6.5 伪同步检测 已覆盖本轮所有触发的响应闭环）。

### 11.2 改进建议（非 BLOCKING，advisory）

1. **form-based modal 包裹后缩进对齐（cosmetic）**：4 个 form-based modal（SetParentModal/RoleForm/DeptForm/NotificationForm）改为 `<div role="dialog">` 包 `<form>` 后，`<h2>` 及 form 子元素未重新缩进对齐（仍保留原 `<form>` 子元素的缩进层级）。功能零影响（DOM 结构正确），仅代码可读性。建议未来轮次 prettier/统一格式化时顺带处理，无须本轮修复。
2. **a11y.test.tsx NotificationForm 仅覆盖 create 模式**：a11y.test.tsx 的 NotificationForm 用例仅测 `mode="create"`（aria-label="创建通知"），未覆盖 `mode="edit"`（aria-label="编辑通知"）。create 模式 0 violations 已证明 ARIA 合规，edit 模式仅 aria-label 文案差异（动态 aria-label），违规风险等价。建议未来可补 edit 模式用例提升覆盖度，非本轮 BLOCKING。
3. **a11y.test.tsx region 规则组件级禁用 [advisory]**：a11y.test.tsx:84-91 禁用 region 规则（组件级无完整 landmark 结构），由 a11y.spec.ts E2E 页面级覆盖 region。该分工已在测试注释 + Tech-Spec §4.7 声明，合理。建议未来若组件级测试须覆盖 region，可包装 `<main>` 容器，非本轮范围。

### 11.3 闭合声明

- **S-23 第二次触发验证**：生效（§5），无须新增 S 级。
- **§7.4 form-based modal DOM 结构调整 advisory**：已闭合（§4.4 + §6）。
- **R18 S-21 反向同步 + R19 G6.5 伪同步检测**：第三次大规模触发，工作正常（§6）。
- **R22 性能加固成果协同**：保持（§8）。

---

**报告完成。verdict = pass，R23 可访问性深化业务轮 G6 验收通过。**
