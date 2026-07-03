---
doc_type: Review-Report
id: REVIEW-PERSIST-001
prd_ref: PRD-PERSIST-001
spec_ref: TECH-PERSIST-001
verdict: block
date: 2026-07-02
reviewer: reviewer@team
---
# 持久化层替换 · Code Review 报告（R12，MVP 收官轮）

评审范围：第十二轮"持久化层替换"全部代码——F1 DB 接入 + F2 DDL 建表 + F3 6 repository 实现替换（Map→SQL）+ F4 DB 事务 + F5 约束映射 + F6 测试隔离 + F7 admin seed 进 DB，以及 ARCH-001 闭合收官验证 + AI-006 两类标注 + AI-007 端到端验收 + 3 个回归 bug 修复审查。对照 `docs/prd/persist.md`（12 BLOCKING Q&A + 21 条 AC Given/When/Then）、`docs/spec/persist.tech.md`（D1~D16 决策 + §5 DDL + §6 repository + §9 ARCH-001 闭合论证 + §10 受影响清单 + §11 advisory）与 `.trae/rules` 全部规则逐条核查。

本轮 MVP 收官轮核心验证：①ARCH-001 闭合收官（repository 40 公开方法签名零变更，换 DB 不动四层）②AI-007 PRD 21 条 AC 逐条核对 ③3 个回归 bug 根因分析（内存 vs DB 行为差异）④advisory 偏离反向同步核对 ⑤transfer.ts db 构造参数 + router fallback createTestDb 两个架构判定。

## §0 速览

- **verdict**：**block**
- **blocker 数**：**4**（均为 advisory/[约束] 偏离未反向同步 Tech-Spec，AI-003 违规）
- **suggestion 数**：**5**（router fallback code smell + 3 回归 bug retro + transfer db 依赖未来改进）
- **AC 对齐数**：**21/21**（F1 3/3 + F2 2/2 + F3 4/4 + F4 3/3 + F5 3/3 + F6 3/3 + F7 3/3）
- **三件套门禁复核（Reviewer 实跑）**：
  - typecheck：`npx tsc --noEmit` exit 0，0 错误 ✅
  - lint:rules：`node scripts/check-rules.mjs` exit 0，13 项 enforcement + META-003/004 双向绑定 + 3 条 SEC-002 豁免审计 info + 6 条 AI-005 suggestion（均为 R7 既有，非本轮引入）✅
  - test：`npx vitest run` exit 0，20 文件 833/833 通过（778 既有 + 55 新增 persist/persist-embedding + 既有 setup 注入调整）✅
- **ARCH-001 闭合判定**：**repository 公开方法签名 40/40 零变更**（git diff HEAD 核实，仅构造 `+db`）；service/router/domain/contracts 公开签名零变更（transfer.ts 构造 +db 为 D8 事务需求合理偏离，transfer 公开方法签名不变；dept.ts/notification.ts 为内部 impl 修复）；ARCH-001 依赖方向无违规（rules ARCH-001 分支通过）✅
- **transfer.ts db 第 7 构造参数判定**：**合理偏离，非 ARCH-001 违规**（service→db infra 非 reverse dependency；transfer 公开方法签名不变=D2 闭合核心），但 §9 须反向同步（blocker #3）
- **router fallback createTestDb 判定**：**code smell（suggestion）**——生产不触发（server.ts 总传 auditService），但 fallback 用 createTestDb 是请求时建测试 db 的反模式，建议改 required 参数或 throw
- **3 回归 bug 根因**：均为"内存实现容忍 sloppy 行为 / 隐藏 bug，DB 严格性暴露"——修复合理，建议记 retro（内存 vs DB 行为差异类）
- **advisory 偏离反向同步状态**：**4 项未同步**（§5.1 audit_logs.id 去 PK / §8 withTransaction async 重载 / §9 transfer db 构造参数 / §11#5 PRAGMA 默认 ON），均记 blocker

## §1 PRD 验收逐条核对（AI-007，21 条 AC）

对照 PRD `docs/prd/persist.md` §验收标准（F1 3 + F2 2 + F3 4 + F4 3 + F5 3 + F6 3 + F7 3 = 21 条 Given/When/Then），逐条核对实现行为是否对齐。测试覆盖：`persist.test.ts`（unit + 契约 + advisory 实测，~866 行）+ `persist-embedding.test.ts`（端到端 spawn 真实 server + 双次重启，8 用例）+ 既有 18 文件 setup 注入调整（行为等价）。

### F1：DB 接入与连接管理（3 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F1-1 | 启动建连接：server.ts 启动 → DatabaseSync 连接建立，可执行 SQL | `db/connection.ts:26` createDb(path) → new DatabaseSync + PRAGMA；`server.ts:80` createDb() | persist.test.ts:440（createDb(:memory:) 返回 DatabaseSync 可 exec/prepare） | ✅ |
| F1-2 | 文件持久化：写入 → 重启 → 数据仍在 | 文件 DB（DB_PATH）；`server.ts:80` createDb 缺省 ./data/admin.db | persist.test.ts:451（写→close→重开同路径→findByEmail 命中）+ persist-embedding.test.ts:304（spawn server1 建用户→kill→spawn server2 同 DB_PATH→用户仍在） | ✅ |
| F1-3 | DB_PATH env：设置 env → 用该路径；缺省 ./data/admin.db | `connection.ts:27` path ?? process.env.DB_PATH ?? './data/admin.db' | persist.test.ts:475（设 DB_PATH 临时文件→createDb()→文件存在）+ persist-embedding.test.ts:194（spawn env DB_PATH→文件创建） | ✅ |

