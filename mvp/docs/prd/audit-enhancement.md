---
doc_type: PRD-Spec
id: PRD-AUDIT-ENHANCEMENT-001
title: 操作日志增强（跨域埋点 + 操作统计报表 + 变更快照结构化）
status: draft
owner: ba@team
created: 2026-07-02
extends: PRD-AUDIT-001
prd_ref: RETRO-ROUND4-001
---

# 操作日志增强（跨域埋点 + 操作统计报表 + 变更快照结构化）

## 背景
第四轮（PRD-AUDIT-001 / RETRO-ROUND4-001）已落地操作日志领域：append-only 日志、按时间/操作者/实体类型过滤分页查询、邮箱 PII 脱敏（redactEmail：首 2 字符 + *** + @ + 域名）、91 用例全绿。复盘暴露三个待探索方向（RETRO-ROUND4-001 §2 两个 P2 + §5 末尾下一轮探索方向）：

1. **跨域旁路埋点未实现**（P2）：user/role/dept 三域 service 写操作成功后未触发 audit.record，审计日志目前只能手动写入。retro 建议"中间件/装饰器模式在 router 层统一埋点，service 保持纯粹不感知 audit"。
2. **PII 脱敏值级兜底灰区**（P2）：before/after 为 `z.record(z.unknown())` 弱类型，脱敏靠运行时正则双判断（键名含 email + 值像邮箱格式），存在灰区（自定义字段名含 email 但值非邮箱，或反之）。retro 建议改结构化 schema 使脱敏可定位字段名。
3. **工作流在非 CRUD 领域未验证**（§5）：前四轮全是 CRUD 领域，工作流对"纯读 + 聚合"领域（无 create/update/delete，只有 read + group by 计数）的适应性未验证。

本期在 PRD-AUDIT-001 基础上扩展，同时验证上述三个方向。三个方向内在联系：方向1 产生结构化审计日志 → 方向3 聚合这些日志 → 方向2 让日志的变更快照结构化（使脱敏精确），串成一个连贯故事。

## 业务目标
- **目标1（跨域埋点）**：让 user/role/dept 三域的写操作成功后由系统自动记录审计日志（含 operator/entity/action/before/after），消除手动写入；调用方对埋点透明，service 业务逻辑保持纯粹不感知 audit。
- **目标2（操作统计报表）**：新增 report 领域（非 CRUD：纯读 + 聚合），提供"审计操作统计报表"——按维度（操作者/实体类型/动作/时间）group by 聚合计数，分页返回，验证工作流对聚合查询领域的适应性。
- **目标3（变更快照结构化）**：把 audit 的 before/after 从 `z.record(z.unknown())` 升级为结构化 `ChangeField[]`，PII 字段用字段级标记（pii: true）定位，消除运行时正则灰区，使脱敏可静态推理。

## 用户故事
- 作为审计人员，我希望对 user/role/dept 的每一次写操作（创建/更新/删除/关联变更）都自动产生一条结构化审计日志，无需管理员手动触发，以便审计痕迹完整且不可遗漏。
- 作为审计人员，我希望审计日志的变更快照按字段结构化（每个变更字段独立成项、标注是否 PII），以便精确追溯单字段变更并让脱敏定位到字段名而非靠正则猜测。
- 作为审计/合规人员，我希望按操作者、实体类型、动作、日期维度聚合统计审计操作次数，分页返回，以便掌握操作分布全景（如某操作者近期操作量、某实体被变更频次）。
- 作为系统负责人，我希望埋点对调用方透明且不破坏主操作可用性（埋点失败不影响主操作成败），以便审计旁路与业务主流程解耦。
- 作为系统负责人，我希望 PII 脱敏由契约层声明的 PII 字段清单驱动（标记定位），不再依赖运行时正则兜底，以便消除脱敏灰区、使脱敏行为可静态推理。

## 功能点清单
- [ ] F1：跨域自动埋点（user.create / user.updateStatus / role.create / role.delete / role.assignRole·removeRole / dept.create / dept.delete / dept.assignUserDepartment 成功后，系统自动生成结构化审计日志；埋点对调用方透明、service 纯粹、埋点失败不影响主操作）
- [ ] F2：操作统计报表（按 operator_id / entity_type / action / date 维度组合 group by 聚合计数；支持时间范围与维度过滤；分页；默认按计数降序；新增 report:read 权限码）
- [ ] F3：变更快照结构化（before/after 从 `z.record(z.unknown())` 升级为 `ChangeField[]`；ChangeField 含 field/value/pii；PII 字段由 contracts 层清单标记定位；移除运行时正则兜底；既有日志一刀切迁移为结构化格式）

