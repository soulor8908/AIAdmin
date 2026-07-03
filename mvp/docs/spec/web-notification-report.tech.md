---
doc_type: Tech-Spec
id: TECH-WEB-NOTIFICATION-REPORT-001
title: 前端通知管理页 + 报表页（R15 前端全域覆盖收尾）Tech-Spec
prd_ref: PRD-WEB-NOTIFICATION-REPORT-001
status: ready
owner: tech-lead@team
created: 2026-07-03
extends: TECH-WEB-ROLE-DEPT-AUDIT-001
aligns: [TECH-NOTIFICATION-001, TECH-AUDIT-ENHANCEMENT-001]
---

# TECH-WEB-NOTIFICATION-REPORT-001 · 前端通知管理页 + 报表页 Tech-Spec

> 派生自 PRD-WEB-NOTIFICATION-REPORT-001（status=decided，11 个 BLOCKING Q&A 已拍板，54 条 AC，含 BA 核验发现 N1~N6 contracts SSOT 偏离 + AC↔测试覆盖矩阵）。
> **契约层本轮无新增**：packages/contracts 已就绪（通知契约在 R6 落地、报表契约在 R9 落地），前端全部复用既有 Zod schema + z.infer 类型。本 Spec 不改 contracts。
> **后端本轮冻结**：不改 service/repo/domain/router/server.ts（后端 R1-R14 用例基线全绿，PRD 明示"不改后端"）。
> **前端基础设施零新增**：R12 已落地 api/client.ts（Bearer/If-Match/401 拦截/409 重试/wire 适配）、auth/（tokenStore/AuthContext/RouteGuard）、components/ErrorBanner、lib/errorMapping；R14 已扩展角色/部门/审计三域；R15 仅新增 api 模块 + pages + components，零新依赖。**唯一对 R12 既有基础设施的最小后向兼容增强**：扩展 `RequestOptions.query` 类型支持 `string[]`（D8，承接报表 group_by 数组 query 拼接，对齐 server.ts `m.query.getAll` 语义），非新增基础设施。
> 本阶段只产本文档；apps/web 源码改动由 impl-writer 阶段落地（§6/§7 描述为设计 + [advisory] 实现提示）。
> R15 核心验证点：前端全域覆盖收尾（7 域）+ versioned 写操作多端点复用再验证（通知 4 端点）+ 状态机驱动域前端模式（通知 draft→sent→read）+ 聚合只读域 + 动态维度前端模式（报表 group_by 动态列）+ R13 S-1 在状态机/聚合域下落地 + R14 S-8~S-11 教训注意。

## 1. 覆盖范围与既有端点核验（R10 S-2 / R13 S-1 教训闭合）

R10 S-2 教训：Spec 须核验既有路由表，确认前端调用的端点均存在、非覆盖既有路由。本节核验 `apps/api/src/server.ts` routes 数组（L221~L374），R15 涉及端点已由 BA 核验（PRD BA 核验发现 N1~N6）。

### 1.1 前端调用端点清单（逐条核验）

| # | 端点 | method | server.ts 行 | auth | versioned | cacheable | 核验结论 |
|---|------|--------|--------------|------|-----------|-----------|----------|
| E1 | `/v1/notifications` | GET | L347 | admin | false | **true** | 存在，cacheable（后端生成 ETag，前端不发送 If-None-Match，沿用 R12 D15） |
| E2 | `/v1/notifications` | POST | L348 | admin | false | false | 存在，创建通知（body={title,content,recipient_id}） |
| E3 | `/v1/notifications/:id` | PATCH | L354-358 | admin | **true** | false | 存在，versioned=true（须 If-Match header，复用 R12 D7/D9，N3） |
| E4 | `/v1/notifications/:id/send` | POST | L359-363 | admin | **true** | false | 存在，versioned=true（draft→sent，N3） |
| E5 | `/v1/notifications/:id/read` | POST | L364-368 | admin | **true** | false | 存在，versioned=true（sent→read，N3） |
| E6 | `/v1/notifications/:id` | DELETE | L369-373 | admin | **true** | false | 存在，versioned=true（仅 draft，N3） |
| E7 | `/v1/reports/operations` | GET | L338-344 | admin | false | false | 存在，纯读聚合；**group_by 在 query string 多值**（server.ts L341 `m.query.getAll('group_by')`），D8 决策 query 拼接 |

核验结论：**前端调用的 7 个端点全部存在于既有路由表**，本轮不新增任何后端端点。R10 S-2 教训闭合。**通知域 4 个写端点全部 versioned**（E3/E4/E5/E6，server.ts L354/359/364/369 第 5 参 true，N3），须 If-Match + 409 重试复用 R12 D9。

### 1.2 端点存在但本轮不消费（Out of scope 记录）

以下端点存在于 server.ts 路由表，但本轮前端不消费（Q2 决策① modal 编辑对齐 R14 + PRD Out of scope），仅记录以闭合"端点核验"完整性：

| 端点 | method | server.ts 行 | versioned | cacheable | 不消费原因 |
|------|--------|--------------|-----------|-----------|-----------|
| `/v1/notifications/:id` | GET | L349-353 | false | **true** | Q2 决策①：编辑表单 modal 预填用列表项数据（NotificationListPage items 已含完整 Notification），无须 GET 单条；对齐 R14 Q9 决策②不消费 GET /:id 的精神（D18 [advisory]） |

> **注**：GET /v1/notifications/:id（cacheable=true）端点保留，本轮不消费。列表 items 已含完整 Notification（含 title/content/recipient_id/status/sent_at/read_at/version），编辑表单 NotificationForm 预填直接用列表项数据，无须 GET 单条。通知详情页为未来轮次（PRD Out of scope）。

### 1.3 BA 核验发现 N1~N6 偏离在 Spec 的遵循（contracts SSOT 优先）

PRD BA 核验发现 6 处任务描述与 contracts SSOT 偏离，本 Spec 一律以 contracts SSOT 为准：

| # | 偏离措辞 | contracts SSOT 实际 | Spec 遵循点 |
|---|---------|---------------------|-------------|
| N1 | "通知列表 pageSize" | `listNotificationQuerySchema.pageSize` 默认 **10**（与 user/role 域一致），上限 100；与 audit/report 域 pageSize 默认 20 有意分歧 | §3.1 ListNotificationQuery 消费（前端显式传 pageSize=20 抹平缺省 10，D16）+ §6.1 NotificationListPage 默认参数 |
| N2 | "通知编辑（仅 draft 态）" | `updateNotificationInputSchema` 为 partial（空对象合法）；sent/read 态 update 由 service 状态守卫拒绝抛 `NOTIFICATION_INVALID_TRANSITION`（单码覆盖所有状态非法） | §3.2 表单校验（F3 partial safeParse）+ §11 错误码矩阵（INVALID_TRANSITION）+ D10 状态机展示 |
| N3 | "send/markRead/delete 均 versioned" | send/markRead/delete 均 **versioned**（server.ts L359/364/369 第 5 参 true，须 If-Match）；状态非法统一抛 `NOTIFICATION_INVALID_TRANSITION` | §4 API client versioned 复用（D7，4 端点全部 versioned + 409 重试复用 R12 D9）+ §11 错误码矩阵 |
| N4 | "通知 recipient_id 输入" | `createNotificationInputSchema.recipient_id` 仅 uuid 格式校验，存在性/禁用态校验**延后至 send**（契约 Q8 延后校验）；send 时收件人不存在抛 `NOTIFICATION_RECIPIENT_NOT_FOUND`、收件人 disabled 抛 `NOTIFICATION_RECIPIENT_DISABLED` | §3.2 表单校验分类（recipient_id 自由文本 UUID safeParse，D15）+ §6.2 NotificationForm recipient_id 控件 + §11 错误码矩阵 |
| N5 | "报表 group_by 多维选择" | `reportQuerySchema.group_by` 为 `z.array(reportGroupByDimSchema).max(4).optional()`（**不在 schema 层 .min(1) 拒绝空**）；group_by 缺省/空数组由 service 层语义判定 → `REPORT_GROUP_BY_REQUIRED`；operated_from > operated_to → `REPORT_TIME_RANGE_INVALID` | §3.1 ReportQuery 消费 + §6.4 ReportFilter group_by 控件（D13 不预填 + advisory 校验非空）+ §11 错误码矩阵 |
| N6 | "报表聚合结果表格展示" | `reportAggItemSchema = z.record(z.string(), z.union([z.string(), z.number()])).and(z.object({count}))`——维度键随 group_by **动态变化**，无法静态枚举字段名；`reportResultSchema.group_by` 原样回显声明的维度 | §6.5 ReportTable 动态列设计（D11，据 result.group_by 渲染列头 + count 固定列） |

### 1.4 本期覆盖范围（PRD F1~F10 + ARCH-003 + R13 S-1）

- F1 通知列表页 → E1（status 筛选 + 按 status 动态显示操作按钮 Q3/Q11）
- F2 通知创建（自由文本表单）→ E2
- F3 通知编辑（仅 draft 态，PATCH versioned，自由文本 partial）→ E3
- F4 通知发送（POST send，draft→sent，versioned，类型派生操作）→ E4
- F5 通知标记已读（POST read，sent→read，versioned，类型派生操作）→ E5
- F6 通知删除（DELETE，仅 draft，versioned，类型派生操作）→ E6
- F7 报表页（纯读聚合，动态维度）→ E7
- F8 导航扩展 → 侧边栏 6 入口 + 路由守卫复用 R12
- F9 错误处理 → errorMapping 扩展通知/报表码
- F10 前端基础设施复用 + ARCH-003 合规 → 复用 R12/R14，零新增基础设施（D8 query 扩展为最小增强）
- ARCH-003 合规专项 → §8（R12/R13 已机器化，新模块继续受约束）
- R13 S-1 合规专项 → §3.2 区分自由文本表单 vs 类型派生操作

## 2. 前端分层架构（复用 R12/R14 §2 分层 + 新增通知/报表域模块）

### 2.1 目录结构（R15 新增部分以 `+` 标注）

```
apps/web/
├── package.json                 # R12 依赖声明（R15 零新增，§12）
├── tsconfig.json                # R12 配置（R15 无改动）
├── vite.config.ts               # R12 配置（R15 无改动）
├── index.html                   # SPA 入口
└── src/
    ├── main.tsx                 # 应用挂载（R12）
    ├── App.tsx                  # 路由表（§7 新增 2 路由）+ AuthProvider 包裹  # + R15 扩展
    ├── api/
    │   ├── client.ts            # R12 fetch 封装 request<T>（§4 复用；+ R15 D8 扩展 RequestOptions.query 支持 string[]）
    │   ├── auth.ts              # R12 login/logout endpoint
    │   ├── users.ts             # R12 users endpoint
    │   ├── roles.ts             # R14 角色域 endpoint
    │   ├── departments.ts       # R14 部门域 endpoint
    │   ├── audit-logs.ts        # R14 审计域 endpoint
    │   ├── notifications.ts     # + R15 通知域 endpoint（§4.2，4 versioned 写端点）
    │   └── reports.ts           # + R15 报表域 endpoint（§4.2，group_by 数组 query）
    ├── auth/
    │   ├── tokenStore.ts        # R12（leaf，无改动）
    │   ├── AuthContext.tsx      # R12（无改动）
    │   └── RouteGuard.tsx       # R12（白名单仍仅 /login，新路由自动受守卫覆盖）
    ├── pages/
    │   ├── LoginPage.tsx        # R12
    │   ├── UserListPage.tsx     # R12
    │   ├── RoleListPage.tsx     # R14
    │   ├── DeptTreePage.tsx     # R14
    │   ├── AuditLogPage.tsx     # R14
    │   ├── NotificationListPage.tsx  # + R15 通知列表/创建/编辑/发送/标记已读/删除
    │   └── ReportPage.tsx       # + R15 报表筛选 + 聚合表格
    ├── components/
    │   ├── ErrorBanner.tsx      # R12（无改动）
    │   ├── UserRow.tsx          # R12
    │   ├── CreateUserModal.tsx  # R12
    │   ├── Sidebar.tsx          # R14 侧边栏导航（+ R15 扩展 6 入口）  # + R15 扩展
    │   ├── RoleForm.tsx         # R14
    │   ├── UserRolesPanel.tsx   # R14
    │   ├── DeptForm.tsx         # R14
    │   ├── DeptNode.tsx         # R14
    │   ├── NotificationForm.tsx # + R15 通知创建/编辑表单（自由文本 + safeParse）
    │   ├── ReportFilter.tsx     # + R15 报表筛选（group_by checkbox + 时间范围 + 应用筛选按钮）
    │   └── ReportTable.tsx      # + R15 报表聚合表格（动态列）
    └── lib/
        └── errorMapping.ts      # R12/R14（+ R15 扩展 SPECIFIC_MESSAGES 通知/报表码 + 同步注释）  # + R15 扩展
```

### 2.2 各层职责与依赖方向（沿用 R12 §2.2 / R14 §2.2）

R15 新增模块遵循 R12/R14 既定分层与依赖方向，不引入新依赖层级：

