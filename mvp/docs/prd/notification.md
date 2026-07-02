---
doc_type: PRD-Spec
id: PRD-NOTIFICATION-001
title: 通知管理（CRUD + 状态机 + 跨域埋点 + 收件人校验）
status: draft
owner: ba@team
created: 2026-07-02
prd_ref: RETRO-ROUND5-001
---

# 通知管理（CRUD + 状态机 + 跨域埋点 + 收件人校验）

## 背景
第五轮演练（RETRO-ROUND5-001）落地了跨域旁路埋点（router 层 withAudit HOF）、PII 结构化契约（ChangeField + 标记驱动脱敏）、非 CRUD 报表聚合三方向，404 用例全绿。但复盘首次暴露一道比"代码正确"更深的质量门禁——**测试通过 ≠ 验收对齐**：impl-writer 三件套全绿却隐含 2 个 PRD [约束] 偏离（B-1/B-2），靠 Reviewer 对照 PRD Given/When/Then 逐条核对才抓出。根因是 F1 端到端测试缺失 + AI-006 受影响测试清单未覆盖 service 签名变更。复盘反推三项待落实优化点：

1. **AI-007（端到端验收测试 + Reviewer PRD 逐条核对）**：test-writer 须对照 PRD 每条 Given/When/Then 产出端到端断言（注入共享依赖观测旁路副作用，而非隔离自建实例）；Reviewer 须按 PRD 验收逐条核对对齐结论。
2. **AI-006 增强（覆盖 service 签名变更 + test-writer 交叉核实）**：触发面从"仅 contracts 联动"扩展到"既有 service/repository public 方法签名变更"；清单分两类标注（①contracts 联动驱动 ②apps/api 内部签名变更驱动）；test-writer 须反向核实清单完整性。
3. **SEC-002 bug 修复**：check-rules.mjs 的 SEC-002 扫描器方法识别正则误判 `if(...)` 为方法声明截断 body，导致 requireAdmin 落出 body 被误报，impl-writer 被迫重组代码结构规避。

本期新增 **notification（通知）领域** 作为上述三项优化点的验证载体。该领域须同时触发 AI-006 增强两类场景（contracts 联动 + 既有 UserService 签名变更）与 AI-007 端到端验收场景（发送通知后审计日志落库的跨层旁路行为）。

## 业务目标
- **目标1（新增通知领域）**：提供通知的草稿编辑、发送、已读标记能力，含 draft→sent→read 状态机与 append-only 语义（sent 后不可改不可删）。
- **目标2（验证 AI-007）**：通知发送（draft→sent）成功后须自动记录审计日志（沿用第五轮 withAudit 埋点，entity_type=notification、action=update），该跨层行为（router→service→audit 旁路）无法由单层断言覆盖，须端到端验收并明确断言日志内容（entity_type/action/before/after）。
- **目标3（验证 AI-006 增强①contracts 联动）**：contracts 层须扩展 permissionCodeSchema（加 notification:read/write）、errorCodeSchema（加 4 个通知错误码）、auditLogEntityTypeSchema（加 notification）。
- **目标4（验证 AI-006 增强②service 签名变更）**：为支持"发送通知时校验收件人存在且非禁用"，须在既有 UserService 加新 public 方法 `findByIds(ids: string[]): User[]`（批量查用户），NotificationService 据此校验收件人——这是既有 user service 签名变更，触发 AI-006 增强第②类分支。
- **目标5（验证 SEC-002 修复）**：notification service 含 requireAdmin 守卫，若 SEC-002 扫描器 bug 已修复，impl-writer 无需为规避误报而重组代码结构（Reviewer 旁路确认）。

## 用户故事
- 作为运营人员，我希望创建通知草稿（标题/正文/收件人），暂存未发送的内容，以便编辑确认后再发送。
- 作为运营人员，我希望发送草稿通知使其进入 sent 态，发送时系统自动校验收件人存在且未被禁用，避免向无效/禁用用户发通知。
- 作为运营人员，我希望发送成功后通知不可再编辑、不可删除（append-only），以便发送记录可追溯、不可篡改。
- 作为收件人，我希望对自己收到的已发送通知标记已读，以便记录阅读状态。
- 作为审计人员，我希望通知的每一次写操作（创建草稿/编辑草稿/发送/标记已读/删除草稿）都自动产生一条结构化审计日志（entity_type=notification），无需手动触发，以便审计痕迹完整。
- 作为系统负责人，我希望埋点对调用方透明且 best-effort（埋点失败不影响主操作成败），以便审计旁路与业务主流程解耦（沿用第五轮 F1 决策）。