## 数据实体草图
- **ChangeField**（F3，before/after 数组元素）：`{ field: string, value: ScalarValue | null, pii: boolean }`
  - `field`：字段名（字符串）；可为实体业务字段，亦可为虚拟/关联字段（如 role 关联变更的 `assigned_user_ids`），不限定为实体列。
  - `value`：该侧（before 侧=旧值，after 侧=新值）的字段值；类型为 标量（string|number|boolean）| null | 同类型标量数组（string[]|number[]|boolean[]）。null 表示"该侧无值"（create 的 before 侧、delete 的 after 侧不出现该字段，故无 null 占位）。
  - `pii`：字段级布尔标记；true 表示该字段为 PII，查询返回时该 value 须套用 redactEmail 脱敏；false 表示非 PII，原样返回。
- **审计日志（升级后）**：`{ id, operator_id, operator_name, entity_type, entity_id, action, operated_at, before: ChangeField[], after: ChangeField[], created_at }`
  - before/after 始终存在为数组（不省略字段）；create → before=[]；delete → after=[]；update → 两者均非空（仅含实际变更字段）。
  - 快照仅记录业务字段，不含服务端生成的标识与时间戳（id / created_at / updated_at）——id 由日志顶层 entity_id 承载，时间戳由 operated_at/created_at 承载，非业务态不入快照。
- **PII 字段清单（SSOT，contracts 层声明）**：按 (entity_type, field_name) 标识已知 PII 字段。本期清单 = `{ (user, email) }`。埋点构造 ChangeField 时查清单标 pii；清单未列的字段默认 pii=false。清单扩展随领域 PRD 走（SSOT 派生，AI-005）。
- **报表查询入参（F2）**：`{ group_by: ('operator_id'|'entity_type'|'action'|'date')[] (1..4, 去重), operated_from?, operated_to?, operator_id?, entity_type?, action?, page=1, pageSize=20(上限100) }`
  - `date` 维度：按 UTC 自然日将 operated_at 截断为 `YYYY-MM-DD` 字符串参与 group by。
  - operated_from/to 为绝对 ISO datetime 闭区间（与 audit 列表查询一致），不支持相对时间。
- **报表查询结果（F2）**：`{ items: Array<{ [dim]: 维度值, count: number }>, total, page, pageSize, totalPages, group_by: string[] }`
  - items 每项含各 group_by 维度的值 + count（满足过滤条件的日志条数）；group_by 原样回显以便调用方确认聚合口径。
  - 维度值类型：operator_id → uuid 字符串；entity_type → user|role|dept；action → create|update|delete；date → YYYY-MM-DD。
  - 报表聚合维度均为非 PII 字段，仅返回计数，**不涉及 PII，无需脱敏**。

## 非功能需求
- **性能**：报表实时聚合（MVP 不引入缓存），常规日志量下即时返回；分页避免维度组合全量加载。埋点为旁路 best-effort，不得显著增加主操作延迟（具体阈值由 Tech-Spec 定）。
- **安全**：报表查询须具备 report:read 权限（新增权限码，内置 admin 自动覆盖）；审计日志 append-only 不变（报表为只读聚合，不改不删日志）；查询返回的 PII（邮箱）须脱敏（F3 标记驱动）。
- **兼容**：埋点为被动旁路，不影响主操作成败（主操作失败则不埋点；埋点异常被吞掉不抛给调用方）；与既有 user/role/dept 实体字段语义兼容，不向实体引入新字段；既有审计日志（第四轮 z.record 格式）一刀切迁移为结构化 ChangeField[]，不保留双格式共存。
- **保留期**：日志保留 90 天不变（沿用 PRD-AUDIT-001），清理任务本期仍不实现。

## 验收标准（Given/When/Then）

