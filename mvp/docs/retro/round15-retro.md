---
doc_type: Retrospective
id: RETRO-ROUND15-001
scope: 第十五轮演练（前端全域覆盖收尾：通知管理页 + 报表页，完成 auth/user/role/dept/audit/notification/report 七域全覆盖）
date: 2026-07-03
verdict: 跑通；七域全覆盖；client.ts 扩展范例；通知状态机+versioned 组合；R14 教训反推生效
---

# 第十五轮演练复盘 · 前端全域覆盖收尾（通知管理页 + 报表页）+ client.ts 既有基础设施扩展范例 + 通知状态机 + versioned 组合 + R14 教训反推生效

> 本轮在 R12 前端首轮（auth+user 两域）+ R14 前端多域扩展（role+dept+audit 三域，共 5 域）基础上，新增通知域（CRUD + 状态机 draft→sent→read + 4 个 versioned 写端点）+ 报表域（纯读聚合 + 动态维度 group_by + 动态列表格），完成前端全域覆盖（七域）。同时验证 R12 client.ts `RequestOptions.query` 类型扩展支持 `string[]` 的"既有基础设施扩展范例"（D8，后向兼容）、通知状态机前端展示 + 4 versioned 端点组合（D7+D10）、报表动态维度键 `z.record` 渲染（D11，N6）、R13/R14 固化的 13 条提示词在 R15 持续验证生效，特别是 R14 S-11（errorMapping 同步注释）在 R15 D9 闭合——注释从"REPORT/NOTIFICATION 保持 FALLBACK"更新为"TRANSFER/ROLE_INHERITANCE 保持 FALLBACK"。

## 0 · 本轮目标与结果

1. **前端全域覆盖收尾**（auth/user/role/dept/audit/notification/report 七域）→ ✅ 通知管理页（列表+创建+编辑+发送+标记已读+删除，4 个 versioned 端点）+ 报表页（group_by 多维聚合 + 时间范围 + 筛选 + 动态列）+ 导航扩展（Sidebar 4→6 入口）+ errorMapping 扩展（通知/报表码）+ client.ts query 类型扩展（D8 string[]）全部落地，前端覆盖全部后端域（7 域）。
2. **versioned 写操作多端点复用再验证**（通知域一次性引入 4 个 versioned 写端点：PATCH update / POST send / POST read / DELETE，全部 If-Match + 409 重试复用 R12 D9）→ ✅ 4 端点全部 versioned=true + expectedVersion，409 VERSION_CONFLICT 自动重试 1 次；NOTIFICATION_INVALID_TRANSITION（非 VERSION_CONFLICT）不重试，由调用方处理；DELETE 重试幂等（409 表示未删除）。
3. **状态机驱动域前端模式**（通知 status 三态 draft→sent→read，sent/read append-only 不可改不可删，按 status 动态显示操作按钮 + status 文案中文化）→ ✅ STATUS_LABEL={draft:'草稿',sent:'已发送',read:'已读'}；按 status 条件渲染按钮（draft→编辑/发送/删除、sent→标记已读、read→无操作，Q3 决策①隐藏不可用）；前端隐藏 + 后端状态守卫双保险。
4. **聚合只读域 + 动态维度前端模式**（报表 group_by 1-4 维动态选择，聚合结果 items 为动态维度键 + count，`reportAggItemSchema` 用 `z.record` 承载）→ ✅ ReportTable 据 `result.group_by` 动态渲染列头（维度列每个 dim 一列 + count 固定列）+ 每行 item 据 dim key 取值；维度列中文名映射；空值兜底空字符串。
5. **client.ts query 类型扩展（D8）—— 既有基础设施扩展范例**（R12 `RequestOptions.query` 从 `Record<string, string|number|undefined>` 扩展为 `Record<string, string|number|string[]|undefined>`，支持报表 group_by 数组 repeated key，后向兼容）→ ✅ query 类型扩展 + buildUrl 对数组值多次 append（repeated key，对齐 server.ts `m.query.getAll`）；string/number/undefined 行为不变，R12 api-client.test.ts 既有 number query 断言不失效；零新依赖（URLSearchParams.append 原生支持 repeated key）。
6. **R13/R14 固化提示词在 R15 持续验证**（R13 S-1 两类表单 / S-2 advisory 文案边界 / S-3 AC 覆盖矩阵 / S-4 CODE 扫描器前端 + R14 S-8 api 命名 / S-9 应用筛选按钮 / S-10 aria-label 域特定 / S-11 errorMapping 同步注释）→ ✅ 13 条提示词在 R15 全部验证生效；特别是 R14 S-11 在 R15 D9 闭合——errorMapping.ts 三处注释从"REPORT/NOTIFICATION/TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"（移除已扩展的 REPORT/NOTIFICATION）。
7. **多约束组合副作用预判 8 条全部正确实现**（Tech-Spec §10 末 8 条：4 versioned + 409 重试 + INVALID_TRANSITION / group_by 数组 query + URLSearchParams / errorMapping 扩展 + SSOT + R14 S-11 同步注释 / 状态机展示 + 隐藏按钮 / group_by 不预填 + advisory + 服务端兜底 / 动态列 + z.record / 混合表单 safeParse / client.ts query 扩展后向兼容）→ ✅ 8 条全部正确实现，无副作用 bug。

**结果速览**：typecheck ✅ / lint:rules ✅（ARCH-003 + CODE 扫描器全过，META-003/META-004 持续闭合）/ vitest ✅ **1089/1089**（web 256 = R12 50 + R14 108 + R15 87 + 其他；api 833 无回归）/ AC 对齐 **54/54**（功能 49 + ARCH-003 专项 3 + R13 S-1 专项 2，0 偏离 0 未实现）/ blocker **0** / suggestion **8** / 新增源码 apps/web/src 7 新文件（2 api + 2 pages + 3 components）+ App.tsx 路由扩展 + Sidebar 扩展（4→6 入口）+ client.ts D8 query 扩展 + errorMapping D9 扩展（含 R14 S-11 同步注释三处更新）/ 新增测试 7 文件 87 用例（5 ③类新增 + 2 ①类显式影响新增独立文件）/ 不改后端（apps/api + packages/contracts 冻结）/ ①类显式影响 1 文件调整（R14 navigation.test.tsx 4→6 入口 matcher 调整，D17 扩展）+ 1 文件预估不失效（R14 error-mapping-extend.test.ts 不断言 NOTIFICATION/REPORT 码 → FALLBACK，R15 扩展后不失效）+ 1 文件 D8 后向兼容核验（R12 api-client.test.ts RequestOptions query: { page: 1 } number 仍支持）。

## 1 · 本轮核心验证结论

### 1.1 前端全域覆盖完成（七域，R15 最大验证点）

R12 前端首轮覆盖 auth+user 两域（单域 CRUD + 状态切换），R14 一次性扩展角色/部门/审计三域（扁平分页 / 递归树 / append-only 只读，共 5 域）。R15 新增通知域（CRUD + 三态状态机 draft→sent→read + 4 versioned 写端点）+ 报表域（纯读聚合 + 动态维度 group_by + 动态列），完成前端全域覆盖（七域），验证 R12 前端基础设施对"状态机驱动域 + 聚合只读域"两种新数据形态的复用性：

| 维度 | R12（前端首轮，2 域） | R14（前端多域扩展，+3 域 = 5 域） | R15（前端全域收尾，+2 域 = 7 域） |
|---|---|---|---|
| 覆盖域 | auth + user | + role + dept + audit | + **notification + report** |
| 数据形态 | 扁平分页（user） | + 扁平分页（role）+ 递归树（dept）+ 只读 append-only（audit） | + **三态状态机（notification draft→sent→read）** + **纯读聚合 + 动态维度（report）** |
| API client | request<T> 封装 fetch | 零新增基础设施 | **D8 query 类型扩展（string[]，最小后向兼容增强，非新增基础设施）** |
| AuthContext/RouteGuard | tokenStore + Context + 白名单 /login | 零改动 | **零改动**（新路由自动受守卫覆盖） |
| ErrorBanner/errorMapping | 错误展示 + 中文提示 | errorMapping 扩展 SPECIFIC_MESSAGES（角色/部门码） | **errorMapping 扩展 SPECIFIC_MESSAGES（通知/报表码）+ R14 S-11 同步注释三处更新** |
| versioned 写操作 | PATCH /v1/users/:id/status 1 端点 | + DELETE /v1/roles/:id versioned 重试复用 R12 D9 | + **通知域 4 versioned 端点复用 R12 D9**（update/send/markRead/delete，密度最高） |
| 类型派生 | z.infer 从 @admin/contracts | 零新增类型层 | **零新增类型层**（全部复用既有 contracts schema，含 z.record 动态维度键） |
| 零新依赖 | 原生 fetch + react-router-dom + Context | 零新依赖 | **零新依赖**（无 axios/ky/Redux/Zustand/UI 框架/图表库/Playwright） |

**结论**：R12 前端基础设施（API client / AuthContext / RouteGuard / ErrorBanner / errorMapping）在 R15 状态机域 + 聚合只读域两种新数据形态下零新增基础设施——唯一对既有基础设施的最小后向兼容增强是 D8（client.ts query 类型扩展支持 string[]），其余只新增 api 模块（notifications/reports）+ pages（NotificationListPage/ReportPage）+ components（NotificationForm/ReportFilter/ReportTable）。证明前端分层架构（api/pages/components/auth/lib）在 7 域下持续复用，且 ARCH-003 在新增 7 文件下持续合规（lint:rules exit 0 + 逐文件核对 0 违规 + grep 0 实际 import）。R12 机器化 enforcement 在前端全域覆盖下持续有效。**前端全域覆盖完成标志着 spec-first 工作流对"前端全域"的适应性验证闭合**——从 R12 单域引入、R14 多域扩展、R15 全域收尾，前端分层架构 + 跨层契约机器化 + 零新依赖精神在 7 域下持续复用。

### 1.2 BA 核验 contracts SSOT 6 处偏离（N1-N6）—— R10 S-2 教训第四次生效

PRD 起草阶段 BA 核验 `packages/contracts/src/schemas/notification.ts` + `report.ts` + `audit.ts` + `user.ts`（errorCodeSchema SSOT）+ `apps/api/src/server.ts` 路由表（L346-374），发现任务编排描述与 contracts SSOT 存在 6 处须显式标注的偏离，BA 一律以 contracts SSOT 为准：