## 功能点清单
- [ ] F1：通知 CRUD + 状态机（draft/sent/read；draft 可编辑/删除；sent→read 由收件人标记；同态/跳过/回退转移非法；append-only：sent 后不可改不可删）
- [ ] F2：发送 + 审计埋点联动（send draft→sent 成功后，系统经 withAudit 自动记审计日志 entity_type=notification/action=update，before/after 含 status 与 sent_at 变更；create/update/delete/mark-read 写操作均埋点；读操作不埋点；埋点 best-effort）
- [ ] F3：收件人校验（send 时校验收件人存在且非禁用，依赖既有 UserService 新增 public 方法 findByIds(ids): User[]；不存在→NOTIFICATION_RECIPIENT_NOT_FOUND，禁用→NOTIFICATION_RECIPIENT_DISABLED）

## 数据实体草图
- **Notification 实体**：`{ id: uuid, title: string(1..128), content: string(1..4000), recipient_id: uuid, status: 'draft'|'sent'|'read', created_at: datetime, updated_at: datetime, sent_at: datetime|null, read_at: datetime|null }`
  - `recipient_id` 引用 user 域 user.id（跨域依赖，F3 校验）。
  - `status` 状态机取值：`draft`（草稿，默认初始态）/ `sent`（已发送）/ `read`（已读，终态）。
  - `sent_at`：发送时置为非空 ISO datetime；draft 态为 null。
  - `read_at`：标记已读时置为非空 ISO datetime；draft/sent 态为 null。
  - 通知字段均为非 PII（title/content 为业务文本，recipient_id 为 uuid 引用，status/sent_at/read_at 为状态/时间戳），本期 PII_FIELD_REGISTRY 不新增 notification 条目（沿用第五轮仅 `{user: {email}}`）。
- **状态机**：
  - 合法转移：`draft → sent`（运营发送）、`sent → read`（收件人标记已读）。
  - 非法转移（→ NOTIFICATION_INVALID_TRANSITION）：`draft → read`（不可跳过发送）、`draft → draft`/`sent → sent`/`read → read`（同态）、`read → sent`/`read → draft`/`sent → draft`（不可回退，read 为终态）。
  - 状态守卫操作（非法时同样 → NOTIFICATION_INVALID_TRANSITION）：编辑（update）仅 draft 允许；删除（delete）仅 draft 允许；发送（send）仅 draft 允许；标记已读（markRead）仅 sent 允许。
- **审计埋点（F2，沿用第五轮 withAudit + ChangeField 结构）**：
  - create draft → entity_type=notification, action=create, before=[], after=[{title},{content},{recipient_id},{status:'draft'}]（不含 id/created_at/updated_at/sent_at/read_at 等服务端元数据，沿用 audit Q3）。
  - update draft → action=update, before/after 仅含实际变更字段（如 title 改 → before=[{title:旧}], after=[{title:新}]）。
  - send（draft→sent）→ action=update, before=[{field:'status',value:'draft',pii:false},{field:'sent_at',value:null,pii:false}], after=[{field:'status',value:'sent',pii:false},{field:'sent_at',value:<非空 ISO datetime>,pii:false}]（仅含本次变更字段 status 与 sent_at；read_at 未变更不入快照）。
  - markRead（sent→read）→ action=update, before=[{field:'status',value:'sent',pii:false},{field:'read_at',value:null,pii:false}], after=[{field:'status',value:'read',pii:false},{field:'read_at',value:<非空 ISO datetime>,pii:false}]。
  - delete draft → action=delete, before=[{title},{content},{recipient_id},{status:'draft'}], after=[]。
  - 所有 ChangeField 的 pii=false（notification 无 PII 字段）。