### F1：跨域自动埋点
- Given 管理员对用户执行创建操作（email + name） When 操作成功 Then 系统自动生成一条日志，entity_type=user、action=create、entity_id=新用户 id、before=[]、after 含 [{field:email,value,pii:true},{field:name,value,pii:false},{field:status,value:'active',pii:false}]，operated_at 记录操作时间；调用方未显式调用 audit.record（埋点透明）
- Given 管理员对 active 用户执行禁用（updateStatus） When 操作成功 Then 系统自动生成一条日志，entity_type=user、action=update、before=[{field:status,value:'active',pii:false}]、after=[{field:status,value:'disabled',pii:false}]，仅含 status 字段，email/name 未出现在快照中（未变更字段不记录）
- Given 管理员创建角色（含 permission_codes） When 操作成功 Then 系统自动生成一条日志，entity_type=role、action=create、before=[]、after 含 [{field:name,...},{field:description,...},{field:permission_codes,value:string[],pii:false},{field:is_builtin,...}]
- Given 管理员删除一个角色 When 操作成功 Then 系统自动生成一条日志，entity_type=role、action=delete、before 含删除前角色业务字段、after=[]
- Given 管理员为用户分配角色（UserRole 关联变更） When 操作成功 Then 系统自动生成一条日志，entity_type=role、action=update（沿用 PRD-AUDIT-001 Q7），before/after 含虚拟字段 assigned_user_ids（string[]）的旧值/新值
- Given 管理员创建部门 When 操作成功 Then 系统自动生成一条日志，entity_type=dept、action=create、before=[]、after 含 [{field:name,...},{field:parent_id,...}]
- Given 管理员删除部门 When 操作成功 Then 系统自动生成一条日志，entity_type=dept、action=delete、before 含删除前部门业务字段、after=[]
- Given 管理员维护用户部门归属（assignUserDepartment） When 操作成功 Then 系统自动生成一条日志，entity_type=user、action=update（沿用 PRD-AUDIT-001 跨域依赖：归属变更视为 user 的 update），before=[{field:department_id,value:原部门id,pii:false}]、after=[{field:department_id,value:新部门id,pii:false}]
- Given 管理员查询用户列表 / 查询操作日志 / 查询报表（读操作） When 操作完成 Then 不生成任何日志条目（读不记，沿用 PRD-AUDIT-001 Q1）
- Given 主操作因校验失败未成功（如创建用户邮箱重复、删除被占用的角色） When 操作失败 Then 不生成日志条目（仅成功写操作记录）
- Given 主操作成功但埋点环节异常（如 audit 写入失败） When 埋点失败 Then 主操作仍对调用方返回成功；埋点异常被吞掉（记录内部错误/告警但不抛给调用方），调用方无感知

### F2：操作统计报表
- Given 系统存在 25 条 user 创建日志、10 条 role 创建日志 When 审计人员按 group_by=[entity_type] 查询报表（无过滤） Then 返回 items=[{entity_type:user,count:25},{entity_type:role,count:10}]（按 count 降序），total=2
- Given 系统存在跨操作者与实体的日志 When 审计人员按 group_by=[operator_id,entity_type] 查询 Then 返回多维交叉聚合，每项含 operator_id + entity_type + count，按 count 降序、计数相同按维度值升序
- Given 系统存在跨多日日志 When 审计人员按 group_by=[date] + operated_from/operated_to=[2026-06-01,2026-06-30] 查询 Then 返回按 UTC 自然日（YYYY-MM-DD）聚合的每日计数，仅含落在时间区间内的日志
- Given 系统存在多操作者日志 When 审计人员按 group_by=[entity_type] + operator_id=O1 过滤查询 Then 仅聚合 operator_id=O1 的日志，按 entity_type 分组计数
- Given 维度组合数超过一页 When 审计人员请求第 2 页（每页 20） Then 返回第 21-40 项，结果含 total 与 totalPages
- Given 系统无任何审计日志 When 审计人员查询报表 Then 返回 items=[]/total=0/totalPages=0，不报错
- Given 审计人员具备 report:read 权限 When 查询报表 Then 可正常查询
- Given 管理员不具备 report:read 权限 When 尝试查询报表 Then 操作被拒绝（FORBIDDEN）
- Given 调用方未传 group_by（空数组） When 查询报表 Then 返回 REPORT_GROUP_BY_REQUIRED
- Given 调用方传 operated_from 晚于 operated_to When 查询报表 Then 返回 REPORT_TIME_RANGE_INVALID
- Given 调用方传 pageSize=200 When 查询报表 Then 按上限 100 返回（与 audit 列表查询钳制策略一致）
- Given 报表查询返回 When 任何情况 Then 结果不包含 PII（聚合维度均为非 PII 字段，仅返回计数）