**F1 小结：3/3 对齐**。

### F2：DDL 建表（2 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F2-1 | 启动建表幂等：空库启动 → 全部表+索引创建；再次启动不报错 | `connection.ts:44` applySchema(db) readFileSync schema.sql + db.exec；`server.ts:81`；CREATE IF NOT EXISTS | persist.test.ts:497（连续两次 applySchema 不抛 + 表齐全） | ✅ |
| F2-2 | 表结构对齐 contracts：DDL vs entitySchema 字段名/类型/可空 1:1 | schema.sql 7 表（omit role_inheritance，§5.0 校正）；字段对齐 6 entitySchema | persist.test.ts:233-320（7 表 PRAGMA table_info vs Object.keys(schema.shape) 1:1 + 表数=7 + 9 显式索引 + 3 UNIQUE 隐式 + 5 FK） | ✅ |

**F2 小结：2/2 对齐**。表数 7（omit role_inheritance）符合 AC-F2-2「无多余」，§5.0 已论证。

### F3：repository 实现替换（ARCH-001 闭合核心，4 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F3-1 | 接口签名不变：6 repo 公开方法名/参数/返回类型完全一致（同步不变 async） | git diff HEAD 核实：40 公开方法签名逐字不变（仅构造 +db，D13）；详见 §2 | persist.test.ts:566-649（publicMethodNames 逐 repo arrayContaining + 总数 ≥40） | ✅ |
| F3-2 | service/router/domain 零变更：git diff 仅 repository+server.ts+db 模块 | service：transfer.ts 构造 +db（D8 合理偏离）+ 补偿幂等（§3.2 预判）+ dept.ts/notification.ts 内部 impl 修复（3 回归 bug）；router：5 文件 fallback createTestDb；domain/contracts：零变更 | tsc 0 错误 + 833 测试全绿（行为等价）；git diff 无 service/router/domain 公开签名变更 | ✅（详见 §2 判定） |
| F3-3 | 行为等价：内存 vs DB 返回结果等价 | list/findById/insert/update 语义一致（ORDER BY rowid 保插入序） | persist.test.ts:533-664（DB 共享数据 + insert→findById 字段一致 + list 插入序）+ 778 既有测试 setup 注入 db 后全绿 | ✅ |
| F3-4 | 保持插入顺序：list 无 ORDER BY 时保插入序（rowid 或 ORDER BY created_at） | 全部 list/findByIds/findByParent/findByDepartmentId 用 `ORDER BY rowid`（D16） | persist.test.ts:651（list 5 条插入序）+ persist.test.ts:424（advisory ORDER BY rowid 实测） | ✅ |

**F3 小结：4/4 对齐**。F3-1 是 ARCH-001 闭合核心证据：40 公开方法签名逐字不变（git diff HEAD 核实）。F3-2 的 service 改动性质详见 §2（合理偏离 + impl 修复，非公开签名变更）。

### F4：DB 事务（3 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F4-1 | transfer 原子性：中间步失败 → ROLLBACK → 全部回滚 | `db/transaction.ts:43` withTransaction BEGIN→fn→COMMIT/ROLLBACK；`transfer.ts:95` withTransaction 包裹 A/B/C | persist.test.ts:673（withTransaction fn 抛错→ROLLBACK→findById undefined） | ✅ |
| F4-2 | 事务成功提交：全成功 → COMMIT → 持久化 | withTransaction fn 成功→COMMIT | persist.test.ts:691（withTransaction fn 成功→返回值+findById 命中）+ persist-embedding.test.ts:226（端到端 transfer 成功→角色变更持久化） | ✅ |
| F4-3 | 既有补偿逻辑保留：失败 ROLLBACK 后 R7 补偿仍执行（双保障） | `transfer.ts:142` catch 块逆序运行补偿闭包；B 补偿幂等（catch USER_ROLE_ALREADY_ASSIGNED 视为已恢复，§3.2） | persist.test.ts:707（insertUserRole 重复→USER_ROLE_ALREADY_ASSIGNED，补偿 catch 幂等） | ✅ |

**F4 小结：3/3 对齐**。D8 双保障（DB ROLLBACK + 应用补偿）落地，补偿闭包幂等性按 §3.2 advisory #1 处理（B 补偿 catch UNIQUE）。