## 非功能需求
- **性能**：发送通知含收件人校验（UserService.findByIds 批量查，本期单收件人即 ids 长度=1），内存查询即时返回；埋点为旁路 best-effort，不显著增加主操作延迟（阈值由 Tech-Spec 定）。
- **安全**：写操作（create/update/delete/send）须具 notification:write 权限（内置 admin 自动覆盖）；读操作（list/detail）须具 notification:read；标记已读（markRead）为收件人自服务，须 ctx.user.id === notification.recipient_id（非 admin 守卫，自服务语义）。审计日志 append-only 不变（通知埋点仅追加日志，不改不删日志）。
- **兼容**：埋点为被动旁路，不影响主操作成败（主操作失败则不埋点；埋点异常被吞不抛调用方，沿用第五轮 Q2）。sent/read 通知 append-only（不可改不可删），与 audit 域 append-only 哲学一致。不向 user 实体引入新字段（UserService.findByIds 为只读查询方法）。
- **保留期**：通知实体保留期本期不设清理任务（Out of scope）；审计日志保留期仍 90 天（沿用 PRD-AUDIT-001）。

## 验收标准（Given/When/Then）

### F1：通知 CRUD + 状态机
- Given 运营人员（具 notification:write）提交 title/content/recipient_id When 创建通知 Then 返回 status=draft 的通知，sent_at=null、read_at=null、created_at/updated_at 为非空 ISO datetime；recipient_id 仅做 uuid 格式校验（不做存在性校验，校验延后至 send，Q8）
- Given 一条 draft 通知 When 运营人员编辑 title/content/recipient_id Then 仅 draft 态允许编辑，更新后 updated_at 刷新；返回更新后的通知
- Given 一条 draft 通知 When 运营人员删除 Then 删除成功（204 无体或返回确认，由 Tech-Spec 定）；draft 可删除
- Given 一条 sent 通知 When 运营人员尝试编辑 Then 返回 NOTIFICATION_INVALID_TRANSITION（仅 draft 可编辑）
- Given 一条 sent 通知 When 运营人员尝试删除 Then 返回 NOTIFICATION_INVALID_TRANSITION（append-only：sent 后不可删）
- Given 一条 read 通知 When 运营人员尝试编辑/删除 Then 返回 NOTIFICATION_INVALID_TRANSITION（read 为终态，append-only）
- Given 一条 draft 通知 When 运营人员尝试标记已读（markRead）Then 返回 NOTIFICATION_INVALID_TRANSITION（不可跳过 sent）
- Given 一条 sent 通知 When 收件人（ctx.user.id === recipient_id）标记已读 Then 通知 status 变为 read、read_at 置为非空 ISO datetime
- Given 一条 sent 通知 When 非收件人用户（ctx.user.id !== recipient_id）尝试标记已读 Then 返回 FORBIDDEN
- Given 一条 read 通知 When 尝试再次标记已读（read→read）Then 返回 NOTIFICATION_INVALID_TRANSITION（同态非法）
- Given 一条 sent 通知 When 尝试发送（sent→sent）Then 返回 NOTIFICATION_INVALID_TRANSITION（同态非法）
- Given 一条 read 通知 When 尝试发送（read→sent）Then 返回 NOTIFICATION_INVALID_TRANSITION（不可回退）
- Given 一条不存在的通知 When 任意写操作（edit/delete/send/markRead）Then 返回 NOTIFICATION_NOT_FOUND
- Given 运营人员（具 notification:read）查询通知列表/详情 When 操作完成 Then 不产生审计日志条目（读不记，沿用 PRD-AUDIT-001 Q1）
- Given 用户不具 notification:write When 尝试 create/update/delete/send Then 返回 FORBIDDEN
- Given 用户不具 notification:read When 尝试 list/detail Then 返回 FORBIDDEN