| # | 任务描述措辞 | contracts SSOT 实际 | PRD/Spec 遵循 |
|---|---|---|---|
| N1 | "通知列表（分页+status 筛选）" pageSize | `listNotificationQuerySchema.pageSize` 默认 **10**（与 user/role 域一致），上限 100；与 audit/report 域 pageSize 默认 20 有意分歧 | 前端显式传 pageSize=20（Q1 决策②，对齐 R12 D14 / R14 D21 不依赖契约缺省），契约缺省 10 仅在不传时生效 |
| N2 | "通知编辑（仅 draft 态，PATCH versioned）" | `updateNotificationInputSchema` 为 partial（title?/content?/recipient_id?，空对象合法）；sent/read 态 update 由 service 状态守卫拒绝抛 `NOTIFICATION_INVALID_TRANSITION`（单码覆盖所有状态非法） | F3 通知编辑 AC 用 `NOTIFICATION_INVALID_TRANSITION` 断言 sent/read 拒绝编辑（非臆造码）；partial 编辑允许空对象 |
| N3 | "通知发送/标记已读/删除" | send/markRead/delete 均 **versioned**（server.ts L359/364/369 第 5 参 true，须 If-Match）；状态非法统一抛 `NOTIFICATION_INVALID_TRANSITION` | F4/F5/F6 AC 统一用 `NOTIFICATION_INVALID_TRANSITION` 断言状态守卫拒绝；send/markRead/delete 须 If-Match + 409 VERSION_CONFLICT 自动重试（复用 R12 D9） |
| N4 | "通知 recipient_id 输入" | `createNotificationInputSchema.recipient_id` 仅 uuid 格式校验，存在性/禁用态校验**延后至 send**（契约 Q8 延后校验，允许"先草稿后发送"工作流）；send 时收件人不存在抛 `NOTIFICATION_RECIPIENT_NOT_FOUND`、收件人 disabled 抛 `NOTIFICATION_RECIPIENT_DISABLED` | Q4 决策①自由文本 UUID 输入 + safeParse uuid 格式校验；create 不触发 RECIPIENT 错误（仅格式校验），RECIPIENT_NOT_FOUND/RECIPIENT_DISABLED 在 F4 send 时触发 |
| N5 | "报表 group_by 多维选择（1-4 维去重）" | `reportQuerySchema.group_by` 为 `z.array(reportGroupByDimSchema).max(4).optional()`（**不在 schema 层 .min(1) 拒绝空**）；group_by 缺省/空数组由 service 层语义判定 → `REPORT_GROUP_BY_REQUIRED`；operated_from > operated_to → `REPORT_TIME_RANGE_INVALID` | F7 AC：group_by 缺省/空 → `REPORT_GROUP_BY_REQUIRED`（客户端 advisory 校验非空 + 服务端兜底）；operated_from > operated_to → `REPORT_TIME_RANGE_INVALID`；维度重复由 checkbox UI 自然防止 |
| N6 | "报表聚合结果表格展示" | `reportAggItemSchema = z.record(z.string(), z.union([z.string(), z.number()])).and(z.object({count: z.number().int().min(0)}))`——维度键随 group_by **动态变化**，无法静态枚举字段名；`reportResultSchema.group_by` 原样回显声明的维度 | Q7 决策②动态列（维度键随 group_by 动态生成列 + count 固定列）；ReportTable 据 `result.group_by` 渲染列头，每行 item 据 dim key 取值 |

**结论**：这是 R10 S-2 教训（BA 须核验路由表/契约）的**第四次生效**——R11（PRD 估算 5 embedding → Spec 精确 2）、R12（GET /v1/users/:id 不存在 → 409 重试）、R14（5 处 contracts 偏离 B1-B5）、R15（6 处 contracts 偏离 N1-N6）。Reviewer §3 重点项 1 逐条核对 N1-N6 全部遵循 contracts SSOT（6/6 ✅）。**证明 BA 阶段 contracts SSOT 核验已成为稳定实践**——任务编排描述与契约 SSOT 存在偏离时，BA 一律以契约为准并标注偏离以供 Tech-Spec/Reviewer 参考，避免下游阶段基于错误描述实现。特别是 N1（pageSize 缺省分歧 10 vs 20）须前端显式传值抹平、N2/N3（状态守卫统一码 + 4 versioned）、N4（recipient_id 延后校验）、N5（group_by 缺省语义判定）、N6（z.record 动态维度键）六处须 AC 精确断言点均以 contracts SSOT 为准。

### 1.3 client.ts query 类型扩展（D8）—— 既有基础设施扩展范例

R12 client.ts `RequestOptions.query` 类型为 `Record<string, string | number | undefined>`，不支持 string[]。报表 group_by 为数组，wire 须以 repeated key 拼接（`?group_by=operator_id&group_by=date`，server.ts L341 `m.query.getAll('group_by')`）。R15 决策扩展 query 类型支持 `string[]`（D8 [约束]），这是"既有基础设施扩展"的范例：

| 维度 | 扩展内容 | 范例价值 |
|---|---|---|
| 类型扩展 | `Record<string, string \| number \| string[] \| undefined>`（+ string[]） | 类型层最小扩展，新增能力而非替换 |
| 行为扩展 | `buildUrl` 对 Array.isArray(value) 分支逐元素 append（repeated key） | 对齐 server.ts `m.query.getAll` 语义，URLSearchParams.append 原生支持 repeated key |
| 后向兼容 | string/number/undefined 行为不变 | R12 既有 api-client.test.ts `query: { page: 1 }`（number）D8 扩展后不失效，编排者实跑 1089/1089 全绿核验 |
| 零新依赖 | 无 axios/ky/query string 库 | URLSearchParams.append 原生支持 repeated key |
| ①类显式影响预估 | Spec §9.1 预估 0 文件既有断言失效 | R12 api-client.test.ts 既有 number query 断言不失效（预估准确） |

**方案对照**（不采用方案②）：api/reports.ts 内部手动拼接 group_by query string 后传入 path（绕过 client buildUrl）。缺点：绕过 client 统一 query 处理、与 R12 buildUrl 风格不一致、未来其他域若需数组 query 须重复手动拼接。方案①扩展 query 类型是通用增强，对齐 server.ts getAll 语义，零新依赖，故采用①。

**结论**：D8 是"既有基础设施扩展"的范例——类型扩展 + 后向兼容 + 零新依赖 + ①类显式影响预估准确（0 文件既有断言失效）。这与 R12 ARCH-003 机器化 enforcement（新增校验逻辑）、R14 errorMapping 扩展 SPECIFIC_MESSAGES（新增映射条目）不同——D8 是对既有类型签名 + 既有行为函数的最小后向兼容增强，证明 spec-first 工作流对"既有基础设施扩展"的适应性：Spec 阶段须明确扩展类型 + 后向兼容边界 + ①类显式影响预估（既有断言是否失效），impl 阶段须保证 string/number/undefined 行为不变 + 数组值多次 append，Reviewer 阶段须实跑核验既有断言不失效。**这是"既有基础设施扩展"的范例**——区别于"新增基础设施"（R12 client.ts 首次实现）与"新增校验逻辑"（R12 ARCH-003 分支），D8 示范如何在不破坏既有契约的前提下扩展既有基础设施能力。

### 1.4 通知状态机前端展示 + 4 versioned 端点（状态机 + versioned 组合范例）

通知 status 为三态状态机（draft→sent→read，sent/read append-only 不可改不可删），R12/R14 均为二元状态（user active/disabled、role 无状态、dept 无状态、audit append-only 无状态）。R15 首次验证前端对"三态状态机 + append-only 守卫 + 4 versioned 写端点"的展示与操作策略：

| 维度 | 状态机展示（D10） | versioned 写端点（D7） | 组合副作用（§10 组合 #1/#4） |
|---|---|---|---|
| draft 态 | 显示"草稿"+ 编辑/发送/删除按钮 | update/send/delete 均 versioned + If-Match | 4 端点 409 VERSION_CONFLICT 重试复用 R12 D9；INVALID_TRANSITION 不重试 |
| sent 态 | 显示"已发送"+ 标记已读按钮（append-only 不可改不可删） | markRead versioned + If-Match | markRead 409 重试；sent 态 update/delete 抛 INVALID_TRANSITION 不重试 |
| read 态 | 显示"已读"+ 无操作按钮（终态，append-only） | 无写操作 | read 态重复 markRead 抛 INVALID_TRANSITION 不重试 |
| 状态守卫 | 前端按 status 隐藏不可用按钮（Q3 决策①）+ 后端状态守卫双保险 | 状态非法统一抛 `NOTIFICATION_INVALID_TRANSITION`（单码覆盖所有状态非法，N2/N3） | 前端绕过直接调 API 时后端返回 INVALID_TRANSITION，errorMapping 显示"通知状态不允许此操作" |
| DELETE 重试幂等 | draft 行删除按钮 | delete versioned + If-Match | DELETE 重试发生在同次冲突未删成功的场景（409 表示未删除），重试 DELETE 语义安全；若重试时已被其他请求删除则 404 NOTIFICATION_NOT_FOUND，前端刷新移除已不存在行 |

**结论**：这是"状态机前端展示 + versioned 操作"的组合范例——通知 draft/sent/read 三态，按 status 动态显示操作按钮（draft: 编辑/发送/删除；sent: 标记已读；read: 无操作）；4 个 versioned 端点（PATCH/POST send/POST read/DELETE）复用 R12 D9 409 重试，NOTIFICATION_INVALID_TRANSITION 状态守卫错误码不触发重试（client 仅对 VERSION_CONFLICT 重试）。前端按钮隐藏 + 后端状态守卫双保险：前端按 status 隐藏不可用按钮避免误操作；若绕过前端直接调 API（如对 sent 通知调 DELETE），后端返回 NOTIFICATION_INVALID_TRANSITION，前端 errorMapping 显示"通知状态不允许此操作"。**密度高于 R12 1 端点 / R14 1 端点**——R15 一次性引入 4 个 versioned 写端点，全部 If-Match + 409 重试复用 R12 D9，验证 R12 D9 重试策略对"多 versioned 端点同域"的复用密度。

### 1.5 报表动态维度键展示（N6 z.record，动态 schema 前端展示范例）

