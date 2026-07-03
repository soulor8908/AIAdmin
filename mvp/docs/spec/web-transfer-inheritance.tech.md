---
doc_type: Tech-Spec
id: TECH-WEB-TRANSFER-INHERITANCE-001
title: 前端调岗管理页 + 角色继承管理（R16 前端补齐后端能力前端化）Tech-Spec
prd_ref: PRD-WEB-TRANSFER-INHERITANCE-001
status: ready
owner: tech-lead@team
created: 2026-07-03
extends: TECH-WEB-NOTIFICATION-REPORT-001
aligns: [TECH-TRANSFER-001, TECH-ROLE-INHERITANCE-001]
---

# TECH-WEB-TRANSFER-INHERITANCE-001 · 前端调岗管理页 + 角色继承管理 Tech-Spec

> 派生自 PRD-WEB-TRANSFER-INHERITANCE-001（status=decided，10 个 BLOCKING Q&A 已拍板，46 条 AC，含 BA 核验发现 T1~T4 contracts SSOT 偏离 + AC↔测试覆盖矩阵）。
> **契约层本轮无新增**：packages/contracts 已就绪（transfer 契约在 R7 落地、role-inheritance 契约在 R8 落地），前端全部复用既有 Zod schema + z.infer 类型。本 Spec 不改 contracts。
> **后端本轮冻结**：不改 service/repo/domain/router/server.ts（后端 R1-R15 用例基线全绿，PRD 明示"不改后端"）。
> **前端基础设施零新增**：R12 已落地 api/client.ts（Bearer/If-Match/401 拦截/409 重试/wire 适配 + R15 D8 query string[]）、auth/（tokenStore/AuthContext/RouteGuard）、components/ErrorBanner、lib/errorMapping；R14 已扩展角色/部门/审计三域；R15 已扩展通知/报表两域；R16 仅新增 api 模块 + pages + components，零新依赖。
> 本阶段只产本文档；apps/web 源码改动由 impl-writer 阶段落地（§6/§7 描述为设计 + [advisory] 实现提示）。
> R16 核心验证点：前端补齐后端能力前端化（闭合 transfer + role-inheritance 两域）+ 事务性单端点前端模式（transfer）+ versioned 写 + superRefine + 环检测组合（role-inheritance）+ 裸数组 Role[]/PermissionCode[] 只读响应展示 + errorMapping 全码映射收尾（R14 S-11 同步注释闭合）。

## 1. 覆盖范围与既有端点核验（R10 S-2 / R13 S-1 教训闭合）

R10 S-2 教训：Spec 须核验既有路由表，确认前端调用的端点均存在、非覆盖既有路由。本节核验 `apps/api/src/server.ts` routes 数组（L248~L315），R16 涉及端点已由 BA 核验（PRD BA 核验发现 T1~T4）。

### 1.1 前端调用端点清单（逐条核验）

| # | 端点 | method | server.ts 行 | auth | versioned | cacheable | 核验结论 |
|---|------|--------|--------------|------|-----------|-----------|----------|
| E1 | `/v1/users/:userId/transfer` | POST | L249-261 | admin | **false** | false | 存在，**非 versioned**（defineRoute 第 5 参缺省 false，T4），不传 If-Match；事务性单端点（withTransaction 包裹 A/B/C 三步）；body={toDepartmentId, oldRoleId, newRoleId}，userId 在 path，buildInput 从 path+body 合并（对齐 assignRoleInputSchema/assignUserDepartmentInputSchema 风格，T4） |
| E2 | `/v1/roles/:roleId/parent` | POST | L293-300 | admin | **true** | false | 存在，versioned=true（须 If-Match header，复用 R12 D7/D9，T3）；body={parentRoleId}，roleId 在 path；setParent |
| E3 | `/v1/roles/:roleId/parent` | DELETE | L301-305 | admin | **true** | false | 存在，versioned=true（须 If-Match，复用 R12 D7/D9，T3）；body 空，roleId 在 path；unsetParent |
| E4 | `/v1/roles/:roleId/inheritance-chain` | GET | L306-310 | admin | false | **false** | 存在，**非 cacheable**（defineRoute 第 6 参 cacheable 未传，T3），不发 If-None-Match；返回裸 `Role[]` 祖先数组（无 envelope） |
| E5 | `/v1/users/:userId/effective-permissions` | GET | L311-315 | admin | false | **false** | 存在，**非 cacheable**（T3），不发 If-None-Match；返回裸 `PermissionCode[]` 集合（无 envelope） |

核验结论：**前端调用的 5 个端点全部存在于既有路由表**，本轮不新增任何后端端点。R10 S-2 教训闭合。**transfer 1 端点非 versioned 非 cacheable**（T4 事务性单端点）；**角色继承 4 端点**：2 versioned 写（setParent/unsetParent）+ 2 非 cacheable GET（inheritance-chain/effective-permissions，T3）。

### 1.2 BA 核验发现 T1~T4 偏离在 Spec 的遵循（contracts SSOT 优先）

PRD BA 核验发现 4 处任务描述与 contracts SSOT 偏离，本 Spec 一律以 contracts SSOT 为准：

| # | 偏离措辞 | contracts SSOT 实际 | Spec 遵循点 |
|---|---------|---------------------|-------------|
| T1 | "调岗错误码 TRANSFER_USER_NOT_FOUND / TRANSFER_DEPT_NOT_FOUND / TRANSFER_ROLE_NOT_FOUND / TRANSFER_ROLE_BUILTIN_FORBIDDEN" | errorCodeSchema（user.ts L119-210）**无** TRANSFER_USER_NOT_FOUND / TRANSFER_DEPT_NOT_FOUND / TRANSFER_ROLE_NOT_FOUND / TRANSFER_ROLE_BUILTIN_FORBIDDEN 这些码——调岗时引用实体不存在复用各域既有码：`USER_NOT_FOUND` / `DEPT_NOT_FOUND` / `ROLE_NOT_FOUND`；oldRole 为内置角色复用 `ROLE_BUILTIN_FORBIDDEN`（非 transfer 专属码）；transfer 专属码仅 4 个：`TRANSFER_SAME_ROLE`（superRefine）、`TRANSFER_OLD_ROLE_NOT_ASSIGNED`、`TRANSFER_COMPENSATION_FAILED`、`TRANSFER_FAILED`（聚合码，校验阶段错误码直接传播不聚合） | §3.2 表单校验（superRefine TRANSFER_SAME_ROLE）+ §11 错误码矩阵（T1 真实码）+ D19 [约束] |
| T2 | "ROLE_INHERITANCE_NOT_FOUND" | errorCodeSchema **无** ROLE_INHERITANCE_NOT_FOUND 码——角色继承域错误码为 `ROLE_SELF_INHERITANCE`（superRefine 自继承）、`ROLE_BUILTIN_PARENT_FORBIDDEN`（父角色为内置 admin）、`ROLE_INHERITANCE_CYCLE`（环检测）、`ROLE_HAS_CHILDREN`（删除守卫，R16 不触发）；roleId/parentRoleId 不存在复用 `ROLE_NOT_FOUND` | §11 错误码矩阵（T2 真实码，非臆造 ROLE_INHERITANCE_NOT_FOUND）+ D20 [约束] |
| T3 | "GET /v1/roles/:roleId/inheritance-chain（cacheable）、GET /v1/users/:userId/effective-permissions（cacheable）" | server.ts L306-310 / L311-315 这两个 GET 端点 defineRoute 调用**未传第 6 参 cacheable=true**（仅 4 参：method/pattern/buildInput/procedure），即 cacheable=false，**不生成 ETag**；与 GET /v1/roles（L264 cacheable） / GET /v1/notifications（L347 cacheable）显式传第 6 参 true 不同 | §4 API client（这两个 GET 不走 cacheable 路径，但 R12 D15 已统一不发 If-None-Match，行为一致）+ §1.1 端点核验（cacheable=false 标注） |
| T4 | "POST /v1/users/:userId/transfer（事务性，单端点）" + "调岗表单 userId + toDepartmentId + oldRoleId + newRoleId" | server.ts L249-261 确认 POST /v1/users/:userId/transfer **非 versioned**（defineRoute 第 5 参缺省 false）+ **非 cacheable**；buildInput 从 path 取 userId、从 body 取 toDepartmentId/oldRoleId/newRoleId 合并为 transferProcedureInputSchema 入参（path+body 合并风格）；transferInputSchema 含 superRefine（oldRoleId === newRoleId → 字段级 issue path=['newRoleId']，message 含 TRANSFER_SAME_ROLE） | §3.1 TransferInput 消费 + §4 API client（非 versioned 不传 If-Match）+ §6.2 TransferForm（提交体 body={toDepartmentId, oldRoleId, newRoleId}，userId 在 path）+ D8 [约束] |

> **核验结论**：transfer / role-inheritance 契约已在 R7/R8 就绪（contracts 冻结，本轮无新增 schema）。任务编排描述与 contracts SSOT 存在 4 处偏离（T1 错误码臆造前缀 / T2 臆造 ROLE_INHERITANCE_NOT_FOUND / T3 GET 端点 cacheable 标记 / T4 transfer 非 versioned），本 Spec 一律以 contracts SSOT 为准。特别 T1/T2 错误码偏离影响 AC 断言精确性（不能用臆造码断言），T3 cacheable 标记对前端行为无实质影响（R12 D15 前端统一不发 If-None-Match），T4 非 versioned 决定前端不传 If-Match（区别于 R14/R15 versioned 写端点）。

### 1.3 本期覆盖范围（PRD F1~F10 + ARCH-003 + R13 S-1）

- F1 调岗表单（混合表单，T4 非 versioned）→ E1
- F2 调岗校验（混合表单 safeParse + superRefine，T4）→ E1（客户端 schema 拦截）
- F3 调岗错误处理（T1 错误码 SSOT 核验）→ E1
- F4 角色设置父角色（POST /parent versioned + 混合表单 superRefine，T2/T3）→ E2
- F5 角色解除父角色（DELETE /parent versioned，类型派生操作，T3）→ E3
- F6 角色继承链查看（GET /inheritance-chain，cacheable=false，T3，Q6 链形文本）→ E4
- F7 用户有效权限查看（GET /effective-permissions，cacheable=false，T3，Q7 UserListPage 行操作）→ E5
- F8 导航扩展 → 侧边栏 7 入口 + 路由守卫复用 R12
- F9 错误处理 → errorMapping 扩展 transfer/inheritance 码（全码映射收尾 + R14 S-11 同步注释闭合）
- F10 前端基础设施复用 + ARCH-003 合规 → 复用 R12/R14/R15，零新增基础设施
- ARCH-003 合规专项 → §8（R12/R13 已机器化，新模块继续受约束）
- R13 S-1 合规专项 → §3.2 区分自由文本/选择器混合表单 vs 类型派生操作

## 2. 前端分层架构（复用 R12/R14/R15 §2 分层 + 新增 transfer/inheritance 两域模块）

### 2.1 目录结构（R16 新增部分以 `+` 标注）

```
apps/web/
├── package.json                 # R12 依赖声明（R16 零新增，§12）
├── tsconfig.json                # R12 配置（R16 无改动）
├── vite.config.ts               # R12 配置（R16 无改动）
├── index.html                   # SPA 入口
└── src/
    ├── main.tsx                 # 应用挂载（R12）
    ├── App.tsx                  # 路由表（§7 新增 /transfer 1 路由）+ AuthProvider 包裹  # + R16 扩展
    ├── api/
    │   ├── client.ts            # R12 fetch 封装 request<T>（§4 复用，零改动；R15 D8 query string[] 已就绪）
    │   ├── auth.ts              # R12 login/logout endpoint
    │   ├── users.ts             # R12 users endpoint
    │   ├── roles.ts             # R14 角色域 endpoint（R16 复用 listRoles/listUserRoles 作选择器数据源）
    │   ├── departments.ts       # R14 部门域 endpoint（R16 复用 getDepartmentTree 作选择器数据源）
    │   ├── audit-logs.ts        # R14 审计域 endpoint
    │   ├── notifications.ts     # R15 通知域 endpoint
    │   ├── reports.ts           # R15 报表域 endpoint
    │   ├── transfer.ts          # + R16 调岗域 endpoint（§4.2，非 versioned 单端点）
    │   └── role-inheritance.ts  # + R16 角色继承域 endpoint（§4.2，2 versioned 写 + 2 非 cacheable GET）
    ├── auth/
    │   ├── tokenStore.ts        # R12（leaf，无改动）
    │   ├── AuthContext.tsx      # R12（无改动）
    │   └── RouteGuard.tsx       # R12（白名单仍仅 /login，新路由 /transfer 自动受守卫覆盖）
    ├── pages/
    │   ├── LoginPage.tsx        # R12
    │   ├── UserListPage.tsx     # R12（+ R16 行操作"有效权限"按钮触发 EffectivePermissionsPanel）  # + R16 扩展
    │   ├── RoleListPage.tsx     # R14（+ R16 行操作"设置父角色"/"解除父角色"/"查看继承链"3 按钮）  # + R16 扩展
    │   ├── DeptTreePage.tsx     # R14
    │   ├── AuditLogPage.tsx     # R14
    │   ├── NotificationListPage.tsx  # R15
    │   ├── ReportPage.tsx       # R15
    │   └── TransferPage.tsx     # + R16 调岗独立页（含 TransferForm）
    ├── components/
    │   ├── ErrorBanner.tsx      # R12（无改动）
    │   ├── UserRow.tsx          # R12（+ R16 行操作"有效权限"按钮）
    │   ├── CreateUserModal.tsx  # R12
    │   ├── Sidebar.tsx          # R14 侧边栏导航（+ R16 扩展 7 入口，新增调岗）  # + R16 扩展
    │   ├── RoleForm.tsx         # R14
    │   ├── UserRolesPanel.tsx   # R14
    │   ├── DeptForm.tsx         # R14
    │   ├── DeptNode.tsx         # R14
    │   ├── NotificationForm.tsx # R15
    │   ├── ReportFilter.tsx     # R15
    │   ├── ReportTable.tsx      # R15
    │   ├── TransferForm.tsx     # + R16 调岗混合表单（userId 自由文本 + 3 select，safeParse 覆盖 superRefine）
    │   ├── SetParentModal.tsx   # + R16 设置父角色弹窗（parentRoleId select，禁用自继承+内置 admin，versioned）
    │   ├── InheritanceChainPanel.tsx     # + R16 继承链展示（链形文本，根角色空数组"无父角色"）
    │   └── EffectivePermissionsPanel.tsx # + R16 有效权限展示（modal，权限码集合渲染 + 中文化映射）
    └── lib/
        └── errorMapping.ts      # R12/R14/R15（+ R16 扩展 SPECIFIC_MESSAGES transfer/inheritance 码 + 同步注释移除"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"）  # + R16 扩展
```

### 2.2 各层职责与依赖方向（沿用 R12 §2.2 / R14 §2.2 / R15 §2.2）

R16 新增模块遵循 R12/R14/R15 既定分层与依赖方向，不引入新依赖层级：

| 新增模块 | 层 | 职责 | 允许依赖 | 禁止依赖 |
|----------|----|------|----------|----------|
| `api/transfer.ts`、`api/role-inheritance.ts` | api 层 | endpoint 封装（拼 path/query/body 调 client） | api/client、@admin/contracts | pages/、components/、apps/api/src/** |
| `pages/TransferPage.tsx` | pages 层 | 页面组件（状态 + 交互） | api/transfer、api/roles、api/departments、auth/AuthContext、components/、@admin/contracts、lib/errorMapping | 直连 fetch（须经 api/client） |
| `components/TransferForm.tsx`、`components/SetParentModal.tsx`、`components/InheritanceChainPanel.tsx`、`components/EffectivePermissionsPanel.tsx` | components 层 | 复用组件 | @admin/contracts、lib/、api/（TransferForm/SetParentModal/InheritanceChainPanel/EffectivePermissionsPanel 经 props 注入 api 函数或父组件管数据，不直接 import api 亦可，由 impl-writer 选） | pages/ |

**依赖方向单向**（沿用 R12/R14/R15）：`pages/components → api → {client → tokenStore/lib}`；`pages → auth/AuthContext → api/auth → client`。`tokenStore` 与 `lib/` 为叶子层。R16 新增模块不破坏既有依赖图。RoleListPage 扩展行操作触发 SetParentModal/InheritanceChainPanel（page 管 modal 状态）；UserListPage 扩展行操作触发 EffectivePermissionsPanel（同 UserRolesPanel 模式）。

### 2.3 ARCH-003 在新模块的体现

ARCH-003「跨层只经契约」对 R16 新增模块的约束（沿用 R12 D2 / R14 D2 / R15 D2）：

- `apps/web/src` 全部新增模块（api/transfer.ts、api/role-inheritance.ts、pages/TransferPage.tsx、components/TransferForm.tsx、components/SetParentModal.tsx、components/InheritanceChainPanel.tsx、components/EffectivePermissionsPanel.tsx）+ 扩展文件（components/Sidebar.tsx、App.tsx、lib/errorMapping.ts、pages/RoleListPage.tsx、pages/UserListPage.tsx、components/UserRow.tsx）只能 import `@admin/contracts`（类型 + Zod schema）+ 第三方依赖（react/react-router-dom）+ apps/web/src 内部模块。
- **禁止 import `apps/api/src/**`**（repository/service/domain/router/server）与 `@admin/api` 包。
- 后端能力只能经 HTTP（api/client → router 端点）调用，类型只能经 contracts 派生。
- 机器化校验见 §8（R12 已落地 ARCH-003 分支 + R13 S-4 已让 CODE 扫描器覆盖前端，R16 无新增校验逻辑）。

## 3. 数据契约消费（R13 S-1 固化：类型派生 + schema 复用 + 自由文本/选择器混合 vs 类型派生区分）

### 3.1 从 @admin/contracts 派生的类型清单

> 全部类型经 `z.infer` 派生，**禁止手写 TS 类型副本**（R12 D3 [约束]，ARCH-002/CODE-004 延伸）。

**调岗域类型**（源自 `packages/contracts/src/schemas/transfer.ts`）：

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `TransferInput` | `z.infer<typeof transferInputSchema>` | 调岗表单提交体 `{userId(uuid), toDepartmentId(uuid), oldRoleId(uuid), newRoleId(uuid)}`，.strict() 拒绝多余字段 + superRefine（oldRoleId === newRoleId → path=['newRoleId'] 字段级 issue，message 含 TRANSFER_SAME_ROLE，T4）。**注**：前端提交时 userId 在 path（URL 拼接），body 仅含 `{toDepartmentId, oldRoleId, newRoleId}`（对齐 server.ts buildInput path+body 合并风格，T4） |

**角色继承域类型**（源自 `packages/contracts/src/schemas/role-inheritance.ts` + `role.ts`）：

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `SetParentInput` | `z.infer<typeof setParentInputSchema>` | 设置父角色提交体 `{roleId(uuid), parentRoleId(uuid)}`，.strict() + superRefine（roleId === parentRoleId → 自继承禁止，message "parentRoleId 不能等于 roleId（自继承禁止）"，T2）。**注**：前端提交时 roleId 在 path（URL 拼接），body 仅含 `{parentRoleId}`（对齐 server.ts L293-300 buildInput path+body 合并） |
| `UnsetParentInput` | `z.infer<typeof unsetParentInputSchema>` | 解除父角色提交体 `{roleId(uuid)}`，.strict()；类型派生操作（roleId 从列表派生，TS 类型保证，不调 safeParse） |
| `InheritanceChainResult` | `z.infer<typeof inheritanceChainResultSchema>` | 继承链返回 `Role[]` 祖先数组（从直接父角色到根角色，按继承顺序；根角色返回 []，D7 / AC-F2-3，**裸数组无 envelope**） |
| `EffectivePermissionsResult` | `z.infer<typeof effectivePermissionsResultSchema>` | 有效权限返回 `PermissionCode[]` 集合（直接角色 ∪ 沿继承链向上的父角色权限码并集，去重排序保证确定性，Q7 决策，**裸数组无 envelope**） |
| `Role` | `z.infer<typeof roleSchema>` | 角色实体 `{id, name, description, permission_codes, is_builtin, parent_role_id, created_at, version}`（复用 role.ts；parent_role_id 为 null 表示根角色；version 用于 setParent/unsetParent 乐观锁，T3 versioned） |
| `PermissionCode` | `z.infer<typeof permissionCodeSchema>` | 权限码枚举 11 项（user:read/user:write/role:read/role:write/dept:read/dept:write/audit:read/report:read/notification:read/notification:write/transfer:write），effective-permissions 渲染 + 中文化映射派生源 |

**共享类型**（源自 `packages/contracts/src/schemas/user.ts`，R12/R14/R15 已消费，R16 复用）：

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `ErrorCode` | `z.infer<typeof errorCodeSchema>` | 全局错误码 SSOT（含 TRANSFER_*/ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE/ROLE_HAS_CHILDREN 等，T1/T2 核验），errorMapping 键派生源 |
| `ErrorResponse` | `z.infer<typeof errorResponseSchema>` | `{code, message, current_version?}`，API client 适配后对外暴露（R12 D10 wire 适配沿用） |

