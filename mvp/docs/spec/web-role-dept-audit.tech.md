---
doc_type: Tech-Spec
id: TECH-WEB-ROLE-DEPT-AUDIT-001
title: 前端角色/部门/审计管理页（R14 前端多域扩展）Tech-Spec
prd_ref: PRD-WEB-ROLE-DEPT-AUDIT-001
status: ready
owner: tech-lead@team
created: 2026-07-03
extends: TECH-WEB-AUTH-USER-001
aligns: [TECH-ROLE-001, TECH-ROLE-INHERITANCE-001, TECH-DEPT-001, TECH-AUDIT-001]
---

# TECH-WEB-ROLE-DEPT-AUDIT-001 · 前端角色/部门/审计管理页 Tech-Spec

> 派生自 PRD-WEB-ROLE-DEPT-AUDIT-001（status=decided，13 个 BLOCKING Q&A 已拍板，68 条 AC，含 BA 核验发现 B1~B5 contracts SSOT 偏离 + AC↔测试覆盖矩阵）。
> **契约层本轮无新增**：packages/contracts 已就绪（角色/部门/审计契约在 R5/R7/R8 落地），前端全部复用既有 Zod schema + z.infer 类型。本 Spec 不改 contracts。
> **后端本轮冻结**：不改 service/repo/domain/router/server.ts（后端 R1-R11 778 用例 + R12 883 基线全绿，PRD 明示"不改后端"）。
> **前端基础设施零新增**：R12 已落地 api/client.ts（Bearer/If-Match/401 拦截/409 重试/wire 适配）、auth/（tokenStore/AuthContext/RouteGuard）、components/ErrorBanner、lib/errorMapping；R14 仅新增 api 模块 + pages + components，零新依赖。
> 本阶段只产本文档；apps/web 源码改动由 impl-writer 阶段落地（§6/§7 描述为设计 + [advisory] 实现提示）。
> R14 核心验证点：前端多域扩展适应性 + versioned DELETE 重试复用 + 递归契约渲染 + R13 S-1 自由文本/类型派生区分在多域下落地。

## 1. 覆盖范围与既有端点核验（R10 S-2 / R13 S-1 教训闭合）

R10 S-2 教训：Spec 须核验既有路由表，确认前端调用的端点均存在、非覆盖既有路由。本节核验 `apps/api/src/server.ts` routes 数组（L221~L374），R14 涉及端点已由 BA 核验（PRD BA 核验发现 B1~B5）。

### 1.1 前端调用端点清单（逐条核验）

| # | 端点 | method | server.ts 行 | auth | versioned | cacheable | 核验结论 |
|---|------|--------|--------------|------|-----------|-----------|----------|
| E1 | `/v1/roles` | GET | L264 | admin | false | **true** | 存在，cacheable（后端生成 ETag，前端不发送 If-None-Match，沿用 R12 D15） |
| E2 | `/v1/roles` | POST | L265 | admin | false | false | 存在，创建角色 |
| E3 | `/v1/roles/:id` | DELETE | L271-275 | admin | **true** | false | 存在，versioned=true（须 If-Match header，复用 R12 D7/D9） |
| E4 | `/v1/users/:userId/roles` | GET | L276-280 | admin | false | false | 存在，返回裸 `UserRole[]`（无 envelope，B5） |
| E5 | `/v1/users/:userId/roles/:roleId` | POST | L281-285 | admin | false | false | 存在，分配角色（path 参数，body 空） |
| E6 | `/v1/users/:userId/roles/:roleId` | DELETE | L286-290 | admin | false | false | 存在，移除角色（path 参数，body 空） |
| E7 | `/v1/departments/tree` | GET | L318 | admin | false | false | 存在，返回 `DepartmentTreeResult`（递归树） |
| E8 | `/v1/departments` | POST | L319 | admin | false | false | 存在，创建部门 |
| E9 | `/v1/departments/:id` | DELETE | L320-324 | admin | **false** | false | 存在，**非 versioned**（无第 5 参 true，无 If-Match） |
| E10 | `/v1/departments/:departmentId/users/:userId` | POST | L325-332 | admin | false | false | 存在，用户部门归属分配（覆盖式幂等，B4） |
| E11 | `/v1/audit-logs` | GET | L335 | admin | false | false | 存在，只读列表（append-only 域无写端点） |

核验结论：**前端调用的 11 个端点全部存在于既有路由表**，本轮不新增任何后端端点。R10 S-2 教训闭合。

### 1.2 端点存在但本轮不消费（Out of scope 记录）

以下端点存在于 server.ts 路由表，但本轮前端不消费（Q9/Q10/Q11 决策② out-of-scope），仅记录以闭合"端点核验"完整性：

| 端点 | method | server.ts 行 | versioned | 不消费原因 |
|------|--------|--------------|-----------|-----------|
| `/v1/roles/:id` | GET | L266-270 | false (cacheable=true) | Q9 决策②：仅列表不做详情页，列表行展示字段足够 |
| `/v1/roles/:roleId/parent` | POST | L293-300 | **true** | Q10 决策②：角色继承管理 out-of-scope（独立轮次） |
| `/v1/roles/:roleId/parent` | DELETE | L301-305 | **true** | Q10 决策②：同上 |
| `/v1/roles/:roleId/inheritance-chain` | GET | L306-310 | false | Q10 决策②：同上 |
| `/v1/users/:userId/effective-permissions` | GET | L311-315 | false | Q11 决策②：effective-permissions 查看 out-of-scope（与继承管理同轮次） |

> **注**：POST/DELETE `/v1/roles/:roleId/parent` 为 versioned 端点（server.ts L293/L301 第 5 参 true），但 Q10 out-of-scope 不消费，故 R14 不涉及该端点的 If-Match/重试逻辑。未来继承管理轮次启用时须复用 R12 D7/D9 + 本 Spec D7 的 versioned 处理模式。

### 1.3 BA 核验发现 B1~B5 偏离在 Spec 的遵循（contracts SSOT 优先）

PRD BA 核验发现 5 处任务描述与 contracts SSOT 偏离，本 Spec 一律以 contracts SSOT 为准：

| # | 偏离措辞 | contracts SSOT 实际 | Spec 遵循点 |
|---|---------|---------------------|-------------|
| B1 | "角色创建 name+code+permissions" / "ROLE_CODE_DUPLICATE" | `roleSchema`/`createRoleInputSchema` 无 `code` 字段（name 全局唯一 1..64）；冲突码 `ROLE_NAME_DUPLICATE` | §3.1 Role/CreateRoleInput 类型 + §3.2 自由文本表单 safeParse + §11 错误码矩阵 |
| B2 | "角色列表（分页+筛选）" | `listRoleQuerySchema` 仅 `{page, pageSize}`，无筛选字段 | §3.1 ListRoleQuery + §6.1 RoleListPage 客户端名称搜索 [advisory] 仅过滤当前页 |
| B3 | "审计日志筛选 actor/action/resource_type/date_range" | `listAuditLogQuerySchema` 支持 `operated_from/operated_to/operator_id/entity_type`，明示不支持 action | §3.1 ListAuditLogQuery + §6.6 AuditLogPage 筛选区无 action 控件 |
| B4 | "用户部门分配成功/已在该部门" | errorCodeSchema 无"已在该部门"码；`assignUserDepartmentInputSchema` 覆盖式幂等，重复分配同部门=200 | §11 错误码矩阵（无"已在该部门"码）+ §6.5 DeptTreePage 重复分配幂等成功无提示 |
| B5 | "userRolesResultSchema/roleDeleteInputSchema 等在 contracts" | GET /v1/users/:userId/roles 返回裸 `UserRole[]`（userRoleSchema 数组，无 envelope）；procedure input schema 在 apps/api 不消费 | §3.1 UserRole 类型 + §4 api/roles.ts listUserRoles 返回 `Promise<UserRole[]>` |

### 1.4 本期覆盖范围（PRD F1~F10 + ARCH-003 + R13 S-1）

- F1 角色列表页 → E1
- F2 角色创建（自由文本表单）→ E2
- F3 角色删除（versioned + 409 重试）→ E3
- F4 用户角色分配面板（类型派生操作）→ E4/E5/E6
- F5 部门树页（递归渲染 + 创建 + 删除）→ E7/E8/E9
- F6 用户部门分配（类型派生操作，幂等）→ E10
- F7 审计日志页（只读 + 筛选）→ E11
- F8 导航扩展 → 侧边栏 + 路由守卫复用 R12
- F9 错误处理 → errorMapping 扩展 SPECIFIC_MESSAGES
- F10 前端基础设施复用 + ARCH-003 合规 → 复用 R12，零新增基础设施
- ARCH-003 合规专项 → §8（R12 已机器化，新模块继续受约束）
- R13 S-1 合规专项 → §3.2 区分自由文本表单 vs 类型派生操作

## 2. 前端分层架构（复用 R12 §2 分层 + 新增三域模块）

### 2.1 目录结构（R14 新增部分以 `+` 标注）

```
apps/web/
├── package.json                 # R12 依赖声明（R14 零新增，§12）
├── tsconfig.json                # R12 配置（R14 无改动）
├── vite.config.ts               # R12 配置（R14 无改动）
├── index.html                   # SPA 入口
└── src/
    ├── main.tsx                 # 应用挂载（R12）
    ├── App.tsx                  # 路由表（§7 新增 3 路由）+ AuthProvider + Sidebar 布局
    ├── api/
    │   ├── client.ts            # R12 fetch 封装 request<T>（§4 复用，零改动）
    │   ├── auth.ts              # R12 login/logout endpoint
    │   ├── users.ts             # R12 users endpoint
    │   ├── roles.ts             # + R14 角色域 endpoint（§4）
    │   ├── departments.ts       # + R14 部门域 endpoint（§4）
    │   └── audit-logs.ts        # + R14 审计域 endpoint（§4）
    ├── auth/
    │   ├── tokenStore.ts        # R12（leaf，无改动）
    │   ├── AuthContext.tsx      # R12（无改动）
    │   └── RouteGuard.tsx       # R12（白名单仍仅 /login，新路由自动受守卫覆盖）
    ├── pages/
    │   ├── LoginPage.tsx        # R12
    │   ├── UserListPage.tsx     # R12（+ 行操作"角色"按钮触发 UserRolesPanel）
    │   ├── RoleListPage.tsx     # + R14 角色列表/创建/删除
    │   ├── DeptTreePage.tsx     # + R14 部门树/创建/删除/用户分配
    │   └── AuditLogPage.tsx     # + R14 审计列表/筛选（只读）
    ├── components/
    │   ├── ErrorBanner.tsx      # R12（无改动）
    │   ├── UserRow.tsx          # R12（+ "角色"操作按钮）
    │   ├── CreateUserModal.tsx  # R12
    │   ├── Sidebar.tsx          # + R14 侧边栏导航（用户/角色/部门/审计 + 登出）
    │   ├── RoleForm.tsx         # + R14 角色创建表单（自由文本 + 权限码多选）
    │   ├── UserRolesPanel.tsx   # + R14 用户角色分配面板（类型派生 toggle）
    │   ├── DeptForm.tsx         # + R14 部门创建表单（自由文本 name + parentId 可选）
    │   └── DeptNode.tsx         # + R14 部门树递归节点组件
    └── lib/
        └── errorMapping.ts      # R12（+ R14 扩展 SPECIFIC_MESSAGES 角色/部门码）
```

