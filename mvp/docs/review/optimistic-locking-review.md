---
doc_type: Review-Report
id: REVIEW-OPTIMISTIC-LOCKING-001
tech_spec_ref: TECH-OPTIMISTIC-LOCKING-001
prd_ref: PRD-OPTIMISTIC-LOCKING-001
verdict: pass
created: 2026-07-02
---
# 乐观锁并发控制 · Code Review 报告（第九轮演练）

评审范围：第九轮"乐观锁并发控制"PR 全部代码——F1 实体 version 字段扩展（User/Role/Notification 三域）+ F2 If-Match 条件请求解析 + F3 写操作版本校验（含 lost update 防护）+ F4 守卫顺序编排，以及 AI-006 三类标注 / AI-007 端到端验收 / ARCH-001 domain 纯函数下沉 / SEC-003a If-Match header schema 校验 / CODE-002 补偿 catch 闭合四项验证。对照 `docs/prd/optimistic-locking.md`（18 个 AC：F1 5 + F2 4 + F3 6 + F4 3）、`docs/spec/optimistic-locking.tech.md`（D1~D20 决策 + §9 受影响测试清单三类标注）与 `.trae/rules` 全部规则逐条核查。

本轮第九轮演练核心验证：①version 字段扩散到 3 实体（ARCH-002 contracts SSOT 扩散 + AI-006 ①类 schema 变更影响）②HTTP 条件请求新协议模式（server.ts 解析 If-Match header + 注入 procedure input + 合并 meta 到响应体，复用 RFC 7232 If-Match 语义但用纯数字 version 简化）③冲突检测语义（VERSION_REQUIRED 400 / VERSION_CONFLICT 409 + current_version 字段供客户端重试）④守卫顺序编排（B5 实体存在 → B_version 版本匹配 → B6/B7/B8 业务规则，不存在优先于版本过期，版本优先于业务规则）⑤AI-007 端到端验收（spawn 真实 HTTP server + fetch 模拟两客户端持不同 version 的 If-Match，断言 lost update 防护）。

## 汇总
- blocker 数：**0**
- suggestion 数：**2**
- verdict：**pass**（三件套全绿 649/649；AI-007 PRD F1/F2/F3/F4 验收 18 条逐条对齐；AI-006 三类标注准确（①类 errorCodeSchema/errorResponseSchema 经 SSOT 派生 + tsc 结构性保证 + 行为测覆盖 / ②类 10 既有测试文件 setup 全部追加 version:0 + expected_version / ③类 18+8 新增测试覆盖 18 AC + 端到端 lost update）；2 项 advisory 偏离均已评估，记 suggestion 为工作流改进）
- 三件套门禁复核（Reviewer 实跑）：
  - typecheck：`pnpm typecheck` exit 0，0 错误 ✅
  - lint:rules：`pnpm lint:rules` exit 0，13 项 enforcement + META-003/004 双向绑定 + 2 条 SEC-002 豁免审计 info + 6 条 AI-005 建议（R6 既有遗留，非本期新增） ✅
  - test：`pnpm test` exit 0，14 文件 649/649（audit 104 / audit-embedding 14 / dept 92 / notification 88 / notification-embedding 14 / optimistic-locking 18 / optimistic-locking-embedding 8 / report 86 / role 73 / role-inheritance 65 / role-inheritance-embedding 26 / transfer 25 / transfer-embedding 6 / user 35），4.22s ✅
- HTTP 运行时烟测：`optimistic-locking-embedding.test.ts` spawn 真实 server + fetch 8 用例全链路通过（If-Match 解析 4 + lost update 防护 1 + current_version 返回 1 + 冲突不修改实体 1 + notification send 版本校验 1），覆盖 AC-F2-1~F2-4 + AC-F3-2/F3-5/F3-6 HTTP-level + send 版本校验 ✅
- 规则机器化覆盖率：13/19 = 68%（与第七轮持平，本期不新增规则文件、不新增 markEnforcement 分支）

## 总体结论

三件套全绿，乐观锁三件套（F1 version 字段扩散 + F2 If-Match 条件请求解析 + F3 写操作版本校验 + F4 守卫顺序编排）实现质量高。AI-007 端到端测试（optimistic-locking-embedding.test.ts 8 用例）spawn 真实 HTTP server + fetch 覆盖 PRD F2/F3 共 7 条 Given/When/Then HTTP-level 断言（含 lost update 防护 + current_version 返回 + 冲突不修改实体 + send 版本校验先于状态转移校验），AI-007 关键——HTTP 条件请求新协议模式（If-Match header 解析 → procedure input 注入 → service 比对 version → 响应合并 meta）端到端可观测。

**本轮核心验证目标全部达成**：①version 字段扩散到 3 实体在 ARCH-002 下闭合（contracts SSOT 单点定义 + z.infer 派生，3 实体 schema 各追加 version: z.number().int().min(0)）；②HTTP 条件请求新协议模式在 server.ts 工程脚手架下闭合（Route.versioned 标记 + parseIfMatch 纯函数 + safeParse 之前拦截 VERSION_REQUIRED/VALIDATION_ERROR + 合并 e.meta 到响应体）；③守卫顺序编排 B5 → B_version → B6/B7/B8 在 8 个写操作（updateStatus / role.delete / setParent / unsetParent / notification.update / send / markRead / delete）下闭合；④AI-007 端到端 + Reviewer PRD 18 条逐条核对双轨闭合；⑤AI-006 三类标注完整（①类 SSOT 派生 + tsc 结构性保证 / ②类 10 既有测试文件 setup 全部同步 / ③类 18+8 新增测试覆盖 18 AC + 端到端 lost update）。1 项 advisory 偏离（D15 setParentProcedureInputSchema 独立声明）实现注释已说明理由，但 Tech-Spec §7 D15 未反向同步（记 S-1）。

## AI-007 PRD 验收逐条核对（本轮核心硬要求）

对照 PRD `docs/prd/optimistic-locking.md` §验收标准（F1 version 字段 5 条 + F2 If-Match 解析 4 条 + F3 版本校验 6 条 + F4 守卫顺序 3 条 = 18 条 Given/When/Then），逐条核对实现行为是否对齐。

### F1：实体 version 字段扩展（5 条）

| # | PRD 验收点（Given/When/Then，行号） | 实现行为 | 测试覆盖 | 对齐结论 |
|---|---|---|---|---|
| F1-1 | §69 version 初始值：GIVEN 创建新 User/Role/Notification / WHEN 创建成功 / THEN version === 0 | `service/user.ts:69` create 填 `version: 0`；`service/role.ts:83` create 填 `version: 0`；`service/notification.ts:56` create 填 `version: 0`（D1/D8：初始 0） | `optimistic-locking.test.ts:167-191` AC-F1-1（user/role/notification 三域 create 返回 entity.version === 0） | ✅ 对齐 |
| F1-2 | §70 update 递增 version：GIVEN User v0 / WHEN updateStatus 成功 / THEN version === 1 | `service/user.ts:86-123` updateStatus → `repository/user.ts:65-71` updateStatus 内 `version: u.version + 1`（D7） | `optimistic-locking.test.ts:193-198` AC-F1-2（updateStatus(0) → version===1, status===disabled） | ✅ 对齐 |
| F1-3 | §71 多次 update 递增：GIVEN Notification draft v0 / WHEN update→send→markRead / THEN version === 3 | `service/notification.ts:70-124` update（repo.update +1）→ `:126-171` send（repo.updateStatusAndSentAt +1）→ `:174-211` markRead（repo.updateStatusAndReadAt +1）；`repository/notification.ts:45-91` 三方法各 +1（D7） | `optimistic-locking.test.ts:200-227` AC-F1-3（update(v0)→v1 / send(v1)→v2 / markRead(v2)→v3） | ✅ 对齐 |
| F1-4 | §72 list/detail 返回 version：GIVEN 任意实体存在 / WHEN 查询 list 或 detail / THEN 响应体含 version | `contracts/schemas/user.ts:35` userSchema 含 version；`role.ts:60` roleSchema 含 version；`notification.ts:43` notificationSchema 含 version（D1）；service list/getById/detail 返回 schema-typed 实体 | `optimistic-locking.test.ts:229-263` AC-F1-4（user list + role list + role detail + notification list + notification detail，断言 version 字段存在且类型 number） | ✅ 对齐 |
| F1-5 | §73 内置 admin version 恒 0：GIVEN 内置 admin 角色 / WHEN 查询 detail / THEN version === 0 | `repository/role.ts:38-50` seedBuiltinAdmin 填 `version: 0`（D8）；admin 不可达更新路径（`service/role.ts:112-114` delete B6 ROLE_BUILTIN_FORBIDDEN + `:278-280` unsetParent B6 ROLE_BUILTIN_FORBIDDEN；setParent B5b parentIsBuiltin 校验拒绝 admin 作父） | `optimistic-locking.test.ts:265-272` AC-F1-5（getById(admin).version === 0 + is_builtin === true） | ✅ 对齐 |