`reportAggItemSchema = z.record(z.string(), z.union([z.string(), z.number()])).and(z.object({count: z.number().int().min(0)}))`——维度键随 group_by **动态变化**（如 group_by=['operator_id','date'] 则 item 含 `operator_id`/`date`/`count` 键），无法静态枚举字段名。R12/R14 均为固定字段实体（User/Role/Department/RedactedAuditLog），R15 首次验证前端对"动态维度键 record 类型"的渲染适应性：

| 维度 | 动态列渲染（D11） | 类型安全 | 兜底防御 |
|---|---|---|---|
| 列头渲染 | 据 `result.group_by`（原样回显声明的维度）遍历渲染列头（维度列每个 dim 一列 + count 固定列） | ReportAggItem 为 `Record<string, string\|number> & {count: number}`，dim key 为 string，TS 不强制具体键名 | group_by 变化时列头动态更新（如选 ['entity_type','action'] 则列头为"实体类型"+"动作"+"计数"） |
| 行取值 | 每行 item 据 dim key 取值 `item[dim]`（维度值 string\|number）+ `item.count`（计数） | String(item[dim]) 安全转换（z.record 类型保证 string\|number） | `item[dim] !== undefined ? String(item[dim]) : ''` 兜底空字符串（service 层保证含且仅含 group_by 维度键 + count，但前端兜底防御） |
| 维度列中文名 | DIM_LABEL 映射（operator_id→操作者/entity_type→实体类型/action→动作/date→日期） | 纯 UI 文案，R13 S-2 不须同步 Spec §10 但须 Review 报告记录 | 维度列中文名映射为纯 UI 文案 |

**结论**：这是"动态 schema 前端展示"的范例——z.record 承载动态键 + 动态列渲染。`result.group_by` 原样回显声明的维度，ReportTable 据此运行时遍历渲染列头（TS 不强制具体键名，运行时遍历是唯一正确展示）。这与 R12/R14 固定字段实体（User/Role/Department/RedactedAuditLog，TS 接口静态描述字段名）不同——R15 首次验证前端对"动态维度键 record 类型"的渲染适应性，证明 spec-first 工作流对"动态 schema"的适应性：Spec 阶段须明确动态列渲染策略（Q7 决策②动态列）+ 兜底防御（item[dim] undefined 时显示空字符串），impl 阶段须运行时遍历 `result.group_by` 渲染，Reviewer 阶段须核验动态列类型安全 + 兜底防御。

### 1.6 R13/R14 固化提示词在 R15 持续验证（"元改进→业务验证→持续验证"三段闭环）

R13 固化的 S-1（区分两类表单）/ S-2（advisory 文案边界）/ S-3（AC 覆盖矩阵）/ S-4（CODE 扫描器覆盖前端）+ R14 固化的 S-8（api 命名对齐）/ S-9（应用筛选按钮）/ S-10（aria-label 域特定）/ S-11（errorMapping 同步注释）在 R15 全部验证生效。特别是 R14 S-11（errorMapping 扩展同步注释）在 R15 D9 闭合——errorMapping.ts 注释从"REPORT/NOTIFICATION 保持 FALLBACK"更新为"TRANSFER/ROLE_INHERITANCE 保持 FALLBACK"：

| 固化项 | 角色 | R15 验证场景 | 验证结果 |
|---|---|---|---|
| R13 S-1（区分两类表单） | Tech Lead/impl-writer/Reviewer | NotificationForm create/edit（自由文本 safeParse）vs NotificationListPage send/markRead/delete + ReportFilter group_by checkbox/entity_type/action select（类型派生不调 safeParse）+ ReportFilter operated_from/operated_to/operator_id（advisory 客户端校验） | ✅ AC-ARCH-3/ARCH-4 完全对齐（impl 显式标注类型派生操作不调 safeParse + 理由 D5） |
| R13 S-2（advisory 文案同步边界） | Tech Lead/impl-writer/Reviewer | 8 项纯 UI 文案/常量/UX/测试配置类 advisory 偏离（option text 英文 / 动态列空值兜底 / UUID_RE advisory 校验 / fixture 一致性 / PAGE_SIZE 常量化 / URL 持久化 / testTimeout 全局 / UUID_RE 重复定义）+ D8 query 类型扩展 / D18 详情页不消费（行为/数据偏离已同步 §10） | ✅ 2 项已同步 Spec §10（D8/D18）+ 8 项纯 UI 文案/常量/UX 偏离 R13 S-2 不须同步 §10 但须 Review 报告记录（§4 全部记录） |
| R13 S-3（AC 覆盖矩阵自检） | test-writer | PRD §AC↔测试用例覆盖矩阵 + Spec §9.4 矩阵表已标注（54 AC × 测试文件 T1-T9 预估）；test-writer 实际新增 7 文件（5 ③类 + 2 ①类显式影响新增独立文件） | ✅ 54 AC 全覆盖（test-writer AC 覆盖矩阵自检闭合，无未覆盖 AC） |
| R13 S-4（CODE 扫描器覆盖前端） | Reviewer | R15 新增 7 前端文件位于 apps/web/src/，自动受 R13 S-4 CODE 扫描器（CODE-001/002/003/004/AI-005）覆盖，lint:rules exit 0 | ✅ 机器化覆盖持续有效（前端不再是 CODE 扫描盲区） |
| R14 S-8（api 命名对齐 Spec §4.2） | impl-writer | api/notifications.ts + api/reports.ts 函数命名对齐 Spec §4.2 声明（listNotifications/createNotification/updateNotification/sendNotification/markNotificationRead/deleteNotification/queryOperations） | ✅ D20 [约束] 落地，R14 S-8 教训闭合 |
| R14 S-9（文本筛选"应用筛选"按钮） | impl-writer | ReportFilter 含"应用筛选"按钮触发请求（不每键入触发——datetime-local 切换 + operator_id 文本输入均经"应用筛选"按钮原子提交，无须 debounce） | ✅ D12 [约束] 落地，R14 S-9 教训闭合 |
| R14 S-10（aria-label 域特定） | impl-writer | NotificationForm aria-label="通知标题"/"通知内容"/"收件人 ID"；ReportFilter aria-label={dim}（英文）+ span"按X分组"消歧 + select label 加"筛选"后缀消歧 | ✅ D21 [约束] 落地，R14 S-10 教训闭合 |
| R14 S-11（扩展既有模块同步注释） | impl-writer | errorMapping.ts 三处注释同步更新：L18-19/L55/L72 注释从"REPORT/NOTIFICATION/TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"（移除已扩展的 REPORT/NOTIFICATION） | ✅ D9 [约束] 落地，R14 S-11 教训闭合（三处注释同步反映扩展后实际未映射域） |

**结论**：R13 元改进轮固化的 4 项提示词 + R14 固化的 4 项提示词（共 8 项核心 + S-12 Spec 模板层）在 R15 全部验证生效，特别是 R14 S-11（errorMapping 同步注释）在 R15 D9 闭合——errorMapping.ts 三处注释从"REPORT/NOTIFICATION/TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"（移除已扩展的 REPORT/NOTIFICATION）。**证明 R14 教训反推在下一轮生效**——R14 元改进轮固化的提示词在 R15 真实业务中生效，工作流逐轮收敛机制持续有效。这是"元改进→业务验证→持续验证"三段闭环的范例——R13 元改进→R14 首次大规模验证→R15 持续验证，证明工作流逐轮收敛机制在多轮业务下持续生效，非一次性效应。

### 1.7 多约束组合副作用预判 8 条全部正确实现（Spec 模板 §10 持续生效）

Tech-Spec §10 末 8 条组合副作用预判，impl-writer 全部正确规避：