### F5：约束映射（3 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F5-1 | UNIQUE 冲突映射：重复 email → USER_EMAIL_DUPLICATE（不泄漏 SQLite 错误码） | `repository/user.ts:147` isUniqueViolation('users','email')→toAppError；role.ts/insertUserRole 同模式 | persist.test.ts:736（email 重复→AppError USER_EMAIL_DUPLICATE）+ 757（role name→ROLE_NAME_DUPLICATE） | ✅ |
| F5-2 | 外键冲突：DB FK（若启用）→ DEPT_NOT_FOUND 或 service 前置校验拦截 | service 层前置校验为主（B4/B9/B10）；DB FK 为 backstop→500 INTERNAL（§4） | persist.test.ts:774（insertUserRole 不存在 user→FK 抛，未泄漏 SQLite） | ✅ |
| F5-3 | 错误响应体一致：DB 约束冲突 → errorResponseSchema 一致（code+message，无 SQLite 内部） | toAppError(code, context) 抛 AppError（无 'constraint'/'SQLITE' 字样） | persist.test.ts:787（AppError code/message 为 string + 不含 SQLITE|constraint）+ persist-embedding.test.ts:207（端到端 409 USER_EMAIL_DUPLICATE + message 无 SQLite） | ✅ |

**F5 小结：3/3 对齐**。D10 约束映射在 repository 层完成，`db/constraints.ts` isUniqueViolation 解析 e.message（e.code 通用 ERR_SQLITE_ERROR，§11#2 实测）。

### F6：测试隔离（3 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F6-1 | 内存 SQLite 隔离：每测试新建 :memory: → 数据不串 | `test/helpers/db.ts` createTestDb() re-export；每 setup 建 :memory: | persist.test.ts:814（两 :memory: db 数据互不串） | ✅ |
| F6-2 | 既有 778 测试零破坏：DB 替换后跑全量 → 全绿 | 18 既有文件改 setup 注入 db（0 断言改动，AI-002 核实）；778+55=833 全绿 | vitest run 20 文件 833/833 通过 | ✅ |
| F6-3 | 端到端 spawn 真实 DB：spawn server 用文件 DB（非 :memory:） | persist-embedding.test.ts DB_PATH=tmp 文件 + afterAll 清理 | persist-embedding.test.ts:34（DB_PATH 临时文件）+ 194（文件创建）+ 295（重启持久化） | ✅ |

**F6 小结：3/3 对齐**。AI-002 核实：`git diff HEAD -- 'apps/api/test/*.test.ts' | grep '^[+-]\s*expect('` = **0 行**（impl-writer 未改任何断言，仅改 setup/import）。

### F7：admin seed 进 DB（3 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F7-1 | seed 幂等：空库启动 seed admin；再次启动不重复 | `connection.ts:61` seedAdmin INSERT OR IGNORE（UNIQUE name）；`server.ts:82`；RoleRepository 构造内 seedBuiltinAdmin 同模式 | persist.test.ts:844（连续两次 seedAdmin→admin 只一条）+ 856（admin 含全部权限 SSOT 派生） | ✅ |
| F7-2 | seed 后可登录：首次启动 seed → login admin → 200 token | server.ts seedDemoData + AuthService.login | persist-embedding.test.ts:187（首次 login 200 token）+ 315（重启后 login 200 token） | ✅ |
| F7-3 | seed 持久化：重启 → admin 仍在（DB 文件，非每次重建） | 文件 DB 持久化；seed INSERT OR IGNORE 幂等 | persist-embedding.test.ts:295（重启后 admin role id 不变——DB 持久化证明，内存版 randomUUID 会变） | ✅ |

**F7 小结：3/3 对齐**。F7-3 是持久化语义核心证明：重启后 admin role id 不变（内存版每次 randomUUID 会变 → 断言级红，DB 版 id 持久 → 绿）。

**AC 总对齐：21/21 ✅**

## §2 ARCH-001 闭合验证（本轮核心）

### §2.1 repository 公开方法签名零变更（git diff HEAD 逐个核实）

逐个对比 HEAD（内存 Map 版）与当前（DB 版）的 6 repository 公开方法签名（方法名/参数/返回类型/同步语义）：

| Repository | HEAD 公开方法数 | 当前公开方法数 | 签名变更 | 构造变更 |
|-----------|----------------|---------------|---------|---------|
| UserRepository | 8 | 8 | **零变更**（list/findById/findByIds/findByEmail/insert/updateStatus/findByDepartmentId/updateDepartmentId 逐字一致） | `constructor()` → `constructor(db: DatabaseSync)`（D13） |
| RoleRepository | 13 | 13 | **零变更**（list/findById/findByName/insert/update/findChildren/delete/insertUserRole/findUserRolesByUser/findUserRolesByRole/existsUserRole/findUserRole/deleteUserRole） | `constructor()` → `constructor(db)`（D13，含 seedBuiltinAdmin private） |
| DepartmentRepository | 7 | 7 | **零变更**（list/findById/findByParent/insert/delete/existsByNameUnderParent/computeDepth） | `constructor()` → `constructor(db)` |
| AuditLogRepository | 3 | 3 | **零变更**（insert/list/listAll，append-only 无 update/delete） | `constructor()` → `constructor(db)` |
| NotificationRepository | 7 | 7 | **零变更**（findById/insert/update/updateStatusAndSentAt/updateStatusAndReadAt/delete/list） | `constructor()` → `constructor(db)` |
| TokenBlacklistRepository | 2 | 2 | **零变更**（add/has） | `constructor()` → `constructor(db)` |
| **合计** | **40** | **40** | **40/40 零变更** ✅ | 6 处构造 +db（D13，实例化层非方法签名） |