| 新增模块 | 层 | 职责 | 允许依赖 | 禁止依赖 |
|----------|----|------|----------|----------|
| `api/notifications.ts`、`api/reports.ts` | api 层 | endpoint 封装（拼 path/query/body 调 client） | api/client、@admin/contracts | pages/、components/、apps/api/src/** |
| `pages/NotificationListPage.tsx`、`pages/ReportPage.tsx` | pages 层 | 页面组件（状态 + 交互） | api/notifications、api/reports、auth/AuthContext、components/、@admin/contracts、lib/errorMapping | 直连 fetch（须经 api/client） |
| `components/NotificationForm.tsx`、`components/ReportFilter.tsx`、`components/ReportTable.tsx` | components 层 | 复用组件 | @admin/contracts、lib/、api/（仅 NotificationForm 提交时经 props 注入 api 函数，不直接 import api） | pages/ |

**依赖方向单向**（沿用 R12/R14）：`pages/components → api → {client → tokenStore/lib}`；`pages → auth/AuthContext → api/auth → client`。`tokenStore` 与 `lib/` 为叶子层。R15 新增模块不破坏既有依赖图。

### 2.3 ARCH-003 在新模块的体现

ARCH-003「跨层只经契约」对 R15 新增模块的约束（沿用 R12 D2 / R14 D2）：

- `apps/web/src` 全部新增模块（api/notifications.ts、api/reports.ts、pages/NotificationListPage.tsx、pages/ReportPage.tsx、components/NotificationForm.tsx、components/ReportFilter.tsx、components/ReportTable.tsx）+ 扩展文件（components/Sidebar.tsx、App.tsx、api/client.ts、lib/errorMapping.ts）只能 import `@admin/contracts`（类型 + Zod schema）+ 第三方依赖（react/react-router-dom）+ apps/web/src 内部模块。
- **禁止 import `apps/api/src/**`**（repository/service/domain/router/server）与 `@admin/api` 包。
- 后端能力只能经 HTTP（api/client → router 端点）调用，类型只能经 contracts 派生。
- 机器化校验见 §8（R12 已落地 ARCH-003 分支 + R13 S-4 已让 CODE 扫描器覆盖前端，R15 无新增校验逻辑）。

## 3. 数据契约消费（R13 S-1 固化：类型派生 + schema 复用 + 自由文本/类型派生区分）

### 3.1 从 @admin/contracts 派生的类型清单

> 全部类型经 `z.infer` 派生，**禁止手写 TS 类型副本**（R12 D3 [约束]，ARCH-002/CODE-004 延伸）。

**通知域类型**（源自 `packages/contracts/src/schemas/notification.ts`）：

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `Notification` | `z.infer<typeof notificationSchema>` | 通知实体 `{id, title, content, recipient_id, status, created_at, updated_at, sent_at, read_at, version}`（.strict()，SEC-003a；字段均非 PII，contracts 注释明示 title/content 为业务文本、recipient_id 为 uuid 引用） |
| `NotificationStatus` | `z.infer<typeof notificationStatusSchema>` | 状态枚举 `'draft' \| 'sent' \| 'read'`，status 筛选 select options + 状态文案中文化 + 操作按钮按 status 动态显示的派生源（D10） |
| `CreateNotificationInput` | `z.infer<typeof createNotificationInputSchema>` | 创建表单提交体 `{title(1..128), content(1..4000), recipient_id(uuid)}`，.strict() 拒绝多余字段 |
| `UpdateNotificationInput` | `z.infer<typeof updateNotificationInputSchema>` | 编辑表单提交体 `{title?, content?, recipient_id?}`，partial（空对象合法），.strict()（N2） |
| `ListNotificationQuery` | `z.infer<typeof listNotificationQuerySchema>` | `{page(默认1), pageSize(默认**10** max100, N1), status?}`——**前端显式传 pageSize=20 抹平缺省 10**（Q1 决策②，D16） |
| `NotificationListResult` | `z.infer<typeof notificationListResultSchema>` | `{items: Notification[], total, page, pageSize, totalPages}` |

**报表域类型**（源自 `packages/contracts/src/schemas/report.ts`，复用 `audit.ts` 枚举）：

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `ReportQuery` | `z.infer<typeof reportQuerySchema>` | 查询入参 `{group_by?(array[1..4] of ReportGroupByDim 去重), operated_from?, operated_to?, operator_id?, entity_type?, action?, page(默认1), pageSize(默认20 max100 transform)}`——group_by 缺省/空由 service 层 → REPORT_GROUP_BY_REQUIRED（schema 不在层拒绝空，N5） |
| `ReportGroupByDim` | `z.infer<typeof reportGroupByDimSchema>` | 维度枚举 `'operator_id' \| 'entity_type' \| 'action' \| 'date'`，group_by checkbox options 派生源（4 项，Q5 决策①） |
| `ReportAggItem` | `z.infer<typeof reportAggItemSchema>` | 聚合行 `Record<string, string\|number> & {count: number}`——**维度键随 group_by 动态变化**（如 group_by=['operator_id','date'] 则 item 含 `operator_id`/`date`/`count` 键），无法静态枚举字段名（N6） |
| `ReportResult` | `z.infer<typeof reportResultSchema>` | `{items: ReportAggItem[], total, page, pageSize, totalPages, group_by: ReportGroupByDim[]}`——`group_by` 原样回显声明的维度，ReportTable 据此渲染列头（D11） |
| `AuditLogEntityType` | `z.infer<typeof auditLogEntityTypeSchema>` | 实体类型枚举 `'user' \| 'role' \| 'dept' \| 'notification' \| 'auth'`（5 项），报表 entity_type select options 派生源（report 复用 audit 枚举） |
| `AuditLogAction` | `z.infer<typeof auditLogActionSchema>` | 动作枚举 `'create' \| 'update' \| 'delete' \| 'login' \| 'login_failed' \| 'logout'`（6 项），报表 action select options 派生源（report 复用 audit 枚举） |

**共享类型**（源自 `packages/contracts/src/schemas/user.ts`，R12/R14 已消费，R15 复用）：

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `ErrorCode` | `z.infer<typeof errorCodeSchema>` | 全局错误码 SSOT（含 NOTIFICATION_*/REPORT_* 等），errorMapping 键派生源 |
| `ErrorResponse` | `z.infer<typeof errorResponseSchema>` | `{code, message, current_version?}`，API client 适配后对外暴露（R12 D10 wire 适配沿用） |

**禁用类型**（[约束] R12 D3 / R14 D3 沿用）：

- 通知/报表域**无存储态/输出态区分**（notificationSchema 即输出态，无 notificationEntitySchema；reportAggItemSchema/reportResultSchema 即输出态）——前端无禁用类型需特别声明（区别于审计域禁用 auditLogSchema）。
- 沿用 R12 D3：前端禁止 import `userEntitySchema`/`UserEntity`（含 password_hash）、`tokenPayloadSchema`/`TokenPayload`（验签内部）。
- 沿用 R14 D3：前端禁止 import `auditLogSchema`/`AuditLog`（存储态含未脱敏 PII）、`piiFieldRegistrySchema`/`PiiFieldRegistry`（后端脱敏 registry）——R15 报表域复用 `auditLogEntityTypeSchema`/`auditLogActionSchema` 枚举（仅枚举值，非存储态 schema），不禁用。

### 3.2 客户端表单校验 schema 复用清单（R13 S-1 固化：区分两类）

> R13 S-1 固化：表单校验须区分「自由文本表单」（须 safeParse，因有自由输入）与「类型派生操作」（TS 类型保证，schema 校验冗余，可不调或保留 defensive safeParse）。AC 措辞须精确限定为"自由文本输入表单"。

#### 3.2-A 自由文本表单（须 safeParse，[约束] D4）

| 功能点 | 复用 schema | 校验点 | AC |
|--------|-------------|--------|----|
| F2 通知创建 title/content/recipient_id | `createNotificationInputSchema.safeParse` | title 1..128 + content 1..4000 + recipient_id uuid + 拒绝多余字段（.strict()） | AC-F2-2/3/4/5 |
| F3 通知编辑 title?/content?/recipient_id? | `updateNotificationInputSchema.safeParse` | partial（空对象合法）+ 字段约束同 create + 拒绝多余字段（.strict()，N2） | AC-F3-5 |
| F7 报表 operated_from/operated_to datetime-local | 前端归一为 ISO datetime 后客户端校验 `from <= to`（advisory，后端兜底 REPORT_TIME_RANGE_INVALID） | from > to 客户端拦截 + 服务端兜底 | AC-F7-7 |
| F7 报表 operator_id uuid 文本输入 | 前端客户端校验 uuid 格式（advisory，可空，空表示不筛） | uuid 格式客户端拦截（advisory） | AC-F7-3 |

**判定依据**：title/content/recipient_id 为用户自由文本输入（长度/格式不可由 TS 类型保证），须运行时 safeParse 拦截非法输入，未调 safeParse 判 partial（R13 S-1）。报表 operated_from/operated_to/operator_id 含自由输入，前端客户端校验为 advisory（后端兜底），不强制 safeParse reportQuerySchema（reportQuerySchema 非 strict 且含 superRefine，前端表单按字段分别校验即可，对齐 R14 审计页 advisory 校验精神）。

#### 3.2-B 类型派生操作（TS 类型保证，safeParse 冗余，[约束] D5）

| 功能点 | 值来源 | TS 类型保证 | safeParse 处理 | AC |
|--------|--------|-------------|---------------|----|
| F4 通知发送按钮 | id/version 从列表派生（Notification.id/version） | id 为 uuid 字面量、version 为 number 字面量 | 不调 safeParse（schema 校验冗余） | AC-F4-1 |
| F5 通知标记已读按钮 | id/version 从列表派生 | 同上 | 不调 safeParse | AC-F5-1 |
| F6 通知删除按钮 | id/version 从列表派生 | 同上 | 不调 safeParse | AC-F6-1 |
| F7 报表 group_by 多选 checkbox | 选项从 `[...reportGroupByDimSchema.options]` SSOT 派生（4 项） | 值 ∈ 枚举编译期保证（checkbox options 限定） | 不调 safeParse（checkbox 值经 options 派生保证合法） | AC-F7-1 |
| F7 报表 entity_type select | 选项从 `[...auditLogEntityTypeSchema.options]` SSOT 派生（5 项） | 值 ∈ 枚举编译期保证 | 不调 safeParse | AC-F7-4 |
| F7 报表 action select | 选项从 `[...auditLogActionSchema.options]` SSOT 派生（6 项） | 值 ∈ 枚举编译期保证 | 不调 safeParse | AC-F7-4 |

**判定依据**：通知 send/markRead/delete 为类型派生操作（id/version 经 TS 类型派生自 Notification 列表项），不调 safeParse；若 impl 不调须显式标注 [约束] 偏离 + 反向同步 Spec §3.2（R13 S-1）。报表 group_by checkbox / entity_type/action select 同理（值经 SSOT options 派生编译期保证合法）。

> **混合表单提示**：NotificationForm 创建模式同时含自由文本（title/content/recipient_id，须 safeParse）；编辑模式 partial 自由文本（须 safeParse，空对象合法）。ReportFilter 同时含自由文本（operated_from/to/operator_id advisory）与类型派生（group_by checkbox/entity_type/action select，safeParse 冗余）。impl-writer 须对 NotificationForm 整体表单调 `createNotificationInputSchema.safeParse` / `updateNotificationInputSchema.safeParse`（覆盖自由文本字段校验），类型派生字段值经 options 派生保证合法（safeParse 不会在此字段失败）。ReportFilter 不整体 safeParse reportQuerySchema（非 strict + superRefine），按字段分别 advisory 校验。

### 3.3 PII / 敏感字段清单（安全域标注，沿用 PRD §PII 清单）

| 字段 | 来源 | 敏感等级 | 前端处理 |
|------|------|----------|----------|
| 通知 `title`/`content` | 通知域 | 低（业务文本，**非 PII**，contracts 注释明示） | 展示/输入用，无特殊处理 |
| 通知 `recipient_id` | 通知域 | 低（uuid 引用，**非 PII**，contracts 注释明示） | 展示/输入用，无特殊处理 |
| 通知 `id`/`status`/时间戳/`version` | 通知域 | 低（标识/状态/时间） | 展示用 |
| 报表聚合 `count`/维度值 | 报表域 | 低（纯计数 + 维度值，**非 PII**，contracts 注释明示"report 聚合维度均为非 PII 字段，仅返回计数"） | 展示用 |
| 报表 `operator_id`（group_by 维度值） | 报表域 | 中（uuid，关联用户，**非 PII 但关联标识**） | 展示用，禁止 console.log / 日志记录（沿用 R14 审计 operator_id 处理） |
| `token` | R12 沿用 | 高 | 沿用 R12 D12（localStorage，禁止 console.log） |

> 通知/报表域**无 PII 字段**（contracts 明示 title/content 为业务文本、recipient_id 为 uuid 引用、report 纯计数）。R15 不引入新的 PII 处理面，SEC-003b 不延伸（无脱敏态/存储态区分，通知/报表均无 PII 字段需脱敏）。通知/报表域须确认 `notification:read`/`notification:write`/`report:read` 权限由后端 SEC-002 强制（前端不预判权限，依赖后端 FORBIDDEN 返回时显示"无权限"）。

## 4. API client 设计（R15 复用 R12 §4 + D8 query 类型扩展）

### 4.1 复用 R12 api/client.ts + D8 query 类型扩展

R15 **零新增 API client 基础设施**，全部复用 R12 `apps/web/src/api/client.ts` 的 `request<T>(method, path, opts)` 函数（R12 §4 已实现）：