**F1 小结：5/5 对齐**。3 实体 schema 均追加 `version: z.number().int().min(0)`（D1），create 填 0（D8），3 repo 的 5 个 update 方法（UserRepository.updateStatus/updateDepartmentId / RoleRepository.update / NotificationRepository.update/updateStatusAndSentAt/updateStatusAndReadAt）各 +1（D7），delete 不递增（D7 注释：delete 移除实体无 version 概念）。内置 admin 不可达更新路径，version 恒 0。

### F2：If-Match 条件请求解析（4 条）

| # | PRD 验收点（Given/When/Then，行号） | 实现行为 | 测试覆盖 | 对齐结论 |
|---|---|---|---|---|
| F2-1 | §76 缺失 If-Match：GIVEN 任意写操作 / WHEN 不携带 If-Match / THEN VERSION_REQUIRED（400） | `server.ts:379-390` parseIfMatch：headerValue undefined 或空 → `{ ok: false, errorCode: 'VERSION_REQUIRED' }`；`server.ts:426-436` handle：route.versioned 时调 parseIfMatch，!ok 且 errorCode=VERSION_REQUIRED → `sendJson(res, 400, { error: 'VERSION_REQUIRED', ... })`（D17/D18，safeParse 之前拦截） | `optimistic-locking-embedding.test.ts:123-131` AC-F2-1（PATCH /v1/users/:id/status 无 If-Match → 400 VERSION_REQUIRED） | ✅ 对齐 |
| F2-2 | §77 If-Match 格式非法（"abc"）：GIVEN 写操作 / WHEN If-Match 非数字 / THEN VALIDATION_ERROR（400） | `server.ts:386-388` parseIfMatch：`if (!/^\d+$/.test(trimmed)) return { ok: false, errorCode: 'VALIDATION_ERROR' }`；`server.ts:432-434` handle → `sendJson(res, 400, { error: 'VALIDATION_ERROR', ... })` | `optimistic-locking-embedding.test.ts:133-141` AC-F2-2（If-Match='abc' → 400 VALIDATION_ERROR） | ✅ 对齐 |
| F2-3 | §78 If-Match 负数（"-1"）：GIVEN 写操作 / WHEN If-Match 负数 / THEN VALIDATION_ERROR（400） | `server.ts:386-388` parseIfMatch：'-1' 不匹配 `/^\d+$/`（负号不匹配）→ VALIDATION_ERROR | `optimistic-locking-embedding.test.ts:143-151` AC-F2-3（If-Match='-1' → 400 VALIDATION_ERROR） | ✅ 对齐 |
| F2-4 | §79 If-Match 合法注入：GIVEN 写操作 / WHEN If-Match: "0" / THEN procedure input 含 expected_version=0，进入 service | `server.ts:389` parseIfMatch：`return { ok: true, version: Number(trimmed) }`；`server.ts:437` handle：`finalInput = { ...rawInput, expected_version: versionResult.version }`（D18，注入到 rawInput 后经 safeParse 校验为 z.number().int().min(0)） | `optimistic-locking-embedding.test.ts:153-166` AC-F2-4（新建用户 If-Match='0' → 200, version=1, status=disabled） | ✅ 对齐 |

**F2 小结：4/4 对齐**。parseIfMatch 纯函数（server.ts:379-390）三分支：undefined/空 → VERSION_REQUIRED；非纯数字 → VALIDATION_ERROR；合法非负整数 → ok 携带 version。handle 在 route.versioned=true 时于 safeParse 之前调用 parseIfMatch（D18：缺失/非法不进入 schema safeParse，精确区分 VERSION_REQUIRED vs VALIDATION_ERROR）。8 个 versioned 路由（D20）均标记 versioned=true（server.ts:179/208/233/238/291/296/301/306）。

### F3：写操作版本校验（6 条）

| # | PRD 验收点（Given/When/Then，行号） | 实现行为 | 测试覆盖 | 对齐结论 |
|---|---|---|---|---|
| F3-1 | §82 版本匹配 → 成功：GIVEN User v0 / WHEN updateStatus If-Match:0 / THEN 更新成功 version→1 | `service/user.ts:94-97` validateVersion(0, 0) → ok → `repository/user.ts:65-71` updateStatus +1 | `optimistic-locking.test.ts:279-284` AC-F3-1（updateStatus(0) → version===1, status===disabled） | ✅ 对齐 |
| F3-2 | §83 版本不匹配 → 冲突：GIVEN User v1 / WHEN updateStatus If-Match:0（过期）/ THEN VERSION_CONFLICT（409）+ current_version=1 | `service/user.ts:96` `throw new AppError('VERSION_CONFLICT', msg, { current_version: target.version })`（D11）；`server.ts:461-462` `Object.assign(respBody, e.meta)` 合并 current_version 到响应体（D19） | `optimistic-locking.test.ts:286-301` AC-F3-2（service-level: e.meta.current_version===1）+ `optimistic-locking-embedding.test.ts:204-225` HTTP-level（res.body.current_version===1） | ✅ 对齐 |
| F3-3 | §84 delete 版本校验：GIVEN Role v0 / WHEN delete If-Match:0 / THEN 成功；If-Match:99 → VERSION_CONFLICT | `service/role.ts:107-110` B_version 校验（D9：B5→B_version→B6/B7/B8）；delete 不递增 version（D7） | `optimistic-locking.test.ts:303-328` AC-F3-3（成功 path: delete(v0)→void + 冲突 path: delete(v99)→VERSION_CONFLICT, current_version===0） | ✅ 对齐 |
| F3-4 | §85 状态转移版本校验：GIVEN Notification draft v0 / WHEN send If-Match:0 / THEN 成功 version→1；If-Match:99 → VERSION_CONFLICT | `service/notification.ts:134-137` send B_version 校验（D9：B5→B_version→B6→B7→B8）；send 后 repo.updateStatusAndSentAt +1 | `optimistic-locking.test.ts:330-356` AC-F3-4（成功 path: send(v0)→version===1, status===sent + 冲突 path: send(v99)→VERSION_CONFLICT, current_version===0）+ `optimistic-locking-embedding.test.ts:252-284` HTTP-level send 版本校验先于状态转移校验 | ✅ 对齐 |
| F3-5 | §86 冲突不修改实体：GIVEN User v1 / WHEN updateStatus If-Match:0 冲突 / THEN 状态不变、version 不变、无审计日志 | `service/user.ts:96` 抛 AppError 在 `repository/user.ts:65` updateStatus 之前 → 实体不变；`router/audit.ts:62-86` withAudit：handler 抛异常在 try 之前（await handler 在 try 外），不调 audit.record → 无审计日志 | `optimistic-locking.test.ts:358-374` AC-F3-5（service-level: status 仍 active, version 仍 0）+ `optimistic-locking-embedding.test.ts:230-247` HTTP-level（finalUser.status==='active', version===0） | ✅ 对齐（状态/version 不变有断言；无审计日志由 withAudit 结构性保证：handler 抛异常不调 record） |
| F3-6 | §87 并发 lost update 防护：GIVEN User v0 / WHEN A updateStatus If-Match:0 成功（v→1），B 随后 updateStatus If-Match:0 / THEN B 收到 VERSION_CONFLICT，User 最终状态=A 的修改（B 未覆盖） | `service/user.ts:94-97` B_version 校验 + `repository/user.ts:65-71` updateStatus 写入新 version（A 写后 version=1，B 持旧 v0 → validateVersion(0, 1) → VERSION_CONFLICT） | `optimistic-locking.test.ts:376-399` AC-F3-6（service-level: A 成功 v1 + B VERSION_CONFLICT current_version===1 + 最终 status===disabled, version===1）+ `optimistic-locking-embedding.test.ts:172-199` HTTP-level Lost Update（A 200 v1 + B 409 VERSION_CONFLICT current_version===1 + finalUser status===disabled, version===1） | ✅ 对齐 |

