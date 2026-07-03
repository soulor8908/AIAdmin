---
doc_type: PRD-Spec
id: PRD-WEB-ROLE-DEPT-AUDIT-001
title: 前端角色/部门/审计管理页（R14 前端多域扩展，验证前端对更多管理域的适应性）
status: decided
# Q&A 决策结果：Q1=②多选select(枚举派生) / Q2=①复用R12 D9自动重试 / Q3=①独立面板(UserListPage行触发) / Q4=①无限制递归 / Q5=①parentId可选 / Q6=支持operator_id+entity_type+date_range(无action) / Q7=①datetime-local+ISO归一 / Q8=①侧边栏 / Q9=②仅列表(不做详情页) / Q10=②继承管理out-of-scope / Q11=②effective-permissions out-of-scope / Q12=①组件测+API client契约测无E2E(对齐R12 Q8) / Q13=①扩展SPECIFIC_MESSAGES(角色/部门码加中文,审计码FALLBACK)
owner: ba@team
created: 2026-07-03
extends: PRD-WEB-AUTH-USER-001
aligns: [PRD-ROLE-001, PRD-ROLE-INHERITANCE-001, PRD-DEPT-001, PRD-AUDIT-001]
prd_ref: RETRO-ROUND14-001
---

# 前端角色/部门/审计管理页（R14 前端多域扩展，验证前端对更多管理域的适应性）

## BA 核验发现（contracts SSOT 优先，R10 S-2 / R13 S-1 教训闭合）

> 本节记录 PRD 起草阶段对 `packages/contracts/src/schemas/*` + `apps/api/src/server.ts` 路由表的核验结果。任务编排描述与 contracts SSOT 存在 5 处偏离，本 PRD 一律以 contracts SSOT 为准，并标注偏离以供 Tech-Spec / Reviewer 参考。

| # | 任务描述措辞 | contracts SSOT 实际 | PRD 采取 | 阻塞下游 |
|---|---|---|---|---|
| B1 | "角色创建 name+code+permissions?" / "ROLE_CODE_DUPLICATE" | `roleSchema`/`createRoleInputSchema` 无 `code` 字段（用 `name` 全局唯一，1..64）；错误码为 `ROLE_NAME_DUPLICATE`（非 ROLE_CODE_DUPLICATE） | 角色创建字段 = `name + description + permission_codes`；唯一性冲突码 = `ROLE_NAME_DUPLICATE` | Tech-Spec §3.2 表单校验、impl RoleForm、test 角色创建用例 |
| B2 | "角色列表（分页+筛选）" | `listRoleQuerySchema` 仅 `{page, pageSize}`，**无筛选字段** | F1 角色列表 = 分页 + 空状态 + 加载态；客户端名称搜索为 [advisory] 仅过滤当前页（非服务端筛选） | Tech-Spec §3.1、impl RoleListPage、test 列表用例 |
| B3 | "审计日志筛选 actor/action/resource_type/date_range" | `listAuditLogQuerySchema` 支持 `operated_from/operated_to/operator_id/entity_type`；契约注释明示 "action 过滤为 Q5 OPEN，本期不提供" | 审计筛选 = operator_id + entity_type + operated_from/operated_to；**不支持 action 筛选** | Tech-Spec §3.1、impl AuditLogPage、test 审计用例 |
| B4 | "用户部门分配成功/已在该部门" | errorCodeSchema 无 "已在该部门" 码；`assignUserDepartmentInputSchema` 为覆盖式（departmentId 必填可空），重复分配同部门 = 幂等成功（200） | AC 调整为"重复分配同部门返回成功（幂等），不提示已在该部门" | Tech-Spec §11、impl、test 部门分配用例 |
| B5 | "userRolesResultSchema/roleDeleteInputSchema/listUserRolesInputSchema 等在 contracts" | 这些 schema **不在 contracts**：GET /v1/users/:userId/roles 返回裸 `UserRole[]`（userRoleSchema 数组，无 envelope）；procedure input schema 在 apps/api/src/router/role.ts（前端不消费） | 前端 GET 用户角色消费 `UserRole[]`；不引用 procedure input schema | Tech-Spec §3.1、impl api/roles.ts |

## 背景

R12 首次引入前端（apps/web），落地登录页 + 用户列表/创建/启停 + 前端基础设施（API client + 路由守卫 + 错误处理），闭合 ARCH-003「跨层只经契约」从 `[预留]` 到机器化 enforcement（R1-R11 唯一未机器化规则）。R13 固化 S-1~S-5 工作流改进（§3.2 区分自由文本表单 vs 类型派生操作、§10 advisory 文案同步边界、test-writer AC 覆盖矩阵自检 + 组合场景测试）。R12 复盘 §6 列出的下一轮候选之一即"前端扩展角色/部门/审计页（更多管理域前端）"。

本期（R14）作为**前端多域扩展轮次**，在 R12 既有前端基础设施上新增三个管理域页面，验证以下未覆盖的工作流边界：

1. **前端对多管理域的扩展适应性**：R12 仅覆盖鉴权域 + 用户域（单域 CRUD + 状态切换），R14 一次性扩展角色域（列表/创建/删除 + 用户角色分配）、部门域（树形递归渲染 + 创建/删除 + 用户归属）、审计域（只读列表 + 多维筛选）。三个域数据形态各异（扁平分页 / 递归树 / append-only 只读），验证 R12 前端基础设施（API client / AuthContext / RouteGuard / ErrorBanner / errorMapping）对多域的复用性，以及 ARCH-003 在新增模块下持续合规。
2. **versioned 写操作多端点复用**：R12 仅 PATCH /v1/users/:id/status 一个 versioned 端点（If-Match + 409 重试）。R14 新增 DELETE /v1/roles/:id（versioned，须 If-Match + VERSION_CONFLICT 重试），验证 R12 D9 重试策略（用 409 body current_version）对 DELETE 类 versioned 操作的复用。**注**：DELETE /v1/departments/:id 非 versioned（server.ts L320 无第 5 参），部门删除无须 If-Match。
3. **递归数据结构前端渲染**：部门树 `departmentTreeNodeSchema` 为递归 Zod schema（children: z.array(z.lazy(...))），前端须递归渲染嵌套树。R12 仅渲染扁平列表，R14 验证前端对递归契约的适应性。
4. **R13 S-1 固化验证**：R14 含自由文本表单（角色创建 name/description、部门创建 name）与类型派生操作（角色分配 toggle、部门分配 select、权限码多选）。AC 措辞须精确区分两类（自由文本须 safeParse，类型派生 TS 类型保证），验证 R13 S-1 在多域下的可操作性。
5. **R13 S-3 AC↔测试覆盖矩阵**：R14 PRD 验收标准须标注 AC↔测试用例覆盖矩阵（或注明由 test-writer 阶段补矩阵），验证 S-3 固化在 PRD 阶段的落地。
6. **只读域前端模式**：审计日志为 append-only 只读域（无写端点），前端仅消费 GET 列表 + 筛选。验证前端对只读域的模式（无表单/无 versioned/无乐观锁）。

后端已就绪（R1-R11 778 用例 + R12 前端 883 用例基线），**本轮不实现后端任何改动**，contracts 无新增 schema（角色/部门/审计契约在 R5/R7/R8 已就绪）。

## 业务目标

