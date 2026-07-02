---
doc_type: PRD-Spec
id: PRD-AUDIT-001
title: 操作日志
status: reviewed
owner: ba@team
created: 2026-07-02
---

# 操作日志

## 背景
系统已有用户管理（PRD-USER-001，已 reviewed）、角色管理（PRD-ROLE-001，draft）、部门管理（PRD-DEPT-001，已 reviewed）。本期新增"操作日志"模块，用于审计管理员在上述三个领域的关键写操作。系统自动记录管理员对 user/role/dept 实体的创建/更新/删除操作，读操作（查询、查看）不记录；日志为 append-only（只追加，不可修改、不可删除）；管理员可按时间范围、操作者、实体类型过滤查询日志；每条日志记录操作者、操作类型、目标实体类型、目标实体标识、操作时间及变更前/后字段快照（仅含变更字段）。出于隐私（SEC-003b PII 脱敏），日志查询返回时涉及的用户邮箱须脱敏（保留首 2 字符 + 域名，如 ab***@example.com）。日志保留 90 天，本期仅记录创建时间供后续清理任务使用，不实现清理任务本身。

## 用户故事
- 作为管理员/审计人员，我希望按时间范围、操作者、实体类型过滤查询历史操作日志，以便审计管理员的关键写操作。
- 作为管理员/审计人员，我希望日志记录变更前后的字段快照（仅变更字段），以便精确追溯每一次变更的具体内容。
- 作为管理员/审计人员，我希望日志中涉及的用户邮箱在查询返回时被脱敏，以保护用户隐私（SEC-003b）。
- 作为系统负责人，我希望日志是 append-only 的，不可修改、不可删除，以保证审计痕迹不可篡改。
- 作为系统负责人，我希望日志记录创建时间，以便后续按 90 天保留期清理。

## 功能点清单
- [ ] F1：自动记录写操作（管理员对 user/role/dept 执行 create/update/delete 成功后，系统自动生成一条日志，含 before/after 仅变更字段快照）
- [ ] F2：分页查询操作日志（按时间范围、操作者、实体类型过滤；默认按操作时间倒序；支持 page + page_size 分页）
- [ ] F3：查询返回时 PII 脱敏（before/after 中的用户邮箱字段按"保留首 2 字符 + *** + @ + 域名"脱敏）
- [ ] F4：日志 append-only 保护（只追加，任何入口均不可修改、不可删除）

## 数据实体草图
- OperationLog: { id, 操作者标识(operator_id), 操作类型(action: create|update|delete), 目标实体类型(entity_type: user|role|dept), 目标实体标识(entity_id), 操作时间(operated_at), 变更前快照(before，仅含本次变更字段，create 时为空), 变更后快照(after，仅含本次变更字段，delete 时为空), 创建时间(created_at，用于 90 天保留期清理) }
- before/after 仅记录实际发生变更的字段，未变更字段不出现在快照中；create 操作 before 为空，delete 操作 after 为空。
- entity_type 本期为闭合枚举：user | role | dept（依据 Q3 已决策）。
- PII 脱敏在查询返回时进行，不改变存储内容：before/after 中"邮箱"类型字段值在返回时按"保留首 2 字符 + *** + @ + 域名"格式脱敏（依据 Q2 已决策）。

## 非功能需求
- 性能：日志查询在常规日志量下应即时返回，支持分页避免一次性全量加载；默认按操作时间倒序以聚焦近期操作。
- 安全：仅具备 audit:read 权限者可查询日志；日志 append-only，任何入口（含管理后台、批量入口、快捷入口）均不可修改或删除；查询返回的 PII（用户邮箱）须脱敏。
- 兼容：与现有 user/role/dept 领域兼容，不改变这些实体的既有字段语义；日志记录为被动旁路，不影响主操作成败（主操作失败则不记录）。
- 保留期：日志保留 90 天，本期仅记录 created_at 供后续清理任务使用；清理任务本期不实现。

## 验收标准（Given/When/Then）