**F3 小结：6/6 对齐**。8 个写操作均按 D9 守卫顺序编排 B_version（service 层 validateVersion 纯函数 + 抛 AppError 携带 current_version meta）。冲突时 service 抛错在 repo update 之前 → 实体不变；withAudit handler 抛异常不调 record → 无审计日志（结构性保证）。端到端 lost update 防护通过 service-level + HTTP-level 双层断言（A 成功 v1 + B VERSION_CONFLICT current_version===1 + 最终状态=A 的写入）。

### F4：守卫顺序编排（3 条）

| # | PRD 验收点（Given/When/Then，行号） | 实现行为 | 测试覆盖 | 对齐结论 |
|---|---|---|---|---|
| F4-1 | §90 不存在优先于版本：GIVEN 不存在的 User id / WHEN updateStatus 任意 If-Match / THEN USER_NOT_FOUND（404，非 VERSION_CONFLICT） | `service/user.ts:89-92` B5 用户存在校验先于 `:94-97` B_version 版本校验（D9：B5 → B_version）；!target → throw USER_NOT_FOUND 在 validateVersion 之前 | `optimistic-locking.test.ts:406-409` AC-F4-1（updateStatus(MISSING_ID, 0) → USER_NOT_FOUND） | ✅ 对齐 |
| F4-2 | §91 版本优先于业务规则：GIVEN User v0 已禁用 / WHEN updateStatus(disabled) If-Match:99 / THEN VERSION_CONFLICT（409，非 USER_ALREADY_DISABLED 409） | `service/user.ts:94-97` B_version 版本校验先于 `:99-106` B6 禁用自身 + B7/B8 状态守卫（D9：B_version → B6/B7/B8）；validateVersion(99, 1) → VERSION_CONFLICT 在 transitionStatus 之前 | `optimistic-locking.test.ts:411-426` AC-F4-2（先 updateStatus(0)→disabled v1，再 updateStatus(disabled, 99) → VERSION_CONFLICT 而非 USER_ALREADY_DISABLED，证明版本校验先于业务规则） | ✅ 对齐 |
| F4-3 | §92 版本校验位置文档化：GIVEN 任意写操作 / WHEN 审视 service 头部注释 / THEN 守卫顺序含"实体存在 → 版本校验 → 业务规则"（B5 → B_version → B6/B7/B8） | `service/user.ts:3` 头部注释含 "B5 实体存在 → B_version 版本匹配 → B6/B7/B8 业务规则" + `:84` updateStatus 注释 "B3 鉴权 → B5 用户存在 → B_version 版本匹配 → B6 禁用自身 → B7/B8 状态守卫"；`service/role.ts:4-11` 头部注释含 "B_version"（delete/setParent/unsetParent 三处守卫顺序）；`service/notification.ts:9` 头部注释含 "B_version"（update/send/markRead/delete 四处守卫顺序） | `optimistic-locking.test.ts:428-436` AC-F4-3（readFileSync 读取三域 service 源码，断言 /B_version|版本校验/ 正则匹配） | ✅ 对齐 |

**F4 小结：3/3 对齐**。8 个写操作均按 D9 守卫顺序编排：B3 鉴权 → B5 实体存在 → B_version 版本匹配 → B6/B7/B8 业务规则。三域 service 头部注释均标识 B_version 守卫位置（D9 文档化）。AC-F4-2 关键断言"VERSION_CONFLICT 优先于 USER_ALREADY_DISABLED"证明版本校验在业务规则之前（行为可观测）。

### AI-007 PRD 逐条核对总结

- **F1 version 字段**：5/5 对齐（3 实体 schema 追加 version + create 初始 0 + 5 update 方法 +1 + list/detail 返回 version + 内置 admin 恒 0）
- **F2 If-Match 解析**：4/4 对齐（parseIfMatch 三分支 + safeParse 之前拦截 + 8 versioned 路由标记）
- **F3 版本校验**：6/6 对齐（8 写操作 B_version 守卫 + current_version meta + 冲突不修改实体 + lost update 防护双层断言）
- **F4 守卫顺序**：3/3 对齐（B5 → B_version → B6/B7/B8 + 头部注释文档化 + AC-F4-2 行为可观测）
- **合计**：18/18 对齐，0 偏离

**AI-007 是否生效**：✅ **生效**。optimistic-locking.test.ts 18 用例（service/domain 层）+ optimistic-locking-embedding.test.ts 8 用例（HTTP 端到端）对照 PRD F1/F2/F3/F4 每条 Given/When/Then 产出断言。端到端测试 spawn 真实 HTTP server（npx tsx apps/api/src/server.ts）+ fetch 发起 HTTP 请求，覆盖 server.ts 的 If-Match header 解析（D18）、错误响应合并 meta（D19）、路由 versioned 标记（D17）等工程脚手架行为，而非隔离自建实例。Reviewer 按 PRD 18 条验收逐条核对无 [约束] 偏离。

## AI-006 受影响测试清单校验（本轮核心）

### 清单章节存在性 + 三类标注完整性
- **章节存在**：Tech-Spec §9 受影响测试清单存在，三类标注齐全 ✅
- **三类标注**：
  - ①类·schema 变更影响（contracts 层）：实体 schema 字段集断言追加 version + errorCodeSchema 追加 2 码 + errorResponseSchema 覆盖 current_version
  - ②类·既有测试加 If-Match：涉及 10 文件 setup 辅助函数追加 version:0 + expected_version
  - ③类·新增并发冲突测试：optimistic-locking.test.ts 18 tests + optimistic-locking-embedding.test.ts 8 tests
- **三类均覆盖，缺一无** ✅ 满足 AI-006 增强硬要求

### ①类 schema 变更影响校验

**实体 schema 字段集断言追加 version**：
- `contracts/schemas/user.ts:35` userSchema 含 `version: z.number().int().min(0)`
- `contracts/schemas/role.ts:60` roleSchema 含 `version: z.number().int().min(0)`
- `contracts/schemas/notification.ts:43` notificationSchema 含 `version: z.number().int().min(0)`
- 既有契约测通过 `schema.parse()` 自动覆盖 version 字段（SSOT 派生）：`user.test.ts:139/152/374/393/402` userSchema.parse；`role.test.ts:275/285` roleSchema.parse；`notification.test.ts:423/427/432/490/795` notificationSchema.parse；`dept.test.ts:373/388/882` userSchema.parse
- setup 辅助函数（makeNotification/makeUser/seedUsers 等）均追加 `version: 0`，避免 schema.parse 因缺 version 字段失败
- ✅ 经 SSOT 派生 + tsc 结构性保证（z.infer 派生类型含 version）+ 既有 schema.parse 断言覆盖

