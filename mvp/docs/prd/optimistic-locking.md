---
doc_type: PRD-Spec
id: PRD-OPTIMISTIC-LOCKING-001
title: 乐观锁并发控制（version 字段 + If-Match 条件请求 + 冲突检测）
status: decided
# Q&A 决策结果：Q1=①全部 / Q2=认可 / Q3=①纯数字 / Q4=①必填 / Q5=①delete需要 / Q6=①状态转移需要 / Q7=①关联不需要 / Q8=②transfer不纳入 / Q9=认可 / Q10=①扩展响应体 / Q11=①审计记录 / Q12=认可 / Q13=认可
owner: ba@team
created: 2026-07-02
extends: PRD-ROLE-INHERITANCE-001
prd_ref: RETRO-ROUND8-001
---

# 乐观锁并发控制（version 字段 + If-Match 条件请求 + 冲突检测）

## 背景
前八轮演练（RETRO-ROUND8-001 §5）已覆盖 CRUD / 审计埋点 / 报表聚合 / 事务补偿 / 递归继承。现有系统的所有 update 操作（user.updateStatus / role.setParent·unsetParent / notification.update·send·markRead）**无并发控制**——两个管理员同时编辑同一资源时，后写入者覆盖先写入者的修改（lost update），且双方都收到 200 成功响应，无任何冲突感知。

本期引入**乐观锁**（optimistic locking）验证以下未覆盖的工作流边界：

1. **HTTP 条件请求**：复用 RFC 7232 的 `If-Match` header 携带客户端持有的版本号，service 层比对实体当前 version，不匹配则拒绝（VERSION_CONFLICT 409）。这是新协议交互模式，现有 server.ts 的路由分发仅解析 path/query/body，未解析 header 中的条件请求字段。
2. **version 字段扩散**：可编辑实体（User / Role / Notification）须追加 `version: number` 字段，每次成功 update +1。这是跨实体 schema 变更，须验证 ARCH-002（contracts SSOT 扩散）与 AI-006（受影响测试清单两类标注）在多实体同步变更下的闭合。
3. **冲突检测语义**：version 不匹配时的错误码（VERSION_CONFLICT）、缺 If-Match header 的错误码（VERSION_REQUIRED），以及冲突响应是否返回服务端当前 version（供客户端重试）。这是新错误码类型，须验证 CODE-001~004 与 SEC-003a 在新场景下闭合。
4. **delete + 状态转移的版本校验**：delete（role.delete / notification.delete）与状态转移（notification.send / markRead）本质也是实体更新，是否纳入 If-Match 校验须明确边界。这是新校验边界，须验证既有守卫顺序（B5→B6→B7/B8）与版本校验的编排顺序。
5. **AI-007 端到端验收**：并发冲突是跨层行为（HTTP header 解析 → router safeParse → service 比对 version → repository 更新），须端到端验收（模拟两个客户端持有不同 version 的 If-Match，断言后者冲突）。

本期在既有 user/role/notification 三域上**扩展并发控制能力**（非新增领域），作为上述五方向的验证载体。乐观锁 = version 字段 + If-Match 条件请求 + 冲突检测，是"HTTP 协议扩展 + 跨实体 schema 扩散 + 并发语义"的最小完整场景。

## 业务目标
- **目标1（version 字段）**：可编辑实体（User / Role / Notification）追加 `version: number` 字段，初始 0，每次成功 update（含 delete / 状态转移）+1；list/detail 响应返回 version 供客户端发起 If-Match。
- **目标2（If-Match 条件请求）**：所有写操作（update / delete / 状态转移）必须携带 `If-Match: <version>` header，service 层比对实体当前 version，不匹配抛 VERSION_CONFLICT（409）；缺失 header 抛 VERSION_REQUIRED（400）。
- **目标3（冲突响应）**：VERSION_CONFLICT 响应体含服务端当前 version（`current_version` 字段），供客户端 GET 最新资源后重试。
- **目标4（守卫顺序编排）**：版本校验插入既有守卫顺序的位置须明确（推荐：实体存在校验之后、业务规则校验之前，确保"不存在"优先于"版本过期"）。
- **目标5（验证工作流适应性）**：验证 ARCH-002（version 扩散到 3 实体）、AI-006（受影响测试三类标注：①schema 变更 ②既有测试加 If-Match ③新增并发冲突测试）、AI-007（端到端验收 lost update 防护）、SEC-003a（If-Match header schema 校验）在 HTTP 条件请求新领域下是否闭合。