**结论**：repository 40 公开方法签名逐字不变（D2 [约束] 闭合）。唯一变更是构造签名 `+db`（D13 [约束] 允许，属实例化层非方法签名，service 调用的是方法不感知 db 来源）。**ARCH-001 闭合契约锚点成立**。

### §2.2 service 改动性质判定

git diff HEAD 显示 3 个 service 文件改动，逐个判定改动性质（公开签名变更 vs 内部 impl 修复）：

| 文件 | 改动内容 | 改动性质 | 公开签名变更？ | ARCH-001 违规？ |
|------|---------|---------|--------------|----------------|
| `service/transfer.ts` | ①构造 +db 第 7 参数 ②transfer body 包 withTransaction ③B 补偿 catch USER_ROLE_ALREADY_ASSIGNED 幂等 | ①构造签名变更（D8 事务需求）②③内部 impl 调整（§3.2 预判） | transfer 公开方法签名**不变**（仍 `transfer(input, ctx): Promise<WriteResult<User>>`）；构造签名**变**（+db） | **否**（service→db infra 非 reverse dependency；详见 §2.5） |
| `service/dept.ts` | assignUserDepartment 返回 `entity: toUserOutput(updated)`（剥离 password_hash） | 内部 impl 修复（3 回归 bug #3） | assignUserDepartment 公开签名**不变**（仍 `(userId, departmentId, ctx): Promise<WriteResult<User>>`） | **否**（仅改返回实体的投影，非签名） |
| `service/notification.ts` | update 仅传已定义字段（patch 过滤 undefined） | 内部 impl 修复（3 回归 bug #1） | update 公开签名**不变**（仍 `(id, input, expectedVersion, ctx): Promise<WriteResult<Notification>>`） | **否**（仅改 patch 构造，非签名） |

**结论**：3 个 service 改动中，**0 个公开方法签名变更**（transfer/dept/notification 公开方法签名逐字不变）。transfer.ts 构造签名变更（+db）是 D8 事务需求的合理偏离（§2.5 判定），非 ARCH-001 违规。dept.ts/notification.ts 是"适配 DB 行为"的内部 impl 修复（3 回归 bug），非接口变更。**ARCH-001 service 层闭合成立**（service 调 repository 方法签名不变 → service 代码透明）。

### §2.3 router 改动性质判定

git diff HEAD 显示 5 个 router 文件改动，均为同一模式：

```diff
-  const audit = auditService ?? new AuditLogService(new AuditLogRepository());
+  const audit = auditService ?? new AuditLogService(new AuditLogRepository(createTestDb()));
```

改动性质：**impl 适配**（构造签名 D13 改 `+db` 后，fallback 须传 db；用 createTestDb() 作 fallback db）。router 公开签名（createXxxRouter(service, auditService?)）**不变**。ARCH-001 router 层无 reverse import（router→db infra 非 reverse；router→service→repository 方向不变）。

但 fallback 用 `createTestDb()` 是 code smell（§2.6 判定 + suggestion）。

### §2.4 domain / contracts 改动

git diff HEAD：**domain 零变更**（user.ts/role.ts/dept.ts/audit.ts/notification.ts/transfer.ts/version.ts/auth.ts 全部未动）；**contracts 零变更**（packages/contracts 未在 modified 列表）。**ARCH-001 domain/contracts 层闭合成立** ✅。

### §2.5 transfer.ts db 第 7 构造参数判定（核心架构判定）

**判定：合理偏离，非 ARCH-001 违规，但 §9 须反向同步（blocker #3）。**

**理由**：
1. **ARCH-001 是依赖方向约束**（router→service→repository→domain，禁 reverse import），非"service 构造签名不可变"。transfer.ts import `withTransaction` from `../db/transaction.js` + `DatabaseSync` from `node:sqlite`——db/transaction.js 是 db 基础设施（layerOf=null，§8 注释明示不受 ARCH-001 约束），service→db infra **非 reverse dependency**（db 不是 router/service 上层）。rules ARCH-001 分支通过，证实无违规。
2. **D2 闭合核心是 repository 公开方法签名不变**（§2.1 已证 40/40 零变更），transfer 公开方法 `transfer(input, ctx)` 签名不变 → D2 契约锚点成立。构造签名变更（+db）是实例化层，service 调用的是方法不是构造。
3. **D8 DB 事务需求必然要求 db 访问**。DB 事务是跨 repo 的横切关注点（A 改部门经 deptService + B/C 经 roleService，跨 3 repo），不归属任何单一 repository。若通过 repository 暴露事务（如 `userRepo.withTransaction(fn)`）会**违反 D2**（新增 repository 方法）。当前 service 直接依赖 db 是 MVP 务实选择（node:sqlite 单连接同步，共享 db 自然）。
4. **§9 论证"service 代码零变更"被此偏离打破**——§9 须反向同步为"service 公开方法签名零变更；TransferService 构造 +db 为 D8 事务需求 advisory 偏离"。当前 §9 未同步（blocker #3）。