### 2.2 各层职责与依赖方向（沿用 R12 §2.2）

R14 新增模块遵循 R12 既定分层与依赖方向，不引入新依赖层级：

| 新增模块 | 层 | 职责 | 允许依赖 | 禁止依赖 |
|----------|----|------|----------|----------|
| `api/roles.ts`、`api/departments.ts`、`api/audit-logs.ts` | api 层 | endpoint 封装（拼 path/query/body 调 client） | api/client、@admin/contracts | pages/、components/、apps/api/src/** |
| `pages/RoleListPage.tsx`、`pages/DeptTreePage.tsx`、`pages/AuditLogPage.tsx` | pages 层 | 页面组件（状态 + 交互） | api/roles、api/departments、api/audit-logs、auth/AuthContext、components/、@admin/contracts、lib/errorMapping | 直连 fetch（须经 api/client） |
| `components/RoleForm.tsx`、`components/DeptForm.tsx`、`components/UserRolesPanel.tsx`、`components/DeptNode.tsx`、`components/Sidebar.tsx` | components 层 | 复用组件 | @admin/contracts、lib/、api/（仅 UserRolesPanel/Sidebar 须调 api） | pages/ |

**依赖方向单向**（沿用 R12）：`pages/components → api → {client → tokenStore/lib}`；`pages → auth/AuthContext → api/auth → client`。`tokenStore` 与 `lib/` 为叶子层。R14 新增模块不破坏既有依赖图。

### 2.3 ARCH-003 在新模块的体现

ARCH-003「跨层只经契约」对 R14 新增模块的约束（沿用 R12 D2）：

- `apps/web/src` 全部新增模块（api/roles.ts、api/departments.ts、api/audit-logs.ts、pages/RoleListPage.tsx、pages/DeptTreePage.tsx、pages/AuditLogPage.tsx、components/RoleForm.tsx、components/DeptForm.tsx、components/UserRolesPanel.tsx、components/DeptNode.tsx、components/Sidebar.tsx）只能 import `@admin/contracts`（类型 + Zod schema）+ 第三方依赖（react/react-router-dom）+ apps/web/src 内部模块。
- **禁止 import `apps/api/src/**`**（repository/service/domain/router/server）与 `@admin/api` 包。
- 后端能力只能经 HTTP（api/client → router 端点）调用，类型只能经 contracts 派生。
- 机器化校验见 §8（R12 已落地 ARCH-003 分支 + R13 S-4 已让 CODE 扫描器覆盖前端）。

## 3. 数据契约消费（R13 S-1 固化：类型派生 + schema 复用 + 自由文本/类型派生区分）

### 3.1 从 @admin/contracts 派生的类型清单

> 全部类型经 `z.infer` 派生，**禁止手写 TS 类型副本**（R12 D3 [约束]，ARCH-002/CODE-004 延伸）。

**角色域类型**（源自 `packages/contracts/src/schemas/role.ts`）：

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `Role` | `z.infer<typeof roleSchema>` | 角色实体 `{id, name, description, permission_codes, is_builtin, parent_role_id, created_at, version}`（**无 code 字段**，B1） |
| `PermissionCode` | `z.infer<typeof permissionCodeSchema>` | 权限码枚举（11 项：user:read/.../transfer:write），多选 options 派生源 |
| `CreateRoleInput` | `z.infer<typeof createRoleInputSchema>` | 创建角色表单提交体 `{name(1..64), description(max512), permission_codes(array)}`，.strict() |
| `ListRoleQuery` | `z.infer<typeof listRoleQuerySchema>` | `{page(默认1), pageSize(默认10,max100)}`，**无筛选字段**（B2） |
| `RoleListResult` | `z.infer<typeof roleListResultSchema>` | `{items, total, page, pageSize, totalPages}` |
| `UserRole` | `z.infer<typeof userRoleSchema>` | 用户-角色关联 `{id, user_id, role_id, assigned_at}`，GET /v1/users/:userId/roles 返回 `UserRole[]`（**裸数组，无 envelope**，B5） |
| `AssignRoleInput` | `z.infer<typeof assignRoleInputSchema>` | `{userId, roleId}`（path 参数合并形态，前端实际经 path 传，body 空） |

**部门域类型**（源自 `packages/contracts/src/schemas/dept.ts`）：

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `Department` | `z.infer<typeof departmentSchema>` | 部门实体 `{id, name, parent_id, created_at}` |
| `CreateDepartmentInput` | `z.infer<typeof createDepartmentInputSchema>` | 创建部门表单 `{name(1..64), parent_id?(uuid\|null 可选)}`，parentId 缺省/null=根部门 |
| `DepartmentTreeNode` | `z.infer<typeof departmentTreeNodeSchema>` | 递归树节点 `{id, name, parent_id, created_at, children: DepartmentTreeNode[]}`，叶节点 children=[] |
| `DepartmentTreeResult` | `z.infer<typeof departmentTreeResultSchema>` | `{items: DepartmentTreeNode[]}`（根节点构成的树数组） |
| `AssignUserDepartmentInput` | `z.infer<typeof assignUserDepartmentInputSchema>` | `{userId, departmentId(uuid\|null)}`，departmentId 必填可空（null=解除归属） |

**审计域类型**（源自 `packages/contracts/src/schemas/audit.ts`）：

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `RedactedAuditLog` | `z.infer<typeof redactedAuditLogSchema>` | 审计日志查询返回项（**脱敏态**），`{id, operator_id, operator_name, entity_type, entity_id, action, operated_at, before, after, created_at}`；before/after 中 pii=true 字段已脱敏 |
| `AuditLogEntityType` | `z.infer<typeof auditLogEntityTypeSchema>` | 实体类型枚举 `user/role/dept/notification/auth`（5 项），筛选 select options 派生源 |
| `AuditLogAction` | `z.infer<typeof auditLogActionSchema>` | 动作枚举 `create/update/delete/login/login_failed/logout`（**仅展示用，不支持 action 筛选**，B3） |
| `ChangeField` | `z.infer<typeof changeFieldSchema>` | before/after 元素 `{field, value, pii}` |
| `ListAuditLogQuery` | `z.infer<typeof listAuditLogQuerySchema>` | `{page, pageSize(默认20,钳制100), operated_from?, operated_to?, operator_id?, entity_type?}`，**无 action** |
| `AuditLogListResult` | `z.infer<typeof auditLogListResultSchema>` | `{items: RedactedAuditLog[], total, page, pageSize, totalPages}` |

**共享类型**（源自 `packages/contracts/src/schemas/user.ts`，R12 已消费，R14 复用）：

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `ErrorCode` | `z.infer<typeof errorCodeSchema>` | 全局错误码 SSOT（含 ROLE_*/DEPT_*/AUDIT_LOG_NOT_FOUND 等），errorMapping 键派生源 |
| `ErrorResponse` | `z.infer<typeof errorResponseSchema>` | `{code, message, current_version?}`，API client 适配后对外暴露（R12 D10 wire 适配沿用） |
| `User` | `z.infer<typeof userSchema>` | 用户实体（UserRolesPanel/DeptTreePage 用户分配复用 userId） |

**禁用类型**（[约束] D3，SEC-003b 延伸）：

- 前端**禁止 import** `auditLogSchema`/`AuditLog`（存储态含未脱敏 PII，后端内部用，SEC-003b）——前端查询只消费 `redactedAuditLogSchema`/`RedactedAuditLog`。
- 前端**禁止 import** `piiFieldRegistrySchema`/`PiiFieldRegistry`（后端脱敏 registry 用，contracts 纯净原则）。
- 沿用 R12 D3：前端禁止 import `userEntitySchema`/`UserEntity`（含 password_hash）、`tokenPayloadSchema`/`TokenPayload`（验签内部）。

### 3.2 客户端表单校验 schema 复用清单（R13 S-1 固化：区分两类）

> R13 S-1 固化：表单校验须区分「自由文本表单」（须 safeParse，因有自由输入）与「类型派生操作」（TS 类型保证，schema 校验冗余，可不调或保留 defensive safeParse）。AC 措辞须精确限定为"自由文本输入表单"。

#### 3.2-A 自由文本表单（须 safeParse，[约束] D4）

| 功能点 | 复用 schema | 校验点 | AC |
|--------|-------------|--------|----|
| F2 角色创建 name/description | `createRoleInputSchema.safeParse` | name 1..64 + description max512 + permission_codes 数组 + 拒绝多余字段（.strict()） | AC-F2-3/4/5 |
| F5 部门创建 name | `createDepartmentInputSchema.safeParse` | name 1..64 + parent_id uuid\|null 可选 + 拒绝多余字段 | AC-F5-3/4 |

**判定依据**：name/description 为用户自由文本输入（长度/格式不可由 TS 类型保证），须运行时 safeParse 拦截非法输入，未调 safeParse 判 partial（R13 S-1）。

#### 3.2-B 类型派生操作（TS 类型保证，safeParse 冗余，[约束] D5）

| 功能点 | 值来源 | TS 类型保证 | safeParse 处理 | AC |
|--------|--------|-------------|---------------|----|
| F2 角色创建 permission_codes 多选 | 选项从 `[...permissionCodeSchema.options]` SSOT 派生 | 值 ∈ 枚举编译期保证（select options 限定） | 可不调（schema 校验冗余）；或保留 defensive safeParse | AC-F2-2 |
| F4 角色分配 toggle | roleId 从全量角色列表派生（GET /v1/roles） | roleId 为 uuid 字面量（Role.id 类型保证） | 不调 safeParse（schema 校验冗余） | AC-F4-2/3 |
| F6 部门分配 select | departmentId 从树派生（GET /v1/departments/tree） | departmentId 为 uuid 字面量（DepartmentTreeNode.id 类型保证） | 不调 safeParse（schema 校验冗余） | AC-F6-1 |

**判定依据**：roleId/departmentId/permission_codes 值经 TS 类型派生（非自由输入），值合法性由 select options / 列表派生编译期保证，运行时 safeParse 冗余。impl-writer 若不调 safeParse 须显式标注 [约束] 偏离 + 反向同步 Spec §3.2（R13 S-1，AC-ARCH-4）。