- **目标1（角色管理页）**：角色列表分页展示（GET /v1/roles）；角色创建（name + description + permission_codes 多选，对齐 createRoleInputSchema）；角色删除（versioned，If-Match + VERSION_CONFLICT 自动重试，复用 R12 D9）；内置角色不可删（ROLE_BUILTIN_FORBIDDEN）、已分配角色不可删（ROLE_IN_USE）明确提示。
- **目标2（用户角色分配）**：UserRolesPanel 面板（从 UserListPage 行操作触发），GET 用户已分配角色列表 + POST 分配 + DELETE 移除；重复分配提示 USER_ROLE_ALREADY_ASSIGNED；角色不存在提示 ROLE_NOT_FOUND。
- **目标3（部门管理页）**：部门树递归渲染（GET /v1/departments/tree）；部门创建（name + 可选 parentId，根/子部门）；部门删除（非 versioned，DEPT_HAS_CHILDREN 拒绝、DEPT_NOT_FOUND 提示）；用户部门归属分配（POST /v1/departments/:departmentId/users/:userId，覆盖式幂等）。
- **目标4（审计日志页）**：只读列表（GET /v1/audit-logs），分页 + 筛选（operator_id + entity_type + operated_from/operated_to），空状态，加载态；before/after 中 PII 邮箱已由后端脱敏（redactedAuditLogSchema），前端展示脱敏值不还原。
- **目标5（导航扩展）**：侧边栏导航（用户/角色/部门/审计入口 + 登出），路由守卫覆盖新页面（复用 R12 RouteGuard，白名单仍仅 /login）。
- **目标6（错误处理扩展）**：errorMapping 扩展角色/部门相关 ErrorCode 中文提示（ROLE_*/DEPT_*），审计域只读无写错误码（AUDIT_LOG_NOT_FOUND 本期不触发，FALLBACK 兜底）；映射表键仍从 errorCodeSchema SSOT 派生（R12 D11）。
- **目标7（前端基础设施零新增）**：复用 R12 api/client.ts（Bearer/If-Match/401 拦截/409 重试/wire 适配）、auth/（tokenStore/AuthContext/RouteGuard）、components/ErrorBanner、lib/errorMapping；新增 api/roles.ts、api/departments.ts、api/audit-logs.ts（对齐 api/users.ts 风格）；零新依赖。
- **目标8（ARCH-003 持续合规）**：新增 api/pages/components 模块继续受 ARCH-003 约束——只 import @admin/contracts + apps/web 内部 + 第三方，禁止 import apps/api/src/**。R12 已机器化的 check-rules.mjs ARCH-003 分支自动覆盖新增文件。
- **目标9（验证工作流多域扩展适应性）**：验证 spec-first 工作流在前端多域扩展下的适应性——PRD（BA，本轮含 contracts SSOT 核验发现 B1~B5）→ Tech-Spec + 契约复用（TechLead，契约冻结无新增）→ 测试先行（含 AC↔测试覆盖矩阵，R13 S-3）→ 实现 → Review（ARCH-003 逐文件 + R13 S-1 自由文本/类型派生区分）→ 门禁 G7。

## 用户故事

- 作为管理员，我希望在侧边栏切换进入角色管理页，分页浏览角色、创建新角色（选择权限码）、删除自定义角色，并能查看/分配某用户的角色。
- 作为管理员，我希望删除角色遇到并发冲突时系统自动重试一次（用最新 version），而非让我手动处理版本号。
- 作为管理员，我希望删除内置 admin 角色或已分配给用户的角色时被明确拒绝并给出原因（"内置角色不可删除"/"角色已分配给用户，请先解除分配"）。
- 作为管理员，我希望在用户列表行点击"角色"打开面板，看到该用户已分配的角色，并通过 toggle 分配/移除角色。
- 作为管理员，我希望进入部门管理页看到部门树的层级结构（递归嵌套），能创建根部门或子部门，能删除无子部门的叶部门。
- 作为管理员，我希望删除仍有子部门的部门时被明确拒绝（"请先删除子部门"），避免误操作。
- 作为管理员，我希望在审计日志页按操作者/实体类型/时间范围筛选查看操作历史，看到谁在何时对什么实体做了什么动作。
- 作为管理员，我希望审计日志中的邮箱等 PII 字段已脱敏展示（如 ab***@example.com），不会泄露完整邮箱。
- 作为管理员，我希望未登录访问角色/部门/审计页时被路由守卫拦截跳转登录页，与 R12 用户页一致。
- 作为系统负责人，我希望新增前端模块继续遵守 ARCH-003（只经契约，不直连后端），且错误码映射从 SSOT 派生不漏枚举。
- 作为系统负责人，我希望审计日志页只读、无任何写操作入口，符合审计日志 append-only 不可变语义。

## 功能点清单

- [ ] F1：角色列表页（GET /v1/roles?page&pageSize 分页；空状态；加载态；[advisory] 客户端名称搜索仅过滤当前页。**注**：listRoleQuerySchema 无服务端筛选字段，B2）
- [ ] F2：角色创建（自由文本表单 name + description + permission_codes 多选；createRoleInputSchema.safeParse；ROLE_NAME_DUPLICATE 提示；permission_codes 选项从 permissionCodeSchema.options SSOT 派生）
- [ ] F3：角色删除（DELETE /v1/roles/:id versioned + If-Match=role.version；VERSION_CONFLICT 自动重试 1 次（复用 R12 D9）；ROLE_BUILTIN_FORBIDDEN / ROLE_IN_USE / ROLE_NOT_FOUND 提示）
- [ ] F4：用户角色分配面板（UserRolesPanel，从 UserListPage 行操作触发；GET /v1/users/:userId/roles → UserRole[]；POST /v1/users/:userId/roles/:roleId 分配；DELETE /v1/users/:userId/roles/:roleId 移除；类型派生操作，roleId 从角色列表派生 TS 类型保证；USER_ROLE_ALREADY_ASSIGNED / ROLE_NOT_FOUND 提示）
- [ ] F5：部门树页（GET /v1/departments/tree 递归渲染 DepartmentTreeNode；创建根部门 parentId 缺省；创建子部门 parentId=所选父节点；删除叶部门；DEPT_HAS_CHILDREN / DEPT_NOT_FOUND / DEPT_NAME_DUPLICATE / DEPT_DEPTH_EXCEEDED 提示）
- [ ] F6：用户部门分配（POST /v1/departments/:departmentId/users/:userId 覆盖式幂等；DEPT_NOT_FOUND 提示；重复分配同部门幂等成功无提示，B4）
- [ ] F7：审计日志页（GET /v1/audit-logs 只读列表；分页；筛选 operator_id + entity_type + operated_from/operated_to；**不支持 action 筛选**，B3；空状态；加载态；items 为 redactedAuditLogSchema 邮箱已脱敏）
- [ ] F8：导航扩展（侧边栏：用户/角色/部门/审计入口 + 登出；路由守卫覆盖 /roles /departments /audit-logs，复用 R12 RouteGuard 白名单仅 /login）
- [ ] F9：错误处理（errorMapping 扩展 ROLE_*/DEPT_* 中文提示；审计域 AUDIT_LOG_NOT_FOUND 本期不触发 FALLBACK 兜底；映射表键 SSOT 派生；网络错误/401 拦截复用 R12）
- [ ] F10：前端基础设施复用（API client / AuthContext / RouteGuard / ErrorBanner / tokenStore / lib 复用 R12；新增 api/roles.ts、api/departments.ts、api/audit-logs.ts；零新依赖；ARCH-003 持续合规）

## 数据实体草图

**前端无独立数据实体**——全部消费 `@admin/contracts` 经 `z.infer` 派生（ARCH-002/CODE-004 延伸，R12 D3 沿用）。本轮契约已就绪，无新增 schema。