**未来改进方向（suggestion，非 blocker）**：可抽 `UnitOfWork` / `TransactionManager` 抽象（repository 暴露 `withTx(fn)` 接口），让 service 依赖抽象而非具体 db。但 MVP 收官不必，记 suggestion。

### §2.6 router fallback createTestDb 判定

**判定：code smell（suggestion），非 blocker。**

**理由**：
1. **生产不触发**：server.ts L103-111 总传 `auditService`（共享实例），5 router 的 fallback 分支 `auditService ?? new AuditLogService(new AuditLogRepository(createTestDb()))` 在生产永不执行。
2. **但 fallback 用 createTestDb() 是反模式**：router 不应在请求时建测试 db（即使不触发）。createTestDb() 建 :memory: + applySchema（DDL），若 fallback 真触发（如未来某 router 漏传 auditService），每请求建一个 :memory: db + 跑全 DDL，性能灾难 + 审计日志写入隔离 db（与共享 auditRepo 不通）。
3. **建议（suggestion #1）**：改 `auditService` 为 required 参数（删 `?`），或 fallback 改 `throw new Error('auditService required')`。当前 5 router 签名 `auditService?: AuditLogService` 是既有（R5 起即如此），本轮仅适配 db，非引入。记 suggestion 不阻断。

### §2.7 ARCH-001 闭合总判定

| 层 | 改动 | 公开签名变更 | ARCH-001 违规 |
|----|------|-------------|--------------|
| contracts | 零 | 无 | ✅ 无 |
| domain | 零 | 无 | ✅ 无 |
| repository | 内部 Map→SQL + 构造 +db | 40 方法零变更；构造 +db（D13 允许） | ✅ 无（依赖方向：repo→db infra/domain/contracts） |
| service | transfer 构造 +db（D8）+ 补偿幂等；dept/notification impl 修复 | 0 公开方法签名变更 | ✅ 无（service→db infra 非 reverse） |
| router | 5 文件 fallback createTestDb | 0 公开签名变更 | ✅ 无（router→db infra 非 reverse） |
| server.ts | createDb+applySchema+seedAdmin+注入 db | 工程脚手架（layerOf=null） | ✅ 不受 ARCH-001 约束 |
| db/ 新增模块 | connection/transaction/constraints/schema.sql/sqlite-types | layerOf=null 基础设施 | ✅ 不受 ARCH-001 约束 |

**ARCH-001 闭合成立** ✅：repository 40 公开方法签名零变更是闭合契约锚点；service/router/domain/contracts 公开签名零变更；依赖方向无 reverse import。与 R11"换鉴权来源不动四层"呼应，标志 MVP 工作流验证收官。

## §3 规则合规审查

| 规则 | 合规 | 证据 |
|------|------|------|
| ARCH-001 单向依赖 | ✅ | rules ARCH-001 分支通过；service→db infra / router→db infra 非 reverse dependency（db 非 service/router 上层） |
| ARCH-002 契约纯净 | ✅ | contracts 零改动（本轮无 contracts modified）；rules ARCH-002 分支通过 |
| CODE-001 禁 any | ✅ | `grep -rE '\bany\b' apps/api/src/db/` 仅命中 sqlite-types.d.ts 注释「CODE-001 禁 any」（注释非代码）；repository 用 `as UserRow`/`as RoleRow` 具体接口 cast，非 any |
| CODE-002 catch 非空非仅 console | ✅ | transfer.ts 补偿 catch 抛 TRANSFER_COMPENSATION_FAILED（非吞）；server.ts catch 抛 AppError/500；rules CODE-002 通过 |
| CODE-003 命名 | ✅ | repository 方法名未变（签名不变）；db 模块 createDb/applySchema/seedAdmin/withTransaction/isUniqueViolation 命名清晰；rules 通过 |
| CODE-004 schema 后缀 | ✅ | userEntitySchema/roleSchema 等既有命名；rules 通过 |
| AI-002 测试先行 + 断言不改 | ✅ | `git diff HEAD -- 'apps/api/test/*.test.ts' \| grep '^[+-]\s*expect('` = **0 行**（impl-writer 未改任何断言，仅改 setup/import + 新增 persist 测试） |
| AI-003 advisory 偏离反向同步 | ❌ | **4 项 advisory/[约束] 偏离未反向同步 Tech-Spec**（§5 详见），记 4 blocker |
| AI-006 受影响清单完整性 | ⚠️ | Tech-Spec §10 两类标注完整（①类显式=零 + ①类隐式=零 + ②-A 15 文件 + ②-B 3 文件）；但 test-writer 实测纠正 PRAGMA foreign_keys 默认 ON（§11#5 预判 OFF）**未反向同步 §11#5**（blocker #4，AI-006 反向核实要求未闭合） |
| AI-007 PRD 逐条核对 | ✅ | §1 已逐条核对 21/21 对齐 |
| SEC-003a password_hash 不输出 | ✅ | dept.ts 回归 bug #3 修复后调 toUserOutput 剥离（闭合）；user.ts service create 既有剥离；rules SEC-003a 通过 |