**errorCodeSchema 追加 2 码（VERSION_REQUIRED / VERSION_CONFLICT）**：
- `contracts/schemas/user.ts:177,179` errorCodeSchema 追加 2 码（D2）
- `apps/api/src/errors.ts:65-66` errorCodeToHttpStatus 追加 2 码映射（VERSION_REQUIRED=400 / VERSION_CONFLICT=409，D14）—— `Record<ErrorCode, number>` 穷举，tsc TS2741 保证 2 码必补齐
- 既有契约测断言：`notification.test.ts:884-893` errorCodeSchema 含 4 个 NOTIFICATION_* 码；`role-inheritance.test.ts:676-680` errorCodeSchema 含 4 个 ROLE_INHERITANCE_* 码；`report.test.ts:960-961` errorCodeSchema 含 REPORT_* 码
- ⚠️ **未追加** errorCodeSchema 含 VERSION_REQUIRED/VERSION_CONFLICT 的契约测断言（Tech-Spec §9 ①类"errorCodeSchema 断言须追加 VERSION_REQUIRED / VERSION_CONFLICT"未字面执行）
- **补偿覆盖**：service-level `e.code === 'VERSION_CONFLICT'` 多处断言（optimistic-locking.test.ts:297/324/352/366/390/422）+ HTTP-level `res.body.error === 'VERSION_CONFLICT'`/`'VERSION_REQUIRED'`（optimistic-locking-embedding.test.ts:130/140/150/191/222/240/282）+ tsc Record<ErrorCode, number> 穷举保证 2 码必存在
- **结论**：✅ 行为覆盖 + 结构性保证，但 ⚠️ 契约测断言未字面追加（记 S-2 suggestion）

**errorResponseSchema 覆盖 current_version 可选字段**：
- `contracts/schemas/user.ts:188-194` errorResponseSchema 追加 `current_version: z.number().int().min(0).optional()`（D3）
- ⚠️ **未追加** errorResponseSchema.parse 含 current_version 的契约测断言（Tech-Spec §9 ①类"errorResponseSchema 断言须覆盖 current_version 可选字段"未字面执行）
- **补偿覆盖**：HTTP-level `res.body.current_version === 1` 多处断言（optimistic-locking-embedding.test.ts:192/223/283）+ service-level `e.meta?.current_version === 1`（optimistic-locking.test.ts:298/325/353/367/391/423）+ tsc z.infer<errorResponseSchema> 类型派生含 current_version?: number
- **结论**：✅ 行为覆盖 + 类型派生，但 ⚠️ 契约测断言未字面追加（与 S-2 同源，记同一 suggestion）

**①类结论**：✅ 经 SSOT 派生（AI-005）+ tsc 结构性保证 + 行为测覆盖，2 码 + current_version 字段均存在且被 exercise；⚠️ 但 Tech-Spec §9 ①类"errorCodeSchema/errorResponseSchema 断言须追加"未字面执行（记 S-2 suggestion，建议补一条契约测：`expect([...errorCodeSchema.options]).toContain('VERSION_REQUIRED')` + `expect(errorResponseSchema.safeParse({ code: 'VERSION_CONFLICT', message: 'x', current_version: 1 }).success).toBe(true)`）。

### ②类 既有测试加 If-Match 校验

Tech-Spec §9 ②类涉及文件清单（user/role/role-inheritance/notification/notification-embedding/role-inheritance-embedding/transfer/transfer-embedding/dept/audit-embedding，10 文件）+ setup 辅助函数追加 version:0 + expected_version。Reviewer grep 核实：

| 文件 | version:0 追加位置 | expected_version/If-Match 追加位置 | 结论 |
|---|---|---|---|
| `user.test.ts` | `:48` setupUsers | `:149/198/238/240/249/259/272/288/351/370/388/397/410/414/417` callProc updateStatus | ✅ |
| `role.test.ts` | `:63` seedUsers / `:79` makeRole | `:541/547/558/563/575/685/755/759` callProc delete | ✅ |
| `role-inheritance.test.ts` | `:59` makeRole / `:79` setup / `:149-174` detectCycle fixtures / `:442/458/476/493/508/529/538/603` userRepo.insert | `:157/179/278/477/515/528` callProc setParent/unsetParent/delete | ✅ |
| `notification.test.ts` | `:87/96/105/114/132` setup / makeNotification | `:412` updateNotificationProcedureInputSchema.safeParse / `:834/841/846/854/856/864` callProc update/send/markRead/delete | ✅ |
| `notification-embedding.test.ts` | `:93/102/111/157/166` setup | `:253/334/370/380/383/418/452/466/475/482/485/499/513/529/551` callProc send/update/markRead/delete | ✅ |
| `role-inheritance-embedding.test.ts` | `:100/132/356` makeRole/setup/userRepo.insert | `:157/179/278/477/515/528` callProc setParent/unsetParent/delete | ✅ |
| `transfer.test.ts` | `:65/74/87/97/345` seedUser/seedRole/builtin admin | （transfer 本身不 versioned，Q8 决策不纳入；setup 仅同步 version:0 字段） | ✅ |
| `transfer-embedding.test.ts` | `:165/175/190/200` seedUser/seedRole | （同上，setup 同步 version:0） | ✅ |
| `dept.test.ts` | `:85/386` seedUser/inline user | （dept 不 versioned，setup 同步 version:0） | ✅ |
| `audit-embedding.test.ts` | `:93` seedUser | `:235/305/575/583` callProc updateStatus/delete（埋点断言用 versioned 路由） | ✅ |

- **setup 辅助函数追加 version:0**：10 文件全部追加（seedUsers / makeRole / makeNotification / userRepo.insert 等），tsc exit 0 佐证 schema 必填字段满足
- **写操作调用追加 expected_version**：8 个 versioned 写操作（updateStatus / role.delete / setParent / unsetParent / notification.update/send/markRead/delete）的 callProc 调用全部追加 `expected_version: <number>`
- **transfer / dept 不 versioned**：Q8 决策 transfer 不纳入乐观锁，dept 无 version 字段；setup 仅同步实体 version:0 字段（因 user/role 实体 schema 追加 version 后，setup 须填 version:0 否则 schema.parse 失败）

**②类结论**：✅ 10 文件 setup 全部同步 version:0 + 8 versioned 写操作 callProc 全部追加 expected_version。tsc exit 0 + 649/649 测试通过佐证。

### ③类 新增并发冲突测试校验

Tech-Spec §9 ③类要求：optimistic-locking.test.ts 18 tests + optimistic-locking-embedding.test.ts 8 tests 覆盖 18 个 AC + 端到端 lost update。Reviewer 核实：

**optimistic-locking.test.ts（18 tests，service/domain 层）**：
- 单测 validateVersion：3 tests（`optimistic-locking.test.ts:150/154/158`，D5 纯函数）
- F1 version 字段：5 tests（AC-F1-1~F1-5，`:167/193/200/229/265`）
- F3 版本校验：6 tests（AC-F3-1~F3-6，`:279/286/303/330/358/376`）
- F4 守卫顺序：3 tests（AC-F4-1~F4-3，`:406/411/428`）
- 辅助 ctx 形状：1 test（`:443`，避免未用告警）
- 合计 18 tests ✅

**optimistic-locking-embedding.test.ts（8 tests，HTTP 端到端）**：
- F2 If-Match 解析：4 tests（AC-F2-1~F2-4，`:123/133/143/153`，spawn server + fetch）
- 端到端 Lost Update 防护：1 test（AC-F3-6 HTTP-level，`:173`，A 成功 v1 + B 409 VERSION_CONFLICT current_version===1 + 最终 A 的写入保留）
- 端到端 current_version 返回：1 test（AC-F3-2 HTTP-level，`:205`，冲突响应含 current_version===1）
- 端到端 冲突不修改实体：1 test（AC-F3-5 HTTP-level，`:231`，冲突时 status/version 保持原值）
- 端到端 Notification send 版本校验：1 test（`:253`，send 成功 v1 + 再次 send 错误 If-Match → 409 VERSION_CONFLICT，证明 B_version 先于 B6 状态转移校验）
- 合计 8 tests ✅

**18 AC 覆盖分布**：
- F1-1~F1-5（5）：optimistic-locking.test.ts（service/domain 层）✅
- F2-1~F2-4（4）：optimistic-locking-embedding.test.ts（HTTP 端到端，spawn server）✅
- F3-1~F3-6（6）：optimistic-locking.test.ts（service 层）+ F3-2/F3-4/F3-5/F3-6 额外在 optimistic-locking-embedding.test.ts HTTP-level 覆盖 ✅
- F4-1~F4-3（3）：optimistic-locking.test.ts（service 层 + readFileSync 注释断言）✅
- 端到端 lost update：optimistic-locking-embedding.test.ts:173 ✅