- **Bearer token 注入**（R12 D6）：除 `skipAuth=true`（login）外，所有请求从 tokenStore 读 token 注入 `Authorization: Bearer <token>`。R15 新增 api 模块全部需要鉴权（admin 路由），无须 skipAuth。
- **If-Match 注入**（R12 D7）：`opts.versioned === true` 且 `opts.expectedVersion !== undefined` 时注入 `If-Match: <expectedVersion>`。R15 通知域 4 个 versioned 写端点（PATCH update / POST send / POST read / DELETE）须 versioned=true（D7）。
- **401 拦截**（R12 D8）：401 响应经 wire 适配取 code，鉴权类 4 码（UNAUTHORIZED/TOKEN_INVALID/TOKEN_EXPIRED/TOKEN_REVOKED）清 token + 跳 /login；INVALID_CREDENTIALS 原样抛。R15 新增请求自动受此拦截覆盖。
- **409 重试**（R12 D9）：VERSION_CONFLICT + current_version + 未重试过 → 用 current_version 重试 1 次。R15 通知域 4 个 versioned 写端点复用此重试（D7）。
- **wire 适配 error→code**（R12 D10）：读 wire `error` 字段 → errorCodeSchema 校验 → 映射为 contracts `code`。R15 新增通知/报表域错误码（NOTIFICATION_*/REPORT_*）自动经此适配覆盖。
- **网络错误兜底**：fetch 抛 → ApiError code='NETWORK_ERROR'。R15 沿用。

**D8 [约束] 报表 group_by 数组 query 拼接 —— 扩展 RequestOptions.query 支持 string[]**：

R12 client.ts 当前 `RequestOptions.query` 类型为 `Record<string, string | number | undefined>`，`buildUrl` 用 `params.append(key, String(value))`，**不支持 string[] 数组值**。报表 group_by 为数组，wire 须以 repeated key 拼接（`?group_by=operator_id&group_by=date`，server.ts L341 `m.query.getAll('group_by')`）。

**决策**：扩展 `RequestOptions.query` 类型支持 `string[]`（PRD 推荐方案①）。这是对 R12 client.ts 的**最小后向兼容增强**（非新增基础设施）：

```ts
// R15 扩展（D8）：query 值类型新增 string[]
export type RequestOptions = {
  body?: unknown;
  query?: Record<string, string | number | string[] | undefined>;  // + string[]
  versioned?: boolean;
  expectedVersion?: number;
  skipAuth?: boolean;
};
```

`buildUrl` 增强逻辑（对数组值多次 append，对齐 URLSearchParams 自然支持 repeated key）：

```ts
function buildUrl(path: string, query?: Record<string, string | number | string[] | undefined>): string {
  if (!query) return BASE_URL + path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      // 数组值：每个元素 append 为 repeated key（对齐 server.ts m.query.getAll）
      for (const v of value) params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${BASE_URL}${path}?${qs}` : `${BASE_URL}${path}`;
}
```

**后向兼容性**：string/number/undefined 行为不变（既有 R12/R14 api 模块调用不受影响），string[] 是新增能力。零新依赖（URLSearchParams.append 原生支持 repeated key）。对齐 server.ts L341 `m.query.getAll('group_by')` 语义。

**①类显式影响**（§9.1）：D8 扩展 client.ts 的 query 类型属 R12 既有文件改动。R12 api-client.test.ts 既有断言（`query: { page: 1 }`，line 217）类型仍合法（number 仍支持），既有断言**不失效**；但须新增 array query 测试用例（在 R15 新增 `api-reports.test.ts` 中覆盖 group_by repeated key 拼接，AC-F7-1/F7-2）。

> **方案②对照**（不采用）：api/reports.ts 内部手动拼接 group_by query string 后传入 path（绕过 client buildUrl）。缺点：绕过 client 统一 query 处理、与 R12 buildUrl 风格不一致、未来其他域若需数组 query 须重复手动拼接。方案①扩展 query 类型是通用增强，对齐 server.ts getAll 语义，零新依赖，故采用①。

### 4.2 新增 api 模块设计（对齐 R12 api/users.ts / R14 api/roles.ts 风格，R14 S-8 命名须对齐 Spec §4.2 声明）

#### 4.2.1 `apps/web/src/api/notifications.ts`

```ts
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client），禁止 import apps/api/src/**。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D7：update/send/markRead/delete 须 versioned=true + expectedVersion → client 注入 If-Match（4 versioned 端点，N3）。
// [约束] D9：409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条）。
// [约束] D16：listNotifications 调用方显式传 pageSize=20（抹平契约缺省 10，N1）。
// [约束] D20（R14 S-8）：函数命名对齐本 Spec §4.2.1 声明。
// [约束] R13 S-1：本文件为类型派生操作（input/output 类型经 z.infer 派生），不调 safeParse。
//                调用方（自由文本表单）负责 safeParse 校验后再传入。
import type {
  CreateNotificationInput,
  ListNotificationQuery,
  Notification,
  NotificationListResult,
  UpdateNotificationInput,
} from '@admin/contracts';
import { request } from './client.js';

/** GET /v1/notifications —— 通知列表（分页 + status 筛选）。调用方显式传 pageSize=20（D16，抹平契约缺省 10，N1）。 */
export function listNotifications(query: ListNotificationQuery): Promise<NotificationListResult> {
  return request<NotificationListResult>('GET', '/v1/notifications', { query });
}

/** POST /v1/notifications —— 创建通知（body={title, content, recipient_id}）。 */
export function createNotification(input: CreateNotificationInput): Promise<Notification> {
  return request<Notification>('POST', '/v1/notifications', { body: input });
}

/**
 * PATCH /v1/notifications/:id —— 编辑通知（仅 draft 态，versioned=true，If-Match=expectedVersion，N3）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9，用 409 body current_version，不 GET 单条）。
 * sent/read 态编辑由后端状态守卫拒绝抛 NOTIFICATION_INVALID_TRANSITION（N2，不重试，仅 VERSION_CONFLICT 重试）。
 */
export function updateNotification(
  id: string,
  input: UpdateNotificationInput,
  expectedVersion: number,
): Promise<Notification> {
  return request<Notification>('PATCH', `/v1/notifications/${id}`, {
    body: input,
    versioned: true,
    expectedVersion,
  });
}

/**
 * POST /v1/notifications/:id/send —— 发送通知（draft→sent，versioned=true，If-Match，N3）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9）。
 * send 时收件人不存在抛 NOTIFICATION_RECIPIENT_NOT_FOUND、收件人 disabled 抛 NOTIFICATION_RECIPIENT_DISABLED（N4 延后校验）。
 */
export function sendNotification(id: string, expectedVersion: number): Promise<Notification> {
  return request<Notification>('POST', `/v1/notifications/${id}/send`, {
    versioned: true,
    expectedVersion,
  });
}

/**
 * POST /v1/notifications/:id/read —— 标记已读（sent→read，versioned=true，If-Match，N3）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9）。
 * draft 态拒绝 / read 态拒绝重复标记抛 NOTIFICATION_INVALID_TRANSITION（N3，不重试）。
 */
export function markNotificationRead(id: string, expectedVersion: number): Promise<Notification> {
  return request<Notification>('POST', `/v1/notifications/${id}/read`, {
    versioned: true,
    expectedVersion,
  });
}

/**
 * DELETE /v1/notifications/:id —— 删除通知（仅 draft，versioned=true，If-Match，N3）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9，DELETE 重试幂等——409 表示未删除，重试语义安全）。
 * sent/read 态拒绝抛 NOTIFICATION_INVALID_TRANSITION（N3，append-only 不可删，不重试）。
 */
export function deleteNotification(id: string, expectedVersion: number): Promise<void> {
  return request<void>('DELETE', `/v1/notifications/${id}`, {
    versioned: true,
    expectedVersion,
  });
}
```

> **注**：GET /v1/notifications/:id（cacheable）端点存在但本轮不消费（列表 items 已含完整 Notification，编辑表单预填用列表项数据，对齐 R14 Q9 决策②不消费 GET /:id 的精神，D18 [advisory]）。

#### 4.2.2 `apps/web/src/api/reports.ts`

```ts
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client）。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D8：group_by 为数组，经扩展后的 RequestOptions.query（支持 string[]）拼接为 repeated key（?group_by=A&group_by=B）。
// [约束] D20（R14 S-8）：函数命名对齐本 Spec §4.2.2 声明。
// [约束] R13 S-1：本文件为类型派生操作（query/output 类型经 z.infer 派生），不调 safeParse。
import type { ReportQuery, ReportResult } from '@admin/contracts';
import { request } from './client.js';

/**
 * GET /v1/reports/operations —— 操作统计报表（纯读聚合）。
 * group_by 数组经 D8 扩展后的 query 拼接为 repeated key（?group_by=operator_id&group_by=date）。
 * 调用方传 pageSize=20（reportQuerySchema default=20，沿用 R14 D21）。
 */