### F2：发送 + 审计埋点联动（AI-007 端到端验收靶子）
- Given 存在一条 draft 通知（id=N1, recipient_id=U1, title='T', content='C'），U1 存在且 active，且共享 AuditLogRepository 当前无 notification 相关日志 When 运营人员（具 notification:write, operator_id=O1）调用 send(N1) 成功 Then 通知 status 变为 sent、sent_at 置为非空 ISO datetime、read_at 仍为 null；**且共享 AuditLogRepository 中新增一条日志**，其 entity_type=notification、action=update、entity_id=N1、operator_id=O1、operator_name=操作者姓名快照、operated_at 非空、before=[{field:'status',value:'draft',pii:false},{field:'sent_at',value:null,pii:false}]、after=[{field:'status',value:'sent',pii:false},{field:'sent_at',value:<非空 ISO datetime>,pii:false}]；调用方未显式调用 audit.record（埋点透明）
- Given 运营人员创建一条 draft 通知（title/content/recipient_id）When 创建成功 Then 共享 AuditLogRepository 新增一条日志，entity_type=notification、action=create、before=[]、after=[{field:'title',value:'T',pii:false},{field:'content',value:'C',pii:false},{field:'recipient_id',value:<uuid>,pii:false},{field:'status',value:'draft',pii:false}]（不含 id/created_at/updated_at/sent_at/read_at）
- Given 一条 draft 通知（title='旧'）When 运营人员编辑 title 为 '新' 成功 Then 共享 AuditLogRepository 新增一条日志，entity_type=notification、action=update、before=[{field:'title',value:'旧',pii:false}]、after=[{field:'title',value:'新',pii:false}]（仅含实际变更字段）
- Given 一条 draft 通知 When 收件人（ctx.user.id === recipient_id）标记已读——但通知为 draft 态 When markRead Then 主操作失败（NOTIFICATION_INVALID_TRANSITION），不产生审计日志（仅成功写操作记录，沿用第五轮 Q2）
- Given 一条 sent 通知（id=N2, recipient_id=U2）When 收件人 U2 标记已读成功 Then 通知 status=read、read_at 非空；**且共享 AuditLogRepository 新增一条日志**，entity_type=notification、action=update、before=[{field:'status',value:'sent',pii:false},{field:'read_at',value:null,pii:false}]、after=[{field:'status',value:'read',pii:false},{field:'read_at',value:<非空 ISO datetime>,pii:false}]
- Given 一条 draft 通知 When 运营人员删除成功 Then 共享 AuditLogRepository 新增一条日志，entity_type=notification、action=delete、before=[{field:'title',...},{field:'content',...},{field:'recipient_id',...},{field:'status',value:'draft',pii:false}]、after=[]
- Given send 主操作成功但埋点环节异常（如共享 AuditLogRepository 写入失败）When 埋点失败 Then 主操作仍对调用方返回成功（通知已 sent）；埋点异常被吞掉（记录内部错误/告警但不抛调用方），调用方无感知（best-effort，沿用第五轮 Q2）
- Given send 主操作因校验失败未成功（如收件人不存在/禁用/状态非法）When 操作失败 Then 不产生审计日志条目（仅成功写操作记录）

### F3：收件人校验（依赖 UserService.findByIds）
- Given 存在一条 draft 通知（recipient_id=U_valid，U_valid 存在且 status=active）When 运营人员 send 成功 Then 通知 status=sent（收件人校验通过）
- Given 存在一条 draft 通知（recipient_id=U_missing，U_missing 不存在）When 运营人员 send Then 返回 NOTIFICATION_RECIPIENT_NOT_FOUND；通知 status 仍为 draft（主操作失败不改状态）；不产生审计日志
- Given 存在一条 draft 通知（recipient_id=U_disabled，U_disabled 存在但 status=disabled）When 运营人员 send Then 返回 NOTIFICATION_RECIPIENT_DISABLED；通知 status 仍为 draft；不产生审计日志
- Given 运营人员创建 draft 通知时 recipient_id 指向不存在的用户 When 创建 Then 创建成功（draft 不校验收件人存在性，校验延后至 send，Q8）；后续 send 该通知 Then 返回 NOTIFICATION_RECIPIENT_NOT_FOUND（验证延后校验）
- Given UserService.findByIds 被调用 When 传入 ids 数组 Then 返回 User[]，仅含存在的用户（不存在的 id 不在结果中，Q10）；NotificationService 据此判断 recipient 是否存在及是否禁用（跨域依赖 user 域，触发 AI-006 增强②service 签名变更）

