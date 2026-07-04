---
doc_type: Tech-Spec
id: TECH-FRONTEND-PERFORMANCE-001
title: R22 前端性能加固（React.memo + react-window 1.x + React.lazy）+ 顺带闭合 R20 Review 5 项 Suggestion Tech-Spec
prd_ref: PRD-FRONTEND-PERFORMANCE-001
status: ready-for-impl
owner: tech-lead@team
created: 2026-07-04
extends: TECH-WEB-AUTH-USER-001
aligns: [TECH-WEB-ROLE-DEPT-AUDIT-001, TECH-WEB-NOTIFICATION-REPORT-001, TECH-WEB-TRANSFER-INHERITANCE-001, TECH-E2E-INTRODUCTION-001]
---

# TECH-FRONTEND-PERFORMANCE-001 · R22 前端性能加固 Tech-Spec

> 派生自 PRD-FRONTEND-PERFORMANCE-001（status=decided，15 条 AC：AC-P1~P10 共 10 条性能 + AC-S20-1~S20-5 共 5 条 R20 Suggestion 闭合 + 3 条 BLOCKING Q&A 全拍板）。
> 本轮承接 R21 retro §6 候选清单第 1 项——前端性能加固。三项改进：①React.memo + useMemo + useCallback ②react-window 虚拟列表 ③React.lazy + Suspense 代码分割。顺带闭合 R20 Review 5 项 Suggestion。
> **S-23 首次触发验证**（R21 固化）：Tech Lead 在 §2.3 依赖决策前实际核验 react-window npm registry dist-tags + 版本元数据，发现 BA Q2 字面"react-window 8.x"存在版本号语义误判（1.8.x 中"8"是 minor 非 major，无 8.x 系列），且 npm latest tag 指向 2.2.7（2.x 重写删除 FixedSizeList）。Tech Lead 据核验结果修正为 react-window@1.8.11 + @types/react-window@1.8.x（§2.3 D2 决策）+ §10.6 反向同步标注。
> **contracts 本轮零变更**（§5）；**errors.ts 零变更**；**errorMapping.ts 零变更**；**server.ts / domain / repository / service 零变更**。改动范围：apps/web/src/ 前端层（组件 memo + 页面 useMemo/useCallback + App.tsx lazy + UserListPage/RoleListPage react-window）+ apps/e2e/tests/roles.spec.ts AC-E7 强断言 + e2e-introduction.tech.md 文档同步 + apps/web/package.json 新增依赖。

## 1. 覆盖范围

### 1.1 性能加固三方向（PRD AC-P1~P10）

**方向 1：React.memo + useMemo + useCallback**（AC-P1~P3）
- 行组件 `React.memo` 包裹：`UserRow` + 角色列表行（当前 `RoleListPage` 内联 `<tr>` 须提取为 `RoleRow` 组件再 memo）
- 回调 `useCallback` 稳定引用：`UserListPage.handleToggleStatus` / `handleToggleRoles` / `handleViewEffectivePermissions` / `RoleListPage.handleDelete` / `handleUnsetParent` / `handleSetParentUpdated` 等
- 派生值 `useMemo` 缓存：`RoleListPage.filteredItems`（L165-168 客户端搜索过滤，每次 render 重算 → useMemo 缓存）

**方向 2：react-window 虚拟列表**（AC-P4~P6）
- `UserListPage` / `RoleListPage` 行数 > 阈值时启用 `react-window FixedSizeList`（仅渲染可视区行）
- 行数 ≤ 阈值回退普通 `items.map` 渲染（避免小列表引入 react-window 不必要开销）
- 阈值决策（D5）：50 行（PRD Q1 不定具体阈值，属 Tech Lead 实现细节）

**方向 3：React.lazy + Suspense 代码分割**（AC-P7~P8）
- `App.tsx` 7 页路由 `React.lazy` 包裹 + `Suspense` fallback（首屏仅加载 /login chunk，其他页按需加载）
- fallback 文案"加载中..."（与既有 loading 文案一致）

### 1.2 R20 Review 5 项 Suggestion 闭合（PRD AC-S20-1~S20-5）