> **调岗事务性单端点设计**（T4）：POST /v1/users/:userId/transfer **非 versioned**（server.ts L249-261 defineRoute 第 5 参缺省 false，对齐 R14 部门创建 POST /v1/departments 非 versioned 风格），前端**不传 If-Match**；body 为 `{toDepartmentId, oldRoleId, newRoleId}`（userId 在 path，buildInput 从 path+body 合并）；后端 withTransaction 包裹 A/B/C 三步（R7 TECH-TRANSFER-001 §3.1），事务失败抛 `TRANSFER_FAILED`（聚合码，message 含失败步骤+底层原因；校验阶段错误码 USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN/TRANSFER_OLD_ROLE_NOT_ASSIGNED 直接传播不聚合，T1）。

**禁用类型**（[约束] R12 D3 / R14 D3 / R15 D3 沿用）：

- 调岗/角色继承域**无存储态/输出态区分**（transferInputSchema/setParentInputSchema/unsetParentInputSchema 即输入态，inheritanceChainResultSchema/effectivePermissionsResultSchema/roleSchema 即输出态，无 entity schema）——前端无禁用类型需特别声明。
- 沿用 R12 D3：前端禁止 import `userEntitySchema`/`UserEntity`（含 password_hash）、`tokenPayloadSchema`/`TokenPayload`（验签内部）。
- 沿用 R14 D3：前端禁止 import `auditLogSchema`/`AuditLog`（存储态含未脱敏 PII）、`piiFieldRegistrySchema`/`PiiFieldRegistry`。
- **transfer/inheritance procedure input schema**（`transferProcedureInputSchema`/`setParentProcedureInputSchema`/`unsetParentProcedureInputSchema`/`inheritanceChainProcedureInputSchema`/`effectivePermissionsProcedureInputSchema`）属 apps/api 内部 procedure 级合并 schema，前端不消费（path+body 在前端拼装后直接调 request<T>，对齐 R14 B5 listUserRolesProcedureInputSchema 不消费模式）。

### 3.2 客户端表单校验 schema 复用清单（R13 S-1 固化：区分两类）

> R13 S-1 固化：表单校验须区分「自由文本/选择器混合表单」（须 safeParse，因有自由输入 + superRefine）与「类型派生操作」（TS 类型保证，schema 校验冗余，可不调或保留 defensive safeParse）。AC 措辞须精确限定为"自由文本/选择器混合表单"。

#### 3.2-A 自由文本/选择器混合表单（须 safeParse，[约束] D4）

| 功能点 | 复用 schema | 校验点 | AC |
|--------|-------------|--------|----|
| F1/F2 调岗表单 userId（自由文本 UUID）+ oldRoleId/newRoleId/toDepartmentId select（混合） | `transferInputSchema.safeParse`（整体校验覆盖 userId uuid + 4 字段 uuid + .strict() + superRefine oldRoleId !== newRoleId） | userId uuid 格式 + 拒绝多余字段 + superRefine oldRoleId !== newRoleId → path=['newRoleId'] 字段级错误（T4） | AC-F2-1/2/3/4 |
| F4 SetParentModal parentRoleId select + roleId 派生（混合） | `setParentInputSchema.safeParse`（整体校验覆盖 roleId/parentRoleId uuid + .strict() + superRefine roleId !== parentRoleId） | parentRoleId uuid 格式 + 拒绝多余字段 + superRefine roleId !== parentRoleId → 自继承禁止 | AC-F4-2 |

**判定依据**：调岗表单为"混合表单"（userId 自由文本 + 3 select），整体 `transferInputSchema.safeParse` 覆盖自由文本 uuid 校验 + superRefine + .strict()，对齐 R15 NotificationForm 混合表单模式（整体 safeParse 覆盖 title/content/recipient_id）；select 值虽经 SSOT options 派生保证合法（类型派生），但整体 safeParse 仍跑（防御性 + superRefine 必须经 schema 跑）。SetParentModal 同理（parentRoleId select + 整体 safeParse 覆盖 superRefine）。**未调 safeParse 判 partial（R13 S-1）。**

> **混合表单提示**：TransferForm 同时含自由文本（userId 须 safeParse uuid 校验）与类型派生（oldRoleId/newRoleId/toDepartmentId select，safeParse 冗余）两类字段。impl-writer 须对整体表单调 `transferInputSchema.safeParse`（覆盖自由文本字段校验 + superRefine），select 值经 options 派生保证合法（safeParse 不会在此字段失败）。此为单一 safeParse 调用同时覆盖两类字段，非"类型派生字段单独跳过 safeParse"——因 transferInputSchema.safeParse 是整体校验，无法字段级跳过（沿用 R14 RoleForm 混合表单提示精神，§3.2-B 注）。SetParentModal 同理。

#### 3.2-B 类型派生操作（TS 类型保证，safeParse 冗余，[约束] D5）

| 功能点 | 值来源 | TS 类型保证 | safeParse 处理 | AC |
|--------|--------|-------------|---------------|----|
| F5 解除父角色按钮 | roleId/version 从列表派生（Role.id/Role.version） | roleId 为 uuid 字面量、version 为 number 字面量 | 不调 safeParse（schema 校验冗余；unsetParentInputSchema 校验冗余） | AC-F5-1 |
| F6 查看继承链按钮 | roleId 从列表派生 | roleId 为 uuid 字面量 | 不调 safeParse（GET 只读，roleId 由列表派生） | AC-F6-1 |
| F7 查看有效权限按钮 | userId 从 UserListPage 行派生（User.id） | userId 为 uuid 字面量 | 不调 safeParse（GET 只读，userId 由行派生） | AC-F7-1 |
| F1/F2 调岗表单 oldRoleId/newRoleId/toDepartmentId select | 值从 listUserRoles/listRoles/getDepartmentTree 派生 | roleId/departmentId 为 uuid 字面量 | 不单独调 safeParse（select 值经 options 派生保证合法）；但整体 safeParse 覆盖（混合表单模式） | AC-F2-1/3 |
| F4 SetParentModal parentRoleId select | 值从 listRoles 派生（禁用自继承+内置 admin） | parentRoleId 为 uuid 字面量 | 不单独调 safeParse；但整体 safeParse 覆盖（混合表单模式，覆盖 superRefine） | AC-F4-2/3 |

**判定依据**：F5/F6/F7 为纯类型派生操作（roleId/userId/version 经 TS 类型派生自列表/行），不调 safeParse；若 impl 不调须显式标注 [约束] 偏离 + 反向同步 Spec §3.2（R13 S-1，AC-ARCH-4、AC-S1-2）。或保留 defensive safeParse（不禁止）。F1/F2/F4 内 select 字段为类型派生（值经 options 派生编译期保证合法），但因整体 safeParse 覆盖 superRefine 必须跑，故 select 字段不单独调 safeParse（混合表单整体覆盖）。

### 3.3 PII / 敏感字段清单（安全域标注，沿用 PRD §PII 清单）

| 字段 | 来源 | 敏感等级 | 前端处理 |
|------|------|----------|----------|
| 调岗 `userId`/`toDepartmentId`/`oldRoleId`/`newRoleId` | transfer 域 | 低（uuid 引用，**非 PII**，contracts 注释明示"字段均为 uuid 引用各自域实体 id"） | 展示/输入用，无特殊处理 |
| 角色继承 `roleId`/`parentRoleId` | role-inheritance 域 | 低（uuid 引用，**非 PII**） | 展示/输入用，无特殊处理 |
| `Role` 实体 name/description/permission_codes/is_builtin/parent_role_id/version | role.ts | 低（业务标识/描述/权限码/状态/版本，**非 PII**） | 展示用 |
| `PermissionCode` 权限码集合 | role.ts | 低（权限码枚举，**非 PII**，contracts 注释明示"effective-permissions 返回权限码集合"） | 展示用 + 中文化映射 |
| `token` | R12 沿用 | 高 | 沿用 R12 D12（localStorage，禁止 console.log） |

> transfer / role-inheritance 域**无 PII 字段**（contracts 明示均为 uuid 引用 + 权限码集合）。R16 不引入新的 PII 处理面，SEC-003b 不延伸（无脱敏态/存储态区分）。transfer/role-inheritance 域须确认 `transfer:write`/`role:write` 权限由后端 SEC-002 强制（前端不预判权限，依赖后端 FORBIDDEN 返回时显示"无权限"）。

## 4. API client 设计（R16 复用 R12 §4 + R15 D8 query string[]，零新增基础设施）

### 4.1 复用 R12/R14/R15 api/client.ts

R16 **零新增 API client 基础设施**，全部复用 R12 `apps/web/src/api/client.ts` 的 `request<T>(method, path, opts)` 函数（R12 §4 已实现，R15 D8 已扩展 query 支持 string[]）：

- **Bearer token 注入**（R12 D6）：除 `skipAuth=true`（login）外，所有请求从 tokenStore 读 token 注入 `Authorization: Bearer <token>`。R16 新增 api 模块全部需要鉴权（admin 路由），无须 skipAuth。
- **If-Match 注入**（R12 D7）：`opts.versioned === true` 且 `opts.expectedVersion !== undefined` 时注入 `If-Match: <expectedVersion>`。R16 仅 setParent（POST /v1/roles/:roleId/parent）+ unsetParent（DELETE /v1/roles/:roleId/parent）须 versioned=true（D7）。**transfer（POST /v1/users/:userId/transfer）非 versioned，不传 If-Match**（D8，T4）。
- **401 拦截**（R12 D8）：401 响应经 wire 适配取 code，鉴权类 4 码（UNAUTHORIZED/TOKEN_INVALID/TOKEN_EXPIRED/TOKEN_REVOKED）清 token + 跳 /login；INVALID_CREDENTIALS 原样抛。R16 新增请求自动受此拦截覆盖。
- **409 重试**（R12 D9）：VERSION_CONFLICT + current_version + 未重试过 → 用 current_version 重试 1 次。R16 setParent/unsetParent 复用此重试（D7）。**transfer 非 versioned 不触发 409 重试路径**（事务失败抛 TRANSFER_FAILED 由调用方处理，D8）。
- **wire 适配 error→code**（R12 D10）：读 wire `error` 字段 → errorCodeSchema 校验 → 映射为 contracts `code`。R16 新增 transfer/inheritance 域错误码（TRANSFER_*/ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE/ROLE_HAS_CHILDREN）自动经此适配覆盖。
- **网络错误兜底**：fetch 抛 → ApiError code='NETWORK_ERROR'。R16 沿用。
- **query string[]**（R15 D8）：RequestOptions.query 已支持 `string[]`（repeated key），R16 transfer/inheritance 域无数组 query 需求，但能力已就绪不破坏。

### 4.2 新增 api 模块设计（对齐 R12 api/users.ts / R14 api/roles.ts / R15 api/notifications.ts 风格，R14 S-8 命名须对齐 Spec §4.2）

#### 4.2.1 `apps/web/src/api/transfer.ts`

```ts
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client），禁止 import apps/api/src/**。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D8：transfer 非 versioned（T4，server.ts L249-261 defineRoute 第 5 参缺省 false），不传 If-Match。
// [约束] R13 S-1：本文件为类型派生操作（input 类型经 z.infer 派生），不调 safeParse。
//                调用方（自由文本/选择器混合表单 TransferForm）负责 safeParse 校验后再传入。
// [约束] D17（R14 S-8）：函数命名对齐本 Spec §4.2.1 声明。
import type { TransferInput } from '@admin/contracts';
import { request } from './client.js';

/**
 * POST /v1/users/:userId/transfer —— 调岗事务性单端点（**非 versioned**，T4，不传 If-Match）。
 * body={toDepartmentId, oldRoleId, newRoleId}（userId 在 path，对齐 server.ts buildInput path+body 合并风格）。
 * 事务失败抛 TRANSFER_FAILED（聚合码，message 含失败步骤+底层原因，T1）；校验阶段错误码
 * USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN/TRANSFER_OLD_ROLE_NOT_ASSIGNED
 * 直接传播不聚合（T1）。前端无重试（非 versioned，无 409 重试路径，D8）。
 */
export function transferUser(input: TransferInput): Promise<void> {
  // 注意：input 含 userId（用于拼 path），但 body 仅含 toDepartmentId/oldRoleId/newRoleId（T4）。
  // 对齐 server.ts L249-261 buildInput 从 path.userId + body.{toDepartmentId,oldRoleId,newRoleId} 合并。
  return request<void>('POST', `/v1/users/${input.userId}/transfer`, {
    body: {
      toDepartmentId: input.toDepartmentId,
      oldRoleId: input.oldRoleId,
      newRoleId: input.newRoleId,
    },
    // 不传 versioned/expectedVersion：transfer 非 versioned，client 不注入 If-Match（D8，T4）。
  });
}
```

> **注**：transfer 端点非 versioned 非 cacheable，无重试逻辑（事务失败抛 TRANSFER_FAILED 由调用方处理）；401 拦截复用 R12 D8。

#### 4.2.2 `apps/web/src/api/role-inheritance.ts`

```ts
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client）。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D7：setRoleParent/unsetRoleParent 须 versioned=true + expectedVersion → client 注入 If-Match（T3 versioned）。
// [约束] D9：409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条）。
//            409 ROLE_INHERITANCE_CYCLE/ROLE_BUILTIN_PARENT_FORBIDDEN 不重试（非 VERSION_CONFLICT，抛 ApiError）。
// [约束] R13 S-1：本文件为类型派生操作（input/output 类型经 z.infer 派生），不调 safeParse。
// [约束] D17（R14 S-8）：函数命名对齐本 Spec §4.2.2 声明。
import type {
  EffectivePermissionsResult,
  InheritanceChainResult,
  Role,
} from '@admin/contracts';
import { request } from './client.js';

/**
 * POST /v1/roles/:roleId/parent —— 设置父角色（versioned=true，If-Match=expectedVersion，T3）。
 * body={parentRoleId}（roleId 在 path，对齐 server.ts L293-300 buildInput path+body 合并）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9，用 409 body current_version）。
 * 409 ROLE_INHERITANCE_CYCLE（环检测，message 含环路径）/ROLE_BUILTIN_PARENT_FORBIDDEN 不重试抛 ApiError。
 * ROLE_SELF_INHERITANCE 由 superRefine 前端拦截（D12，AC-F4-2，不到后端）。
 * ROLE_NOT_FOUND（roleId/parentRoleId 不存在，复用 role 域既有码，T2）抛 ApiError。
 */
export function setRoleParent(
  roleId: string,
  parentRoleId: string,
  expectedVersion: number,
): Promise<Role> {
  return request<Role>('POST', `/v1/roles/${roleId}/parent`, {
    body: { parentRoleId },
    versioned: true,
    expectedVersion,
  });
}

/**
 * DELETE /v1/roles/:roleId/parent —— 解除父角色（versioned=true，If-Match=expectedVersion，T3）。
 * body 空（roleId 在 path）。409 VERSION_CONFLICT 由 client 自动重试 1 次（D9，DELETE 重试幂等——
 * 409 表示未删除，重试语义安全）。ROLE_NOT_FOUND 抛 ApiError。
 */
export function unsetRoleParent(roleId: string, expectedVersion: number): Promise<Role> {
  return request<Role>('DELETE', `/v1/roles/${roleId}/parent`, {
    versioned: true,
    expectedVersion,
  });
}

/**
 * GET /v1/roles/:roleId/inheritance-chain —— 继承链（**非 cacheable**，T3，不发 If-None-Match）。
 * 返回裸 Role[] 祖先数组（无 envelope，从直接父角色到根角色，按继承顺序；根角色返回 []）。
 */
export function getInheritanceChain(roleId: string): Promise<InheritanceChainResult> {
  return request<InheritanceChainResult>('GET', `/v1/roles/${roleId}/inheritance-chain`);
}

/**
 * GET /v1/users/:userId/effective-permissions —— 有效权限（**非 cacheable**，T3，不发 If-None-Match）。
 * 返回裸 PermissionCode[] 集合（无 envelope，直接角色 ∪ 沿继承链向上的父角色权限码并集，去重排序）。
 */
export function getEffectivePermissions(userId: string): Promise<EffectivePermissionsResult> {
  return request<EffectivePermissionsResult>('GET', `/v1/users/${userId}/effective-permissions`);
}
```