| # | 组合 | Spec §10 预判 | 实现核查 | 结论 |
|---|---|---|---|---|
| 1 | 通知 4 versioned 端点 (D7) + 409 重试复用 R12 D9 + 状态守卫 INVALID_TRANSITION (D10/N2/N3) | 4 versioned 端点全部 If-Match + 409 VERSION_CONFLICT 自动重试；INVALID_TRANSITION（409 但非 VERSION_CONFLICT）不重试，抛 ApiError 由调用方处理；DELETE 重试幂等（409 表示未删除）；重试成功后须刷新列表取最新 version | `api/notifications.ts` 4 端点全部 versioned=true + expectedVersion；client.ts D9 重试仅匹配 `code === 'VERSION_CONFLICT'`，INVALID_TRANSITION 不重试；`NotificationListPage.tsx` 操作成功 → refresh()；NOTIFICATION_NOT_FOUND → refresh() 移除已不存在行；api/notifications.ts 注释明示"409 INVALID_TRANSITION 不重试（非 VERSION_CONFLICT）" | ✅ 正确 |
| 2 | group_by 数组 query (D8) + URLSearchParams repeated key + server.ts m.query.getAll (N5) | api/reports.ts queryOperations 传 group_by: ReportGroupByDim[]，client.ts buildUrl 须拼接为 repeated key `?group_by=A&group_by=B`（对齐 server.ts L341 m.query.getAll('group_by')）；impl 须保证 D8 扩展 query 类型支持 string[] 不破坏既有 number/string query | `client.ts` RequestOptions.query 类型扩展 `Record<string, string \| number \| string[] \| undefined>`；buildUrl 对 Array.isArray 分支逐元素 append（repeated key）；R12 既有 api-client.test.ts `query: { page: 1 }`（number）D8 扩展后不失效；api/reports.ts queryOperations 传 group_by 数组 | ✅ 正确 |
| 3 | errorMapping 扩展 (D9) + SSOT 派生 (R12 D11) + R14 S-11 同步注释 + R14 既有测试不失效 | R15 扩展 SPECIFIC_MESSAGES 新增通知/报表码中文提示，但映射表键仍从 [...errorCodeSchema.options] SSOT 派生；errorCodeSchema 枚举未扩展（通知/报表码本就在枚举内），SSOT 派生断言不失效；扩展时同步更新"未映射码"注释（R14 S-11，注释须反映扩展后实际未映射域如 TRANSFER/ROLE_INHERITANCE）；R14 既有 error-mapping-extend.test.ts 若断言"NOTIFICATION_NOT_FOUND → FALLBACK"会失效，impl-writer 须调整（预估不失效，须 double-check） | `errorMapping.ts:63-68` ERROR_MESSAGES 键从 [...errorCodeSchema.options] SSOT 派生（R12 D11 沿用）；L18-19/L55/L72 三处注释同步反映扩展后实际未映射域（TRANSFER/ROLE_INHERITANCE）；R14 既有 error-mapping-extend.test.ts 不断言 NOTIFICATION/REPORT 码 → 不失效（编排者实跑 1089/1089 全绿核验）；error-mapping-extend-2.test.ts 断言 R12/R14 既有码不破坏 + TRANSFER/ROLE_INHERITANCE FALLBACK | ✅ 正确 |
| 4 | 状态机展示 (Q3/Q11) + 按 status 隐藏按钮 + 状态守卫拒绝统一码 NOTIFICATION_INVALID_TRANSITION | 前端按 status 动态显示操作按钮（draft→编辑/发送/删除、sent→标记已读、read→无），隐藏不可用（Q3 决策①）；status 文案中文化（Q11 决策②）；状态守卫拒绝统一抛 NOTIFICATION_INVALID_TRANSITION（B6 单码覆盖所有状态非法，N2/N3），前端 errorMapping 映射"通知状态不允许此操作"；前端隐藏按钮 + 后端兜底（双保险，前端绕过直接调 API 仍被后端拒绝） | `NotificationListPage.tsx` 按 status 条件渲染按钮（draft→编辑/发送/删除、sent→标记已读、read→无）；STATUS_LABEL={draft:'草稿',sent:'已发送',read:'已读'}；errorMapping NOTIFICATION_INVALID_TRANSITION='通知状态不允许此操作'；前端隐藏 + 后端兜底双保险 | ✅ 正确 |
| 5 | group_by 不预填 (D13) + 客户端 advisory 校验 + 服务端兜底 REPORT_GROUP_BY_REQUIRED (N5) | Q8 决策②不预填默认维度；客户端 advisory 校验 group_by 至少 1 维显示"请至少选择一个分组维度"不发请求；服务端兜底 REPORT_GROUP_BY_REQUIRED（若客户端未拦截直接请求）；AC 同时测客户端拦截 + 服务端码映射 | `ReportFilter.tsx` group_by 默认不勾选；客户端 advisory 校验 group_by 至少 1 维显示"请至少选择一个分组维度"不发请求；errorMapping REPORT_GROUP_BY_REQUIRED='请至少选择一个分组维度'；`report-page.test.tsx` group_by 空拦截用例 + `api-reports.test.ts` 服务端码映射 | ✅ 正确 |
| 6 | 动态列 (D11) + z.record (N6) + DIM_LABEL 中文化映射 + group_by 原样回显 | ReportTable 据 `result.group_by`（原样回显声明的维度）渲染列头；每行 item 据 dim key 取值（`item[dim]`，z.record 类型保证 string\|number）；维度列中文名映射（DIM_LABEL）；count 固定列；group_by 变化时列头动态更新；impl 须保证运行时遍历 result.group_by 渲染（TS 不强制具体键名） | `ReportTable.tsx` 据 `result.group_by` 遍历渲染列头（DIM_LABEL 中文化映射）+ count 固定列；`item[dim] !== undefined ? String(item[dim]) : ''` 兜底空字符串；ReportAggItem 为 `Record<string, string\|number> & {count: number}`，运行时遍历 result.group_by 渲染 | ✅ 正确 |
| 7 | 混合表单 safeParse (D4) + 类型派生操作 (D5) 在 NotificationForm + ReportFilter | NotificationForm create 模式含自由文本（title/content/recipient_id，须 safeParse）；NotificationForm edit 模式含自由文本 partial（须 safeParse）；ReportFilter 含自由文本（operated_from/operated_to/operator_id，客户端字段 advisory 校验）+ 类型派生（group_by checkbox/entity_type/action select，safeParse 冗余）；impl 须对自由文本表单调 safeParse，类型派生操作值经 SSOT options 派生保证合法 | `NotificationForm.tsx` create 模式 createNotificationInputSchema.safeParse（整体校验覆盖 title/content/recipient_id）；edit 模式 updateNotificationInputSchema.safeParse（partial）；ReportFilter operated_from/operated_to/operator_id 客户端字段 advisory 校验；ReportFilter group_by checkbox（options 从 [...reportGroupByDimSchema.options] SSOT 派生）+ entity_type/action select（options 从 [...auditLogEntityTypeSchema.options]/[...auditLogActionSchema.options] SSOT 派生）；NotificationListPage send/markRead/delete 按钮（id/version 从列表派生，TS 类型保证，不调 safeParse） | ✅ 正确 |
| 8 | client.ts query 扩展 (D8) + 后向兼容 + R12 既有测试 | D8 扩展 query 类型支持 string[] 是通用增强，对齐 server.ts getAll 语义；impl 须保证：(1) buildUrl 对数组值多次 append（repeated key）；(2) 空数组跳过；(3) string/number/undefined 行为不变（后向兼容）；(4) R12 既有 api-client.test.ts RequestOptions 断言 `query: { page: 1 }`（number）不失效 | `client.ts` RequestOptions.query 类型扩展 `Record<string, string \| number \| string[] \| undefined>`；buildUrl 对 Array.isArray 分支逐元素 append（repeated key），空数组跳过，string/number/undefined 行为不变；R12 既有 api-client.test.ts:215-217 `query: { page: 1 }`（number）D8 扩展后不失效（编排者实跑 1089/1089 全绿核验） | ✅ 正确 |

**结论**：R12 首次大规模验证 4 条组合副作用预判（401 拦截+409 重试、wire 适配+401 拦截、重试+列表刷新、tokenStore+并发 401），R14 再次验证 7 条组合副作用预判全部正确实现，R15 进一步验证 8 条组合副作用预判全部正确实现。**证明 Spec 模板 §10 组合副作用预判机制在前端全域覆盖下持续生效**——从 R11"被动暴露"（token 碰撞 bug）升级为 R12"主动预判"（4 条），R14 多域下验证（7 条），R15 状态机+聚合域下验证（8 条）。组合 #1（4 versioned + 409 重试 + INVALID_TRANSITION 不重试）是 D7/D10 的关键正确性保证，组合 #2（group_by 数组 query + repeated key）+ #8（client.ts query 扩展后向兼容）是 D8 的关键正确性保证，组合 #3（errorMapping 扩展 + SSOT + R14 S-11 同步注释 + R14 既有测试不失效）的 ①类显式影响预估不失效经 §8.2 判定 pass。

## 2 · 本轮新发现的问题（S 级，不阻断）

### S-13 · impl-writer 测试 setup 改动增多（UUID fixture + testTimeout + label 消歧 + option text）

**现象**：impl-writer 改了 4 处测试 setup/matcher：(1) `notification-form.test.tsx` VALID_UUID fixture `...0000u1`（非 hex）→ `...000001`（有效 hex），根因 createNotificationInputSchema z.string().uuid() 严格校验；(2) `report-page.test.tsx` checkGroupByDim helper 改用英文 dim regex + operator_id 输入值/断言同步 UUID，根因 ReportFilter advisory UUID_RE + getByLabelText(/实体类型/) 同时匹配 checkbox+select 歧义；(3) `vitest.config.ts` testTimeout 5000→20000，根因 user.type 4001 字符超时；(4) `navigation.test.tsx` 4→6 入口断言调整（it 标题 4→6 + 追加 2 条 Link 断言），根因 D17 扩展 Sidebar 6 入口。Reviewer 判定 4 处改动均 pass（非断言弱化），但改动增多。

**根因**：test-writer 阶段部分测试 fixture 不符合 contracts schema 严格校验（非 hex UUID 被 z.string().uuid() 拒绝、超长 content 被 max(4000) 边界对齐但 user.type 逐字符输入超时未预见）；测试 matcher 与实现 label 冲突（checkbox aria-label={dim} 与 select label="实体类型"语义重叠，getByLabelText 部分匹配歧义）；超时未预见（4001 字符 user.type 逐字符输入超 5000ms 默认超时）。

**反推优化**：test-writer 提示词增加：
- "测试 fixture 须符合 contracts schema 严格校验（UUID 用有效 hex 字符 0-9a-f、字符串长度边界对齐 schema min/max，避免 safeParse 失败导致测试永不调用实现）"
- "测试 matcher 须避免与多元素冲突（label/text 唯一性自检——当组件含多个同名/近义 label 时，用 getByRole + name 精确定位或 aria-label 精确匹配，避免 getByLabelText 部分匹配歧义）"
- "长文本输入测试须预估 user.type 超时（user-event 逐字符输入性能限制，>2000 字符建议用 fireEvent.change 一次性设值或 per-test 超时配置 it.timeout）"

### S-14 · ReportFilter label 消歧需实现调整（checkbox vs select vs 表头）

**现象**：ReportFilter checkbox aria-label={dim}（英文维度值，如 'entity_type'）+ select label="实体类型"（中文）+ ReportTable 表头文本"实体类型"（中文），三者语义重叠。impl-writer 调整实现消歧：(1) checkbox aria-label 改用英文维度值（entity_type）+ span"按X分组"消歧；(2) select label 加"筛选"后缀（"实体类型筛选"）消歧；(3) ReportTable 表头文本保持中文。测试用 getByLabelText/getByText 部分匹配时多元素同名冲突，impl-writer 调整实现 + 测试 helper 改用英文 dim regex 精确定位。

**根因**：测试用 getByLabelText/getByText 部分匹配，多元素同名时冲突。前端组件 label/aria-label 文案须避免跨组件冲突——同一页面内 checkbox group、select、table 表头若共用"实体类型"等中文名，getByLabelText(/实体类型/) 会同时匹配多个元素。

**反推优化**：impl-writer 提示词增加"组件 label/aria-label 须跨组件唯一，避免 getByLabelText/getByText 部分匹配冲突；冲突时用 aria-label 精确匹配（如英文维度值）或文案差异化（如加'筛选'后缀、'按X分组' span 消歧）。同一页面内 checkbox group、select、table 表头若共用同一中文名，须至少一处差异化"。

### S-15 · vitest testTimeout 全局放宽（非 per-file）

**现象**：`vitest.config.ts:31-33` testTimeout 5000→20000 全局放宽，根因 `notification-form.test.tsx` content > 4000 safeParse 测试用 `user.type(screen.getByLabelText(/通知内容/i), 'a'.repeat(4001))`，user-event 逐字符输入 4001 字符超过默认 5000ms 超时。注释明示"仅放宽超时上限，不掩盖断言失败"。但全局生效，对其他快速测试也放宽超时，可能掩盖其他测试的真实超时。

