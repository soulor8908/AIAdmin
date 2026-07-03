---
doc_type: PRD-Spec
id: PRD-WEB-NOTIFICATION-REPORT-001
title: 前端通知管理页 + 报表页（R15 前端全域覆盖收尾，auth/user/role/dept/audit/notification/report 七域）
status: decided
# Q&A 决策结果：Q1=②前端显式传pageSize=20(对齐R12D14/R14D21，不依赖契约缺省10) / Q2=①弹窗(modal，对齐R14 RoleForm/DeptForm) / Q3=①按status动态显示可用操作(隐藏不可用，非全显示禁用) / Q4=①自由文本UUID输入(safeParse格式校验，存在性延后至send) / Q5=①多选checkbox(1-4维，SSOT派生options) / Q6=①datetime-local+ISO归一(对齐R14审计Q7①) / Q7=②动态列(维度键随group_by动态变化+count列) / Q8=②不预填默认维度(客户端校验group_by非空advisory+后端REPORT_GROUP_BY_REQUIRED兜底) / Q9=①组件测+API client契约测无E2E(对齐R12Q8②/R14Q12①) / Q10=①扩展SPECIFIC_MESSAGES(通知/报表码加中文) / Q11=②status文案中文化+按status动态显示操作按钮集(draft→编辑/发送/删除、sent→标记已读、read→无操作)
owner: ba@team
created: 2026-07-03
extends: PRD-WEB-ROLE-DEPT-AUDIT-001
aligns: [PRD-NOTIFICATION-001, PRD-AUDIT-ENHANCEMENT-001]
prd_ref: RETRO-ROUND15-001
---

# 前端通知管理页 + 报表页（R15 前端全域覆盖收尾，auth/user/role/dept/audit/notification/report 七域）

## BA 核验发现（contracts SSOT 优先，R10 S-2 / R13 S-1 教训闭合）

> 本节记录 PRD 起草阶段对 `packages/contracts/src/schemas/notification.ts` + `report.ts` + `audit.ts` + `user.ts`（errorCodeSchema SSOT）+ `apps/api/src/server.ts` 路由表（L346-374）的核验结果。任务编排描述与 contracts SSOT 基本一致，仅 1 处须显式标注（N1），无任务描述偏离契约的硬冲突。

| # | 任务描述措辞 | contracts SSOT 实际 | PRD 采取 | 阻塞下游 |
|---|---|---|---|---|
| N1 | "通知列表（分页+status 筛选）" pageSize | `listNotificationQuerySchema.pageSize` 默认 **10**（与 user/role 域一致），上限 100；**注意非 20**（与 audit/report 域 pageSize 默认 20 有意分歧） | 前端显式传 pageSize=20（Q1 决策②，对齐 R12 D14 / R14 D21 不依赖契约缺省），契约缺省 10 仅在不传时生效；通知域与 audit/report 域 pageSize 缺省分歧（10 vs 20）由前端显式传值抹平 | Tech-Spec §3.1 ListNotificationQuery 消费、impl NotificationListPage 默认参数、test 列表用例 |
| N2 | "通知编辑（仅 draft 态，PATCH versioned）" | `updateNotificationInputSchema` 为 partial（title?/content?/recipient_id?，空对象合法）；sent/read 态 update 由 service 状态守卫拒绝抛 `NOTIFICATION_INVALID_TRANSITION`（B6 单码覆盖所有状态非法，非独立"不可编辑"码） | F3 通知编辑 AC 用 `NOTIFICATION_INVALID_TRANSITION` 断言 sent/read 拒绝编辑（非臆造码）；partial 编辑允许空对象（无字段变更） | Tech-Spec §3.2 表单校验、impl NotificationForm edit 模式、test F3 用例 |
| N3 | "通知发送（draft→sent）/ 标记已读（sent→read）/ 删除（仅 draft）" | send/markRead/delete 均 **versioned**（server.ts L359/364/369 第 5 参 true，须 If-Match）；sent/read append-only 不可 update/delete，draft→sent 经 send、sent→read 经 markRead；状态非法统一抛 `NOTIFICATION_INVALID_TRANSITION` | F4/F5/F6 AC 统一用 `NOTIFICATION_INVALID_TRANSITION` 断言状态守卫拒绝；send/markRead/delete 须 If-Match + 409 VERSION_CONFLICT 自动重试（复用 R12 D9） | Tech-Spec §4 API client versioned 复用、impl api/notifications.ts、test F4/F5/F6 |
| N4 | "通知 recipient_id 输入" | `createNotificationInputSchema.recipient_id` 仅 uuid 格式校验，存在性/禁用态校验**延后至 send**（契约 Q8 延后校验，允许"先草稿后发送"工作流）；send 时收件人不存在抛 `NOTIFICATION_RECIPIENT_NOT_FOUND`、收件人 disabled 抛 `NOTIFICATION_RECIPIENT_DISABLED`（区别于通知本身不存在的 `NOTIFICATION_NOT_FOUND`） | Q4 决策①自由文本 UUID 输入 + safeParse uuid 格式校验；create 不触发 RECIPIENT 错误（仅格式校验），RECIPIENT_NOT_FOUND/RECIPIENT_DISABLED 在 F4 send 时触发（AC-F4-4/F4-5） | Tech-Spec §3.2 表单校验分类、impl NotificationForm recipient_id 控件、test F2 + F4 |
| N5 | "报表 group_by 多维选择（1-4 维去重）" | `reportQuerySchema.group_by` 为 `z.array(reportGroupByDimSchema).max(4).optional()`（**不在 schema 层 .min(1) 拒绝空**）；schema 层 superRefine 仅做维度去重 + 时间范围检测；group_by 缺省/空数组由 service 层语义判定 → `REPORT_GROUP_BY_REQUIRED`；operated_from > operated_to → `REPORT_TIME_RANGE_INVALID`；维度重复 → `VALIDATION_ERROR`（router 层"其余 → VALIDATION_ERROR"） | F7 AC：group_by 缺省/空 → `REPORT_GROUP_BY_REQUIRED`（客户端 advisory 校验非空 + 服务端兜底）；operated_from > operated_to → `REPORT_TIME_RANGE_INVALID`；维度重复由 checkbox UI 自然防止（单选 per 维，不会重复） | Tech-Spec §3.1 ReportQuery 消费、impl ReportFilter group_by 控件、test F7-6/F7-7 |
| N6 | "报表聚合结果表格展示" | `reportAggItemSchema = z.record(z.string(), z.union([z.string(), z.number()])).and(z.object({count: z.number().int().min(0)}))`——维度键随 group_by **动态变化**，无法静态枚举字段名；`reportResultSchema.group_by` 原样回显声明的维度 | Q7 决策②动态列（维度键随 group_by 动态生成列 + count 固定列）；ReportTable 据 `result.group_by` 渲染列头，每行 item 据 dim key 取值 | Tech-Spec §6 ReportTable 设计、impl ReportTable 动态列、test F7-8 |

> **核验结论**：通知/报表契约已在 R6/R9 就绪（contracts 冻结，本轮无新增 schema）。任务编排描述与 contracts SSOT 无硬冲突，仅 N1 pageSize 缺省分歧（10 vs 20）须前端显式传值抹平，N2/N3 状态守卫统一码 `NOTIFICATION_INVALID_TRANSITION`、N4 recipient 延后校验、N5/N6 报表 group_by 语义须 AC 精确断言。BA 一律以 contracts SSOT 为准。

## 背景

R12 首次引入前端（apps/web），落地登录页 + 用户列表/创建/启停 + 前端基础设施（API client + 路由守卫 + 错误处理），闭合 ARCH-003「跨层只经契约」从 `[预留]` 到机器化 enforcement（R1-R11 唯一未机器化规则）。R13 固化 S-1~S-4 工作流改进（§3.2 区分自由文本表单 vs 类型派生操作、§10 advisory 文案同步边界、test-writer AC 覆盖矩阵自检 + 组合场景测试、CODE 扫描器覆盖前端）。R14 一次性扩展角色/部门/审计三域前端（5 域），验证 R12 前端基础设施对多域的复用性 + R13 固化提示词在多域下首次大规模验证生效 + ①类显式影响处理范例（errorMapping 扩展 + R12 测试断言）+ 多约束组合副作用 7 条预判全部正确实现 + 审计 PII 脱敏态消费（SEC-003b 前端延伸）。R14 复盘 §6 列出的下一轮候选之首即"前端扩展通知/报表页（更多管理域前端）"。

本期（R15）作为**前端全域覆盖收尾轮次**，在 R12/R14 既有前端基础设施上新增两个管理域页面（通知域 + 报表域），完成前端全域覆盖（auth/user/role/dept/audit/notification/report 七域），验证以下未覆盖的工作流边界：