## §4 3 个回归 bug 审查

### Bug #1：NotificationService.update 传 undefined → SQLite ERR_INVALID_ARG_TYPE

**现象**：内存版 `notificationRepo.update(id, { title, content, recipient_id, updated_at })` 传 undefined 字段（input 未提供时），Map 容忍（覆写为 undefined），SQLite `stmt.run(undefined)` 抛 ERR_INVALID_ARG_TYPE。

**修复**（`service/notification.ts:113-117`）：仅传已定义字段——
```ts
const patch: { title?: string; content?: string; recipient_id?: string; updated_at: string } = { updated_at: now };
if (input.title !== undefined) patch.title = input.title;
if (input.content !== undefined) patch.content = input.content;
if (input.recipient_id !== undefined) patch.recipient_id = input.recipient_id;
```

**判定**：修复合理 ✅。read-merge-write 模式（§6.5）本就要求 patch 仅含变更字段，原实现传全字段（含 undefined）是 sloppy。

**根因**：**内存实现容忍 sloppy 行为**（Map.set 覆写 undefined 不抛），DB 严格性（SQLite 绑定 undefined 抛 ERR_INVALID_ARG_TYPE）暴露了它。非 service 逻辑缺陷（update 公开签名不变，仅 patch 构造修正）。

**Retro 建议**：记 retro——「内存数据结构容忍 undefined/null 覆写，DB 绑定严格；impl-writer 须审查所有 repo.update 调用点的 patch 构造，确保仅传已定义字段」。属"内存 vs DB 行为差异"类教训。

### Bug #2：audit_logs.id PRIMARY KEY 移除 → append-only 重复 id 被拒

**现象**：内存版 AuditLogRepository 用 `Map<string, AuditLog>` 以 id 为 key，重复 id 覆写（实际是 bug——审计日志应 append 不覆写）。DB 版 schema.sql 原 `id TEXT PRIMARY KEY` 拒绝重复 id 插入（SQLITE_CONSTRAINT），导致同 id 审计日志无法追加。

**修复**（`db/schema.sql:121`）：移除 PRIMARY KEY——
```sql
id TEXT NOT NULL,  -- uuid（append-only 允许重复 id，无 PRIMARY KEY，F4）
```

**判定**：修复合理 ✅。audit_logs 是 append-only（§6.4 注释"重复 insert 视为追加"），同 id 可重复插入（多条审计日志可能同 id，虽实践中 randomUUID 极少重复，但 append-only 语义不应由 PK 阻断）。

**根因**：**内存实现有隐藏 bug**（Map 以 id 为 key 覆写，审计日志应 append 不覆写——这是内存版的语义缺陷，但因测试未覆盖"同 id 重复 insert"而未暴露）。DB PRIMARY KEY 严格性暴露了它。修复方向正确（移除 PK，让 append-only 真正 append）。

**Spec 同步问题（blocker #1）**：schema.sql 已改 `id TEXT NOT NULL`（无 PK），但 **Tech-Spec §5.1 audit_logs 表（line 324）仍写 `id | TEXT PK`**，未反向同步。属 advisory 偏离（DDL impl 细节）未同步 Spec，记 blocker。

**Retro 建议**：记 retro——「内存 Map 以 id 为 key 的实现隐含"覆写"语义，与 append-only 语义冲突；DB PK 暴露此隐藏 bug。未来 append-only 实体不应以 id 为唯一 key（应用数组 + 顺序，或 DB 无 PK + rowid）」。

### Bug #3：DepartmentService.assignUserDepartment 泄露 password_hash

**现象**：`assignUserDepartment` 返回 `{ entity: updated, ... }`，`updated` 为 UserEntity（含 password_hash）。R12 DB 版经 `userSchema.parse(...).strict()` 校验时，password_hash 不在 userSchema（输出 schema）中 → strict 拒绝。内存版可能也有此问题但未被发现（内存测试未触发 strict 校验路径）。

**修复**（`service/dept.ts:138-139`）：调 toUserOutput 剥离——
```ts
// TECH-AUTH-001 D5：剥离 password_hash（SEC-003a 输出 schema 1:1）
return { entity: toUserOutput(updated), changes, before };
```

**判定**：修复合理 ✅。SEC-003a 要求 password_hash 不输出，toUserOutput 是既有剥离函数（domain/user.ts:23）。修复后 SEC-003a 闭合。

**根因**：**R11 password_hash 引入时 dept.ts 未同步剥离**（R11 的隐藏遗漏——R11 改了 UserService.create 调 toUserOutput，但漏了 DepartmentService.assignUserDepartment）。R12 DB 严格性（userSchema.parse .strict()）暴露了它。内存版未暴露因内存测试未走 strict 校验路径。