> **注**：4 端点命名对齐 Spec §4.2 声明（R14 S-8 教训闭合）：`transferUser`/`setRoleParent`/`unsetRoleParent`/`getInheritanceChain`/`getEffectivePermissions`。versioned 端点 setRoleParent/unsetRoleParent 复用 R12 D9 重试 + R14 D7 DELETE 重试幂等模式（DELETE 409 表示未删除，重试语义安全）；非 versioned GET 端点无重试；transfer 非 versioned 无 If-Match 无重试。

### 4.3 列表 pageSize 默认 20（沿用 R12 D14 / R14 D21 / R15 D16）

R16 transfer/inheritance 域 GET 端点（inheritance-chain/effective-permissions）返回裸数组无分页，不涉及 pageSize。但 TransferForm 选择器数据源（listRoles/getDepartmentTree/listUserRoles）沿用 R14 D21：listRoles 显式传 pageSize=20（listRoles 来自 R14 api/roles.ts 已实现），getDepartmentTree 无分页，listUserRoles 返回裸 UserRole[]（R14 B5 已实现）。R16 不重复封装这些 api 函数，直接复用 R14 api/roles.ts + api/departments.ts 既有导出。

## 5. 状态管理（R16 复用 R12/R14/R15 AuthContext/RouteGuard + 新增页面本地 state）

### 5.1 AuthContext + token 存储（复用 R12 D12，无改动）

R16 复用 R12 `auth/tokenStore.ts`（localStorage key=`admin_token`）+ `auth/AuthContext.tsx`（登录态 Context + login/logout action）。新增页面无须扩展 AuthContext——登录态全局共享，新页面经 `useAuth()` 读取。

### 5.2 路由守卫（复用 R12 D13，白名单仍仅 /login）

R16 复用 R12 `auth/RouteGuard.tsx`：`!isAuthenticated && path !== '/login'` → `<Navigate to="/login" />`。**白名单仍仅 `/login`**（R12 D13），新增 /transfer 自动受守卫覆盖（无须改守卫逻辑，AC-F8-3）。已登录访问 /login 跳 /users（R12 AC-F1-7）沿用。

### 5.3 新增页面本地 state（对齐 R12/R14/R15 风格，无全局状态库）

R16 新增 1 个页面 + 4 个组件用 `useState` 管理本地状态，无 Redux/Zustand（R12 D5 零新依赖沿用）：

- **TransferPage**：`{ form: { userId, toDepartmentId, oldRoleId, newRoleId }, userRoles: UserRole[], allRoles: Role[], deptTree: DepartmentTreeNode[], loading, error, successMessage }`。userId 输入触发 listUserRoles 加载 oldRoleId 选项（D13，AC-F1-2）；toDepartmentId 选项从 getDepartmentTree 派生；newRoleId 选项从 listRoles 派生。
- **TransferForm**：`{ form, errors: Record<string, string>, submitting, userRolesLoading }`。受控表单，"提交调岗"按钮原子提交（D14，AC-F1-3），不每键入触发请求（R14 S-9 教训，userId 输入触发 listUserRoles 须"提交"按钮触发或失焦触发，本轮采用失焦/完整 uuid 触发，AC-F1-2）。
- **SetParentModal**：`{ roleId, parentRoleId, allRoles: Role[], expectedVersion, submitting, errors }`。parentRoleId select 选项从 listRoles 派生，禁用自继承 roleId + 禁用内置 admin（D12）。
- **InheritanceChainPanel**：`{ chain: Role[], loading, error }`。链形文本渲染（D10，" → " 分隔，根角色空数组显示"无父角色"）。
- **EffectivePermissionsPanel**：`{ userId, permissions: PermissionCode[], loading, error }`。modal 内权限码列表渲染 + 中文化映射（D11）。

**调岗成功后行为**（D14 [约束]，Q3 决策①）：调岗成功 → 显示"调岗成功"提示 + TransferForm 重置（让用户继续调岗下一个用户，对齐 R14 删除角色成功 refresh 模式）。**不跳转用户详情**（GET /v1/users/:id 不消费，沿用 R14 Q9 决策②精神，超范围）+ **不跳转调岗历史**（Q4 决策①不做调岗历史，无专用端点）。

## 6. 页面与组件设计（[advisory] 实现提示，impl-writer 落地）

> 本节为页面/组件行为契约，impl-writer 据此实现。样式用 CSS Modules / 内联样式（零 UI 框架，R12 F5 沿用）。aria-label 须域特定（D18，R14 S-10 教训）。

### 6.1 TransferPage（F1，调岗独立页 Q1 决策①）

- 路由：`/transfer`（独立路由，对齐 R14 DeptTreePage 独立路由风格，Q1 决策①）。
- 渲染：标题"调岗管理" + `<TransferForm>` + 成功提示区 + 错误提示区。
- 加载 TransferForm 选择器数据源（D13）：
  - `getDepartmentTree()` → toDepartmentId select options（部门树扁平化为 select options，AC-F1-1）。
  - `listRoles({ page: 1, pageSize: 100 })` → newRoleId select options（全量角色，AC-F1-1；pageSize=100 取全量，沿用 R14 UserRolesPanel 全量加载模式）。
  - userId 输入失焦/完整 uuid → `listUserRoles(userId)` → oldRoleId select options（仅该用户已分配角色，前端防 TRANSFER_OLD_ROLE_NOT_ASSIGNED，AC-F1-2）。
- 加载态：选择器数据加载中文案（R12 D16）。
- 错误态：ErrorBanner 显示（沿用 R12 ErrorBanner）。
- 调岗成功（D14）：TransferForm onSubmitted 回调 → TransferPage 显示"调岗成功"提示 + TransferForm 重置（AC-F1-3）。

### 6.2 TransferForm（F1/F2/F3，混合表单 + safeParse，T4 superRefine）

- 表单字段（4 字段，D13 选择器混合，Q2 决策②）：
  - userId：input type=text（aria-label="用户 ID"，D18），自由文本 UUID 输入（对齐 R15 NotificationForm recipient_id 模式）。
  - toDepartmentId：select（aria-label="目标部门"，D18），options 从 getDepartmentTree 派生（部门树扁平化）。
  - oldRoleId：select（aria-label="原角色"，D18），options 从 listUserRoles(userId) 派生（仅该用户已分配角色，userId 未输入/非法时为空，AC-F1-2）。
  - newRoleId：select（aria-label="新角色"，D18），options 从 listRoles 派生（全量角色）。
  - "提交调岗"按钮（aria-label="提交调岗"，D18）。
- 提交流程（D4 + D14）：
  - userId 失焦或完整 uuid → 调 `listUserRoles(userId)` 加载 oldRoleId 选项（AC-F1-2）；userId 非法（非 uuid）→ oldRoleId select 保持空 + userId 字段级错误（AC-F2-2，由整体 safeParse 兜底）。
  - 点击"提交调岗" → `transferInputSchema.safeParse(form)` 整体校验（覆盖 userId uuid + 4 字段 uuid + .strict() + superRefine oldRoleId !== newRoleId）。
    - userId 非 uuid → safeParse 拦截（z.string().uuid()），userId 字段显示"用户 ID 须为 UUID 格式"（AC-F2-2），不发请求。
    - oldRoleId === newRoleId → safeParse 拦截（superRefine 触发，issue path=['newRoleId']），newRoleId 字段显示"新角色不能与原角色相同"（对应 TRANSFER_SAME_ROLE，T1，AC-F2-3），不发请求。
    - 含多余字段 → safeParse 拒绝（.strict()），显示"输入校验失败"（AC-F2-4，不发请求）。
    - 校验通过 → 调 `transferUser({ userId, toDepartmentId, oldRoleId, newRoleId })`（**非 versioned 不传 If-Match**，D8/T4，body={toDepartmentId, oldRoleId, newRoleId}，userId 在 path）。
  - 成功：显示"调岗成功"提示 + TransferForm 重置（D14，AC-F1-3）。
  - 提交按钮禁用：任意字段未填（userId 空 / oldRoleId 空 / newRoleId 空 / toDepartmentId 空）→ "提交调岗"按钮 disabled，不发请求（AC-F1-4）。
  - 提交中按钮禁用 + loading（R12 D16）。
- 错误处理（T1 错误码 SSOT，D19）：
  - USER_NOT_FOUND → "用户不存在"（AC-F3-1，T1 复用 user 域既有码，非臆造 TRANSFER_USER_NOT_FOUND）。
  - DEPT_NOT_FOUND → "部门不存在"（AC-F3-2，T1 复用 dept 域既有码）。
  - ROLE_NOT_FOUND → "角色不存在"（AC-F3-3，T1 复用 role 域既有码）。
  - ROLE_BUILTIN_FORBIDDEN → "内置角色不可删除"（AC-F3-4，T1 复用 role 域既有码，oldRole 为内置角色）。
  - TRANSFER_OLD_ROLE_NOT_ASSIGNED → "用户未持有原角色"（AC-F3-5，T1 transfer 专属码，竞态——用户在 listUserRoles 加载后持有 oldRole 但提交前被其他请求移除）。
  - TRANSFER_FAILED → "调岗失败：<message>"（AC-F3-6，T1 transfer 聚合码，message 含失败步骤+底层原因，前端展示后端 message）。
  - TRANSFER_SAME_ROLE 服务端兜底 → "新角色不能与原角色相同"（AC-F3-7，客户端 safeParse 未拦截绕过直接调 API 时后端兜底）。

### 6.3 RoleListPage 扩展行操作（F4/F5/F6，Q5 决策①，复用既有 RoleListPage）

R14 RoleListPage 行操作已有"删除"按钮，R16 扩展 3 个继承管理按钮（Q5 决策①行操作扩展）：

- **"设置父角色"按钮**（aria-label="设置父角色"，D18）：点击 → 打开 `<SetParentModal roleId={role.id} expectedVersion={role.version} onClose={...} onUpdated={refresh}>`（D12，AC-F4-1）。
- **"解除父角色"按钮**（aria-label="解除父角色"，D18）：**仅 role.parent_role_id !== null 时显示**（非根角色，AC-F5-2）；点击 → 调 `unsetRoleParent(role.id, role.version)`（versioned=true，D7）。
  - 成功：刷新列表（AC-F5-1）。
  - VERSION_CONFLICT：API client 自动重试（D7/R12 D9），重试成功刷新列表；重试仍冲突显示"数据已被修改，请刷新后重试"（AC-F5-3）。
  - ROLE_NOT_FOUND：显示"角色不存在"，列表刷新移除该行（AC-F5-4，沿用 R14 RoleListPage handleDelete 的 ROLE_NOT_FOUND → refresh 模式）。
- **"查看继承链"按钮**（aria-label="查看继承链"，D18）：点击 → 打开 `<InheritanceChainPanel roleId={role.id} onClose={...}>`（modal 或 drawer，AC-F6-1）。
- 既有"删除"按钮保留（R14 不破坏）。
- **R14 既有 role-list-page.test.tsx ①类显式影响**：行操作按钮数量从 1（删除）扩展为 4（删除 + 设置父角色 + 解除父角色 + 查看继承链），R14 role-list-page.test.tsx 若断言"操作列仅含删除按钮"或"行操作按钮数量=1"则**失效**，impl-writer 须调整断言（§9.1 ①类显式影响）。

### 6.4 SetParentModal（F4，弹窗选择父角色 Q8 决策①，versioned，superRefine）

- 形态：modal（Q8 决策①，对齐 R14 RoleForm/DeptForm + R15 NotificationForm modal 风格），从 RoleListPage 行操作"设置父角色"按钮触发。
- 表单字段：parentRoleId select（aria-label="父角色"，D18），options 从 listRoles 派生（全量角色）。
  - **禁用项**（D12 [约束]）：
    - 自继承禁用：option value === roleId 时 disabled（前端防 ROLE_SELF_INHERITANCE，AC-F4-2）。
    - 内置 admin 禁用：option is_builtin === true 时 disabled（前端防 ROLE_BUILTIN_PARENT_FORBIDDEN，AC-F4-3）。
- 提交流程（D4 + D7）：
  - 点击"提交" → `setParentInputSchema.safeParse({ roleId, parentRoleId })` 整体校验（覆盖 superRefine roleId !== parentRoleId）。
    - parentRoleId === roleId → safeParse 拦截（superRefine 触发，message "parentRoleId 不能等于 roleId（自继承禁止）"），parentRoleId 字段显示"不能继承自身"（对应 ROLE_SELF_INHERITANCE，T2，AC-F4-2），不发请求。
    - 校验通过 → 调 `setRoleParent(roleId, parentRoleId, expectedVersion)`（versioned=true，If-Match=expectedVersion=role.version，D7/T3，AC-F4-1）。
  - 成功：关闭弹窗 + RoleListPage 刷新（AC-F4-1）。
  - 错误处理（T2 错误码 SSOT，D20）：
    - ROLE_BUILTIN_PARENT_FORBIDDEN → "内置角色不可设为父角色"（AC-F4-3，T2，前端禁用项兜底——若绕过前端直接调 API 选 admin 作父）。
    - ROLE_INHERITANCE_CYCLE → "会形成继承环"（AC-F4-4，T2，message 含环路径 A→B→A）。
    - ROLE_NOT_FOUND → "角色不存在"（AC-F4-7，T2，复用 role 域既有码，roleId/parentRoleId 竞态不存在）。
    - VERSION_CONFLICT：API client 自动重试（D7/R12 D9，用 409 body current_version），重试成功弹窗关闭 + RoleListPage 刷新（AC-F4-5）；重试仍冲突显示"数据已被修改，请刷新后重试"（AC-F4-6）。
  - 提交中按钮禁用 + loading（R12 D16）。

### 6.5 InheritanceChainPanel（F6，链形文本展示 Q6 决策①，T3 非 cacheable）

- 形态：modal 或 drawer（从 RoleListPage 行操作"查看继承链"按钮触发），传入 roleId。
- 加载：`getInheritanceChain(roleId)`（**不发 If-None-Match**，T3 非 cacheable，AC-F6-1）→ 返回裸 `Role[]` 祖先数组。
- 渲染（D10 [约束]，Q6 决策①链形文本）：
  - **有父角色**（chain.length > 0）：链形文本"角色 A → 父角色 B → 祖父角色 C"（" → " 分隔，按返回顺序；首项为当前角色，后续为祖先链，根角色终止；纯 UI 文案 R13 S-2 不须同步 §10 但须 Review 报告记录）。**注**：当前角色名不在 GET 返回数组内（数组仅含祖先），前端须额外从 RoleListPage 列表项取当前角色名作为链头（或 GET 返回的祖先链直接展示，链头为父角色——impl-writer 须据 contracts inheritanceChainResultSchema 语义"从直接父角色到根角色"渲染，即链形文本首项为直接父角色，当前角色作为标题展示，AC-F6-3 多级祖先 [父 B → 祖父 C → 曾祖父 D]）。
  - **根角色空数组**（chain.length === 0）：显示"无父角色"（D7 / AC-F6-2）。
  - **多级祖先**（chain.length >= 2）：链形文本按返回顺序用 " → " 分隔（AC-F6-3）。
- 加载态：loading 文案（R12 D16）。
- 错误处理：ROLE_NOT_FOUND → "角色不存在"（AC-F6-4，T2，roleId 竞态不存在）；网络错误沿用 R12。

### 6.6 EffectivePermissionsPanel（F7，UserListPage 行操作 modal Q7 决策③，T3 非 cacheable）

- 形态：modal（Q7 决策③，从 UserListPage 行操作"有效权限"按钮触发），传入 userId（类型派生自 User.id，TS 类型保证，§3.2-B）。
- 加载：`getEffectivePermissions(userId)`（**不发 If-None-Match**，T3 非 cacheable，AC-F7-1）→ 返回裸 `PermissionCode[]` 集合。
- 渲染（D11 [约束]，Q7 决策③权限码集合渲染）：
  - **有权限**（permissions.length > 0）：渲染权限码列表（每项中文化映射，D11，如 user:read→"查看用户"、role:read→"查看角色"、transfer:write→"调岗用户"；纯 UI 文案 R13 S-2 不须同步 §10 但须 Review 报告记录）。**权限码中文化映射 SSOT 派生**：映射表键从 `[...permissionCodeSchema.options]` SSOT 派生（11 项全集，AI-005，禁止硬编码，AC-F7-3）；前端按 GET 返回顺序展示（后端去重排序保证确定性，无须客户端排序）。
  - **空集合**（permissions.length === 0）：显示"该用户暂无有效权限"（用户无角色或角色无权限码场景，AC-F7-2）。
- 加载态：loading 文案（R12 D16）。
- 错误处理：USER_NOT_FOUND → "用户不存在"（AC-F7-4，T1 复用 user 域既有码，userId 竞态不存在）；网络错误沿用 R12。

### 6.7 UserListPage 扩展行操作（F7，Q7 决策③）

R12 UserListPage 行操作已有"启停"按钮，R14 扩展"角色"按钮（UserRolesPanel），R16 扩展"有效权限"按钮（EffectivePermissionsPanel）：

- **"有效权限"按钮**（aria-label="有效权限"，D18）：点击 → 打开 `<EffectivePermissionsPanel userId={user.id} onClose={...}>`（modal，AC-F7-1）。
- 既有"启停"+"角色"按钮保留（R12/R14 不破坏）。
- **R14 既有 user-list-page.test.tsx ①类显式影响**：行操作按钮数量从 2（启停 + 角色）扩展为 3（启停 + 角色 + 有效权限），R14 user-list-page.test.tsx 若断言"操作列含 N 按钮"或"行操作按钮数量=2"则**失效**，impl-writer 须调整断言（§9.1 ①类显式影响）。

### 6.8 Sidebar（F8，侧边栏导航扩展 7 入口）

- 入口：用户（/users）、角色（/roles）、部门（/departments）、审计（/audit-logs）、通知（/notifications）、报表（/reports）、**调岗（/transfer）** 7 入口 + 登出按钮（R15 6 入口扩展为 7 入口，AC-F8-1）。
- 入口可达：点击"调岗"跳转 /transfer 并渲染 TransferPage（AC-F8-2）。
- 登出：调 `useAuth().logout()`（沿用 R12 AC-F6-2，AC-F8-4）。
- 布局：App.tsx 沿用 R14/R15 既有布局（受保护页共享 Sidebar）。
- **R15 既有 navigation-extend.test.tsx / navigation.test.tsx ①类显式影响**：侧边栏入口数量从 6 扩展为 7，R15 navigation-extend.test.tsx 若断言"6 入口"则**失效**（4→6→7 链式扩展，§9.1 ①类显式影响）。

## 7. 路由设计（React Router v6，新增 1 路由）