1. **前端全域覆盖收尾**：R12/R14 已覆盖 5 域（auth/user/role/dept/audit），R15 新增通知域（CRUD + 状态机 draft→sent→read + 多 versioned 写端点）+ 报表域（纯读聚合 + 动态维度 group_by + 动态列表格），完成 7 域前端全覆盖。验证 R12 前端基础设施对"状态机驱动域（通知）"+"聚合只读域（报表）"两种新数据形态的复用性。
2. **versioned 写操作多端点复用再验证**：R12 PATCH /v1/users/:id/status（1 个 versioned 端点）、R14 DELETE /v1/roles/:id（1 个 versioned 端点）；R15 通知域一次性引入 **4 个 versioned 写端点**（PATCH update / POST send / POST read / DELETE），全部须 If-Match + 409 VERSION_CONFLICT 自动重试（复用 R12 D9）。验证 R12 D9 重试策略对"多 versioned 端点同域"的复用密度。
3. **状态机驱动域前端模式**：通知 status 为三态状态机（draft→sent→read，sent/read append-only 不可改不可删），前端须按 status 动态显示可用操作按钮（draft→编辑/发送/删除、sent→标记已读、read→无操作）+ status 文案中文化。R12/R14 均为二元状态（user active/disabled、role 无状态、dept 无状态、audit append-only 无状态），R15 首次验证前端对"三态状态机 + append-only 守卫"的展示与操作策略。
4. **聚合只读域 + 动态维度前端模式**：报表为纯读聚合（非 CRUD），group_by 1-4 维动态选择，聚合结果 items 为动态维度键 + count（`reportAggItemSchema` 用 `z.record` 承载无法静态枚举的维度键）。前端须动态渲染列头（据 `result.group_by`）+ 动态取值（据 dim key）。R12/R14 均为固定字段实体（User/Role/Department/RedactedAuditLog），R15 首次验证前端对"动态维度键 record 类型"的渲染适应性。
5. **R13 S-1 固化在状态机/聚合域下落地**：R15 含自由文本表单（通知创建 title/content/recipient_id、通知编辑 partial）与类型派生操作（通知 send/markRead/delete 按钮、报表 group_by checkbox、报表 filter select）。AC 措辞须精确区分两类（自由文本须 safeParse，类型派生 TS 类型保证），验证 R13 S-1 在状态机/聚合域下的可操作性。
6. **R13 S-3 AC↔测试覆盖矩阵**：R15 PRD 验收标准须标注 AC↔测试用例覆盖矩阵（或注明由 test-writer 阶段补矩阵），验证 S-3 固化在 PRD 阶段的持续落地。
7. **R14 S-8~S-11 教训在本轮注意**：api 模块函数命名须对齐 Spec 声明（S-8）、文本输入筛选须 debounce 或"应用筛选"按钮（S-9，报表 operator_id 文本输入 + 报表整体筛选采用"应用筛选"按钮）、aria-label 须域特定（S-10，通知表单"通知标题"/"通知内容"/"收件人 ID"、报表筛选"分组维度"/"开始时间"/"结束时间"等）、扩展既有模块同步注释（S-11，errorMapping 扩展通知/报表码时同步"未映射码"注释）。

后端已就绪（R1-R14 991 用例基线），**本轮不实现后端任何改动**，contracts 无新增 schema（通知/报表契约在 R6/R9 已就绪）。

## 业务目标

- **目标1（通知列表页）**：通知列表分页展示（GET /v1/notifications，前端显式传 pageSize=20 抹平契约缺省 10，Q1 决策②）+ status 筛选（draft/sent/read，选项从 `notificationStatusSchema.options` SSOT 派生）；空状态 + 加载态；每行按 status 动态显示可用操作按钮（Q3/Q11 决策）+ status 文案中文化（草稿/已发送/已读）。
- **目标2（通知创建）**：自由文本表单（title 1..128 + content 1..4000 + recipient_id uuid，对齐 createNotificationInputSchema），`createNotificationInputSchema.safeParse` 客户端校验；创建后 status='draft'（version=0, sent_at/read_at=null）；recipient_id 仅 uuid 格式校验，存在性延后至 send（N4）。
- **目标3（通知编辑）**：仅 draft 态可编辑（PATCH /v1/notifications/:id versioned + If-Match）；自由文本 partial 表单（title?/content?/recipient_id?，对齐 updateNotificationInputSchema，空对象合法）；sent/read 态编辑被后端状态守卫拒绝（NOTIFICATION_INVALID_TRANSITION）；VERSION_CONFLICT 自动重试 1 次（复用 R12 D9）。
- **目标4（通知发送）**：draft→sent 状态转移（POST /v1/notifications/:id/send versioned + If-Match）；sent/read 态拒绝（NOTIFICATION_INVALID_TRANSITION）；send 时收件人不存在提示 NOTIFICATION_RECIPIENT_NOT_FOUND、收件人 disabled 提示 NOTIFICATION_RECIPIENT_DISABLED（N4 延后校验）；VERSION_CONFLICT 自动重试。
- **目标5（通知标记已读）**：sent→read 状态转移（POST /v1/notifications/:id/read versioned + If-Match）；draft 态拒绝（NOTIFICATION_INVALID_TRANSITION）；read 态拒绝重复标记；VERSION_CONFLICT 自动重试。
- **目标6（通知删除）**：仅 draft 态可删（DELETE /v1/notifications/:id versioned + If-Match）；sent/read 态拒绝（NOTIFICATION_INVALID_TRANSITION，append-only 不可删）；VERSION_CONFLICT 自动重试；NOTIFICATION_NOT_FOUND 提示。
- **目标7（报表页）**：操作统计报表（GET /v1/reports/operations，纯读聚合）；group_by 1-4 维多选 checkbox（options 从 `reportGroupByDimSchema.options` SSOT 派生）+ 时间范围（operated_from/operated_to datetime-local + ISO 归一）+ 筛选（operator_id uuid 文本 + entity_type select + action select）；"应用筛选"按钮触发请求（R14 S-9 教训）；group_by 缺省/空 → REPORT_GROUP_BY_REQUIRED（客户端 advisory 校验 + 服务端兜底）；operated_from > operated_to → REPORT_TIME_RANGE_INVALID；聚合结果表格动态列（维度键随 group_by 动态 + count 固定列）。
- **目标8（导航扩展）**：侧边栏新增通知/报表入口（用户/角色/部门/审计/通知/报表 6 入口 + 登出），路由守卫覆盖 /notifications /reports（复用 R12 RouteGuard，白名单仍仅 /login）。
- **目标9（错误处理扩展）**：errorMapping 扩展通知/报表相关 ErrorCode 中文提示（NOTIFICATION_NOT_FOUND/NOTIFICATION_RECIPIENT_NOT_FOUND/NOTIFICATION_RECIPIENT_DISABLED/NOTIFICATION_INVALID_TRANSITION/REPORT_GROUP_BY_REQUIRED/REPORT_TIME_RANGE_INVALID）；映射表键仍从 errorCodeSchema SSOT 派生（R12 D11 沿用）；扩展时同步更新"未映射码"注释（R14 S-11 教训）。
- **目标10（前端基础设施零新增）**：复用 R12/R14 api/client.ts（Bearer/If-Match/401 拦截/409 重试/wire 适配）、auth/（tokenStore/AuthContext/RouteGuard）、components/ErrorBanner、lib/errorMapping；新增 api/notifications.ts、api/reports.ts；新增 pages/NotificationListPage.tsx、pages/ReportPage.tsx；新增 components/NotificationForm.tsx（创建/编辑）、ReportFilter.tsx（筛选）、ReportTable.tsx（聚合表格）；零新依赖。
- **目标11（ARCH-003 持续合规）**：新增 api/pages/components 模块继续受 ARCH-003 约束——只 import @admin/contracts + apps/web 内部 + 第三方，禁止 import apps/api/src/**。R12 已机器化的 check-rules.mjs ARCH-003 分支自动覆盖新增文件。
- **目标12（验证工作流全域覆盖收尾适应性）**：验证 spec-first 工作流在前端全域覆盖收尾（7 域）下的适应性——PRD（BA，本轮含 contracts SSOT 核验发现 N1~N6）→ Tech-Spec + 契约复用（TechLead，契约冻结无新增）→ 测试先行（含 AC↔测试覆盖矩阵，R13 S-3）→ 实现 → Review（ARCH-003 逐文件 + R13 S-1 自由文本/类型派生区分 + R14 S-8~S-11 教训注意）→ 门禁 G7。

## 用户故事

- 作为管理员，我希望在侧边栏切换进入通知管理页，分页浏览通知、按状态（草稿/已发送/已读）筛选，看到每条通知的标题、收件人、状态与可用操作。
- 作为管理员，我希望创建通知时填写标题、内容、收件人 ID，表单能在提交前校验标题/内容长度与收件人 UUID 格式，避免无效请求。
- 作为管理员，我希望草稿态通知可以编辑（修改标题/内容/收件人）、发送（变为已发送）、删除；已发送通知只能标记已读；已读通知无操作——按钮按状态动态显示，避免误操作。
- 作为管理员，我希望发送通知时若收件人不存在或已禁用，能收到明确提示（"收件人不存在"/"收件人已禁用"），而非笼统失败。
- 作为管理员，我希望编辑/发送/标记已读/删除通知遇到并发冲突时系统自动重试一次（用最新 version），而非让我手动处理版本号。
- 作为管理员，我希望对已发送/已读通知尝试编辑或删除时被明确拒绝（"通知状态不允许此操作"），符合通知 append-only 不可变语义。
- 作为管理员，我希望进入报表页选择 1-4 个分组维度（操作者/实体类型/动作/日期）+ 时间范围 + 筛选条件，点击"应用筛选"后看到操作统计聚合结果（按维度分组 + 计数）。
- 作为管理员，我希望报表的分组维度列随我选择的 group_by 动态变化（如选 operator_id+date 则每行展示操作者+日期+计数），而非固定列。
- 作为管理员，我希望未选择任何分组维度时被提示"请至少选择一个分组维度"，时间范围填反时被提示"开始时间不能晚于结束时间"，避免无效查询。
- 作为管理员，我希望未登录访问通知/报表页时被路由守卫拦截跳转登录页，与 R12/R14 其他页一致。
- 作为系统负责人，我希望新增前端模块继续遵守 ARCH-003（只经契约，不直连后端），错误码映射从 SSOT 派生不漏枚举，且扩展 errorMapping 时同步更新注释。
- 作为系统负责人，我希望通知 title/content 为业务文本非 PII、recipient_id 为 uuid 引用、报表纯计数非 PII，前端不引入新的 PII 处理面。

## 功能点清单

- [ ] F1：通知列表页（GET /v1/notifications?page&pageSize=20&status? 分页 + status 筛选；status 选项从 `notificationStatusSchema.options` SSOT 派生 3 项；空状态；加载态；每行按 status 动态显示操作按钮 + status 文案中文化，Q3/Q11）
- [ ] F2：通知创建（自由文本表单 title 1..128 + content 1..4000 + recipient_id uuid；`createNotificationInputSchema.safeParse`；创建后 status='draft' version=0 sent_at/read_at=null；recipient_id 仅 uuid 格式校验存在性延后至 send，N4）
- [ ] F3：通知编辑（仅 draft 态，PATCH /v1/notifications/:id versioned + If-Match；自由文本 partial 表单 `updateNotificationInputSchema.safeParse`，空对象合法；sent/read 态拒绝 NOTIFICATION_INVALID_TRANSITION；VERSION_CONFLICT 自动重试 1 次复用 R12 D9）
- [ ] F4：通知发送（POST /v1/notifications/:id/send versioned + If-Match，draft→sent；sent/read 态拒绝 NOTIFICATION_INVALID_TRANSITION；send 时 NOTIFICATION_RECIPIENT_NOT_FOUND / NOTIFICATION_RECIPIENT_DISABLED 提示，N4；VERSION_CONFLICT 自动重试）
- [ ] F5：通知标记已读（POST /v1/notifications/:id/read versioned + If-Match，sent→read；draft 态拒绝 NOTIFICATION_INVALID_TRANSITION；read 态拒绝重复标记；VERSION_CONFLICT 自动重试）
- [ ] F6：通知删除（DELETE /v1/notifications/:id versioned + If-Match，仅 draft；sent/read 态拒绝 NOTIFICATION_INVALID_TRANSITION；VERSION_CONFLICT 自动重试；NOTIFICATION_NOT_FOUND 提示）
- [ ] F7：报表页（GET /v1/reports/operations 纯读聚合；group_by 1-4 维多选 checkbox（options 从 `reportGroupByDimSchema.options` SSOT 派生 4 项）；operated_from/operated_to datetime-local + ISO 归一；operator_id uuid 文本输入 + entity_type select + action select；"应用筛选"按钮触发请求 R14 S-9；group_by 缺省/空 → REPORT_GROUP_BY_REQUIRED；operated_from>operated_to → REPORT_TIME_RANGE_INVALID；聚合结果表格动态列 + count 固定列；分页 + 空状态 + 加载态）
- [ ] F8：导航扩展（侧边栏：用户/角色/部门/审计/通知/报表 6 入口 + 登出；路由守卫覆盖 /notifications /reports，复用 R12 RouteGuard 白名单仅 /login）
- [ ] F9：错误处理（errorMapping 扩展 NOTIFICATION_*/REPORT_* 中文提示；映射表键 SSOT 派生；扩展时同步"未映射码"注释 R14 S-11；401 拦截/网络错误复用 R12）
- [ ] F10：前端基础设施复用（API client / AuthContext / RouteGuard / ErrorBanner / tokenStore / lib 复用 R12/R14；新增 api/notifications.ts、api/reports.ts；零新依赖；ARCH-003 持续合规）