**③类结论**：✅ 18+8 新增测试覆盖 18 AC + 端到端 lost update。端到端测试 spawn 真实 HTTP server（npx tsx apps/api/src/server.ts）+ fetch，覆盖 server.ts If-Match 解析（D18）+ 错误响应合并 meta（D19）+ 路由 versioned 标记（D17）。

### AI-006 本轮是否生效
✅ **生效**。三类标注完整：
- ①类 SSOT 派生 + tsc 结构性保证 + 行为测覆盖（⚠️ 契约测断言未字面追加，记 S-2）
- ②类 10 既有测试文件 setup 全部同步 version:0 + 8 versioned 写操作 callProc 全部追加 expected_version
- ③类 18+8 新增测试覆盖 18 AC + 端到端 lost update（spawn 真实 server + fetch）

## AI-001 越界检查

diff 新增导出符号均可溯源至 Tech-Spec §2~§8 决策：

| 新增符号 | 溯源 Tech-Spec 决策 | 文件:行号 |
|---|---|---|
| `version` 字段（3 实体 schema） | D1 version 字段扩散 | `contracts/schemas/user.ts:35` / `role.ts:60` / `notification.ts:43` |
| `VERSION_REQUIRED` / `VERSION_CONFLICT` 错误码 | D2 errorCodeSchema 追加 2 码 | `contracts/schemas/user.ts:177,179` |
| `current_version` 字段（errorResponseSchema） | D3 errorResponseSchema 扩展 | `contracts/schemas/user.ts:192` |
| `expected_version` 字段（8 写 procedure input） | D4/D15 写 procedure input 追加 expected_version | `router/user.ts:37` / `role.ts:41,63,80` / `notification.ts:48,59` |
| `roleDeleteProcedureInputSchema` | D15 拆分读写 schema | `router/role.ts:39` |
| `notificationWriteIdProcedureInputSchema` | D15 拆分读写 schema | `router/notification.ts:46` |
| `setParentProcedureInputSchema`（router 层独立声明） | D15 + advisory 偏离（ZodEffects 不可 extend） | `router/role.ts:59` |
| `unsetParentProcedureInputSchema`（router 层 extend） | D15 | `router/role.ts:79` |
| `updateUserStatusProcedureInputSchema` 追加 expected_version | D15 | `router/user.ts:34` |
| `updateNotificationProcedureInputSchema` 追加 expected_version | D15 | `router/notification.ts:56` |
| `validateVersion` 纯函数 | D5 domain/version.ts | `domain/version.ts:20` |
| `VersionCheckResult` 类型 | D5 | `domain/version.ts:8` |
| `AppError.meta` 字段 | D13 | `apps/api/src/errors.ts:10,11,15` |
| `errorCodeToHttpStatus` 追加 2 码 | D14 | `apps/api/src/errors.ts:65,66` |
| `Route.versioned` 标记 | D17 | `apps/api/src/server.ts:137,148,157` |
| `parseIfMatch` 函数 | D18 | `apps/api/src/server.ts:379` |
| 8 写 service 方法追加 `expectedVersion` 参数 | D10 | `service/user.ts:86` / `role.ts:99,213,267` / `notification.ts:73,126,174,213` |
| 审计日志 before/after 含 version 字段（pii=false） | D12 | `service/user.ts:115-120` / `role.ts:131-133,253-258,285-289` / `notification.ts:107-108,161-168,202-208,236` |

- **结论**：✅ 所有新增导出符号均可溯源至 Tech-Spec，无越界。
- **advisory 偏离 1**：`setParentProcedureInputSchema` 在 router 层独立声明（非 D15 字面的"追加 expected_version"），实现注释 `router/role.ts:55-56` 已说明理由（contracts setParentInputSchema 为 ZodEffects 不可 .extend()），但 Tech-Spec §7 D15 未反向同步该偏离（记 S-1）。

## advisory 偏离评估（AI-003，本轮重点）

### 偏离 1：D15 setParentProcedureInputSchema 独立声明（未反向同步 Tech-Spec）

**偏离内容**：Tech-Spec §7 D15 原写 `setParentProcedureInputSchema / unsetParentProcedureInputSchema 追加 expected_version`（隐含 .extend() contracts schema）。实现 `router/role.ts:59-73` setParentProcedureInputSchema 改为独立声明（含 superRefine 自继承校验重复声明），不复用 contracts setParentInputSchema。

**理由评估**：
- ✅ **理由成立**。`contracts/schemas/role-inheritance.ts:14-27` setParentInputSchema 是 ZodEffects（含 `.superRefine()`），Zod 的 `.extend()` 方法仅 ZodObject 可用，ZodEffects 不可 .extend()。两条出路：
  - 出路A：在 contracts 层重构 setParentInputSchema 为 ZodObject + 独立 superRefine 函数 → 改动 contracts 公共契约，影响面大（contracts 是 SSOT，所有消费方受影响），且违反"router 层 procedure input schema 拆分读写"原则（D15 明确读写拆分在 router 层）。
  - 出路B：router 层独立声明 setParentProcedureInputSchema（含 superRefine 自继承校验）→ 改动局部化（仅 router/role.ts），与 D15"读写拆分在 router 层"原则一致；superRefine 自继承校验在 router 层重复声明（与 contracts 同规则），不影响 contracts 公共契约。
- impl-writer 选出路B，符合 D15 原则（router 层拆分读写）+ ARCH-002（contracts 不被改动）+ 最小改动面。
- 实现注释 `router/role.ts:55-56` 显式标注："[约束] contracts setParentInputSchema 为 ZodEffects（.superRefine），不可 .extend()；按 D15 独立声明写 schema。"

**反向同步评估**：
- ⚠️ **Tech-Spec §7 D15 未反向同步**。D15 原文（`docs/spec/optimistic-locking.tech.md:144`）仍写 `setParentProcedureInputSchema / unsetParentProcedureInputSchema 追加 expected_version`，未提及 ZodEffects 不可 .extend() 的偏离 + 独立声明的理由。
- 按 AI-003 advisory 偏离处理流程：advisory 偏离须"在 PR 描述写'反向同步 Spec：{{项}}'，并相应更新 Tech-Spec"。实现注释已说明理由，但 Tech-Spec §7 D15 未追加 [advisory] 标注。

**处置**：记 **S-1 suggestion**（非 blocker）。理由：
1. 偏离理由成立（ZodEffects 不可 .extend() 是 Zod 框架限制，非实现选择）；
2. 实现注释 `router/role.ts:55-56` 已显式标注偏离理由（局部文档化）；
3. 偏离未导致 [约束] 验收偏离（PRD 18/18 AC 对齐）；
4. 三件套全绿 + setParent 路由 HTTP 端到端可用（role-inheritance-embedding.test.ts 26 用例覆盖）；
5. 但 **建议 Tech-Spec §7 D15 反向同步**：追加 [advisory] 标注 "contracts setParentInputSchema 为 ZodEffects（.superRefine）不可 .extend()，router 层 setParentProcedureInputSchema 独立声明（含 superRefine 自继承校验重复）"，消除单向漂移，避免下一轮 Reviewer 误判实现偏离 Spec。
6. 位置：`docs/spec/optimistic-locking.tech.md` §7 D15（line 144 附近）。

> 注：D15 原为决策项（非显式 [约束] 标注），impl-writer 改为独立声明属 advisory 偏离。AI-003 要求 advisory 偏离须反向同步 Tech-Spec。本轮实现注释已说明理由但 Tech-Spec 未同步，记 suggestion（非 blocker），因偏离理由成立（Zod 框架限制）+ 实现注释局部文档化 + 验收对齐。

### 偏离 2：domain/version.ts validateVersion 返回类型 `as ErrorCode` 类型转换问题修复

**偏离内容**：task 描述提及 `domain/version.ts` validateVersion 返回类型 `as ErrorCode` 类型转换问题修复。Reviewer 核实：