| # | AC | 闭合方式 | 改动文件 |
|---|---|---|---|
| 1 | AC-S20-1 AC-E7 强断言 | `apps/e2e/tests/roles.spec.ts` AC-E7 增 API GET `/v1/roles/:id` 复核 `parent_id === roleA.id`（参照 AC-E11 模式） | `apps/e2e/tests/roles.spec.ts` |
| 2 | AC-S20-2 retries=0 偏离同步 | `docs/spec/e2e-introduction.tech.md` §7 增 retries=0 偏离 spec §3.2 字面理由（[advisory] 范围，E2E 14 passed 证明可行） | `docs/spec/e2e-introduction.tech.md` |
| 3 | AC-S20-3 devDeps 描述修正 | `docs/spec/e2e-introduction.tech.md` §2.3 修正"@playwright/test 已在 devDependencies"为"本轮新增 @playwright/test devDep" | `docs/spec/e2e-introduction.tech.md` |
| 4 | AC-S20-4 stale Admin@123 消除 | `docs/spec/e2e-introduction.tech.md` §7.2/§2.4 更新"PRD AC-E1 字面 Admin@123"为"PRD AC-E1 已修正为 admin123" | `docs/spec/e2e-introduction.tech.md` |
| 5 | AC-S20-5 task 文件数修正 | 本轮 task 文件数字与 impl-writer 自报清单一致（R20 修正历史 task 描述，本轮 task 直接准确） | （本轮 task 描述准确，无历史文件改） |

### 1.3 不改 contracts / errors / server（零联动）

本轮 **contracts 零变更**（§5）、**errors.ts 零变更**、**errorMapping.ts 零变更**、**server.ts / router / service / repository / domain 零变更**。所有改动在前端层（apps/web/src/）+ E2E 测试增强（apps/e2e/tests/roles.spec.ts）+ 文档同步（e2e-introduction.tech.md）。ARCH-002（contracts 纯净层）保持，ARCH-001（四层反向依赖）不触发（无 src/ 业务文件改动，仅前端层）。

## 2. 既有现状核验（关键资产盘点）

> R10 S-2 教训：Spec 须核验既有现状。本节核验 6 项关键资产，确认改动边界。

### 2.1 apps/web/src/components/UserRow.tsx 现状（无 memo）

`UserRow`（73 行）是简单函数组件，无 `React.memo` 包裹。props 含 `user` + 3 个回调（`onToggleStatus` / `onToggleRoles` / `onViewEffectivePermissions`）。父组件 `UserListPage` 每次 render 重建回调引用，即便包裹 memo 也无效（props 引用变化）。

**改动点**：`UserRow` 包裹 `React.memo`（§3.1 D1）+ `UserListPage` 回调改 `useCallback`（§3.3 D3）。

### 2.2 apps/web/src/pages/RoleListPage.tsx 现状（行内联 + filteredItems 重算）

`RoleListPage`（288 行）行内联 `<tr>` 渲染（L205-245，未提取为独立组件），无法直接 memo。`filteredItems`（L165-168）每次 render 重算：

```tsx
const keyword = searchKeyword.trim().toLowerCase();
const filteredItems = keyword
  ? items.filter((r) => r.name.toLowerCase().includes(keyword))
  : items;
```

**改动点**：提取 `RoleRow` 组件 + `React.memo` 包裹（§3.1 D2）+ `filteredItems` 改 `useMemo`（§3.4 D4）。

### 2.3 apps/web/src/App.tsx 现状（全静态 import 7 页）

`App.tsx`（93 行）全静态 import 7 页（L6-16），首屏加载全部 chunk：

```tsx
import { LoginPage } from './pages/LoginPage.js';
import { UserListPage } from './pages/UserListPage.js';
// ... 7 页全部静态 import
```

**改动点**：改 `React.lazy` 动态 import + `Suspense` 包裹（§3.5 D6）。

### 2.4 apps/web/vite.config.ts 现状（无代码分割配置）

`vite.config.ts`（18 行）无 `build.rollupOptions.output.manualChunks` 配置，默认 vite 自动代码分割。`React.lazy` 引入后 vite 自动按动态 import 切 chunk，无需改 vite.config.ts。

**改动点**：零变更（vite 自动处理 React.lazy chunk 切分）。

### 2.5 apps/web/package.json 现状（无 react-window 依赖）