## 数据实体草图

**前端无独立数据实体**——全部消费 `@admin/contracts` 经 `z.infer` 派生（ARCH-002/CODE-004 延伸，R12 D3 / R14 D3 沿用）。本轮契约已就绪，无新增 schema。

### 通知域类型（源自 `packages/contracts/src/schemas/notification.ts`）

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `Notification` | `z.infer<typeof notificationSchema>` | 通知实体 `{id, title, content, recipient_id, status, created_at, updated_at, sent_at, read_at, version}`（.strict()，SEC-003a） |
| `NotificationStatus` | `z.infer<typeof notificationStatusSchema>` | 状态枚举 `'draft' \| 'sent' \| 'read'`，status 筛选 select options + 状态文案中文化 + 操作按钮按 status 动态显示的派生源 |
| `CreateNotificationInput` | `z.infer<typeof createNotificationInputSchema>` | 创建表单提交体 `{title(1..128), content(1..4000), recipient_id(uuid)}`，.strict() 拒绝多余字段 |
| `UpdateNotificationInput` | `z.infer<typeof updateNotificationInputSchema>` | 编辑表单提交体 `{title?, content?, recipient_id?}`，partial（空对象合法），.strict() |
| `ListNotificationQuery` | `z.infer<typeof listNotificationQuerySchema>` | `{page(默认1), pageSize(默认**10** max100, N1), status?}`——**前端显式传 pageSize=20 抹平缺省 10**（Q1 决策②） |
| `NotificationListResult` | `z.infer<typeof notificationListResultSchema>` | `{items: Notification[], total, page, pageSize, totalPages}` |

> **状态机前端展示策略**（Q11 决策②）：
> - status 文案中文化：`draft`→"草稿"、`sent`→"已发送"、`read`→"已读"（文案为纯 UI 文案，R13 S-2 不须同步 Spec §10 但须 Review 报告记录）。
> - 操作按钮按 status 动态显示（Q3 决策①隐藏不可用，非全显示禁用）：
>   - `draft`：显示"编辑"/"发送"/"删除"按钮（draft 可编辑/可发送/可删除）
>   - `sent`：显示"标记已读"按钮（sent 仅可 markRead，append-only 不可改不可删）
>   - `read`：无操作按钮（read 为终态，append-only）
> - 状态守卫拒绝统一抛 `NOTIFICATION_INVALID_TRANSITION`（B6 单码覆盖所有状态非法，N2/N3），前端 errorMapping 映射为"通知状态不允许此操作"。

### 报表域类型（源自 `packages/contracts/src/schemas/report.ts` + `audit.ts`）

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `ReportQuery` | `z.infer<typeof reportQuerySchema>` | 查询入参 `{group_by?(array[1..4] of ReportGroupByDim 去重), operated_from?, operated_to?, operator_id?, entity_type?, action?, page(默认1), pageSize(默认20 max100 transform)}`——group_by 缺省/空由 service 层 → REPORT_GROUP_BY_REQUIRED（schema 不在层拒绝空，N5） |
| `ReportGroupByDim` | `z.infer<typeof reportGroupByDimSchema>` | 维度枚举 `'operator_id' \| 'entity_type' \| 'action' \| 'date'`，group_by checkbox options 派生源（4 项） |
| `ReportAggItem` | `z.infer<typeof reportAggItemSchema>` | 聚合行 `Record<string, string\|number> & {count: number}`——**维度键随 group_by 动态变化**（如 group_by=['operator_id','date'] 则 item 含 `operator_id`/`date`/`count` 键），无法静态枚举字段名（N6） |
| `ReportResult` | `z.infer<typeof reportResultSchema>` | `{items: ReportAggItem[], total, page, pageSize, totalPages, group_by: ReportGroupByDim[]}`——`group_by` 原样回显声明的维度，ReportTable 据此渲染列头 |
| `AuditLogEntityType` | `z.infer<typeof auditLogEntityTypeSchema>` | 实体类型枚举 `'user' \| 'role' \| 'dept' \| 'notification' \| 'auth'`（5 项），报表 entity_type select options 派生源（report 复用 audit 枚举） |
| `AuditLogAction` | `z.infer<typeof auditLogActionSchema>` | 动作枚举 `'create' \| 'update' \| 'delete' \| 'login' \| 'login_failed' \| 'logout'`（6 项），报表 action select options 派生源（report 复用 audit 枚举） |

> **报表动态维度键展示策略**（Q7 决策②动态列）：
> - ReportTable 据 `result.group_by`（回显声明的维度）渲染列头：维度列（每个 dim 一列，列头为维度中文名）+ "计数"列（count 固定列）。
> - 每行 item 据 dim key 取值：`item[dim]`（维度值，string|number）+ `item.count`（计数）。
> - 维度列中文名映射（纯 UI 文案，R13 S-2 不须同步 Spec §10 但须 Review 报告记录）：`operator_id`→"操作者"、`entity_type`→"实体类型"、`action`→"动作"、`date`→"日期"。
> - 动态列无法用静态 TS 接口描述，ReportTable 须运行时遍历 `result.group_by` 渲染列（类型上 ReportAggItem 为 record，dim key 为 string，TS 不强制具体键名）。

### 共享类型（源自 `packages/contracts/src/schemas/user.ts`，R12/R14 已消费）

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `ErrorCode` | `z.infer<typeof errorCodeSchema>` | 全局错误码 SSOT（含 NOTIFICATION_*/REPORT_* 等），errorMapping 键派生源 |
| `ErrorResponse` | `z.infer<typeof errorResponseSchema>` | `{code, message, current_version?}`，API client 适配后对外暴露（R12 D10 wire 适配沿用） |

### 客户端表单校验 schema 复用清单（R13 S-1 区分两类）

| 功能点 | 类型 | 复用 schema | 校验点 | AC |
|--------|------|-------------|--------|----|
| F2 通知创建 title/content/recipient_id | **自由文本表单**（须 safeParse） | `createNotificationInputSchema.safeParse` | title 1..128 + content 1..4000 + recipient_id uuid + 拒绝多余字段 | AC-F2-2/3/4/5 |
| F3 通知编辑 title?/content?/recipient_id? | **自由文本表单**（须 safeParse，partial） | `updateNotificationInputSchema.safeParse` | partial（空对象合法）+ 字段约束同 create + 拒绝多余字段 | AC-F3-5 |
| F4 通知发送按钮 | **类型派生操作**（id 从列表派生，TS 类型保证 uuid；versioned 写） | 不调 safeParse（schema 校验冗余）；versioned + If-Match 由 client 注入 | id/version 由列表派生，TS 类型保证 | AC-F4-1 |
| F5 通知标记已读按钮 | **类型派生操作**（同上） | 不调 safeParse | id/version 由列表派生 | AC-F5-1 |
| F6 通知删除按钮 | **类型派生操作**（同上） | 不调 safeParse | id/version 由列表派生 | AC-F6-1 |
| F7 报表 group_by 多选 checkbox | **类型派生操作**（值从 `reportGroupByDimSchema.options` SSOT 派生，TS 类型保证 ∈ 枚举） | 不调 safeParse（checkbox 值经 options 派生保证合法） | 值合法性由 checkbox options 保证 | AC-F7-1 |
| F7 报表 entity_type/action select | **类型派生操作**（值从 `auditLogEntityTypeSchema.options`/`auditLogActionSchema.options` SSOT 派生） | 不调 safeParse | 值合法性由 select options 保证 | AC-F7-4 |
| F7 报表 operated_from/operated_to datetime-local | **自由文本表单**（用户选时间，前端归一 ISO 后须校验） | 前端归一为 ISO datetime 后客户端校验 `from <= to`（advisory，后端兜底 REPORT_TIME_RANGE_INVALID） | from > to 客户端拦截 + 服务端兜底 | AC-F7-7 |
| F7 报表 operator_id uuid 文本输入 | **自由文本表单**（须 uuid 格式校验，advisory） | 前端客户端校验 uuid 格式（advisory，可空，空表示不筛） | uuid 格式客户端拦截（advisory） | AC-F7-3 |