> **混合表单提示**：RoleForm 同时含自由文本（name/description，须 safeParse）与类型派生（permission_codes 多选，safeParse 冗余）两类字段。impl-writer 须对整体表单调 `createRoleInputSchema.safeParse`（覆盖 name/description 校验），permission_codes 字段值经多选 options 派生保证合法（safeParse 不会在此字段失败）。此为单一 safeParse 调用同时覆盖两类字段，非"类型派生字段单独跳过 safeParse"——因 createRoleInputSchema.safeParse 是整体校验，无法字段级跳过。

### 3.3 PII / 敏感字段清单（安全域标注，沿用 PRD §PII 清单）

| 字段 | 来源 | 敏感等级 | 前端处理 |
|------|------|----------|----------|
| `operator_id` | 审计日志 | 中（uuid，关联用户） | 展示用，禁止 console.log / 日志记录 |
| `operator_name` | 审计日志 | 中（姓名快照） | 展示用，禁止 console.log / 日志记录 |
| `entity_id` | 审计日志 | 低（uuid） | 展示用 |
| `before/after` 中 pii=true 字段 | 审计日志 | **高（含邮箱，后端已脱敏为 ab***@example.com）** | 展示脱敏值，**禁止尝试还原**；禁止 console.log / 日志记录 / 导出 |
| `token` | R12 沿用 | 高 | 沿用 R12 D12（localStorage，禁止 console.log） |
| 角色 `name`/`description` | 角色域 | 低 | 展示/输入用 |
| 部门 `name` | 部门域 | 低 | 展示/输入用 |

> 审计日志页**只读无写**，无表单提交，无 password/token 字段暴露。审计页须确认 `audit:read` 权限由后端 SEC-002 强制（前端不预判权限，依赖后端 FORBIDDEN 返回时显示"无权限"）。

## 4. API client 设计（R14 复用 R12 §4，零新增基础设施）

### 4.1 复用 R12 api/client.ts

R14 **零新增 API client 基础设施**，全部复用 R12 `apps/web/src/api/client.ts` 的 `request<T>(method, path, opts)` 函数（R12 §4 已实现）：

- **Bearer token 注入**（R12 D6）：除 `skipAuth=true`（login）外，所有请求从 tokenStore 读 token 注入 `Authorization: Bearer <token>`。R14 新增 api 模块全部需要鉴权（admin 路由），无须 skipAuth。
- **If-Match 注入**（R12 D7）：`opts.versioned === true` 且 `opts.expectedVersion !== undefined` 时注入 `If-Match: <expectedVersion>`。R14 仅 DELETE /v1/roles/:id 须 versioned=true（D7）。
- **401 拦截**（R12 D8）：401 响应经 wire 适配取 code，鉴权类 4 码（UNAUTHORIZED/TOKEN_INVALID/TOKEN_EXPIRED/TOKEN_REVOKED）清 token + 跳 /login；INVALID_CREDENTIALS 原样抛。R14 新增请求自动受此拦截覆盖。
- **409 重试**（R12 D9）：VERSION_CONFLICT + current_version + 未重试过 → 用 current_version 重试 1 次。R14 DELETE /v1/roles/:id 复用此重试（D7）。
- **wire 适配 error→code**（R12 D10）：读 wire `error` 字段 → errorCodeSchema 校验 → 映射为 contracts `code`。R14 新增角色/部门/审计域错误码（ROLE_*/DEPT_*/AUDIT_LOG_NOT_FOUND）自动经此适配覆盖。
- **网络错误兜底**：fetch 抛 → ApiError code='NETWORK_ERROR'。R14 沿用。

### 4.2 新增 api 模块设计（对齐 R12 api/users.ts 风格）

#### 4.2.1 `apps/web/src/api/roles.ts`

```ts
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client），禁止 import apps/api/src/**。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D7：deleteRole 须 versioned=true + expectedVersion → client 注入 If-Match（AC-F3-7）。
// [约束] D9：409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条）。
// [约束] D22：listUserRoles 返回裸 UserRole[]（B5，无 envelope）。
import type {
  CreateRoleInput,
  ListRoleQuery,
  Role,
  RoleListResult,
  UserRole,
} from '@admin/contracts';
import { request } from './client.js';

/** GET /v1/roles —— 角色列表（分页，无服务端筛选，B2）。调用方传 pageSize=20（D21）。 */
export function listRoles(query: ListRoleQuery): Promise<RoleListResult> {
  return request<RoleListResult>('GET', '/v1/roles', { query });
}

/** POST /v1/roles —— 创建角色（body={name, description, permission_codes}）。 */
export function createRole(input: CreateRoleInput): Promise<Role> {
  return request<Role>('POST', '/v1/roles', { body: input });
}

/**
 * DELETE /v1/roles/:id —— 删除角色（versioned=true，If-Match=expectedVersion，AC-F3-7）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9，用 409 body current_version，不 GET 单条）。
 */
export function deleteRole(id: string, expectedVersion: number): Promise<void> {
  return request<void>('DELETE', `/v1/roles/${id}`, {
    versioned: true,
    expectedVersion,
  });
}

/** GET /v1/users/:userId/roles —— 用户已分配角色列表（返回裸 UserRole[]，无 envelope，B5）。 */
export function listUserRoles(userId: string): Promise<UserRole[]> {
  return request<UserRole[]>('GET', `/v1/users/${userId}/roles`);
}

/** POST /v1/users/:userId/roles/:roleId —— 分配角色（path 参数，body 空）。 */
export function assignRole(userId: string, roleId: string): Promise<void> {
  return request<void>('POST', `/v1/users/${userId}/roles/${roleId}`);
}

/** DELETE /v1/users/:userId/roles/:roleId —— 移除角色（path 参数，body 空）。 */
export function removeRole(userId: string, roleId: string): Promise<void> {
  return request<void>('DELETE', `/v1/users/${userId}/roles/${roleId}`);
}
```

#### 4.2.2 `apps/web/src/api/departments.ts`

```ts
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client）。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D8：deleteDepartment 非 versioned（无 If-Match，server.ts L320 无第 5 参 true）。
import type {
  CreateDepartmentInput,
  Department,
  DepartmentTreeResult,
} from '@admin/contracts';
import { request } from './client.js';

/** GET /v1/departments/tree —— 部门树（递归 DepartmentTreeNode，无分页/筛选）。 */
export function getDepartmentTree(): Promise<DepartmentTreeResult> {
  return request<DepartmentTreeResult>('GET', '/v1/departments/tree');
}

/** POST /v1/departments —— 创建部门（body={name, parent_id?}）。 */
export function createDepartment(input: CreateDepartmentInput): Promise<Department> {
  return request<Department>('POST', '/v1/departments', { body: input });
}

/**
 * DELETE /v1/departments/:id —— 删除部门（**非 versioned**，无 If-Match，D8）。
 * DEPT_HAS_CHILDREN / DEPT_NOT_FOUND 由调用方处理（§11）。
 */
export function deleteDepartment(id: string): Promise<void> {
  return request<void>('DELETE', `/v1/departments/${id}`);
}

/** POST /v1/departments/:departmentId/users/:userId —— 用户部门归属分配（覆盖式幂等，B4）。 */
export function assignUserDepartment(departmentId: string, userId: string): Promise<void> {
  return request<void>('POST', `/v1/departments/${departmentId}/users/${userId}`);
}
```

#### 4.2.3 `apps/web/src/api/audit-logs.ts`

```ts
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client）。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D10：消费 RedactedAuditLog（脱敏态），禁用 auditLogSchema（存储态含未脱敏 PII）。
// [约束] D14：query 仅 page/pageSize/operated_from/operated_to/operator_id/entity_type（无 action，B3）。
import type { AuditLogListResult, ListAuditLogQuery } from '@admin/contracts';
import { request } from './client.js';

/** GET /v1/audit-logs —— 审计日志列表（只读，分页 + 筛选，items 为脱敏态）。调用方传 pageSize=20（D21）。 */
export function listAuditLogs(query: ListAuditLogQuery): Promise<AuditLogListResult> {
  return request<AuditLogListResult>('GET', '/v1/audit-logs', { query });
}
```

### 4.3 列表 pageSize 默认 20（沿用 R12 D14）

R14 角色列表/审计日志列表前端显式传 `pageSize=20`，**不依赖 schema 缺省**（listRoleQuerySchema default=10、listAuditLogQuerySchema default=20）。沿用 R12 D14 [约束]：schema 的 max(100)（角色）/ 钳制 100（审计）仍约束上限。

## 5. 状态管理（R14 复用 R12 AuthContext/RouteGuard + 新增页面本地 state）

### 5.1 AuthContext + token 存储（复用 R12 D12，无改动）

R14 复用 R12 `auth/tokenStore.ts`（localStorage key=`admin_token`）+ `auth/AuthContext.tsx`（登录态 Context + login/logout action）。新增页面无须扩展 AuthContext——登录态全局共享，新页面经 `useAuth()` 读取。

### 5.2 路由守卫（复用 R12 D13，白名单仍仅 /login）

R14 复用 R12 `auth/RouteGuard.tsx`：`!isAuthenticated && path !== '/login'` → `<Navigate to="/login" />`。**白名单仍仅 `/login`**（Q8 决策①），新增 /roles /departments /audit-logs 自动受守卫覆盖（无须改守卫逻辑）。已登录访问 /login 跳 /users（R12 AC-F1-7）沿用。

### 5.3 新增页面本地 state（对齐 R12 UserListPage 风格，无全局状态库）

R14 新增三个页面用 `useState` 管理本地状态，无 Redux/Zustand（R12 D5 零新依赖沿用）：

- **RoleListPage**：`{ items: Role[], total, page, totalPages, loading, error, showCreateModal, searchKeyword }`（searchKeyword 为客户端名称搜索 [advisory]，仅过滤当前页）。
- **DeptTreePage**：`{ tree: DepartmentTreeNode[], loading, error, showCreateModal, selectedParentId }`（树形数据无分页）。
- **AuditLogPage**：`{ items: RedactedAuditLog[], total, page, totalPages, loading, error, filters: { operator_id?, entity_type?, operated_from?, operated_to? } }`。
- **UserRolesPanel**：`{ userId, userRoles: UserRole[], allRoles: Role[], loading, error }`（allRoles 从 GET /v1/roles 全量派生 toggle 选项）。

翻页/筛选改 state → useEffect 触发对应 api 调用（对齐 R12 UserListPage useEffect 模式）。

## 6. 页面与组件设计（[advisory] 实现提示，impl-writer 落地）

> 本节为页面/组件行为契约，impl-writer 据此实现。样式用 CSS Modules / 内联样式（零 UI 框架，R12 F5 沿用）。

### 6.1 RoleListPage（F1/F2/F3）