`apps/web/package.json` dependencies：`react ^18.3.0` / `react-dom ^18.3.0` / `react-router-dom ^6.26.0`。devDependencies：`@testing-library/*` / `@types/react` / `@types/react-dom` / `@vitejs/plugin-react` / `jsdom` / `typescript` / `vite` / `vitest`。**无 react-window**。

**改动点**：dependencies 新增 `react-window` + devDependencies 新增 `@types/react-window`（§2.3 D2 S-23 核验决策）。

### 2.6 apps/e2e/tests/roles.spec.ts 现状（AC-E7 弱断言）

`roles.spec.ts` AC-E7（L56-101）page.route 拦截 POST `/v1/roles/*/parent` 强断言 If-Match header，但设置成功后仅断言 modal 关闭（L100 `parentSelect.not.toBeVisible`），未直接验证 DB 中 `parent_id` 已更新。

**改动点**：AC-E7 增 API GET `/v1/roles/:id` 复核 `parent_id === roleA.id`（参照 AC-E11 模式，§3.6 AC-S20-1）。

## 3. 实现方案（React.memo + react-window 1.x + React.lazy）

> 每节显式标注 `[约束]`（默认禁止偏离，偏离须经 AI-003 流程 + Reviewer 确认）或 `[advisory]`（允许偏离，须反向同步 §7）。本节为设计 + 实现提示，不写实现代码（impl-writer 职责）。

### 3.1 `[约束]` React.memo 包裹行组件（D1 UserRow + D2 RoleRow 提取）

**D1：UserRow memo 包裹**（AC-P1）

`UserRow` 当前是 `export function UserRow(props: UserRowProps): JSX.Element`，改为 `export const UserRow = React.memo(function UserRow(props: UserRowProps): JSX.Element { ... })`。memo 浅比较 props（`user` 对象引用 + 3 个回调引用），若引用未变则跳过 re-render。

**D2：RoleRow 提取 + memo 包裹**（AC-P1）

`RoleListPage` 当前行内联 `<tr>`（L205-245），提取为独立 `RoleRow` 组件：

```tsx
// apps/web/src/components/RoleRow.tsx（新增）
export type RoleRowProps = {
  role: Role;
  onDelete: (role: Role) => void;
  onSetParent: (role: Role) => void;
  onUnsetParent: (role: Role) => void;
  onViewChain: (roleId: string) => void;
};
export const RoleRow = React.memo(function RoleRow(props: RoleRowProps): JSX.Element { ... });
```

`RoleListPage` 改用 `<RoleRow .../>` 替代内联 `<tr>`。

### 3.2 `[约束]` react-window 1.8.11 虚拟列表（D2 S-23 核验决策）

**D2 决策（S-23 核验）：react-window@1.8.11 + @types/react-window@1.8.8**

> **[R22 §10.6 S-23 反向同步]**：BA Q2 字面写"react-window 8.x"，Tech Lead 实际核验 npm registry dist-tags 发现：
> - **react-window 不存在 8.x 系列**——1.8.x 中"8"是 MINOR 版本号，属 1.x 系列（1.0.0 → 1.8.11）
> - **npm latest tag 指向 2.2.7**（2.x 是重大重写，删除 FixedSizeList，改用 List + rowComponent）
> - **1.x 最新稳定版是 1.8.11**（2024-12 发布，peerDeps 含 React 18/19）
> - **1.x 非原生 TypeScript**（源码 Flow 类型），须装 `@types/react-window`（DefinitelyTyped）
> - **2.x 原生 TypeScript** 但 API 重写（FixedSizeList 已删），迁移成本高
> - **@types/react-window 1.x 最新只到 1.8.8**（非与 react-window 主版本严格对齐，@types 最新 1.8.8 + 2.0.0 stub）
>
> Tech Lead 据核验结果修正为 `react-window@1.8.11` + `@types/react-window@1.8.8`（1.x API 稳定，FixedSizeList 可用，peerDeps 兼容 React 18.3）。**实测验证**：`npm --workspace @admin/web install react-window@1.8.11 @types/react-window@1.8.8 --save` 安装成功 + `npm run typecheck` exit 0（TS 类型可用），S-23 核验闭环。若按 BA Q2 字面"8.x"假设装 latest（2.2.7），将导致 API 完全不符（FixedSizeList 不存在）→ impl 阶段才发现，重演 R20 vitest 1.6.1 版本核验缺口。**S-23 固化机制在 R22 首次触发验证生效**——Tech Lead 在 spec 阶段预先核验版本 + 实测安装验证 + §10.6 反向同步标注，避免 impl 阶段才发现。