**Retro 建议**：记 retro——「R11 引入 password_hash 时，未全量审查所有返回 UserEntity 的 service 方法（dept.assignUserDepartment 遗漏剥离）。未来引入敏感字段须 grep 全部返回该实体的 service 方法，统一加 toUserOutput」。属"R11 流程遗漏，R12 DB 严格性暴露"类。

## §5 advisory 偏离核对（AI-003）

列出 impl-writer 阶段所有 advisory 偏离，核对是否反向同步 Tech-Spec：

| # | 偏离项 | 实现现状 | Tech-Spec 同步状态 | 判定 |
|---|--------|---------|-------------------|------|
| 1 | **withTransaction async 重载**（§8） | `transaction.ts:43-44` 实现同步+异步双重载（`fn: () => T` / `fn: () => Promise<T>`），因 TransferService.transfer 的 A/B/C 经 async service 方法须 await | §8（line 468）**仍只写同步签名** `withTransaction<T>(db, fn: () => T): T`，未提 async 重载；transaction.ts 注释称"已反向同步"但 Tech-Spec 实际未更新 | ❌ **blocker #2**（advisory 偏离未同步 Spec） |
| 2 | **schema.sql audit_logs.id 去 PRIMARY KEY**（§5） | `schema.sql:121` `id TEXT NOT NULL`（无 PK，append-only 允许重复） | §5.1（line 324）**仍写 `id \| TEXT PK`**，未同步 | ❌ **blocker #1**（advisory 偏离未同步 Spec） |
| 3 | **PRAGMA foreign_keys 实测默认 ON**（§11#5） | `connection.ts:36` 显式 PRAGMA foreign_keys=ON（幂等无害）；persist.test.ts:371 实测 Node v24 node:sqlite 默认 ON=1 | §11#5（line 590）+ D15（line 176）**仍写"默认 OFF"**，未同步实测纠正 | ❌ **blocker #4**（AI-006 反向核实要求未闭合） |
| 4 | **transfer.ts 加 db 第 7 构造参数**（§8/§9） | `transfer.ts:38-46` 构造 +db；transfer body 包 withTransaction；B 补偿幂等 | §9（line 491）**仍写"service 代码零变更"**，未同步构造 +db 偏离；§3.2 已预判补偿幂等（部分同步） | ❌ **blocker #3**（[约束] D2"service 零变更"偏离未同步 §9） |
| 5 | 3 回归 bug 根因（内存 vs DB 行为差异） | bug #1 notification.update undefined / bug #2 audit_logs.id PK / bug #3 dept.assignUserDepartment password_hash | Tech-Spec 无专门章节记录"内存 vs DB 行为差异"类根因 | ⚠️ suggestion（记 retro，非 Spec 同步项） |

**4 项 blocker 均为 advisory/[约束] 偏离未反向同步 Tech-Spec**（AI-003 校验方式：advisory 偏离须更新 Tech-Spec，未同步记 blocker）。修复方式：更新 `docs/spec/persist.tech.md` 对应章节（§5.1/§8/§9/§11#5 + D15），将偏离项标注 `[advisory]` + 偏离理由 + 合规论证。

## §6 AI-006 受影响清单完整性

Tech-Spec §10 受影响清单两类标注：

| 类别 | Tech-Spec 标注 | 实际 | 完整性 |
|------|---------------|------|--------|
| ①类显式（contracts 联动 grep 命中） | 零（contracts 不改） | 零（packages/contracts 未在 modified 列表） | ✅ |
| ①类隐式（断言 repository 内部状态） | 零（grep .store/.logs/.size 仅命中公开方法返回值） | 零（impl-writer 未发现清单外影响） | ✅ |
| ②-A in-process 测试（new XxxRepository() → +db） | 15 文件 | 15 文件（user/role/dept/notification/audit/report/transfer/optimistic-locking/etag-caching/auth/role-inheritance/audit-embedding/notification-embedding/transfer-embedding/role-inheritance-embedding）+ 新增 helpers/db.ts | ✅ |
| ②-B spawn 端到端测试（DB_PATH 临时文件） | 3 文件（auth-embedding/etag-caching-embedding/optimistic-locking-embedding） | 3 文件 + 新增 persist-embedding.test.ts（第 4 个 spawn 测试） | ✅（persist-embedding 为 ③类新增） |
| ③类新增测试 | persist.test.ts + persist-embedding.test.ts | 已落地（55 新增用例） | ✅ |

**AI-006 反向核实（test-writer 纠正）**：test-writer 实测发现 PRAGMA foreign_keys 默认 ON（Node v24 node:sqlite），与 Tech-Spec §11#5 预判"默认 OFF"不一致（persist.test.ts:371 显式标注⚠）。**此纠正未反向同步 §11#5**（blocker #4）。test-writer 反向核实机制触发但 Spec 未回填，AI-006 增强要求"将该差异回填至复盘 / Spec"未闭合。

**AI-006 完整性判定**：清单本身完整（两类标注齐全 + 隐式子类覆盖），但 PRAGMA 实测纠正未同步 Spec，记 blocker #4（属 AI-003 范畴，但根因是 AI-006 反向核实未回填）。