> **R13 S-1 注**：通知 send/markRead/delete 为类型派生操作（id/version 经 TS 类型派生），不调 safeParse；若 impl 不调须显式标注 [约束] 偏离 + 反向同步 Spec §3.2（R13 S-1）。报表 group_by checkbox / entity_type/action select 同理。报表 operated_from/operated_to/operator_id 含自由输入，前端客户端校验为 advisory（后端兜底），不强制 safeParse reportQuerySchema（reportQuerySchema 非 strict 且含 superRefine，前端表单按字段分别校验即可）。

### 新增 api 模块设计（对齐 R12 api/users.ts / R14 api/roles.ts 风格，R14 S-8 命名须对齐 Spec §4.2）

- `apps/web/src/api/notifications.ts`：
  - `listNotifications(query: ListNotificationQuery): Promise<NotificationListResult>` → GET /v1/notifications（query 拼接 page/pageSize=20/status?；调用方显式传 pageSize=20，Q1）
  - `createNotification(input: CreateNotificationInput): Promise<Notification>` → POST /v1/notifications（body）
  - `updateNotification(id: string, input: UpdateNotificationInput, expectedVersion: number): Promise<Notification>` → PATCH /v1/notifications/:id（versioned=true，If-Match=expectedVersion；409 由 client D9 自动重试）
  - `sendNotification(id: string, expectedVersion: number): Promise<Notification>` → POST /v1/notifications/:id/send（versioned=true，If-Match；draft→sent）
  - `markNotificationRead(id: string, expectedVersion: number): Promise<Notification>` → POST /v1/notifications/:id/read（versioned=true，If-Match；sent→read）
  - `deleteNotification(id: string, expectedVersion: number): Promise<void>` → DELETE /v1/notifications/:id（versioned=true，If-Match；仅 draft；409 由 client D9 自动重试）
  - **注**：GET /v1/notifications/:id（cacheable）端点存在但本轮不消费（列表 items 已含完整 Notification，编辑表单预填用列表项数据，无须 GET 单条；对齐 R14 Q9 决策②不消费 GET /:id 的精神）。
- `apps/web/src/api/reports.ts`：
  - `queryOperations(query: ReportQuery): Promise<ReportResult>` → GET /v1/reports/operations（query 拼接 group_by[]/operated_from/operated_to/operator_id/entity_type/action/page/pageSize=20）
  - **Tech-Spec 考量项**：`group_by` 为数组，wire 须以 repeated key 拼接（`?group_by=operator_id&group_by=date`，server.ts L341 `m.query.getAll('group_by')`）。R12 client.ts `RequestOptions.query` 类型为 `Record<string, string | number | undefined>`，**不支持数组值**。Tech-Spec 须决策：①扩展 `RequestOptions.query` 类型支持 `string[]`（client.ts buildUrl 对数组值多次 append）；②api/reports.ts 内部手动拼接 group_by query string 后传入 path（绕过 client buildUrl）。推荐①（扩展 query 类型支持数组是通用增强，对齐 server.ts `getAll` 语义，零新依赖，R12 client.ts 已用 URLSearchParams.append 自然支持 repeated key）。**不阻塞 PRD**（属 Tech-Spec D-level 决策），AC 仅断言"调 GET /v1/reports/operations?group_by=A&group_by=B"。

### PII / 敏感字段清单（安全域标注）

| 字段 | 来源 | 敏感等级 | 前端处理 |
|------|------|----------|----------|
| 通知 `title`/`content` | 通知域 | 低（业务文本，**非 PII**，contracts 注释明示） | 展示/输入用，无特殊处理 |
| 通知 `recipient_id` | 通知域 | 低（uuid 引用，**非 PII**，contracts 注释明示） | 展示/输入用，无特殊处理 |
| 通知 `id`/`status`/时间戳/`version` | 通知域 | 低（标识/状态/时间） | 展示用 |
| 报表聚合 `count`/维度值 | 报表域 | 低（纯计数 + 维度值，**非 PII**，contracts 注释明示"report 聚合维度均为非 PII 字段，仅返回计数"） | 展示用 |
| 报表 `operator_id`（group_by 维度值） | 报表域 | 中（uuid，关联用户，**非 PII 但关联标识**） | 展示用，禁止 console.log / 日志记录（沿用 R14 审计 operator_id 处理） |
| `token` | R12 沿用 | 高 | 沿用 R12 D12（localStorage，禁止 console.log） |

> 通知/报表域**无 PII 字段**（contracts 明示 title/content 为业务文本、recipient_id 为 uuid 引用、report 纯计数）。R15 不引入新的 PII 处理面，SEC-003b 不延伸（无脱敏态/存储态区分，通知/报表均无 PII 字段需脱敏）。通知/报表域须确认 `notification:read`/`notification:write`/`report:read` 权限由后端 SEC-002 强制（前端不预判权限，依赖后端 FORBIDDEN 返回时显示"无权限"）。

## 验收标准（Given/When/Then）—— AI-007 端到端验收依据

> 全部 AC 须可被前端测试覆盖（Vitest + Testing Library，Q9 决策①对齐 R12 Q8② / R14 Q12①）。AC 编号对齐功能点 F1~F10 + ARCH-003 合规专项 + R13 S-1 合规专项。
> **R13 S-3 固化**：每条 AC 标注覆盖它的测试文件（T#）+ 用例号占位（由 test-writer 阶段最终确认），未覆盖显式列 reason。覆盖矩阵汇总见本节末。
> **R13 S-1 固化**：AC 措辞精确区分"自由文本表单（须 safeParse）"与"类型派生操作（TS 类型保证，safeParse 冗余）"。
> **R14 S-9 教训**：报表筛选含文本输入（operator_id）+ datetime-local，须"应用筛选"按钮触发请求（不可每键入触发）。

### F1 通知列表页

- **AC-F1-1 列表首次加载**：GIVEN 已登录 / WHEN 访问 /notifications / THEN 调 GET /v1/notifications?page=1&pageSize=20（前端显式传 pageSize=20，Q1 决策②，不依赖契约缺省 10，N1），渲染 items（每行展示 title/recipient_id/status 文案中文化 + 按 status 动态显示操作按钮，Q3/Q11）。覆盖：T3 [test-writer 定号]
- **AC-F1-2 分页切换**：GIVEN total > pageSize（多页）/ WHEN 点击第 2 页 / THEN 调 GET /v1/notifications?page=2&pageSize=20，渲染第 2 页数据。覆盖：T3
- **AC-F1-3 status 筛选**：GIVEN 列表含 draft+sent+read 通知 / WHEN 选择 status=sent 筛选 / THEN 调 GET /v1/notifications?status=sent&page=1&pageSize=20，仅渲染 sent 通知；status 选项从 `notificationStatusSchema.options` SSOT 派生（3 项：draft/sent/read，AI-005）。覆盖：T3、T9（SSOT 派生断言）
- **AC-F1-4 筛选+分页复合**（R13 S-3 组合场景）：GIVEN 已选 status=sent 且多页 / WHEN 翻页 / THEN 调 GET /v1/notifications?status=sent&page=2&pageSize=20，保持筛选条件。覆盖：T3
- **AC-F1-5 空状态**：GIVEN 无满足筛选条件通知 / THEN 列表区域显示空状态文案（如"暂无通知"），不报错。覆盖：T3
- **AC-F1-6 加载态**：GIVEN 请求进行中 / THEN 列表区域显示 loading 文案（沿用 R12 D16）。覆盖：T3
- **AC-F1-7 status 文案中文化 + 操作按钮按 status 动态显示**（Q3/Q11）：GIVEN items 含 draft/sent/read 三态通知 / THEN draft 行显示"草稿"+ "编辑"/"发送"/"删除"按钮；sent 行显示"已发送"+ "标记已读"按钮（无编辑/发送/删除）；read 行显示"已读"+ 无操作按钮（Q3 决策①隐藏不可用，非全显示禁用）。覆盖：T3

### F2 通知创建（自由文本表单，须 safeParse，R13 S-1）