### F3：变更快照结构化
- Given 一条 user.create 日志 When 查询审计日志列表 Then 该日志 after 为 ChangeField[] 数组，每项含 {field,value,pii}；其中 email 项 pii=true、name/status 项 pii=false
- Given 一条含邮箱变更的 update 日志（before/after 均含 email） When 查询返回 Then before 与 after 中 email 项的 value 均被 redactEmail 脱敏（首 2 字符+***+@+域名），pii=true；非 PII 字段原样返回
- Given 一条 role.create 日志（after 含 permission_codes 数组） When 查询返回 Then permission_codes 项 value 为 string[]、pii=false，原样返回（数组类型可被契约承载）
- Given 一条 create 日志 When 查询返回 Then before=[]（空数组，字段存在）；after 非空
- Given 一条 delete 日志 When 查询返回 Then after=[]（空数组，字段存在）；before 非空
- Given contracts PII 清单声明 (user,email) 为 PII When 埋点构造 user.email 的 ChangeField Then 该项 pii=true；未在清单的字段 pii=false
- Given 某字段未在 PII 清单中但值恰好像邮箱格式 When 查询返回 Then 该字段 pii=false，原样返回（信任标记，不做运行时正则兜底，消除灰区）
- Given 既有第四轮 z.record 格式日志 When 本期上线 Then 既有日志统一迁移为 ChangeField[] 结构化格式，不保留双格式共存；脱敏逻辑仅保留 marker-based 一条路径（移除 redactSnapshot 正则兜底）

## 开放问题 Q&A
> 约定：所有影响下游实现的开放项标 [BLOCKING] 并给出决策；[CONFIRMED] 为沿用既有决策或无开放性。本期不留 [OPEN] 项给下游。

### F1 跨域埋点
- **[CONFIRMED] Q1：读操作（list/detail）是否记审计？** —— 沿用 PRD-AUDIT-001 Q1：读不记。所有读操作（含查询报表本身）不产生审计日志，避免噪音与查询递归。
- **[BLOCKING] Q2：埋点失败（audit service 异常）是否影响主操作？** —— 不影响。埋点为 best-effort 被动旁路：主操作成功即对调用方返回成功；埋点环节异常被吞掉（记录内部错误/告警，不抛给调用方），调用方无感知。埋点不引入任何客户端错误码（埋点失败不构成对调用方的业务错误）。理由：审计旁路与业务主流程解耦，避免审计故障拖垮主操作可用性；与 PRD-AUDIT-001 兼容性要求"日志记录不影响主操作成败"一致。
- **[BLOCKING] Q3：before/after 含哪些字段？仅实际变更字段还是全量实体？** —— 仅实际变更字段（沿用 PRD-AUDIT-001）。未变更字段不出现在快照中。细化：快照仅记录业务字段，**不含服务端生成的标识与时间戳**（id / created_at / updated_at）——id 由日志顶层 entity_id 承载，时间戳由 operated_at/created_at 承载，非业务态不入快照。理由：变更快照聚焦业务状态变更，排除元数据冗余；与 PRD-AUDIT-001"仅变更字段"一致并收敛元数据噪声。
- **[BLOCKING] Q4：user.updateStatus 只改 status，before/after 如何构造？** —— before=[{field:'status',value:原状态,pii:false}]、after=[{field:'status',value:新状态,pii:false}]，仅含 status 字段。拒绝重复状态（已禁用再禁用/已启用再启用）时主操作失败 → 不记日志（Q2）。理由：updateStatus 为单字段变更，快照精确反映该字段；与 Q3"仅变更字段"一致。
- **[BLOCKING] Q5：埋点放哪一层？** —— PRD 只提业务期望，技术层归属留 Tech Lead 决策。BA 明确业务约束：(a) **埋点对调用方透明**——调用 user/role/dept 写操作的代码无需显式调用 audit.record，系统自动记录；(b) **service 层业务逻辑保持纯粹不感知 audit**（retro 建议方向，避免 audit 反向侵入三域 service 破坏领域自治）。具体实现（router 中间件 / 装饰器 / 事件总线）由 Tech Lead 裁决，但须满足上述两条业务约束。理由：领域自治与审计旁路解耦是本轮架构探索核心；BA 不越界定技术实现，只定业务期望与约束。