## §7 结论与剩余改进项

### §7.1 verdict：block

**4 blocker**（均为 advisory/[约束] 偏离未反向同步 Tech-Spec，AI-003 违规）：

1. **§5.1 audit_logs.id 去 PRIMARY KEY 未同步**——schema.sql 已改 `id TEXT NOT NULL`（无 PK），Tech-Spec §5.1（line 324）仍写 `id | TEXT PK`。须更新 §5.1 为 `id \| TEXT NOT NULL`（无 PK，append-only 允许重复）+ 追加偏离理由（bug #2 根因）。
2. **§8 withTransaction async 重载未同步**——transaction.ts 实现同步+异步双重载，Tech-Spec §8（line 468）仍只写同步签名。须更新 §8 为双重载签名 + 偏离理由（TransferService A/B/C 经 async service 须 await）。注：transaction.ts 注释称"已反向同步"但 Tech-Spec 实际未更新，属伪同步。
3. **§9 transfer.ts db 构造参数未同步**——transfer.ts 构造 +db（第 7 参数），Tech-Spec §9（line 491）仍写"service 代码零变更"。须更新 §9 为"service 公开方法签名零变更；TransferService 构造 +db 为 D8 事务需求 [advisory] 偏离"+ 合规论证（service→db infra 非 reverse dependency；transfer 公开方法签名不变=D2 闭合核心）。
4. **§11#5 / D15 PRAGMA foreign_keys 默认 ON 未同步**——test-writer 实测 Node v24 node:sqlite 默认 ON（persist.test.ts:371 标注⚠），Tech-Spec §11#5（line 590）+ D15（line 176）仍写"默认 OFF"。须更新 §11#5/D15 为"node:sqlite Node v24 实测默认 ON（编译期 SQLITE_DEFAULT_FOREIGN_KEYS=1）；显式 PRAGMA foreign_keys=ON 幂等无害，保留作保险"+ 注明 test-writer 反向核实纠正。

**修复方式**：仅更新 `docs/spec/persist.tech.md`（4 处章节），无需改代码。更新后重跑 Reviewer 确认 4 blocker 闭合即可 pass。

### §7.2 suggestion（5 项，不阻断）

1. **router fallback createTestDb 改 required 或 throw**（§2.6）——5 router 的 `auditService ?? new AuditLogService(new AuditLogRepository(createTestDb()))` fallback 用 createTestDb 是 code smell（请求时建测试 db）。建议改 `auditService` 为 required 参数，或 fallback 改 `throw new Error('auditService required')`。生产不触发但反模式。属既有（R5 起）非本轮引入，记 suggestion。
2. **Retro：内存 vs DB 行为差异类教训**（bug #1/#2/#3）——3 回归 bug 根因均为"内存实现容忍 sloppy 行为 / 隐藏 bug，DB 严格性暴露"。建议记 retro：①内存 Map 容忍 undefined 覆写（bug #1）②内存 Map 以 id 为 key 覆写 append-only 实体（bug #2）③R11 引入敏感字段未全量审查 service 返回点（bug #3）。未来 DB 替换须预审此类差异。
3. **transfer.ts db 依赖未来改进**（§2.5）——当前 service 直接依赖 db（DatabaseSync）用于 withTransaction，可接受但耦合 db 实现。未来可抽 `UnitOfWork` / `TransactionManager` 抽象（repository 暴露 `withTx(fn)` 接口），让 service 依赖抽象。MVP 收官不必，记 suggestion。
4. **AI-005 既有 suggestion**（6 条，R7 引入非本轮）——role-inheritance 测试硬编码枚举字面量，建议改 SSOT 派生。非 R12 引入，不阻断本轮。
5. **transaction.ts 注释"已反向同步"与 Tech-Spec 实际未更新不一致**——建议 impl-writer 流程增加"反向同步后 grep Tech-Spec 确认章节已改"自检，避免伪同步（blocker #2 根因）。

### §7.3 已闭合项

- **AC 对齐 21/21** ✅
- **ARCH-001 闭合** ✅（repository 40 公开方法签名零变更 + service/router/domain/contracts 公开签名零变更 + 依赖方向无 reverse import）
- **三件套全绿** ✅（tsc 0 / rules 通过 / 833 测试全绿）
- **AI-002 测试断言未改** ✅（git diff 0 行 expect 改动）
- **SEC-003a password_hash 闭合** ✅（dept.ts 回归 bug #3 修复后 toUserOutput 剥离）
- **D8 双保障** ✅（DB ROLLBACK + 应用补偿，补偿闭包幂等）
- **D10 约束映射** ✅（isUniqueViolation 解析 e.message，不泄漏 SQLite）
- **D13 构造注入 db** ✅（6 repository 构造 +db，实例化层非方法签名）

### §7.4 闭合路径

修复 4 blocker（仅更新 Tech-Spec 4 处章节，无代码改动）→ 重跑 Reviewer 确认 advisory 偏离已同步 → verdict 转 **pass**。MVP 收官轮 ARCH-001 闭合验证成立，仅剩 Spec 文档同步即可合入。