**根因**：vitest testTimeout 是全局的，无法 per-file 设置（除非用 it.timeout 或 per-test 第三参数）。全局放宽可能掩盖其他测试的真实超时（如网络 mock 延迟、异步 promise 未 resolve 等场景下，原本应超时失败的测试在 20000ms 内"碰巧"通过）。

**反推优化**：长文本输入测试用 `it('...', () => {...}, 20000)` per-test 超时（vitest 支持 it 第三参数 timeout），非全局放宽。或测试用 `fireEvent.change(element, { target: { value: 'a'.repeat(4001) } })` 一次性设值替代 `user.type` 逐字符输入（fireEvent.change 同步设值无性能限制，对齐 Testing Library 推荐——长文本输入用 fireEvent.change 而非 user.type）。test-writer 提示词增加"长文本输入（>2000 字符）测试用 fireEvent.change 一次性设值替代 user.type 逐字符输入，避免超时"。

### S-16 · 报表动态列空值兜底（Reviewer suggestion）

**现象**：ReportTable 动态列渲染时，若 item 缺某维度键可能渲染空。实现有兜底（`item[dim] !== undefined ? String(item[dim]) : ''` 空字符串），Reviewer 建议未来可考虑展示 '—' 提升可读性。

**根因**：z.record 承载动态键，service 层保证维度键集合（items 每项含且仅含 group_by 声明的维度键 + count），但前端兜底防御（item[dim] 理论可能为 undefined）。空字符串展示为空白，可读性略差。

**反推优化**：impl-writer 提示词增加"动态 schema（z.record）渲染须兜底缺键情况——item[dim] 理论可能为 undefined，须兜底显示（空字符串或 '—' 占位符），避免渲染 NaN/undefined"。Spec 模板 §10 组合副作用预判须含"动态 schema 渲染兜底"项（R15 §10 组合 #6 已预判 impl 须兜底，但未明确占位符样式，未来可明确为 '—' 提升可读性）。

## 3 · 量化对比（十五轮演进表）

| 指标 | R1 | R5 | R7 | R9 | R10 | R11 | R12 | R13 | R14 | R15 |
|---|---|---|---|---|---|---|---|---|---|---|
| 用例数 | 35 | 404 | 537 | 653 | 697 | 778 | 883（api 833 + web 50） | 883（无新增） | 991（api 833 + web 158） | **1089**（api 833 + web 256） |
| 累计用例 | 35 | 404 | 537 | 653 | 697 | 778 | 883 | 883 | 991 | **1089** |
| blocker | 1 | 2(修复0) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| suggestion | 6 | 7 | 2 | 2(impl闭合) | 0 | 3(impl闭合) | 7 | N/A（无 Review） | 8 | **8** |
| Reviewer verdict | pass | blocker→pass | pass | pass | pass | pass | pass | N/A（复盘替代 Review） | pass | **pass** |
| AC 对齐 | N/A | N/A | 16/16 | 18/18 | 17/17 | 23/23 | 47/48（AC-ARCH-4 partial） | N/A（元改进轮） | 68/68 | **54/54**（功能 49 + ARCH 3 + S-1 2） |
| 受影响清单 | 无 | ①类遗漏 | ①②类 | ①②③类 | ①②零+③类 | ①②③（①类二次遗漏） | ①②零影响+③类6文件 | 2 文件（元资产） | ①类1文件边缘+②类0+③类11文件 | **①类1文件调整+②类0+③类7文件**（vs Spec预估7） |
| 影响层 | 全栈 | 全栈 | 全栈 | 全栈 | 单层 | 运行时入口层+新域 | 前端新增层+规则脚本 | 元资产层 | 前端扩展层 | **前端全域收尾层**（api/pages/components 状态机+聚合域新增 + client.ts 既有基础设施扩展） |
| 新架构模式 | 单步CRUD | 跨域埋点 | 多步事务 | HTTP写条件 | HTTP读条件 | 安全域+token验签 | 前端+ARCH-003机器化+wire适配 | 工作流元改进（提示词+扫描器扩展） | 前端多域扩展+versioned DELETE重试复用+递归契约渲染 | **前端全域覆盖+client.ts query类型扩展范例+通知状态机+4 versioned端点+z.record动态列** |
| 轮次类型 | 业务 | 业务 | 业务 | 业务 | 业务 | 业务 | 业务 | 元改进（首个） | 业务（前端多域扩展） | **业务**（前端全域覆盖收尾） |
| ARCH-003 状态 | [预留] | [预留] | [预留] | [预留] | [预留] | [预留] | 闭合（机器化 enforcement） | 闭合（保持） | 闭合（持续合规） | **闭合（持续合规，新增7文件自动覆盖 + client.ts 既有基础设施扩展）** |
| 前端 | 无 | 无 | 无 | 无 | 无 | 无 | 首引入（50用例） | 已存在（扫描器覆盖扩展） | 多域扩展（158 web 用例） | **全域覆盖**（256 web 用例 = R12 50 + R14 108 + R15 87 + 其他） |
| 前端域数 | 0 | 0 | 0 | 0 | 0 | 0 | 2（auth + user） | 2（无业务代码） | 5（auth + user + role + dept + audit） | **7**（auth + user + role + dept + audit + notification + report，全域覆盖） |
| SEC 验证 | mock | mock | mock | mock | mock | 首次真实 | 前端延伸 | 不涉及 | SEC-003b 前端延伸（redactedAuditLogSchema 脱敏态消费） | **不延伸**（通知/报表域无 PII 字段，SEC-003b 不延伸） |
| CODE 扫描器前端覆盖 | N/A | N/A | N/A | N/A | N/A | N/A | ❌ 盲区（手动 grep） | ✅ 机器化（allTs 扩展含 apps/web） | ✅ 机器化持续覆盖 | **✅ 机器化持续覆盖**（新增7文件 exit 0） |
| 提示词骨架条数 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色+8条（S-1/S-2/S-3 固化） | 5角色+8条（R13 固化持续生效）+ S-8~S-12 5条待固化 | **5角色+13条**（R13 8条 + R14 5条持续生效）+ S-13~S-16 4条待固化 |
| 组合副作用预判条数 | 0 | 0 | 0 | 0 | 0 | 0（被动暴露 bug） | 4（首次大规模验证） | N/A（元改进轮） | 7（多域下再次验证全部正确） | **8**（状态机+聚合域下再次验证全部正确） |
| BA 核验 contracts SSOT | N/A | N/A | N/A | N/A | 首次（S-2 教训） | 第二次（PRD 5→Spec 2） | 第三次（GET 不存在→409 重试） | N/A | 第四次（B1-B5 5 处偏离） | **第五次**（N1-N6 6 处偏离） |

> R15 用例数 1089 = api 833（后端冻结，无回归）+ web 256（R12 50 + R14 新增 108 + R15 新增 87 + 其他 11）。web 87 = 7 文件（5 ③类新增 + 2 ①类显式影响新增独立文件）× 平均 ~12 用例/文件（2 API client 契约测 + 3 组件测 + 2 ①类显式影响独立文件）。后端 833 用例基线在本轮前端全域覆盖收尾前已达稳态，R15 不改后端。

## 4 · 十五轮演进脉络

- **第一轮**：建立主干，暴露规则可校验性 P0 缺口
- **第二轮**：规则机器化 100%，暴露声明漂移
- **第三轮**：META-003/004 双向绑定消除漂移
- **第四轮**：三个反推优化点闭环生效
- **第五轮**：三个架构方向落地，首次暴露"测试通过 ≠ 验收对齐"
- **第六轮**："验收对齐"门禁首次闭合——端到端 + Reviewer PRD 双轨
- **第七轮**：多步事务 + 补偿回滚，验证"复杂业务适应性"
- **第八轮**：递归继承 + 环检测，验证"递归数据结构适应性"
- **第九轮**：HTTP 条件请求写条件（If-Match），验证"协议层写扩展适应性"，首次③类测试
- **第十轮**：HTTP 条件请求读条件（ETag + 304），验证"协议层读扩展适应性"，首次单层变更闭合，首次零 suggestion
- **第十一轮**：安全域首落地（登录签发 + token 校验中间件 + 登出吊销），验证"安全域适应性 + 运行时入口层替换"，Ctx 接口不变仅换来源（ARCH-001 闭合），SEC-001/002/003 首次端到端验证
- **第十二轮**：前端首轮（登录页 + 用户列表页 + 前端基础设施），验证 ARCH-003 跨层只经契约从 [预留] 到机器化 enforcement 闭合（R1-R11 唯一未机器化规则闭合），wire 适配 advisory 范例（D10），409 current_version 重试纠正 PRD（D19，R10 S-2 教训再次生效），多约束组合副作用预判首次大规模验证（4 条全部正确实现），零新依赖精神延伸到前端
- **第十三轮**：首个元改进轮（S-1~S-4 固化 R12 反推优化 + S-5 记录未来方向），验证工作流对"自身改进"的适应性——不走标准 PRD→Spec 五角色流程，直接"规划→实施→验证→复盘"精简流程；规则层 S-4 walkWeb 提升顶层 + allTs 扩展含 apps/web，CODE 扫描器覆盖前端（机器化修复 R12 S-4 根因）；提示词层 S-1/S-2/S-3 四角色各 +2 条落地 spec-first-workflow.md（共 8 条）；ARCH-002 误报风险消除（既有扫描器目录隔离设计在扩展时安全）；S-6 AI-005 前端测试盲区 + S-7 元改进轮 Review 缺失记录为未来方向
- **第十四轮**：前端多域扩展（角色/部门/审计三域一次引入，5 域前端），验证前端多域扩展适应性 + R13 固化提示词首次大规模验证 + ①类显式影响处理范例 + 多约束组合副作用 7 条预判全部正确，BA 核验 contracts SSOT 5 处偏离（B1-B5，R10 S-2 教训第三次生效），审计 PII 脱敏态消费（SEC-003b 前端延伸 + ARCH-003 跨层只经契约组合范例），versioned DELETE 重试复用 R12 D9（D7）+ 部门删除非 versioned 有意分歧（D8），递归 Zod schema 前端渲染（DeptNode 递归无深度限制 D12），AC-ARCH-4 完全对齐（优于 R12 partial，R13 S-1 固化生效）
- **第十五轮**：**前端全域覆盖收尾**（通知管理页 + 报表页，新增 notification + report 两域，完成 auth/user/role/dept/audit/notification/report 七域全覆盖），验证**前端全域覆盖适应性 + client.ts 既有基础设施扩展范例（D8 query 类型扩展支持 string[] 后向兼容）+ 通知状态机前端展示 + 4 versioned 端点组合（D7+D10）+ 报表动态维度键 z.record 渲染（D11，N6）+ R13/R14 固化提示词持续验证（特别是 R14 S-11 在 R15 D9 闭合——errorMapping 注释三处更新）+ 多约束组合副作用 8 条预判全部正确**，BA 核验 contracts SSOT 6 处偏离（N1-N6，R10 S-2 教训第四次生效），4 versioned 端点 If-Match + 409 重试复用 R12 D9（密度高于 R12 1 端点 / R14 1 端点），状态守卫 INVALID_TRANSITION 不重试（client 仅对 VERSION_CONFLICT 重试），①类显式影响处理范例再验证（navigation.test.tsx 4→6 入口 + error-mapping-extend.test.ts 预估不失效 + api-client.test.ts D8 后向兼容核验），impl-writer 测试 setup 改动处理范例（UUID hex 校准 + label 消歧 + testTimeout 提升 + navigation 4→6，AI-002 边界 pass），AC-ARCH-3/ARCH-4 完全对齐（R13 S-1 固化持续生效）