### F2 操作统计报表
- **[BLOCKING] Q6：聚合维度组合（单维 group by vs 多维交叉 vs 都支持）？** —— 支持多维交叉聚合。调用方从 {operator_id, entity_type, action, date} 中选择 1~4 个维度（去重）做 group by，单维是 N=1 的特例。`date` 维度按 UTC 自然日将 operated_at 截断为 YYYY-MM-DD 字符串参与聚合；时间桶粒度本期固定为"日"，不支持周/月/小时桶。理由：多维交叉满足"按操作者/实体/动作/时间统计"核心诉求；日桶粒度覆盖常见审计统计场景，更细粒度留待性能/需求驱动迭代。
- **[BLOCKING] Q7：时间窗口（绝对时间范围 vs 相对如"近7天" vs 都支持）？** —— 仅支持绝对时间范围 operated_from/operated_to（ISO datetime，闭区间），与 audit 列表查询一致；不支持相对时间。理由：绝对时间范围无歧义、可复用既有 audit 查询契约；相对时间需额外解析层（当前时间基准、时区），MVP 不引入。
- **[BLOCKING] Q8：排序规则？** —— 默认按 count 降序；计数相同按维度值升序（多维度时按 group_by 声明顺序依次作为次级排序键）。调用方不可自定义排序。理由：统计报表聚焦高频项，计数降序符合直觉；维度值升序作为稳定 tiebreaker 保证结果可复现。
- **[BLOCKING] Q9：聚合结果是否分页？** —— 分页。维度组合数可能很多（如按 operator_id 聚合且有大量操作者），沿用 page（默认 1）/pageSize（默认 20，上限 100，超上限按上限钳制）约定，与 audit 列表查询一致。理由：避免全量加载；与既有领域分页惯例对齐。
- **[BLOCKING] Q10：权限（新增 report:read 还是复用 audit:read）？** —— 新增 report:read 权限码。报表是独立能力（聚合统计），与单条日志明细查询（audit:read，含 PII 脱敏后的明细）关注点不同；分离权限码支持最小权限原则（如审计人员可看统计分布但不可看明细 PII）。内置 admin 随枚举扩展自动覆盖（沿用 PRD-ROLE-001 Q4）。需将 report:read 纳入 permissionCodeSchema 枚举（跨域契约联动，AI-006 受影响测试清单由 Tech Lead 产出）。
- **[BLOCKING] Q11：空结果（无审计日志时）返回什么？** —— 返回 items=[]/total=0/totalPages=0，与 audit 列表查询空结果约定一致，不报错。理由：空结果是合法统计结果（无匹配日志），非错误。
- **[BLOCKING] Q12：报表数据实时性（实时聚合 vs 缓存）？** —— 实时聚合（每次查询现算），MVP 不引入缓存。理由：MVP 数据量小，实时聚合足够且零一致性成本；缓存引入失效/一致性复杂度，留待性能需求驱动时迭代。