**FixedSizeList API（1.8.11，核验来源：npm registry + CHANGELOG）**：

```tsx
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={600}              // 容器高度（px）
  itemCount={items.length}  // 列表项总数
  itemSize={48}             // 每项高度（px，固定行高）
  width="100%"              // 容器宽度
  itemData={items}          // 透传给 children render prop 的数据
  overscanCount={5}         // 预渲染缓冲行数
>
  {({ index, style, data }) => (
    <div style={style}>      {/* ⚠️ 必须透传 style 到根 DOM，否则列表空白（FAQ 最常见坑）*/}
      <UserRow user={data[index]} ... />
    </div>
  )}
</FixedSizeList>
```

**关键约束（impl-writer 须遵守）**：
- `[约束]` children render prop 须透传 `style` 到根 DOM（react-window 通过绝对定位实现虚拟化，忘记透传导致列表空白）
- `[约束]` `itemData` 须 `useMemo` 缓存（父组件每次 render 重建 itemData → 子行 memo 失效）
- `[约束]` 回调须 `useCallback` 缓存（同上，避免 memo 失效）
- `[约束]` ref 守卫：`if (listRef.current) { listRef.current.scrollToItem(idx) }`（React 18 StrictMode dev 下 ref 双调用 null）

### 3.3 `[约束]` useCallback 稳定回调引用（D3）

`UserListPage` / `RoleListPage` 的回调改 `useCallback`：

```tsx
// UserListPage（AC-P2）
const handleToggleStatus = useCallback(async (user: User) => { ... }, [page, statusFilter]);
const handleToggleRoles = useCallback((user: User) => { ... }, []);
const handleViewEffectivePermissions = useCallback((user: User) => { ... }, []);
```

**依赖数组约束**：`[约束]` 依赖数组须完整（ESLint react-hooks/exhaustive-deps 规则），不可省略依赖（如 `handleToggleStatus` 依赖 `page` + `statusFilter`，因 `refresh` 内部用这俩）。

### 3.4 `[约束]` useMemo 缓存派生值（D4 filteredItems）

`RoleListPage.filteredItems` 改 `useMemo`：

```tsx
// RoleListPage（AC-P3）
const filteredItems = useMemo(() => {
  const keyword = searchKeyword.trim().toLowerCase();
  return keyword ? items.filter((r) => r.name.toLowerCase().includes(keyword)) : items;
}, [items, searchKeyword]);
```

**依赖数组**：`[items, searchKeyword]`（ESLint react-hooks/exhaustive-deps）。

### 3.5 `[约束]` React.lazy + Suspense 代码分割（D6）

`App.tsx` 改 `React.lazy` 动态 import + `Suspense` 包裹：

```tsx
// App.tsx（AC-P7/P8）
import { lazy, Suspense } from 'react';
const LoginPage = lazy(() => import('./pages/LoginPage.js').then(m => ({ default: m.LoginPage })));
const UserListPage = lazy(() => import('./pages/UserListPage.js').then(m => ({ default: m.UserListPage })));
// ... 7 页全部 lazy

export function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<div>加载中...</div>}>
        <Routes> ... </Routes>
      </Suspense>
    </AuthProvider>
  );
}
```

**关键约束**：
- `[约束]` `React.lazy` 须用 `.then(m => ({ default: m.XxxPage }))` 转换 named export 为 default export（lazy 仅支持 default export）
- `[约束]` Suspense fallback 文案"加载中..."（与既有 loading 文案一致，避免新文案破坏既有测试断言）

### 3.6 `[约束]` AC-E7 强断言增强（D7 AC-S20-1）

`apps/e2e/tests/roles.spec.ts` AC-E7（L56-101）在设置父角色成功后增 API GET 复核：