## 5 · 反推优化三个层面执行情况

> R13 retro §5 反推的三个层面优化（规则层 + Spec 模板层 + 提示词层）在 R14 多域业务下首次大规模验证，R15 持续验证；R14 retro §5 反推的 S-8~S-12 在 R15 全部注意并闭合（S-8~S-11 提示词层 + S-12 Spec 模板层）；本轮新发现 S-13~S-16 反推至三层面待下一轮固化。

### 5.1 规则层执行情况（反推到 .trae/rules/ + scripts/check-rules.mjs）

| 反推项 | R15 验证状态 | 证据 |
|---|---|---|
| **R13 S-4 规则层固化**：CODE 扫描器覆盖前端（allTs 含 apps/web/src + apps/web/test） | ✅ **R15 持续验证生效** | R15 新增 7 前端文件位于 apps/web/src/，自动受 R13 S-4 CODE 扫描器（CODE-001/002/003/004/AI-005）覆盖，lint:rules exit 0；Reviewer §2 CODE 系列逐条核对合规（0 any / 0 空 catch / 0 eval / 0 Zod schema 命名违规 / SSOT 派生） |
| ARCH-003 校验方式闭合（R12 已落地） | ✅ **R15 持续合规** | R15 新增 7 文件自动受 ARCH-003 分支覆盖（lint:rules exit 0）+ Reviewer 逐文件核对 0 违规 + grep 0 实际 import + META-003/META-004 双向绑定持续闭合。R12 机器化 enforcement 在前端全域覆盖收尾下持续有效。**特别地，D8 client.ts 既有基础设施扩展（query 类型扩展）继续受 ARCH-003 约束**——client.ts 改动仅扩展类型签名 + buildUrl 行为，不引入 apps/api/src 依赖 |
| META 规则双向绑定闭合（R12 已落地） | ✅ **保持** | META-003/META-004 对 ARCH-003 闭合不变，lint:rules 输出"双向绑定已校验"；R15 无规则文件改动，双向绑定持续闭合 |

### 5.2 Spec 模板层执行情况（反推到 Tech-Spec 模板，经 Tech Lead 提示词约束）

| 反推项 | R15 验证状态 | 证据 |
|---|---|---|
| **R13 S-1 根因修复**：§3.2/§6 区分"自由文本表单"（须 safeParse）与"类型派生操作"（TS 类型保证，schema 校验冗余） | ✅ **R15 状态机/聚合域下验证生效** | Tech-Spec §3.2-A 自由文本表单（NotificationForm create/edit、ReportFilter operated_from/operated_to/operator_id advisory）+ §3.2-B 类型派生操作（NotificationListPage send/markRead/delete + ReportFilter group_by checkbox/entity_type/action select，safeParse 冗余）+ §3.2 混合表单提示（NotificationForm 整体 safeParse 覆盖 title/content/recipient_id，recipient_id 字段值经 UUID_RE advisory 校验 + safeParse uuid 格式校验双重保证）；AC-ARCH-3/ARCH-4 完全对齐 |
| **R13 S-2 根因修复**：§10 advisory 同步边界明确（行为/数据/schema 偏离须同步；纯 UI 文案偏离不须同步但须 Review 报告记录） | ✅ **R15 状态机/聚合域下验证生效** | Tech-Spec §10 advisory 文案同步边界明确：2 项已同步 §10（D8 query 类型扩展 / D18 详情页不消费）+ 8 项纯 UI 文案/常量/UX/测试配置偏离 R13 S-2 不须同步 §10 但须 Review 报告记录（§4 全部记录）。Reviewer §4 advisory 偏离核对 8 项均判定合理 |
| **R13 S-3 根因修复**：§9 AC↔测试用例覆盖矩阵表（或经 test-writer 提示词实现 AC 覆盖矩阵自检） | ✅ **R15 状态机/聚合域下验证生效** | PRD §AC↔测试用例覆盖矩阵 + Spec §9.4 矩阵表已标注（54 AC × 测试文件 T1-T9 预估）；test-writer AC 覆盖矩阵自检闭合（54 AC 全覆盖，无未覆盖 AC）；test-writer 实际新增 7 文件对齐 Spec §9.3 预估 |
| **R14 S-12 根因修复**：§9 测试文件数须明确为预估（test-writer 可调整须 AI-006 反向核实） | ✅ **R15 验证生效** | Spec §9.3 计划 7 测试文件（5 ③类 + 2 ①类显式影响新增独立文件），test-writer 实际交付 7 文件（对齐预估，无偏离）。R14 S-12 固化后 Spec §9.3 已明确"测试文件数是预估，test-writer 可据覆盖质量调整但须 AI-006 反向核实注明理由 + Reviewer 判定合理性"，R15 test-writer 据此落地，无偏离 |
| **R15 §9 ①类显式影响预估准确**（R15 新发现） | ✅ **R15 验证生效** | Spec §9.1 预估 ①类显式影响 1~2 文件（R14 navigation.test.tsx 明确 + R12/R14 error-mapping 测试 0~1 文件边缘）+ 0 隐式 + ②类 0。实际 ①类显式影响 1 文件调整（navigation.test.tsx 4→6 入口）+ 1 文件预估不失效（R14 error-mapping-extend.test.ts 不断言 NOTIFICATION/REPORT 码 → 不失效，编排者实跑 1089/1089 全绿核验）+ 1 文件 D8 后向兼容核验（R12 api-client.test.ts RequestOptions query: { page: 1 } number 仍支持）。Spec §9.1 预估准确 |
| **S-16 新发现**：§10 组合副作用预判须含"动态 schema 渲染兜底"项 | ⚠️ **待固化**（本轮新发现） | R15 §10 组合 #6 已预判 impl 须兜底（item[dim] undefined 时显示空字符串），但未明确占位符样式。反推：Spec 模板 §10 组合副作用预判须明确"动态 schema（z.record）渲染须兜底缺键情况——占位符样式（空字符串或 '—'）"，提升可读性 |

### 5.3 提示词层执行情况（反推到五角色提示词骨架 spec-first-workflow.md §2.3~2.6）

#### R13 固化的 8 条提示词 + R14 固化的 5 条提示词（共 13 条）在 R15 持续验证生效

| 固化项 | 角色 | R15 验证场景 | 验证结果 |
|---|---|---|---|
| R13 S-1（区分两类表单） | Tech Lead | §3.2 区分自由文本表单（NotificationForm create/edit、ReportFilter operated_from/operated_to/operator_id）与类型派生操作（NotificationListPage send/markRead/delete + ReportFilter group_by checkbox/entity_type/action select） | ✅ 生效（AC-ARCH-3/ARCH-4 完全对齐） |
| R13 S-1（类型派生操作标注） | impl-writer | NotificationListPage send/markRead/delete + ReportFilter group_by checkbox/entity_type/action select 类型派生操作不调 safeParse 显式标注 [约束] 偏离 + 理由（D5） | ✅ 生效（AC-ARCH-3/ARCH-4 完全对齐） |
| R13 S-1（AC-ARCH-4 partial 判定依据） | Reviewer | AC-ARCH-4 完全对齐（impl 显式标注类型派生操作不调 safeParse + 理由，无需 partial 判定） | ✅ 生效（partial 判定依据已用，但本轮无需 partial） |
| R13 S-2（advisory 同步边界） | Tech Lead | §10 advisory 文案同步边界明确（2 项同步 §10 + 8 项 Review 报告记录） | ✅ 生效（10 项偏离均合理判定） |
| R13 S-2（advisory 同步边界） | impl-writer | 3 项自报 advisory 偏离（option text 英文 / 动态列空值兜底 / UUID_RE advisory 校验）+ Reviewer 发现 5 项（fixture 一致性 / PAGE_SIZE 常量化 / URL 持久化 / testTimeout 全局 / UUID_RE 重复定义） | ✅ 生效（边界判定正确） |
| R13 S-3（AC 覆盖矩阵自检） | test-writer | 54 AC 全覆盖自检 + 组合场景（AC-F1-4 筛选+分页、AC-F7-5 筛选+分页、AC-F3-3/F4-3/F5-4/F6-3 重试+刷新）单独测 | ✅ 生效（54 AC 全覆盖） |
| R13 S-3（组合场景测试） | test-writer | AC-F1-4 筛选+分页复合 + AC-F7-5 筛选+分页复合 + AC-F3-3/F4-3/F5-4/F6-3 重试+刷新 单独测 | ✅ 生效（组合场景已单测） |
| R13 S-4（CODE 扫描器前端覆盖核对） | Reviewer | R13 S-4 固化后 CODE 扫描器覆盖前端，Reviewer 确认 allTs 含 apps/web/src + apps/web/test，无需手动 grep | ✅ 生效（机器化覆盖，Reviewer 信赖扫描器 exit 0） |
| R14 S-8（api 函数命名对齐 Spec） | impl-writer | api/notifications.ts + api/reports.ts 函数命名对齐 Spec §4.2 声明（listNotifications/createNotification/updateNotification/sendNotification/markNotificationRead/deleteNotification/queryOperations） | ✅ 生效（D20 [约束] 落地，R14 S-8 教训闭合） |
| R14 S-9（文本筛选 debounce/应用筛选按钮） | impl-writer | ReportFilter 含"应用筛选"按钮触发请求（不每键入触发——datetime-local 切换 + operator_id 文本输入均经"应用筛选"按钮原子提交，无须 debounce） | ✅ 生效（D12 [约束] 落地，R14 S-9 教训闭合） |
| R14 S-10（aria-label 域特定） | impl-writer | NotificationForm aria-label="通知标题"/"通知内容"/"收件人 ID"；ReportFilter aria-label={dim}（英文）+ span"按X分组"消歧 + select label 加"筛选"后缀消歧 | ✅ 生效（D21 [约束] 落地，R14 S-10 教训闭合） |
| R14 S-11（扩展既有模块同步注释） | impl-writer | errorMapping.ts 三处注释同步更新：L18-19/L55/L72 注释从"REPORT/NOTIFICATION/TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"（移除已扩展的 REPORT/NOTIFICATION） | ✅ 生效（D9 [约束] 落地，R14 S-11 教训闭合，三处注释同步反映扩展后实际未映射域） |
| R14 S-12（Spec §9 测试文件数预估可调整） | Tech Lead | Spec §9.3 计划 7 测试文件，test-writer 实际交付 7 文件（对齐预估，无偏离） | ✅ 生效（R14 S-12 固化后 Spec §9.3 已明确预估可调整，R15 test-writer 据此落地） |