- 首次加载：`listRoles({ page: 1, pageSize: 20 })`（D21，AC-F1-1）。
- 渲染：每行展示 name/description/is_builtin 标识（"内置"badge）+ 操作按钮（删除；is_builtin=true 时删除按钮 disabled 或无按钮，AC-F1-5 [advisory] 预禁用优化 UX，后端 ROLE_BUILTIN_FORBIDDEN 兜底）。
- 分页：页码按钮 → 改 page state → 重新 list（AC-F1-2）。
- 空状态：items=[] 显示"暂无角色"（AC-F1-3）。
- 加载态：列表区域 loading 文案（AC-F1-4，R12 D16）。
- **[advisory] 客户端名称搜索**（B2）：搜索框输入关键字 → 仅过滤当前页 items 中 name 含关键字的行（**非服务端筛选**，listRoleQuerySchema 无筛选字段）。AC-F1-6 advisory 测试可选。
- 创建角色按钮 → 打开 `<RoleForm>`。
- 删除按钮：调 `deleteRole(id, role.version)`（versioned=true，D7）。
  - 成功：刷新列表（AC-F3-1）。
  - VERSION_CONFLICT：API client 自动重试（R12 D9），重试成功刷新列表（AC-F3-2）；重试仍冲突显示"数据已被修改，请刷新后重试"（AC-F3-3）。
  - ROLE_BUILTIN_FORBIDDEN：显示"内置角色不可删除"（AC-F3-4）。
  - ROLE_IN_USE：显示"角色已分配给用户，请先解除分配"（AC-F3-5）。
  - ROLE_NOT_FOUND：显示"角色不存在"，列表刷新（AC-F3-6）。

### 6.2 RoleForm（F2，自由文本表单 + 权限码多选）

- 表单字段：name（input type=text）、description（textarea）、permission_codes（多选 select，选项从 `[...permissionCodeSchema.options]` SSOT 派生，11 项，AC-F2-2）。
- 提交：`createRoleInputSchema.safeParse(form)` → 失败显示字段级错误（AC-F2-3/4/5，不发请求）→ 成功调 `createRole`。
  - name 空 → safeParse 拦截（min(1)），显示"角色名称必填"（AC-F2-3）。
  - name > 64 → safeParse 拦截（max(64)），显示"角色名称不超过 64 字符"（AC-F2-4）。
  - description > 512 → safeParse 拦截（max(512)），显示"描述不超过 512 字符"（AC-F2-5）。
- 成功：关闭弹窗 + 刷新列表含新角色（is_builtin=false，AC-F2-1）。
- ROLE_NAME_DUPLICATE：表单内显示"角色名称已存在"（AC-F2-6，B1：非 ROLE_CODE_DUPLICATE）。
- permission_codes 多选：**类型派生操作**（§3.2-B），值 ∈ 枚举编译期保证，safeParse 不会在此字段失败（整体 safeParse 覆盖）。
- 提交中按钮禁用 + loading（R12 D16）。

### 6.3 UserRolesPanel（F4，类型派生 toggle）

- 触发：UserListPage 行操作"角色"按钮 → 打开 UserRolesPanel（drawer/modal，Q3 决策①），传入 userId。
- 加载：`listUserRoles(userId)` → 渲染该用户已分配角色列表（UserRole[]，B5 裸数组，AC-F4-1）；并行 `listRoles({ page:1, pageSize: 100 })` 取全量角色作 toggle 选项（类型派生，roleId 从全量角色列表派生）。
- toggle 勾选（分配）：调 `assignRole(userId, roleId)`（AC-F4-2，类型派生操作，不调 safeParse）。
  - 成功：面板刷新该角色标记为已分配。
  - USER_ROLE_ALREADY_ASSIGNED：显示"用户已持有该角色"（AC-F4-4）。
  - ROLE_NOT_FOUND：显示"角色不存在"（AC-F4-5）。
  - USER_NOT_FOUND：显示"用户不存在"（AC-F4-6）。
- toggle 取消勾选（移除）：调 `removeRole(userId, roleId)`（AC-F4-3，类型派生操作）。
- **类型派生操作**（§3.2-B）：roleId 从全量角色列表派生（Role.id 为 uuid 字面量，TS 类型保证），不调 assignRoleInputSchema.safeParse（schema 校验冗余，R13 S-1）。

### 6.4 DeptTreePage（F5，递归树渲染）

- 首次加载：`getDepartmentTree()` → 递归渲染 `<DeptNode>`（AC-F5-1）。
- 空状态：items=[] 显示"暂无部门"。
- 加载态：loading 文案（R12 D16）。
- 创建根部门按钮 → 打开 `<DeptForm>`（parentId 缺省）。
- 创建子部门：DeptNode 节点"添加子部门"按钮 → 打开 `<DeptForm>`（parentId=所选父节点）。
- 删除叶部门：DeptNode 节点"删除"按钮 → 调 `deleteDepartment(id)`（**非 versioned，无 If-Match**，D8，AC-F5-7）。
  - 成功：树刷新。
  - DEPT_HAS_CHILDREN：显示"请先删除子部门"（AC-F5-8）。
  - DEPT_NOT_FOUND：显示"部门不存在"（AC-F5-9）。
- 用户部门分配：DeptNode 节点"分配用户"操作 → 选择用户 → 调 `assignUserDepartment(departmentId, userId)`（AC-F6-1，类型派生操作）。
  - 成功：提示"部门归属已更新"。
  - DEPT_NOT_FOUND：显示"部门不存在"（AC-F6-2）。
  - 重复分配同部门：**幂等成功无提示**（B4，AC-F6-3）。
  - USER_NOT_FOUND：显示"用户不存在"（AC-F6-4）。

### 6.5 DeptForm（F5，自由文本表单 + parentId 可选）

- 表单字段：name（input type=text）、parentId（select 可选，选项从当前树派生，缺省=根部门，Q5 决策①）。
- 提交：`createDepartmentInputSchema.safeParse(form)` → 失败显示字段级错误（AC-F5-3/4）→ 成功调 `createDepartment`。
  - name 空 → safeParse 拦截（min(1)），显示"部门名称必填"（AC-F5-4）。
  - parentId 缺省 → body 不传 parent_id（对齐 optional，AC-F5-2 根部门）。
  - parentId 提供 → body 含 parent_id（AC-F5-3 子部门）。
- 成功：关闭弹窗 + 树刷新含新部门。
- DEPT_NAME_DUPLICATE：显示"同级别下部门名称已存在"（AC-F5-5）。
- DEPT_DEPTH_EXCEEDED：显示"部门层级超过上限"（AC-F5-6）。
- 提交中按钮禁用 + loading（R12 D16）。

### 6.6 DeptNode（F5，递归组件）

- 递归渲染 `DepartmentTreeNode`：节点展示 name + 操作按钮（添加子部门/删除/分配用户）+ children 递归渲染 `<DeptNode>`（无深度限制，D12，AC-F5-1）。
- 叶节点 children=[] 不渲染子节点容器。
- **递归契约渲染**（R14 验证点）：departmentTreeNodeSchema 为递归 Zod schema（children: z.array(z.lazy(...))），DeptNode 组件递归渲染嵌套树。后端已限层级上限 3（DEPT_DEPTH_EXCEEDED 强制），前端无须重复限制（D12）。

### 6.7 AuditLogPage（F7，只读列表 + 筛选）

- 首次加载：`listAuditLogs({ page: 1, pageSize: 20 })`（D21，AC-F7-1）。
- 渲染：每行展示 operated_at/operator_name/entity_type/action/摘要（before/after 字段变更摘要，AC-F7-1）。按 operated_at 倒序（后端排序）。
- 分页：页码按钮 → 改 page state → 重新 list（AC-F7-2）。
- **筛选区**（对齐 contract，B3）：
  - entity_type select（选项从 `[...auditLogEntityTypeSchema.options]` SSOT 派生，5 项，AC-F7-3）。
  - operator_id input（uuid，AC-F7-4）。
  - operated_from + operated_to datetime-local 输入（AC-F7-5，前端归一为 ISO 8601 datetime，D15）。
  - **无 action 筛选控件**（B3，contract 不支持，AC-F7-7）；action 仅在列表行展示。
- 筛选+分页复合：翻页保持筛选条件（AC-F7-6，R13 S-3 组合场景）。
- 空状态：items=[] 显示"暂无审计日志"（AC-F7-8）。
- 加载态：loading 文案（AC-F7-9）。
- **PII 脱敏展示**：before/after 中 pii=true 的 email 字段展示脱敏值（如 ab***@example.com，匹配 redactedEmailSchema），**不展示完整邮箱**（AC-F7-10，D10）。前端禁止尝试还原脱敏值。
- **只读无写入口**：无任何创建/编辑/删除按钮（append-only 只读，AC-F7-11）。
- datetime-local ISO 归一（D15 [advisory]）：datetime-local 跨浏览器输出格式差异（如缺秒/时区），impl 须归一为完整 ISO（如 `2026-07-03T12:00:00Z`）。归一逻辑属 advisory 实现提示不须同步 Spec §10 但须 Review 报告记录（R13 S-2）。

### 6.8 Sidebar（F8，侧边栏导航）

- 入口：用户（/users）、角色（/roles）、部门（/departments）、审计（/audit-logs）+ 登出按钮（Q8 决策①，AC-F8-1）。
- 入口可达：点击跳转对应路由并渲染页面（AC-F8-2）。
- 登出：调 `useAuth().logout()`（沿用 R12 AC-F6-2，POST /v1/auth/logout + 清 token + 跳 /login，AC-F8-4）。
- 布局：App.tsx 用 Sidebar + 主内容区布局（受保护页共享 Sidebar）。

## 7. 路由设计（React Router v6，新增 3 路由）

```tsx
// App.tsx 路由表（R12 基础上新增 /roles /departments /audit-logs）
<Routes>
  <Route path="/login" element={<LoginPage />} />           {/* R12 public */}
  <Route element={<RouteGuard><SidebarLayout /></RouteGuard>}>  {/* 受保护页共享 Sidebar */}
    <Route path="/users" element={<UserListPage />} />       {/* R12 */}
    <Route path="/roles" element={<RoleListPage />} />       {/* + R14 */}
    <Route path="/departments" element={<DeptTreePage />} /> {/* + R14 */}
    <Route path="/audit-logs" element={<AuditLogPage />} />  {/* + R14 */}
  </Route>
  <Route path="/" element={<Navigate to="/users" replace />} />
  <Route path="*" element={<Navigate to="/users" replace />} />
</Routes>
```

- **白名单仍仅 `/login`**（R12 D13，Q8 决策①）：未登录访问 /roles /departments /audit-logs → RouteGuard 跳 /login（AC-F8-3）。
- SidebarLayout：包裹 Sidebar + `<Outlet />`（受保护页共享侧边栏布局）。
- react-router-dom v6（R12 D5 沿用，零新依赖）。
- **无 /roles/:id 详情路由**（Q9 决策②，GET /v1/roles/:id 不消费）。
- **无 /roles/:id/inheritance-chain 路由**（Q10 决策②，继承管理 out-of-scope）。
- **无 /users/:id/effective-permissions 路由**（Q11 决策②）。

## 8. ARCH-003 校验方案（R14 无新增校验逻辑，R12/R13 已落地）