### F1：自动记录写操作
- Given 管理员对一个用户执行创建操作 When 操作成功 Then 系统自动生成一条日志，action=create、entity_type=user、entity_id=新用户标识、before 为空、after 含本次创建的字段（含邮箱）、operated_at 记录操作时间
- Given 管理员对一个用户执行更新操作（仅修改了姓名，未改邮箱）When 操作成功 Then 系统自动生成一条日志，action=update，before/after 仅含姓名字段，邮箱未出现在快照中（未变更字段不记录）
- Given 管理员对一个角色执行删除操作 When 操作成功 Then 系统自动生成一条日志，action=delete、entity_type=role，before 含删除前角色字段、after 为空
- Given 管理员查询用户列表（读操作）When 操作完成 Then 不生成任何日志条目（依据 Q1）
- Given 管理员查询操作日志本身（读操作）When 操作完成 Then 不生成日志条目，避免查询递归（依据 Q1）
- Given 主操作因校验失败未成功（如创建用户时邮箱重复）When 操作失败 Then 不生成日志条目（仅成功写操作记录）

### F2：分页查询操作日志
- Given 系统存在 25 条日志 When 管理员请求第 2 页（每页 10 条） Then 返回第 11-20 条日志，结果含总条数 25 与总页数 3，且按 operated_at 倒序排列（依据 Q4）
- Given 系统存在跨多日的日志 When 管理员按时间范围 [2026-06-01, 2026-06-30] 过滤 Then 仅返回 operated_at 落在该区间的日志
- Given 系统存在多个操作者的日志 When 管理员按操作者 O1 过滤 Then 仅返回 operator_id=O1 的日志
- Given 系统存在多种实体类型的日志 When 管理员按 entity_type=user 过滤 Then 仅返回 entity_type=user 的日志
- Given 管理员未传入任何过滤条件 When 请求第 1 页 Then 返回全部日志按 operated_at 倒序的第 1 页，默认每页 20 条（依据 Q4）
- Given 管理员提交 page_size=200（超过上限 100）When 请求日志 Then 系统按上限 100 返回，明确提示每页上限为 100（依据 Q4）
- Given 管理员具备 audit:read 权限 When 查询日志 Then 可正常查询
- Given 管理员不具备 audit:read 权限 When 尝试查询日志 Then 操作被拒绝

### F3：查询返回时 PII 脱敏
- Given 日志条目的 after 快照中含用户邮箱 "abcdef@example.com" When 管理员查询该日志 Then 返回结果中该邮箱字段显示为 "ab***@example.com"（保留首 2 字符 + *** + @ + 域名，依据 Q2）
- Given 日志条目的 before 快照中含用户邮箱 "abcdef@example.com"（更新前原值）When 管理员查询该日志 Then before 中的该邮箱同样显示为 "ab***@example.com"
- Given 日志条目的 after 快照中含非邮箱字段（如姓名、状态）When 管理员查询该日志 Then 这些字段按原值返回，不脱敏
- Given 多条日志均含邮箱字段 When 管理员查询日志列表 Then 列表中每条日志的邮箱字段均被脱敏，无遗漏
- Given 日志存储内容含原始邮箱 When 任何查询入口返回 Then 均不暴露未脱敏邮箱（依据 Q2：本期不提供未脱敏返回入口）

### F4：日志 append-only 保护
- Given 已存在一条日志条目 When 任何管理员尝试修改该日志 Then 操作被拒绝，日志内容不变
- Given 已存在一条日志条目 When 任何管理员尝试删除该日志 Then 操作被拒绝，日志保留
- Given 任一入口（含管理后台、批量操作、快捷入口）When 尝试修改或删除日志 Then 均被拒绝