### 角色域类型（源自 `packages/contracts/src/schemas/role.ts`）

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `Role` | `z.infer<typeof roleSchema>` | 角色实体 `{id, name, description, permission_codes, is_builtin, parent_role_id, created_at, version}`（无 code 字段，B1） |
| `PermissionCode` | `z.infer<typeof permissionCodeSchema>` | 权限码枚举（user:read/.../transfer:write，11 项），多选 options 派生源 |
| `CreateRoleInput` | `z.infer<typeof createRoleInputSchema>` | 创建角色表单提交体 `{name(1..64), description(max512), permission_codes(array)}`，.strict() |
| `ListRoleQuery` | `z.infer<typeof listRoleQuerySchema>` | `{page(默认1), pageSize(默认10,max100)}`，**无筛选字段**（B2） |
| `RoleListResult` | `z.infer<typeof roleListResultSchema>` | `{items, total, page, pageSize, totalPages}` |
| `UserRole` | `z.infer<typeof userRoleSchema>` | 用户-角色关联 `{id, user_id, role_id, assigned_at}`，GET /v1/users/:userId/roles 返回 `UserRole[]`（裸数组，无 envelope，B5） |
| `AssignRoleInput` | `z.infer<typeof assignRoleInputSchema>` | `{userId, roleId}`（path 参数合并形态，前端实际经 path 传，body 空） |

### 部门域类型（源自 `packages/contracts/src/schemas/dept.ts`）

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `Department` | `z.infer<typeof departmentSchema>` | 部门实体 `{id, name, parent_id, created_at}` |
| `CreateDepartmentInput` | `z.infer<typeof createDepartmentInputSchema>` | 创建部门表单 `{name(1..64), parent_id?(uuid\|null 可选)}`，parentId 缺省/null=根部门 |
| `DepartmentTreeNode` | `z.infer<typeof departmentTreeNodeSchema>` | 递归树节点 `{id, name, parent_id, created_at, children: DepartmentTreeNode[]}`，叶节点 children=[] |
| `DepartmentTreeResult` | `z.infer<typeof departmentTreeResultSchema>` | `{items: DepartmentTreeNode[]}`（根节点构成的树数组） |
| `AssignUserDepartmentInput` | `z.infer<typeof assignUserDepartmentInputSchema>` | `{userId, departmentId(uuid\|null)}`，departmentId 必填可空（null=解除归属） |

### 审计域类型（源自 `packages/contracts/src/schemas/audit.ts`）

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `RedactedAuditLog` | `z.infer<typeof redactedAuditLogSchema>` | 审计日志查询返回项（脱敏态），`{id, operator_id, operator_name, entity_type, entity_id, action, operated_at, before, after, created_at}`；before/after 中 pii=true 字段已脱敏 |
| `AuditLogEntityType` | `z.infer<typeof auditLogEntityTypeSchema>` | 实体类型枚举 `user/role/dept/notification/auth`，筛选 select options 派生源 |
| `AuditLogAction` | `z.infer<typeof auditLogActionSchema>` | 动作枚举 `create/update/delete/login/login_failed/logout`（**仅展示用，不支持 action 筛选**，B3） |
| `ChangeField` | `z.infer<typeof changeFieldSchema>` | before/after 元素 `{field, value, pii}` |
| `ListAuditLogQuery` | `z.infer<typeof listAuditLogQuerySchema>` | `{page, pageSize(默认20,钳制100), operated_from?, operated_to?, operator_id?, entity_type?}`，**无 action** |
| `AuditLogListResult` | `z.infer<typeof auditLogListResultSchema>` | `{items: RedactedAuditLog[], total, page, pageSize, totalPages}` |

> **禁用类型**（沿用 R12 D3）：前端禁止 import `auditLogSchema`/`AuditLog`（存储态含未脱敏 PII，后端内部用，SEC-003b 延伸）——前端查询只消费 `redactedAuditLogSchema`/`RedactedAuditLog`。同理禁止 import `piiFieldRegistrySchema`（后端脱敏 registry 用）。

### 共享类型（源自 `packages/contracts/src/schemas/user.ts`，R12 已消费）

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `ErrorCode` | `z.infer<typeof errorCodeSchema>` | 全局错误码 SSOT（含 ROLE_*/DEPT_*/AUDIT_LOG_NOT_FOUND 等），errorMapping 键派生源 |
| `ErrorResponse` | `z.infer<typeof errorResponseSchema>` | `{code, message, current_version?}`，API client 适配后对外暴露（R12 D10 wire 适配沿用） |

### 客户端表单校验 schema 复用清单（R13 S-1 区分两类）

| 功能点 | 类型 | 复用 schema | 校验点 | AC |
|--------|------|-------------|--------|----|
| F2 角色创建 name/description | **自由文本表单**（须 safeParse） | `createRoleInputSchema.safeParse` | name 1..64 + description max512 + permission_codes 数组 + 拒绝多余字段 | AC-F2-3/4/5 |
| F2 角色创建 permission_codes 多选 | **类型派生操作**（TS 类型保证，safeParse 冗余可保留 defensive） | 选项从 `permissionCodeSchema.options` 派生，值 ∈ 枚举编译期保证 | 值合法性由 select options 保证 | AC-F2-2 |
| F5 部门创建 name | **自由文本表单**（须 safeParse） | `createDepartmentInputSchema.safeParse` | name 1..64 + parent_id uuid\|null 可选 | AC-F5-3/4 |
| F4 角色分配 toggle | **类型派生操作**（roleId 从角色列表派生，TS 类型保证 uuid） | 不调 safeParse（schema 校验冗余）；或保留 defensive safeParse | roleId/userId 由列表派生，TS 类型保证 | AC-F4-2/3 |
| F6 部门分配 select | **类型派生操作**（departmentId 从树派生） | 不调 safeParse（schema 校验冗余） | departmentId 由树派生，TS 类型保证 | AC-F6-1 |

### 新增 api 模块设计（对齐 R12 api/users.ts 风格）

- `apps/web/src/api/roles.ts`：
  - `listRoles(query: ListRoleQuery): Promise<RoleListResult>` → GET /v1/roles（query 拼接 page/pageSize）
  - `createRole(input: CreateRoleInput): Promise<Role>` → POST /v1/roles（body）
  - `deleteRole(id: string, expectedVersion: number): Promise<void>` → DELETE /v1/roles/:id（versioned=true，If-Match=expectedVersion；409 由 client D9 自动重试）
  - `listUserRoles(userId: string): Promise<UserRole[]>` → GET /v1/users/:userId/roles（返回裸数组）
  - `assignRole(userId: string, roleId: string): Promise<void>` → POST /v1/users/:userId/roles/:roleId（path 参数，body 空）
  - `removeRole(userId: string, roleId: string): Promise<void>` → DELETE /v1/users/:userId/roles/:roleId
- `apps/web/src/api/departments.ts`：
  - `getDepartmentTree(): Promise<DepartmentTreeResult>` → GET /v1/departments/tree
  - `createDepartment(input: CreateDepartmentInput): Promise<Department>` → POST /v1/departments
  - `deleteDepartment(id: string): Promise<void>` → DELETE /v1/departments/:id（**非 versioned**，无 If-Match）
  - `assignUserDepartment(userId: string, departmentId: string): Promise<void>` → POST /v1/departments/:departmentId/users/:userId（path 参数）
- `apps/web/src/api/audit-logs.ts`：
  - `listAuditLogs(query: ListAuditLogQuery): Promise<AuditLogListResult>` → GET /v1/audit-logs（query 拼接 page/pageSize/operated_from/operated_to/operator_id/entity_type）

### PII / 敏感字段清单（安全域标注）

| 字段 | 来源 | 敏感等级 | 前端处理 |
|------|------|----------|----------|
| `operator_id` | 审计日志 | 中（uuid，关联用户） | 展示用，禁止 console.log / 日志记录 |
| `operator_name` | 审计日志 | 中（姓名快照） | 展示用，禁止 console.log / 日志记录 |
| `entity_id` | 审计日志 | 低（uuid） | 展示用 |
| `before/after` 中 pii=true 字段 | 审计日志 | **高（含邮箱，后端已脱敏为 ab***@example.com）** | 展示脱敏值，**禁止尝试还原**；禁止 console.log / 日志记录 / 导出 |
| `token` | R12 沿用 | 高 | 沿用 R12 D12（localStorage，禁止 console.log） |
| `password` | R12 沿用（仅登录页） | 高 | 沿用 R12 D12（仅内存，禁止持久化/日志） |
| 角色 `name`/`description` | 角色域 | 低 | 展示/输入用 |
| 部门 `name` | 部门域 | 低 | 展示/输入用 |