## 开放问题 Q&A
> 约定：所有影响下游实现的开放项标 [BLOCKING] 并给出决策；[CONFIRMED] 为沿用既有决策。本期不留 [OPEN] 项给下游。

### F1 状态机
- **[BLOCKING] Q1：状态机转移规则？** —— 合法转移仅 `draft→sent`（send）与 `sent→read`（markRead，收件人自服务）。非法转移统一返回 NOTIFICATION_INVALID_TRANSITION，覆盖三类：(a) 跳过（draft→read，不可跳过发送）；(b) 同态（draft→draft/sent→sent/read→read）；(c) 回退（read→sent/read→draft/sent→draft，read 为终态不可回退）。此外 NOTIFICATION_INVALID_TRANSITION 兼作"状态守卫操作拒绝"码：编辑/删除仅 draft 允许、send 仅 draft 允许、markRead 仅 sent 允许，违反当前态执行这些操作同样返回 NOTIFICATION_INVALID_TRANSITION。理由：单错误码覆盖所有"操作对当前状态非法"场景，避免错误码膨胀（与 Q12 四码集合一致）；状态机集中表达业务规则。
- **[BLOCKING] Q2：draft 可编辑哪些字段？sent 后哪些字段不可改？** —— draft 态可编辑 title/content/recipient_id（status/sent_at/read_at/created_at 不可由调用方直接改，status 仅经 send/markRead 转移）。sent/read 态所有字段不可改（append-only）。理由：草稿为可编辑暂存态；发送后内容冻结以保证发送记录可追溯、不可篡改（与 audit append-only 哲学一致）。
- **[BLOCKING] Q3：草稿可删除吗？sent 后可删除吗？** —— draft 可删除；sent/read 不可删除（append-only，沿用 audit 域 F4 哲学）。删除 sent/read → NOTIFICATION_INVALID_TRANSITION（Q1 状态守卫）。理由：已发送通知是历史发送记录，删除会破坏可追溯性；草稿为未提交暂存，可删除。
- **[BLOCKING] Q4：通知字段集？** —— `{ id, title(1..128), content(1..4000), recipient_id(uuid), status(draft|sent|read), created_at, updated_at, sent_at(datetime|null), read_at(datetime|null) }`。sent_at 在 send 时置非空、draft 态 null；read_at 在 markRead 时置非空、draft/sent 态 null。id/created_at/updated_at/sent_at/read_at 由服务端生成/维护，不入 create/update 输入。理由：字段集覆盖草稿编辑、发送时间、阅读时间三语义；长度上限为 advisory，Dev 可按真实 DB 列宽调整并反向同步 Spec。
- **[BLOCKING] Q4b：标记已读（markRead）的权限模型？** —— 收件人自服务：须 ctx.user.id === notification.recipient_id，**不**走 requireAdmin/不要求 notification:write。校验顺序：通知存在（NOTIFICATION_NOT_FOUND）→ 调用者为收件人（FORBIDDEN）→ 状态守卫 sent→read（NOTIFICATION_INVALID_TRANSITION）。理由：业务上"已读"由收件人本人标记（用户故事明确），自服务语义不应要求管理员权限；与 create/update/delete/send 的 operator（运营）角色区分。收件人通知收件箱列表本期 Out of scope（仅提供 markRead 端点）。