- **AC-F2-1 创建成功**：GIVEN 合法 title + content + recipient_id（uuid 格式，无须存在，N4）/ WHEN 提交 / THEN `createNotificationInputSchema.safeParse` 通过，调 POST /v1/notifications 返回 Notification（status='draft', version=0, sent_at=null, read_at=null），弹窗关闭，列表刷新含新通知。覆盖：T4
- **AC-F2-2 表单校验-title 空**（自由文本，须 safeParse）：GIVEN title 为空 / WHEN 提交 / THEN `createNotificationInputSchema.safeParse` 拦截（min(1)），显示"通知标题必填"，不发请求。覆盖：T4
- **AC-F2-3 表单校验-title 超长**（自由文本，须 safeParse）：GIVEN title > 128 字符 / WHEN 提交 / THEN safeParse 拦截（max(128)），显示"通知标题不超过 128 字符"，不发请求。覆盖：T4
- **AC-F2-4 表单校验-content 空/超长**（自由文本，须 safeParse）：GIVEN content 为空或 > 4000 字符 / WHEN 提交 / THEN safeParse 拦截（min(1).max(4000)），显示"通知内容必填"/"通知内容不超过 4000 字符"，不发请求。覆盖：T4
- **AC-F2-5 表单校验-recipient_id 非 uuid**（自由文本，须 safeParse）：GIVEN recipient_id 非 uuid 格式（如 "abc"）/ WHEN 提交 / THEN safeParse 拦截（z.string().uuid()），显示"收件人 ID 须为 UUID 格式"，不发请求。覆盖：T4
- **AC-F2-6 create 仅 recipient_id uuid 格式校验**（N4 延后校验）：GIVEN recipient_id 为合法 uuid 但实际不存在 / WHEN 创建 / THEN **创建成功**（status='draft'），不触发 NOTIFICATION_RECIPIENT_NOT_FOUND（存在性延后至 send，契约 Q8 延后校验，允许"先草稿后发送"工作流）。覆盖：T4、T1（API client 契约）

### F3 通知编辑（仅 draft 态，PATCH versioned，自由文本 partial，R13 S-1）

- **AC-F3-1 编辑成功**（draft 态，versioned）：GIVEN draft 通知（version=N）/ WHEN 点击"编辑"修改 title/content/recipient_id 后提交 / THEN `updateNotificationInputSchema.safeParse` 通过（partial），调 PATCH /v1/notifications/:id + If-Match: N，返回 Notification（version=N+1），弹窗关闭，列表刷新。覆盖：T4
- **AC-F3-2 sent/read 态拒绝编辑**（N2 状态守卫）：GIVEN sent 或 read 通知 / WHEN 尝试编辑（前端按 status 隐藏编辑按钮，AC-F1-7；若绕过直接调 PATCH）/ THEN 后端返回 NOTIFICATION_INVALID_TRANSITION，前端显示"通知状态不允许此操作"。覆盖：T4、T9
- **AC-F3-3 VERSION_CONFLICT 自动重试**：GIVEN 列表 notification.version=N 但实际已变 N+1 / WHEN PATCH 返回 409 VERSION_CONFLICT（含 current_version=N+1）/ THEN API client 自动用 current_version=N+1 重试 PATCH 一次（复用 R12 D9，不 GET 单条），成功后列表刷新。覆盖：T1（API client 契约）、T4
- **AC-F3-4 重试仍冲突提示**：GIVEN 重试后仍返回 409 / THEN 显示"数据已被修改，请刷新后重试"（沿用 R12 AC-F4-4），不无限重试（仅 1 次）。覆盖：T1、T4
- **AC-F3-5 表单校验 partial**（自由文本，须 safeParse）：GIVEN 编辑表单提交空对象（无字段变更）/ THEN `updateNotificationInputSchema.safeParse({})` 通过（partial 空对象合法），调 PATCH（body={}，无字段变更），后端接受返回原 Notification（version+1，N2）；若提交含非法字段（如 status）则 safeParse 拒绝多余字段（.strict()）。覆盖：T4

### F4 通知发送（POST send，draft→sent，versioned，类型派生操作，R13 S-1）

- **AC-F4-1 发送成功**（类型派生操作，id/version 从列表派生，TS 类型保证，不调 safeParse）：GIVEN draft 通知（version=N）/ WHEN 点击"发送" / THEN 调 POST /v1/notifications/:id/send + If-Match: N，返回 Notification（status='sent', sent_at 非空, version=N+1），列表刷新该通知变 sent 态。覆盖：T3、T1
- **AC-F4-2 sent/read 态拒绝发送**（N3 状态守卫）：GIVEN sent 或 read 通知 / WHEN 尝试发送（前端按 status 隐藏发送按钮；若绕过）/ THEN 后端返回 NOTIFICATION_INVALID_TRANSITION，前端显示"通知状态不允许此操作"。覆盖：T3、T9
- **AC-F4-3 VERSION_CONFLICT 自动重试**：GIVEN 列表 version=N 但实际 N+1 / WHEN POST send 返回 409 VERSION_CONFLICT / THEN API client 自动用 current_version=N+1 重试 POST send 一次，成功后列表刷新。覆盖：T1、T3
- **AC-F4-4 RECIPIENT_NOT_FOUND**（N4 send 时延后校验）：GIVEN draft 通知 recipient_id 合法 uuid 但实际不存在 / WHEN 发送 / THEN 后端返回 NOTIFICATION_RECIPIENT_NOT_FOUND，前端显示"收件人不存在"。覆盖：T3、T9
- **AC-F4-5 RECIPIENT_DISABLED**（N4 send 时延后校验）：GIVEN draft 通知 recipient_id 对应用户 status=disabled / WHEN 发送 / THEN 后端返回 NOTIFICATION_RECIPIENT_DISABLED，前端显示"收件人已禁用"。覆盖：T3、T9

### F5 通知标记已读（POST read，sent→read，versioned，类型派生操作，R13 S-1）

- **AC-F5-1 标记已读成功**（类型派生操作，id/version 从列表派生，不调 safeParse）：GIVEN sent 通知（version=N）/ WHEN 点击"标记已读" / THEN 调 POST /v1/notifications/:id/read + If-Match: N，返回 Notification（status='read', read_at 非空, version=N+1），列表刷新该通知变 read 态。覆盖：T3、T1
- **AC-F5-2 draft 态拒绝标记已读**（N3 状态守卫）：GIVEN draft 通知 / WHEN 尝试标记已读（前端按 status 隐藏标记按钮；若绕过）/ THEN 后端返回 NOTIFICATION_INVALID_TRANSITION，前端显示"通知状态不允许此操作"。覆盖：T3、T9
- **AC-F5-3 read 态拒绝重复标记**（N3 状态守卫）：GIVEN read 通知 / WHEN 尝试再次标记已读 / THEN 后端返回 NOTIFICATION_INVALID_TRANSITION，前端显示"通知状态不允许此操作"（read 为终态，不可重复转移）。覆盖：T3、T9
- **AC-F5-4 VERSION_CONFLICT 自动重试**：GIVEN 列表 version=N 但实际 N+1 / WHEN POST read 返回 409 VERSION_CONFLICT / THEN API client 自动用 current_version=N+1 重试 POST read 一次，成功后列表刷新。覆盖：T1、T3

### F6 通知删除（DELETE，仅 draft，versioned，类型派生操作，R13 S-1）

- **AC-F6-1 删除成功**（类型派生操作，id/version 从列表派生，不调 safeParse）：GIVEN draft 通知（version=N）/ WHEN 点击"删除" / THEN 调 DELETE /v1/notifications/:id + If-Match: N，返回 204，列表刷新不含该通知。覆盖：T3、T1
- **AC-F6-2 sent/read 态拒绝删除**（N3 状态守卫，append-only 不可删）：GIVEN sent 或 read 通知 / WHEN 尝试删除（前端按 status 隐藏删除按钮；若绕过）/ THEN 后端返回 NOTIFICATION_INVALID_TRANSITION，前端显示"通知状态不允许此操作"。覆盖：T3、T9
- **AC-F6-3 VERSION_CONFLICT 自动重试**：GIVEN 列表 version=N 但实际 N+1 / WHEN DELETE 返回 409 VERSION_CONFLICT / THEN API client 自动用 current_version=N+1 重试 DELETE 一次（复用 R12 D9，DELETE 重试幂等——重试发生在同次冲突未删成功的场景，409 表示未删除），成功后列表刷新。覆盖：T1、T3
- **AC-F6-4 NOTIFICATION_NOT_FOUND**：GIVEN id 合法 uuid 但无记录 / WHEN 删除 / THEN 后端返回 NOTIFICATION_NOT_FOUND，前端显示"通知不存在"，列表刷新。覆盖：T3、T9

### F7 报表页（纯读聚合，动态维度）