### 8.1 R12 已落地 ARCH-003 机器化 enforcement

R12 §8 已在 `scripts/check-rules.mjs` 实现 ARCH-003 分支（L211-234）：

- 扫描 `apps/web/src/**/*.{ts,tsx}` 的 import 语句（walkWeb 收集 .ts + .tsx）。
- 禁止 specifier：`^@admin/api\b` / `api/src/` 子串 / `^apps/api\b`（三条任一命中即违规）。
- 允许：`@admin/contracts`、`@admin/contracts/*`、react/react-router-dom/react-dom、apps/web 内相对模块、node 内置。
- 违规即报错 exit≠0。

### 8.2 R13 S-4 已让 CODE 扫描器覆盖前端

R13 S-4 已将 `walkWeb` 提升为顶层函数（check-rules.mjs L23-31），`allTs` 数组（L34-41）已含 `apps/web/src` + `apps/web/test`，使 CODE-001（禁 any）/CODE-002（禁空 catch）/CODE-003（禁 eval）/CODE-004（Zod schema 命名后缀）/AI-005（禁硬编码跨域集合）等通用扫描器自动覆盖前端 .ts/.tsx 文件。

### 8.3 R14 新增模块继续受 ARCH-003 + CODE 扫描器覆盖

R14 新增 11 个前端文件（api/roles.ts、api/departments.ts、api/audit-logs.ts、pages/RoleListPage.tsx、pages/DeptTreePage.tsx、pages/AuditLogPage.tsx、components/RoleForm.tsx、components/DeptForm.tsx、components/UserRolesPanel.tsx、components/DeptNode.tsx、components/Sidebar.tsx）位于 `apps/web/src/`，自动受 ARCH-003 分支 + CODE 扫描器覆盖，**无须新增校验逻辑**（AC-ARCH-1）。Reviewer 须逐文件核对 ARCH-003 合规性（AC-ARCH-2 类型来自 contracts）。

### 8.4 layering.md 校验方式无须更新

R12 §8.4 已将 layering.md ARCH-003 校验方式从 `[预留]` 更新为机器化描述（含 `check-rules.mjs` + `ARCH-003` + `分支` 措辞，META-003/META-004 双向绑定闭合）。R14 无新增规则、无新增 enforcement 分支，layering.md 无须更新。

## 9. 受影响测试清单（AI-006 两类标注 + R13 S-3 AC↔测试覆盖矩阵）

> 本轮为**前端扩展**（apps/web 已存在，新增三域模块），既有后端/契约测试零改动，R12 前端测试零改动（因 R14 新增独立模块，不修改 R12 既有文件行为）。严格遵守 AI-006：①类分显式+隐式两个子类 + ②类签名变更 + ③类新增。

### 9.1 ① 类：contracts 联动驱动

**①-A 显式影响（grep 符号引用）—— 0 文件：**

grep 命令：`rg "RoleListPage|DeptTreePage|AuditLogPage|UserRolesPanel|RoleForm|DeptForm|DeptNode|Sidebar|api/roles|api/departments|api/audit-logs" apps/api/test/ packages/*/test/ apps/web/test/ --glob '!apps/web/test/{role-list-page,dept-tree-page,audit-log-page,user-roles-panel,role-form,dept-form,navigation,error-mapping,api-roles,api-departments,api-audit-logs}*'`。判定依据：R14 新增模块名（RoleListPage/DeptTreePage/AuditLogPage/UserRolesPanel/RoleForm/DeptForm/DeptNode/Sidebar/api/roles/api/departments/api/audit-logs）本轮才创建，既有 R12 测试（api-client.test.ts/error-mapping.test.ts/login-page.test.tsx/user-list-page.test.tsx/create-user-modal.test.tsx/route-guard.test.tsx）不可能引用不存在的 R14 模块。R12 UserListPage 虽新增"角色"行操作按钮，但该改动属 R14 impl 阶段，R12 既有 user-list-page.test.tsx 不引用 UserRolesPanel 符号（仅在 R14 新增 user-roles-panel.test.tsx 中引用）。**零命中 → 零显式影响。**

> **UserListPage 改动说明**：R14 在 R12 UserListPage.tsx 新增"角色"行操作按钮（触发 UserRolesPanel）。此改动属 impl-writer 阶段，可能影响 R12 既有 user-list-page.test.tsx（若测试断言行操作按钮数量/文案）。判定：R12 user-list-page.test.tsx 若断言"操作列仅含启停按钮"则受影响（须 impl-writer 调整断言）；若仅断言启停按钮存在则不受影响。**预估 R12 user-list-page.test.tsx 可能需微调断言**（属 ① 类显式影响的边缘场景），但本 Spec 不改测试断言（AI-002），由 impl-writer 阶段判定并显式列出。本节标记为 ① 类显式影响 0~1 文件（边缘），以 R12 user-list-page.test.tsx 实际断言为准。

**①-B 隐式影响（全集断言依赖枚举值，R11 S-2）—— 0 文件：**

既有 SSOT 派生断言（`[...errorCodeSchema.options]` containment / `[...permissionCodeSchema.options]` containment）位于 `apps/api/test/role.test.ts` / `notification.test.ts` / `report.test.ts` / `role-inheritance.test.ts` / `optimistic-locking.test.ts` / `apps/web/test/error-mapping.test.ts`（R12 已落地 SSOT 派生）。判定依据：**本轮契约层零新增**（PRD 明示 contracts 已就绪，errorCodeSchema 不扩展、permissionCodeSchema 不变、auditLogEntityTypeSchema 不变），枚举值不变 → 既有 containment 断言不失效。**零隐式影响。**

> **errorMapping 扩展说明**：R14 扩展 `lib/errorMapping.ts` 的 SPECIFIC_MESSAGES（新增角色/部门码中文提示，D9）。但映射表键仍从 `[...errorCodeSchema.options]` SSOT 派生（R12 D11 沿用），errorCodeSchema 枚举未扩展（角色/部门码本就在枚举内），故 R12 error-mapping.test.ts 的 SSOT 派生断言不失效。R14 扩展 SPECIFIC_MESSAGES 属"填充既有 FALLBACK 码的具体提示"，非"新增枚举键"，既有测试若断言"ROLE_NOT_FOUND → FALLBACK"会失效（因 R14 改为具体提示）。**预估 R12 error-mapping.test.ts 可能需微调断言**（属 ① 类显式影响的边缘场景），由 impl-writer 阶段判定。本节标记为 ① 类显式影响 0~1 文件（边缘），以 R12 error-mapping.test.ts 实际断言为准。

①类小结：**0~2 文件可能受影响**（显式 0~2 边缘：user-list-page.test.tsx + error-mapping.test.ts，因 R14 改动 R12 既有文件 UserListPage.tsx + errorMapping.ts；隐式 0）。根因：R14 改动 2 个 R12 既有文件（UserListPage 新增行操作 / errorMapping 扩展 SPECIFIC_MESSAGES），可能影响 R12 既有测试断言。impl-writer 须显式列出每个受影响文件 + 改动性质 + 理由（AI-002）。

### 9.2 ② 类：既有签名/行为变更驱动 —— 0 文件

判定依据：本轮后端冻结（不改 service/repo/domain/router/server.ts/contracts），后端 API 签名与 wire 格式零变更；前端新增消费者，不改变既有后端行为。R14 改动 R12 既有文件（UserListPage.tsx 新增行操作 / errorMapping.ts 扩展 SPECIFIC_MESSAGES）属"扩展"非"签名变更"（UserListPage 组件签名不变、mapErrorToMessage 函数签名不变）。**②类零影响。**

> 与 PRD 估算对齐：PRD 未声称 ②类影响（本轮纯前端扩展 + 既有文件扩展），本 Spec 精确分析确认 ②类 = 0。

### 9.3 ③ 类：新增测试（9 文件，impl-writer/test-writer 阶段）

| # | 文件 | 类型 | 覆盖 AC |
|---|------|------|---------|
| 1 | `apps/web/test/api-roles.test.ts`（T1） | API client 契约测（mock fetch） | AC-F3-2/F3-3/F3-7、AC-F4-1（裸数组解析）、AC-F9-5/F9-6（401/网络沿用）、AC-F10-1/F10-2 |
| 2 | `apps/web/test/api-departments.test.ts`（T2） | API client 契约测 | AC-F5-7（DELETE 非 versioned 无 If-Match）、AC-F5-1（树递归类型）、AC-F6-1（path 参数） |
| 3 | `apps/web/test/api-audit-logs.test.ts`（T3） | API client 契约测 | AC-F7-1/F7-2/F7-3~F7-6（query 拼接 + 脱敏响应类型 RedactedAuditLog） |
| 4 | `apps/web/test/role-list-page.test.tsx`（T4） | 组件测（Testing Library） | AC-F1-1~F1-6、AC-F2-1~F2-6、AC-F3-1/F3-3~F3-6、AC-ARCH-3（safeParse）、AC-S1-1 |
| 5 | `apps/web/test/dept-tree-page.test.tsx`（T5） | 组件测 | AC-F5-1~F5-9、AC-F6-1~F6-4、AC-ARCH-3、AC-S1-1 |
| 6 | `apps/web/test/audit-log-page.test.tsx`（T6） | 组件测 | AC-F7-1~F7-11、AC-F7-6（组合场景）、AC-F7-10（PII 脱敏） |
| 7 | `apps/web/test/user-roles-panel.test.tsx`（T7） | 组件测 | AC-F4-1~F4-6、AC-ARCH-4（类型派生不 safeParse）、AC-S1-2 |
| 8 | `apps/web/test/navigation.test.tsx`（T8） | 组件测 | AC-F8-1~F8-4、AC-ARCH-1（lint:rules 探针）、AC-ARCH-2、AC-F10-3 |
| 9 | `apps/web/test/error-mapping.test.ts`（T9，扩展 R12 既有文件） | 单测（SSOT 派生） | AC-F9-1~F9-4、AC-F9-3（SSOT 派生断言） |