> 审计日志页**只读无写**，无表单提交，无 password/token 字段暴露。审计页须确认 `audit:read` 权限由后端 SEC-002 强制（前端不预判权限，依赖后端 FORBIDDEN 返回时显示"无权限"）。

## 验收标准（Given/When/Then）—— AI-007 端到端验收依据

> 全部 AC 须可被前端测试覆盖（Vitest + Testing Library，Q12 决策①对齐 R12 Q8）。AC 编号对齐功能点 F1~F10 + ARCH-003 合规专项 + R13 S-1 合规专项。
> **R13 S-3 固化**：每条 AC 标注覆盖它的测试文件（T#）+ 用例号占位（由 test-writer 阶段最终确认），未覆盖显式列 reason。覆盖矩阵汇总见本节末。

### F1 角色列表页

- **AC-F1-1 列表首次加载**：GIVEN 已登录 / WHEN 访问 /roles / THEN 调 GET /v1/roles?page=1&pageSize=20（前端显式传 pageSize=20，沿用 R12 D14 不依赖 schema 缺省 10），渲染 items（每行展示 name/description/is_builtin 标识 + 操作按钮）。覆盖：T4 [test-writer 定号]
- **AC-F1-2 分页切换**：GIVEN total > pageSize（多页）/ WHEN 点击第 2 页 / THEN 调 GET /v1/roles?page=2&pageSize=20，渲染第 2 页数据。覆盖：T4
- **AC-F1-3 空状态**：GIVEN 无角色 / THEN 列表区域显示空状态文案（如"暂无角色"），不报错。覆盖：T4
- **AC-F1-4 加载态**：GIVEN 请求进行中 / THEN 列表区域显示 loading 文案（沿用 R12 D16）。覆盖：T4
- **AC-F1-5 内置角色标识**：GIVEN items 含 is_builtin=true 的 admin 角色 / THEN 该行展示"内置"标识且无删除按钮（或删除按钮 disabled，AC-F3-3 后端拒绝，前端可预禁用优化 UX [advisory]）。覆盖：T4
- **AC-F1-6 [advisory] 客户端名称搜索**：GIVEN 列表已加载 / WHEN 在搜索框输入名称关键字 / THEN 仅展示当前页 name 含关键字的行（**仅过滤当前页，非服务端筛选**，B2）。覆盖：T4（[advisory] 测试可选，未覆盖 reason：advisory 增强非核心验收）

### F2 角色创建（自由文本表单，须 safeParse，R13 S-1）

- **AC-F2-1 创建成功**：GIVEN 合法 name（未占用）+ description + permission_codes（可空数组）/ WHEN 提交 / THEN 调 POST /v1/roles 返回 Role，弹窗关闭，列表刷新含新角色（is_builtin=false）。覆盖：T4
- **AC-F2-2 permission_codes 多选**：GIVEN permission_codes 选项从 `permissionCodeSchema.options` SSOT 派生 / THEN 表单多选控件选项 = 11 项权限码全集（SSOT 派生，AI-005）；选中后请求体 permission_codes 为选中数组。覆盖：T4、T9（SSOT 派生断言）
- **AC-F2-3 表单校验-name 空**（自由文本，须 safeParse）：GIVEN name 为空 / WHEN 提交 / THEN `createRoleInputSchema.safeParse` 拦截，显示"角色名称必填"，不发请求。覆盖：T4
- **AC-F2-4 表单校验-name 超长**（自由文本，须 safeParse）：GIVEN name > 64 字符 / WHEN 提交 / THEN safeParse 拦截（min(1).max(64)），显示"角色名称不超过 64 字符"，不发请求。覆盖：T4
- **AC-F2-5 表单校验-description 超长**（自由文本，须 safeParse）：GIVEN description > 512 字符 / WHEN 提交 / THEN safeParse 拦截（max(512)），显示"描述不超过 512 字符"，不发请求。覆盖：T4
- **AC-F2-6 角色名称重复**：GIVEN name 已被占用 / WHEN 提交 / THEN 返回 ROLE_NAME_DUPLICATE，表单显示"角色名称已存在"（B1：非 ROLE_CODE_DUPLICATE）。覆盖：T4、T9（错误码映射）

### F3 角色删除（versioned，复用 R12 D9 重试）

- **AC-F3-1 删除成功**：GIVEN 自定义角色（is_builtin=false, version=N, 未分配给用户）/ WHEN 点击"删除" / THEN 调 DELETE /v1/roles/:id + If-Match: N，返回 204，列表刷新不含该角色。覆盖：T4
- **AC-F3-2 VERSION_CONFLICT 自动重试**：GIVEN 列表 role.version=N 但实际已变 N+1 / WHEN DELETE 返回 409 VERSION_CONFLICT（含 current_version=N+1）/ THEN API client 自动用 current_version=N+1 重试 DELETE 一次（复用 R12 D9，不 GET 单条——GET /v1/roles/:id 虽存在但重试无须 GET，直接用 409 body），成功后列表刷新。覆盖：T1（API client 契约）、T4
- **AC-F3-3 重试仍冲突提示**：GIVEN 重试后仍返回 409 / THEN 显示"数据已被修改，请刷新后重试"（沿用 R12 AC-F4-4），不无限重试（仅 1 次）。覆盖：T1、T4
- **AC-F3-4 内置角色拒绝**：GIVEN is_builtin=true 的 admin 角色 / WHEN 点击删除（若按钮未预禁用）/ THEN 后端返回 ROLE_BUILTIN_FORBIDDEN，前端显示"内置角色不可删除"。覆盖：T4、T9
- **AC-F3-5 已分配角色拒绝**：GIVEN 角色已分配给至少一个用户 / WHEN 删除 / THEN 后端返回 ROLE_IN_USE，前端显示"角色已分配给用户，请先解除分配"。覆盖：T4、T9
- **AC-F3-6 角色不存在**：GIVEN role_id 合法 uuid 但无记录 / WHEN 删除 / THEN 后端返回 ROLE_NOT_FOUND，前端显示"角色不存在"，列表刷新。覆盖：T4、T9
- **AC-F3-7 API client 始终带 If-Match**：GIVEN 任意 DELETE role 请求 / THEN API client 注入 If-Match: <role.version> header（versioned=true，沿用 R12 D7）。覆盖：T1

### F4 用户角色分配面板（类型派生操作，R13 S-1）

- **AC-F4-1 面板打开加载用户角色**：GIVEN 已登录 + UserListPage 某用户行 / WHEN 点击"角色"操作 / THEN 打开 UserRolesPanel，调 GET /v1/users/:userId/roles，渲染该用户已分配角色列表（UserRole[]，B5 裸数组）。覆盖：T7
- **AC-F4-2 分配成功**（类型派生操作，roleId 从全量角色列表派生，TS 类型保证 uuid，不调 safeParse）：GIVEN 面板展示可选角色（GET /v1/roles 全量）+ 用户未持有角色 X / WHEN toggle 勾选角色 X / THEN 调 POST /v1/users/:userId/roles/:roleId，成功后面板刷新该角色标记为已分配。覆盖：T7
- **AC-F4-3 移除成功**（类型派生操作）：GIVEN 用户已持有角色 X / WHEN toggle 取消勾选 / THEN 调 DELETE /v1/users/:userId/roles/:roleId，成功后面板刷新该角色标记为未分配。覆盖：T7
- **AC-F4-4 重复分配提示**：GIVEN 用户已持有角色 X / WHEN 再次分配 X（并发场景）/ THEN 后端返回 USER_ROLE_ALREADY_ASSIGNED，前端显示"用户已持有该角色"。覆盖：T7、T9
- **AC-F4-5 角色不存在**：GIVEN roleId 合法 uuid 但无记录 / WHEN 分配 / THEN 后端返回 ROLE_NOT_FOUND，前端显示"角色不存在"。覆盖：T7、T9
- **AC-F4-6 用户不存在**：GIVEN userId 合法 uuid 但无记录 / WHEN 加载/分配 / THEN 后端返回 USER_NOT_FOUND，前端显示"用户不存在"。覆盖：T7、T9