#### R15 新增 S-13~S-16 反推（待下一轮固化）

| R15 新发现项 | 角色 | 反推提示词 | 固化状态 |
|---|---|---|---|
| S-13（测试 fixture 对齐 contracts 严格校验） | test-writer | "测试 fixture 须符合 contracts schema 严格校验（UUID 用有效 hex 字符 0-9a-f、字符串长度边界对齐 schema min/max，避免 safeParse 失败导致测试永不调用实现）" | ⚠️ 待固化 |
| S-13（测试 matcher 唯一性自检） | test-writer | "测试 matcher 须避免与多元素冲突（label/text 唯一性自检——当组件含多个同名/近义 label 时，用 getByRole + name 精确定位或 aria-label 精确匹配，避免 getByLabelText 部分匹配歧义）" | ⚠️ 待固化 |
| S-13（长文本输入超时预估） | test-writer | "长文本输入测试须预估 user.type 超时（user-event 逐字符输入性能限制，>2000 字符建议用 fireEvent.change 一次性设值或 per-test 超时配置 it.timeout）" | ⚠️ 待固化 |
| S-14（组件 label 跨组件唯一） | impl-writer | "组件 label/aria-label 须跨组件唯一，避免 getByLabelText/getByText 部分匹配冲突；冲突时用 aria-label 精确匹配（如英文维度值）或文案差异化（如加'筛选'后缀、'按X分组' span 消歧）。同一页面内 checkbox group、select、table 表头若共用同一中文名，须至少一处差异化" | ⚠️ 待固化 |
| S-15（长文本输入 per-test 超时） | test-writer/impl-writer | "长文本输入（>2000 字符）测试用 fireEvent.change 一次性设值替代 user.type 逐字符输入，避免超时；或用 `it('...', () => {...}, 20000)` per-test 超时（vitest 支持 it 第三参数 timeout），非全局 testTimeout 放宽" | ⚠️ 待固化 |
| S-16（动态 schema 渲染兜底） | impl-writer | "动态 schema（z.record）渲染须兜底缺键情况——item[dim] 理论可能为 undefined，须兜底显示（空字符串或 '—' 占位符），避免渲染 NaN/undefined" | ⚠️ 待固化 |

**合计**：R13 固化的 8 条 + R14 固化的 5 条提示词（共 13 条）在 R15 持续验证全部生效；R15 新增 S-13~S-16 4 项反推（S-13 含 3 条 test-writer 提示词 + S-14 impl-writer 1 条 + S-15 test-writer/impl-writer 1 条 + S-16 impl-writer 1 条，共 6 条提示词）待下一轮固化（S-16 反推至 Spec 模板层，见 §5.2）。

## 6 · 结论 + 剩余改进项

第十五轮是"前端全域覆盖收尾 + client.ts 既有基础设施扩展范例 + 通知状态机 + versioned 组合 + R14 教训反推生效"验证的标志——R12 前端首轮覆盖 auth+user 两域，R14 多域扩展至 5 域，R15 新增通知域（CRUD + 状态机 + 4 versioned 端点）+ 报表域（纯读聚合 + 动态维度），完成前端全域覆盖（七域）。同时验证 R12 client.ts query 类型扩展（D8）的"既有基础设施扩展范例"、通知状态机前端展示 + 4 versioned 端点组合（D7+D10）、报表动态维度键 z.record 渲染（D11，N6）、R13/R14 固化的 13 条提示词在 R15 持续验证生效（特别是 R14 S-11 在 R15 D9 闭合）、多约束组合副作用 8 条预判全部正确实现。

关键证据：
1. **前端全域覆盖完成（七域）**（R15 最大验证点）：R12 前端基础设施（API client / AuthContext / RouteGuard / ErrorBanner / errorMapping）在 R15 状态机域 + 聚合只读域两种新数据形态下零新增基础设施——唯一对既有基础设施的最小后向兼容增强是 D8（client.ts query 类型扩展支持 string[]）。前端覆盖全部后端域（7 域：auth/user/role/dept/audit/notification/report）。ARCH-003 在新增 7 文件下持续合规（lint:rules exit 0 + 逐文件核对 0 违规 + grep 0 实际 import）。证明前端分层架构对 7 域扩展具备适应性，spec-first 工作流对"前端全域"的适应性验证闭合。
2. **BA 核验 contracts SSOT 6 处偏离（N1-N6）—— R10 S-2 教训第四次生效**：BA 一律以 contracts SSOT 为准，Reviewer §3 重点项 1 逐条核对 N1-N6 全部遵循（6/6 ✅）。特别是 N1（pageSize 缺省分歧 10 vs 20）须前端显式传值抹平、N2/N3（状态守卫统一码 + 4 versioned）、N4（recipient_id 延后校验）、N5（group_by 缺省语义判定）、N6（z.record 动态维度键）六处须 AC 精确断言点均以 contracts SSOT 为准。证明 BA 阶段 contracts SSOT 核验已成为稳定实践。
3. **client.ts query 类型扩展（D8）—— 既有基础设施扩展范例**：R12 client.ts `RequestOptions.query` 从 `Record<string, string|number|undefined>` 扩展为 `Record<string, string|number|string[]|undefined>`，支持报表 group_by 数组 repeated key（对齐 server.ts `m.query.getAll`）。**后向兼容**（string/number/undefined 行为不变，R12 api-client.test.ts 既有 number query 断言不失效，编排者实跑 1089/1089 全绿核验）。这是"既有基础设施扩展"的范例——类型扩展 + 后向兼容 + 零新依赖 + ①类显式影响预估准确（0 文件既有断言失效）。区别于"新增基础设施"（R12 client.ts 首次实现）与"新增校验逻辑"（R12 ARCH-003 分支），D8 示范如何在不破坏既有契约的前提下扩展既有基础设施能力。
4. **通知状态机前端展示 + 4 versioned 端点**（状态机 + versioned 组合范例）：通知 draft/sent/read 三态，按 status 动态显示操作按钮（draft: 编辑/发送/删除；sent: 标记已读；read: 无操作）；4 个 versioned 端点（PATCH/POST send/POST read/DELETE）复用 R12 D9 409 重试，NOTIFICATION_INVALID_TRANSITION 状态守卫错误码不触发重试（client 仅对 VERSION_CONFLICT 重试）。前端按钮隐藏 + 后端状态守卫双保险。密度高于 R12 1 端点 / R14 1 端点——R15 一次性引入 4 个 versioned 写端点，验证 R12 D9 重试策略对"多 versioned 端点同域"的复用密度。这是"状态机前端展示 + versioned 操作"的组合范例。
5. **报表动态维度键展示（N6 z.record）**（动态 schema 前端展示范例）：`reportAggItemSchema` 用 z.record 承载动态维度键（group_by 维度随查询变化），ReportTable 据 `result.group_by` 动态渲染列头 + count 固定列，每行 item 据 dim key 取值。这是"动态 schema 前端展示"的范例——z.record 承载动态键 + 动态列渲染，证明 spec-first 工作流对"动态 schema"的适应性。
6. **R13/R14 固化提示词在 R15 持续验证**（"元改进→业务验证→持续验证"三段闭环范例）：R13 固化的 4 项 + R14 固化的 4 项（共 8 项核心 + S-12 Spec 模板层）提示词在 R15 全部验证生效。特别是 R14 S-11（errorMapping 同步注释）在 R15 D9 闭合——errorMapping.ts 三处注释从"REPORT/NOTIFICATION/TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"（移除已扩展的 REPORT/NOTIFICATION）。**证明 R14 教训反推在下一轮生效**——工作流逐轮收敛机制在多轮业务下持续生效，非一次性效应。
7. **多约束组合副作用预判 8 条全部正确实现**：Tech-Spec §10 末 8 条组合副作用（4 versioned + 409 重试 + INVALID_TRANSITION / group_by 数组 query + URLSearchParams / errorMapping 扩展 + SSOT + R14 S-11 同步注释 / 状态机展示 + 隐藏按钮 / group_by 不预填 + advisory + 服务端兜底 / 动态列 + z.record / 混合表单 safeParse / client.ts query 扩展后向兼容）全部正确实现。R12 首次大规模验证 4 条，R14 再次验证 7 条，R15 进一步验证 8 条，证明 Spec 模板 §10 组合副作用预判机制在前端全域覆盖下持续生效。组合 #1（4 versioned + 409 重试 + INVALID_TRANSITION 不重试）+ #2（group_by 数组 query + repeated key）+ #8（client.ts query 扩展后向兼容）是 D8/D9/D7 的关键正确性保证。
8. **①类显式影响处理范例再验证**：R15 D17 扩展 Sidebar 为 6 入口（4→6），导致 R14 navigation.test.tsx 4 入口断言失效；D9 扩展 errorMapping SPECIFIC_MESSAGES 新增通知/报表码，预估 R14 error-mapping-extend.test.ts 不失效（不断言 NOTIFICATION/REPORT 码 → FALLBACK）；D8 扩展 client.ts query 类型，预估 R12 api-client.test.ts 不失效（number 仍支持）。test-writer 提前识别 + impl-writer 合理调整（navigation.test.tsx 4→6 入口 matcher 调整 + ①类显式影响注释标注完整）+ Reviewer 判定 pass（根因 D17 扩展 + 语义增强非弱化 + 注释标注完整）。①类显式影响预估准确（1 文件调整 + 2 文件预估不失效，编排者实跑 1089/1089 全绿核验）。
9. **impl-writer 测试 setup 改动处理范例**：R15 impl-writer 改了 4 处测试 setup/matcher（UUID hex 校准 + label 消歧 + testTimeout 提升 + navigation 4→6），Reviewer 判定 4 处改动均 pass（AI-002 边界：setup 调整属"仅可改 setup/import 路径并注明理由"边界，根因是 contracts 严格校验 / getByLabelText 多匹配歧义 / user-event 性能限制 / D17 扩展，非断言弱化，注释标注完整）。AI-002 边界判定标准清晰（断言 matcher 改动 pass 边界 + setup 调整 pass 边界 vs 断言语义弱化 blocker 边界）。
10. **三件套全绿 + 0 blocker + 54/54 AC 对齐**：typecheck ✅ / lint:rules ✅（ARCH-003 + CODE 扫描器全过）/ vitest ✅ 1089/1089（web 256 = R12 50 + R14 108 + R15 87 + 其他；api 833 无回归）。AC 对齐 54/54（功能 49 + ARCH-003 专项 3 + R13 S-1 专项 2，0 偏离 0 未实现），AC-ARCH-3/ARCH-4 完全对齐。8 项 suggestion 均为文案/常量/UX/测试配置/代码复用类改进，不阻断合入。