### F3 变更快照结构化
- **[BLOCKING] Q13：ChangeField 形状（{field, oldValue, newValue} 是否够，pii 标记放哪）？** —— 不采用 {field, oldValue, newValue} 单数组形态；保留 before/after 双数组（任务约束：before/after 升级为 ChangeField[]，双字段保留）。每数组元素 ChangeField = `{ field: string, value: ScalarValue|null|ScalarArray, pii: boolean }`，old/new 由 before/after 阵营编码，不在单元素内重复。pii 标记放在 ChangeField.pii（字段级布尔，before 侧与 after 侧同名字段均标 pii=true）。补充：field 可为虚拟/关联字段（如 role 关联变更的 assigned_user_ids），不限定为实体列。理由：双数组保留使升级为最小改动（before/after 字段名不变，仅元素类型从 z.record 换为 ChangeField）；pii 字段级标记使脱敏定位到字段名，消除正则灰区。
- **[BLOCKING] Q14：PII 字段标记由谁声明（contracts 层声明清单 vs 调用方传 vs 两者结合）？** —— contracts 层声明已知 PII 字段清单（SSOT），按 (entity_type, field_name) 标识。本期清单 = `{ (user, email) }`。埋点构造 ChangeField 时查清单标 pii=true；清单未列的字段默认 pii=false。调用方不传 pii 标记（避免散落、避免遗漏）。清单扩展随领域 PRD 走（SSOT 派生，AI-005）。理由：contracts 为 SSOT，清单集中声明避免散落；调用方传标记易遗漏导致脱敏失效。
- **[BLOCKING] Q15：未标记 pii 但实际是 PII 的字段如何兜底（仍保留运行时检测 vs 信任标记不做兜底）？** —— 信任标记，**不做运行时正则兜底**（消除 retro P2 灰区）。已知 PII 由 contracts 清单覆盖；清单未列的字段视为非 PII，原样返回。新增 PII 字段须扩展清单（SSOT 派生，AI-005）。理由：运行时正则双判断（键名+值格式）正是 retro P2 灰区根因；标记驱动使脱敏可静态推理，新增 PII 走清单扩展流程而非模糊兜底。
- **[BLOCKING] Q16：既有审计日志（第四轮 z.record 格式）如何兼容（迁移 vs 仅新日志用结构化 vs 双格式共存）？** —— 一刀切迁移为结构化 ChangeField[] 格式，不保留双格式共存。脱敏逻辑仅保留 marker-based 一条路径（移除 redactSnapshot 正则兜底与 EMAIL_LIKE_RE 值级检测）。理由：本期为演练项目，既有日志为测试数据，无生产迁移成本；双格式共存使脱敏逻辑分叉（灰区再现），违背 F3 初衷；一刀切最干净，使脱敏单一路径可静态推理。
- **[BLOCKING] Q17：create 动作 before 为空数组还是不含 before？delete 动作 after 为空数组？** —— before/after 始终存在为数组（不省略字段）。create → before=[]（空数组）；delete → after=[]（空数组）；update → 两者均非空（仅变更字段）。理由：字段恒在使契约形状稳定（前端无需判字段缺失），空数组语义清晰表达"该侧无变更"。
- **[BLOCKING] Q18：oldValue/newValue 的类型（unknown vs 限定为标量+null）？** —— 限定为 标量（string|number|boolean）| null | 同类型标量数组（string[]|number[]|boolean[]）。不支持对象/嵌套数组。理由：限定类型消除 unknown 的运行时不确定，使脱敏与契约校验可静态推理；实体业务字段均为标量（name/email/status/parent_id/department_id 等），permission_codes/assigned_user_ids 为标量数组（string[]），无需对象嵌套。

## 跨域依赖
- **扩展 PRD-AUDIT-001**：本 PRD 为操作日志领域的增强，沿用其 append-only / 读不记 / 90 天保留期 / redactEmail 脱敏函数（首 2 字符+***+@+域名）等既有决策；F3 仅升级"如何定位 PII 字段"的契约（标记 vs 正则），不改脱敏函数本身。
- **依赖用户管理（PRD-USER-001）**：F1 对 user.create / user.updateStatus 自动埋点；user.email 为 PII（F3 清单），查询返回脱敏。不改 User 实体字段语义。
- **依赖角色管理（PRD-ROLE-001）**：F1 对 role.create / role.delete / role.assignRole·removeRole（UserRole 关联变更，沿用 PRD-AUDIT-001 Q7 归类 entity_type=role,action=update）自动埋点。不改 Role 实体字段语义。
- **依赖部门管理（PRD-DEPT-001）**：F1 对 dept.create / dept.delete / dept.assignUserDepartment（用户部门归属变更，沿用 PRD-AUDIT-001 跨域依赖归类 entity_type=user,action=update）自动埋点。不改 Department 实体字段语义。
- **引入新权限码 report:read（F2 报表查询）**：依据 PRD-ROLE-001 Q2"权限码随模块 PRD 扩展枚举"，需将 report:read 纳入 permissionCodeSchema 枚举；内置 admin 随枚举扩展自动覆盖。该改动为 contracts 联动（AI-006：Tech Lead 须产出受影响测试清单）。
- **引入新错误码（F2 报表）**：errorCodeSchema 追加 `REPORT_GROUP_BY_REQUIRED`（group_by 为空）、`REPORT_TIME_RANGE_INVALID`（operated_from 晚于 operated_to）。F1 埋点不引入客户端错误码（Q2：埋点失败不影响主操作，异常被吞）。该改动为 contracts 联动（AI-006）。
- **report 领域为非 CRUD 纯读领域**：仅有聚合查询（read + group by），无 create/update/delete，故不产生审计日志（Q1）、不扩展 auditLogEntityTypeSchema 枚举（entity_type 仍为 user|role|dept）。
- **三个方向内在联系**：F1 产生结构化日志（F3 结构）→ F2 聚合这些日志；F3 使日志变更快照结构化（脱敏精确）。F2 不依赖 F3 的 before/after 结构（仅按日志顶层字段聚合），但与 F1/F3 共同构成"产生→结构化→聚合"的连贯故事。