### F2 发送 + 埋点
- **[BLOCKING] Q5：send（draft→sent）记审计日志的 entity_type/action/before/after？** —— entity_type=notification、action=update、before=[{field:'status',value:'draft',pii:false},{field:'sent_at',value:null,pii:false}]、after=[{field:'status',value:'sent',pii:false},{field:'sent_at',value:<非空 ISO datetime>,pii:false}]。沿用第五轮 withAudit + ChangeField 结构；before/after 仅含本次实际变更字段（status 与 sent_at，read_at 未变更不入快照，沿用 audit Q3）。sent_at 在 draft 态为 null、send 后为 ISO datetime，属变更字段故对称入 before(null)/after(value)。理由：action=update 表"状态变更"（沿用第五轮 user.updateStatus 用 update 表状态迁移的约定）；before/after 对称使变更可静态推理（第五轮 F3 决策）。
- **[BLOCKING] Q6：哪些操作记审计日志？** —— 沿用第五轮"写操作都埋点、读不记"：create draft（action=create）、update draft（action=update）、send（action=update）、markRead（action=update）、delete draft（action=delete）均埋点；list/detail（读）不埋点（沿用 PRD-AUDIT-001 Q1）。主操作失败（校验失败/状态非法）不埋点（仅成功写操作记录，沿用第五轮 Q2）。理由：审计痕迹覆盖所有写操作保证完整；读不记避免噪音。
- **[BLOCKING] Q7：埋点失败是否影响主操作？** —— 不影响（best-effort 旁路，沿用第五轮 Q2）。主操作成功即对调用方返回成功；埋点环节异常被吞（记录内部错误/告警不抛调用方）；埋点不引入客户端错误码。理由：审计旁路与业务主流程解耦，避免审计故障拖垮主操作可用性。

### F3 收件人校验
- **[BLOCKING] Q8：何时校验收件人？收件人禁用能否发送？** —— 校验延后至 send（draft 创建时仅做 recipient_id 的 uuid 格式校验，不查存在性/禁用态）。send 时校验：收件人须存在且 status=active；收件人不存在 → NOTIFICATION_RECIPIENT_NOT_FOUND；收件人 disabled → NOTIFICATION_RECIPIENT_DISABLED。理由：延后校验允许"先草拟后发送"工作流（草稿可暂存未确定收件人），send 为提交点统一校验；禁用用户不应收到新通知（业务语义）。
- **[BLOCKING] Q9：收件人校验错误码？** —— 不存在 → NOTIFICATION_RECIPIENT_NOT_FOUND；禁用 → NOTIFICATION_RECIPIENT_DISABLED。两者均 4xx（业务校验失败），不与 NOTIFICATION_NOT_FOUND（通知本身不存在）混淆。理由：错误码语义独立，便于调用方区分"通知不存在"vs"收件人不存在"vs"收件人禁用"三类失败。
- **[BLOCKING] Q10：UserService.findByIds 方法语义？** —— `findByIds(ids: string[]): User[]`：批量查用户，返回存在的 User[]（不存在的 id 静默 omitted，不在结果中）；顺序沿用 repository 迭代顺序（插入顺序，与 findById/findByDepartmentId 一致）；不抛错（不存在的 id 非异常）；调用方传唯一 id（去重由调用方负责）。NotificationService 调 `userService.findByIds([recipient_id])`：结果为空 → NOTIFICATION_RECIPIENT_NOT_FOUND；结果含 user 且 user.status==='disabled' → NOTIFICATION_RECIPIENT_DISABLED；否则校验通过。理由：批量查为未来扩展（群发）预留语义；不存在 id 静默 omitted 与既有 findById 返回 undefined 的"不存在即无"语义一致。**此为既有 UserService public 方法签名变更，触发 AI-006 增强第②类分支**（Tech Lead 须 grep 消费 UserService 的测试点并纳入受影响测试清单）。

### 跨域联动
- **[BLOCKING] Q11：permissionCodeSchema 扩展？** —— 追加 `notification:read`（list/detail）、`notification:write`（create/update/delete/send）。write 不再细分（含创建/编辑/删除/发送）。内置 admin 随枚举扩展自动覆盖（沿用 PRD-ROLE-001 Q4）；markRead 为收件人自服务不走权限码（Q4b）。需将两码纳入 permissionCodeSchema 枚举（contracts 联动，AI-006 ①）。
- **[BLOCKING] Q12：errorCodeSchema 扩展？** —— 追加 4 码：`NOTIFICATION_NOT_FOUND`（通知本身不存在）、`NOTIFICATION_RECIPIENT_NOT_FOUND`（收件人不存在）、`NOTIFICATION_RECIPIENT_DISABLED`（收件人禁用）、`NOTIFICATION_INVALID_TRANSITION`（状态转移/状态守卫操作非法，见 Q1）。contracts 联动（AI-006 ①）。NOTIFICATION_INVALID_TRANSITION 兼作"非法转移"与"状态守卫操作拒绝"两类（Q1），避免错误码膨胀。
- **[BLOCKING] Q13：auditLogEntityTypeSchema 扩展？** —— 追加 `notification`（枚举由 user/role/dept 扩展为 user/role/dept/notification）。此为跨域联动（AI-006 ①），使 withAudit 可用 entityType:'notification' 记录通知埋点。枚举扩展后 SSOT 派生断言（AI-005）自动跟随，role.test.ts 等无需手改。