```ts
// roles.spec.ts AC-E7（参照 AC-E11 模式）
// 设置成功后，API GET /v1/roles/:id 复核 parent_id === roleA.id（强断言替代 modal 关闭弱断言）
const updated = await apiGetRole(apiContext, roleB.id);
expect(updated.parent_role_id).toBe(roleA.id);  // 强断言：DB 中 parent_id 已更新
```

**关键约束**：
- `[约束]` 强断言（API GET 复核 parent_id）替代弱断言（modal 关闭），参照 AC-E11 模式（AC-E11 用 API GET 复核 department_id）
- `[约束]` If-Match header 强断言保留（不删除既有 page.route 拦截断言）

### 3.7 `[约束]` e2e-introduction.tech.md 文档同步（D8 AC-S20-2/3/4）

`docs/spec/e2e-introduction.tech.md` 三处文档同步：

- **§2.3 devDeps 描述修正**（AC-S20-3）：将"@playwright/test 已在 devDependencies（^1.61.1）"修正为"本轮新增 @playwright/test devDep（^1.61.1）"（消除"已在"误差，实际 R20 才加入 devDeps）
- **§7.2/§2.4 stale Admin@123 消除**（AC-S20-4）：将"PRD AC-E1 字面 Admin@123"更新为"PRD AC-E1 已修正为 admin123"（消除 stale 描述，PRD 已被 R20 编排者修正）
- **§7 retries=0 偏离同步**（AC-S20-2）：§7 增"retries=0 偏离 spec §3.2 字面 `retries: CI ? 2 : 0` 的理由——impl-writer 取 retries=0 简化（task spec 要求），E2E 14 passed 证明可行；[advisory] 范围，加性安全场景（更严格非更弱），本轮 R22 收尾闭合"

## 4. D1-D8 决策汇总

| 决策 | 内容 | 性质 |
|------|------|------|
| D1 | UserRow React.memo 包裹 | `[约束]` |
| D2 | react-window@1.8.11 + @types/react-window@1.8.x（S-23 核验修正 BA Q2 "8.x" 误判）+ RoleRow 提取 memo | `[约束]` + `[R22 §10.6 S-23 反向同步]` |
| D3 | useCallback 稳定回调引用（UserListPage / RoleListPage） | `[约束]` |
| D4 | useMemo 缓存 filteredItems（RoleListPage） | `[约束]` |
| D5 | react-window 启用阈值 50 行（行数 > 50 启用 FixedSizeList，≤ 50 普通 map） | `[advisory]`（阈值数字属实现细节，BA Q1 不定具体阈值） |
| D6 | React.lazy + Suspense 代码分割 7 页 | `[约束]` |
| D7 | AC-E7 增 API GET 复核 parent_id 强断言 | `[约束]` |
| D8 | e2e-introduction.tech.md 三处文档同步（§2.3 devDeps + §7.2/§2.4 Admin@123 + §7 retries 偏离） | `[约束]` |

## 5. 受影响清单（AI-006 两类标注）

### 5.1 ①类显式影响（grep 符号引用）

| 文件 | 影响类型 | 说明 |
|------|----------|------|
| `apps/web/src/components/UserRow.tsx` | ②类重构 | React.memo 包裹（D1） |
| `apps/web/src/components/RoleRow.tsx`（新增） | ③类新增 | RoleRow 组件提取 + memo（D2） |
| `apps/web/src/pages/UserListPage.tsx` | ②类重构 | useCallback + react-window FixedSizeList（D3+D2） |
| `apps/web/src/pages/RoleListPage.tsx` | ②类重构 | useMemo + useCallback + react-window + RoleRow 引用（D2+D3+D4） |
| `apps/web/src/App.tsx` | ②类重构 | React.lazy + Suspense（D6） |
| `apps/web/package.json` | ③类新增 dep | react-window@^1.8.11 + @types/react-window@^1.8.x（D2） |
| `apps/e2e/tests/roles.spec.ts` | ②类改造 | AC-E7 增 API GET 复核 parent_id（D7） |
| `docs/spec/e2e-introduction.tech.md` | ②类改造 | §2.3+§7.2+§2.4+§7 文档同步（D8） |

### 5.2 ①类隐式影响（全集断言依赖枚举值）

**0 文件**。本轮无 errorCodeSchema / 域 schema 扩展，无全集断言失效风险。

### 5.3 ②类签名变更