```tsx
// App.tsx 路由表（R12/R14/R15 基础上新增 /transfer）
<Routes>
  <Route path="/login" element={<RouteGuard><LoginPage /></RouteGuard>} />
  <Route path="/users" element={<RouteGuard><UserListPage /></RouteGuard>} />
  <Route path="/roles" element={<RouteGuard><RoleListPage /></RouteGuard>} />
  <Route path="/departments" element={<RouteGuard><DeptTreePage /></RouteGuard>} />
  <Route path="/audit-logs" element={<RouteGuard><AuditLogPage /></RouteGuard>} />
  <Route path="/notifications" element={<RouteGuard><NotificationListPage /></RouteGuard>} />
  <Route path="/reports" element={<RouteGuard><ReportPage /></RouteGuard>} />
  <Route path="/transfer" element={<RouteGuard><TransferPage /></RouteGuard>} />  {/* + R16 */}
  <Route path="/" element={<Navigate to="/users" replace />} />
  <Route path="*" element={<Navigate to="/users" replace />} />
</Routes>
```

- **白名单仍仅 `/login`**（R12 D13，Q1 决策①沿用）：未登录访问 /transfer → RouteGuard 跳 /login（AC-F8-3）。
- react-router-dom v6（R12 D5 沿用，零新依赖）。
- 角色继承管理嵌入 RoleListPage 行操作，不新增独立 /role-inheritance 路由（Q5 决策①）。
- effective-permissions 嵌入 UserListPage 行操作 modal，不新增独立 /effective-permissions 路由（Q7 决策③）。

## 8. ARCH-003 校验方案（R16 无新增校验逻辑，R12/R13 已落地）

### 8.1 R12 已落地 ARCH-003 机器化 enforcement

R12 §8 已在 `scripts/check-rules.mjs` 实现 ARCH-003 分支（L211-234）：

- 扫描 `apps/web/src/**/*.{ts,tsx}` 的 import 语句（walkWeb 收集 .ts + .tsx）。
- 禁止 specifier：`^@admin/api\b` / `api/src/` 子串 / `^apps/api\b`（三条任一命中即违规）。
- 允许：`@admin/contracts`、`@admin/contracts/*`、react/react-router-dom/react-dom、apps/web 内相对模块、node 内置。
- 违规即报错 exit≠0。

### 8.2 R13 S-4 已让 CODE 扫描器覆盖前端

R13 S-4 已将 `walkWeb` 提升为顶层函数（check-rules.mjs L23-31），`allTs` 数组（L34-41）已含 `apps/web/src` + `apps/web/test`，使 CODE-001（禁 any）/CODE-002（禁空 catch）/CODE-003（禁 eval）/CODE-004（Zod schema 命名后缀）/AI-005（禁硬编码跨域集合）等通用扫描器自动覆盖前端 .ts/.tsx 文件。

### 8.3 R16 新增模块继续受 ARCH-003 + CODE 扫描器覆盖

R16 新增 7 个前端文件（api/transfer.ts、api/role-inheritance.ts、pages/TransferPage.tsx、components/TransferForm.tsx、components/SetParentModal.tsx、components/InheritanceChainPanel.tsx、components/EffectivePermissionsPanel.tsx）+ 扩展 6 个既有文件（components/Sidebar.tsx、App.tsx、lib/errorMapping.ts、pages/RoleListPage.tsx、pages/UserListPage.tsx、components/UserRow.tsx）位于 `apps/web/src/`，自动受 ARCH-003 分支 + CODE 扫描器覆盖，**无须新增校验逻辑**（AC-ARCH-1）。Reviewer 须逐文件核对 ARCH-003 合规性（AC-ARCH-2 类型来自 contracts）。

### 8.4 layering.md 校验方式无须更新

R12 §8.4 已将 layering.md ARCH-003 校验方式从 `[预留]` 更新为机器化描述（含 `check-rules.mjs` + `ARCH-003` + `分支` 措辞，META-003/META-004 双向绑定闭合）。R16 无新增规则、无新增 enforcement 分支，layering.md 无须更新。

## 9. 受影响测试清单（AI-006 两类标注 + R13 S-3 AC↔测试覆盖矩阵）

> 本轮为**前端扩展**（apps/web 已存在，新增 transfer/inheritance 两域模块），既有后端/契约测试零改动。严格遵守 AI-006：①类分显式+隐式两个子类 + ②类签名变更 + ③类新增。R16 改动 6 个 R12/R14/R15 既有文件（Sidebar.tsx 新增 1 入口 / App.tsx 新增 1 路由 / errorMapping.ts 扩展 SPECIFIC_MESSAGES + 同步注释移除 / RoleListPage.tsx 行操作扩展 3 按钮 / UserListPage.tsx 行操作扩展 1 按钮 / UserRow.tsx 新增"有效权限"按钮），可能影响 R12/R14/R15 既有测试断言。

### 9.1 ① 类：contracts 联动驱动

**①-A 显式影响（grep 符号引用 + 既有文件改动）—— 4 文件：**

R16 改动 6 个 R12/R14/R15 既有文件，逐文件核验对既有测试的影响：

1. **`components/Sidebar.tsx` 新增调岗入口（6→7 入口）** → **R15 `navigation-extend.test.tsx` ①类显式影响**。
   - 判定依据：R15 navigation-extend.test.tsx line 76 断言"侧边栏渲染 6 入口（用户/角色/部门/审计/通知/报表）+ 登出按钮"（`it('侧边栏渲染 6 入口...')`）。R16 扩展为 7 入口后，该断言**失效**（6→7）。
   - 处理：impl-writer 须调整 R15 navigation-extend.test.tsx 断言（6 入口 → 7 入口，新增调岗入口断言），属 ①类显式影响处理范例（对齐 R14/R15 errorMapping 扩展范例 + R15 navigation 4→6 扩展范例）。matcher 改动须 Reviewer 判定（AI-002 须显式列出）。
   - **预估 R15 navigation-extend.test.tsx 1 文件受影响**（明确失效）。
   - **注**：R14 既有 navigation.test.tsx（4 入口断言）在 R15 已被 navigation-extend.test.tsx 取代或调整，R16 须 double-check R14 navigation.test.tsx 若仍存在 6 入口断言亦失效；R15 navigation-extend.test.tsx 是主受影响文件。

2. **`lib/errorMapping.ts` 扩展 SPECIFIC_MESSAGES（新增 transfer/inheritance 码中文 + 同步注释移除"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"，D9）** → **R15 `error-mapping-extend-2.test.ts` ①类显式影响（明确失效）**。
   - 判定依据：R15 error-mapping-extend-2.test.ts line 73-81 断言"TRANSFER_SAME_ROLE → FALLBACK 含'操作失败'"+"ROLE_INHERITANCE_CYCLE → FALLBACK 含'操作失败'"（注释明示"TRANSFER/ROLE_INHERITANCE 域本期前端不触发"）。R16 D9 扩展 SPECIFIC_MESSAGES 后，TRANSFER_SAME_ROLE 升级为"新角色不能与原角色相同"、ROLE_INHERITANCE_CYCLE 升级为"会形成继承环"，**两个 FALLBACK 断言明确失效**。
   - 处理：impl-writer 须调整 R15 error-mapping-extend-2.test.ts 断言：`TRANSFER_SAME_ROLE → FALLBACK '操作失败'` 改为 `TRANSFER_SAME_ROLE → '新角色不能与原角色相同'`；`ROLE_INHERITANCE_CYCLE → FALLBACK '操作失败'` 改为 `ROLE_INHERITANCE_CYCLE → '会形成继承环'`。属 ①类显式影响处理范例（对齐 R14/R15 errorMapping 扩展范例）。matcher 改动须 Reviewer 判定（AI-002 须显式列出）。
   - **预估 R15 error-mapping-extend-2.test.ts 1 文件受影响**（明确失效 2 个断言）。
   - **注**：R15 同步注释核验断言（line 73-81 注释"R14 S-11 同步注释：TRANSFER 域本期前端不触发"）须一并调整为"全码映射收尾，无已知域保持 FALLBACK"（D9 + R14 S-11 闭合收尾）。

3. **`pages/RoleListPage.tsx` 行操作扩展 3 按钮（设置父角色 + 解除父角色 + 查看继承链）** → **R14 `role-list-page.test.tsx` ①类显式影响**。
   - 判定依据：R14 role-list-page.test.tsx 断言 RoleListPage 行操作（删除按钮，line 60+）。R16 扩展 3 按钮后，若 R14 既有断言"操作列仅含删除按钮"或"行操作按钮数量=1"则**失效**（1→4）。
   - 处理：impl-writer 须 double-check R14 role-list-page.test.tsx 实际断言：若仅断言"删除按钮存在"则不失效；若断言"按钮数量=1"或"操作列仅含删除"则失效须调整。**预估 1 文件受影响**（边缘，以 R14 role-list-page.test.tsx 实际断言为准）。
   - **注**：R16 新增的 3 按钮测试用例在新增 `role-list-page-extend.test.tsx` 中覆盖（§9.3 T2），R14 role-list-page.test.tsx 仅做断言调整不重复覆盖。

4. **`pages/UserListPage.tsx` + `components/UserRow.tsx` 行操作扩展"有效权限"按钮** → **R14 `user-list-page.test.tsx` ①类显式影响**。
   - 判定依据：R14 user-list-page.test.tsx 断言 UserListPage 行操作（启停 + 角色 2 按钮，R14 D24 已扩展）。R16 扩展"有效权限"按钮后，行操作按钮数量从 2 扩展为 3。若 R14 既有断言"行操作按钮数量=2"则**失效**（2→3）。
   - 处理：impl-writer 须 double-check R14 user-list-page.test.tsx 实际断言：若仅断言"启停按钮存在"+"角色按钮存在"则不失效；若断言"按钮数量=2"则失效须调整。**预估 0~1 文件受影响**（边缘，以 R14 user-list-page.test.tsx 实际断言为准）。
   - **注**：R16 新增的"有效权限"按钮测试用例在新增 `effective-permissions-panel.test.tsx` + `role-list-page-extend.test.tsx`（合并 user-list-page-extend 亦可，由 test-writer 定）中覆盖。

5. **`App.tsx` 新增 /transfer 路由** → **R15 navigation-extend.test.tsx ①类显式影响**（与 #1 同文件，路由可达性断言可能需扩展）。
   - 判定依据：R15 navigation-extend.test.tsx 断言入口可达（点击"通知"→/notifications、点击"报表"→/reports，line 82+）。R16 新增调岗入口可达性断言须扩展（点击"调岗"→/transfer，AC-F8-2）。属 #1 同文件的断言扩展。
   - **并入 #1 R15 navigation-extend.test.tsx 1 文件**（不重复计数）。

**①-A 显式影响小结**：**3~4 文件**（R15 navigation-extend.test.tsx 明确失效 1 文件 + R15 error-mapping-extend-2.test.ts 明确失效 2 断言 1 文件 + R14 role-list-page.test.tsx 边缘 0~1 文件 + R14 user-list-page.test.tsx 边缘 0~1 文件）。根因：R16 改动 Sidebar（6→7 入口）+ errorMapping（扩展 SPECIFIC_MESSAGES + 移除 TRANSFER/ROLE_INHERITANCE 域 FALLBACK 注释）+ RoleListPage（行操作 1→4 按钮）+ UserListPage（行操作 2→3 按钮）+ App.tsx（新增路由），其中 Sidebar 入口数量断言 + errorMapping FALLBACK 断言明确失效。impl-writer 须显式列出每个受影响文件 + 改动性质 + 理由（AI-002）。

**①-B 隐式影响（全集断言依赖枚举值，R11 S-2）—— 0 文件：**

既有 SSOT 派生断言（`[...errorCodeSchema.options]` containment / `[...permissionCodeSchema.options]` containment）位于 `apps/api/test/role.test.ts` / `notification.test.ts` / `report.test.ts` / `role-inheritance.test.ts` / `optimistic-locking.test.ts` / `apps/web/test/error-mapping.test.ts` / `error-mapping-extend.test.ts` / `error-mapping-extend-2.test.ts`（R12/R14/R15 已落地 SSOT 派生）。判定依据：**本轮契约层零新增**（PRD 明示 contracts 已就绪，errorCodeSchema 不扩展、permissionCodeSchema 不变），枚举值不变 → 既有 containment 断言不失效。**零隐式影响。**

> **errorMapping 扩展说明**：R16 扩展 `lib/errorMapping.ts` 的 SPECIFIC_MESSAGES（新增 transfer/inheritance 域码中文提示，D9）。但映射表键仍从 `[...errorCodeSchema.options]` SSOT 派生（R12 D11 沿用），errorCodeSchema 枚举未扩展（transfer/inheritance 码本就在枚举内），故 SSOT 派生断言不失效。R16 扩展 SPECIFIC_MESSAGES 属"填充既有 FALLBACK 码的具体提示"，非"新增枚举键"，既有测试若断言"TRANSFER_SAME_ROLE → FALLBACK"会失效（因 R16 改为具体提示，见 #2）。**预估 R15 error-mapping-extend-2.test.ts 明确失效 2 断言**（TRANSFER_SAME_ROLE + ROLE_INHERITANCE_CYCLE → FALLBACK）。

①类小结：**3~4 文件可能受影响**（显式 3~4：R15 navigation-extend.test.tsx + R15 error-mapping-extend-2.test.ts 明确 + R14 role-list-page.test.tsx + R14 user-list-page.test.tsx 边缘；隐式 0）。根因：R16 改动 R12/R14/R15 既有文件（Sidebar/errorMapping/RoleListPage/UserListPage/UserRow/App.tsx），其中 Sidebar 入口数量断言 + errorMapping FALLBACK 断言明确失效，RoleListPage/UserListPage 行操作按钮数量断言边缘待核验。

### 9.2 ② 类：既有签名/行为变更驱动 —— 0 文件

判定依据：本轮后端冻结（不改 service/repo/domain/router/server.ts/contracts），后端 API 签名与 wire 格式零变更；前端新增消费者，不改变既有后端行为。R16 改动 R12/R14/R15 既有文件（Sidebar.tsx 新增入口 / App.tsx 新增路由 / errorMapping.ts 扩展 SPECIFIC_MESSAGES + 移除注释 / RoleListPage.tsx 行操作扩展 / UserListPage.tsx 行操作扩展 / UserRow.tsx 新增按钮）属"扩展"非"签名变更"（组件/函数签名不变：Sidebar/App/RoleListPage/UserListPage/UserRow 组件签名不变、mapErrorToMessage 函数签名不变）。**②类零影响。**

> 与 PRD 估算对齐：PRD 未声称 ②类影响（本轮纯前端扩展 + 既有文件扩展），本 Spec 精确分析确认 ②类 = 0。

### 9.3 ③ 类：新增测试（9 文件，impl-writer/test-writer 阶段）

| # | 文件 | 类型 | 覆盖 AC |
|---|------|------|---------|
| 1 | `apps/web/test/api-transfer.test.ts`（T1） | API client 契约测（mock fetch） | AC-F1-3（transfer POST 非 versioned 不传 If-Match，T4/D8）、AC-F1-3（body={toDepartmentId, oldRoleId, newRoleId}，userId 在 path）、AC-F3-6（TRANSFER_FAILED 聚合码 message 含失败步骤，T1）、AC-F3-7（TRANSFER_SAME_ROLE 服务端兜底）、AC-F3-1~F3-5（各错误码 wire 适配）、AC-F10-1/F10-2（Bearer 注入非 versioned 不注入 If-Match）、AC-ARCH-2（类型 contracts 派生） |
| 2 | `apps/web/test/api-role-inheritance.test.ts`（T1） | API client 契约测 | AC-F4-1（setRoleParent versioned If-Match，T3/D7）、AC-F4-5/F4-6（409 VERSION_CONFLICT 重试用 current_version）、AC-F4-4（409 ROLE_INHERITANCE_CYCLE 不重试抛 ApiError）、AC-F4-3（409 ROLE_BUILTIN_PARENT_FORBIDDEN 不重试）、AC-F5-1（unsetRoleParent versioned DELETE 重试幂等）、AC-F5-3（unsetRoleParent 409 重试）、AC-F6-1（getInheritanceChain GET 非 cacheable 不发 If-None-Match，T3 + 裸数组 Role[] 响应）、AC-F7-1（getEffectivePermissions GET 非 cacheable + 裸数组 PermissionCode[] 响应）、AC-ARCH-2 |
| 3 | `apps/web/test/transfer-form.test.tsx`（T3） | 组件测（Testing Library） | AC-F1-1（4 字段控件渲染）、AC-F1-2（userId 输入触发 listUserRoles 加载 oldRoleId 选项）、AC-F1-3（提交调岗成功 + 重置）、AC-F1-4（提交按钮禁用）、AC-F2-1（safeParse 整体校验通过）、AC-F2-2（userId 非 uuid 字段级错误）、AC-F2-3（superRefine oldRoleId === newRoleId 字段级错误 path=['newRoleId']，T4）、AC-F2-4（.strict() 拒绝多余字段）、AC-F3-1~F3-7（各错误码提示，T1）、AC-ARCH-3（safeParse）、AC-S1-1（混合表单须 safeParse） |
| 4 | `apps/web/test/set-parent-modal.test.tsx`（T4） | 组件测 | AC-F4-1（设置父角色成功 versioned）、AC-F4-2（自继承 superRefine 字段级错误，T2）、AC-F4-3（内置 admin 父角色前端禁用 + 服务端兜底）、AC-F4-4（ROLE_INHERITANCE_CYCLE 提示"会形成继承环"，T2）、AC-F4-5/F4-6（VERSION_CONFLICT 自动重试 + 仍冲突提示）、AC-F4-7（ROLE_NOT_FOUND）、AC-ARCH-3（safeParse）、AC-S1-1（混合表单须 safeParse 覆盖 superRefine） |
| 5 | `apps/web/test/role-list-page-extend.test.tsx`（T2，**①类显式影响**扩展 R14 role-list-page.test.tsx 或新增文件） | 组件测 | AC-F5-1（解除父角色成功，versioned DELETE）、AC-F5-2（根角色不显示解除按钮）、AC-F5-3（VERSION_CONFLICT 重试）、AC-F5-4（ROLE_NOT_FOUND → refresh）、AC-F4-1（设置父角色按钮触发 SetParentModal）、AC-F6-1（查看继承链按钮触发 InheritanceChainPanel）、AC-S1-2（类型派生不 safeParse） |
| 6 | `apps/web/test/inheritance-chain-panel.test.tsx`（T5） | 组件测 | AC-F6-1（继承链查看-有父角色，链形文本渲染）、AC-F6-2（根角色空数组显示"无父角色"，D7）、AC-F6-3（多级祖先链形文本" → " 分隔）、AC-F6-4（ROLE_NOT_FOUND）、AC-ARCH-2（类型 contracts 派生 Role[]） |
| 7 | `apps/web/test/effective-permissions-panel.test.tsx`（T6） | 组件测 | AC-F7-1（有效权限查看-有权限，权限码列表 + 中文化映射）、AC-F7-2（空集合显示"该用户暂无有效权限"）、AC-F7-3（权限码中文化映射 SSOT 派生 11 项全集，AI-005）、AC-F7-4（USER_NOT_FOUND）、AC-S1-2（类型派生 userId 不 safeParse） |
| 8 | `apps/web/test/navigation-extend-2.test.tsx`（T7，**①类显式影响**扩展 R15 navigation-extend.test.tsx 或新增文件） | 组件测 | AC-F8-1（侧边栏 7 入口 + 登出，6→7 扩展）、AC-F8-2（入口可达 /transfer）、AC-F8-3（路由守卫覆盖新页）、AC-ARCH-1（lint:rules 探针）、AC-F10-3（零新依赖） |
| 9 | `apps/web/test/error-mapping-extend-3.test.ts`（T9，**①类显式影响**扩展 R15 error-mapping-extend-2.test.ts 或新增文件） | 单测（SSOT 派生） | AC-F9-1（transfer 域码中文：TRANSFER_SAME_ROLE→"新角色不能与原角色相同"/TRANSFER_OLD_ROLE_NOT_ASSIGNED→"用户未持有原角色"/TRANSFER_FAILED→"调岗失败"/TRANSFER_COMPENSATION_FAILED→"调岗补偿失败，请联系运维"）、AC-F9-2（inheritance 域码中文：ROLE_SELF_INHERITANCE→"不能继承自身"/ROLE_BUILTIN_PARENT_FORBIDDEN→"内置角色不可设为父角色"/ROLE_INHERITANCE_CYCLE→"会形成继承环"/ROLE_HAS_CHILDREN→"角色仍有子角色，请先解除子角色继承"）、AC-F9-3（SSOT 派生断言 + R14 S-11 同步注释移除"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"+ 全码映射收尾 + 401/网络错误沿用 R12/R14/R15） |