**评估**：
- ✅ **实现与 Tech-Spec D5 完全一致，无 `as ErrorCode` 转换**。Tech-Spec D5（`docs/spec/optimistic-locking.tech.md:48-55`）原文：
  ```ts
  export function validateVersion(
    expected: number,
    actual: number,
  ): { ok: true } | { ok: false; errorCode: 'VERSION_CONFLICT' } {
    if (expected !== actual) return { ok: false, errorCode: 'VERSION_CONFLICT' };
    return { ok: true };
  }
  ```
  返回类型用字面量 `'VERSION_CONFLICT'`（而非 `ErrorCode` 联合类型）。
- 实现 `domain/version.ts:8-27`：
  ```ts
  export type VersionCheckResult =
    | { ok: true }
    | { ok: false; errorCode: 'VERSION_CONFLICT' };
  export function validateVersion(expected, actual): VersionCheckResult { ... }
  ```
  返回类型 `VersionCheckResult` 的 `errorCode: 'VERSION_CONFLICT'` 为字面量类型，与 Tech-Spec D5 完全一致，**无 `as ErrorCode` cast**。
- service 层消费（`service/user.ts:96` / `role.ts:108,223,275` / `notification.ts:85,136,182,223`）：
  ```ts
  const versionCheck = validateVersion(expectedVersion, target.version);
  if (!versionCheck.ok) {
    throw new AppError('VERSION_CONFLICT', msg, { current_version: target.version });
  }
  ```
  service 直接抛 `AppError('VERSION_CONFLICT', ...)`，不读取 `versionCheck.errorCode`（避免字面量类型与 ErrorCode 联合类型的转换问题）。
- **结论**：✅ 实现合规，无 cast 问题。task 描述的"修复"可能指 impl-writer 实现期初版用 `ErrorCode` 类型需 cast，后改为字面量类型避免 cast（与 Tech-Spec D5 一致）。当前实现与 Tech-Spec 完全对齐，无需额外处理。

**处置**：✅ **合规，不记 blocker/suggestion**。实现与 Tech-Spec D5 一致，无 cast 问题。

### 其他偏离检查

Reviewer 全面扫描 diff，未发现其他偏离：
- ARCH-001：`domain/version.ts` 仅 import 无（纯函数，无 import）；service 不 import router；service 不 import AuditLogService（埋点在 router 层 withAudit） ✅
- ARCH-002：contracts 仅导出 Zod schema + z.infer 类型；validateVersion 放 domain（不污染 contracts） ✅
- SEC-003a：8 写 procedure input schema 中 setParentProcedureInputSchema 带 .strict()（router/role.ts:65），其余 procedure input schema 沿用既有模式（外层 z.object 不强制 .strict()，内层 body schema 带 .strict()）；SEC-003a check-rules 仅扫 contracts 输出 schema，procedure input 不在扫描范围 ✅
- CODE-001：无 `: any` / `as any`（grep 0 匹配） ✅
- CODE-002：无空 catch / 仅 console catch（router/audit.ts:81-84 best-effort catch 含 console.warn + return entity；service/transfer.ts:121-138 补偿 catch 含 throw；server.ts:457-470 catch 含 console.error + sendJson 500） ✅
- 无其他 [advisory] 偏离或 [约束] 项偏离。

## 规则合规（META-001/003/004 + ARCH + CODE + SEC）

| 规则 | 校验 | 结论 |
|---|---|---|
| META-001 | 本期不新增规则文件、不新增 markEnforcement 分支；既有 13 项规则均含"校验方式"段且含机器校验关键词 | ✅ pass |
| META-003 | 本期不新增 markEnforcement 项（复用既有 13 项验证 HTTP 条件请求新领域）；check-rules 输出 13 项 enforcement 与规则文档双向绑定，无声明漂移 | ✅ pass |
| META-004 | 脚本 13 项 enforcement 均有规则文档块；本期不新增规则故无新增块 | ✅ pass |
| ARCH-001 | `domain/version.ts:1-3` 仅 import 无（纯函数无 IO，D5）；service 不 import router（service/user.ts:13 / role.ts:24-29 / notification.ts:22-28 import repository/domain/contracts/context，不 import router）；service 不 import AuditLogService（埋点在 router 层 withAudit，`router/user.ts:13` / `role.ts:19` / `notification.ts:16` import AuditLogService） | ✅ pass |
| ARCH-002 | contracts/schemas/{user,role,notification,role-inheritance}.ts 仅导出 Zod schema + z.infer 类型；validateVersion 放 domain（不污染 contracts，与 validateSetParent/transitionStatus 同先例） | ✅ pass |
| CODE-001 | 无 `: any` / `as any`（grep `apps/api/src` + `apps/api/test` 0 匹配）；optimistic-locking-embedding.test.ts:64-72 用 ResponseBody 接口（非 any） | ✅ pass |
| CODE-002 | 无空 catch / 仅 console catch：`router/audit.ts:81-84` best-effort catch 含 console.warn + return entity（D1 既有模式）；`service/transfer.ts:121-138` 补偿 catch 含 throw TRANSFER_COMPENSATION_FAILED/TRANSFER_FAILED；`server.ts:457-470` catch 含 console.error + sendJson 500（既有模式） | ✅ pass |
| CODE-003 | 无 eval/new Function（grep 0 匹配） | ✅ pass |
| CODE-004 | 新增 schema 均带 Schema 后缀：`roleDeleteProcedureInputSchema` / `notificationWriteIdProcedureInputSchema` / `updateNotificationProcedureInputSchema`（已存在，追加 expected_version）/ `setParentProcedureInputSchema`（router 层独立声明）/ `unsetParentProcedureInputSchema`（已存在，追加 expected_version）/ `updateUserStatusProcedureInputSchema`（已存在，追加 expected_version）/ `VersionCheckResult` 类型（非 schema，是 type alias）；新错误码 `VERSION_REQUIRED` / `VERSION_CONFLICT` 前缀一致（VERSION_ 前缀，D2） | ✅ pass |
| SEC-001 | 8 写 procedure 声明 auth：`router/user.ts:75` updateStatus auth='admin'；`router/role.ts:144` delete auth='admin' / `:178` setParent auth='admin' / `:187` unsetParent auth='admin'；`router/notification.ts:113` update auth='admin' / `:124` send auth='admin' / `:134` markRead auth='public'（自服务，Q4b）/ `:147` delete auth='admin' | ✅ pass |
| SEC-002 | service 写方法入口 requireAdmin：`service/user.ts:87` updateStatus / `service/role.ts:100` delete / `:214` setParent / `:268` unsetParent / `service/notification.ts:76` update / `:127` send / `:214` delete；markRead 例外已有豁免（`service/notification.ts:173` SEC-002-exempt 标记，Q4b 收件人自服务）；check-rules 0 违规 + 2 条 SEC-002 豁免审计 info（markRead + record） | ✅ pass |
| SEC-003a | 8 写 procedure input schema：setParentProcedureInputSchema 带 .strict()（`router/role.ts:65`）；其余沿用既有模式（外层 z.object 不强制 .strict()，内层 body schema 带 .strict()，如 updateUserStatusInputSchema/createRoleInputSchema/updateNotificationInputSchema 均 .strict()）；SEC-003a check-rules 仅扫 contracts 输出 schema（输出 schema 均 .strict()：userSchema/roleSchema/notificationSchema/userListResultSchema/roleListResultSchema/notificationListResultSchema/errorResponseSchema），procedure input 不在扫描范围 | ✅ pass |
| SEC-003b | version 字段 pii=false（非 PII registry 字段）：`service/user.ts:116,120` / `service/role.ts:132,253,257,285,289` / `service/notification.ts:107-108,162-168,203-208,236` before/after version 字段均 pii=false；PII_FIELD_REGISTRY 不新增 version 条目（沿用既有 {user: {email}}，version 是元数据非业务字段） | ✅ pass |

## 测试覆盖与三件套