这证明：**AI 原生工作流在"前端多域扩展适应性 + R13 固化提示词多域验证"验证（R14）后，进入"前端全域覆盖收尾 + 既有基础设施扩展范例 + 状态机+versioned 组合"验证阶段（R15）**——R12 前端首轮闭合 ARCH-003 机器化（R1-R11 唯一未机器化规则闭合），R13 元改进轮固化 8 条提示词，R14 多域扩展验证 R13 固化提示词在多域下首次大规模生效，**R15 前端全域覆盖收尾验证 R12 前端基础设施在 7 域下持续复用 + R13/R14 固化的 13 条提示词持续生效 + 既有基础设施扩展（D8 client.ts query 类型扩展）范例 + 状态机+versioned 组合（D7+D10）+ 动态 schema 渲染（D11 z.record）**。R14 教训反推在 R15 全部闭合（S-8 api 命名 / S-9 应用筛选按钮 / S-10 aria-label 域特定 / S-11 同步注释三处更新），证明"元改进→业务验证→持续验证"三段闭环有效。Reviewer verdict=pass 0 blocker，证明 spec-first 工作流对"前端全域覆盖收尾"具有适应性，且 R13/R14 固化的提示词在状态机/聚合域下落地。前端全域覆盖完成，可进入"前端质量加固"阶段（E2E/性能/可访问性）。

剩余改进项（S 级，不阻断）：
- **S-5**（R12 遗留，advisory 不强制）：setupFiles 全局副作用——未来若后端测试受 jest-dom matcher 污染，改用 vitest projects 模式分离 node/jsdom 配置（独立 vitest.config.web.ts）。本期不阻断（当前安全，仅追加 matcher）。
- **S-6**（R13 新发现）：AI-005 前端测试盲区——AI-005 分支硬编码目录过滤 `apps/api/test/`，扩展 allTs 后仍只扫后端测试，未覆盖 apps/web/test。前端测试若硬编码跨域可变集合无机器校验。未来改进方向：AI-005 continue 条件扩展含 apps/web/test（须核查正则对前端测试的适用性）。
- **S-7**（R13 新发现）：元改进轮 Review 缺失——R13 是首个元改进轮，无标准 Review 报告（无 PRD AC 可逐条核对），复盘替代 Review 作为质量门禁。未来元改进轮可考虑轻量 Review checklist（核对 S-x 是否全部固化 + 三件套绿 + 改动范围合规 + 探针验证执行）。
- **S-8**（R14 新发现，R15 闭合）：getDeptTree 命名偏离 Spec §4.2.2 getDepartmentTree——R15 D20 [约束] 落地，api/notifications.ts + api/reports.ts 函数命名对齐 Spec §4.2 声明，R14 S-8 教训在 R15 闭合。
- **S-9**（R14 新发现，R15 闭合）：AuditLogPage useEffect 每键入触发请求——R15 D12 [约束] 落地，ReportFilter 含"应用筛选"按钮触发请求（不每键入触发），R14 S-9 教训在 R15 闭合。
- **S-10**（R14 新发现，R15 闭合）：RoleForm/DeptForm aria-label="名称"非"角色名称"/"部门名称"——R15 D21 [约束] 落地，NotificationForm aria-label="通知标题"/"通知内容"/"收件人 ID" + ReportFilter aria-label={dim}（英文）+ span"按X分组"消歧 + select label 加"筛选"后缀消歧，R14 S-10 教训在 R15 闭合。
- **S-11**（R14 新发现，R15 闭合）：errorMapping.ts L62-63 注释过时——R15 D9 [约束] 落地，errorMapping.ts 三处注释（L18-19/L55/L72）同步更新反映扩展后实际未映射域（TRANSFER/ROLE_INHERITANCE），R14 S-11 教训在 R15 闭合。
- **S-12**（R14 新发现，R15 验证生效）：test-writer 测试文件数偏离 Spec §9（11 vs 9）——R14 S-12 固化后 Spec §9.3 已明确"测试文件数是预估，test-writer 可据覆盖质量调整但须 AI-006 反向核实注明理由 + Reviewer 判定合理性"，R15 test-writer 据此落地（7 文件对齐预估，无偏离），R14 S-12 固化项在 R15 验证生效。
- **S-13**（R15 新发现）：impl-writer 测试 setup 改动增多（UUID fixture + testTimeout + label 消歧 + option text）——impl-writer 改了 4 处测试 setup/matcher，Reviewer 判定 pass（非断言弱化），但改动增多。反推：test-writer 提示词增加"测试 fixture 须符合 contracts schema 严格校验（UUID 用有效 hex、字符串长度边界对齐 schema min/max）"+"测试 matcher 须避免与多元素冲突（label/text 唯一性自检）"+"长文本输入测试须预估 user.type 超时"。
- **S-14**（R15 新发现）：ReportFilter label 消歧需实现调整（checkbox vs select vs 表头）——ReportFilter checkbox aria-label={dim} + select label="实体类型" + ReportTable 表头"实体类型"语义重叠，impl-writer 调整实现消歧（checkbox aria-label 英文 + span"按X分组"，select label 加"筛选"后缀）。反推：impl-writer 提示词增加"组件 label/aria-label 须跨组件唯一，避免 getByLabelText/getByText 部分匹配冲突；冲突时用 aria-label 精确匹配或文案差异化"。
- **S-15**（R15 新发现）：vitest testTimeout 全局放宽（非 per-file）——vitest.config.ts testTimeout 5000→20000 全局放宽，因 4001 字符 user.type 超时。反推：长文本输入测试用 `it('...', () => {...}, 20000)` per-test 超时，非全局放宽；或测试用 fireEvent.change 一次性设值替代 user.type 逐字符。
- **S-16**（R15 新发现）：报表动态列空值兜底——ReportTable 动态列渲染时，若 item 缺某维度键可能渲染空，实现有兜底（空字符串）但 Reviewer 建议未来可考虑展示 '—' 提升可读性。反推：impl-writer 提示词增加"动态 schema（z.record）渲染须兜底缺键情况"；Spec 模板 §10 组合副作用预判须含"动态 schema 渲染兜底"项（明确占位符样式）。

> 十五轮演进脉络：R9/R10 验证"协议层扩展适应性"（写条件 + 读条件），R11 验证"安全域适应性"（鉴权），R12 验证"前端域适应性 + ARCH-003 机器化闭合"，R13 验证"工作流自身元改进固化"（S-1~S-4 固化 + S-5 记录），R14 验证"前端多域扩展适应性 + R13 固化提示词多域验证 + ①类显式影响处理范例"，**R15 验证"前端全域覆盖收尾 + client.ts 既有基础设施扩展范例 + 通知状态机+versioned 组合 + R14 教训反推生效"**。R12 证明前端引入可跨层契约机器化闭合（ARCH-003 从 [预留] 到 enforcement），R13 证明工作流元资产改进可经精简流程闭环，R14 证明前端多域扩展可零新增基础设施复用 R12 基础设施 + R13 固化提示词在多域下生效，**R15 证明前端全域覆盖（7 域）可零新增基础设施复用 R12/R14 基础设施 + 既有基础设施扩展（D8）可后向兼容 + 状态机+versioned 组合 + 动态 schema（z.record）渲染 + R13/R14 固化提示词持续生效（特别是 R14 S-11 在 R15 D9 闭合）**。前端全域覆盖已完成，下一轮可考虑进入"前端质量加固"阶段：①后端对齐 wire 字段名消除 D10 适配（server.ts `error`→`code`）；②补 GET /v1/users/:id（R12 §1.3 发现的 gap，消除 D19 不 GET 偏离）；③E2E 测试引入（Playwright 跑真实浏览器+真实后端）；④角色继承管理 UI（R14 Q10 out-of-scope，POST/DELETE /v1/roles/:roleId/parent + GET /v1/roles/:roleId/inheritance-chain 端点已就绪）；⑤调岗 transfer 前端（POST /v1/users/:userId/transfer 端点存在但前端未做）；⑥S-13~S-16 固化（提示词层 S-13~S-15 + Spec 模板层 S-16）；⑦前端全域覆盖已完成，可进入"前端质量加固"阶段如 E2E/性能/可访问性（aria-label 域特定已落地 R14 S-10 + R15 D21，但可进一步 screen reader 端到端测试、键盘导航、色彩对比等可访问性深化）。