## 不确定项
- [CONFIRMED] Q1：操作日志是否记录查询操作本身（如管理员查日志）？—— 产品背景已给定"读操作不记录"，查询属读操作。已确认结论：查询日志操作本身不记录入日志（避免查询递归与噪音）；所有读操作均不记录，仅 create/update/delete 写操作记录。判断为非 BLOCKING（产品背景已给定，无开放性）。
- [BLOCKING] Q2：before/after 快照中的 PII（如用户邮箱）在查询返回时是否脱敏？—— 阻塞下游：F3 脱敏验收标准、查询返回契约与边界、与 SEC-003b PII 脱敏要求一致性。已决策：脱敏——查询返回时，before/after 中"邮箱"类型字段按"保留首 2 字符 + *** + @ + 域名"格式脱敏，与列表返回脱敏规则一致；存储内容保留原始值（以备潜在深度审计），但本期查询入口仅返回脱敏值，不提供未脱敏返回入口。理由：与 SEC-003b PII 脱敏要求一致；before/after 是变更追溯的核心载体，含邮箱属常见场景（如用户邮箱更新），脱敏避免审计查询成为 PII 批量导出通道；存储保留原值以应对潜在深度审计需求，但本期不暴露未脱敏返回入口，收敛风险面。
- [BLOCKING] Q3：实体类型枚举是固定 user/role/dept 还是可扩展？—— 阻塞下游：数据实体 entity_type 取值契约与 F1 记录边界。已决策：本期固定闭合枚举 user/role/dept，不提供运行时扩展机制；后续新增领域时由对应领域 PRD 同步扩展枚举（参照 PRD-ROLE-001 Q2"权限码随模块 PRD 扩展枚举"哲学）。理由：本期仅 user/role/dept 三个领域有写操作；固定枚举简化契约与校验；扩展留待后续领域新增时协同处理，避免过早设计。
- [BLOCKING] Q4：日志查询的分页与排序默认值？—— 阻塞下游：F2 查询契约（默认排序、分页参数与上限）。已决策：默认按 operated_at 倒序（最新优先）；分页参数为 page（页码，从 1 起，默认 1）+ page_size（每页条数，默认 20，上限 100，超上限按上限处理并提示）。理由：审计场景聚焦近期操作，倒序符合直觉；分页避免全量加载；默认 20 条/页与既有领域（PRD-USER-001 F1）分页惯例一致；设上限防止滥用与性能风险。
- [OPEN] Q5：是否需要支持按 action（create/update/delete）过滤查询？—— 非阻断。当前 F2 仅明确时间范围、操作者、实体类型三个过滤维度；按 action 过滤可作为后续迭代增强，不影响本期核心契约。
- [OPEN] Q6：日志保留 90 天的清理任务本期不做，清理任务的具体实现（清理策略、执行时机、失败重试）待后续 PRD 定义。—— 非阻断。本期仅记录 created_at 字段供后续清理任务使用。
- [OPEN] Q7：为用户分配/移除角色（UserRole 关联变更，见 PRD-ROLE-001 F4）在日志中如何归类（entity_type=user 还是 role）？—— 非阻断。本期约定：UserRole 分配/移除按 entity_type=role、action=update 记录，before/after 反映该角色被分配用户集合的变更；如审计场景更关注"用户获得了哪些权限"，可在后续迭代调整为 entity_type=user 视角或双视角记录，不影响本期核心契约。

## 跨域依赖
- 依赖用户管理（PRD-USER-001）：本领域记录 user 实体的 create/update/delete；before/after 快照中含用户邮箱字段，查询返回时须脱敏（Q2 已决策）。本领域不改变 User 实体既有字段语义，仅旁路记录其变更。
- 依赖角色管理（PRD-ROLE-001）：本领域记录 role 实体的 create/delete；依据 PRD-ROLE-001"角色权限码集合创建后不可修改"，role 实体本身无字段级 update，故 role 的 update 日志主要来源于为用户分配/移除角色（UserRole 关联变更），按 Q7 约定归类为 entity_type=role、action=update。
- 依赖部门管理（PRD-DEPT-001）：本领域记录 dept 实体的 create/delete 及用户部门归属变更（F4 维护用户部门归属视为 user 的 update）。
- 引入新权限码 audit:read（查询操作日志）：依据 PRD-ROLE-001 Q2"权限码随模块 PRD 扩展枚举"，需将 audit:read 纳入权限码枚举；内置 admin 角色按 PRD-ROLE-001 Q4 决策自动覆盖该新权限码。
- 与三个领域均为被动旁路关系：日志记录不影响主操作成败，主操作失败则不记录日志；本领域不向 user/role/dept 实体引入新字段。