## 跨域依赖
- **依赖用户管理（PRD-USER-001）**：F3 send 时校验收件人，需在既有 UserService 加新 public 方法 `findByIds(ids: string[]): User[]`（批量查用户）。**此为既有 user service public 方法签名变更，触发 AI-006 增强第②类分支**——Tech Lead 须在 Tech-Spec 产出受影响测试清单②（grep 消费 UserService 的 `apps/api/test/**/*.ts` 断言点），test-writer 须反向核实清单完整性。不向 User 实体引入新字段（findByIds 为只读查询）。NotificationService 依赖 UserService（注入），调 findByIds 校验收件人存在与禁用态。
- **依赖操作日志（PRD-AUDIT-001 / PRD-AUDIT-ENHANCEMENT-001）**：F2 沿用第五轮 router 层 withAudit HOF 埋点机制；notification 写操作经 withAudit 包装，best-effort 旁路记日志。须扩展 auditLogEntityTypeSchema 加 `notification`（Q13，contracts 联动 AI-006 ①）。埋点用 ChangeField 结构（{field,value,pii}），notification 字段均 pii=false（无 PII）。埋点失败不影响主操作（Q7，沿用第五轮 Q2）。
- **扩展角色权限（PRD-ROLE-001）**：permissionCodeSchema 追加 `notification:read` / `notification:write`（Q11，contracts 联动 AI-006 ①）；内置 admin 随枚举扩展自动覆盖。SSOT 派生断言（AI-005）自动跟随，role.test.ts 等无需手改。
- **扩展全局错误码**：errorCodeSchema 追加 4 个通知错误码（Q12，contracts 联动 AI-006 ①）；须同步 errors.ts 的 errorCodeToHttpStatus 穷举映射与 OpenAPI 片段（保持四处一致，沿用 user.ts errorCodeSchema 注释约定）。
- **AI-006 受影响测试清单（两类标注，本期同时触发）**：
  - ①contracts 联动驱动（grep 命中）：扩展 permissionCodeSchema / errorCodeSchema / auditLogEntityTypeSchema → grep 引用这三个 schema 的 `apps/api/test/**/*.ts`（如 role.test.ts 的权限码全集断言、audit.test.ts 的 entity_type 枚举断言），列出文件 + 断言位置 + 同步方向（硬编码→派生 / 数据补齐）。
  - ②apps/api 内部签名变更驱动（Tech Lead 手动分析）：UserService 新增 findByIds → grep 消费 UserService 的测试点（如 user.test.ts、role.test.ts、dept.test.ts 中 new UserService(...) 与方法调用断言），列出受影响断言位置 + 类型对齐方向。test-writer 须反向核实清单完整性，发现清单外影响点须在交付报告显式列出差异并修正（AI-006 增强）。
- **AI-007 端到端验收靶子（须端到端验证的 Given/When/Then）**：F2 全部 8 条（send→审计日志落库内容、create→日志、update draft→日志、markRead draft 失败不记、markRead sent→日志、delete draft→日志、best-effort 埋点失败不影响主操作、主操作失败不记日志）+ F3 收件人校验 5 条（含跨 service 调用 UserService.findByIds 的端到端验证）。这些断言须注入共享 AuditLogRepository（观测旁路副作用）与共享 UserService（观测跨 service 调用），而非隔离自建实例导致副作用不可见（AI-007 要求）。F1 状态机条目多为单层 service 断言（状态转移裁决在 service），但其 send/markRead 转移同时触发 F2 埋点，须与 F2 联合端到端验证。