各文件断言要点：
- **api-transfer.test.ts**（mock global.fetch）：transferUser 不注入 If-Match（D8/T4，AC-F1-3）、body={toDepartmentId, oldRoleId, newRoleId}（userId 在 path，T4）、TRANSFER_FAILED wire 适配抛 ApiError 含 message（AC-F3-6）、TRANSFER_SAME_ROLE 服务端兜底（AC-F3-7）、USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN/TRANSFER_OLD_ROLE_NOT_ASSIGNED 各码 wire 适配（AC-F3-1~F3-5）、Bearer 注入（AC-F10-2）、类型全部 contracts 派生（AC-ARCH-2）。**注**：transfer 非 versioned 须断言 request opts 不含 versioned=true/expectedVersion（D8，区别于 R14/R15 versioned 写端点）。
- **api-role-inheritance.test.ts**：setRoleParent 注入 If-Match=expectedVersion（D7/T3，AC-F4-1）、body={parentRoleId}（roleId 在 path）、409 VERSION_CONFLICT 用 current_version 重试 1 次（AC-F4-5）、409 ROLE_INHERITANCE_CYCLE/ROLE_BUILTIN_PARENT_FORBIDDEN 不重试抛 ApiError（区别于 VERSION_CONFLICT，T2）、unsetRoleParent DELETE versioned + 409 重试幂等（AC-F5-3）、getInheritanceChain GET 不发 If-None-Match（T3 非 cacheable）+ 返回裸 Role[]（AC-F6-1）、getEffectivePermissions GET 不发 If-None-Match + 返回裸 PermissionCode[]（AC-F7-1）、Bearer 注入（AC-F10-2）、类型全部 contracts 派生（AC-ARCH-2）。
- **transfer-form.test.tsx**：4 字段控件渲染（AC-F1-1）、userId 输入触发 listUserRoles 加载 oldRoleId 选项（AC-F1-2）、提交调岗成功 + 重置（AC-F1-3）、提交按钮禁用（AC-F1-4）、safeParse 整体通过（AC-F2-1）、userId 非 uuid 字段级错误"用户 ID 须为 UUID 格式"（AC-F2-2）、superRefine oldRoleId === newRoleId 字段级错误 path=['newRoleId']"新角色不能与原角色相同"（AC-F2-3，T4）、.strict() 拒绝多余字段（AC-F2-4）、各错误码提示 USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_FAILED（AC-F3-1~F3-6，T1 真实码非臆造）、safeParse 拦截不发请求（AC-ARCH-3）、混合表单须 safeParse（AC-S1-1）。**R15 S-13 教训**：测试 fixture 须用有效 hex UUID（如 `00000000-0000-4000-8000-000000000001`），避免 z.string().uuid() 严格校验拒绝非 hex 字符导致 safeParse 失败测试永不调用实现。
- **set-parent-modal.test.tsx**：弹窗渲染（AC-F4-1）、parentRoleId select options 从 listRoles 派生 + 禁用自继承 roleId + 禁用内置 admin（D12，AC-F4-2/F4-3）、自继承 superRefine 字段级错误"不能继承自身"（AC-F4-2，T2）、ROLE_BUILTIN_PARENT_FORBIDDEN 服务端兜底"内置角色不可设为父角色"（AC-F4-3）、ROLE_INHERITANCE_CYCLE"会形成继承环"（AC-F4-4，T2）、VERSION_CONFLICT 自动重试 + 仍冲突提示（AC-F4-5/F4-6）、ROLE_NOT_FOUND"角色不存在"（AC-F4-7）、safeParse 拦截不发请求（AC-ARCH-3）、混合表单须 safeParse 覆盖 superRefine（AC-S1-1）。
- **role-list-page-extend.test.tsx**（扩展 R14 或新增）：行操作"设置父角色"/"解除父角色"/"查看继承链"3 按钮渲染（AC-F5-1/F4-1/F6-1）、解除父角色按钮仅 parent_role_id !== null 时显示（AC-F5-2）、解除父角色成功 versioned DELETE（AC-F5-1）、VERSION_CONFLICT 重试（AC-F5-3）、ROLE_NOT_FOUND → refresh（AC-F5-4）、设置父角色按钮触发 SetParentModal（AC-F4-1）、查看继承链按钮触发 InheritanceChainPanel（AC-F6-1）、类型派生 roleId/version 不 safeParse（AC-S1-2）。**①类显式影响**：若扩展 R14 既有 role-list-page.test.tsx 须 AI-002 边界标注 + ①类显式影响注释（行操作 1→4 按钮断言调整），对齐 R15 navigation 4→6 扩展范例。
- **inheritance-chain-panel.test.tsx**：链形文本渲染"角色 A → 父角色 B → 祖父角色 C"（AC-F6-1）、根角色空数组显示"无父角色"（AC-F6-2，D7）、多级祖先" → " 分隔（AC-F6-3）、ROLE_NOT_FOUND"角色不存在"（AC-F6-4）、类型 Role[] contracts 派生（AC-ARCH-2）。
- **effective-permissions-panel.test.tsx**：权限码列表渲染 + 中文化映射（AC-F7-1）、空集合"该用户暂无有效权限"（AC-F7-2）、权限码中文化映射 SSOT 派生 `[...permissionCodeSchema.options]` 11 项全集（AC-F7-3，AI-005）、USER_NOT_FOUND"用户不存在"（AC-F7-4）、类型派生 userId 不 safeParse（AC-S1-2）。
- **navigation-extend-2.test.tsx**（扩展 R15 或新增）：侧边栏 7 入口 + 登出（AC-F8-1，6→7 调整）、入口跳转 /transfer（AC-F8-2）、未登录跳 /login（AC-F8-3）、lint:rules 探针验证 ARCH-003（AC-ARCH-1）、零新依赖（AC-F10-3）。**①类显式影响**：若扩展 R15 既有 navigation-extend.test.tsx 须 AI-002 边界标注 + ①类显式影响注释（6→7 入口断言调整），对齐 R15 navigation 4→6 扩展范例。
- **error-mapping-extend-3.test.ts**（扩展 R15 或新增）：映射表键 = `[...errorCodeSchema.options]`（SSOT 派生，AC-F9-3）、transfer 域码中文（AC-F9-1：TRANSFER_SAME_ROLE→"新角色不能与原角色相同"/TRANSFER_OLD_ROLE_NOT_ASSIGNED→"用户未持有原角色"/TRANSFER_FAILED→"调岗失败"/TRANSFER_COMPENSATION_FAILED→"调岗补偿失败，请联系运维"）、inheritance 域码中文（AC-F9-2：ROLE_SELF_INHERITANCE→"不能继承自身"/ROLE_BUILTIN_PARENT_FORBIDDEN→"内置角色不可设为父角色"/ROLE_INHERITANCE_CYCLE→"会形成继承环"/ROLE_HAS_CHILDREN→"角色仍有子角色，请先解除子角色继承"）、同步注释核验（R14 S-11 闭合收尾：注释须反映扩展后**全码映射收尾，无已知域保持 FALLBACK**，移除"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"措辞，AC-F9-3）。**①类显式影响**：R15 error-mapping-extend-2.test.ts 断言"TRANSFER_SAME_ROLE → FALLBACK '操作失败'"+ "ROLE_INHERITANCE_CYCLE → FALLBACK '操作失败'"明确失效，impl-writer 须调整断言为具体中文（matcher 改动须 Reviewer 判定，AI-002 须显式列出）。

③类小结：9 新增测试文件（含 3 个 ①类显式影响扩展：role-list-page-extend.test.tsx + navigation-extend-2.test.tsx + error-mapping-extend-3.test.ts），覆盖 PRD 46 条 AC + ARCH-003 合规专项 + R13 S-1 合规专项。无 E2E（Q9 决策①，R12 Q8 / R14 D20 / R15 D19 沿用）。

### 9.4 AC↔测试用例覆盖矩阵（R13 S-3 固化）

> 测试文件编号（T#）为本 Spec 预估，**最终用例号由 test-writer 阶段确认**（R13 S-3，R14 S-12 / R15 测试文件数预估可调整须 AI-006 反向核实）。test-writer 须自检每条 AC 至少 1 个用例覆盖，未覆盖显式列 reason。

| AC 区间 | 覆盖测试文件 | 用例号（test-writer 定） | 备注 |
|---------|-------------|------------------------|------|
| AC-F1-1~F1-4 | T3 transfer-form.test.tsx | 待定 | F1-2 userId 输入触发 listUserRoles 跨 T1+T3 |
| AC-F2-1~F2-4 | T3 transfer-form.test.tsx | 待定 | F2-3 superRefine path=['newRoleId'] 字段级错误跨 T9（错误码 SSOT 派生） |
| AC-F3-1~F3-7 | T3 transfer-form.test.tsx + T1 api-transfer.test.ts + T9 error-mapping-extend-3.test.ts | 待定 | F3-1~F3-7 各错误码跨 T3+T1+T9，F3-6 TRANSFER_FAILED message 含失败步骤，F3-7 服务端兜底 |
| AC-F4-1~F4-7 | T4 set-parent-modal.test.tsx + T1 api-role-inheritance.test.ts + T2 role-list-page-extend.test.tsx | 待定 | F4-2 superRefine 自继承字段级跨 T9，F4-4 ROLE_INHERITANCE_CYCLE 跨 T4+T9，F4-5/F4-6 重试跨 T1+T4 |
| AC-F5-1~F5-4 | T2 role-list-page-extend.test.tsx + T1 | 待定 | F5-3 重试跨 T1+T2，F5-4 ROLE_NOT_FOUND → refresh 跨 T9 |
| AC-F6-1~F6-4 | T2 role-list-page-extend.test.tsx + T5 inheritance-chain-panel.test.tsx | 待定 | F6-1/F6-2/F6-3 链形文本渲染，F6-4 跨 T9 |
| AC-F7-1~F7-4 | T6 effective-permissions-panel.test.tsx + T2（UserListPage 行操作触发）| 待定 | F7-3 SSOT 派生断言跨 T9 |
| AC-F8-1~F8-3 | T7 navigation-extend-2.test.tsx（①类显式影响扩展 R15 navigation-extend.test.tsx） | 待定 | F8-3 沿用 R12 route-guard 测 |
| AC-F9-1~F9-3 | T9 error-mapping-extend-3.test.ts（①类显式影响扩展 R15）+ T1 | 待定 | F9-3 R14 S-11 同步注释移除 + 全码映射收尾 + 401/网络错误沿用 R12/R14/R15 |
| AC-F10-1/F10-2 | T1/T2 + T7 | 待定 | API client 复用 |
| AC-F10-3 | T7（工程核验） | 待定 | 零新依赖 |
| AC-ARCH-1 | T7 + lint:rules 探针 + Reviewer 逐文件 | 待定 | ARCH-003 机器化 |
| AC-ARCH-2 | T1/T2/T5/T6 + Reviewer | 待定 | 类型来自 contracts |
| AC-ARCH-3 | T3/T4 | 待定 | 自由文本/选择器混合表单 safeParse（F1/F2/F4） |
| AC-S1-1 | T3/T4 | 待定 | 混合表单须 safeParse 覆盖 superRefine |
| AC-S1-2 | T2/T5/T6 | 待定 | 类型派生 TS 类型保证（unsetParent/viewChain/effectivePermissions 按钮） |

> test-writer 须做 AC 覆盖矩阵自检（R13 S-3）：每条 AC 至少 1 用例覆盖，未覆盖显式列 reason；组合场景（AC-F1-2 userId 输入触发 listUserRoles、AC-F3-6 TRANSFER_FAILED message 含失败步骤、AC-F4-5/F5-3 重试+刷新、AC-F4-4 ROLE_INHERITANCE_CYCLE 环检测）须单独测。test-writer 可据覆盖质量调整测试文件数（R14 S-12 / R15 沿用），须 AI-006 反向核实注明理由 + Reviewer 判定合理性。
> **R15 S-13 教训**：测试 fixture 须用有效 hex UUID（如 `00000000-0000-4000-8000-000000000001`），避免 z.string().uuid() 严格校验拒绝非 hex 字符导致 safeParse 失败测试永不调用实现。R16 TransferForm/SetParentModal 涉及 uuid safeParse，fixture 须严格对齐。
> **R15 S-14 教训**：组件 label/aria-label 须跨组件唯一——TransferForm/SetParentModal/InheritanceChainPanel/EffectivePermissionsPanel 不与 RoleListPage/UserListPage 既有 label 冲突（如 RoleListPage 有"角色名称"label，SetParentModal 须用"父角色"消歧；UserListPage 有"角色"按钮，EffectivePermissionsPanel 须用"有效权限"消歧）。

## 10. 决策清单（D1~D22）

> 每个决策显式标注 `[约束]`（默认禁止偏离，偏离须经 AI-003 流程 + Reviewer 确认）或 `[advisory]`（允许偏离，须反向同步 Spec §10）。R12 D1~D21 + R14 D1~D24 + R15 D1~D21 沿用，本节仅列 R16 新增/扩展决策。

### D1 · 前端分层复用 R12/R14/R15 + 新增 transfer/inheritance 两域 api/pages/components `[约束]`

R16 复用 R12/R14/R15 §2 分层（api/pages/components/auth/lib），新增 api/transfer.ts、api/role-inheritance.ts、pages/TransferPage.tsx、components/TransferForm.tsx、components/SetParentModal.tsx、components/InheritanceChainPanel.tsx、components/EffectivePermissionsPanel.tsx；扩展 components/Sidebar.tsx、App.tsx、lib/errorMapping.ts、pages/RoleListPage.tsx、pages/UserListPage.tsx、components/UserRow.tsx。依赖方向单向沿用 R12 §2.2 / R14 §2.2 / R15 §2.2。impl-writer 偏离分层须反向同步。

### D2 · ARCH-003 持续合规（新增模块继续受约束）`[约束]`