- **AC-F7-1 group_by 多维选择**（类型派生操作，checkbox，SSOT 派生，R13 S-1）：GIVEN group_by 选项从 `reportGroupByDimSchema.options` SSOT 派生（4 项：operator_id/entity_type/action/date）/ THEN 表单 checkbox 控件选项 = 4 项全集（SSOT 派生，AI-005）；用户可勾选 1-4 维，checkbox 单选 per 维自然去重（N5，无重复维度问题）；选中后请求体 group_by 为选中数组（max 4）。覆盖：T5、T9（SSOT 派生断言）
- **AC-F7-2 时间范围筛选**（自由文本 datetime-local，前端归一 ISO）：GIVEN 选择 operated_from + operated_to（datetime-local）/ WHEN 点击"应用筛选" / THEN 前端归一为 ISO 8601 datetime（如 `2026-07-03T12:00:00Z`），调 GET /v1/reports/operations?operated_from=<ISO>&operated_to=<ISO>&group_by=...&page=1。覆盖：T5
- **AC-F7-3 operator_id 筛选**（自由文本 uuid，advisory 校验，R14 S-9 应用筛选按钮）：GIVEN 输入 operator_id（uuid）/ WHEN 点击"应用筛选"（**不每键入触发请求**，R14 S-9 教训）/ THEN 调 GET /v1/reports/operations?operator_id=<uuid>&group_by=...&page=1；operator_id 为空表示不筛；[advisory] 客户端校验 uuid 格式（非 uuid 时提示"操作者 ID 须为 UUID 格式"，advisory 不强制 safeParse）。覆盖：T5
- **AC-F7-4 entity_type + action 筛选**（类型派生操作，select，SSOT 派生）：GIVEN entity_type 选项从 `auditLogEntityTypeSchema.options` SSOT 派生（5 项）+ action 选项从 `auditLogActionSchema.options` SSOT 派生（6 项）/ WHEN 选择 entity_type=role + action=create + 点击"应用筛选" / THEN 调 GET /v1/reports/operations?entity_type=role&action=create&group_by=...&page=1。覆盖：T5、T9（SSOT 派生断言）
- **AC-F7-5 筛选+分页复合**（R13 S-3 组合场景）：GIVEN 已选 group_by+筛选条件且多页 / WHEN 翻页 / THEN 调 GET /v1/reports/operations?group_by=...&<筛选>&page=2&pageSize=20，保持筛选条件。覆盖：T5
- **AC-F7-6 group_by 缺省/空 → REPORT_GROUP_BY_REQUIRED**（N5）：GIVEN 未勾选任何 group_by 维度（group_by 缺省或空数组）/ WHEN 点击"应用筛选" / THEN [advisory] 客户端校验 group_by 至少 1 维，显示"请至少选择一个分组维度"不发请求（Q8 决策②不预填默认维度）；[服务端兜底] 若客户端未拦截直接请求，后端返回 REPORT_GROUP_BY_REQUIRED，errorMapping 显示"请至少选择一个分组维度"。覆盖：T5、T2（API client 契约：服务端码映射）、T9
- **AC-F7-7 operated_from > operated_to → REPORT_TIME_RANGE_INVALID**（N5）：GIVEN operated_from 晚于 operated_to / WHEN 点击"应用筛选" / THEN [advisory] 客户端校验 from <= to，显示"开始时间不能晚于结束时间"不发请求；[服务端兜底] 若客户端未拦截，后端返回 REPORT_TIME_RANGE_INVALID，errorMapping 显示"开始时间不能晚于结束时间"。覆盖：T5、T2、T9
- **AC-F7-8 聚合结果表格动态列**（N6，Q7 决策②动态列）：GIVEN 响应 ReportResult（group_by=['operator_id','date']）/ THEN ReportTable 据 `result.group_by` 渲染列头（"操作者"列 + "日期"列 + "计数"列），每行 item 据 dim key 取值（`item['operator_id']`/`item['date']`/`item.count`）；group_by 变化时列头动态更新（如选 ['entity_type','action'] 则列头为"实体类型"+"动作"+"计数"）。覆盖：T5
- **AC-F7-9 分页 + 空状态 + 加载态**：GIVEN 响应含 total/totalPages / THEN 页面展示"共 X 条，第 Y/Z 页"；GIVEN 无满足条件聚合结果 / THEN 显示空状态文案（如"暂无统计数据"）；GIVEN 请求进行中 / THEN 显示 loading 文案。覆盖：T5

### F8 导航扩展

- **AC-F8-1 侧边栏 6 入口**：GIVEN 已登录任意受保护页 / THEN 侧边栏展示"用户/角色/部门/审计/通知/报表"6 个入口 + "登出"按钮（Q8 决策①侧边栏沿用，R14 4 入口扩展为 6 入口）。覆盖：T6（扩展 R14 navigation.test.tsx，①类显式影响）
- **AC-F8-2 入口可达**：GIVEN 点击侧边栏"通知" / THEN 跳转 /notifications 并渲染 NotificationListPage；"报表"→ /reports 并渲染 ReportPage。覆盖：T6
- **AC-F8-3 路由守卫覆盖新页**：GIVEN 未登录 / WHEN 访问 /notifications 或 /reports / THEN RouteGuard 跳转 /login（复用 R12 D13 白名单仅 /login）。覆盖：T6

### F9 错误处理

- **AC-F9-1 错误码映射扩展-通知域**：GIVEN NOTIFICATION_NOT_FOUND/NOTIFICATION_RECIPIENT_NOT_FOUND/NOTIFICATION_RECIPIENT_DISABLED/NOTIFICATION_INVALID_TRANSITION / THEN errorMapping 输出对应中文（"通知不存在"/"收件人不存在"/"收件人已禁用"/"通知状态不允许此操作"）。覆盖：T9
- **AC-F9-2 错误码映射扩展-报表域**：GIVEN REPORT_GROUP_BY_REQUIRED/REPORT_TIME_RANGE_INVALID / THEN errorMapping 输出对应中文（"请至少选择一个分组维度"/"开始时间不能晚于结束时间"）。覆盖：T9
- **AC-F9-3 SSOT 派生 + 401/网络错误复用 R12**：GIVEN errorMapping 映射表 / THEN 键从 `[...errorCodeSchema.options]` SSOT 派生（沿用 R12 D11），新增通知/报表码自动覆盖，枚举扩展不漏；扩展 SPECIFIC_MESSAGES 时同步更新"未映射码"注释（R14 S-11 教训，注释须反映扩展后实际未映射域如 TRANSFER/ROLE_INHERITANCE）。GIVEN 任意新页面请求返回 401（鉴权类 4 码）/ THEN API client 沿用 R12 D8 拦截跳 /login；GIVEN fetch 抛错 / THEN 沿用 R12 AC-F7-3 显示"网络异常，请稍后重试"。覆盖：T9、T1（沿用 R12/R14 api-client 测）

### F10 前端基础设施复用 + ARCH-003 合规专项