### F5 部门树页

- **AC-F5-1 树首次加载递归渲染**：GIVEN 已登录 / WHEN 访问 /departments / THEN 调 GET /v1/departments/tree，递归渲染 DepartmentTreeNode（根节点 → children 嵌套，无深度限制，Q4 决策①）；无部门时 items=[] 显示空状态。覆盖：T5
- **AC-F5-2 创建根部门**：GIVEN 表单 name + parentId 缺省 / WHEN 提交 / THEN `createDepartmentInputSchema.safeParse` 通过，调 POST /v1/departments body={name}（parentId 不传，对齐 optional），成功后树刷新含新根部门。覆盖：T5
- **AC-F5-3 创建子部门**（自由文本 name，须 safeParse）：GIVEN 选定父节点 + name / WHEN 提交 / THEN safeParse 通过，调 POST /v1/departments body={name, parent_id: <父id>}，成功后树刷新含新子部门。覆盖：T5
- **AC-F5-4 表单校验-name 空**（自由文本，须 safeParse）：GIVEN name 为空 / WHEN 提交 / THEN `createDepartmentInputSchema.safeParse` 拦截，显示"部门名称必填"，不发请求。覆盖：T5
- **AC-F5-5 部门名称重复**：GIVEN 同父下 name 已存在 / WHEN 创建 / THEN 返回 DEPT_NAME_DUPLICATE，显示"同级别下部门名称已存在"。覆盖：T5、T9
- **AC-F5-6 层级超限**：GIVEN 父部门已在第 3 层 / WHEN 创建子部门 / THEN 返回 DEPT_DEPTH_EXCEEDED，显示"部门层级超过上限"。覆盖：T5、T9
- **AC-F5-7 删除叶部门成功**：GIVEN 无子部门的叶部门 / WHEN 删除 / THEN 调 DELETE /v1/departments/:id（**非 versioned，无 If-Match**），返回 204，树刷新。覆盖：T5
- **AC-F5-8 有子部门拒绝删除**：GIVEN 部门仍有子部门 / WHEN 删除 / THEN 返回 DEPT_HAS_CHILDREN，显示"请先删除子部门"。覆盖：T5、T9
- **AC-F5-9 部门不存在**：GIVEN id 合法 uuid 但无记录 / WHEN 删除 / THEN 返回 DEPT_NOT_FOUND，显示"部门不存在"。覆盖：T5、T9

### F6 用户部门分配（类型派生操作，R13 S-1）

- **AC-F6-1 分配成功**（类型派生操作，departmentId 从树派生，TS 类型保证 uuid，不调 safeParse）：GIVEN 选定部门 + 用户 / WHEN 分配 / THEN 调 POST /v1/departments/:departmentId/users/:userId，成功后提示"部门归属已更新"。覆盖：T5（或 T7，由 test-writer 定）
- **AC-F6-2 部门不存在**：GIVEN departmentId 合法 uuid 但无记录 / WHEN 分配 / THEN 返回 DEPT_NOT_FOUND，显示"部门不存在"。覆盖：T5、T9
- **AC-F6-3 重复分配幂等成功**：GIVEN 用户已归属部门 X / WHEN 再次分配至 X / THEN 返回成功（**幂等，无错误码**，B4），不提示"已在该部门"。覆盖：T5
- **AC-F6-4 用户不存在**：GIVEN userId 合法 uuid 但无记录 / WHEN 分配 / THEN 返回 USER_NOT_FOUND，显示"用户不存在"。覆盖：T5、T9

### F7 审计日志页（只读）

- **AC-F7-1 列表首次加载**：GIVEN 已登录 / WHEN 访问 /audit-logs / THEN 调 GET /v1/audit-logs?page=1&pageSize=20，渲染 items（每行展示 operated_at/operator_name/entity_type/action/摘要），按 operated_at 倒序（后端排序）。覆盖：T6
- **AC-F7-2 分页切换**：GIVEN total > pageSize / WHEN 点击第 2 页 / THEN 调 GET /v1/audit-logs?page=2&pageSize=20。覆盖：T6
- **AC-F7-3 筛选-entity_type**：GIVEN 选择 entity_type=role / WHEN 应用筛选 / THEN 调 GET /v1/audit-logs?entity_type=role&page=1，仅渲染 role 实体日志；entity_type 选项从 `auditLogEntityTypeSchema.options` SSOT 派生（5 项）。覆盖：T6、T9
- **AC-F7-4 筛选-operator_id**：GIVEN 选择/输入 operator_id（uuid）/ WHEN 应用筛选 / THEN 调 GET /v1/audit-logs?operator_id=<uuid>&page=1，仅渲染该操作者日志。覆盖：T6
- **AC-F7-5 筛选-date_range**：GIVEN 选择 operated_from + operated_to（datetime-local，前端归一为 ISO 8601 datetime）/ WHEN 应用筛选 / THEN 调 GET /v1/audit-logs?operated_from=<ISO>&operated_to=<ISO>&page=1。覆盖：T6
- **AC-F7-6 筛选+分页复合**（R13 S-3 组合场景）：GIVEN 已选 entity_type=role 且多页 / WHEN 翻页 / THEN 调 GET /v1/audit-logs?entity_type=role&page=2&pageSize=20，保持筛选条件。覆盖：T6
- **AC-F7-7 不支持 action 筛选**：GIVEN 审计筛选区 / THEN **无 action 筛选控件**（B3，contract 不支持）；action 仅在列表行展示。覆盖：T6
- **AC-F7-8 空状态**：GIVEN 无满足筛选条件日志 / THEN 列表区域显示"暂无审计日志"，不报错。覆盖：T6
- **AC-F7-9 加载态**：GIVEN 请求进行中 / THEN 列表区域显示 loading 文案。覆盖：T6
- **AC-F7-10 PII 脱敏展示**：GIVEN 日志 before/after 含 pii=true 的 email 字段 / THEN 展示脱敏值（如 ab***@example.com，匹配 redactedEmailSchema），**不展示完整邮箱**。覆盖：T6
- **AC-F7-11 只读无写入口**：GIVEN 审计日志页 / THEN 无任何创建/编辑/删除按钮（append-only 只读，对齐 PRD-AUDIT-001 F4）。覆盖：T6

### F8 导航扩展

- **AC-F8-1 侧边栏入口**：GIVEN 已登录任意受保护页 / THEN 侧边栏展示"用户/角色/部门/审计"4 个入口 + "登出"按钮（Q8 决策①侧边栏）。覆盖：T8
- **AC-F8-2 入口可达**：GIVEN 点击侧边栏"角色" / THEN 跳转 /roles 并渲染 RoleListPage；"部门"→ /departments；"审计"→ /audit-logs；"用户"→ /users。覆盖：T8
- **AC-F8-3 路由守卫覆盖新页**：GIVEN 未登录 / WHEN 访问 /roles 或 /departments 或 /audit-logs / THEN RouteGuard 跳转 /login（复用 R12 D13 白名单仅 /login）。覆盖：T8
- **AC-F8-4 登出复用 R12**：GIVEN 已登录 / WHEN 点击侧边栏"登出" / THEN 调 POST /v1/auth/logout（沿用 R12 AC-F6-2），清 token 跳 /login。覆盖：T8（沿用 R12 route-guard 测）