export function queryOperations(query: ReportQuery): Promise<ReportResult> {
  return request<ReportResult>('GET', '/v1/reports/operations', { query });
}
```

### 4.3 列表 pageSize 默认 20（沿用 R12 D14 / R14 D21）

- **通知列表**（D16 [约束]）：`listNotificationQuerySchema.pageSize` 默认 **10**（N1，与 user/role 域一致），前端显式传 `pageSize=20` 抹平缺省 10（Q1 决策②，对齐 R12 D14 / R14 D21 不依赖契约缺省）。schema max(100) 仍约束上限。
- **报表查询**：`reportQuerySchema.pageSize` 默认 20（与 audit 域一致），前端沿用契约缺省 20 即可（亦可显式传 20 对齐风格，R14 D21 沿用）。schema transform 钳制 100 仍约束上限。

## 5. 状态管理（R15 复用 R12/R14 AuthContext/RouteGuard + 新增页面本地 state）

### 5.1 AuthContext + token 存储（复用 R12 D12，无改动）

R15 复用 R12 `auth/tokenStore.ts`（localStorage key=`admin_token`）+ `auth/AuthContext.tsx`（登录态 Context + login/logout action）。新增页面无须扩展 AuthContext——登录态全局共享，新页面经 `useAuth()` 读取。

### 5.2 路由守卫（复用 R12 D13，白名单仍仅 /login）

R15 复用 R12 `auth/RouteGuard.tsx`：`!isAuthenticated && path !== '/login'` → `<Navigate to="/login" />`。**白名单仍仅 `/login`**（R12 D13），新增 /notifications /reports 自动受守卫覆盖（无须改守卫逻辑，AC-F8-3）。已登录访问 /login 跳 /users（R12 AC-F1-7）沿用。

### 5.3 新增页面本地 state（对齐 R12/R14 风格，无全局状态库）

R15 新增两个页面用 `useState` 管理本地状态，无 Redux/Zustand（R12 D5 零新依赖沿用）：

- **NotificationListPage**：`{ items: Notification[], total, page, totalPages, pageSize: 20, status?: NotificationStatus, loading, error, showFormModal, editingNotification: Notification | null }`。翻页/status 筛选改 state → useEffect 触发 `listNotifications`。操作（发送/标记已读/删除）成功后刷新列表取最新 version（避免下次冲突）。
- **ReportPage**：`{ result: ReportResult | null, loading, error, filters: { group_by: ReportGroupByDim[], operated_from?, operated_to?, operator_id?, entity_type?, action? }, page }`。**"应用筛选"按钮触发请求**（D12，R14 S-9 教训，不每键入触发）。
- **NotificationForm**：`{ mode: 'create' | 'edit', initial: Notification | null, form: { title, content, recipient_id }, errors: Record<string, string>, submitting }`。
- **ReportFilter**：`{ group_by: ReportGroupByDim[], operated_from, operated_to, operator_id, entity_type, action }`（受控表单，"应用筛选"按钮 onSubmit 回调父组件触发请求）。

**通知状态机前端展示策略**（D10 [约束]，Q3/Q11 决策②）：
- status 文案中文化：`draft`→"草稿"、`sent`→"已发送"、`read`→"已读"（纯 UI 文案，R13 S-2 不须同步 Spec §10 但须 Review 报告记录）。
- 操作按钮按 status 动态显示（Q3 决策①隐藏不可用，非全显示禁用）：
  - `draft`：显示"编辑"/"发送"/"删除"按钮（draft 可编辑/可发送/可删除）
  - `sent`：显示"标记已读"按钮（sent 仅可 markRead，append-only 不可改不可删）
  - `read`：无操作按钮（read 为终态，append-only）
- 状态守卫拒绝统一抛 `NOTIFICATION_INVALID_TRANSITION`（B6 单码覆盖所有状态非法，N2/N3），前端 errorMapping 映射为"通知状态不允许此操作"。
- 前端按钮隐藏 + 后端状态守卫双保险：前端按 status 隐藏不可用按钮避免误操作；若绕过前端直接调 API（如对 sent 通知调 DELETE），后端返回 NOTIFICATION_INVALID_TRANSITION，前端 errorMapping 显示"通知状态不允许此操作"（AC-F3-2/F4-2/F5-2/F5-3/F6-2）。

## 6. 页面与组件设计（[advisory] 实现提示，impl-writer 落地）

> 本节为页面/组件行为契约，impl-writer 据此实现。样式用 CSS Modules / 内联样式（零 UI 框架，R12 F5 沿用）。aria-label 须域特定（D21，R14 S-10 教训）。

### 6.1 NotificationListPage（F1/F3/F4/F5/F6，列表 + 状态机操作）

- 首次加载：`listNotifications({ page: 1, pageSize: 20 })`（D16，AC-F1-1）。
- 渲染：每行展示 title/recipient_id/status 文案中文化（D10）+ 按 status 动态显示操作按钮（D10，AC-F1-7）+ version 隐藏用于 If-Match。
  - `draft` 行：显示"草稿" + "编辑"/"发送"/"删除"按钮
  - `sent` 行：显示"已发送" + "标记已读"按钮（无编辑/发送/删除）
  - `read` 行：显示"已读" + 无操作按钮（Q3 决策①隐藏不可用）
- 分页：页码按钮 → 改 page state → 重新 list（AC-F1-2）。
- status 筛选：select status → 改 status state → page 重置 1 → list（AC-F1-3）；status 选项从 `[...notificationStatusSchema.options]` SSOT 派生（3 项，AC-F1-3）。
- 筛选+分页复合：翻页保持筛选条件（AC-F1-4，R13 S-3 组合场景）。
- 空状态：items=[] 显示"暂无通知"（AC-F1-5）。
- 加载态：列表区域 loading 文案（AC-F1-6，R12 D16）。
- 创建通知按钮 → 打开 `<NotificationForm mode="create">`。
- 编辑按钮（draft 行）→ 打开 `<NotificationForm mode="edit" initial={notification}>`（预填用列表项数据，无须 GET 单条，D18）。
- 发送按钮（draft 行）：调 `sendNotification(id, notification.version)`（versioned=true，D7）。
  - 成功：刷新列表（AC-F4-1）。
  - NOTIFICATION_INVALID_TRANSITION：显示"通知状态不允许此操作"（AC-F4-2，sent/read 态拒绝）。
  - VERSION_CONFLICT：API client 自动重试（D7/R12 D9），重试成功刷新列表（AC-F4-3）；重试仍冲突显示"数据已被修改，请刷新后重试"。
  - NOTIFICATION_RECIPIENT_NOT_FOUND：显示"收件人不存在"（AC-F4-4，N4 send 时延后校验）。
  - NOTIFICATION_RECIPIENT_DISABLED：显示"收件人已禁用"（AC-F4-5，N4）。
- 标记已读按钮（sent 行）：调 `markNotificationRead(id, notification.version)`（versioned=true，D7）。
  - 成功：刷新列表（AC-F5-1）。
  - NOTIFICATION_INVALID_TRANSITION：显示"通知状态不允许此操作"（AC-F5-2 draft 态拒绝 / AC-F5-3 read 态拒绝重复标记）。
  - VERSION_CONFLICT：API client 自动重试（AC-F5-4）。
- 删除按钮（draft 行）：调 `deleteNotification(id, notification.version)`（versioned=true，D7）。
  - 成功：刷新列表（AC-F6-1）。
  - NOTIFICATION_INVALID_TRANSITION：显示"通知状态不允许此操作"（AC-F6-2，sent/read append-only 不可删）。
  - VERSION_CONFLICT：API client 自动重试（AC-F6-3，DELETE 重试幂等）。
  - NOTIFICATION_NOT_FOUND：显示"通知不存在"，列表刷新（AC-F6-4）。

### 6.2 NotificationForm（F2/F3，自由文本表单 + safeParse，Q2 决策① modal）

- 形态：modal（Q2 决策①，对齐 R14 RoleForm/DeptForm + R12 CreateUserModal 风格），从 NotificationListPage 行操作触发。
- 表单字段：title（input type=text，aria-label="通知标题"）、content（textarea，aria-label="通知内容"）、recipient_id（input type=text，aria-label="收件人 ID"，D15 自由文本 UUID 输入）。
- **创建模式**（mode='create'）：
  - 提交：`createNotificationInputSchema.safeParse(form)` → 失败显示字段级错误（AC-F2-2/3/4/5，不发请求）→ 成功调 `createNotification`。
    - title 空 → safeParse 拦截（min(1)），显示"通知标题必填"（AC-F2-2）。
    - title > 128 → safeParse 拦截（max(128)），显示"通知标题不超过 128 字符"（AC-F2-3）。
    - content 空/超长 → safeParse 拦截（min(1).max(4000)），显示"通知内容必填"/"通知内容不超过 4000 字符"（AC-F2-4）。
    - recipient_id 非 uuid → safeParse 拦截（z.string().uuid()），显示"收件人 ID 须为 UUID 格式"（AC-F2-5）。
  - 成功：关闭弹窗 + 列表刷新含新通知（status='draft', version=0, sent_at=null, read_at=null，AC-F2-1）。
  - **create 仅 recipient_id uuid 格式校验**（N4 延后校验）：recipient_id 为合法 uuid 但实际不存在 → **创建成功**（status='draft'），不触发 NOTIFICATION_RECIPIENT_NOT_FOUND（存在性延后至 send，AC-F2-6）。
- **编辑模式**（mode='edit'，仅 draft 态）：预填用列表项数据（initial notification，无须 GET 单条）。
  - 提交：`updateNotificationInputSchema.safeParse(form)` → 失败显示字段级错误（AC-F3-5）→ 成功调 `updateNotification(id, input, notification.version)`（versioned=true，D7）。
    - 空对象提交 → safeParse 通过（partial 空对象合法，N2），调 PATCH（body={}），后端接受返回原 Notification（version+1，AC-F3-5）。
    - 含非法字段（如 status）→ safeParse 拒绝多余字段（.strict()，AC-F3-5）。
  - 成功：关闭弹窗 + 列表刷新（AC-F3-1）。
  - sent/read 态编辑：前端按 status 隐藏编辑按钮（AC-F1-7）；若绕过直接调 PATCH → 后端返回 NOTIFICATION_INVALID_TRANSITION，显示"通知状态不允许此操作"（AC-F3-2）。
  - VERSION_CONFLICT：API client 自动重试（AC-F3-3）；重试仍冲突显示"数据已被修改，请刷新后重试"（AC-F3-4）。
- 提交中按钮禁用 + loading（R12 D16）。

### 6.3 ReportPage（F7，报表筛选 + 聚合表格）

- 首次加载：不自动请求（group_by 缺省/空 → REPORT_GROUP_BY_REQUIRED，D13 不预填默认维度）。页面初始展示筛选区 + 空表格 + 提示"请选择分组维度后应用筛选"。
- 渲染：`<ReportFilter>` 筛选区 + `<ReportTable>` 聚合表格区。
- **"应用筛选"按钮**（D12 [约束]，R14 S-9 教训）：ReportFilter 的"应用筛选"按钮触发请求（不每键入触发——datetime-local 切换 + operator_id 文本输入均经"应用筛选"按钮原子提交，无须 debounce）。
  - 客户端 advisory 校验（D13/D14）：group_by 至少 1 维（否则显示"请至少选择一个分组维度"不发请求，AC-F7-6）；operated_from <= operated_to（否则显示"开始时间不能晚于结束时间"不发请求，AC-F7-7）。
  - 校验通过 → 调 `queryOperations({ group_by, operated_from, operated_to, operator_id, entity_type, action, page: 1, pageSize: 20 })`。
- 分页：页码按钮 → 改 page state → 重新 query（保持筛选条件，AC-F7-5 组合场景）。
- 空状态：result.items=[] 显示"暂无统计数据"（AC-F7-9）。
- 加载态：表格区域 loading 文案（AC-F7-9，R12 D16）。
- 分页信息："共 X 条，第 Y/Z 页"（AC-F7-9）。
- 错误处理：REPORT_GROUP_BY_REQUIRED → "请至少选择一个分组维度"（AC-F7-6 服务端兜底）；REPORT_TIME_RANGE_INVALID → "开始时间不能晚于结束时间"（AC-F7-7 服务端兜底）。

### 6.4 ReportFilter（F7，group_by checkbox + 时间范围 + 应用筛选按钮）

- **group_by 多选 checkbox**（Q5 决策①，D5 类型派生操作）：选项从 `[...reportGroupByDimSchema.options]` SSOT 派生（4 项：operator_id/entity_type/action/date，AC-F7-1）。checkbox group 自然适配多维选择，单选 per 维去重（N5，无重复维度问题）。**默认不勾选**（D13，Q8 决策②不预填默认维度）。
  - 维度列中文名映射（纯 UI 文案，R13 S-2 不须同步 §10 但须 Review 报告记录）：`operator_id`→"操作者"、`entity_type`→"实体类型"、`action`→"动作"、`date`→"日期"。checkbox label 用中文名。
- **时间范围**（Q6 决策①，D14 datetime-local + ISO 归一）：operated_from + operated_to 用 datetime-local 原生输入（aria-label="开始时间"/"结束时间"），前端归一为 ISO 8601 datetime with seconds + Z（如 `2026-07-03T12:00:00Z`）以通过 reportQuerySchema 的 z.string().datetime() 校验（沿用 R14 D15）。[advisory] 归一逻辑属实现提示不须同步 Spec §10 但须 Review 报告记录（R13 S-2）。
- **operator_id 筛选**（D5 类型派生 + advisory uuid 校验，R14 S-9 应用筛选按钮）：input type=text（aria-label="操作者 ID"），uuid 文本输入；为空表示不筛；[advisory] 客户端校验 uuid 格式（非 uuid 时提示"操作者 ID 须为 UUID 格式"，advisory 不强制 safeParse，AC-F7-3）。
- **entity_type select**（D5 类型派生操作）：选项从 `[...auditLogEntityTypeSchema.options]` SSOT 派生（5 项，AC-F7-4）。
- **action select**（D5 类型派生操作）：选项从 `[...auditLogActionSchema.options]` SSOT 派生（6 项，AC-F7-4）。
- **"应用筛选"按钮**（D12，aria-label="应用筛选"）：点击触发 onSubmit 回调（父组件 ReportPage 触发请求），不每键入触发。

### 6.5 ReportTable（F7，动态列展示，N6，Q7 决策②动态列）

- **动态列渲染**（D11 [约束]）：据 `result.group_by`（回显声明的维度）渲染列头 + "计数"列（count 固定列）。
  - 维度列：每个 dim 一列，列头为维度中文名（`operator_id`→"操作者"、`entity_type`→"实体类型"、`action`→"动作"、`date`→"日期"）。
  - "计数"列：count 固定列，列头"计数"。
- **每行取值**：每行 item 据 dim key 取值 `item[dim]`（维度值，string|number）+ `item.count`（计数，AC-F7-8）。
  - group_by 变化时列头动态更新（如选 ['operator_id','date'] 则列头为"操作者"+"日期"+"计数"；选 ['entity_type','action'] 则列头为"实体类型"+"动作"+"计数"）。
- **动态列类型**：动态列无法用静态 TS 接口描述，ReportTable 须运行时遍历 `result.group_by` 渲染列（类型上 ReportAggItem 为 record，dim key 为 string，TS 不强制具体键名）。[advisory] item[dim] 理论可能为 undefined（service 层保证含且仅含 group_by 声明的维度键 + count），impl 须兜底显示空字符串避免渲染 NaN/undefined。

### 6.6 Sidebar（F8，侧边栏导航扩展）

- 入口：用户（/users）、角色（/roles）、部门（/departments）、审计（/audit-logs）、**通知（/notifications）、报表（/reports）** 6 入口 + 登出按钮（R14 4 入口扩展为 6 入口，AC-F8-1）。
- 入口可达：点击跳转对应路由并渲染页面（AC-F8-2）。
- 登出：调 `useAuth().logout()`（沿用 R12 AC-F6-2，AC-F8-4）。
- 布局：App.tsx 沿用 R14 既有布局（受保护页共享 Sidebar）。

## 7. 路由设计（React Router v6，新增 2 路由）

```tsx
// App.tsx 路由表（R12/R14 基础上新增 /notifications /reports）
<Routes>
  <Route path="/login" element={<RouteGuard><LoginPage /></RouteGuard>} />
  <Route path="/users" element={<RouteGuard><UserListPage /></RouteGuard>} />
  <Route path="/roles" element={<RouteGuard><RoleListPage /></RouteGuard>} />
  <Route path="/departments" element={<RouteGuard><DeptTreePage /></RouteGuard>} />
  <Route path="/audit-logs" element={<RouteGuard><AuditLogPage /></RouteGuard>} />
  <Route path="/notifications" element={<RouteGuard><NotificationListPage /></RouteGuard>} />  {/* + R15 */}
  <Route path="/reports" element={<RouteGuard><ReportPage /></RouteGuard>} />                {/* + R15 */}
  <Route path="/" element={<Navigate to="/users" replace />} />
  <Route path="*" element={<Navigate to="/users" replace />} />