- **AC-F10-1 API client 复用**：GIVEN 任意新页面 HTTP 调用 / THEN 经 R12 `apps/web/src/api/client.ts` 的 request() 发出，不直接调 fetch。覆盖：T1/T2
- **AC-F10-2 Bearer/If-Match 注入复用**：GIVEN 已登录 + versioned 写（PATCH update / POST send / POST read / DELETE notification）/ THEN 请求头含 `Authorization: Bearer <token>`（R12 D6）+ `If-Match: <version>`（R12 D7）。覆盖：T1
- **AC-F10-3 零新依赖**：GIVEN apps/web/package.json / THEN 本轮无新增 dependencies/devDependencies（沿用 R12/R14 依赖清单）。覆盖：T6（或工程核验，由 test-writer 定）
- **AC-ARCH-1 新增模块不直连后端**：GIVEN apps/web/src 新增文件（api/notifications.ts、api/reports.ts、pages/NotificationListPage.tsx、pages/ReportPage.tsx、components/NotificationForm.tsx、components/ReportFilter.tsx、components/ReportTable.tsx）+ 扩展文件（components/Sidebar.tsx、App.tsx、lib/errorMapping.ts）/ THEN 无任何 import 指向 apps/api/src/**（repository/service/domain/router）或 @admin/api 包（ARCH-003，R12 check-rules.mjs 分支自动覆盖新增文件）。覆盖：T6（lint:rules 探针 + Reviewer 逐文件）
- **AC-ARCH-2 类型来自 contracts**：GIVEN 新增模块 / THEN 数据类型（Notification/NotificationStatus/ReportQuery/ReportResult/ReportGroupByDim/ReportAggItem/AuditLogEntityType/AuditLogAction/ErrorCode 等）import 自 @admin/contracts，无手写 TS 类型副本。覆盖：T6（tsc + Reviewer）
- **AC-ARCH-3 客户端校验复用契约 schema（自由文本表单）**：GIVEN 通知创建 title/content/recipient_id + 通知编辑 partial 自由文本表单 / THEN 复用 createNotificationInputSchema / updateNotificationInputSchema 的 .safeParse()（SSOT 派生，AI-005）。覆盖：T4

### R13 S-1 合规专项

- **AC-S1-1 自由文本表单须 safeParse**：GIVEN F2 通知创建（title/content/recipient_id）+ F3 通知编辑（partial title?/content?/recipient_id?）+ F7 报表 operated_from/operated_to/operator_id 自由输入 / THEN 提交前调对应 schema.safeParse（F2/F3）或客户端字段校验（F7 advisory），失败显示字段级错误不发请求。覆盖：T4、T5
- **AC-S1-2 类型派生操作 TS 类型保证**：GIVEN F4 通知发送 + F5 通知标记已读 + F6 通知删除按钮（id/version 从列表派生）+ F7 group_by checkbox + F7 entity_type/action select / THEN 值经 TS 类型派生（id/version 为 uuid/number 字面量、group_by 为枚举、entity_type/action 为枚举），无自由输入；safeParse 冗余可省略或保留 defensive。覆盖：T3、T5

### AC↔测试用例覆盖矩阵（R13 S-3 固化）

> 测试文件编号（T#）为本 PRD 预估，**最终用例号由 test-writer 阶段确认**（R13 S-3，R14 S-12 测试文件数是预估 test-writer 可调整须 AI-006 反向核实）。test-writer 须自检每条 AC 至少 1 个用例覆盖，未覆盖显式列 reason。

| AC | 覆盖测试文件 | 用例号（test-writer 定） | 备注 |
|----|-------------|------------------------|------|
| AC-F1-1~F1-7 | T3 notification-list-page.test.tsx | 待定 | F1-4 组合场景（R13 S-3）、F1-7 status 文案+按钮动态显示 |
| AC-F2-1~F2-6 | T4 notification-form.test.tsx | 待定 | F2-2~F2-5 自由文本 safeParse、F2-6 延后校验跨 T1 |
| AC-F3-1~F3-5 | T4 notification-form.test.tsx + T1 api-notifications.test.ts | 待定 | F3-2/F3-3/F3-4 跨 T1+T4 |
| AC-F4-1~F4-5 | T3 notification-list-page.test.tsx + T1 api-notifications.test.ts | 待定 | F4-3/F4-4/F4-5 跨 T1+T3 |
| AC-F5-1~F5-4 | T3 + T1 | 待定 | F5-4 跨 T1+T3 |
| AC-F6-1~F6-4 | T3 + T1 | 待定 | F6-3/F6-4 跨 T1+T3 |
| AC-F7-1~F7-9 | T5 report-page.test.tsx + T2 api-reports.test.ts | 待定 | F7-5 组合场景（R13 S-3）、F7-6/F7-7 跨 T2+T9、F7-1/F7-4 SSOT 派生可选放 T9 |
| AC-F8-1~F8-3 | T6 navigation-extend.test.tsx（扩展 R14 navigation.test.tsx，①类显式影响） | 待定 | F8-3 沿用 R12 route-guard 测 |
| AC-F9-1~F9-3 | T9 error-mapping-extend-2.test.ts（扩展 R14 error-mapping-extend.test.ts，①类显式影响）+ T1 | 待定 | F9-3 401/网络错误沿用 R12/R14 |
| AC-F10-1~F10-3 | T1/T2 + T6 | 待定 | F10-3 工程核验 |
| AC-ARCH-1~ARCH-3 | T6 + lint:rules 探针 + Reviewer 逐文件 | 待定 | ARCH-3 跨 T4 |
| AC-S1-1~S1-2 | T4/T5/T3 | 待定 | R13 S-1 合规 |

**预估测试文件清单**（③类新增 + ①类显式影响扩展，对齐 R14 §9.3 风格 + R14 S-12 测试文件数预估可调整）：
1. `apps/web/test/api-notifications.test.ts`（T1，③类新增）—— 通知域 API client 契约（list/create/update/send/markRead/delete + 4 versioned 端点 If-Match + 409 重试 + RECIPIENT 错误码）
2. `apps/web/test/api-reports.test.ts`（T2，③类新增）—— 报表域 API client 契约（query group_by[] repeated key + 时间范围 + 筛选 + ReportResult 动态维度响应 + REPORT_GROUP_BY_REQUIRED/REPORT_TIME_RANGE_INVALID 码映射）
3. `apps/web/test/notification-list-page.test.tsx`（T3，③类新增）—— 通知列表/分页/status 筛选/状态文案+按钮动态显示/发送/标记已读/删除组件测
4. `apps/web/test/notification-form.test.tsx`（T4，③类新增）—— 通知创建/编辑表单 safeParse 校验 + RECIPIENT 延后校验 + INVALID_TRANSITION + VERSION_CONFLICT 重试组件测
5. `apps/web/test/report-page.test.tsx`（T5，③类新增）—— 报表筛选（group_by checkbox + 时间范围 + operator_id + entity_type/action）+ 应用筛选按钮 + REPORT_GROUP_BY_REQUIRED/REPORT_TIME_RANGE_INVALID + 动态列表格 + 分页/空/加载组件测
6. `apps/web/test/navigation-extend.test.tsx`（T6，**①类显式影响**扩展 R14 navigation.test.tsx 或新增文件）—— 侧边栏 6 入口 + 路由守卫 /notifications /reports（若扩展 R14 既有 navigation.test.tsx 须 AI-002 边界标注 + ①类显式影响注释，对齐 R14 errorMapping 扩展范例）
7. `apps/web/test/error-mapping-extend-2.test.ts`（T9，**①类显式影响**扩展 R14 error-mapping-extend.test.ts 或新增文件）—— 通知/报表错误码映射 + SSOT 派生断言（R14 error-mapping-extend.test.ts 若断言"NOTIFICATION_NOT_FOUND → FALLBACK"会失效，impl-writer 须调整，①类显式影响处理范例）

> test-writer 须做 AC 覆盖矩阵自检（R13 S-3）：每条 AC 至少 1 用例覆盖，未覆盖显式列 reason；组合场景（AC-F1-4 筛选+分页、AC-F7-5 筛选+分页、AC-F3-3/F4-3/F5-4/F6-3 重试+刷新）须单独测。test-writer 可据覆盖质量调整测试文件数（R14 S-12），须 AI-006 反向核实注明理由 + Reviewer 判定合理性。

## Q&A 决策（全 BLOCKING，未回答不进入 Spec）

**Q1 · 通知列表 pageSize 默认值？**
BLOCKING（影响 F1 / AC-F1-1 / 数据实体 ListNotificationQuery / N1）。**contract 核验**（N1）：`listNotificationQuerySchema.pageSize` 默认 **10**（与 user/role 域一致），上限 100；与 audit/report 域 pageSize 默认 20 有意分歧。方案①遵循契约缺省 10（前端不显式传 pageSize，依赖契约缺省）；方案②前端显式传 pageSize=20（对齐 R12 D14 / R14 D21 不依赖契约缺省，与其他前端域 pageSize=20 一致）；方案③前端传 pageSize=50。本期选哪个？推荐②（R12/R14 前端所有列表域均显式传 pageSize=20 不依赖契约缺省——user/role/audit 域契约缺省 10/10/20 但前端统一 20，通知域契约缺省 10 由前端显式传 20 抹平分歧，跨域前端体验一致；契约缺省 10 仅在不传时生效，前端显式传值不破坏契约；50 偏多单页重）。**阻塞下游：Tech-Spec §3.1 ListNotificationQuery 消费（前端显式传 pageSize=20）、impl NotificationListPage 默认参数、test F1-1 列表用例。**

**Q2 · 通知编辑 UI 形态？**
BLOCKING（影响 F3 / AC-F3-1 / 组件设计）。方案①弹窗（modal，从 NotificationListPage 行操作"编辑"触发，展示预填表单 title/content/recipient_id）；方案②行内编辑（NotificationListPage 每行展开编辑）；方案③独立页（路由 /notifications/:id/edit，须 GET /v1/notifications/:id 加载详情）。本期选哪个？推荐①（对齐 R14 RoleForm/DeptForm modal 风格 + R12 CreateUserModal 风格，前端一致；列表 items 已含完整 Notification，编辑表单预填用列表项数据无须 GET 单条，对齐 R14 Q9 决策②不消费 GET /:id；行内编辑让列表过载且 recipient_id uuid 输入 UX 差；独立页须新增路由+GET 详情端点消费，超 R15 范围）。**阻塞下游：Tech-Spec §6 NotificationForm 设计（modal 复用，create/edit 双模式）、impl NotificationForm + NotificationListPage 行操作、test F3 用例。**

**Q3 · 通知操作按钮展示策略？**
BLOCKING（影响 F1/F4/F5/F6 / AC-F1-7 / 状态机前端展示）。方案①按 status 动态显示可用操作（隐藏不可用——draft 显示编辑/发送/删除，sent 显示标记已读，read 无操作）；方案②全显示+禁用不可用（所有按钮常驻，不可用的 disabled）；方案③全显示不禁用（后端拒绝，前端不预判）。本期选哪个？推荐①（状态机语义清晰，用户只看到当前状态可执行的操作，避免误操作；隐藏比 disabled 更清爽——disabled 按钮占位但不可点易混淆；方案③体验差依赖后端拒绝增加无效请求；Q11 决策②配套明确各 status 下具体按钮集）。**阻塞下游：impl NotificationListPage 按钮按 status 条件渲染、test F1-7 状态按钮断言。**

**Q4 · 通知 recipient_id 输入形态？**
BLOCKING（影响 F2 / AC-F2-5/F2-6 / N4 / 表单设计 / R13 S-1 分类）。**contract 核验**（N4）：`createNotificationInputSchema.recipient_id` 仅 uuid 格式校验，存在性/禁用态校验**延后至 send**（契约 Q8 延后校验）。方案①自由文本 UUID 输入（用户手输 uuid，`createNotificationInputSchema.safeParse` 校验 uuid 格式，存在性延后至 send）；方案②用户选择 select（须调 GET /v1/users 全量加载用户列表，但 R15 范围仅新增 api/notifications.ts/api/reports.ts，且 GET /v1/users 为分页端点无全量 select 友好端点）；方案③用户搜索 combobox（须新增 api/users 扩展 + 搜索逻辑，超范围）。本期选哪个？推荐①（对齐契约 Q8 延后校验设计——create 仅 uuid 格式校验，存在性延后至 send 触发 RECIPIENT_NOT_FOUND/RECIPIENT_DISABLED，允许"先草稿后发送"工作流；自由文本 UUID 输入 + safeParse uuid 格式校验属自由文本表单 R13 S-1；用户选择 select 须新增 api/users 全量消费超 R15 范围，且契约设计本就延后校验，select 提前校验存在性违背契约 Q8 语义）。**阻塞下游：Tech-Spec §3.2 表单校验分类（recipient_id 自由文本 safeParse）、impl NotificationForm recipient_id 控件、test F2-5/F2-6。**

**Q5 · 报表 group_by 选择形态？**
BLOCKING（影响 F7 / AC-F7-1 / 表单设计 / R13 S-1 分类）。方案①多选 checkbox（1-4 维，选项从 `reportGroupByDimSchema.options` SSOT 派生 4 项，checkbox group 自然适配多维选择，单选 per 维去重）；方案②多选 select（须处理多选交互+去重）；方案③单选切换（每次仅 1 维，违背 1-4 维多选契约）。本期选哪个？推荐①（checkbox group 是 1-4 维多选的最自然 UI——每个维度独立勾选，单选 per 维自然去重无重复维度问题 N5，选项从 SSOT 派生不漏枚举 AI-005；值经 checkbox options 派生保证 ∈ 枚举属类型派生操作 R13 S-1 safeParse 冗余；多选 select 交互复杂且须手动去重；单选违背 1-4 维契约）。**阻塞下游：impl ReportFilter group_by checkbox 控件、test F7-1 SSOT 派生断言。**

**Q6 · 报表时间范围输入形态？**
BLOCKING（影响 F7 / AC-F7-2 / 表单设计）。contract 要求 operated_from/operated_to 为 ISO datetime（z.string().datetime()）。方案①datetime-local 原生输入（前端归一为 ISO 8601 with seconds + Z 后传，对齐 R14 审计 Q7 决策①）；方案②自由文本 ISO（用户手输 ISO 字符串，UX 差易输错）；方案③date 日期选择器（仅日期，前端补 T00:00:00Z/T23:59:59Z，精度损失）。本期选哪个？推荐①（对齐 R14 审计 Q7 决策① datetime-local + ISO 归一，跨域前端一致；原生 datetime-local UX 最佳，前端归一保证 z.string().datetime() 通过；自由文本 UX 差易输错；date 仅日期精度损失，报表时间范围常需小时级）。**[advisory]**：datetime-local 跨浏览器输出格式差异（如缺秒/时区），impl 须归一为完整 ISO（如 `2026-07-03T12:00:00Z`），归一逻辑属 advisory 实现提示不须同步 Spec §10 但须 Review 报告记录（R13 S-2，对齐 R14 审计 Q7）。**报表整体筛选采用"应用筛选"按钮触发请求**（R14 S-9 教训，不可每键入触发——datetime-local 切换 + operator_id 文本输入均经"应用筛选"按钮原子提交，无须 debounce）。**阻塞下游：impl ReportFilter datetime-local 控件 + ISO 归一 + 应用筛选按钮、test F7-2。**

**Q7 · 报表结果表格动态维度键展示策略？**
BLOCKING（影响 F7 / AC-F7-8 / N6 / ReportTable 设计）。**contract 核验**（N6）：`reportAggItemSchema` 用 `z.record` 承载动态维度键 + count，维度键随 group_by 动态变化无法静态枚举字段名。方案①固定列（预设固定维度列，缺维度补空）；方案②动态列（据 `result.group_by` 回显渲染列头，每行 item 据 dim key 取值，count 固定列）；方案③单列 JSON 展示（把 item 序列化为 JSON 字符串展示，UX 差）。本期选哪个？推荐②（动态列是动态维度键的唯一正确展示——`result.group_by` 原样回显声明的维度，ReportTable 据此渲染列头 + count 固定列，每行 item 据 dim key 取值；固定列无法适配动态维度，缺维度补空语义混乱；JSON 展示 UX 差不可读；动态列类型上 ReportAggItem 为 record，dim key 为 string，TS 不强制具体键名，运行时遍历 `result.group_by` 渲染）。**阻塞下游：Tech-Spec §6 ReportTable 动态列设计、impl ReportTable、test F7-8。**

**Q8 · 报表 group_by 缺省时前端是否预填默认维度？**
BLOCKING（影响 F7 / AC-F7-6 / N5 / UX）。**contract 核验**（N5）：group_by 缺省/空数组由 service 层 → REPORT_GROUP_BY_REQUIRED（schema 不在层拒绝空）。方案①预填默认维度（如默认勾选 ['date']，用户可改）；方案②不预填（用户须显式选择至少 1 维，客户端 advisory 校验非空 + 服务端兜底 REPORT_GROUP_BY_REQUIRED）。本期选哪个？推荐②（契约明示 group_by 缺省/空 → REPORT_GROUP_BY_REQUIRED，前端不预填让用户显式选择——预填默认维度会掩盖"必选"语义，用户可能直接应用筛选触发默认维度非其本意；客户端 advisory 校验 group_by 至少 1 维显示"请至少选择一个分组维度"不发请求，提升 UX 避免无效请求；服务端兜底 REPORT_GROUP_BY_REQUIRED 保证健壮性；AC 同时测客户端拦截 + 服务端码映射）。**阻塞下游：impl ReportFilter group_by 默认不勾选 + 客户端非空校验、test F7-6 客户端拦截 + T2 服务端码映射。**

**Q9 · 前端测试范围？**
BLOCKING（影响验收可测性 / 工作量）。方案①组件测 + API client 契约测，无 E2E（对齐 R12 Q8 决策② / R14 Q12 决策①）；方案②组件测 + API client 契约测 + E2E（Playwright）；方案③仅组件测。本期选哪个？推荐①（对齐 R12/R14 决策，组件测覆盖 UI 交互，API client 契约测覆盖 endpoint 封装 + versioned/重试逻辑 + 错误码映射，路由守卫测覆盖跳转；E2E 引入 Playwright 重且慢，R12/R14 已决策不引入，R15 沿用；后端 HTTP 层已在 R1-R14 端到端覆盖）。**阻塞下游：test-writer 测试矩阵（7 文件预估：5 新增 + 2 ①类显式影响扩展）、impl 测试实现。**

**Q10 · 错误码映射扩展？**
BLOCKING（影响 F9 / AC-F9-1~F9-3 / errorMapping 完整性 / R14 S-11）。**contract 核验**：NOTIFICATION_NOT_FOUND/NOTIFICATION_RECIPIENT_NOT_FOUND/NOTIFICATION_RECIPIENT_DISABLED/NOTIFICATION_INVALID_TRANSITION/REPORT_GROUP_BY_REQUIRED/REPORT_TIME_RANGE_INVALID 均在 errorCodeSchema 全集内（已核验 user.ts L170-178）。方案①扩展 SPECIFIC_MESSAGES 增加通知/报表相关码中文提示 + 同步更新"未映射码"注释（R14 S-11 教训，注释须反映扩展后实际未映射域如 TRANSFER/ROLE_INHERITANCE）；方案②全部 FALLBACK（不单列具体提示）；方案③硬编码全集（违背 SSOT）。本期选哪个？推荐①（通知/报表域码前端实际触发——通知 INVALID_TRANSITION/RECIPIENT_*/NOT_FOUND + 报表 GROUP_BY_REQUIRED/TIME_RANGE_INVALID 均在 AC 中触发，单列具体提示提升 UX；映射表键仍从 errorCodeSchema SSOT 派生 R12 D11 沿用，新增码自动覆盖不漏；扩展时同步"未映射码"注释 R14 S-11 教训闭合；①类显式影响：R14 error-mapping-extend.test.ts 若断言"NOTIFICATION_NOT_FOUND → FALLBACK"会失效，impl-writer 须调整断言 toContain('通知不存在')，对齐 R14 ①类显式影响处理范例）。**阻塞下游：impl lib/errorMapping.ts 扩展 + 注释同步、test F9-1~F9-3 + ①类显式影响 R14 error-mapping-extend.test.ts 调整。**