各文件断言要点：
- **api-roles.test.ts**（mock global.fetch）：deleteRole 注入 If-Match=version（AC-F3-7）、409 VERSION_CONFLICT 用 current_version 重试 1 次（AC-F3-2）、重试仍 409 抛错（AC-F3-3）、listUserRoles 返回裸 UserRole[]（B5）、assignRole/removeRole path 参数 body 空、Bearer 注入（AC-F10-2）、类型全部 contracts 派生（AC-ARCH-2）。
- **api-departments.test.ts**：deleteDepartment **不注入 If-Match**（D8，AC-F5-7）、getDepartmentTree 递归类型解析、createDepartment body 含/不含 parent_id、assignUserDepartment path 参数。
- **api-audit-logs.test.ts**：listAuditLogs query 拼接 page/pageSize/operated_from/operated_to/operator_id/entity_type（**无 action**，B3）、items 为 RedactedAuditLog[]（脱敏态，D10）、pageSize=20（D21）。
- **role-list-page.test.tsx**：列表渲染、分页、空状态、加载态、内置角色标识（AC-F1-1~5）、客户端名称搜索（AC-F1-6 advisory）、创建成功（AC-F2-1）、permission_codes 多选 SSOT 派生（AC-F2-2）、表单校验 name 空/超长/description 超长（AC-F2-3/4/5）、ROLE_NAME_DUPLICATE 提示（AC-F2-6）、删除成功（AC-F3-1）、重试仍冲突提示（AC-F3-3）、内置/已分配/不存在拒绝（AC-F3-4/5/6）、safeParse 拦截不发请求（AC-ARCH-3）。
- **dept-tree-page.test.tsx**：树递归渲染（AC-F5-1）、创建根/子部门（AC-F5-2/3）、name 空校验（AC-F5-4）、DEPT_NAME_DUPLICATE/DEPTH_EXCEEDED（AC-F5-5/6）、删除叶部门（AC-F5-7）、DEPT_HAS_CHILDREN/NOT_FOUND（AC-F5-8/9）、用户分配成功/重复幂等/不存在（AC-F6-1/3/2/4）、safeParse 拦截（AC-ARCH-3）。
- **audit-log-page.test.tsx**：列表渲染（AC-F7-1）、分页（AC-F7-2）、entity_type 筛选 SSOT 派生（AC-F7-3）、operator_id 筛选（AC-F7-4）、date_range 筛选 ISO 归一（AC-F7-5）、筛选+分页复合（AC-F7-6 组合场景）、无 action 控件（AC-F7-7）、空状态/加载态（AC-F7-8/9）、PII 脱敏展示（AC-F7-10）、只读无写入口（AC-F7-11）。
- **user-roles-panel.test.tsx**：面板加载 UserRole[]（AC-F4-1）、toggle 分配/移除（AC-F4-2/3）、USER_ROLE_ALREADY_ASSIGNED/ROLE_NOT_FOUND/USER_NOT_FOUND（AC-F4-4/5/6）、类型派生不调 safeParse（AC-ARCH-4，AC-S1-2）。
- **navigation.test.tsx**：侧边栏 4 入口 + 登出（AC-F8-1）、入口跳转（AC-F8-2）、未登录跳 /login（AC-F8-3）、登出复用 R12（AC-F8-4）、lint:rules 探针验证 ARCH-003（AC-ARCH-1）、零新依赖（AC-F10-3）。
- **error-mapping.test.ts**（扩展 R12）：映射表键 = `[...errorCodeSchema.options]`（SSOT 派生，AC-F9-3）、角色域码中文（AC-F9-1）、部门域码中文（AC-F9-2）、AUDIT_LOG_NOT_FOUND FALLBACK（AC-F9-4）。

③类小结：9 新增测试文件（含 1 个扩展 R12 既有文件 error-mapping.test.ts），覆盖 PRD 68 条 AC + ARCH-003 合规专项 + R13 S-1 合规专项。无 E2E（Q12 决策①，R12 Q8 沿用）。

### 9.4 AC↔测试用例覆盖矩阵（R13 S-3 固化）

> 测试文件编号（T#）为本 Spec 预估，**最终用例号由 test-writer 阶段确认**（R13 S-3）。test-writer 须自检每条 AC 至少 1 个用例覆盖，未覆盖显式列 reason。

| AC 区间 | 覆盖测试文件 | 用例号（test-writer 定） | 备注 |
|---------|-------------|------------------------|------|
| AC-F1-1~F1-5 | T4 role-list-page.test.tsx | 待定 | F1-6 advisory 可选测 |
| AC-F1-6 | T4（advisory 可选） | 待定 | advisory 增强非核心验收，未覆盖 reason：advisory |
| AC-F2-1~F2-6 | T4 role-list-page.test.tsx | 待定 | F2-2 SSOT 派生断言可选放 T9 |
| AC-F3-1 | T4 role-list-page.test.tsx | 待定 | — |
| AC-F3-2/F3-3/F3-7 | T1 api-roles.test.ts + T4 | 待定 | 跨 T1+T4（重试逻辑 + 列表刷新） |
| AC-F3-4/F3-5/F3-6 | T4 role-list-page.test.tsx + T9 | 待定 | 错误码提示跨 T4+T9 |
| AC-F4-1~F4-6 | T7 user-roles-panel.test.tsx | 待定 | F4-4/5/6 跨 T7+T9 |
| AC-F5-1~F5-9 | T5 dept-tree-page.test.tsx | 待定 | F5-1 递归渲染断言 |
| AC-F6-1~F6-4 | T5 dept-tree-page.test.tsx | 待定 | F6-1 可能跨 T7，test-writer 定 |
| AC-F7-1~F7-11 | T6 audit-log-page.test.tsx | 待定 | F7-6 组合场景（R13 S-3）、F7-10 PII 脱敏 |
| AC-F8-1~F8-4 | T8 navigation.test.tsx | 待定 | F8-4 沿用 R12 route-guard 测 |
| AC-F9-1~F9-4 | T9 error-mapping.test.ts | 待定 | F9-3 SSOT 派生断言 |
| AC-F9-5/F9-6 | T1 api-roles.test.ts（沿用 R12） | 待定 | 401/网络兜底复用 R12 |
| AC-F10-1/F10-2 | T1/T2/T3 + T8 | 待定 | API client 复用 |
| AC-F10-3 | T8 navigation.test.tsx（工程核验） | 待定 | 零新依赖 |
| AC-ARCH-1 | T8 + lint:rules 探针 + Reviewer 逐文件 | 待定 | ARCH-003 机器化 |
| AC-ARCH-2 | T1/T2/T3 + Reviewer | 待定 | 类型来自 contracts |
| AC-ARCH-3 | T4/T5 | 待定 | 自由文本表单 safeParse |
| AC-ARCH-4 | T7/T4 | 待定 | 类型派生不强制 safeParse（R13 S-1） |
| AC-S1-1 | T4/T5 | 待定 | 自由文本表单须 safeParse |
| AC-S1-2 | T7/T4 | 待定 | 类型派生 TS 类型保证 |

> test-writer 须做 AC 覆盖矩阵自检（R13 S-3）：每条 AC 至少 1 用例覆盖，未覆盖显式列 reason；组合场景（AC-F7-6 筛选+分页、AC-F3-2 重试+刷新）须单独测。

## 10. 决策清单（D1~D24）

> 每个决策显式标注 `[约束]`（默认禁止偏离，偏离须经 AI-003 流程 + Reviewer 确认）或 `[advisory]`（允许偏离，须反向同步 Spec §10）。R12 D1~D21 沿用，本节仅列 R14 新增/扩展决策。

### D1 · 前端分层复用 R12 + 新增三域 api/pages/components `[约束]`

R14 复用 R12 §2 分层（api/pages/components/auth/lib），新增 api/roles.ts、api/departments.ts、api/audit-logs.ts、pages/RoleListPage.tsx、pages/DeptTreePage.tsx、pages/AuditLogPage.tsx、components/RoleForm.tsx、components/DeptForm.tsx、components/UserRolesPanel.tsx、components/DeptNode.tsx、components/Sidebar.tsx。依赖方向单向沿用 R12 §2.2。impl-writer 偏离分层须反向同步。

### D2 · ARCH-003 持续合规（新增模块继续受约束）`[约束]`