**0 文件**。UserRow / RoleListPage / App.tsx 改动是内部实现重构，对外签名（export 的组件名 + props 类型）不变。

### 5.4 测试影响

| 文件 | 影响类型 | 说明 |
|------|----------|------|
| `apps/web/test/**/*.test.tsx`（既有） | ②类配置驱动验证 | memo/useCallback/useMemo 改动后须全绿（AC-P9），断言本身不改（除非 memo 改变 render 行为） |
| `apps/web/test/performance.test.tsx`（新增） | ③类新增 | 性能专项测试：React.memo 落地核验（UserRow 包裹 memo）+ react-window FixedSizeList 渲染核验 + React.lazy chunk 产物核验 |
| `apps/e2e/tests/roles.spec.ts` | ②类改造 | AC-E7 强断言增强（D7） |
| 既有 14 E2E | ②类验证 | react-window 虚拟列表可能改变 DOM 结构（行可能不在 viewport），E2E 须适配（AC-P10） |

## 6. 不改 contracts / errors / server（零联动）

- **contracts 零变更**：无 errorCodeSchema / 域 schema 改动（ARCH-002 保持）
- **errors.ts 零变更**：无错误码新增
- **errorMapping.ts 零变更**：无前端错误码映射改动
- **server.ts / router / service / repository / domain 零变更**：无后端改动
- **ARCH-001 不触发**：无 src/ 业务文件改动（仅前端层 apps/web/src/）
- **ARCH-003 保持**：apps/web/ 不 import apps/api/src/**（本轮不引入跨层依赖）

## 7. advisory 偏离反向同步

### 7.1 D5 react-window 启用阈值 50 行（[advisory]）

D5 阈值 50 行属实现细节（BA Q1 不定具体阈值），[advisory] 允许 impl-writer 据实际性能测试调整阈值（如 30 / 100）。impl-writer 若偏离 50 行阈值，须在交付报告列"偏离理由 + 调整后阈值 + 合规论证"。

### 7.2 D2 react-window 版本核验（[R22 §10.6 S-23 反向同步]）

D2 react-window@1.8.11（非 BA Q2 字面"8.x"）属 S-23 触发的 Tech Lead 版本核验修正，已在 §3.2 + §2.3 + §10.6 标注。impl-writer 据此版本落地，若 impl 阶段发现 1.8.11 API 与 spec 不符（极低概率，已核验），按 §10.6 "impl-writer 须修复（非静默跳过）"落地并反向同步 Spec。

## 8. 风险预判

### 8.1 react-window 虚拟列表改变 DOM 结构（E2E 适配风险）

react-window FixedSizeList 用 `<div>` 包裹行（非 `<tr>`），可能破坏既有 E2E 测试的 `table` / `tr` / `td` 选择器。

**缓解**：E2E 测试（AC-P10）须适配——若 UserListPage 行数 ≤ 50（普通 map），DOM 结构不变（`<table><tr><td>`）；若 > 50（FixedSizeList），E2E 须用 `getByRole('row')` 或 `getByText` 而非 `table > tr` 选择器。impl-writer 须在 E2E 测试中确保两种渲染路径都被覆盖（或测试数据控制行数 ≤ 50 保持既有 DOM 结构）。

### 8.2 React.lazy chunk 加载延迟（E2E 超时风险）

React.lazy 动态 import 首次加载有网络延迟，E2E 测试可能因 chunk 加载超时失败。

**缓解**：E2E 测试（AC-P10）须增加 `waitFor` 等待 chunk 加载（或 Playwright `waitForSelector`）。vite dev server chunk 加载通常 < 100ms，不触发超时。

### 8.3 React.memo 改变 useEffect 依赖行为

React.memo 包裹组件后，若 useEffect 依赖数组含对象引用，memo 改变引用行为可能导致 useEffect 不触发或过度触发。

**缓解**：impl-writer 须检查 UserRow / RoleRow 内部是否有 useEffect（当前无），若有须确保依赖数组用原始值（如 `user.id`）非对象引用（`user`）。

## 9. §10 组合副作用预判（R18 S-21 + R21 S-23 固化）

### 10.1 多约束组合（4 条工程层）

- `[约束]` React.memo + useCallback + useMemo 组合（D1+D3+D4）：memo 包裹行组件须配合 useCallback（回调稳定引用）+ useMemo（itemData 缓存），否则 memo 失效（react-window FAQ 最常见坑）
- `[约束]` react-window FixedSizeList + style 透传（D2）：children render prop 须透传 style 到根 DOM，否则列表空白
- `[约束]` React.lazy + Suspense fallback 文案一致（D6）：fallback"加载中..."与既有 loading 文案一致，避免破坏既有测试断言
- `[约束]` E2E 适配虚拟列表 DOM 结构变化（§8.1）：测试数据控制行数 ≤ 50 保持既有 DOM 结构，或 E2E 选择器适配

### 10.2 全码映射收尾（N/A，R16 S-18）

errorMapping.ts 零变更，无全集定义风险。

### 10.3 简单常量复用（N/A，R16 S-19）

react-window 阈值 50 行（D5）单处使用，符合 S-19 ≤3 处阈值。

### 10.4 测试工具限制（N/A，R16 S-20）

无测试工具 workaround 需求。

### 10.5 [约束] 偏离反向同步闭环性（R18 S-21）

本轮无 [约束] 偏离预判（所有 [约束] 决策 D1-D4/D6-D8 均按 spec 落地）。D5 阈值属 [advisory] 非 [约束]。impl-writer 若实现期发现 [约束] 偏离须按 S-21 实际编辑 Spec + 交付报告列行号。

### 10.6 第三方库版本 API 差异（R21 S-23 触发 + 反向同步）

**[R22 §10.6 S-23 首次触发验证生效]**：BA Q2 字面"react-window 8.x"存在版本号语义误判，Tech Lead 实际核验 npm registry dist-tags 发现：
- react-window 不存在 8.x 系列（1.8.x 中"8"是 MINOR）
- npm latest tag 指向 2.2.7（2.x 重写删除 FixedSizeList）
- 1.x 最新稳定版 1.8.11（peerDeps 含 React 18/19）
- 1.x 非原生 TypeScript，须装 @types/react-window@1.8.x

Tech Lead 据核验修正为 react-window@1.8.11 + @types/react-window@1.8.x（D2），§3.2 + §2.3 + 本节反向同步标注。**S-23 固化机制在 R22 首次触发验证生效**——Tech Lead 在 spec 阶段预先核验版本 + 反向同步 Spec，避免 impl 阶段才发现 API 差异（R20 vitest 1.6.1 版本核验缺口重演被规避）。

### 10.7 替代方案预判（§10.6 衍生）

若 impl 阶段发现 react-window 1.8.11 API 与 spec 不符（极低概率，已 S-23 核验），退回方案：
- **方案 A**（推荐）：`@tanstack/react-virtual@3.14.3`（headless hook useVirtualizer，原生 TS，动态行高支持，包体 ~10KB）
- **方案 B**：手写虚拟列表（IntersectionObserver + 绝对定位，无依赖，但实现成本高）
- **方案 C**：降低 react-window 启用阈值（如阈值改 200 行，实际不触发虚拟列表，保留 memo + lazy 两项改进）

## G3 自检声明

- **tsc 编译**：本轮无 contracts/errors 改动，tsc 须通过（impl-writer 阶段验证）
- **Spec 与契约 1:1**：本轮无 contracts 改动，无 1:1 校验需求
- **边界覆盖**：§1 覆盖范围明确（性能三方向 + R20 Suggestion 5 项）+ §2 既有现状核验（6 项资产）+ §5 受影响清单（AI-006 两类标注完整）
- **受影响清单两类完整**：§5.1 ①类显式影响（8 文件）+ §5.2 ①类隐式影响（0 文件）+ §5.3 ②类签名变更（0 文件）+ §5.4 测试影响（4 类）
- **§10 组合副作用预判完整**：§10.1-§10.7 七项预判，含 S-21（§10.5）+ S-23（§10.6）+ 替代方案（§10.7）
- **S-23 首次触发验证生效**：D2 react-window 版本核验 + §3.2 + §10.6 反向同步标注，Tech Lead 在 spec 阶段实际核验 npm registry dist-tags
- **advisory 偏离反向同步**：§7.1 D5 阈值 + §7.2 D2 版本核验（S-23 衍生）