## 用户故事
- 作为管理员，我希望编辑用户状态时携带版本号，若该用户已被他人修改则收到冲突提示（含当前版本号），避免我的修改静默覆盖他人成果。
- 作为管理员，我希望编辑通知草稿时系统检测版本冲突，提示我重新获取最新内容后再编辑，避免多人协作编辑通知时丢失修改。
- 作为管理员，我希望设置角色继承关系时携带版本号，防止两个管理员同时修改同一角色的继承关系导致状态不一致。
- 作为管理员，我希望删除资源时携带版本号，防止删除一个已被他人修改的资源（基于过期视图的删除可能误删他人的中间修改）。
- 作为系统负责人，我希望乐观锁通过 HTTP 标准 `If-Match` header 实现，复用 RFC 7232 语义，而非自定义 body 字段，保持 RESTful 规范性。

## 功能点清单
- [ ] F1：实体 version 字段扩展（User / Role / Notification 追加 `version: number`，初始 0，update +1；list/detail 返回 version）
- [ ] F2：If-Match 条件请求解析（server.ts 从 header 解析 If-Match，注入 procedure input；缺失 → VERSION_REQUIRED 400）
- [ ] F3：写操作版本校验（update / delete / 状态转移：service 比对 If-Match version 与实体当前 version，不匹配 → VERSION_CONFLICT 409，响应含 current_version）
- [ ] F4：守卫顺序编排（版本校验插入"实体存在"之后、"业务规则"之前；既有守卫顺序文档同步更新）

## 数据实体草图
- **User 扩展字段**：`version: z.number().int().min(0)`（初始 0，updateStatus 时 +1）。
- **Role 扩展字段**：`version: z.number().int().min(0)`（初始 0，setParent/unsetParent 时 +1；内置 admin version 恒 0 但因 ROLE_BUILTIN_FORBIDDEN 不可达更新路径）。
- **Notification 扩展字段**：`version: z.number().int().min(0)`（初始 0，update/send/markRead 时 +1；sent/read 态因 append-only 守卫不可达更新路径，但 version 仍随状态转移 +1）。
- **Department**：不加 version（PRD-DEPT-001 Q6 决策 name/parent_id 创建后不可编辑，无 update 端点，delete 守卫为结构约束 DEPT_HAS_CHILDREN，非并发敏感）。
- **UserRole（关联表）**：不加 version（assign/remove 是 insert/delete 而非 update，无 lost update 风险）。
- **If-Match header 契约**：
  - 格式：`If-Match: <version>`（纯数字，非 ETag 引号格式，MVP 简化）。
  - 解析：server.ts 提取 header → 注入 procedure input 的 `expected_version` 字段 → schema 校验为 `z.number().int().min(0)`。
  - 缺失：procedure input 的 `expected_version` 为 undefined → schema superRefine 拒绝 → VERSION_REQUIRED（400）。
- **VERSION_CONFLICT 响应体扩展**：
  - 标准错误响应体 `{ code, message }` 追加可选 `current_version: number` 字段（仅 VERSION_CONFLICT 时填充，供客户端重试）。
- **新增错误码（contracts 联动）**：
  - `VERSION_REQUIRED`：写操作缺失 If-Match header（400，入参校验失败层级）。
  - `VERSION_CONFLICT`：If-Match version 与实体当前 version 不匹配（409，状态冲突，与 USER_ALREADY_* 409 同层级）。
- **既有错误码复用**：
  - `VALIDATION_ERROR`：If-Match header 格式非法（非数字 / 负数）。

## 验收标准（Given/When/Then）—— AI-007 端到端验收依据

### F1 实体 version 字段扩展
- **AC-F1-1 version 初始值**：GIVEN 创建一个新 User / Role / Notification / WHEN 创建成功 / THEN 实体 version === 0。
- **AC-F1-2 update 递增 version**：GIVEN User version=0 / WHEN updateStatus 成功 / THEN User version === 1。
- **AC-F1-3 多次 update 递增**：GIVEN Notification draft version=0 / WHEN update → send → markRead 依次成功 / THEN version === 3（每次状态转移 +1）。
- **AC-F1-4 list/detail 返回 version**：GIVEN 任意实体存在 / WHEN 查询 list 或 detail / THEN 响应体含 version 字段。
- **AC-F1-5 内置 admin version 恒 0**：GIVEN 内置 admin 角色 / WHEN 查询 detail / THEN version === 0（内置角色不可更新，version 永不递增）。