### F9 错误处理

- **AC-F9-1 错误码映射扩展-角色域**：GIVEN ROLE_NOT_FOUND/ROLE_NAME_DUPLICATE/ROLE_BUILTIN_FORBIDDEN/ROLE_IN_USE/USER_ROLE_ALREADY_ASSIGNED / THEN errorMapping 输出对应中文（"角色不存在"/"角色名称已存在"/"内置角色不可删除"/"角色已分配给用户，请先解除分配"/"用户已持有该角色"）。覆盖：T9
- **AC-F9-2 错误码映射扩展-部门域**：GIVEN DEPT_NOT_FOUND/DEPT_NAME_DUPLICATE/DEPT_HAS_CHILDREN/DEPT_DEPTH_EXCEEDED / THEN errorMapping 输出对应中文（"部门不存在"/"同级别下部门名称已存在"/"请先删除子部门"/"部门层级超过上限"）。覆盖：T9
- **AC-F9-3 错误码映射 SSOT 派生**：GIVEN errorMapping 映射表 / THEN 键从 `[...errorCodeSchema.options]` SSOT 派生（沿用 R12 D11），新增角色/部门码自动覆盖，枚举扩展不漏。覆盖：T9
- **AC-F9-4 审计域 FALLBACK**：GIVEN AUDIT_LOG_NOT_FOUND（本期不触发，预留码）/ THEN errorMapping 输出 FALLBACK"操作失败，请稍后重试"（未单列具体提示，因本期只读无写不触发）。覆盖：T9
- **AC-F9-5 401 拦截复用 R12**：GIVEN 任意新页面请求返回 401（鉴权类 4 码）/ THEN API client 沿用 R12 D8 拦截跳 /login。覆盖：T1（沿用 R12 api-client 测）
- **AC-F9-6 网络错误兜底复用 R12**：GIVEN fetch 抛错 / THEN 沿用 R12 AC-F7-3 显示"网络异常，请稍后重试"。覆盖：T1

### F10 前端基础设施复用 + ARCH-003 合规专项