</Routes>
```

- **白名单仍仅 `/login`**（R12 D13，Q8 决策①沿用）：未登录访问 /notifications /reports → RouteGuard 跳 /login（AC-F8-3）。
- react-router-dom v6（R12 D5 沿用，零新依赖）。
- **无 /notifications/:id 详情路由**（D18 [advisory]，GET /v1/notifications/:id 不消费）。

## 8. ARCH-003 校验方案（R15 无新增校验逻辑，R12/R13 已落地）

### 8.1 R12 已落地 ARCH-003 机器化 enforcement

R12 §8 已在 `scripts/check-rules.mjs` 实现 ARCH-003 分支（L211-234）：

- 扫描 `apps/web/src/**/*.{ts,tsx}` 的 import 语句（walkWeb 收集 .ts + .tsx）。
- 禁止 specifier：`^@admin/api\b` / `api/src/` 子串 / `^apps/api\b`（三条任一命中即违规）。
- 允许：`@admin/contracts`、`@admin/contracts/*`、react/react-router-dom/react-dom、apps/web 内相对模块、node 内置。
- 违规即报错 exit≠0。

### 8.2 R13 S-4 已让 CODE 扫描器覆盖前端

R13 S-4 已将 `walkWeb` 提升为顶层函数（check-rules.mjs L23-31），`allTs` 数组（L34-41）已含 `apps/web/src` + `apps/web/test`，使 CODE-001（禁 any）/CODE-002（禁空 catch）/CODE-003（禁 eval）/CODE-004（Zod schema 命名后缀）/AI-005（禁硬编码跨域集合）等通用扫描器自动覆盖前端 .ts/.tsx 文件。

### 8.3 R15 新增模块继续受 ARCH-003 + CODE 扫描器覆盖

R15 新增 7 个前端文件（api/notifications.ts、api/reports.ts、pages/NotificationListPage.tsx、pages/ReportPage.tsx、components/NotificationForm.tsx、components/ReportFilter.tsx、components/ReportTable.tsx）+ 扩展 4 个既有文件（components/Sidebar.tsx、App.tsx、api/client.ts、lib/errorMapping.ts）位于 `apps/web/src/`，自动受 ARCH-003 分支 + CODE 扫描器覆盖，**无须新增校验逻辑**（AC-ARCH-1）。Reviewer 须逐文件核对 ARCH-003 合规性（AC-ARCH-2 类型来自 contracts）。

### 8.4 layering.md 校验方式无须更新

R12 §8.4 已将 layering.md ARCH-003 校验方式从 `[预留]` 更新为机器化描述（含 `check-rules.mjs` + `ARCH-003` + `分支` 措辞，META-003/META-004 双向绑定闭合）。R15 无新增规则、无新增 enforcement 分支，layering.md 无须更新。

## 9. 受影响测试清单（AI-006 两类标注 + R13 S-3 AC↔测试覆盖矩阵）

> 本轮为**前端扩展**（apps/web 已存在，新增通知/报表域模块），既有后端/契约测试零改动。严格遵守 AI-006：①类分显式+隐式两个子类 + ②类签名变更 + ③类新增。R15 改动 4 个 R12/R14 既有文件（client.ts query 类型扩展 / errorMapping.ts 扩展 SPECIFIC_MESSAGES / Sidebar.tsx 新增 2 入口 / App.tsx 新增 2 路由），可能影响 R12/R14 既有测试断言。

### 9.1 ① 类：contracts 联动驱动

**①-A 显式影响（grep 符号引用 + 既有文件改动）—— 1~2 文件：**

R15 改动 4 个 R12/R14 既有文件，逐文件核验对既有测试的影响：

1. **`components/Sidebar.tsx` 新增通知/报表 2 入口（4→6 入口）** → **R14 `navigation.test.tsx` ①类显式影响**。
   - 判定依据：R14 navigation.test.tsx line 68-72 断言"侧边栏渲染 4 入口（用户/角色/部门/审计）+ 登出按钮"（`it('侧边栏渲染 4 入口...')`）。R15 扩展为 6 入口后，该断言**失效**（4→6）。
   - 处理：impl-writer 须调整 R14 navigation.test.tsx 断言（4 入口 → 6 入口，新增通知/报表入口断言），属 ①类显式影响处理范例（对齐 R14 errorMapping 扩展范例）。matcher 改动须 Reviewer 判定（AI-002 须显式列出）。
   - **预估 R14 navigation.test.tsx 1 文件受影响**（明确失效）。

2. **`lib/errorMapping.ts` 扩展 SPECIFIC_MESSAGES（新增通知/报表码中文，D9）** → **R12/R14 error-mapping 测试 ①类显式影响边缘（0~1 文件）**。
   - 判定依据：基于 grep 核验 `apps/web/test/error-mapping.test.ts`（R12）+ `apps/web/test/error-mapping-extend.test.ts`（R14）现有断言：
     - R12 error-mapping.test.ts 断言 USER/VERSION/ROLE 码（line 29-59，R14 已将 ROLE_NOT_FOUND 从 FALLBACK 调整为"角色不存在"），**不断言 NOTIFICATION/REPORT 码**。
     - R14 error-mapping-extend.test.ts 断言 ROLE/DEPT/AUDIT/INVALID_CREDENTIALS/VERSION_CONFLICT 码（line 37-91），**不断言 NOTIFICATION/REPORT 码 → FALLBACK**。
     - SSOT 派生断言（`[...errorCodeSchema.options]` 全集非空，line 26-29）：R15 扩展后仍返回非空（通知/报表码从 FALLBACK 升级为具体提示），**不失效**。
   - 结论：R12/R14 error-mapping 测试**预估不失效**（不断言 NOTIFICATION/REPORT 码 → FALLBACK）。但 impl-writer 须显式核验：若 R12/R14 error-mapping 测试存在"NOTIFICATION_NOT_FOUND → FALLBACK"或"REPORT_GROUP_BY_REQUIRED → FALLBACK"断言（grep 未发现但须 double-check），则失效须调整。**预估 0~1 文件边缘**，以 impl-writer 阶段实际 grep 核验为准。

3. **`api/client.ts` 扩展 RequestOptions.query 支持 string[]（D8）** → **R12 `api-client.test.ts` ①类显式影响边缘（0 文件，既有断言不失效）**。
   - 判定依据：R12 api-client.test.ts line 213-217 断言 `RequestOptions` 结构含 `query: { page: 1 }`（number 类型）。R15 扩展 query 类型为 `Record<string, string | number | string[] | undefined>` 后，`{ page: 1 }` 仍合法（number 仍支持），既有断言**不失效**。string[] 是新增能力（后向兼容），既有 R12/R14 api 模块调用不受影响。
   - 结论：R12 api-client.test.ts **既有断言不失效**。但须新增 array query 测试用例覆盖 group_by repeated key 拼接（在 R15 新增 `api-reports.test.ts` 中覆盖，AC-F7-1/F7-2）。**预估 0 文件受影响**（既有断言不失效，新增用例在新文件）。

4. **`App.tsx` 新增 /notifications /reports 2 路由** → **R14 navigation.test.tsx ①类显式影响**（与 #1 同文件，路由可达性断言可能需扩展）。
   - 判定依据：R14 navigation.test.tsx 断言入口可达（点击"角色"→/roles 等，line 82-108）。R15 新增通知/报表入口可达性断言须扩展（点击"通知"→/notifications、点击"报表"→/reports，AC-F8-2）。属 #1 同文件的断言扩展。
   - **并入 #1 R14 navigation.test.tsx 1 文件**（不重复计数）。

**①-A 显式影响小结**：**1~2 文件**（R14 navigation.test.tsx 明确 1 文件失效须调整 + R12/R14 error-mapping 测试 0~1 文件边缘待核验）。根因：R15 改动 Sidebar（4→6 入口）+ errorMapping（扩展 SPECIFIC_MESSAGES）+ client.ts（query 类型扩展）+ App.tsx（新增路由），其中 Sidebar 入口数量断言明确失效。impl-writer 须显式列出每个受影响文件 + 改动性质 + 理由（AI-002）。

**①-B 隐式影响（全集断言依赖枚举值，R11 S-2）—— 0 文件：**

既有 SSOT 派生断言（`[...errorCodeSchema.options]` containment / `[...notificationStatusSchema.options]` / `[...reportGroupByDimSchema.options]` / `[...auditLogEntityTypeSchema.options]` / `[...auditLogActionSchema.options]` containment）位于 `apps/api/test/notification.test.ts` / `report.test.ts` / `role-inheritance.test.ts` / `optimistic-locking.test.ts` / `apps/web/test/error-mapping.test.ts` / `error-mapping-extend.test.ts`（R12/R14 已落地 SSOT 派生）。判定依据：**本轮契约层零新增**（PRD 明示 contracts 已就绪，errorCodeSchema 不扩展、notificationStatusSchema 不变、reportGroupByDimSchema 不变、auditLogEntityTypeSchema/auditLogActionSchema 不变），枚举值不变 → 既有 containment 断言不失效。**零隐式影响。**

①类小结：**1~2 文件可能受影响**（显式 1~2：R14 navigation.test.tsx 明确 + R12/R14 error-mapping 测试边缘；隐式 0）。根因：R15 改动 R12/R14 既有文件（Sidebar/errorMapping/client.ts/App.tsx），其中 Sidebar 入口数量断言明确失效。

### 9.2 ② 类：既有签名/行为变更驱动 —— 0 文件

判定依据：本轮后端冻结（不改 service/repo/domain/router/server.ts/contracts），后端 API 签名与 wire 格式零变更；前端新增消费者，不改变既有后端行为。R15 改动 R12/R14 既有文件（client.ts query 类型扩展 / errorMapping.ts 扩展 SPECIFIC_MESSAGES / Sidebar.tsx 新增入口 / App.tsx 新增路由）属"扩展"非"签名变更"（request 函数签名向后兼容、mapErrorToMessage 函数签名不变、Sidebar/App 组件签名不变）。**②类零影响。**

> 与 PRD 估算对齐：PRD 未声称 ②类影响（本轮纯前端扩展 + 既有文件扩展），本 Spec 精确分析确认 ②类 = 0。

### 9.3 ③ 类：新增测试（7 文件，impl-writer/test-writer 阶段）

| # | 文件 | 类型 | 覆盖 AC |
|---|------|------|---------|
| 1 | `apps/web/test/api-notifications.test.ts`（T1） | API client 契约测（mock fetch） | AC-F1-1（pageSize=20）、AC-F2-1（create body）、AC-F3-1（update versioned If-Match）、AC-F3-3/F3-4（409 重试）、AC-F4-1（send versioned）、AC-F4-3（send 409 重试）、AC-F5-1（read versioned）、AC-F5-4（read 409 重试）、AC-F6-1（delete versioned）、AC-F6-3（delete 409 重试幂等）、AC-F10-1/F10-2（Bearer/If-Match 注入）、AC-ARCH-2（类型 contracts 派生） |
| 2 | `apps/web/test/api-reports.test.ts`（T2） | API client 契约测 | AC-F7-1（group_by repeated key 拼接，D8 string[] query）、AC-F7-2（时间范围 ISO query）、AC-F7-4（entity_type/action query）、AC-F7-5（分页 query）、AC-F7-8（ReportResult 动态维度响应类型）、AC-F9-2（REPORT_GROUP_BY_REQUIRED/REPORT_TIME_RANGE_INVALID 码映射）、AC-ARCH-2 |
| 3 | `apps/web/test/notification-list-page.test.tsx`（T3） | 组件测（Testing Library） | AC-F1-1~F1-7（列表/分页/status 筛选/筛选+分页复合/空/加载/status 文案+按钮动态显示）、AC-F4-1/F4-2/F4-4/F4-5（发送+RECIPIENT 错误）、AC-F5-1/F5-2/F5-3（标记已读+状态守卫）、AC-F6-1/F6-2/F6-4（删除+状态守卫+NOT_FOUND）、AC-S1-2（类型派生不 safeParse） |
| 4 | `apps/web/test/notification-form.test.tsx`（T4） | 组件测 | AC-F2-1~F2-6（创建+自由文本 safeParse+延后校验）、AC-F3-1~F3-5（编辑 partial safeParse+状态守卫+409 重试+空对象）、AC-ARCH-3（safeParse）、AC-S1-1（自由文本须 safeParse） |
| 5 | `apps/web/test/report-page.test.tsx`（T5） | 组件测 | AC-F7-1~F7-9（group_by checkbox SSOT 派生+时间范围+operator_id+entity_type/action+筛选+分页复合+group_by 缺省/空+时间范围非法+动态列+分页/空/加载）、AC-F9-2（错误码提示）、AC-S1-1/S1-2（混合表单校验分类） |
| 6 | `apps/web/test/navigation-extend.test.tsx`（T6，**①类显式影响**扩展 R14 navigation.test.tsx 或新增文件） | 组件测 | AC-F8-1（侧边栏 6 入口+登出）、AC-F8-2（入口可达 /notifications /reports）、AC-F8-3（路由守卫覆盖新页）、AC-ARCH-1（lint:rules 探针）、AC-F10-3（零新依赖） |
| 7 | `apps/web/test/error-mapping-extend-2.test.ts`（T9，**①类显式影响**扩展 R14 error-mapping-extend.test.ts 或新增文件） | 单测（SSOT 派生） | AC-F9-1（通知域码中文）、AC-F9-2（报表域码中文）、AC-F9-3（SSOT 派生断言+同步注释 R14 S-11）、AC-F9-3（401/网络错误沿用 R12/R14） |

各文件断言要点：
- **api-notifications.test.ts**（mock global.fetch）：listNotifications 注入 pageSize=20（AC-F1-1，D16）；createNotification body 含 title/content/recipient_id；updateNotification/sendNotification/markNotificationRead/deleteNotification 注入 If-Match=version（D7，4 versioned 端点）；409 VERSION_CONFLICT 用 current_version 重试 1 次（AC-F3-3/F4-3/F5-4/F6-3）；DELETE 重试幂等（AC-F6-3）；Bearer 注入（AC-F10-2）；类型全部 contracts 派生（AC-ARCH-2）。
- **api-reports.test.ts**：queryOperations query 拼接 group_by repeated key（`?group_by=operator_id&group_by=date`，D8 string[] query，AC-F7-1）+ operated_from/operated_to（ISO）+ operator_id/entity_type/action + page/pageSize；ReportResult 动态维度响应类型（items 为 ReportAggItem[]，group_by 回显，AC-F7-8）；REPORT_GROUP_BY_REQUIRED/REPORT_TIME_RANGE_INVALID 码映射（AC-F9-2）。
- **notification-list-page.test.tsx**：列表渲染（AC-F1-1）、分页（AC-F1-2）、status 筛选 SSOT 派生 3 项（AC-F1-3）、筛选+分页复合（AC-F1-4 组合场景）、空/加载（AC-F1-5/6）、status 文案中文化+按钮按 status 动态显示（AC-F1-7 draft→编辑/发送/删除、sent→标记已读、read→无操作）、发送成功/状态守卫/RECIPIENT 错误（AC-F4-1/2/4/5）、标记已读成功/状态守卫（AC-F5-1/2/3）、删除成功/状态守卫/NOT_FOUND（AC-F6-1/2/4）、类型派生不 safeParse（AC-S1-2）。
- **notification-form.test.tsx**：创建成功（AC-F2-1）、title 空/超长/content 空/超长/recipient_id 非 uuid safeParse 拦截（AC-F2-2/3/4/5）、create 仅 uuid 格式校验延后至 send（AC-F2-6）、编辑成功 partial（AC-F3-1）、sent/read 态拒绝（AC-F3-2）、409 重试+仍冲突（AC-F3-3/4）、空对象 partial 合法+非法字段 strict 拒绝（AC-F3-5）、safeParse 拦截不发请求（AC-ARCH-3、AC-S1-1）。
- **report-page.test.tsx**：group_by checkbox SSOT 派生 4 项（AC-F7-1）、时间范围 datetime-local ISO 归一（AC-F7-2）、operator_id uuid advisory 校验（AC-F7-3）、entity_type/action select SSOT 派生（AC-F7-4）、筛选+分页复合（AC-F7-5 组合场景）、group_by 缺省/空客户端拦截+服务端 REPORT_GROUP_BY_REQUIRED 兜底（AC-F7-6）、时间范围非法客户端拦截+服务端 REPORT_TIME_RANGE_INVALID 兜底（AC-F7-7）、动态列渲染（AC-F7-8）、分页/空/加载（AC-F7-9）、应用筛选按钮触发（D12，不每键入）、混合表单校验分类（AC-S1-1/S1-2）。
- **navigation-extend.test.tsx**（扩展 R14 navigation.test.tsx 或新增）：侧边栏 6 入口+登出（AC-F8-1，4→6 调整）、入口跳转 /notifications /reports（AC-F8-2）、未登录跳 /login（AC-F8-3）、lint:rules 探针验证 ARCH-003（AC-ARCH-1）、零新依赖（AC-F10-3）。**①类显式影响**：若扩展 R14 既有 navigation.test.tsx 须 AI-002 边界标注 + ①类显式影响注释（4→6 入口断言调整），对齐 R14 errorMapping 扩展范例。
- **error-mapping-extend-2.test.ts**（扩展 R14 error-mapping-extend.test.ts 或新增）：映射表键 = `[...errorCodeSchema.options]`（SSOT 派生，AC-F9-3）、通知域码中文（AC-F9-1：NOTIFICATION_NOT_FOUND→"通知不存在"/NOTIFICATION_RECIPIENT_NOT_FOUND→"收件人不存在"/NOTIFICATION_RECIPIENT_DISABLED→"收件人已禁用"/NOTIFICATION_INVALID_TRANSITION→"通知状态不允许此操作"）、报表域码中文（AC-F9-2：REPORT_GROUP_BY_REQUIRED→"请至少选择一个分组维度"/REPORT_TIME_RANGE_INVALID→"开始时间不能晚于结束时间"）、同步注释核验（R14 S-11：注释须反映扩展后实际未映射域如 TRANSFER/ROLE_INHERITANCE）。**①类显式影响**：若 R14 error-mapping-extend.test.ts 断言"NOTIFICATION_NOT_FOUND → FALLBACK"会失效，impl-writer 须调整断言 toContain('通知不存在')（基于 grep 核验预估不失效，但 impl-writer 须 double-check）。

③类小结：7 新增测试文件（含 2 个 ①类显式影响扩展：navigation-extend.test.tsx + error-mapping-extend-2.test.ts），覆盖 PRD 54 条 AC + ARCH-003 合规专项 + R13 S-1 合规专项。无 E2E（Q9 决策①，R12 Q8 / R14 D20 沿用）。

### 9.4 AC↔测试用例覆盖矩阵（R13 S-3 固化）

> 测试文件编号（T#）为本 Spec 预估，**最终用例号由 test-writer 阶段确认**（R13 S-3，R14 S-12 测试文件数预估可调整须 AI-006 反向核实）。test-writer 须自检每条 AC 至少 1 个用例覆盖，未覆盖显式列 reason。

| AC 区间 | 覆盖测试文件 | 用例号（test-writer 定） | 备注 |
|---------|-------------|------------------------|------|
| AC-F1-1~F1-7 | T3 notification-list-page.test.tsx | 待定 | F1-4 组合场景（R13 S-3）、F1-7 status 文案+按钮动态显示 |
| AC-F2-1~F2-6 | T4 notification-form.test.tsx | 待定 | F2-2~F2-5 自由文本 safeParse、F2-6 延后校验跨 T1 |
| AC-F3-1~F3-5 | T4 + T1 api-notifications.test.ts | 待定 | F3-2/F3-3/F3-4 跨 T1+T4（409 重试+状态守卫） |
| AC-F4-1~F4-5 | T3 + T1 | 待定 | F4-3/F4-4/F4-5 跨 T1+T3（重试+RECIPIENT 错误） |
| AC-F5-1~F5-4 | T3 + T1 | 待定 | F5-4 跨 T1+T3（read 409 重试） |
| AC-F6-1~F6-4 | T3 + T1 | 待定 | F6-3/F6-4 跨 T1+T3（delete 重试+NOT_FOUND） |
| AC-F7-1~F7-9 | T5 report-page.test.tsx + T2 api-reports.test.ts | 待定 | F7-5 组合场景（R13 S-3）、F7-6/F7-7 跨 T2+T9（服务端码映射）、F7-1/F7-4 SSOT 派生可选放 T9、F7-8 动态列 |
| AC-F8-1~F8-3 | T6 navigation-extend.test.tsx（①类显式影响扩展 R14 navigation.test.tsx） | 待定 | F8-3 沿用 R12 route-guard 测 |
| AC-F9-1~F9-3 | T9 error-mapping-extend-2.test.ts（①类显式影响扩展 R14）+ T1 | 待定 | F9-3 SSOT 派生断言+同步注释、401/网络错误沿用 R12/R14 |
| AC-F10-1/F10-2 | T1/T2 + T6 | 待定 | API client 复用 |
| AC-F10-3 | T6（工程核验） | 待定 | 零新依赖 |
| AC-ARCH-1 | T6 + lint:rules 探针 + Reviewer 逐文件 | 待定 | ARCH-003 机器化 |
| AC-ARCH-2 | T1/T2 + Reviewer | 待定 | 类型来自 contracts |
| AC-ARCH-3 | T4 | 待定 | 自由文本表单 safeParse（F2/F3） |
| AC-S1-1 | T4/T5 | 待定 | 自由文本表单须 safeParse |
| AC-S1-2 | T3/T5 | 待定 | 类型派生 TS 类型保证（send/markRead/delete/group_by checkbox/entity_type/action select） |

> test-writer 须做 AC 覆盖矩阵自检（R13 S-3）：每条 AC 至少 1 用例覆盖，未覆盖显式列 reason；组合场景（AC-F1-4 筛选+分页、AC-F7-5 筛选+分页、AC-F3-3/F4-3/F5-4/F6-3 重试+刷新）须单独测。test-writer 可据覆盖质量调整测试文件数（R14 S-12），须 AI-006 反向核实注明理由 + Reviewer 判定合理性。

## 10. 决策清单（D1~D21）

> 每个决策显式标注 `[约束]`（默认禁止偏离，偏离须经 AI-003 流程 + Reviewer 确认）或 `[advisory]`（允许偏离，须反向同步 Spec §10）。R12 D1~D21 + R14 D1~D24 沿用，本节仅列 R15 新增/扩展决策。

### D1 · 前端分层复用 R12/R14 + 新增通知/报表域 api/pages/components `[约束]`

R15 复用 R12/R14 §2 分层（api/pages/components/auth/lib），新增 api/notifications.ts、api/reports.ts、pages/NotificationListPage.tsx、pages/ReportPage.tsx、components/NotificationForm.tsx、components/ReportFilter.tsx、components/ReportTable.tsx；扩展 components/Sidebar.tsx、App.tsx、api/client.ts（D8）、lib/errorMapping.ts（D9）。依赖方向单向沿用 R12 §2.2 / R14 §2.2。impl-writer 偏离分层须反向同步。

### D2 · ARCH-003 持续合规（新增模块继续受约束）`[约束]`

R15 新增 7 个前端文件 + 扩展 4 个既有文件继续受 ARCH-003 约束（R12 D2 / R14 D2 沿用）：只能 import @admin/contracts + 第三方 + apps/web 内部，禁止 import apps/api/src/** 与 @admin/api。R12 §8 ARCH-003 分支 + R13 S-4 CODE 扫描器自动覆盖新增文件（§8）。违规即 blocker（AC-ARCH-1）。

### D3 · 类型 z.infer 派生 + 通知/报表域无存储态区分 `[约束]`

R15 全部数据类型经 z.infer 从 @admin/contracts 派生（§3.1），禁止手写 TS 类型副本（R12 D3 沿用，AC-ARCH-2）。通知/报表域**无存储态/输出态区分**（notificationSchema/reportAggItemSchema/reportResultSchema 即输出态，无 entity schema）——前端无禁用类型需特别声明。沿用 R12 D3 禁用 userEntitySchema/tokenPayloadSchema、R14 D3 禁用 auditLogSchema/piiFieldRegistrySchema（R15 报表域复用 auditLogEntityTypeSchema/auditLogActionSchema 枚举不禁用）。

### D4 · 自由文本表单须 safeParse（R13 S-1）`[约束]`

F2 通知创建 title/content/recipient_id + F3 通知编辑 partial title?/content?/recipient_id? 为自由文本表单，提交前须调 `createNotificationInputSchema.safeParse` / `updateNotificationInputSchema.safeParse`，失败显示字段级错误不发请求（AC-F2-2/3/4/5、AC-F3-5、AC-ARCH-3、AC-S1-1）。F7 报表 operated_from/operated_to/operator_id 含自由输入，前端客户端校验为 advisory（后端兜底，不强制 safeParse reportQuerySchema）。未调 safeParse 判 partial（R13 S-1）。

### D5 · 类型派生操作不强制 safeParse（R13 S-1）`[约束]`

F4 通知发送 + F5 通知标记已读 + F6 通知删除按钮（id/version 从列表派生）+ F7 group_by checkbox + F7 entity_type/action select 为类型派生操作（id/version 为 uuid/number 字面量、group_by/entity_type/action ∈ 枚举，值经 TS 类型派生非自由输入），可不调 safeParse（schema 校验冗余）；若不调须在 impl 报告显式标注 [约束] 偏离 + 反向同步 Spec §3.2（AC-ARCH-4、AC-S1-2）。或保留 defensive safeParse（不禁止）。

### D6 · API client 复用 R12（零新增基础设施）`[约束]`

R15 零新增 API client 基础设施，全部复用 R12 api/client.ts 的 request<T>（Bearer/If-Match/401 拦截/409 重试/wire 适配/网络兜底）。新增 api 模块（notifications/reports）仅调 request<T>，不重复封装 fetch（AC-F10-1）。**唯一例外**：D8 扩展 RequestOptions.query 支持 string[]（最小后向兼容增强，非新增基础设施）。

### D7 · 通知 4 个 versioned 写端点 + If-Match + 409 重试复用 R12 D9 `[约束]`

通知域 4 个写端点（PATCH update / POST send / POST read / DELETE）全部 versioned（server.ts L354/359/364/369 第 5 参 true，N3），api/notifications 对应函数须 versioned=true + expectedVersion=notification.version → client 注入 If-Match（R12 D7，AC-F3-1/F4-1/F5-1/F6-1）。409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条，R12 D9 沿用，AC-F3-3/F4-3/F5-4/F6-3）；重试仍 409 显示"数据已被修改，请刷新后重试"（AC-F3-4）。重试仅 1 次防活锁。**注**：NOTIFICATION_INVALID_TRANSITION 非 VERSION_CONFLICT，不触发 409 重试（client 仅对 VERSION_CONFLICT 重试，状态守卫码直接抛 ApiError 由调用方处理）。

### D8 · 报表 group_by 数组 query 拼接 —— 扩展 RequestOptions.query 支持 string[] `[约束]`

R12 client.ts `RequestOptions.query` 当前类型为 `Record<string, string | number | undefined>`，不支持 string[]。报表 group_by 为数组，wire 须以 repeated key 拼接（`?group_by=operator_id&group_by=date`，server.ts L341 `m.query.getAll('group_by')`）。**决策**：扩展 `RequestOptions.query` 类型支持 `string[]`（`Record<string, string | number | string[] | undefined>`），`buildUrl` 对数组值多次 append（§4.1）。这是对 R12 client.ts 的最小后向兼容增强（string/number/undefined 行为不变，string[] 新增能力），非新增基础设施。零新依赖（URLSearchParams.append 原生支持 repeated key）。①类显式影响（§9.1）：R12 api-client.test.ts 既有断言不失效（number 仍支持），须新增 array query 测试用例（在 api-reports.test.ts 覆盖）。**不采用方案②**（api/reports.ts 手动拼接 query string 绕过 client buildUrl）——方案①扩展 query 类型是通用增强，对齐 server.ts getAll 语义，未来其他域若需数组 query 无须重复手动拼接。

### D9 · errorMapping 扩展 SPECIFIC_MESSAGES（通知/报表码中文 + 同步注释 R14 S-11）`[约束]`

R15 扩展 R12/R14 lib/errorMapping.ts 的 SPECIFIC_MESSAGES，新增通知域码（NOTIFICATION_NOT_FOUND→"通知不存在"/NOTIFICATION_RECIPIENT_NOT_FOUND→"收件人不存在"/NOTIFICATION_RECIPIENT_DISABLED→"收件人已禁用"/NOTIFICATION_INVALID_TRANSITION→"通知状态不允许此操作"）+ 报表域码（REPORT_GROUP_BY_REQUIRED→"请至少选择一个分组维度"/REPORT_TIME_RANGE_INVALID→"开始时间不能晚于结束时间"）中文提示（AC-F9-1/2）。映射表键仍从 `[...errorCodeSchema.options]` SSOT 派生（R12 D11 沿用，AC-F9-3）。**R14 S-11 教训落地**：扩展时同步更新"未映射码"注释——R14 注释为"REPORT/NOTIFICATION/TRANSFER/ROLE_INHERITANCE 域码本期前端不触发，保持 FALLBACK"，R15 扩展后须改为"TRANSFER/ROLE_INHERITANCE 域码本期前端不触发，保持 FALLBACK"（移除 REPORT/NOTIFICATION，因 R15 已扩展具体提示）。禁止硬编码全集。

### D10 · 通知状态机前端展示（status 文案中文化 + 按 status 动态显示操作按钮 Q3/Q11）`[约束]`

通知 status 文案中文化（draft→"草稿"/sent→"已发送"/read→"已读"）+ 按 status 动态显示操作按钮集（Q3 决策①隐藏不可用 + Q11 决策②配套，AC-F1-7）：draft→编辑/发送/删除、sent→标记已读、read→无操作。前端按钮隐藏 + 后端状态守卫双保险（绕过前端直接调 API 时后端返回 NOTIFICATION_INVALID_TRANSITION，errorMapping 显示"通知状态不允许此操作"，AC-F3-2/F4-2/F5-2/F5-3/F6-2）。status 文案为纯 UI 文案 R13 S-2 不须同步 §10 但须 Review 报告记录。

### D11 · 报表动态列展示（ReportTable 据 result.group_by 渲染列头 N6 Q7）`[约束]`

ReportTable 据 `result.group_by`（回显声明的维度）渲染列头（维度列每个 dim 一列，列头为维度中文名 + "计数"列 count 固定列）+ 每行 item 据 dim key 取值（`item[dim]`/`item.count`，AC-F7-8，Q7 决策②动态列，N6）。group_by 变化时列头动态更新。动态列无法用静态 TS 接口描述，运行时遍历 result.group_by 渲染。维度列中文名映射（operator_id→"操作者"/entity_type→"实体类型"/action→"动作"/date→"日期"）为纯 UI 文案 R13 S-2 不须同步 §10 但须 Review 报告记录。[advisory] item[dim] 理论可能为 undefined（service 层保证含且仅含 group_by 维度键 + count），impl 须兜底显示空字符串。

### D12 · 报表筛选"应用筛选"按钮（R14 S-9 教训）`[约束]`

ReportFilter 用"应用筛选"按钮触发请求（R14 S-9 教训，AC-F7-2/3/4/5/6/7），不每键入触发——datetime-local 切换 + operator_id 文本输入均经"应用筛选"按钮原子提交，无须 debounce。客户端 advisory 校验（group_by 非空 / from<=to）在"应用筛选"按钮点击时执行，校验通过才发请求。

### D13 · 报表 group_by 不预填默认维度 + 客户端 advisory 校验非空（Q8 N5）`[约束]`

ReportFilter group_by checkbox 默认不勾选（Q8 决策②不预填默认维度，AC-F7-6）。客户端 advisory 校验 group_by 至少 1 维（点击"应用筛选"时，若空显示"请至少选择一个分组维度"不发请求）；服务端兜底 REPORT_GROUP_BY_REQUIRED（若客户端未拦截直接请求，后端返回该码，errorMapping 显示"请至少选择一个分组维度"）。AC 同时测客户端拦截 + 服务端码映射（AC-F7-6 跨 T5+T2+T9）。**注**：schema 层不在 .min(1) 拒绝空（N5），group_by 缺省/空由 service 层语义判定 → REPORT_GROUP_BY_REQUIRED。

### D14 · 报表 datetime-local + ISO 归一（Q6，沿用 R14 D15）`[约束]`

ReportFilter operated_from/operated_to 用 datetime-local 原生输入（Q6 决策①，AC-F7-2），前端归一为 ISO 8601 datetime with seconds + Z（如 `2026-07-03T12:00:00Z`）以通过 reportQuerySchema 的 z.string().datetime() 校验（沿用 R14 D15 审计页 datetime-local ISO 归一）。客户端 advisory 校验 from <= to（否则显示"开始时间不能晚于结束时间"不发请求）；服务端兜底 REPORT_TIME_RANGE_INVALID。[advisory] 归一逻辑属实现提示不须同步 Spec §10 但须 Review 报告记录（R13 S-2）。

### D15 · 通知 recipient_id 自由文本 UUID 输入 + 存在性延后至 send（Q4 N4）`[约束]`

NotificationForm recipient_id 用自由文本 UUID 输入（Q4 决策①，AC-F2-5/F2-6），`createNotificationInputSchema.safeParse` 校验 uuid 格式（自由文本表单须 safeParse，D4）。存在性/禁用态校验**延后至 send**（契约 Q8 延后校验，N4）：create 仅 uuid 格式校验，recipient_id 为合法 uuid 但实际不存在 → **创建成功**（status='draft'，AC-F2-6），不触发 NOTIFICATION_RECIPIENT_NOT_FOUND；send 时收件人不存在抛 NOTIFICATION_RECIPIENT_NOT_FOUND（AC-F4-4）、收件人 disabled 抛 NOTIFICATION_RECIPIENT_DISABLED（AC-F4-5）。允许"先草稿后发送"工作流。**不采用**用户选择 select（须新增 api/users 全量消费超 R15 范围，且违背契约 Q8 延后校验语义）。

### D16 · 通知 pageSize 显式传 20 抹平契约缺省 10（Q1 N1）`[约束]`

通知列表前端显式传 `pageSize=20`（Q1 决策②，AC-F1-1），**不依赖 `listNotificationQuerySchema` 缺省 10**（schema default=10，N1，与 user/role 域一致），对齐 R12 D14 / R14 D21 不依赖契约缺省，与其他前端域 pageSize=20 一致（跨域前端体验一致）。schema max(100) 仍约束上限。契约缺省 10 仅在不传时生效，前端显式传值不破坏契约。

### D17 · 侧边栏扩展 6 入口 + 路由守卫覆盖 /notifications /reports `[约束]`

R15 扩展 R14 Sidebar（4 入口 → 6 入口，新增通知/报表，AC-F8-1）+ App.tsx 新增 /notifications /reports 路由（§7）。路由守卫白名单仍仅 /login（R12 D13 沿用，AC-F8-3）。①类显式影响：R14 navigation.test.tsx 断言"4 入口"失效须调整为"6 入口"（§9.1）。

### D18 · 通知详情页不做（GET /v1/notifications/:id 不消费）`[advisory]`

Q2 决策①：编辑表单 modal 预填用列表项数据（NotificationListPage items 已含完整 Notification），无须 GET 单条；GET /v1/notifications/:id（cacheable）端点存在（§1.2）但本轮不消费（对齐 R14 Q9 决策②不消费 GET /:id 的精神）。通知详情页为未来轮次（PRD Out of scope）。

### D19 · 测试范围对齐 R12 Q8 / R14 D20（组件测 + API client 契约测，无 E2E）`[约束]`

R15 测试用组件测 + API client 契约测，无 E2E（Q9 决策①，R12 Q8 / R14 D20 沿用）。7 新增测试文件（§9.3，含 2 个 ①类显式影响扩展）。Vitest + Testing Library + jsdom（R12 D17 沿用）。web .tsx 测试用 per-file `// @vitest-environment jsdom` 注解（R12 D20 沿用）。

### D20 · api 模块函数命名对齐 Spec §4.2 声明（R14 S-8 教训）`[约束]`

R15 新增 api/notifications.ts + api/reports.ts 的函数命名须对齐本 Spec §4.2 声明（R14 S-8 教训）：notifications.ts 导出 `listNotifications`/`createNotification`/`updateNotification`/`sendNotification`/`markNotificationRead`/`deleteNotification`；reports.ts 导出 `queryOperations`。impl-writer 不得擅自改名（如 `sendNotif`/`queryReport` 等），偏离须反向同步 Spec §4.2。

### D21 · aria-label 域特定（R14 S-10 教训）`[约束]`

R15 新增表单/筛选控件 aria-label 须域特定（R14 S-10 教训）：NotificationForm "通知标题"/"通知内容"/"收件人 ID"；ReportFilter "分组维度"（group_by checkbox group）/"开始时间"/"结束时间"/"操作者 ID"/"实体类型"/"动作"/"应用筛选"。禁止通用 aria-label（如 "input"/"text field"）。impl-writer 偏离须 Review 报告记录。

### 多 [约束] 组合副作用预判

> 提前标注多约束组合的潜在副作用，impl-writer 实现时须规避，偏离按 AI-003 反向同步。R13 S-2 固化：行为/数据/schema 偏离须同步 §10；纯 UI 文案偏离不须同步 §10 但须 Review 报告记录。

1. **「通知 4 versioned 写端点 (D7) + 409 重试复用 R12 D9 + 状态守卫 INVALID_TRANSITION (D10/N2/N3)」组合**：通知域 4 个 versioned 写端点（PATCH/POST send/POST read/DELETE）全部 409 重试复用 R12 D9。状态守卫拒绝抛 `NOTIFICATION_INVALID_TRANSITION`（非 VERSION_CONFLICT），**不触发 409 重试**（client 仅对 VERSION_CONFLICT 重试，状态守卫码直接抛 ApiError 由调用方处理）。impl-writer 须保证：client.ts 409 重试分支仅匹配 `code === 'VERSION_CONFLICT'`，INVALID_TRANSITION 不误入重试路径（R12 client.ts L198 已保证 `err.code === 'VERSION_CONFLICT'` 判定，R15 无须改 client 重试逻辑）。**DELETE 重试幂等性**：DELETE 409 重试发生在同次冲突未删成功的场景（409 表示未删除），重试 DELETE 语义安全（非重复删除已删资源）；若重试时已被其他请求删除则 404 NOTIFICATION_NOT_FOUND，前端显示"通知不存在"并刷新（AC-F6-4）。无活锁（重试仅 1 次）。

2. **「报表 group_by 数组 query (D8) + URLSearchParams repeat + server.ts getAll (N5)」组合**：扩展 RequestOptions.query 支持 string[] 后，buildUrl 须对 string[] 值多次 append（repeated key，`?group_by=operator_id&group_by=date`）。须与 server.ts L341 `m.query.getAll('group_by')` 语义对齐（server 端 getAll 收集所有同名 key 为数组）。impl-writer 须保证：(1) buildUrl 对 Array.isArray(value) 分支逐元素 append；(2) 空数组/缺省 group_by 不拼接 query（undefined 跳过，空数组须显式跳过避免拼接 `?group_by=` 空值）；(3) api/reports.ts 传 query 时 group_by 为 `ReportGroupByDim[]`（string[] 子类型），经 D8 扩展后类型兼容。**注**：group_by 缺省/空由服务端 REPORT_GROUP_BY_REQUIRED 兜底（D13 客户端 advisory 校验在前，服务端兜底在后）。

3. **「errorMapping 扩展 (D9) + SSOT 派生 (R12 D11) + R12/R14 既有测试 (§9.1 ①类显式影响)」组合**：R15 扩展 SPECIFIC_MESSAGES 新增通知/报表码中文提示，但映射表键仍从 `[...errorCodeSchema.options]` SSOT 派生（R12 D11）。errorCodeSchema 枚举未扩展（通知/报表码本就在枚举内），故 SSOT 派生断言不失效。但 R12/R14 error-mapping 测试若断言"NOTIFICATION_NOT_FOUND → FALLBACK"或"REPORT_GROUP_BY_REQUIRED → FALLBACK"会失效（因 R15 改为具体提示）。基于 grep 核验（§9.1），R12/R14 error-mapping 测试**不断言这些码 → FALLBACK**，预估不失效。impl-writer 须 double-check：若发现既有断言失效须调整（matcher 改动须 Reviewer 判定，AI-002 须显式列出）。**注**：此为"填充既有 FALLBACK 码的具体提示"，非"新增枚举键"，SSOT 派生机制不变。同步注释（R14 S-11）：注释须从"REPORT/NOTIFICATION/...保持 FALLBACK"改为"TRANSFER/ROLE_INHERITANCE 保持 FALLBACK"（移除已扩展的 REPORT/NOTIFICATION）。

4. **「通知状态机前端展示 (D10) + 按 status 动态显示操作按钮 (Q3/Q11) + 状态守卫 (N2/N3)」组合**：前端按 status 隐藏不可用按钮（draft→编辑/发送/删除，sent→标记已读，read→无）。但前端隐藏不等同后端守卫——若绕过前端直接调 API（如对 sent 通知调 DELETE），后端返回 NOTIFICATION_INVALID_TRANSITION，前端 errorMapping 显示"通知状态不允许此操作"。impl-writer 须保证：(1) NotificationListPage 按钮渲染按 `notification.status` 条件渲染（draft 显示 3 按钮，sent 显示 1 按钮，read 无按钮）；(2) 操作失败时 errorMapping 处理 INVALID_TRANSITION（显示"通知状态不允许此操作"）；(3) 前端隐藏 + 后端守卫双保险，不依赖单一防线。**注**：Q3 决策①隐藏不可用（非全显示禁用），disabled 按钮占位易混淆故不采用。

5. **「报表 group_by 不预填 (D13) + 客户端 advisory 校验非空 (Q8) + 服务端 REPORT_GROUP_BY_REQUIRED 兜底 (N5)」组合**：客户端 advisory 校验 group_by 至少 1 维（点击"应用筛选"时，空则显示"请至少选择一个分组维度"不发请求），服务端兜底 REPORT_GROUP_BY_REQUIRED（若客户端未拦截直接请求）。impl-writer 须保证：(1) ReportFilter group_by 默认不勾选（D13）；(2) "应用筛选"按钮点击时先校验 group_by 非空（advisory）；(3) 客户端校验文案与服务端码映射文案一致（"请至少选择一个分组维度"），避免 UX 不一致；(4) AC-F7-6 同时测客户端拦截（T5）+ 服务端码映射（T2+T9）。同理「operated_from > to (D14) + 客户端 from<=to 校验 + 服务端 REPORT_TIME_RANGE_INVALID」组合（AC-F7-7）。

6. **「报表动态列 (D11) + reportAggItemSchema z.record (N6) + result.group_by 回显」组合**：ReportTable 据 result.group_by 渲染列头，每行 item 据 dim key 取值。impl-writer 须保证：(1) 列头据 `result.group_by` 数组遍历渲染（每个 dim 一列 + count 固定列）；(2) 每行 item 据 dim key 取值 `item[dim]`（维度值 string|number）+ `item.count`；(3) dim key 与 result.group_by 一致（service 层保证 items 每项含且仅含 group_by 声明的维度键 + count）；(4) 动态列无法用静态 TS 接口，运行时遍历，[advisory] item[dim] 兜底空字符串避免 NaN/undefined；(5) group_by 变化时列头动态更新（AC-F7-8）。**注**：ReportAggItem 为 record 类型，dim key 为 string，TS 不强制具体键名，运行时遍历是唯一正确展示。

7. **「自由文本表单 safeParse (D4) + 类型派生操作 (D5) 在 NotificationForm/ReportFilter 混合」组合**：NotificationForm 创建/编辑模式含自由文本（title/content/recipient_id 须 safeParse）；ReportFilter 含自由文本（operated_from/to/operator_id advisory）与类型派生（group_by checkbox/entity_type/action select，safeParse 冗余）。impl-writer 须保证：(1) NotificationForm 整体表单调 createNotificationInputSchema.safeParse / updateNotificationInputSchema.safeParse（覆盖自由文本字段校验）；(2) ReportFilter 不整体 safeParse reportQuerySchema（非 strict + superRefine），按字段分别 advisory 校验；(3) 类型派生字段值经 options 派生保证合法（safeParse 不会在此字段失败，§3.2 混合表单提示）。**注**：AC-S1-1（自由文本须 safeParse）针对 NotificationForm；AC-S1-2（类型派生 TS 保证）针对 send/markRead/delete 按钮 + group_by checkbox/entity_type/action select。

8. **「client.ts query 类型扩展 (D8) + R12 api-client.test.ts ①类显式影响 (§9.1) + R12/R14 既有 api 模块」组合**：扩展 RequestOptions.query 支持 string[] 是后向兼容增强（string/number/undefined 仍支持）。impl-writer 须保证：(1) buildUrl 对 Array.isArray(value) 分支逐元素 append，对 string/number/undefined 行为不变；(2) R12 api-client.test.ts 既有断言（`query: { page: 1 }`）不失效（number 仍支持）；(3) R12/R14 既有 api 模块（users/roles/departments/audit-logs）调用不受影响（不传 string[]）；(4) 新增 array query 测试用例在 api-reports.test.ts 覆盖 group_by repeated key（AC-F7-1）。**注**：D8 是 R12 既有基础设施的最小增强，非新增基础设施；①类显式影响预估 0 文件既有断言失效（仅须新增用例）。

### §10 advisory 文案同步边界（R13 S-2 固化 + R14 S-8~S-11 教训落地）

R13 S-2 固化：advisory 偏离预判须明确同步边界。R14 S-8~S-11 教训在本轮落地：

- **须同步 §10 的 advisory 偏离**（行为/数据/schema 偏离）：
  - D8 client.ts query 类型扩展（数据偏离：query 拼接逻辑变更支持 string[]）—— 已同步 §10 D8。
  - D18 通知详情页不做（行为偏离：GET /:id 不消费）—— 已同步 §10 D18。
- **不须同步 §10 但须 Review 报告记录的 advisory 偏离**（纯 UI 文案偏离）：
  - status 文案中文化（草稿/已发送/已读，D10）—— 措辞可微调，须 Review 报告记录。
  - 维度列中文名（操作者/实体类型/动作/日期，D11）—— 措辞可微调，须 Review 报告记录。
  - 按钮文案（编辑/发送/删除/标记已读/应用筛选等，D10/D12）—— impl-writer 可选措辞，须 Review 报告记录。
  - 错误提示文案（通知不存在/收件人不存在/请至少选择一个分组维度/开始时间不能晚于结束时间等，§11）—— 对齐 §11 矩阵，措辞可微调，须 Review 报告记录。
  - 空状态文案（暂无通知/暂无统计数据，§6）—— impl-writer 可选措辞，须 Review 报告记录。
  - datetime-local ISO 归一逻辑（D14，沿用 R14 D15）—— 实现提示不须同步 §10 但须 Review 报告记录。
- **R14 教训落地**：
  - S-8（api 命名对齐 Spec §4.2）—— D20 [约束] 落地。
  - S-9（文本筛选"应用筛选"按钮不每键入触发）—— D12 [约束] 落地。
  - S-10（aria-label 域特定）—— D21 [约束] 落地。
  - S-11（扩展既有模块同步注释）—— D9 [约束] 落地（errorMapping 注释同步移除 REPORT/NOTIFICATION）。

## 11. 边界与异常（错误码 → 用户提示 + 交互行为矩阵）

> 对齐 contracts errorCodeSchema SSOT。R15 扩展 R12/R14 errorMapping SPECIFIC_MESSAGES（D9），新增通知/报表域码中文提示。映射表键 SSOT 派生（R12 D11 沿用）。

### 11.1 通知域错误码

| ErrorCode | 触发场景 | 用户提示 | 交互行为 | AC |
|-----------|----------|----------|----------|----|
| `NOTIFICATION_NOT_FOUND` | DELETE / send / markRead / update 目标 id 不存在 | "通知不存在" | 列表刷新 | AC-F6-4 |
| `NOTIFICATION_RECIPIENT_NOT_FOUND` | send 时收件人不存在（N4 延后校验） | "收件人不存在" | 原样显示 | AC-F4-4 |
| `NOTIFICATION_RECIPIENT_DISABLED` | send 时收件人 status=disabled（N4 延后校验） | "收件人已禁用" | 原样显示 | AC-F4-5 |
| `NOTIFICATION_INVALID_TRANSITION` | 状态守卫拒绝（sent/read 态 update/send/delete、draft 态 markRead、read 态重复 markRead，N2/N3 单码覆盖所有状态非法） | "通知状态不允许此操作" | 原样显示 | AC-F3-2、AC-F4-2、AC-F5-2、AC-F5-3、AC-F6-2 |

### 11.2 报表域错误码

| ErrorCode | 触发场景 | 用户提示 | 交互行为 | AC |
|-----------|----------|----------|----------|----|
| `REPORT_GROUP_BY_REQUIRED` | group_by 缺省/空数组（N5，service 层语义判定） | "请至少选择一个分组维度" | 原样显示（客户端已 advisory 拦截，此为服务端兜底） | AC-F7-6 |
| `REPORT_TIME_RANGE_INVALID` | operated_from > operated_to（N5，schema superRefine 检测 + service 层语义判定） | "开始时间不能晚于结束时间" | 原样显示（客户端已 advisory 拦截，此为服务端兜底） | AC-F7-7 |

### 11.3 沿用 R12/R14 的错误码（R15 不扩展，复用 R12/R14 errorMapping）

| ErrorCode | 触发场景 | 用户提示 | 交互行为 |
|-----------|----------|----------|----------|
| `VALIDATION_ERROR` | 客户端 schema 拦截（不到后端）；或后端 safeParse 失败（如 group_by 维度重复，N5 router 层） | 字段级错误（safeParse issue）/ 维度重复提示 | 不发请求；若到后端则显示 message |
| `UNAUTHORIZED`/`TOKEN_INVALID`/`TOKEN_EXPIRED`/`TOKEN_REVOKED` | 受保护路由缺失/无效/过期/吊销 token | （不提示，跳登录） | 清 token + 跳 /login（R12 D8） |
| `FORBIDDEN` | role ≠ admin 或无 notification:read/notification:write/report:read 权限 | "无权限执行此操作" | 原样显示 |
| `VERSION_CONFLICT` | 通知 4 versioned 写端点 If-Match 不匹配 | （自动重试无提示）；重试仍冲突 → "数据已被修改，请刷新后重试" | 用 current_version 重试 1 次；仍冲突抛错 |
| `VERSION_REQUIRED` | 通知 versioned 写缺 If-Match | "操作失败，请稍后重试" | **不应触发**（client 保证注入）；触发则 client bug |
| （非 contracts）`NETWORK_ERROR` | fetch 抛错 | "网络异常，请稍后重试" | 不白屏 |
| （非 contracts）`INTERNAL_ERROR` / 5xx | 后端 500 | "服务异常，请稍后重试" | 原样显示 |

### 11.4 PII 安全补充

- 通知 title/content/recipient_id 非 PII（contracts 明示），无特殊处理。
- 报表 operator_id（group_by 维度值）为中敏感 uuid 关联标识，禁止 console.log / 日志记录（沿用 R14 审计 operator_id 处理）。
- 沿用 R12 D12：token 禁止 console.log。

## 12. 工程配置（R15 零新增工程配置，复用 R12/R14）

### 12.1 R15 零新增工程配置

R15 复用 R12/R14 全部工程配置，**无新增/改动**（除 D8 client.ts query 类型扩展属代码增强非工程配置）：

- `apps/web/package.json`：R12 依赖清单（react/react-dom/react-router-dom + @admin/contracts + Vitest/Testing Library/jsdom），R15 **零新依赖**（AC-F10-3）。
- `apps/web/vite.config.ts`：R12 配置（alias @admin/contracts + dev proxy /v1），R15 无改动。
- `apps/web/tsconfig.json`：R12 配置（jsx:react-jsx + lib DOM + extends 根 tsconfig），R15 无改动。
- 根 `vitest.config.ts`：R12 已扩展 include 匹配 .tsx + setupFiles（R12 D20），R15 新增 .tsx 测试文件自动纳入，无改动。
- 根 `tsconfig.json`：R12 已含 apps/*/src + apps/*/test，R15 新增文件自动纳入 typecheck，无改动。
- `scripts/check-rules.mjs`：R12 ARCH-003 分支 + R13 S-4 walkWeb/allTs 已覆盖 apps/web，R15 无改动（§8）。

### 12.2 零新依赖核验

R15 新增 api/pages/components 模块仅 import：
- `@admin/contracts`（类型 + Zod schema，workspace 依赖）。
- `react` / `react-router-dom`（R12 已声明第三方依赖）。
- apps/web 内部模块（api/client、auth/AuthContext、components、lib/errorMapping）。

无新第三方依赖（无 axios/ky/Redux/Zustand/UI 框架/Playwright/图表库），AC-F10-3 满足。**报表图表可视化 out-of-scope**（PRD Out of scope，须引入图表库违背零新依赖）。

### 12.3 monorepo 融入（沿用 R12/R14）

- apps/web 作为 workspace 包（R12 已接入），R15 新增文件自动纳入根 scripts `test`（vitest run）+ `lint:rules`（check-rules.mjs）+ `typecheck`（tsc -p tsconfig.json --noEmit）覆盖（AI-004）。
- ARCH-003 校验经 `lint:rules` 执行，R15 新增前端源码 import 违规即 exit≠0（§8）。
- `@admin/contracts` 经 workspace 解析（`@admin/contracts: "*"`），R15 复用既有契约无须改动 contracts 包。