R14 新增 11 个前端文件继续受 ARCH-003 约束（R12 D2 沿用）：只能 import @admin/contracts + 第三方 + apps/web 内部，禁止 import apps/api/src/** 与 @admin/api。R12 §8 ARCH-003 分支 + R13 S-4 CODE 扫描器自动覆盖新增文件（§8）。违规即 blocker（AC-ARCH-1）。

### D3 · 类型 z.infer 派生 + 禁用存储态类型（审计域延伸）`[约束]`

R14 全部数据类型经 z.infer 从 @admin/contracts 派生（§3.1），禁止手写 TS 类型副本（R12 D3 沿用，AC-ARCH-2）。前端**禁止 import** `auditLogSchema`/`AuditLog`（存储态含未脱敏 PII，SEC-003b 延伸）——只消费 `redactedAuditLogSchema`/`RedactedAuditLog`。禁止 import `piiFieldRegistrySchema`/`PiiFieldRegistry`（后端脱敏 registry）。沿用 R12 D3 禁用 userEntitySchema/tokenPayloadSchema。

### D4 · 自由文本表单须 safeParse（R13 S-1）`[约束]`

F2 角色创建 name/description + F5 部门创建 name 为自由文本表单，提交前须调 `createRoleInputSchema.safeParse` / `createDepartmentInputSchema.safeParse`，失败显示字段级错误不发请求（AC-F2-3/4/5、AC-F5-4、AC-ARCH-3、AC-S1-1）。未调 safeParse 判 partial（R13 S-1）。

### D5 · 类型派生操作不强制 safeParse（R13 S-1）`[约束]`

F4 角色分配 toggle + F6 部门分配 select + F2 权限码多选为类型派生操作（roleId/departmentId 为 uuid 字面量、permission_codes ∈ 枚举，值经 TS 类型派生非自由输入），可不调 safeParse（schema 校验冗余）；若不调须在 impl 报告显式标注 [约束] 偏离 + 反向同步 Spec §3.2（AC-ARCH-4、AC-S1-2）。或保留 defensive safeParse（不禁止）。

### D6 · API client 复用 R12（零新增基础设施）`[约束]`

R14 零新增 API client 基础设施，全部复用 R12 api/client.ts 的 request<T>（Bearer/If-Match/401 拦截/409 重试/wire 适配/网络兜底）。新增 api 模块（roles/departments/audit-logs）仅调 request<T>，不重复封装 fetch（AC-F10-1）。

### D7 · 角色删除 versioned + If-Match + 409 重试复用 R12 D9 `[约束]`

DELETE /v1/roles/:id 为 versioned 端点（server.ts L271-275 第 5 参 true），api/roles.deleteRole 须 versioned=true + expectedVersion=role.version → client 注入 If-Match（R12 D7，AC-F3-7）。409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条，R12 D9 沿用，AC-F3-2）；重试仍 409 显示"数据已被修改，请刷新后重试"（AC-F3-3）。重试仅 1 次防活锁。

### D8 · 部门删除非 versioned（无 If-Match）`[约束]`

DELETE /v1/departments/:id 为**非 versioned**端点（server.ts L320-324 无第 5 参 true），api/departments.deleteDepartment 不传 versioned/expectedVersion，client 不注入 If-Match（AC-F5-7）。DEPT_HAS_CHILDREN / DEPT_NOT_FOUND 由调用方处理（§11）。**注**：与 D7 角色删除（versioned）有意分歧，因后端部门域未启用乐观锁（contract departmentSchema 无 version 字段）。

### D9 · errorMapping 扩展 SPECIFIC_MESSAGES（角色/部门码中文，审计码 FALLBACK）`[约束]`

R14 扩展 R12 lib/errorMapping.ts 的 SPECIFIC_MESSAGES，新增角色域码（ROLE_NOT_FOUND/ROLE_NAME_DUPLICATE/ROLE_BUILTIN_FORBIDDEN/ROLE_IN_USE/USER_ROLE_ALREADY_ASSIGNED）+ 部门域码（DEPT_NOT_FOUND/DEPT_NAME_DUPLICATE/DEPT_HAS_CHILDREN/DEPT_DEPTH_EXCEEDED）中文提示（AC-F9-1/2）。审计域 AUDIT_LOG_NOT_FOUND 本期不触发（只读无写），FALLBACK 兜底（AC-F9-4）。映射表键仍从 `[...errorCodeSchema.options]` SSOT 派生（R12 D11 沿用，AC-F9-3）。禁止硬编码全集。

### D10 · 审计日志 PII 脱敏类型（redactedAuditLogSchema，禁用 auditLogSchema）`[约束]`

前端审计日志查询只消费 `redactedAuditLogSchema`/`RedactedAuditLog`（脱敏态，before/after 中 pii=true 字段已脱敏为 ab***@example.com），**禁止 import** `auditLogSchema`/`AuditLog`（存储态含未脱敏 PII，SEC-003b 延伸，D3）。前端展示脱敏值不还原（AC-F7-10）。operator_id/operator_name/before-after 禁止 console.log/日志记录（§3.3）。

### D11 · 角色列表客户端名称搜索仅过滤当前页 `[advisory]`

listRoleQuerySchema 无服务端筛选字段（B2），角色列表客户端名称搜索为 [advisory] 增强：仅过滤当前页 items 中 name 含关键字的行，**非服务端筛选**（AC-F1-6）。未来契约扩展服务端筛选时可改为 query 参数。advisory 测试可选（未覆盖 reason：advisory 增强非核心验收）。

### D12 · 部门树递归渲染无深度限制（后端已限 3 层）`[约束]`

DeptNode 组件递归渲染 departmentTreeNodeSchema 全部层级，无前端深度限制（Q4 决策①，AC-F5-1）。后端已限层级上限 3（DEPT_DEPTH_EXCEEDED 强制），前端无须重复限制。树数据量小，递归渲染性能无忧。折叠展开为 UX 增强非 MVP 必须，[advisory] 未来可加。

### D13 · 部门创建 parentId 可选（缺省/null=根部门）`[约束]`

DeptForm parentId 可选（Q5 决策①，对齐 createDepartmentInputSchema parent_id optional nullable）：缺省/null=根部门，提供 uuid=子部门（AC-F5-2/3）。单一表单覆盖根/子部门两种场景。

### D14 · 审计日志筛选对齐 contract（无 action）`[约束]`

AuditLogPage 筛选区仅支持 operator_id + entity_type + operated_from/operated_to（对齐 listAuditLogQuerySchema 全集，Q6 决策①，B3），**不支持 action 筛选**（contract 明示，AC-F7-7）。action 仅在列表行展示。未来契约扩展 action 筛选时可加控件。

### D15 · 审计日志 date_range 用 datetime-local + ISO 归一 `[约束]`

AuditLogPage date_range 用 datetime-local 原生输入（Q7 决策①，AC-F7-5），前端归一为 ISO 8601 datetime with seconds + Z（如 `2026-07-03T12:00:00Z`）以通过 listAuditLogQuerySchema 的 z.string().datetime() 校验。[advisory] 归一逻辑属实现提示不须同步 Spec §10 但须 Review 报告记录（R13 S-2）。

### D16 · 侧边栏导航（Q8）`[约束]`

R14 用侧边栏导航（Q8 决策①，AC-F8-1）：用户/角色/部门/审计 4 入口 + 登出按钮。App.tsx 用 SidebarLayout（Sidebar + Outlet）包裹受保护页。路由守卫白名单仍仅 /login（R12 D13 沿用，AC-F8-3）。

### D17 · 角色详情页不做（Q9，GET /v1/roles/:id 不消费）`[advisory]`

Q9 决策②：仅列表不做详情页，GET /v1/roles/:id（cacheable）端点存在但本轮不消费（§1.2）。roleSchema 字段少（name/description/permission_codes/is_builtin/parent_role_id），列表行展示足够。详情页为未来轮次。

### D18 · 角色继承管理 out-of-scope（Q10，端点存在但不消费）`[advisory]`

Q10 决策②：角色继承管理 out-of-scope。POST/DELETE /v1/roles/:roleId/parent（versioned）+ GET /v1/roles/:roleId/inheritance-chain 端点存在（§1.2）但本轮不消费。继承管理（设父/解父/链展示/环检测可视化）为独立轮次。未来启用时须复用 R12 D7/D9 + 本 Spec D7 的 versioned 处理模式。

### D19 · effective-permissions out-of-scope（Q11）`[advisory]`

Q11 决策②：effective-permissions 查看 out-of-scope。GET /v1/users/:userId/effective-permissions 端点存在（§1.2）但本轮不消费。与继承管理同轮次更合理（无继承时仅显示直接角色权限并集价值有限）。

### D20 · 测试范围对齐 R12 Q8（组件测 + API client 契约测，无 E2E）`[约束]`

R14 测试用组件测 + API client 契约测，无 E2E（Q12 决策①，R12 Q8 沿用）。9 新增测试文件（§9.3）。Vitest + Testing Library + jsdom（R12 D17 沿用）。web .tsx 测试用 per-file `// @vitest-environment jsdom` 注解（R12 D20 沿用）。

### D21 · 列表 pageSize 默认 20 复用 R12 D14 `[约束]`

R14 角色列表/审计日志列表前端显式传 pageSize=20（AC-F1-1、AC-F7-1），不依赖 schema 缺省（listRoleQuerySchema default=10、listAuditLogQuerySchema default=20）。沿用 R12 D14。schema max(100)（角色）/ 钳制 100（审计）仍约束上限。

### D22 · 用户角色分配 GET 返回裸 UserRole[]（B5）`[约束]`

GET /v1/users/:userId/roles 返回裸 `UserRole[]`（userRoleSchema 数组，无 envelope，B5）。api/roles.listUserRoles 返回 `Promise<UserRole[]>`，前端直接消费数组（非 {items: UserRole[]}）。procedure input schema（listUserRolesProcedureInputSchema）在 apps/api 不消费，前端不引用。

### D23 · 用户部门分配幂等（B4，无"已在该部门"码）`[约束]`

POST /v1/departments/:departmentId/users/:userId 为覆盖式幂等（B4）：重复分配同部门返回成功（200），**无"已在该部门"错误码**（errorCodeSchema 无此码）。前端重复分配不提示"已在该部门"，仅提示"部门归属已更新"（AC-F6-3）。

### D24 · UserListPage 行操作扩展 + errorMapping 扩展属 R12 既有文件改动 `[约束]`

R14 改动 2 个 R12 既有文件：(1) UserListPage.tsx 新增"角色"行操作按钮（触发 UserRolesPanel）；(2) errorMapping.ts 扩展 SPECIFIC_MESSAGES（D9）。此改动属"扩展"非"签名变更"（组件/函数签名不变）。impl-writer 须显式列出每个受影响 R12 测试文件 + 改动性质 + 理由（AI-002，§9.1 ①类边缘场景）。若 R12 user-list-page.test.tsx / error-mapping.test.tsx 断言受影响，须调整断言并特别标注（matcher 改动须 Reviewer 判定）。

### 多 [约束] 组合副作用预判

> 提前标注多约束组合的潜在副作用，impl-writer 实现时须规避，偏离按 AI-003 反向同步。R13 S-2 固化：行为/数据/schema 偏离须同步 §10；纯 UI 文案偏离（按钮文案/错误提示文案/select option 文案）不须同步 §10 但须 Review 报告记录。

1. **「角色删除 versioned (D7) + 409 重试复用 R12 D9 + 列表刷新」组合**：DELETE role 409 重试成功后须刷新列表取最新 version（避免下次对同一角色操作用旧 version 又触发 409）。impl-writer 须保证删除成功（含重试成功）后触发 list 刷新。**注**：DELETE 重试幂等性——重试发生在同次冲突未删成功的场景（409 表示未删除），重试 DELETE 语义安全（非重复删除已删资源）；若重试时已被其他请求删除则 404 ROLE_NOT_FOUND，前端显示"角色不存在"并刷新（AC-F3-6）。无活锁（重试仅 1 次）。

2. **「部门删除非 versioned (D8) + DEPT_HAS_CHILDREN/DEPT_NOT_FOUND 错误」组合**：DELETE department 无 If-Match，无 409 重试路径。DEPT_HAS_CHILDREN（仍有子部门）/ DEPT_NOT_FOUND（不存在）由调用方处理（§11）。impl-writer 须保证部门删除错误不触发 409 重试逻辑（client 仅对 VERSION_CONFLICT 重试，DEPT_* 码不重试）。**注**：D8 与 D7 有意分歧（部门域无 version 字段），impl-writer 不得对部门删除传 versioned=true（否则 client 注入 If-Match 但后端不消费，虽无害但违背 D8）。

3. **「审计日志脱敏类型 (D10) + SEC-003b + 禁用 auditLogSchema (D3)」组合**：前端只消费 redactedAuditLogSchema，before/after 中 pii=true 字段已脱敏。impl-writer 须保证：(1) api/audit-logs.ts 返回类型为 `AuditLogListResult`（items 为 RedactedAuditLog[]）；(2) AuditLogPage 展示 before/after 时直接渲染脱敏值，**禁止尝试还原**（如正则还原 ab***@example.com → 原邮箱）；(3) 禁止 import auditLogSchema（CODE 扫描器 + Reviewer 核对）。**注**：redactedAuditLogSchema 与 auditLogSchema 字段集一致（仅语义差异：前者 pii=true 字段已脱敏），TS 类型结构相同，但语义不可混用（D10 禁用 auditLogSchema）。

4. **「errorMapping 扩展 (D9) + SSOT 派生 (R12 D11) + R12 既有测试 (D24)」组合**：R14 扩展 SPECIFIC_MESSAGES 新增角色/部门码中文提示，但映射表键仍从 `[...errorCodeSchema.options]` SSOT 派生（R12 D11）。errorCodeSchema 枚举未扩展（角色/部门码本就在枚举内），故 SSOT 派生断言不失效。但 R12 error-mapping.test.ts 若断言"ROLE_NOT_FOUND → FALLBACK"会失效（因 R14 改为具体提示"角色不存在"）。impl-writer 须调整 R12 error-mapping.test.ts 断言（D24，AI-002 须显式列出）。**注**：此为"填充既有 FALLBACK 码的具体提示"，非"新增枚举键"，SSOT 派生机制不变。

5. **「401 拦截 (R12 D8) + 新增角色/部门/审计域请求」组合**：R14 新增请求（角色/部门/审计域）自动受 R12 D8 401 拦截覆盖（鉴权类 4 码清 token + 跳 /login）。impl-writer 须保证新增 api 模块不传 skipAuth（全部需鉴权）。**注**：审计页只读，若用户无 audit:read 权限，后端返回 FORBIDDEN（非 401），前端显示"无权限执行此操作"（errorMapping FORBIDDEN 沿用 R12），不跳登录。

6. **「自由文本表单 safeParse (D4) + 类型派生操作 (D5) 在 RoleForm 混合」组合**：RoleForm 同时含自由文本（name/description，须 safeParse）与类型派生（permission_codes 多选，safeParse 冗余）两类字段。impl-writer 须对整体表单调 `createRoleInputSchema.safeParse`（覆盖 name/description 校验），permission_codes 值经多选 options 派生保证合法（safeParse 不会在此字段失败）。此为单一 safeParse 调用同时覆盖两类字段，非"类型派生字段单独跳过 safeParse"——因 createRoleInputSchema.safeParse 是整体校验，无法字段级跳过（§3.2 混合表单提示）。**注**：AC-ARCH-4（类型派生不强制 safeParse）针对的是"独立的类型派生操作"（如 UserRolesPanel toggle、DeptTreePage 用户分配），不针对 RoleForm 内的 permission_codes 字段（因 RoleForm 整体须 safeParse 覆盖 name/description）。

7. **「UserListPage 行操作扩展 (D24) + UserRolesPanel 触发」组合**：R14 在 R12 UserListPage.tsx 新增"角色"行操作按钮（触发 UserRolesPanel）。impl-writer 须保证：(1) UserRow 组件新增"角色"按钮（onClick 打开 UserRolesPanel，传 userId）；(2) R12 既有 user-list-page.test.tsx 若断言"操作列仅含启停按钮"须调整（D24，AI-002 须显式列出）；(3) UserRolesPanel 独立组件测（T7）覆盖 toggle 逻辑，UserListPage 测（R12 既有）不覆盖 UserRolesPanel 内部（职责分离）。

### §10 advisory 文案同步边界（R13 S-2 固化）

R13 S-2 固化：advisory 偏离预判须明确同步边界。

- **须同步 §10 的 advisory 偏离**（行为/数据/schema 偏离）：
  - D11 客户端名称搜索（行为偏离：非服务端筛选）—— 已同步 §10 D11。
  - D15 datetime-local ISO 归一（数据偏离：前端归一为 ISO）—— 已同步 §10 D15（归一逻辑实现提示不须同步 §10 但须 Review 报告记录）。
  - D17/D18/D19 out-of-scope 端点不消费（行为偏离）—— 已同步 §10 D17/D18/D19。
- **不须同步 §10 但须 Review 报告记录的 advisory 偏离**（纯 UI 文案偏离）：
  - 按钮文案（如"角色"/"删除"/"添加子部门"等具体措辞）—— impl-writer 可选措辞，须 Review 报告记录。
  - 错误提示文案（如"角色名称必填"/"部门层级超过上限"等具体中文）—— 对齐 §11 矩阵，措辞可微调，须 Review 报告记录。
  - select option 文案（如 entity_type 选项"用户/角色/部门/通知/鉴权"等中文显示）—— impl-writer 可选措辞，须 Review 报告记录。
  - 空状态文案（如"暂无角色"/"暂无部门"/"暂无审计日志"）—— impl-writer 可选措辞，须 Review 报告记录。

## 11. 边界与异常（错误码 → 用户提示 + 交互行为矩阵）

> 对齐 contracts errorCodeSchema SSOT。R14 扩展 R12 errorMapping SPECIFIC_MESSAGES（D9），新增角色/部门域码中文提示。映射表键 SSOT 派生（R12 D11 沿用）。审计域只读无写错误码（AUDIT_LOG_NOT_FOUND 本期不触发，FALLBACK 兜底）。

### 11.1 角色域错误码

| ErrorCode | 触发场景 | 用户提示 | 交互行为 | AC |
|-----------|----------|----------|----------|----|
| `ROLE_NOT_FOUND` | DELETE role / 分配角色 role_id 不存在 | "角色不存在" | 删除：列表刷新；分配：面板原样显示 | AC-F3-6、AC-F4-5 |
| `ROLE_NAME_DUPLICATE` | 创建角色 name 已占用 | "角色名称已存在" | 创建表单内显示 | AC-F2-6（B1：非 ROLE_CODE_DUPLICATE） |
| `ROLE_BUILTIN_FORBIDDEN` | DELETE 内置 admin 角色 | "内置角色不可删除" | 原样显示 | AC-F3-4 |
| `ROLE_IN_USE` | DELETE 角色已分配给用户 | "角色已分配给用户，请先解除分配" | 原样显示 | AC-F3-5 |
| `USER_ROLE_ALREADY_ASSIGNED` | 重复分配角色给用户 | "用户已持有该角色" | 面板原样显示 | AC-F4-4 |

### 11.2 部门域错误码

| ErrorCode | 触发场景 | 用户提示 | 交互行为 | AC |
|-----------|----------|----------|----------|----|
| `DEPT_NOT_FOUND` | 创建子部门 parent_id 不存在 / DELETE / 用户分配 department_id 不存在 | "部门不存在" | 树刷新；用户分配原样显示 | AC-F5-9、AC-F6-2 |
| `DEPT_NAME_DUPLICATE` | 创建部门同父下 name 已存在 | "同级别下部门名称已存在" | 创建表单内显示 | AC-F5-5 |
| `DEPT_HAS_CHILDREN` | DELETE 部门仍有子部门 | "请先删除子部门" | 原样显示 | AC-F5-8 |
| `DEPT_DEPTH_EXCEEDED` | 创建子部门超过层级上限 3 | "部门层级超过上限" | 创建表单内显示 | AC-F5-6 |

> **注**：`DEPT_HAS_USERS`（errorCodeSchema 预留码）本期不触发（PRD-DEPT-001 Q1 决策"解除归属"非阻断），errorMapping FALLBACK 兜底即可，不单列具体提示。

### 11.3 审计域错误码

| ErrorCode | 触发场景 | 用户提示 | 交互行为 | AC |
|-----------|----------|----------|----------|----|
| `AUDIT_LOG_NOT_FOUND` | 本期不触发（仅列表查询，无单条详情端点） | "操作失败，请稍后重试"（FALLBACK） | 原样显示 | AC-F9-4 |

> 审计域只读无写，无 create/update/delete 错误码（append-only 不可变）。AUDIT_LOG_NOT_FOUND 为预留码（GET /v1/audit-logs/:id 端点本期后端未提供），FALLBACK 兜底。

### 11.4 沿用 R12 的错误码（R14 不扩展，复用 R12 errorMapping）

| ErrorCode | 触发场景 | 用户提示 | 交互行为 |
|-----------|----------|----------|----------|
| `VALIDATION_ERROR` | 客户端 schema 拦截（不到后端）；或后端 safeParse 失败 | 字段级错误（safeParse issue） | 不发请求 |
| `UNAUTHORIZED`/`TOKEN_INVALID`/`TOKEN_EXPIRED`/`TOKEN_REVOKED` | 受保护路由缺失/无效/过期/吊销 token | （不提示，跳登录） | 清 token + 跳 /login（R12 D8） |
| `FORBIDDEN` | role ≠ admin 或无对应权限码（如 audit:read） | "无权限执行此操作" | 原样显示 |
| `USER_NOT_FOUND` | 用户角色分配/部门分配 userId 不存在 | "用户不存在" | 原样显示 |
| `INVALID_CREDENTIALS` | 登录凭据错（R12，R14 不触发） | "邮箱或密码错误" | 登录页显示 |
| `VERSION_CONFLICT` | DELETE role If-Match 不匹配 | （自动重试无提示）；重试仍冲突 → "数据已被修改，请刷新后重试" | 用 current_version 重试 1 次；仍冲突抛错 |
| `VERSION_REQUIRED` | DELETE role 缺 If-Match | "操作失败，请稍后重试" | **不应触发**（client 保证注入）；触发则 client bug |
| （非 contracts）`NETWORK_ERROR` | fetch 抛错 | "网络异常，请稍后重试" | 不白屏 |
| （非 contracts）`INTERNAL_ERROR` / 5xx | 后端 500 | "服务异常，请稍后重试" | 原样显示 |

### 11.5 PII 安全补充

- 审计日志 operator_id/operator_name/before-after 禁止 console.log/日志记录（D10，§3.3）。
- before/after 中 pii=true 字段展示脱敏值（如 ab***@example.com），**禁止尝试还原**（AC-F7-10）。
- 沿用 R12 D12：token 禁止 console.log；password 仅登录页内存（R14 无登录表单改动）。

## 12. 工程配置（R14 零新增工程配置，复用 R12）

### 12.1 R14 零新增工程配置

R14 复用 R12 全部工程配置，**无新增/改动**：

- `apps/web/package.json`：R12 依赖清单（react/react-dom/react-router-dom + @admin/contracts + Vitest/Testing Library/jsdom），R14 **零新依赖**（AC-F10-3）。
- `apps/web/vite.config.ts`：R12 配置（alias @admin/contracts + dev proxy /v1），R14 无改动。
- `apps/web/tsconfig.json`：R12 配置（jsx:react-jsx + lib DOM + extends 根 tsconfig），R14 无改动。
- 根 `vitest.config.ts`：R12 已扩展 include 匹配 .tsx + setupFiles（R12 D20），R14 新增 .tsx 测试文件自动纳入，无改动。
- 根 `tsconfig.json`：R12 已含 apps/*/src + apps/*/test，R14 新增文件自动纳入 typecheck，无改动。
- `scripts/check-rules.mjs`：R12 ARCH-003 分支 + R13 S-4 walkWeb/allTs 已覆盖 apps/web，R14 无改动（§8）。

### 12.2 零新依赖核验

R14 新增 api/pages/components 模块仅 import：
- `@admin/contracts`（类型 + Zod schema，workspace 依赖）。
- `react` / `react-router-dom`（R12 已声明第三方依赖）。
- apps/web 内部模块（api/client、auth/AuthContext、components、lib/errorMapping）。

无新第三方依赖（无 axios/ky/Redux/Zustand/UI 框架/Playwright），AC-F10-3 满足。

### 12.3 monorepo 融入（沿用 R12）

- apps/web 作为 workspace 包（R12 已接入），R14 新增文件自动纳入根 scripts `test`（vitest run）+ `lint:rules`（check-rules.mjs）+ `typecheck`（tsc -p tsconfig.json --noEmit）覆盖（AI-004）。
- ARCH-003 校验经 `lint:rules` 执行，R14 新增前端源码 import 违规即 exit≠0（§8）。
- `@admin/contracts` 经 workspace 解析（`@admin/contracts: "*"`），R14 复用既有契约无须改动 contracts 包。