- **三件套真绿**：✅ Reviewer 实跑 typecheck exit 0（0 错误）/ lint:rules exit 0（13 enforcement + 2 SEC-002 豁免 info + 6 AI-005 建议[R6 既有遗留，非本期新增]）/ test exit 0（14 文件 649/649，4.22s）
- **AI-007 端到端覆盖**：✅ optimistic-locking-embedding.test.ts 8 用例 spawn 真实 HTTP server + fetch 覆盖 PRD F2 4 条 + F3 4 条 HTTP-level（lost update / current_version / 冲突不修改实体 / send 版本校验）
- **service/domain 层覆盖**：✅ optimistic-locking.test.ts 18 用例覆盖 validateVersion 纯函数（3）+ F1 version 字段（5）+ F3 版本校验（6）+ F4 守卫顺序（3）+ 辅助（1）
- **②类既有测试修复**：✅ 10 既有测试文件 setup 全部同步 version:0 + 8 versioned 写操作 callProc 全部追加 expected_version（tsc exit 0 + 649/649 佐证）
- **HTTP 运行时烟测**：✅ optimistic-locking-embedding.test.ts 8 用例 spawn 真实 server（npx tsx apps/api/src/server.ts）+ fetch，全链路通过（If-Match 解析 + lost update + current_version + 冲突不修改实体 + send 版本校验），无需额外手动 curl
- **stderr 输出**：本轮 optimistic-locking 测试无 stderr 噪声；audit-embedding / notification-embedding 的 best-effort 吞异常 console.warn 是既有预期输出（withAudit D1 模式），非缺陷 ✅

## 本轮亮点

1. **HTTP 条件请求新协议模式落地**：server.ts 引入 Route.versioned 标记（D17）+ parseIfMatch 纯函数（D18）+ 错误响应合并 e.meta（D19），实现 RFC 7232 If-Match header 语义（用纯数字 version 简化，非 ETag 引号格式，Q3 决策）。8 写路由（D20）标记 versioned=true，handle 在 safeParse 之前拦截 If-Match 缺失/非法（VERSION_REQUIRED vs VALIDATION_ERROR 精确区分，D18 关键：safeParse 之前拦截避免被 VALIDATION_ERROR 吞）。这是前八轮 server.ts 仅解析 path/query/body 的工作流下未验证的新协议模式，ARCH-001/CODE-002/SEC-003a 在 HTTP 条件请求下闭合。
2. **version 字段扩散到 3 实体在 ARCH-002 下闭合**：contracts SSOT 单点定义 `version: z.number().int().min(0)`（D1），3 实体 schema（user/role/notification）各追加；z.infer 派生 UserEntity/RoleEntity/NotificationEntity 类型自动跟随；3 repo 的 5 update 方法（UserRepository.updateStatus/updateDepartmentId / RoleRepository.update / NotificationRepository.update/updateStatusAndSentAt/updateStatusAndReadAt）各 +1（D7）；create 填 0（D8）；seed 数据 version=0（D8）。验证了 ARCH-002 在多实体同步 schema 变更下仍闭合（PRD 目标5 达成）。
3. **守卫顺序编排 B5 → B_version → B6/B7/B8 在 8 写操作下闭合**：8 写操作（updateStatus / role.delete / setParent / unsetParent / notification.update / send / markRead / delete）均按 D9 守卫顺序编排——B5 实体存在 → B_version 版本匹配 → B6/B7/B8 业务规则。AC-F4-1（不存在优先于版本）+ AC-F4-2（版本优先于业务规则）行为可观测断言证明顺序正确。三域 service 头部注释均标识 B_version 守卫位置（D9 文档化，AC-F4-3 readFileSync 断言）。
4. **冲突响应扩展 current_version + AppError.meta 通用扩展点**：errorResponseSchema 追加可选 current_version 字段（D3，首次扩展错误响应体）；AppError 追加可选 meta 字段（D13，通用扩展点不耦合 VERSION_CONFLICT 语义）；service 抛 AppError('VERSION_CONFLICT', msg, { current_version: entity.version })（D11）；server.ts 错误处理 Object.assign(respBody, e.meta) 合并到响应体（D19）。current_version 供客户端 GET 最新资源后重试（PRD 目标3 达成），不破坏既有消费者（optional 字段）。
5. **AI-007 端到端 + Reviewer PRD 18 条逐条核对双轨闭合**：optimistic-locking-embedding.test.ts 8 用例 spawn 真实 HTTP server + fetch 覆盖 PRD F2 4 条 + F3 4 条 HTTP-level，关键 lost update 防护（A 成功 v1 + B 409 VERSION_CONFLICT current_version===1 + 最终 A 的写入保留）端到端断言。Reviewer 按 PRD 18 条验收逐条核对 0 偏离。
6. **AI-006 三类标注完整闭合**：①类 SSOT 派生 + tsc 结构性保证（errorCodeSchema 2 码 + errorResponseSchema current_version 经 Record<ErrorCode,number> 穷举 + z.infer 派生自动覆盖）+ 行为测覆盖；②类 10 既有测试文件 setup 全部同步 version:0 + 8 versioned 写操作 callProc 全部追加 expected_version；③类 18+8 新增测试覆盖 18 AC + 端到端 lost update。三类标注完整闭合（⚠️ ①类契约测断言未字面追加，记 S-2）。
7. **domain/version.ts validateVersion 纯函数下沉**：validateVersion 归属 domain/version.ts（D5，纯函数无 IO），与 validateSetParent / transitionStatus 同模式（domain 持纯函数，service 调用转抛 AppError）。返回类型用字面量 `'VERSION_CONFLICT'`（非 ErrorCode 联合类型），避免 `as ErrorCode` cast，CODE-001 合规。ARCH-001 domain 不 import 上层闭合。
8. **HTTP 运行时入口全链路验证**：8 versioned 路由挂载到 server.ts，optimistic-locking-embedding.test.ts spawn 真实 server + fetch 烟测确认 If-Match 解析 + lost update 防护 + current_version 返回 + 冲突不修改实体 + send 版本校验全链路工作，延续第七轮"项目能真正作为 HTTP 服务跑起来"目标。

## 本轮问题

### Blocker（0）
无。本轮无 [约束] 偏离，PRD 18 条验收逐条对齐。

### Suggestion（2）

> **修复状态（impl 阶段已闭合）**：S-1 与 S-2 均在 Reviewer 报告产出后于 impl 阶段立即修复，三件套复跑全绿（653/653，optimistic-locking.test.ts 18→22 tests +4 契约测）。下文保留 Reviewer 评审时点的原始观察记录。

- **S-1**：Tech-Spec §7 D15 未反向同步 setParentProcedureInputSchema 独立声明的 advisory 偏离。
  - **现状**：`docs/spec/optimistic-locking.tech.md` §7 D15（line 144）原写 `setParentProcedureInputSchema / unsetParentProcedureInputSchema 追加 expected_version`（隐含 .extend() contracts schema）。实现 `router/role.ts:59-73` setParentProcedureInputSchema 改为独立声明（含 superRefine 自继承校验重复），因 contracts setParentInputSchema 是 ZodEffects（`.superRefine()`）不可 `.extend()`。
  - **性质**：advisory 偏离（ZodEffects 不可 .extend() 是 Zod 框架限制，非实现选择）。实现注释 `router/role.ts:55-56` 已显式标注理由（局部文档化），但 Tech-Spec §7 D15 未追加 [advisory] 标注。
  - **处置**：记 suggestion（非 blocker），因偏离理由成立（Zod 框架限制）+ 实现注释局部文档化 + 验收对齐（PRD 18/18）+ 三件套全绿。但**建议 Tech-Spec §7 D15 反向同步**：追加 [advisory] 标注 "contracts setParentInputSchema 为 ZodEffects（.superRefine）不可 .extend()，router 层 setParentProcedureInputSchema 独立声明（含 superRefine 自继承校验重复）"，消除单向漂移，避免下一轮 Reviewer 误判实现偏离 Spec。
  - **位置**：`docs/spec/optimistic-locking.tech.md` §7 D15（line 144 附近）+ `apps/api/src/router/role.ts:55-56`（实现注释已存在）。