- **AC-F10-1 API client 复用**：GIVEN 任意新页面 HTTP 调用 / THEN 经 R12 `apps/web/src/api/client.ts` 的 request() 发出，不直接调 fetch。覆盖：T1/T2/T3
- **AC-F10-2 Bearer/If-Match 注入复用**：GIVEN 已登录 + versioned 写（DELETE role）/ THEN 请求头含 `Authorization: Bearer <token>`（R12 D6）+ `If-Match: <version>`（R12 D7）。覆盖：T1
- **AC-F10-3 零新依赖**：GIVEN apps/web/package.json / THEN 本轮无新增 dependencies/devDependencies（沿用 R12 依赖清单）。覆盖：T8（或工程核验，由 test-writer 定）
- **AC-ARCH-1 新增模块不直连后端**：GIVEN apps/web/src 新增文件（api/roles.ts、api/departments.ts、api/audit-logs.ts、pages/RoleListPage.tsx、pages/DeptTreePage.tsx、pages/AuditLogPage.tsx、components/RoleForm.tsx、components/DeptForm.tsx、components/UserRolesPanel.tsx、components/Sidebar.tsx）/ THEN 无任何 import 指向 apps/api/src/**（repository/service/domain/router）或 @admin/api 包（ARCH-003，R12 check-rules.mjs 分支自动覆盖新增文件）。覆盖：T8（lint:rules 探针 + Reviewer 逐文件）
- **AC-ARCH-2 类型来自 contracts**：GIVEN 新增模块 / THEN 数据类型（Role/Department/RedactedAuditLog/ErrorCode 等）import 自 @admin/contracts，无手写 TS 类型副本。覆盖：T8（tsc + Reviewer）
- **AC-ARCH-3 客户端校验复用契约 schema（自由文本表单）**：GIVEN 角色创建 name/description + 部门创建 name 自由文本表单 / THEN 复用 createRoleInputSchema / createDepartmentInputSchema 的 .safeParse()（SSOT 派生，AI-005）。覆盖：T4、T5
- **AC-ARCH-4 类型派生操作不强制 safeParse**（R13 S-1 合规）：GIVEN 角色分配 toggle / 部门分配 select / 权限码多选（类型派生操作，值经 TS 类型保证 ∈ 枚举/uuid）/ THEN 可不调 safeParse（schema 校验冗余）；若不调须在 impl 报告显式标注 [约束] 偏离 + 反向同步 Spec §3.2（R13 S-1）。覆盖：T7、T4

### R13 S-1 合规专项

- **AC-S1-1 自由文本表单须 safeParse**：GIVEN F2 角色创建（name/description）+ F5 部门创建（name）/ THEN 提交前调对应 schema.safeParse，失败显示字段级错误不发请求。覆盖：T4、T5
- **AC-S1-2 类型派生操作 TS 类型保证**：GIVEN F4 角色分配 toggle + F6 部门分配 select + F2 权限码多选 / THEN 值经 TS 类型派生（roleId/departmentId 为 uuid 字面量、permission_codes 为枚举），无自由输入；safeParse 冗余可省略或保留 defensive。覆盖：T7、T4

### AC↔测试用例覆盖矩阵（R13 S-3 固化）

> 测试文件编号（T#）为本 PRD 预估，**最终用例号由 test-writer 阶段确认**（R13 S-3）。test-writer 须自检每条 AC 至少 1 个用例覆盖，未覆盖显式列 reason。

| AC | 覆盖测试文件 | 用例号（test-writer 定） | 备注 |
|----|-------------|------------------------|------|
| AC-F1-1~F1-5 | T4 role-list-page.test.tsx | 待定 | F1-6 advisory 可选测 |
| AC-F2-1~F2-6 | T4 role-list-page.test.tsx | 待定 | F2-2 SSOT 派生断言可选放 T9 |
| AC-F3-1~F3-7 | T4 role-list-page.test.tsx + T1 api-roles.test.ts | 待定 | F3-2/F3-3/F3-7 跨 T1+T4 |
| AC-F4-1~F4-6 | T7 user-roles-panel.test.tsx | 待定 | — |
| AC-F5-1~F5-9 | T5 dept-tree-page.test.tsx | 待定 | — |
| AC-F6-1~F6-4 | T5 dept-tree-page.test.tsx | 待定 | F6-1 可能跨 T7，test-writer 定 |
| AC-F7-1~F7-11 | T6 audit-log-page.test.tsx | 待定 | F7-6 组合场景（R13 S-3） |
| AC-F8-1~F8-4 | T8 navigation.test.tsx | 待定 | F8-4 沿用 R12 route-guard 测 |
| AC-F9-1~F9-6 | T9 error-mapping.test.ts + T1 api-roles.test.ts | 待定 | F9-5/F9-6 沿用 R12 |
| AC-F10-1~F10-3 | T1/T2/T3 + T8 | 待定 | F10-3 工程核验 |
| AC-ARCH-1~ARCH-4 | T8 + lint:rules 探针 + Reviewer 逐文件 | 待定 | ARCH-3/ARCH-4 跨 T4/T5/T7 |
| AC-S1-1~S1-2 | T4/T5/T7 | 待定 | R13 S-1 合规 |

**预估测试文件清单**（③类新增，对齐 R12 §9.3 风格）：
1. `apps/web/test/api-roles.test.ts`（T1）—— 角色域 API client 契约（DELETE versioned + If-Match + 409 重试，B5 裸数组解析）
2. `apps/web/test/api-departments.test.ts`（T2）—— 部门域 API client 契约（DELETE 非 versioned 无 If-Match，树递归类型）
3. `apps/web/test/api-audit-logs.test.ts`（T3）—— 审计域 API client 契约（query 拼接 + 脱敏响应类型）
4. `apps/web/test/role-list-page.test.tsx`（T4）—— 角色列表/创建/删除组件测
5. `apps/web/test/dept-tree-page.test.tsx`（T5）—— 部门树/创建/删除/用户分配组件测
6. `apps/web/test/audit-log-page.test.tsx`（T6）—— 审计列表/筛选/脱敏展示组件测
7. `apps/web/test/user-roles-panel.test.tsx`（T7）—— 用户角色分配面板组件测
8. `apps/web/test/navigation.test.tsx`（T8）—— 侧边栏 + 路由守卫扩展测
9. `apps/web/test/error-mapping.test.ts`（T9，扩展 R12 既有文件）—— 角色/部门错误码映射 + SSOT 派生断言

> test-writer 须做 AC 覆盖矩阵自检（R13 S-3）：每条 AC 至少 1 用例覆盖，未覆盖显式列 reason；组合场景（AC-F7-6 筛选+分页、AC-F3-2 重试+刷新）须单独测。

## Q&A 决策（全 BLOCKING，未回答不进入 Spec）

**Q1 · 角色创建 permissions 字段形态？**
BLOCKING（影响 F2 / AC-F2-2 / 表单设计 / R13 S-1 分类）。方案①自由文本输入（逗号分隔权限码）→ 违背 permissionCodeSchema 固定枚举（运行时 safeParse 拒绝未知码，UX 差）；方案②多选 select（选项从 `[...permissionCodeSchema.options]` SSOT 派生，值 ∈ 枚举编译期保证）→ 类型派生操作（R13 S-1，safeParse 冗余）；方案③缺省（permission_codes 不收集，固定空数组）→ 失去创建时授权能力。本期选哪个？推荐②（对齐 createRoleInputSchema.permission_codes 数组 + permissionCodeSchema 固定枚举，SSOT 派生选项不漏枚举，AI-005；值经 TS 类型保证属类型派生操作，safeParse 可省略或保留 defensive；自由文本会运行时拒码 UX 差且违背枚举约束）。**阻塞下游：Tech-Spec §3.2 表单校验分类、impl RoleForm permission_codes 控件、test F2-2 SSOT 派生断言。**

**Q2 · 角色删除 VERSION_CONFLICT 重试策略？**
BLOCKING（影响 F3 / AC-F3-2/F3-3 / versioned DELETE 闭合）。方案①复用 R12 D9 自动重试（用 409 body current_version 重试 1 次，不 GET 单条）；方案②手动提示用户刷新（不重试）；方案③自动重试 N 次。本期选哪个？推荐①（R12 D9 已验证 409 body current_version 重试对 PATCH status 有效，DELETE role 同为 versioned 写操作，重试幂等可接受——DELETE 重复请求第二次若已删则 404，但重试发生在同次冲突未删成功的场景，语义安全；复用 R12 API client 零新增逻辑；手动提示体验差；N 次重试有活锁风险）。**注**：GET /v1/roles/:id 端点虽存在（cacheable），但重试无须 GET（直接用 409 body current_version），对齐 R12 D19 偏离精神。**阻塞下游：Tech-Spec §4 API client 重试复用说明、impl api/roles.deleteRole、test F3-2 重试用例。**

**Q3 · 用户角色分配 UI 形态？**
BLOCKING（影响 F4 / AC-F4-1 / 组件设计 / UserRolesPanel 落点）。方案①独立面板（drawer/modal，从 UserListPage 行操作"角色"触发，展示该用户已分配角色 + 全量角色 toggle 分配/移除）；方案②列表行内 toggle（UserListPage 每行展开角色分配）；方案③弹窗（独立路由 /users/:id/roles）。本期选哪个？推荐①（契约端点为 user-centric：GET /v1/users/:userId/roles 列用户角色、POST/DELETE /v1/users/:userId/roles/:roleId 分配移除，独立面板从 UserListPage 触发是唯一契合端点形状的方案；列表行内 toggle 会让 UserListPage 过载且需并行加载全量角色；独立路由需新增 /users/:id/roles 路由 + 用户详情页，超 R14 范围）。**阻塞下游：Tech-Spec §6 UserRolesPanel 设计、impl UserRolesPanel + UserListPage 行操作、test F4 用例。**

**Q4 · 部门树递归渲染深度限制？**
BLOCKING（影响 F5 / AC-F5-1 / 渲染性能）。方案①无限制（递归渲染 departmentTreeNodeSchema 全部层级，后端已限层级上限 3 经 DEPT_DEPTH_EXCEEDED 强制）；方案②前端限制 N 层（N=3 对齐后端）；方案③折叠展开（默认展开 N 层）。本期选哪个？推荐①（contract departmentTreeNodeSchema 递归无深度约束，后端已限 3 层，前端无须重复限制；树数据量小，递归渲染性能无忧；折叠展开为 UX 增强非 MVP 必须，[advisory] 未来可加）。**阻塞下游：impl DeptTreePage 递归渲染组件、test F5-1 渲染断言。**

**Q5 · 部门创建 parentId 是否必填？**
BLOCKING（影响 F5 / AC-F5-2/F5-3 / 表单设计）。方案①可选（缺省/null = 根部门，对齐 createDepartmentInputSchema parent_id optional nullable）；方案②必填（强制选父部门，无根部门创建路径）；方案③分两个入口（"创建根部门"+"创建子部门"按钮）。本期选哪个？推荐①（对齐 contract optional nullable 语义，单一表单覆盖根/子部门两种场景；必填违背 contract 且无根部门则树为空无法启动；分入口增加 UI 复杂度，MVP 简化）。**阻塞下游：impl DeptForm parent_id 控件、test F5-2/F5-3。**

**Q6 · 审计日志筛选字段范围？**
BLOCKING（影响 F7 / AC-F7-3~F7-7 / 边界）。**contract 核验**（B3）：listAuditLogQuerySchema 支持 page/pageSize/operated_from/operated_to/operator_id/entity_type，**明示不支持 action**。方案①支持 operator_id + entity_type + operated_from/operated_to（对齐 contract 全集，action 不支持）；方案②仅 entity_type + date_range（去 operator_id，因 uuid 输入 UX 差）；方案③全部支持含 action（违背 contract）。本期选哪个？推荐①（对齐 contract SSOT 全集，不擅自加 action 违背契约；operator_id 经用户选择控件缓解 uuid 输入 UX）。**阻塞下游：Tech-Spec §3.1 ListAuditLogQuery 消费、impl AuditLogPage 筛选区、test F7-3~F7-7。**

**Q7 · 审计日志 date_range 输入形态？**
BLOCKING（影响 F7 / AC-F7-5 / 表单设计）。contract 要求 operated_from/operated_to 为 ISO datetime（z.string().datetime()）。方案①datetime-local 原生输入（前端归一为 ISO 8601 with seconds + Z 后传 contract 校验）；方案②自由文本 ISO（用户手输 ISO 字符串，safeParse 校验）；方案③date 日期选择器（仅日期，前端补 T00:00:00Z / T23:59:59Z）。本期选哪个？推荐①（原生 datetime-local UX 最佳，前端归一保证 z.string().datetime() 通过；自由文本 UX 差易输错；date 仅日期精度损失，审计时间范围常需小时级）。**[advisory]**：datetime-local 跨浏览器输出格式差异（如缺秒/时区），impl 须归一为完整 ISO（如 `2026-07-03T12:00:00Z`），归一逻辑属 advisory 实现提示不须同步 Spec §10 但须 Review 报告记录（R13 S-2）。**阻塞下游：impl AuditLogPage date 控件 + ISO 归一、test F7-5。**

**Q8 · 导航形态？**
BLOCKING（影响 F8 / AC-F8-1 / 布局）。方案①侧边栏（管理后台常见，垂直布局可扩展更多入口）；方案②顶部导航（水平布局）；方案③无导航（直接 URL 访问）。本期选哪个？推荐①（R12 仅 UserListPage 单页未需导航，R14 多页（用户/角色/部门/审计）须导航；侧边栏是管理后台常见模式，可扩展；顶部导航水平空间有限；无导航 UX 差且依赖手输 URL）。**阻塞下游：impl Sidebar 组件 + App.tsx 布局、test F8-1。**

**Q9 · 角色详情页是否需要？**
BLOCKING（影响 F1 / 路由设计 / 工作量）。GET /v1/roles/:id（cacheable）端点存在。方案①做详情页（/roles/:id，消费 GET /v1/roles/:id）；方案②仅列表（详情端点不消费，列表行展示足够字段）。本期选哪个？推荐②（MVP，roleSchema 字段少——name/description/permission_codes/is_builtin/parent_role_id，列表行展示足够；详情页增加路由+页面工作量，边际价值低；cacheable 端点保留未来可启用，对齐 R12 不消费 GET /v1/users/:id 的精神）。**阻塞下游：Tech-Spec §7 路由表（无 /roles/:id）、impl 不建 RoleDetailPage、test 无详情用例。**

**Q10 · 角色继承管理是否纳入本轮？**
BLOCKING（影响范围边界 / 工作量）。POST/DELETE /v1/roles/:roleId/parent（versioned）+ GET /v1/roles/:roleId/inheritance-chain 端点存在。方案①纳入（继承管理 UI：设父/解父 + 链展示）；方案②Out of scope（R14 聚焦角色/部门/审计基础 CRUD + 分配）。本期选哪个？推荐②（R14 已含三域扩展，继承管理是独立复杂功能——环检测可视化/链展示/有效权限聚合，单独轮次更专注；端点已就绪未来可启用不破坏契约；纳入会膨胀 R14 范围违背"不可扩张"约束）。**阻塞下游：Out of scope 列出、Tech-Spec 不涉及继承 UI、impl 不建继承管理组件。**

**Q11 · effective-permissions 查看是否纳入本轮？**
BLOCKING（影响范围边界）。GET /v1/users/:userId/effective-permissions 端点存在。方案①纳入（用户有效权限查看 UI）；方案②Out of scope（同 Q10，继承相关，单独轮次）。本期选哪个？推荐②（effective-permissions 在无继承管理时仅显示直接角色权限并集，价值有限；与 Q10 继承管理同轮次更合理；R14 聚焦基础 CRUD + 分配）。**阻塞下游：Out of scope 列出、Tech-Spec 不涉及 effective-permissions UI。**

**Q12 · 前端测试范围？**
BLOCKING（影响验收可测性 / 工作量）。方案①组件测 + API client 契约测，无 E2E（对齐 R12 Q8 决策②）；方案②组件测 + API client 契约测 + E2E（Playwright）；方案③仅组件测。本期选哪个？推荐①（对齐 R12 Q8 决策②，组件测覆盖 UI 交互，API client 契约测覆盖 endpoint 封装 + versioned/重试逻辑，路由守卫测覆盖跳转；E2E 引入 Playwright 重且慢，R12 已决策不引入，R14 沿用；后端 HTTP 层已在 R1-R11 端到端覆盖）。**阻塞下游：test-writer 测试矩阵（9 文件预估）、impl 测试实现。**

**Q13 · 错误码映射扩展？**
BLOCKING（影响 F9 / AC-F9-1~F9-4 / errorMapping 完整性）。**contract 核验**：ROLE_NOT_FOUND/ROLE_NAME_DUPLICATE/ROLE_BUILTIN_FORBIDDEN/ROLE_IN_USE/USER_ROLE_ALREADY_ASSIGNED/DEPT_NOT_FOUND/DEPT_NAME_DUPLICATE/DEPT_HAS_CHILDREN/DEPT_DEPTH_EXCEEDED/AUDIT_LOG_NOT_FOUND 均在 errorCodeSchema 全集内（已核验 user.ts L119-210）。方案①扩展 SPECIFIC_MESSAGES 增加角色/部门相关码中文提示（审计域 AUDIT_LOG_NOT_FOUND 本期不触发，FALLBACK 兜底）；方案②全部 FALLBACK（不单列具体提示）；方案③硬编码全集（违背 SSOT）。本期选哪个？推荐①（角色/部门域码前端实际触发，单列具体提示提升 UX；映射表键仍从 errorCodeSchema SSOT 派生 R12 D11 沿用，新增码自动覆盖不漏；审计域只读无写，AUDIT_LOG_NOT_FOUND 本期不触发，FALLBACK 兜底即可）。**阻塞下游：impl lib/errorMapping.ts 扩展、test F9-1~F9-4。**

## Out of scope

- **角色继承管理 UI**（Q10 决策②）—— POST/DELETE /v1/roles/:roleId/parent + GET /v1/roles/:roleId/inheritance-chain 端点已就绪，继承管理（设父/解父/链展示/环检测可视化）为未来轮次。
- **effective-permissions 查看 UI**（Q11 决策②）—— GET /v1/users/:userId/effective-permissions 端点已就绪，与继承管理同轮次更合理，为未来轮次。
- **角色详情页**（Q9 决策②）—— GET /v1/roles/:id（cacheable）端点保留，本轮仅列表，详情页为未来轮次。
- **审计日志单条详情页** —— GET /v1/audit-logs/:id 端点本期后端未提供（contracts AUDIT_LOG_NOT_FOUND 为预留码），审计仅列表查询。
- **审计日志导出** —— 本轮仅页面展示，导出（CSV/PDF）为未来方向（PII 批量导出风险面，须独立权限码 audit:read_raw，PRD-AUDIT-001 Q2 已决策）。
- **通知页 / 报表页** —— 本轮仅角色/部门/审计三域前端，通知/报表前端为未来轮次（对齐 R12 Out of scope）。
- **角色编辑** —— createRoleInputSchema 创建后 permission_codes 不可改（contract 注释），变更须删除重建，本轮无 PATCH 角色端点。
- **部门编辑** —— departmentSchema 创建后 name/parent_id 不可编辑（contract 注释），变更须删除重建，本轮无 PATCH 部门端点。
- **审计日志 action 筛选** —— contract listAuditLogQuerySchema 明示不支持（B3），为未来契约扩展方向。
- **角色服务端筛选** —— contract listRoleQuerySchema 仅 page/pageSize 无筛选字段（B2），客户端名称搜索仅过滤当前页（advisory），服务端筛选为未来契约扩展。
- **refresh token / 双 token 机制** —— 沿用 R12 Out of scope。
- **SSR / PWA / i18n / 暗色模式 / 骨架屏 / UI 组件库** —— 沿用 R12 Out of scope。
- **E2E 测试（Playwright）** —— 沿用 R12 Q8 决策②，组件测 + API client 契约测无 E2E。
- **后端任何改动** —— 后端已就绪（R1-R11 778 用例 + R12 883 基线），本轮仅前端，contracts 无新增 schema。
- **check-rules.mjs 之外的新规则** —— ARCH-003 已机器化（R12），新增前端文件自动受其约束，本轮不新增规则。
- **CODE 扫描器前端覆盖扩展**（R12 S-4 剩余改进项）—— 本轮不强制扩展 allTs 含 apps/web（ARCH-003 专属分支已覆盖跨层核心），Reviewer 须手动 grep 核对 CODE-001/002/003/AI-005 在新增前端模块的合规性（沿用 R12 S-4 缓解）。