### F2 If-Match 条件请求解析
- **AC-F2-1 缺失 If-Match**：GIVEN 任意写操作请求 / WHEN 不携带 If-Match header / THEN 抛 VERSION_REQUIRED（400）。
- **AC-F2-2 If-Match 格式非法**：GIVEN 任意写操作请求 / WHEN If-Match 为非数字（如 "abc"）/ THEN 抛 VALIDATION_ERROR（400）。
- **AC-F2-3 If-Match 负数**：GIVEN 任意写操作请求 / WHEN If-Match 为 "-1" / THEN 抛 VALIDATION_ERROR（400）。
- **AC-F2-4 If-Match 合法注入**：GIVEN 写操作请求 / WHEN If-Match: "0" / THEN procedure input 含 expected_version=0，进入 service 层。

### F3 写操作版本校验
- **AC-F3-1 版本匹配 → 成功**：GIVEN User version=0 / WHEN updateStatus 携带 If-Match: 0 / THEN 更新成功，version → 1。
- **AC-F3-2 版本不匹配 → 冲突**：GIVEN User version=1（已被他人修改）/ WHEN updateStatus 携带 If-Match: 0（过期）/ THEN 抛 VERSION_CONFLICT（409），响应体含 current_version=1。
- **AC-F3-3 delete 版本校验**：GIVEN Role version=0 / WHEN delete 携带 If-Match: 0 / THEN 删除成功；若 If-Match: 99 → VERSION_CONFLICT。
- **AC-F3-4 状态转移版本校验**：GIVEN Notification draft version=0 / WHEN send 携带 If-Match: 0 / THEN 发送成功 version → 1；若 If-Match: 99 → VERSION_CONFLICT。
- **AC-F3-5 冲突不修改实体**：GIVEN User version=1 / WHEN updateStatus 携带 If-Match: 0 冲突 / THEN User 状态不变、version 不变、无审计日志。
- **AC-F3-6 并发 lost update 防护**：GIVEN User version=0 / WHEN 客户端 A updateStatus If-Match:0 成功（version→1），客户端 B 随后 updateStatus If-Match:0 / THEN 客户端 B 收到 VERSION_CONFLICT，User 最终状态 = A 的修改（B 的修改未覆盖）。

### F4 守卫顺序编排
- **AC-F4-1 不存在优先于版本**：GIVEN 不存在的 User id / WHEN updateStatus 携带任意 If-Match / THEN 抛 USER_NOT_FOUND（404，非 VERSION_CONFLICT）。
- **AC-F4-2 版本优先于业务规则**：GIVEN User version=0 已禁用 / WHEN updateStatus(disabled) 携带 If-Match: 99 / THEN 抛 VERSION_CONFLICT（409，非 USER_ALREADY_DISABLED 409——版本冲突优先于业务状态冲突）。
- **AC-F4-3 版本校验位置文档化**：GIVEN 任意写操作 / WHEN 审视 service 头部注释 / THEN 守卫顺序含"实体存在 → 版本校验 → 业务规则"（B5 → B_version → B6/B7/B8）。

## Q&A 决策（全 BLOCKING，未回答不进入 Spec）

**Q1 · 乐观锁覆盖范围？**
BLOCKING。方案①全部可编辑实体（User / Role / Notification）；方案②仅 User + Notification（Role 继承关系变更频率低）；方案③仅 Notification（draft 编辑场景最典型）。本期选哪个？推荐①（一致性——Role setParent 也是并发敏感，两管理员同时改同一角色继承关系会冲突；且验证 version 扩散到 3 实体的工作流适应性）。是否认可？

**Q2 · version 字段类型与初始值？**
BLOCKING。`version: z.number().int().min(0)`，初始 0，每次成功 update（含 delete / 状态转移）+1。是否认可？

**Q3 · If-Match header 格式？**
BLOCKING。方案①纯数字（`If-Match: 0`，MVP 简化，非 RFC 7232 标准 ETag 引号格式）；方案②弱 ETag（`If-Match: W/"0"`，RFC 7232 标准）。本期选哪个？推荐①（MVP 简化，避免 ETag 生成/解析复杂度；纯数字足够验证条件请求语义）。是否认可？

**Q4 · If-Match 缺失行为？**
BLOCKING。方案①必填，缺失 → VERSION_REQUIRED（400）；方案②可选，缺失则跳过版本校验（向后兼容）。本期选哪个？推荐①（强一致性，防止客户端遗漏导致 lost update 防护失效；VERSION_REQUIRED 明确提示客户端必须携带版本号）。是否认可？

**Q5 · delete 是否需要 If-Match？**
BLOCKING。方案①需要（防止删除已被他人修改的资源，基于过期视图的删除可能误删）；方案②不需要（delete 是幂等终态操作）。本期选哪个？推荐①（一致性，delete 本质是实体更新——存在→不存在；且验证 delete 路径的版本校验编排）。是否认可？