- **S-2**：AI-006 ①类 errorCodeSchema/errorResponseSchema 契约测断言未字面追加。
  - **现状**：Tech-Spec §9 ①类要求"errorCodeSchema 断言须追加 VERSION_REQUIRED / VERSION_CONFLICT"+"errorResponseSchema 断言须覆盖 current_version 可选字段"。实际未在 `notification.test.ts` / `role-inheritance.test.ts` / `report.test.ts` 等契约测中追加 `[...errorCodeSchema.options]` 含 VERSION_REQUIRED/VERSION_CONFLICT 断言，也未追加 `errorResponseSchema.safeParse({ code: 'VERSION_CONFLICT', message: 'x', current_version: 1 })` 断言。
  - **补偿覆盖**：service-level `e.code === 'VERSION_CONFLICT'` 多处断言（optimistic-locking.test.ts:297/324/352/366/390/422）+ HTTP-level `res.body.error === 'VERSION_CONFLICT'`/`'VERSION_REQUIRED'`（optimistic-locking-embedding.test.ts:130/140/150/191/222/240/282）+ HTTP-level `res.body.current_version === 1`（:192/223/283）+ service-level `e.meta?.current_version === 1`（optimistic-locking.test.ts:298/325/353/367/391/423）+ tsc `Record<ErrorCode, number>` 穷举保证 2 码必存在 + z.infer 派生 errorResponseSchema 类型含 current_version?:number。
  - **性质**：AI-006 ①类"断言须追加"未字面执行（行为覆盖 + 结构性保证已满足，但契约测形式缺失）。
  - **处置**：记 suggestion（非 blocker），因 2 码 + current_version 字段均经 SSOT 派生 + tsc 结构性保证 + 行为测覆盖，无功能缺口。但**建议补一条契约测**（可在 `optimistic-locking.test.ts` 或既有契约测文件追加）：
    ```ts
    it('errorCodeSchema 含 VERSION_REQUIRED / VERSION_CONFLICT（跨域联动①）', () => {
      const allCodes = [...errorCodeSchema.options];
      expect(allCodes).toContain('VERSION_REQUIRED');
      expect(allCodes).toContain('VERSION_CONFLICT');
    });
    it('errorResponseSchema 接受 current_version 可选字段（D3）', () => {
      expect(errorResponseSchema.safeParse({ code: 'VERSION_CONFLICT', message: 'x', current_version: 1 }).success).toBe(true);
      expect(errorResponseSchema.safeParse({ code: 'VALIDATION_ERROR', message: 'x' }).success).toBe(true);
    });
    ```
  - **位置**：`apps/api/test/optimistic-locking.test.ts`（建议追加）或既有契约测文件。

## 门禁复核（Reviewer 实跑）

| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `pnpm typecheck` | exit 0，0 错误 |
| lint:rules | `pnpm lint:rules` | exit 0，13 项 enforcement（AI-005/ARCH-001/ARCH-002/CODE-001/CODE-002/CODE-003/CODE-004/META-001/META-003/META-004/SEC-001/SEC-002/SEC-003a）+ META-003/004 双向绑定 + 2 条 SEC-002 豁免审计 info（markRead + record）+ 6 条 AI-005 建议（R6 既有遗留：role-inheritance/role-inheritance-embedding 硬编码枚举字面量，非本期新增） |
| test | `pnpm test` | exit 0，14 文件 649/649（audit 104 / audit-embedding 14 / dept 92 / notification 88 / notification-embedding 14 / optimistic-locking 18 / optimistic-locking-embedding 8 / report 86 / role 73 / role-inheritance 65 / role-inheritance-embedding 26 / transfer 25 / transfer-embedding 6 / user 35），4.22s |
| HTTP 烟测 | optimistic-locking-embedding.test.ts spawn server + fetch 8 用例 | 8/8 通过（If-Match 解析 4 + lost update 防护 1 + current_version 返回 1 + 冲突不修改实体 1 + send 版本校验 1），HTTP 200/400/409 全链路通过 |

三件套全绿，且**本轮全绿 = 验收对齐**——AI-007 端到端测试 + Reviewer PRD 18 条逐条核对双轨验证，未发现 [约束] 偏离。HTTP 条件请求新协议模式 + version 字段扩散 + 冲突检测语义 + 守卫顺序编排四件套在前八轮的工作流下成功落地。

## 最终结论

**verdict: pass**。

- **0 项 blocker**：本轮无 [约束] 偏离，PRD F1/F2/F3/F4 共 18 条验收逐条对齐（F1 5/5 + F2 4/4 + F3 6/6 + F4 3/3）。
- **2 项 suggestion（impl 阶段已闭合）**：
  - S-1：Tech-Spec §7 D15 未反向同步 setParentProcedureInputSchema 独立声明的 advisory 偏离 → **已修复**：`docs/spec/optimistic-locking.tech.md` §7 D15 已追加 [advisory] 偏离标注（ZodEffects 不可 .extend() 理由 + 独立声明说明 + 实现行号引用）。
  - S-2：AI-006 ①类 errorCodeSchema/errorResponseSchema 契约测断言未字面追加 → **已修复**：`apps/api/test/optimistic-locking.test.ts` 追加 4 条契约测（errorCodeSchema 含 2 码 SSOT 派生 + errorResponseSchema 接受/拒绝 current_version + 向后兼容 + .strict 拒绝多余字段），测试数 18→22，三件套复跑 653/653 全绿。
- **AI-007 PRD 逐条核对结论**：18/18 对齐，0 偏离。
- **AI-006 三类标注校验结论**：✅ 生效。三类标注完整（①类 SSOT 派生 + tsc 结构性保证 + 行为测覆盖 / ②类 10 既有测试文件 setup 全部同步 / ③类 18+8 新增测试覆盖 18 AC + 端到端 lost update）。⚠️ ①类契约测断言未字面追加（记 S-2）。
- **advisory 偏离评估结论**：
  - D15 setParentProcedureInputSchema 独立声明：理由成立（ZodEffects 不可 .extend() 是 Zod 框架限制）+ 实现注释局部文档化 + 验收对齐 → 合规但 Tech-Spec 未反向同步（记 S-1）。
  - domain/version.ts validateVersion 返回类型：实现与 Tech-Spec D5 完全一致（字面量 'VERSION_CONFLICT' 类型，无 as ErrorCode cast）→ 合规，不记 blocker/suggestion。
- **本轮 AI-007/AI-006 是否生效**：✅ **均生效**。
  - AI-007：端到端测试（optimistic-locking-embedding.test.ts 8 用例 spawn 真实 server + fetch 覆盖 F2 4 + F3 4 HTTP-level）+ Reviewer PRD 18 条逐条核对（18/18 对齐）双轨闭合，关键 lost update 防护端到端断言（A 成功 v1 + B 409 current_version===1 + 最终 A 的写入保留）。
  - AI-006：三类标注完整（①类 SSOT 派生 + tsc 结构性保证 / ②类 10 文件 setup 全部同步 / ③类 18+8 新增测试覆盖 18 AC + 端到端 lost update）。⚠️ ①类契约测断言未字面追加（记 S-2）。
- **本轮核心验证目标达成**：①HTTP 条件请求新协议模式落地（ARCH-001/CODE-002/SEC-003a 闭合）；②version 字段扩散到 3 实体在 ARCH-002 下闭合；③守卫顺序编排 B5 → B_version → B6/B7/B8 在 8 写操作下闭合；④冲突响应扩展 current_version + AppError.meta 通用扩展点；⑤AI-007 端到端 + AI-006 三类标注双轨闭合。
- **最值得关注的发现**：**HTTP 条件请求新协议模式 + version 字段扩散 + 冲突检测语义 + 守卫顺序编排四件套在前八轮的工作流下成功落地**——验证了 spec-first 工作流对"HTTP 协议扩展 + 跨实体 schema 扩散 + 并发语义"的适应性。D15 setParentProcedureInputSchema 独立声明偏离（S-1）提示 Spec 起草时未考虑 ZodEffects 不可 .extend() 的框架限制，建议 Spec 起草时对 Zod schema 拆分读写场景预判 ZodEffects 限制。下一轮应强化"Spec 起草时考虑 Zod 框架限制"与"AI-006 ①类契约测断言字面追加"两个工作流环节。