R16 新增 7 个前端文件 + 扩展 6 个既有文件继续受 ARCH-003 约束（R12 D2 / R14 D2 / R15 D2 沿用）：只能 import @admin/contracts + 第三方 + apps/web 内部，禁止 import apps/api/src/** 与 @admin/api。R12 §8 ARCH-003 分支 + R13 S-4 CODE 扫描器自动覆盖新增文件（§8）。违规即 blocker（AC-ARCH-1）。

### D3 · 类型 z.infer 派生 + transfer/inheritance 域无存储态区分 `[约束]`

R16 全部数据类型经 z.infer 从 @admin/contracts 派生（§3.1），禁止手写 TS 类型副本（R12 D3 沿用，AC-ARCH-2）。transfer/inheritance 域**无存储态/输出态区分**（transferInputSchema/setParentInputSchema/unsetParentInputSchema 即输入态，inheritanceChainResultSchema/effectivePermissionsResultSchema/roleSchema 即输出态，无 entity schema）——前端无禁用类型需特别声明。transfer/inheritance procedure input schema（transferProcedureInputSchema/setParentProcedureInputSchema 等）属 apps/api 内部 procedure 级合并 schema，前端不消费（path+body 在前端拼装后直接调 request<T>，对齐 R14 B5 listUserRolesProcedureInputSchema 不消费模式）。沿用 R12 D3 禁用 userEntitySchema/tokenPayloadSchema、R14 D3 禁用 auditLogSchema/piiFieldRegistrySchema。

### D4 · 自由文本/选择器混合表单须 safeParse（R13 S-1）`[约束]`

F1/F2 调岗表单（userId 自由文本 UUID + oldRoleId/newRoleId/toDepartmentId select 混合）+ F4 SetParentModal（parentRoleId select + roleId 派生混合）为自由文本/选择器混合表单，提交前须调 `transferInputSchema.safeParse` / `setParentInputSchema.safeParse`，覆盖 superRefine（oldRoleId !== newRoleId / roleId !== parentRoleId）+ .strict() 拒绝多余字段 + uuid 格式校验，失败显示字段级错误不发请求（AC-F2-1/2/3/4、AC-F4-2、AC-ARCH-3、AC-S1-1）。未调 safeParse 判 partial（R13 S-1）。**注**：select 值虽经 SSOT options 派生保证合法（类型派生），但整体 safeParse 仍跑（防御性 + superRefine 必须经 schema 跑），对齐 R15 NotificationForm 混合表单模式。

### D5 · 类型派生操作不强制 safeParse（R13 S-1）`[约束]`

F5 解除父角色按钮（roleId/version 从列表派生）+ F6 查看继承链按钮（roleId 从列表派生）+ F7 查看有效权限按钮（userId 从 UserListPage 行派生）为类型派生操作（roleId/userId/version 经 TS 类型派生自列表/行，非自由输入），可不调 safeParse（schema 校验冗余）；若不调须在 impl 报告显式标注 [约束] 偏离 + 反向同步 Spec §3.2（AC-ARCH-4、AC-S1-2）。或保留 defensive safeParse（不禁止）。

### D6 · API client 复用 R12/R14/R15（零新增基础设施）`[约束]`

R16 零新增 API client 基础设施，全部复用 R12 api/client.ts 的 request<T>（Bearer/If-Match/401 拦截/409 重试/wire 适配/网络兜底 + R15 D8 query string[]）。新增 api 模块（transfer/role-inheritance）仅调 request<T>，不重复封装 fetch（AC-F10-1）。transfer 非 versioned 不传 versioned/expectedVersion；setParent/unsetParent versioned 传 versioned=true + expectedVersion=role.version。

### D7 · setParent/unsetParent versioned + If-Match + 409 重试复用 R12 D9 `[约束]`

setParent（POST /v1/roles/:roleId/parent）+ unsetParent（DELETE /v1/roles/:roleId/parent）为 versioned 端点（server.ts L293/L301 第 5 参 true，T3），api/role-inheritance 对应函数须 versioned=true + expectedVersion=role.version → client 注入 If-Match（R12 D7，AC-F4-1/F5-1）。409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条，R12 D9 沿用，AC-F4-5/F5-3）；重试仍 409 显示"数据已被修改，请刷新后重试"（AC-F4-6）。重试仅 1 次防活锁。**注**：409 ROLE_INHERITANCE_CYCLE/ROLE_BUILTIN_PARENT_FORBIDDEN 非 VERSION_CONFLICT，不触发 409 重试（client 仅对 VERSION_CONFLICT 重试，继承域错误码直接抛 ApiError 由调用方处理，对齐 R15 NOTIFICATION_INVALID_TRANSITION 不重试模式）。**DELETE 重试幂等性**：unsetParent DELETE 409 重试发生在同次冲突未删成功的场景（409 表示未删除），重试 DELETE 语义安全（非重复删除已删资源）；若重试时已被其他请求删除则 404/ROLE_NOT_FOUND，前端显示"角色不存在"并刷新（AC-F5-4）。

### D8 · transfer 非 versioned 不传 If-Match（T4 事务性单端点）`[约束]`

POST /v1/users/:userId/transfer 为**非 versioned**端点（server.ts L249-261 defineRoute 第 5 参缺省 false，T4，事务性单端点），api/transfer.transferUser 不传 versioned/expectedVersion，client 不注入 If-Match（AC-F1-3，AC-F10-2）。事务失败抛 TRANSFER_FAILED（聚合码，message 含失败步骤+底层原因，T1）由调用方处理；校验阶段错误码 USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN/TRANSFER_OLD_ROLE_NOT_ASSIGNED 直接传播不聚合（T1）。**注**：D8 与 D7 有意分歧（transfer 非 versioned，setParent/unsetParent versioned），impl-writer 不得对 transfer 传 versioned=true（否则 client 注入 If-Match 但后端不消费，虽无害但违背 D8 + T4）。transfer 非 versioned 不触发 409 重试路径（无 If-Match 即无 VERSION_CONFLICT）。

### D9 · errorMapping 扩展 SPECIFIC_MESSAGES（transfer/inheritance 码中文 + 全码映射收尾 + R14 S-11 同步注释闭合）`[约束]`

R16 扩展 R12/R14/R15 lib/errorMapping.ts 的 SPECIFIC_MESSAGES，新增 transfer 域码（TRANSFER_SAME_ROLE→"新角色不能与原角色相同"/TRANSFER_OLD_ROLE_NOT_ASSIGNED→"用户未持有原角色"/TRANSFER_FAILED→"调岗失败"/TRANSFER_COMPENSATION_FAILED→"调岗补偿失败，请联系运维"）+ inheritance 域码（ROLE_SELF_INHERITANCE→"不能继承自身"/ROLE_BUILTIN_PARENT_FORBIDDEN→"内置角色不可设为父角色"/ROLE_INHERITANCE_CYCLE→"会形成继承环"/ROLE_HAS_CHILDREN→"角色仍有子角色，请先解除子角色继承"）中文提示（AC-F9-1/2）。映射表键仍从 `[...errorCodeSchema.options]` SSOT 派生（R12 D11 沿用，AC-F9-3）。**R14 S-11 教训闭合收尾**：扩展时同步更新"未映射码"注释——R15 注释为"TRANSFER/ROLE_INHERITANCE 域码本期前端不触发，保持 FALLBACK"，R16 扩展后须**移除该注释**（因 R16 已扩展 transfer/inheritance 码具体提示），注释须反映"扩展后 errorCodeSchema 全集所有码均映射具体中文提示，FALLBACK 仅作未来新增码兜底"（R12 扩展 user/auth + R14 扩展 role/dept + R15 扩展 notification/report + R16 扩展 transfer/inheritance，全码映射收尾）。禁止硬编码全集。

### D10 · 角色继承链展示策略（Q6 链形文本，根角色空数组"无父角色"）`[约束]`

InheritanceChainPanel 据 GET /v1/roles/:roleId/inheritance-chain 返回的裸 `Role[]` 祖先数组链形文本渲染（Q6 决策①）：链形文本"父角色 B → 祖父角色 C → 曾祖父角色 D"（" → " 分隔，按返回顺序，AC-F6-1/F6-3）；根角色返回 [] 显示"无父角色"（D7 / AC-F6-2）。链形文本优于树形（继承链为单继承线性结构，非多分支树，过度渲染）+ 面包屑（语义偏导航，继承链非导航）。链形文本为纯 UI 文案 R13 S-2 不须同步 §10 但须 Review 报告记录。

### D11 · 用户有效权限展示 + 权限码中文化 SSOT 派生（Q7 modal）`[约束]`

EffectivePermissionsPanel 据 GET /v1/users/:userId/effective-permissions 返回的裸 `PermissionCode[]` 集合渲染（Q7 决策③ modal）：有权限渲染权限码列表（每项中文化映射，如 user:read→"查看用户"、transfer:write→"调岗用户"，AC-F7-1）；空集合显示"该用户暂无有效权限"（AC-F7-2）。**权限码中文化映射 SSOT 派生**：映射表键从 `[...permissionCodeSchema.options]` SSOT 派生（11 项全集，AI-005，禁止硬编码，AC-F7-3）。前端按 GET 返回顺序展示（后端去重排序保证确定性，无须客户端排序）。中文化映射为纯 UI 文案 R13 S-2 不须同步 §10 但须 Review 报告记录。

### D12 · SetParentModal 禁用自继承 + 内置 admin（前端防 ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN）`[约束]`

SetParentModal parentRoleId select 选项从 listRoles 派生，**禁用项**：(1) option value === roleId 时 disabled（前端防 ROLE_SELF_INHERITANCE，AC-F4-2）；(2) option is_builtin === true 时 disabled（前端防 ROLE_BUILTIN_PARENT_FORBIDDEN，AC-F4-3）。前端禁用项 + 后端 superRefine/service 双保险：前端禁用避免误操作；若绕过前端直接调 API（如选 admin 作父），后端返回 ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_SELF_INHERITANCE，前端 errorMapping 显示对应中文（AC-F4-3）。**注**：自继承由 setParentInputSchema.superRefine 前端兜底（D4），ROLE_BUILTIN_PARENT_FORBIDDEN 由后端 service 兜底（无 schema 层校验，is_builtin 须查 DB）；前端禁用项是 UX 优化非安全防线（安全由后端 SEC 强制）。

### D13 · TransferForm 选择器数据源（Q2 选择器混合，userId 自由文本 + oldRoleId 先 listUserRoles）`[约束]`

TransferForm 4 字段控件（Q2 决策②选择器混合）：userId 自由文本 UUID 输入（对齐 R15 Q4① recipient_id 模式，用户可能多 select 全量不友好）；oldRoleId select 选项从 listUserRoles(userId) 派生（**仅该用户已分配角色**，前端防 TRANSFER_OLD_ROLE_NOT_ASSIGNED，AC-F1-2，userId 未输入/非法时为空）；newRoleId select 选项从 listRoles 派生（全量角色，pageSize=100）；toDepartmentId select 选项从 getDepartmentTree 派生（部门树扁平化）。**userId 输入触发 listUserRoles 加载 oldRoleId 选项**（D14/R14 S-9 教训：不每键入触发，采用失焦/完整 uuid 触发，AC-F1-2）。**不采用**全自由文本（4 字段都 safeParse uuid，UX 差须 copy-paste 4 个 UUID）+ 全 select userId（须全量加载用户列表超 R16 范围且 UX 在大量用户下差）。

### D14 · 调岗成功后行为（Q3 提示 + 刷新当前页，对齐 R14 删除角色 refresh 模式）`[约束]`

调岗成功 → 显示"调岗成功"提示 + TransferForm 重置（让用户继续调岗下一个用户，Q3 决策①，AC-F1-3），对齐 R14 删除角色成功 refresh 模式（R14 RoleListPage handleDelete 成功后 refresh()）。**不跳转用户详情**（GET /v1/users/:id 不消费，沿用 R14 Q9 决策②精神，超范围）+ **不跳转调岗历史**（Q4 决策①不做调岗历史，无专用端点，audit-logs 无 transfer 实体类型）。

### D15 · 侧边栏扩展 7 入口 + 路由守卫覆盖 /transfer `[约束]`

R16 扩展 R15 Sidebar（6 入口 → 7 入口，新增调岗，AC-F8-1）+ App.tsx 新增 /transfer 路由（§7）。路由守卫白名单仍仅 /login（R12 D13 沿用，AC-F8-3）。①类显式影响：R15 navigation-extend.test.tsx 断言"6 入口"失效须调整为"7 入口"（§9.1）。

### D16 · 测试范围对齐 R12 Q8 / R14 D20 / R15 D19（组件测 + API client 契约测，无 E2E）`[约束]`

R16 测试用组件测 + API client 契约测，无 E2E（Q9 决策①，R12 Q8 / R14 D20 / R15 D19 沿用）。9 新增测试文件（§9.3，含 3 个 ①类显式影响扩展）。Vitest + Testing Library + jsdom（R12 D17 沿用）。web .tsx 测试用 per-file `// @vitest-environment jsdom` 注解（R12 D20 沿用）。

### D17 · api 模块函数命名对齐 Spec §4.2 声明（R14 S-8 教训）`[约束]`

R16 新增 api/transfer.ts + api/role-inheritance.ts 的函数命名须对齐本 Spec §4.2 声明（R14 S-8 教训）：transfer.ts 导出 `transferUser`；role-inheritance.ts 导出 `setRoleParent`/`unsetRoleParent`/`getInheritanceChain`/`getEffectivePermissions`。impl-writer 不得擅自改名（如 `doTransfer`/`setParent`/`fetchChain`/`getPermissions` 等），偏离须反向同步 Spec §4.2。

### D18 · aria-label 域特定（R14 S-10 教训）`[约束]`

R16 新增表单/控件 aria-label 须域特定（R14 S-10 教训）：TransferForm "用户 ID"/"目标部门"/"原角色"/"新角色"/"提交调岗"；SetParentModal "父角色"；InheritanceChainPanel "继承链"；EffectivePermissionsPanel "有效权限"；RoleListPage 行操作"设置父角色"/"解除父角色"/"查看继承链"；UserListPage 行操作"有效权限"。禁止通用 aria-label（如 "input"/"text field"/"button"）。impl-writer 偏离须 Review 报告记录。

### D19 · transfer 错误码遵循 contracts SSOT（T1，非臆造码）`[约束]`

R16 transfer 域错误码遵循 contracts errorCodeSchema SSOT（T1 核验）：调岗时引用实体不存在复用各域既有码（USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN，非臆造 TRANSFER_USER_NOT_FOUND/TRANSFER_DEPT_NOT_FOUND/TRANSFER_ROLE_NOT_FOUND/TRANSFER_ROLE_BUILTIN_FORBIDDEN）；transfer 专属码仅 4 个（TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_COMPENSATION_FAILED/TRANSFER_FAILED）。AC 错误处理断言用 contracts SSOT 真实码，errorMapping 扩展仅追加实际触发的码中文提示（D9）。impl-writer 不得使用臆造 TRANSFER_*_NOT_FOUND 码（违背 contracts SSOT，AC-F3-1~F3-7 失败）。

### D20 · 角色继承错误码遵循 contracts SSOT（T2，非臆造 ROLE_INHERITANCE_NOT_FOUND）`[约束]`

R16 角色继承域错误码遵循 contracts errorCodeSchema SSOT（T2 核验）：继承域错误码为 ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE/ROLE_HAS_CHILDREN（非臆造 ROLE_INHERITANCE_NOT_FOUND）；roleId/parentRoleId 不存在复用 ROLE_NOT_FOUND。AC 错误处理断言用 contracts SSOT 真实码，errorMapping 扩展仅追加实际触发的码中文提示（D9）。impl-writer 不得使用臆造 ROLE_INHERITANCE_NOT_FOUND 码（违背 contracts SSOT，AC-F4-4/F4-7/F5-4/F6-4 失败）。**注**：ROLE_HAS_CHILDREN 为删除守卫码（R16 不触发，仅 R14 deleteRole 触发），errorMapping 仍映射具体中文以备未来。

### D21 · 测试 fixture 对齐 contracts 严格校验 + 组件 label 跨组件唯一（R15 S-13/S-14 教训合并）`[约束]`

R15 S-13 教训：R16 测试 fixture 须用有效 hex UUID（如 `00000000-0000-4000-8000-000000000001`），避免 z.string().uuid() 严格校验拒绝非 hex 字符导致 safeParse 失败测试永不调用实现。TransferForm/SetParentModal 涉及 uuid safeParse，fixture 须严格对齐。R15 S-14 教训：组件 label/aria-label 须跨组件唯一，避免 getByLabelText/getByText 部分匹配冲突——TransferForm/SetParentModal/InheritanceChainPanel/EffectivePermissionsPanel 不与 RoleListPage/UserListPage 既有 label 冲突（如 RoleListPage 有"角色名称"label，SetParentModal 须用"父角色"消歧；UserListPage 有"角色"按钮，EffectivePermissionsPanel 须用"有效权限"消歧）。

### D22 · 调岗历史不做（Q4，无专用端点，audit-logs 无 transfer 实体类型）`[advisory]`

Q4 决策①：调岗历史 out-of-scope。后端无专用"调岗历史"端点；audit-logs（GET /v1/audit-logs）entity_type 枚举为 `user/role/dept/notification/auth`（audit.ts L23），**无 "transfer" 实体类型**——调岗操作日志记录在 entity_type=user + action=update（与 user status update 混淆，无法按 entity_type 筛选调岗）。调岗历史为未来后端补"GET /v1/audit-logs?entity_type=transfer"或"GET /v1/users/:userId/transfer-history"端点后的方向，本轮 Out of scope。

### D23 · 角色继承链可视化图表不做（Q6 决策①链形文本，零新依赖）`[advisory]`

Q6 决策①：继承链用链形文本展示（" → " 分隔线性结构），不做树形图/DAG 图/层级图（须引入图表库违背零新依赖）。继承链为单继承线性结构，链形文本是最自然展示；树形过度渲染（单继承非多分支），面包屑语义偏导航不适用。继承链深度限制前端不预判（由后端 service 层 ROLE_INHERITANCE_CYCLE 环检测兜底）。

### 多 [约束] 组合副作用预判

> 提前标注多约束组合的潜在副作用，impl-writer 实现时须规避，偏离按 AI-003 反向同步。R13 S-2 固化：行为/数据/schema 偏离须同步 §10；纯 UI 文案偏离不须同步 §10 但须 Review 报告记录。R14 S-8~S-11 + R15 S-13~S-16 教训在本轮注意。

1. **「transfer 非 versioned (D8) + superRefine (D4) + 事务性单端点 (T4)」组合**：transfer 端点非 versioned（D8，T4），不传 If-Match，无 409 重试路径（无 If-Match 即无 VERSION_CONFLICT）。事务失败抛 TRANSFER_FAILED（聚合码，message 含失败步骤+底层原因，T1）由调用方处理（不重试，AC-F3-6）。superRefine oldRoleId === newRoleId 由 transferInputSchema.safeParse 前端拦截（D4，AC-F2-3，issue path=['newRoleId']），不到后端；若绕过前端直接调 API 后端兜底返回 TRANSFER_SAME_ROLE（AC-F3-7，D19）。impl-writer 须保证：(1) api/transfer.transferUser 不传 versioned/expectedVersion（D8）；(2) TransferForm 整体 safeParse 覆盖 superRefine（D4）；(3) 错误处理区分 TRANSFER_FAILED（聚合，展示 message）vs 校验码（USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN/TRANSFER_OLD_ROLE_NOT_ASSIGNED，直接传播，D19/T1）。**注**：transfer 非 versioned 与 R14/R15 versioned 写端点有意分歧，impl-writer 不得对 transfer 传 versioned=true。

2. **「setParent versioned (D7) + 409 重试复用 R12 D9 + ROLE_INHERITANCE_CYCLE (T2) + superRefine (D4)」组合**：setParent 端点 versioned（D7，T3），须 If-Match + 409 重试复用 R12 D9。但 409 重试**仅匹配 VERSION_CONFLICT**——ROLE_INHERITANCE_CYCLE（环检测，T2）/ROLE_BUILTIN_PARENT_FORBIDDEN 不重试（client 仅对 VERSION_CONFLICT 重试，继承域错误码直接抛 ApiError 由调用方处理，对齐 R15 NOTIFICATION_INVALID_TRANSITION 不重试模式）。superRefine roleId === parentRoleId 由 setParentInputSchema.safeParse 前端拦截（D4，AC-F4-2，对应 ROLE_SELF_INHERITANCE）；ROLE_BUILTIN_PARENT_FORBIDDEN 由 SetParentModal 禁用项前端防（D12，AC-F4-3）+ 后端 service 兜底。impl-writer 须保证：(1) client.ts 409 重试分支仅匹配 `code === 'VERSION_CONFLICT'`，ROLE_INHERITANCE_CYCLE/ROLE_BUILTIN_PARENT_FORBIDDEN 不误入重试路径（R12 client.ts L211 已保证 `err.code === 'VERSION_CONFLICT'` 判定，R16 无须改 client 重试逻辑）；(2) SetParentModal 整体 safeParse 覆盖 superRefine（D4）+ 禁用项前端防（D12）；(3) 错误处理区分 VERSION_CONFLICT（自动重试无提示）vs ROLE_INHERITANCE_CYCLE（"会形成继承环"，AC-F4-4）vs ROLE_BUILTIN_PARENT_FORBIDDEN（"内置角色不可设为父角色"，AC-F4-3）vs ROLE_NOT_FOUND（"角色不存在"，AC-F4-7，T2/D20）。

3. **「errorMapping 扩展 (D9) + R12/R14/R15 既有测试 (§9.1 ①类显式影响) + FALLBACK 收尾 (R14 S-11 闭合)」组合**：R16 扩展 SPECIFIC_MESSAGES 新增 transfer/inheritance 码中文提示，但映射表键仍从 `[...errorCodeSchema.options]` SSOT 派生（R12 D11）。errorCodeSchema 枚举未扩展（transfer/inheritance 码本就在枚举内），故 SSOT 派生断言不失效。但 R15 error-mapping-extend-2.test.ts 若断言"TRANSFER_SAME_ROLE → FALLBACK '操作失败'"+"ROLE_INHERITANCE_CYCLE → FALLBACK '操作失败'"会**明确失效**（因 R16 改为具体提示"新角色不能与原角色相同"/"会形成继承环"）。impl-writer 须调整 R15 error-mapping-extend-2.test.ts 断言（§9.1 #2，AI-002 须显式列出，matcher 改动须 Reviewer 判定）。**R14 S-11 闭合收尾**：R15 注释"TRANSFER/ROLE_INHERITANCE 域码本期前端不触发，保持 FALLBACK"须移除（因 R16 已扩展具体提示），注释须反映"扩展后 errorCodeSchema 全集所有码均映射具体中文提示，FALLBACK 仅作未来新增码兜底"（D9）。**注**：此为"填充既有 FALLBACK 码的具体提示"，非"新增枚举键"，SSOT 派生机制不变。R16 扩展后全码映射收尾，未来 contracts 新增码时 FALLBACK 兜底 + 后续轮次扩展 SPECIFIC_MESSAGES。

4. **「TransferForm 混合表单 (D4) + superRefine path=['newRoleId'] (T4) + 选择器数据源 (D13)」组合**：TransferForm 同时含自由文本（userId 须 safeParse uuid 校验）与类型派生（oldRoleId/newRoleId/toDepartmentId select，safeParse 冗余）两类字段。impl-writer 须保证：(1) TransferForm 整体表单调 `transferInputSchema.safeParse`（覆盖自由文本字段校验 + superRefine oldRoleId !== newRoleId → path=['newRoleId'] 字段级错误，T4）；(2) select 值经 options 派生保证合法（safeParse 不会在此字段失败）；(3) oldRoleId select 选项从 listUserRoles(userId) 派生（D13，前端防 TRANSFER_OLD_ROLE_NOT_ASSIGNED，userId 未输入/非法时为空，AC-F1-2）；(4) newRoleId select 选项从 listRoles 派生（全量角色，前端可在 select 中视觉提示 oldRoleId 选项防 TRANSFER_SAME_ROLE，但 superRefine 兜底，AC-F2-3）。**注**：AC-ARCH-4（类型派生不强制 safeParse）针对"独立的类型派生操作"（如 unsetParent/viewChain/effectivePermissions 按钮），不针对 TransferForm 内的 select 字段（因 TransferForm 整体须 safeParse 覆盖 userId + superRefine）。**R15 S-13 教训**：测试 fixture 须用有效 hex UUID，避免 safeParse 失败测试永不调用实现（D21）。

5. **「SetParentModal 禁用项 (D12) + superRefine (D4) + ROLE_INHERITANCE_CYCLE 服务端兜底 (T2)」组合**：SetParentModal parentRoleId select 选项从 listRoles 派生，禁用自继承 roleId（前端防 ROLE_SELF_INHERITANCE，AC-F4-2）+ 禁用内置 admin（前端防 ROLE_BUILTIN_PARENT_FORBIDDEN，AC-F4-3）。但前端禁用不等同后端守卫——若绕过前端直接调 API（如选 admin 作父或绕过 disabled 选自继承），后端返回 ROLE_SELF_INHERITANCE（superRefine，对应 setParentInputSchema safeParse 前端兜底，AC-F4-2）/ROLE_BUILTIN_PARENT_FORBIDDEN（service 兜底，AC-F4-3）/ROLE_INHERITANCE_CYCLE（环检测，service 兜底，AC-F4-4）。impl-writer 须保证：(1) SetParentModal parentRoleId select options 渲染时 disabled 项标记（自继承 roleId + is_builtin === true）；(2) 整体 safeParse 覆盖 superRefine roleId !== parentRoleId（D4）；(3) 错误处理区分 ROLE_SELF_INHERITANCE（"不能继承自身"）/ROLE_BUILTIN_PARENT_FORBIDDEN（"内置角色不可设为父角色"）/ROLE_INHERITANCE_CYCLE（"会形成继承环"，message 含环路径 A→B→A，前端展示通用提示不解析环路径，AC-F4-4）。**注**：前端禁用项是 UX 优化非安全防线（安全由后端 SEC 强制）。

6. **「InheritanceChainPanel 链形文本 (D10) + 根角色空数组 (D7/Q6) + 非 cacheable (T3)」组合**：InheritanceChainPanel 调 GET /v1/roles/:roleId/inheritance-chain（非 cacheable，T3，不发 If-None-Match）返回裸 `Role[]` 祖先数组。impl-writer 须保证：(1) 链形文本渲染按返回顺序" → " 分隔（AC-F6-1/F6-3）；(2) 根角色返回 [] 显示"无父角色"（AC-F6-2，D7）；(3) GET 不发 If-None-Match（R12 D15 沿用，T3 非 cacheable 与 cacheable 行为一致——前端始终 GET 取最新）；(4) 不依赖 GET /v1/roles/:id 单条详情（R14 Q9 决策②不消费，列表项 role.name 已知作链头或链头为父角色）；(5) 错误处理 ROLE_NOT_FOUND → "角色不存在"（AC-F6-4，T2/D20，roleId 竞态不存在）。**注**：inheritanceChainResultSchema 为 `Role[]` 裸数组无 envelope，前端直接消费数组（非 {items: Role[]}，对齐 R14 B5 listUserRoles 裸数组模式）。

7. **「EffectivePermissionsPanel modal (D11) + 权限码 SSOT 派生中文化 (R13 S-2) + 非 cacheable (T3)」组合**：EffectivePermissionsPanel 调 GET /v1/users/:userId/effective-permissions（非 cacheable，T3，不发 If-None-Match）返回裸 `PermissionCode[]` 集合。impl-writer 须保证：(1) 权限码列表渲染 + 中文化映射表键从 `[...permissionCodeSchema.options]` SSOT 派生（11 项全集，AI-005，禁止硬编码，AC-F7-3，D11）；(2) 空集合显示"该用户暂无有效权限"（AC-F7-2）；(3) 前端按 GET 返回顺序展示（后端去重排序保证确定性，无须客户端排序）；(4) GET 不发 If-None-Match（R12 D15 沿用，T3）；(5) 错误处理 USER_NOT_FOUND → "用户不存在"（AC-F7-4，T1/D19，userId 竞态不存在）。**注**：effectivePermissionsResultSchema 为 `PermissionCode[]` 裸数组无 envelope，前端直接消费数组（对齐 R14 B5 listUserRoles + R16 InheritanceChainResult 裸数组模式）。中文化映射为纯 UI 文案 R13 S-2 不须同步 §10 但须 Review 报告记录。

8. **「RoleListPage 行操作扩展 (D1/D15) + UserListPage 行操作扩展 + R14 既有测试 (§9.1 ①类显式影响)」组合**：R16 在 R14 RoleListPage.tsx 行操作扩展 3 按钮（设置父角色 + 解除父角色 + 查看继承链，Q5 决策①）+ R12/R14 UserListPage.tsx 行操作扩展 1 按钮（有效权限，Q7 决策③）。impl-writer 须保证：(1) RoleListPage 行操作按钮渲染：既有"删除"按钮保留 + 新增 3 按钮（"设置父角色"触发 SetParentModal、"解除父角色"仅 parent_role_id !== null 时显示 + 触发 unsetRoleParent、"查看继承链"触发 InheritanceChainPanel）；(2) UserListPage 行操作按钮渲染：既有"启停"+"角色"按钮保留 + 新增"有效权限"按钮触发 EffectivePermissionsPanel；(3) R14 role-list-page.test.tsx / user-list-page.test.tsx 既有断言若断言"行操作按钮数量=N"或"操作列仅含 X 按钮"则失效须调整（§9.1 #3/#4，AI-002 须显式列出）；(4) R16 新增的 3+1 按钮测试用例在新增 `role-list-page-extend.test.tsx` + `effective-permissions-panel.test.tsx`（+ `user-list-page-extend.test.tsx` 由 test-writer 定）中覆盖，R14 既有测仅做断言调整不重复覆盖（职责分离，对齐 R14 UserRolesPanel 模式）。**注**：行操作按钮 aria-label 须域特定（D18，"设置父角色"/"解除父角色"/"查看继承链"/"有效权限"，禁止通用"button"）+ 跨组件唯一（D21/R15 S-14，不与 RoleListPage 既有"删除"/UserListPage 既有"启停"/"角色"冲突）。

### §10 advisory 文案同步边界（R13 S-2 固化 + R14/R15 教训落地）

R13 S-2 固化：advisory 偏离预判须明确同步边界。R14 S-8~S-11 + R15 S-13~S-16 教训在本轮落地：

- **须同步 §10 的 advisory 偏离**（行为/数据/schema 偏离）：
  - D22 调岗历史不做（行为偏离：无专用端点，audit-logs 无 transfer 实体类型）—— 已同步 §10 D22。
  - D23 继承链可视化图表不做（行为偏离：须引入图表库违背零新依赖）—— 已同步 §10 D23。
- **不须同步 §10 但须 Review 报告记录的 advisory 偏离**（纯 UI 文案偏离）：
  - 继承链链形文本措辞（"父角色 B → 祖父角色 C → 曾祖父角色 D"，D10）—— impl-writer 可选措辞，须 Review 报告记录。
  - 权限码中文化映射（user:read→"查看用户"、transfer:write→"调岗用户" 等 11 项，D11）—— impl-writer 可选措辞，须 Review 报告记录。
  - 调岗成功提示文案（"调岗成功"，D14）—— impl-writer 可选措辞，须 Review 报告记录。
  - 错误提示文案（"用户 ID 须为 UUID 格式"/"新角色不能与原角色相同"/"会形成继承环"/"内置角色不可设为父角色" 等，§11）—— 对齐 §11 矩阵，措辞可微调，须 Review 报告记录。
  - 空状态文案（"无父角色"/"该用户暂无有效权限"，§6）—— impl-writer 可选措辞，须 Review 报告记录。
  - select option 文案（部门树扁平化后的部门名/角色名作为 option 显示，D13）—— impl-writer 据后端返回 name 渲染，须 Review 报告记录。
- **R14 教训落地**：
  - S-8（api 命名对齐 Spec §4.2）—— D17 [约束] 落地。
  - S-9（文本筛选"提交"按钮不每键入触发）—— D13/D14 [约束] 落地（userId 输入触发 listUserRoles 采用失焦/完整 uuid 触发，"提交调岗"按钮原子提交）。
  - S-10（aria-label 域特定）—— D18 [约束] 落地。
  - S-11（扩展既有模块同步注释）—— D9 [约束] 落地（errorMapping 注释同步移除"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"，全码映射收尾）。
- **R15 教训落地**：
  - S-13（测试 fixture 对齐 contracts 严格校验）—— D21 [约束] 落地。
  - S-14（组件 label 跨组件唯一）—— D18/D21 [约束] 落地。
  - S-15（长文本输入 per-test 超时）—— R16 TransferForm 无长文本输入（content 类），不适用。
  - S-16（动态 schema 渲染兜底）—— R16 无 z.record 动态 schema（R15 ReportTable 已处理），不适用。

## 11. 边界与异常（错误码 → 用户提示 + 交互行为矩阵）

> 对齐 contracts errorCodeSchema SSOT。R16 扩展 R12/R14/R15 errorMapping SPECIFIC_MESSAGES（D9），新增 transfer/inheritance 域码中文提示。映射表键 SSOT 派生（R12 D11 沿用）。R16 扩展后 errorCodeSchema 全集所有码均映射具体中文提示，FALLBACK 仅作未来新增码兜底。

### 11.1 调岗域错误码（T1 SSOT 核验，非臆造码）

> 调岗时引用实体不存在复用各域既有码（T1 核验），transfer 专属码仅 4 个。**禁止使用臆造 TRANSFER_USER_NOT_FOUND / TRANSFER_DEPT_NOT_FOUND / TRANSFER_ROLE_NOT_FOUND / TRANSFER_ROLE_BUILTIN_FORBIDDEN 码**（D19 [约束]）。

| ErrorCode | 触发场景 | 用户提示 | 交互行为 | AC |
|-----------|---------|---------|---------|-----|
| `USER_NOT_FOUND` | userId 不存在（调岗目标用户不存在） | "用户不存在" | TransferForm userId 字段级错误 + 不重置表单 | AC-F3-1 |
| `DEPT_NOT_FOUND` | toDepartmentId 不存在（目标部门不存在） | "部门不存在" | TransferForm toDepartmentId 字段级错误 + 刷新部门树 | AC-F3-2 |
| `ROLE_NOT_FOUND` | oldRoleId/newRoleId 不存在（角色被并发删除） | "角色不存在" | TransferForm newRoleId 字段级错误 + 刷新 listRoles | AC-F3-3 |
| `ROLE_BUILTIN_FORBIDDEN` | oldRole 为内置角色（admin 不可被调岗移除） | "内置角色不可移除" | TransferForm oldRoleId 字段级错误（**注**：复用 role 域既有码，非 transfer 专属码） | AC-F3-4 |
| `TRANSFER_OLD_ROLE_NOT_ASSIGNED` | 用户未持有 oldRole（竞态：listUserRoles 加载后到提交前被其他请求移除） | "用户未持有原角色" | TransferForm oldRoleId 字段级错误 + 重新加载 listUserRoles | AC-F3-5 |
| `TRANSFER_FAILED` | 事务失败聚合码（A/B/C 任一步骤失败且非上述校验码） | "调岗失败：{后端 message}" | 顶部错误提示 + 不重置表单（message 含失败步骤+底层原因，前端展示后端 message） | AC-F3-6 |
| `TRANSFER_COMPENSATION_FAILED` | 事务补偿失败（A/B 步骤已成功但补偿失败，需运维介入） | "调岗补偿失败，请联系运维" | 顶部错误提示 + 不重置表单 + 建议联系运维 | AC-F3-6（补偿场景） |
| `TRANSFER_SAME_ROLE` | 服务端兜底 superRefine（客户端 safeParse 未拦截绕过直接调 API 时） | "新角色不能与原角色相同" | TransferForm newRoleId 字段级错误 | AC-F3-7 |

**TRANSFER_FAILED message 透传约定**（D19 [约束]）：后端 message 含失败步骤+底层原因（如 "调岗失败：步骤 C 移除原角色失败 - role:write 权限不足"），前端展示完整后端 message（非前端硬编码替换）。SEC-003b：message 不含他人 PII（仅含失败步骤名 + 错误码/原因码，无 user.name/user.email 字段）。

### 11.2 角色继承域错误码（T2 SSOT 核验，非臆造 ROLE_INHERITANCE_NOT_FOUND）

> 角色继承域错误码为 4 个继承相关码（ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE/ROLE_HAS_CHILDREN），roleId/parentRoleId 不存在复用 `ROLE_NOT_FOUND`（T2 核验）。**禁止使用臆造 ROLE_INHERITANCE_NOT_FOUND 码**（D20 [约束]）。

| ErrorCode | 触发场景 | 用户提示 | 交互行为 | AC |
|-----------|---------|---------|---------|-----|
| `ROLE_SELF_INHERITANCE` | setParent roleId === parentRoleId（自继承，superRefine 前端兜底） | "不能继承自身" | SetParentModal parentRoleId 字段级错误（前端 safeParse 拦截，不到后端） | AC-F4-2 |
| `ROLE_BUILTIN_PARENT_FORBIDDEN` | parentRole 为内置 admin（admin 不可被设为父角色，service 兜底） | "内置角色不可设为父角色" | SetParentModal parentRoleId 字段级错误（前端禁用项 + 后端兜底） | AC-F4-3 |
| `ROLE_INHERITANCE_CYCLE` | 设置后会形成继承环（service 环检测，message 含环路径 A→B→A） | "会形成继承环" | SetParentModal 顶部错误提示（前端展示通用提示，不解析环路径；message 含环路径但前端不渲染环路径细节，仅展示通用提示避免 PII 泄露） | AC-F4-4 |
| `ROLE_NOT_FOUND` | roleId/parentRoleId 不存在（角色被并发删除） | "角色不存在" | SetParentModal 字段级错误 + RoleListPage 刷新（roleId 竞态）/InheritanceChainPanel 错误提示 + 关闭（roleId 竞态） | AC-F4-7 / AC-F5-4 / AC-F6-4 |
| `ROLE_HAS_CHILDREN` | 删除守卫码（角色仍有子角色，R16 不触发） | "角色仍有子角色，请先解除子角色继承" | errorMapping 映射具体中文以备未来（R14 deleteRole 场景，R16 setParent/unsetParent 不触发；前端禁用 admin 作父角色 + 后端 service 兜底，子角色存在场景在 unsetParent 后子角色变根角色不会触发此码） | 不在 R16 AC 范围（R14 deleteRole 已覆盖） |
| `VERSION_CONFLICT` | 乐观锁冲突（setParent/unsetParent 期间角色 version 变化） | （API client 自动重试 1 次无提示；重试仍冲突显示 "数据已被修改，请刷新后重试"） | API client D9 自动重试 1 次（用 409 body current_version）；重试成功无提示 + 刷新列表；重试仍 409 显示"数据已被修改，请刷新后重试" + 不自动刷新（用户手动刷新） | AC-F4-5 / AC-F4-6 / AC-F5-3 |

**ROLE_INHERITANCE_CYCLE message 处理约定**（D20 [约束]）：后端 message 含环路径（如 "会形成继承环：角色 A → 角色 B → 角色 A"），前端展示通用提示 "会形成继承环"（**不解析 message 渲染环路径细节**，避免环路径含 role.name/name 间接泄露 PII 风险——虽然 role.name 非 PII 但保持一致性 + 通用提示已足够用户理解）。SEC-003b：message 不直接含他人 PII，但环路径含 role.name 业务标识，前端统一展示通用提示是保守安全选择。

### 11.3 沿用 R12/R14/R15 的错误码（R16 不重复映射，仅引用）

R16 扩展 errorMapping 仅追加 transfer/inheritance 域码中文提示（§11.1/§11.2），R12/R14/R15 既有映射保持不变（D9 不破坏已映射码）。下列错误码沿用既有映射，**R16 Spec 不重复列示映射**，仅在交互行为层面标注 R16 新触发的场景：

| ErrorCode | 来源 | R16 新触发场景 | 交互行为（R16 部分） |
|-----------|------|---------------|---------------------|
| `UNAUTHORIZED` / `TOKEN_INVALID` / `TOKEN_EXPIRED` / `TOKEN_REVOKED` | R12 鉴权五守卫 | transfer/setParent/unsetParent/getInheritanceChain/getEffectivePermissions 请求 token 失效 | API client D8 401 拦截：清 token + 跳 /login（沿用 R12，AC-F10-2） |
| `INVALID_CREDENTIALS` | R12 login | 不在 R16 范围（R16 不涉及 login） | — |
| `FORBIDDEN` | R12/R14 越权 | transfer/setParent/unsetParent 调用方无 `transfer:write`/`role:write` 权限（后端 SEC-002 强制，前端不预判权限） | 顶部错误提示"无权限"（沿用 R14/R15 FORBIDDEN 模式） |
| `NETWORK_ERROR` | R12 网络兜底 | transfer/inheritance 请求网络失败 | 顶部错误提示"网络异常，请稍后重试"（client.ts 抛固定文案，不经 mapErrorToMessage） |
| `VALIDATION_ERROR` | R12/R14 输入校验 | transfer/setParent body schema 校验失败（前端 safeParse 已拦截，不到后端；若绕过 safeParse 后端兜底） | 顶部错误提示"输入校验失败"（沿用 R14/R15 VALIDATION_ERROR 模式） |
| `USER_NOT_FOUND` | R12/R14 user 域 | transfer userId 不存在（§11.1）+ effective-permissions userId 竞态不存在（AC-F7-4） | 已在 §11.1 / §6.6 标注 |
| `ROLE_NOT_FOUND` | R14 role 域 | transfer oldRoleId/newRoleId 不存在 + setParent roleId/parentRoleId 不存在 + unsetParent roleId 竞态 + inheritance-chain roleId 竞态 | 已在 §11.1 / §11.2 标注 |
| `DEPT_NOT_FOUND` | R14 dept 域 | transfer toDepartmentId 不存在（§11.1） | 已在 §11.1 标注 |
| `ROLE_BUILTIN_FORBIDDEN` | R14 role 域 | transfer oldRole 为内置角色（§11.1，复用非 transfer 专属） | 已在 §11.1 标注 |
| `ROLE_IN_USE` | R14 deleteRole | R16 不触发（deleteRole 在 R14 已覆盖） | — |
| `AUDIT_LOG_NOT_FOUND` / `NOTIFICATION_*` / `REPORT_*` | R14/R15 各域 | R16 不触发（各域已覆盖） | — |
| `VERSION_REQUIRED` | R12 乐观锁 | setParent/unsetParent 缺 If-Match（前端 D7 保证传 expectedVersion=role.version，不到后端；若 version=null/undefined 传 versioned=true 但 expectedVersion 缺失，client 不注入 If-Match，后端兜底 VERSION_REQUIRED） | 顶部错误提示"缺少版本号，请刷新后重试"（沿用 R14 VERSION_REQUIRED 模式） |

**R14 S-11 闭合收尾**（D9 [约束]）：R15 errorMapping.ts 注释 "TRANSFER/ROLE_INHERITANCE 域码本期前端不触发，保持 FALLBACK" 在 R16 扩展后**须移除**，注释须反映"扩展后 errorCodeSchema 全集所有码均映射具体中文提示（user/auth/role/dept/audit/notification/report/transfer/inheritance 全域覆盖），FALLBACK 仅作未来新增码兜底"。R12 扩展 user/auth + R14 扩展 role/dept + R15 扩展 notification/report + R16 扩展 transfer/inheritance，**全码映射收尾**。impl-writer 同步注释时须保留 SSOT 派生机制说明（映射表键 = `[...errorCodeSchema.options]`，R12 D11 沿用），仅移除"未映射域"措辞。

### 11.4 PII 安全补充（SEC-003a/003b 边界，R16 无新 PII 面）

R16 transfer/inheritance 域经 §3.3 PII 清单核验，**无 PII 字段**（contracts 明示均为 uuid 引用 + 权限码集合 + Role 业务标识）。SEC-003a/003b 在 R16 的延伸约束：

| 安全约束 | R16 落地 |
|---------|---------|
| SEC-003a（输出 schema .strict()） | transfer/inheritance GET 端点返回裸 `Role[]`/`PermissionCode[]` 数组（contracts schema 已 .strict() 拒绝多余字段，前端直接消费数组无须再断言 .strict()——对齐 R14 B5 listUserRoles 裸数组模式）。TransferForm/SetParentModal 提交体经 `transferInputSchema.safeParse`/`setParentInputSchema.safeParse` 整体校验（含 .strict() 拒绝多余字段，AC-F2-4/AC-F4-2）。 |
| SEC-003b（错误消息不回显他人 PII） | (1) TRANSFER_FAILED message 透传：后端 message 含失败步骤+底层原因，**不含 user.name/user.email 等 PII**（仅含步骤名 + 错误码/原因码），前端展示完整后端 message（§11.1 约定）；(2) ROLE_INHERITANCE_CYCLE message 处理：后端 message 含环路径（role.name 业务标识），前端**展示通用提示不渲染环路径细节**（§11.2 约定，保守安全选择）；(3) USER_NOT_FOUND/ROLE_NOT_FOUND/DEPT_NOT_FOUND 错误提示为通用"X 不存在"，**不回显 userId/roleId/deptId 值**（避免引用 id 间接泄露存在性）。 |
| 测试 PII 边界（R12 SEC-003b 沿用） | 测试 fixture 须用脱敏 stub token（如 'stub-token'，禁止真实 token 字符串）+ stub uuid（如 `00000000-0000-4000-8000-000000000001`，禁止真实用户 uuid）。R16 测试不 console.log/记录 token 字符串（R12 SEC-003b 沿用，D16）。 |
| 权限边界（SEC-002） | transfer/setParent/unsetParent 调用方须有 `transfer:write`/`role:write` 权限（后端 SEC-002 强制，前端不预判权限依赖后端 FORBIDDEN 返回显示"无权限"）。getInheritanceChain/getEffectivePermissions 调用方须有 `role:read`/`user:read` 权限（同上）。前端不实现权限隐藏（依赖后端兜底 + 错误提示）。 |

**R16 无新 PII 处理面**：transfer/inheritance 域字段均为 uuid 引用 + 权限码集合 + Role 业务标识（name/description/permission_codes/is_builtin/parent_role_id/version），**无 PII 字段**（contracts 注释明示）。R16 不引入脱敏态/存储态区分（无 entity schema），不引入新 PII 处理面。SEC-003b 延伸仅体现在错误消息透传约定（§11.1 TRANSFER_FAILED message + §11.2 ROLE_INHERITANCE_CYCLE message 通用提示）。

## 12. 工程配置（R16 零新增依赖，复用 R12/R14/R15 配置）

> R16 **零新增工程配置**，全部复用 R12/R14/R15 既有配置。AC-F10-3 零新依赖核验（§9.3 T7 navigation-extend-2.test.tsx 工程核验）。

### 12.1 package.json 依赖（零新增，AC-F10-3）

R16 沿用 R12/R14/R15 既有依赖，**零新增**第三方依赖（无 axios/ky/Redux/Zustand/UI 框架/Playwright/图表库/可视化库）：

| 依赖类别 | 既有依赖（R12/R14/R15 已声明） | R16 用途 |
|---------|-------------------------------|---------|
| 运行时 | `react` / `react-dom` / `react-router-dom` | TransferPage/TransferForm/SetParentModal/InheritanceChainPanel/EffectivePermissionsPanel 组件 + 路由 |
| 类型 | `@admin/contracts`（workspace） | transferInputSchema/setParentInputSchema/unsetParentInputSchema/inheritanceChainResultSchema/effectivePermissionsResultSchema/roleSchema/permissionCodeSchema/errorCodeSchema + z.infer 类型派生 |
| 测试 | `vitest` / `@testing-library/react` / `@testing-library/user-event` / `jsdom` | 9 新增测试文件（§9.3） |
| 构建 | `vite` / `typescript` | 沿用 R12 配置 |

**禁止新增依赖**（D1 [约束] / R12 D5 沿用）：impl-writer 不得在 apps/web/package.json 新增任何 dependency/devDependency。若实现期发现须新依赖（如日期库/图表库），按 advisory 偏离处理：反向同步 Spec §10 + Reviewer 判定 + 编排者确认（AI-003）。R16 已预判的 advisory 偏离：D23 继承链可视化图表不做（避免引入图表库）。

### 12.2 tsconfig.json（无改动，沿用 R12）

R16 沿用 R12 tsconfig.json 配置（`strict: true` / `noEmit: true` / path alias `@admin/contracts` → `packages/contracts/src` / `apps/web/src` 内部相对模块解析）。新增 7 个前端文件 + 扩展 6 个既有文件自动受 tsconfig 覆盖。**G3 门禁**：`npx tsc --noEmit` 须全绿（typecheck 0 错误）。

### 12.3 vite.config.ts（无改动，沿用 R12）

R16 沿用 R12 vite.config.ts 配置（React 插件 + Vitest 配置 + jsdom 环境 + workspace 依赖解析）。新增 7 个前端文件自动受 vite 构建覆盖。

### 12.4 ESLint / lint:rules（无新增规则，R12/R13 已机器化）

R16 沿用 R12/R13 既有 lint 配置 + `scripts/check-rules.mjs` 校验脚本：

- **ARCH-003 分支**（R12 §8 落地）：扫描 apps/web/src import，禁止 `^@admin/api\b` / `api/src/` 子串 / `^apps/api\b`。R16 新增 7 文件 + 扩展 6 文件自动受此分支覆盖（§8）。
- **CODE 扫描器**（R13 S-4 已覆盖前端）：CODE-001（禁 any）/CODE-002（禁空 catch）/CODE-003（禁 eval/Function）/CODE-004（Zod schema 命名后缀）/AI-005（禁硬编码跨域集合）自动覆盖 apps/web/src + apps/web/test。
- **AC-ARCH-1 门禁**：`npm run lint:rules` 探针验证 ARCH-003 + CODE 合规性，违规即 exit≠0（§9.3 T7 工程核验 + Reviewer 逐文件核对）。
- **R16 无新增规则**：本轮不新增 .trae/rules 规则文件，不扩展 check-rules.mjs 校验分支（R12/R13 已机器化覆盖前端，§8.4 layering.md 无须更新）。

### 12.5 Vitest 配置（沿用 R12/R14/R15，per-file jsdom 注解）

R16 沿用 R12/R14/R15 Vitest 配置：

- **环境**：`.tsx` 测试文件用 per-file `// @vitest-environment jsdom` 注解（R12 D20 沿用）；`.ts` 测试文件（api-transfer.test.ts / api-role-inheritance.test.ts / error-mapping-extend-3.test.ts）用默认 Node 环境（无 jsdom 注解，纯单测/契约测不渲染组件）。
- **mock**：`vi.mock('../src/api/transfer.js', ...)` / `vi.mock('../src/api/role-inheritance.js', ...)` / `vi.mock('../src/api/roles.js', ...)` / `vi.mock('../src/api/departments.js', ...)` mock api 模块；`vi.mock('global.fetch')` mock fetch（API client 契约测）；AuthContext.Provider 提供已登录态（组件测）。
- **测试命令**：`npm test`（vitest run）或 `npx vitest run apps/web/test/`（仅前端测试）。**G5 门禁**：vitest 全绿（含 9 新增测试文件 + R12/R14/R15 既有测试）。
- **断言级红**（AI-002）：9 新增测试文件须在 impl-writer 实现前先跑出断言级红（因 transfer/role-inheritance api 模块 + TransferPage/TransferForm/SetParentModal/InheritanceChainPanel/EffectivePermissionsPanel 组件未实现，import 失败为导入级红——须 test-writer 用 stub 抛 NOT_IMPLEMENTED 实现断言级红，对齐 R14 role-list-page.test.tsx 模式）。

### 12.6 文件清单（impl-writer 落地，对齐 §2.1 目录结构）

R16 改动文件清单（impl-writer 阶段落地，AI-002 须显式列每个文件 + 改动性质 + 理由）：

**新增 7 文件**（apps/web/src）：
1. `apps/web/src/api/transfer.ts` —— transfer 域 endpoint（§4.2.1，transferUser 函数）。
2. `apps/web/src/api/role-inheritance.ts` —— role-inheritance 域 endpoint（§4.2.2，setRoleParent/unsetRoleParent/getInheritanceChain/getEffectivePermissions 4 函数）。
3. `apps/web/src/pages/TransferPage.tsx` —— 调岗独立页（§6.1，含 TransferForm + 选择器数据源加载）。
4. `apps/web/src/components/TransferForm.tsx` —— 调岗混合表单（§6.2，4 字段 + safeParse + superRefine）。
5. `apps/web/src/components/SetParentModal.tsx` —— 设置父角色弹窗（§6.4，versioned + superRefine + 禁用项）。
6. `apps/web/src/components/InheritanceChainPanel.tsx` —— 继承链展示（§6.5，链形文本 + 根角色空数组）。
7. `apps/web/src/components/EffectivePermissionsPanel.tsx` —— 有效权限展示（§6.6，权限码列表 + 中文化 SSOT 派生）。

**扩展 6 既有文件**（apps/web/src，须 AI-002 边界标注 + ①类显式影响注释）：
1. `apps/web/src/components/Sidebar.tsx` —— 新增调岗入口（6→7 入口，D15，①类显式影响 R15 navigation-extend.test.tsx）。
2. `apps/web/src/App.tsx` —— 新增 /transfer 路由（§7，①类显式影响 R15 navigation-extend.test.tsx 路由可达性）。
3. `apps/web/src/lib/errorMapping.ts` —— 扩展 SPECIFIC_MESSAGES（新增 transfer/inheritance 码中文 + 移除"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"注释 + 全码映射收尾，D9，①类显式影响 R15 error-mapping-extend-2.test.ts 2 断言）。
4. `apps/web/src/pages/RoleListPage.tsx` —— 行操作扩展 3 按钮（设置父角色 + 解除父角色 + 查看继承链，§6.3，①类显式影响 R14 role-list-page.test.tsx 边缘）。
5. `apps/web/src/pages/UserListPage.tsx` —— 行操作扩展 1 按钮（有效权限，§6.7，①类显式影响 R14 user-list-page.test.tsx 边缘）。
6. `apps/web/src/components/UserRow.tsx` —— 新增"有效权限"按钮（§6.7，与 UserListPage 同步扩展）。

**新增 9 测试文件**（apps/web/test，§9.3）：
1. `apps/web/test/api-transfer.test.ts`（T1）
2. `apps/web/test/api-role-inheritance.test.ts`（T1）
3. `apps/web/test/transfer-form.test.tsx`（T3）
4. `apps/web/test/set-parent-modal.test.tsx`（T4）
5. `apps/web/test/role-list-page-extend.test.tsx`（T2，①类显式影响扩展 R14）
6. `apps/web/test/inheritance-chain-panel.test.tsx`（T5）
7. `apps/web/test/effective-permissions-panel.test.tsx`（T6）
8. `apps/web/test/navigation-extend-2.test.tsx`（T7，①类显式影响扩展 R15）
9. `apps/web/test/error-mapping-extend-3.test.ts`（T9，①类显式影响扩展 R15）

**改动 3~4 既有测试文件**（apps/web/test，①类显式影响处理，AI-002 须显式列出 + matcher 改动须 Reviewer 判定）：
1. `apps/web/test/navigation-extend.test.tsx`（R15）—— 6 入口断言调整为 7 入口（明确失效，§9.1 #1）。
2. `apps/web/test/error-mapping-extend-2.test.ts`（R15）—— TRANSFER_SAME_ROLE/ROLE_INHERITANCE_CYCLE → FALLBACK 断言调整为具体中文（明确失效 2 断言，§9.1 #2）。
3. `apps/web/test/role-list-page.test.tsx`（R14）—— 行操作按钮数量断言调整（边缘，以实际断言为准，§9.1 #3）。
4. `apps/web/test/user-list-page.test.tsx`（R14）—— 行操作按钮数量断言调整（边缘，以实际断言为准，§9.1 #4）。

**禁止改动**（impl-writer 边界）：
- `apps/api/src/**`（service/repo/domain/router/server.ts/errors.ts）—— 后端冻结（PRD 明示不改后端）。
- `packages/contracts/src/**` —— 契约层冻结（PRD 明示 contracts 已就绪，R16 复用既有 schema）。
- `.trae/rules/**` —— 规则层冻结（R12/R13 已机器化，R16 无新增规则）。
- `scripts/check-rules.mjs` —— 校验脚本冻结（R12/R13 已覆盖前端，R16 无新增校验逻辑）。
- R12/R14/R15 既有测试断言（除 §9.1 ①类显式影响列出的 3~4 文件断言调整外，禁止改其他既有测试断言，AI-002）。

### 12.7 三件套门禁（AI-004，G5）

impl-writer 每次改动须跑三件套（AI-004）：

1. **typecheck**：`npx tsc --noEmit`（根目录或 apps/web）须 0 错误。
2. **lint:rules**：`npm run lint:rules` 须 exit 0（ARCH-003 + CODE 扫描器全绿）。
3. **test**：`npx vitest run` 须全绿（含 9 新增测试 + R12/R14/R15 既有测试 + ①类显式影响调整后的 3~4 既有测试）。

**G5 门禁**：三件套全绿方可合入。**G6 门禁**：Reviewer 逐条核对 PRD AC + 规则合规 + 0 blocker。**G7 门禁**：G1+G3+G4+G5+G6 全绿。

---

> **Spec 完结**：R16 Tech-Spec 覆盖 §1~§12 全部章节，含 D1~D23 决策（21 [约束] + 2 [advisory]）+ 8 条多 [约束] 组合副作用预判 + §9 9 新增测试文件 + AC↔测试覆盖矩阵（R13 S-3）+ 4 ①类显式影响预警（R15 navigation-extend.test.tsx + R15 error-mapping-extend-2.test.ts 明确 + R14 role-list-page.test.tsx + R14 user-list-page.test.tsx 边缘）。R16 闭合 transfer + role-inheritance 两域前端化 + errorMapping 全码映射收尾（R14 S-11 闭合）+ R13 S-1 混合表单 vs 类型派生操作区分 + R12 D7/D9 versioned 重试复用 + BA T1~T4 contracts SSOT 偏离遵循。后端/契约/规则层冻结，仅前端扩展（7 新增 + 6 扩展 + 9 新增测试 + 3~4 既有测试调整），impl-writer 阶段落地。