**Q11 · 通知状态机前端展示？**
BLOCKING（影响 F1/F4/F5/F6 / AC-F1-7 / 状态机展示 / 与 Q3 配套）。本 Q 与 Q3 配套——Q3 决策按钮展示**策略**（隐藏 vs 禁用），Q11 决策 status **文案中文化 + 各 status 下具体可用操作按钮集**。方案①status 显示英文原值（draft/sent/read）+ 按钮按 status 动态显示；方案②status 文案中文化（草稿/已发送/已读）+ 按 status 动态显示操作按钮集（draft→编辑/发送/删除、sent→标记已读、read→无操作）；方案③status 文案中文化 + 全显示禁用不可用（与 Q3 冲突）。本期选哪个？推荐②（status 文案中文化提升可读性——草稿/已发送/已读 比 draft/sent/read 友好；按 status 动态显示操作按钮集与 Q3 决策①一致——draft 可编辑/发送/删除、sent 仅标记已读（append-only 不可改不可删）、read 无操作（终态）；状态守卫拒绝统一抛 NOTIFICATION_INVALID_TRANSITION 映射"通知状态不允许此操作"；status 文案为纯 UI 文案 R13 S-2 不须同步 Spec §10 但须 Review 报告记录）。**阻塞下游：impl NotificationListPage status 文案映射 + 按钮按 status 条件渲染、test F1-7 状态文案+按钮集断言。**

## Out of scope

- **通知详情页** —— GET /v1/notifications/:id（cacheable）端点保留，本轮仅列表（编辑表单预填用列表项数据无须 GET 单条，对齐 R14 Q9 决策②），详情页为未来轮次。
- **通知批量操作** —— 本轮仅单条操作（创建/编辑/发送/标记已读/删除），批量发送/批量标记已读/批量删除为未来方向。
- **通知模板/通知类型/通知渠道扩展** —— 沿用 PRD-NOTIFICATION-001 Out of scope，title/content 自由文本无模板/类型/渠道。
- **通知发送给多收件人/群组** —— createNotificationInputSchema.recipient_id 单值，多收件人/群组为未来契约扩展方向。
- **通知 markRead 自服务 UI**（收件人侧）—— markRead 端点为收件人自服务（无权限码，Q4b），但 R15 前端为管理员后台，markRead 按钮在管理员视角触发（管理员代收件人标记），收件人侧自助 UI 为未来方向。
- **报表图表可视化** —— 本轮仅聚合表格展示，柱状图/饼图/趋势图为未来方向（须引入图表库，违背零新依赖）。
- **报表导出 CSV/PDF** —— 本轮仅页面展示，导出为未来方向（PII 批量导出风险面，须独立权限码）。
- **报表 group_by 维度扩展**（如增加 entity_id/hour/week 维度）—— contract reportGroupByDimSchema 闭合枚举 4 项（operator_id/entity_type/action/date），扩展为未来契约方向。
- **报表 drill-down 下钻** —— 本轮仅聚合统计，下钻查看明细日志为未来方向（须联动审计日志页）。
- **refresh token / 双 token 机制** —— 沿用 R12/R14 Out of scope。
- **SSR / PWA / i18n / 暗色模式 / 骨架屏 / UI 组件库** —— 沿用 R12/R14 Out of scope。
- **E2E 测试（Playwright）** —— 沿用 R12 Q8 决策② / R14 Q12 决策①，组件测 + API client 契约测无 E2E。
- **后端任何改动** —— 后端已就绪（R1-R14 991 用例基线），本轮仅前端，contracts 无新增 schema（通知/报表契约在 R6/R9 已就绪）。
- **check-rules.mjs 之外的新规则** —— ARCH-003 已机器化（R12），新增前端文件自动受其约束，本轮不新增规则。
- **R14 S-8~S-12 固化**（提示词层 S-8~S-11 + Spec 模板层 S-12）—— 本轮 PRD/impl 须**注意**这些教训（api 命名对齐 Spec、文本筛选 debounce/应用筛选按钮、aria-label 域特定、扩展模块同步注释、测试文件数预估可调整），但规则/提示词的正式固化属元改进轮范畴，不在 R15 业务轮内。