**Q6 · 状态转移（notification.send / markRead）是否需要 If-Match？**
BLOCKING。方案①需要（状态转移也是 entity 更新，version +1）；方案②不需要（状态转移是单方向，冲突概率低）。本期选哪个？推荐①（一致性，send/markRead 都使 version +1，须校验 If-Match；且验证状态转移与版本校验的编排）。是否认可？

**Q7 · assign/remove（user_role 关联）是否需要 If-Match？**
BLOCKING。方案①不需要（关联表无 version，是 insert/delete 而非 update，无 lost update 风险）；方案②需要 Role 的 version（分配角色改变了角色的 assigned_user_ids 虚拟字段）。本期选哪个？推荐①（关联表本身无 version 字段，assign/remove 是关联增删而非实体更新；assigned_user_ids 是审计虚拟字段非实体字段，不触发 version 递增）。是否认可？

**Q8 · transfer（调岗事务）是否纳入乐观锁范围？**
BLOCKING。方案①纳入（transfer 修改 user_role 关联，须校验 user.version）；方案②不纳入（transfer 是事务，本期聚焦单实体乐观锁，事务+乐观锁组合为未来方向）。本期选哪个？推荐②（transfer 修改的是 user_role 关联表而非 user 实体本身，user.version 不递增；事务边界已有补偿回滚保护，与乐观锁是正交关注点；保持 R9 聚焦单实体乐观锁）。是否认可？

**Q9 · 新增错误码与 HTTP 映射？**
BLOCKING。`VERSION_REQUIRED`（400，入参校验失败，与 VALIDATION_ERROR 同层）；`VERSION_CONFLICT`（409，状态冲突，与 USER_ALREADY_* 409 同层）。errors.ts 补齐 2 码映射。是否认可？

**Q10 · VERSION_CONFLICT 响应体扩展？**
BLOCKING。标准错误响应体 `{ code, message }` 追加可选 `current_version: number` 字段（仅 VERSION_CONFLICT 时填充，供客户端 GET 最新资源后重试）。是否认可？这是首次扩展 errorResponseSchema，须验证 ARCH-002（contracts SSOT）与既有错误响应消费者（server.ts 错误处理）的闭合。

**Q11 · 审计日志是否记录 version 变更？**
BLOCKING。方案①记录 before.version / after.version（审计完整性，便于追踪并发冲突历史）；方案②不记录（version 是元数据非业务字段）。本期选哪个？推荐①（version 变更是实体状态变更的一部分，审计日志应完整记录；且便于事后排查并发冲突）。是否认可？

**Q12 · 守卫顺序编排位置？**
BLOCKING。版本校验插入"实体存在校验（B5）"之后、"业务规则校验（B6/B7/B8）"之前。即：B5 实体存在 → B_version 版本匹配 → B6 内置 → B7 已分配 → B8 子角色。理由：不存在优先于版本过期（对一个不存在的资源谈版本冲突无意义）；版本优先于业务规则（基于过期视图的业务规则校验可能误判，如过期视图显示 active 但实际已 disabled，此时 USER_ALREADY_DISABLED 是基于过期数据的误判）。是否认可？

**Q13 · server.ts header 解析与 procedure input 注入？**
BLOCKING。server.ts 从 If-Match header 解析 version（纯数字），注入 procedure input 的 `expected_version` 字段。procedure input schema 追加 `expected_version: z.number().int().min(0)` + superRefine 校验必填（缺失 → VERSION_REQUIRED）。是否认可？这要求 procedure input schema 支持"header 来源字段"标注（与 path/query/body 来源字段混合），须验证 schema 层对多来源 input 的校验编排。

## Out of scope
- ETag 生成与缓存（RFC 7232 强 ETag / 弱 ETag 协商缓存）—— 本期 If-Match 用纯数字 version，不生成 ETag，缓存为未来工程化方向。
- If-None-Match / If-Modified-Since 等其他条件请求 —— 本期仅 If-Match，其他条件请求为未来工程化方向。
- 乐观锁重试中间件（自动 GET + 重试）—— 本期客户端手动重试，自动重试为未来工程化方向。
- 多实体事务的乐观锁（transfer + version）—— 本期聚焦单实体，事务+乐观锁组合为未来工程化方向（Q8 决策）。
- 悲观锁（SELECT FOR UPDATE）—— 本期仅乐观锁，悲观锁为 DB 层未来方向。
- Department / UserRole / AuditLog 的 version —— 这三实体无 update 端点（Dept 不可编辑 Q6 / UserRole 是关联增删 / AuditLog append-only），无 lost update 风险。
- OpenAPI yaml 同步（optimistic-locking.openapi.yaml）—— 记为遗留同步项，沿用既有先例。
