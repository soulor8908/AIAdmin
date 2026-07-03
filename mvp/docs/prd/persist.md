---
doc_type: PRD-Spec
id: PRD-PERSIST-001
title: 持久化层替换（内存 Map → node:sqlite 持久化 DB）+ ARCH-001 闭合收官
status: decided
# Q&A 决策结果：Q1=③node:sqlite零依赖 / Q2=①接口签名不变 / Q3=①启动时DDL建表 / Q4=①内存SQLite每测试隔离 / Q5=①原生node:sqlite / Q6=①删除内存实现 / Q7=②admin seed进DB / Q8=①DB事务BEGIN/COMMIT / Q9=①基础索引 / Q10=①DB约束映射既有码 / Q11=①snake_case透传 / Q12=①文件路径env
owner: ba@team
created: 2026-07-02
extends: PRD-AUTH-001
prd_ref: RETRO-ROUND11-001
---

# 持久化层替换（内存 Map → node:sqlite 持久化 DB）+ ARCH-001 闭合收官

## 背景
前十一轮演练已覆盖 CRUD / 审计埋点 / 报表聚合 / 事务补偿 / 递归继承 / HTTP 条件请求（If-Match + ETag）/ 鉴权域（登录签发 + token 校验 + 登出吊销）。但整套系统的**持久化始终是内存 Map**——所有 repository 用 `Map<string, Entity>` 存储，进程重启即丢数据。这是生产可用性的最后一个阻断项（R11 已补真实鉴权，仅剩持久化）。

本期引入**持久化层替换**验证以下未覆盖的工作流边界：

1. **ARCH-001 闭合收官**：repository 接口签名不变（同步方法 + 同返回类型），只换实现（Map → SQLite）。这是"换 DB 不动 service/router/domain"的闭合验证——与 R11"换鉴权来源不动四层"形成呼应，是 ARCH-001 分层设计在"换持久化机制"场景下的最终证明。MVP 收官的标志。
2. **零新依赖精神延续**：选用 Node 24 内置的 `node:sqlite`（DatabaseSync），与 R11 用 `node:crypto` 的精神一致——不引入 native 编译依赖（better-sqlite3 需 node-gyp），不引入 ORM（Drizzle/Prisma 增加抽象层）。验证"内置同步 API 足以支撑生产级持久化"。
3. **DB 事务与既有事务逻辑联动**：R7 transfer 多步事务 + 补偿回滚此前在内存 Map 上手动编排。本期引入 DB 原生事务（BEGIN/COMMIT/ROLLBACK），验证既有补偿逻辑与 DB 事务的协同——是保留 R7 补偿（应用层）还是下沉到 DB 事务（数据层）的决策点。
4. **DB 约束映射既有错误码**：email 唯一约束、外键约束等 DB 层约束冲突时，须映射到既有错误码（USER_EMAIL_DUPLICATE 等），而非泄漏 SQLite 原始错误。验证错误处理在"DB 异常 → 既有 ErrorCode"映射下的闭合。
5. **测试隔离新范式**：此前测试用内存 Map 天然隔离（每测试 new 实例）。DB 接入后须新隔离机制——内存 SQLite（`:memory:`）每测试新建连接，验证测试可重复 + 不串数据。

本期作为**基础设施替换**（非新业务域），是 R11 以来第二个"换底层机制验证 ARCH-001 闭合"的轮次。持久化层替换 = repository 实现替换 + DDL 建表 + DB 事务 + 约束映射 + 测试隔离，是"基础设施替换 + 数据层闭合"的最小完整场景。MVP 收官轮。

## 业务目标
- **目标1（DB 接入）**：所有 6 个 repository（user/role/dept/audit/notification/token-blacklist）的存储从内存 Map/Set 替换为 node:sqlite 持久化 DB。进程重启数据不丢。
- **目标2（ARCH-001 闭合）**：repository 接口签名**完全不变**（同步方法 + 同返回类型 + 同参数），service/router/domain **零变更**。只换 repository 内部实现（Map 操作 → SQL prepare/run/get/all）。这是"换 DB 不动上层"的闭合证明。
- **目标3（DDL 建表）**：server.ts 启动时执行 DDL（CREATE TABLE IF NOT EXISTS），幂等建表覆盖全部实体表 + 索引 + 约束。
- **目标4（DB 事务）**：R7 transfer 多步写操作用 DB 原生事务（BEGIN/COMMIT/ROLLBACK）包裹，失败回滚。验证 DB 事务与既有补偿逻辑的协同。
- **目标5（约束映射）**：DB 唯一约束/外键冲突时，repository 层捕获并映射到既有 ErrorCode（如 UNIQUE 冲突 → USER_EMAIL_DUPLICATE），不泄漏 SQLite 原始错误到上层。
- **目标6（测试隔离）**：内存 SQLite（`:memory:`）每测试新建连接，既有 778 测试零破坏（DB 测试与内存测试行为等价）。
- **目标7（MVP 收官验证）**：验证 ARCH-001 在"换持久化机制"下的闭合性，与 R11"换鉴权来源"呼应，标志 MVP 工作流验证目标达成。

## 用户故事
- 作为系统负责人，我希望进程重启后数据不丢失，系统具备生产可部署性。
- 作为系统负责人，我希望 DB 替换不影响业务逻辑层（service/router/domain），证明分层架构的稳定性。
- 作为系统负责人，我希望 DB 唯一约束冲突时返回业务错误码（如 USER_EMAIL_DUPLICATE），而非暴露 SQLite 内部错误给客户端。
- 作为开发者，我希望测试用内存 SQLite 隔离运行，不污染真实数据文件，且测试可重复。
- 作为系统负责人，我希望调岗等多步操作在 DB 事务中执行，失败自动回滚，保证数据一致性。
- 作为运维，我希望 DB 文件路径可配置（环境变量），生产/测试/开发可分离。

## 功能点清单
- [ ] F1：DB 接入与连接管理（node:sqlite DatabaseSync，文件路径 env 配置，启动建连接）
- [ ] F2：DDL 建表（server.ts 启动时 CREATE TABLE IF NOT EXISTS，覆盖 6 张表 + 索引 + 约束）
- [ ] F3：6 个 repository 实现替换（Map → SQL，接口签名不变）
- [ ] F4：DB 事务（transfer 多步写用 BEGIN/COMMIT/ROLLBACK，失败 ROLLBACK）
- [ ] F5：约束映射（UNIQUE/外键冲突 → 既有 ErrorCode，不泄漏 SQLite 错误）
- [ ] F6：测试隔离（内存 SQLite :memory: 每测试新建，778 既有测试零破坏）
- [ ] F7：admin seed 进 DB（R11 的 seedAdmin 从内存 Map 改为 DB upsert）

## 数据实体草图（DDL 表结构）
基于既有 contracts 的 entitySchema（已含全部字段），DDL 表结构：

- **users**：id(TEXT PK) / name(TEXT) / email(TEXT UNIQUE) / status(TEXT) / department_id(TEXT NULL) / created_at(TEXT) / updated_at(TEXT) / version(INTEGER) / password_hash(TEXT)
- **roles**：id(TEXT PK) / name(TEXT UNIQUE) / is_builtin(INTEGER) / permission_codes(TEXT JSON) / created_at / updated_at / version(INTEGER)
- **user_roles**：user_id(TEXT FK users.id) / role_id(TEXT FK roles.id) / assigned_at(TEXT) / PRIMARY KEY(user_id, role_id)
- **role_inheritance**：role_id(TEXT FK) / parent_role_id(TEXT FK) / PRIMARY KEY(role_id, parent_role_id)
- **departments**：id(TEXT PK) / name(TEXT) / parent_id(TEXT NULL FK) / depth(INTEGER) / created_at / updated_at / version(INTEGER)
- **audit_logs**：id(TEXT PK) / entity_type(TEXT) / entity_id(TEXT) / action(TEXT) / operator_id(TEXT) / operator_name(TEXT) / before_state(TEXT NULL JSON) / after_state(TEXT NULL JSON) / operated_at(TEXT)
- **notifications**：id(TEXT PK) / recipient_id(TEXT) / title(TEXT) / content(TEXT) / status(TEXT) / created_at / updated_at / version(INTEGER)
- **token_blacklist**：token(TEXT PK) / revoked_at(TEXT)

**索引**：users(email) UNIQUE 已含 / users(department_id) / user_roles(user_id) / user_roles(role_id) / audit_logs(entity_type, entity_id) / audit_logs(operated_at) / notifications(recipient_id, status)

**数据类型映射**（Q11 snake_case 透传）：
- DB 列名 = contracts 字段名（snake_case，如 department_id / created_at）
- TEXT 存字符串（uuid/datetime/enum/status）
- INTEGER 存数字（version）
- TEXT NULL 存可空字段（department_id / parent_id / before_state / after_state）
- 复合字段（permission_codes 数组、before_state/after_state 对象）用 TEXT 存 JSON 字符串，repository 层序列化/反序列化

## 验收标准（Given/When/Then）—— AI-007 端到端验收依据

### F1 DB 接入与连接管理
- **AC-F1-1 启动建连接**：GIVEN 配置 DB 路径 / WHEN server.ts 启动 / THEN DatabaseSync 连接建立，可执行 SQL。
- **AC-F1-2 文件持久化**：GIVEN 写入数据后 / WHEN 进程重启再启动 / THEN 数据仍在（文件 DB）。
- **AC-F1-3 DB 路径 env 配置**：GIVEN 设置 DB_PATH env / WHEN server.ts 启动 / THEN 使用该路径；缺省用 `./data/admin.db`。

### F2 DDL 建表
- **AC-F2-1 启动建表幂等**：GIVEN 空库 / WHEN server.ts 启动 / THEN 全部 8 张表 + 索引创建成功；再次启动不报错（IF NOT EXISTS 幂等）。
- **AC-F2-2 表结构对齐 contracts**：GIVEN DDL / WHEN 对比 entitySchema 字段 / THEN 字段名/类型/可空性 1:1 对齐（无字段遗漏或多余）。

### F3 repository 实现替换（ARCH-001 闭合核心）
- **AC-F3-1 接口签名不变**：GIVEN 6 个 repository 公开方法 / WHEN 对比替换前后签名 / THEN 方法名/参数/返回类型完全一致（同步方法不变 async）。**这是 ARCH-001 闭合的核心证据**。
- **AC-F3-2 service/router/domain 零变更**：GIVEN 替换后 / WHEN 跑 typecheck / THEN service/router/domain 文件无任何 import/调用改动（git diff 仅 repository + server.ts + 新增 db 模块）。
- **AC-F3-3 行为等价**：GIVEN 同一组操作 / WHEN 在内存实现 vs DB 实现上执行 / THEN 返回结果等价（list/findById/insert/update 语义一致）。
- **AC-F3-4 保持插入顺序**：GIVEN list 查询 / WHEN 无 ORDER BY 时 / THEN 保持插入顺序（SQLite rowid 天然有序，或显式 ORDER BY created_at）。

### F4 DB 事务
- **AC-F4-1 transfer 原子性**：GIVEN transfer 多步写 / WHEN 中间步骤失败 / THEN DB 事务 ROLLBACK，全部步骤回滚（无部分写入）。
- **AC-F4-2 事务成功提交**：GIVEN transfer 全部成功 / WHEN COMMIT / THEN 全部写入持久化。
- **AC-F4-3 既有补偿逻辑保留**：GIVEN transfer 失败 / WHEN ROLLBACK 后 / THEN 既有补偿逻辑（R7）仍执行（应用层补偿 + DB 回滚双重保障，或决策下沉到 DB 事务取消应用补偿——Q8 决策）。

### F5 约束映射
- **AC-F5-1 UNIQUE 冲突映射**：GIVEN 插入重复 email / WHEN DB 抛 SQLITE_CONSTRAINT_UNIQUE / THEN repository 映射为 USER_EMAIL_DUPLICATE（不泄漏 SQLite 错误码）。
- **AC-F5-2 外键冲突**：GIVEN 插入不存在的 department_id / WHEN DB 外键约束（若启用）/ THEN 映射为既有 DEPT_NOT_FOUND 或由 service 层前置校验拦截（Q10 决策）。
- **AC-F5-3 错误响应体一致**：GIVEN DB 约束冲突 / WHEN 返回 / THEN errorResponseSchema 与内存实现一致（code + message，无 SQLite 内部信息）。

### F6 测试隔离
- **AC-F6-1 内存 SQLite 隔离**：GIVEN 每个测试 / WHEN 新建 :memory: 连接 / THEN 测试间数据不串（每测试独立 DB 实例）。
- **AC-F6-2 既有 778 测试零破坏**：GIVEN DB 替换后 / WHEN 跑全量测试 / THEN 778 测试全绿（行为等价，无回归）。
- **AC-F6-3 端到端测试 spawn 真实 DB**：GIVEN embedding 测试 / WHEN spawn server / THEN 使用文件 DB 或临时文件 DB（验证持久化语义，非 :memory:）。

### F7 admin seed 进 DB
- **AC-F7-1 seed 幂等**：GIVEN 空库 / WHEN server.ts 启动 / THEN admin 用户写入 DB；再次启动不重复（UNIQUE email 约束 + upsert/INSERT OR IGNORE）。
- **AC-F7-2 seed 后可登录**：GIVEN 首次启动 seed / WHEN login admin@example.com/admin123 / THEN 200 返回 token（R11 鉴权链路在 DB 持久化下闭合）。
- **AC-F7-3 seed 持久化**：GIVEN 首次启动 seed / WHEN 重启 / THEN admin 仍在（DB 文件持久化，非每次启动重建）。

## Q&A 决策（全 BLOCKING，未回答不进入 Spec）

**Q1 · DB 选型？**
BLOCKING。方案①better-sqlite3（同步 API，但 native 编译依赖 node-gyp）；方案②async 驱动（如 postgres pg 库，但破坏 repository 同步接口）；方案③node:sqlite（Node 22+ 内置 DatabaseSync，零依赖，同步 API）。本期选哪个？推荐③（**已验证 Node v24.15.0 + node:sqlite 可用**，零新依赖，与 R11 node:crypto 精神一致；同步 API 保持 repository 接口不变，ARCH-001 闭合关键）。

**Q2 · repository 接口是否变更？**
BLOCKING。方案①接口签名完全不变（同步方法 + 同返回类型，service/router/domain 零变更，ARCH-001 闭合）；方案②改 async（破坏 service 层所有调用，违反 ARCH-001）。本期选哪个？推荐①（ARCH-001 闭合核心；node:sqlite 同步 API 支持此选择；若改 async 则 service 层全部 async/await 改造，回归 R11 之前的全栈改动，违背"换 DB 不动上层"目标）。

**Q3 · 迁移策略？**
BLOCKING。方案①启动时 DDL CREATE TABLE IF NOT EXISTS（幂等，简单，MVP 足够）；方案②引入迁移工具（如 Knex 迁移文件，增加依赖）；方案③手写版本化迁移脚本。本期选哪个？推荐①（MVP 简化，启动时建表幂等；schema 变更靠删库重建——MVP 可接受；迁移工具为未来生产方向）。

**Q4 · 测试隔离？**
BLOCKING。方案①内存 SQLite（:memory:）每测试新建连接（零污染、可重复、快）；方案②事务回滚（每测试 BEGIN→ROLLBACK，共享连接）；方案③测试专用 DB 文件（每测试清表）。本期选哪个？推荐①（最干净，每测试独立 DB 实例，无共享状态；:memory: 速度快；既有 in-process 测试改注入 DB 连接即可）。

**Q5 · ORM/驱动层？**
BLOCKING。方案①原生 node:sqlite（DatabaseSync + prepare/run/get/all，手写 SQL）；方案②Drizzle（类型安全查询构建器，增加依赖）；方案③Kysely（类似）；方案④Prisma（重型 ORM）。本期选哪个？推荐①（零依赖精神；手写 SQL 透明可控；repository 层已是抽象边界，ORM 增加抽象层无收益；ARCH-002 contracts 纯净原则）。

**Q6 · 现有内存实现如何处理？**
BLOCKING。方案①删除内存实现（Map/Set 代码删除，统一用 DB）；方案②保留内存实现作测试桩（双实现并存）；方案③保留作 fallback。本期选哪个？推荐①（避免双实现维护成本；既有测试改为注入 DB 连接，行为等价则无需保留内存版；ARCH-001 闭合要求单一持久化路径）。

**Q7 · admin seed 如何在 DB 落地？**
BLOCKING。方案①每次启动重建（DELETE + INSERT，非持久化语义）；方案②DB upsert（INSERT OR IGNORE / INSERT ... ON CONFLICT DO NOTHING，幂等且持久化）。本期选哪个？推荐②（持久化语义——seed 后重启不重建，符合 F7-3；UNIQUE email 约束 + INSERT OR IGNORE 实现幂等）。

**Q8 · DB 事务与 R7 既有补偿逻辑关系？**
BLOCKING。方案①DB 事务（BEGIN/COMMIT/ROLLBACK）包裹 transfer 多步写 + 保留 R7 应用层补偿（双重保障，DB 回滚 + 补偿回滚）；方案②下沉到 DB 事务，删除 R7 应用层补偿（DB 事务已保证原子性，补偿冗余）。本期选哪个？推荐①（保守——DB 事务 + 应用补偿双保障，R7 补偿逻辑已测试覆盖，删除有回归风险；MVP 收官不删既有逻辑；未来可评估下沉）。

**Q9 · 索引策略？**
BLOCKING。方案①基础索引（唯一约束字段 + 外键字段 + 高频查询字段，见 DDL 索引清单）；方案②全量索引（所有查询字段）；方案③无索引（MVP 数据量小）。本期选哪个？推荐①（基础索引覆盖唯一约束 + 外键 + 高频查询；MVP 数据量小但索引是生产习惯，且 SQLite 自动用唯一索引防重）。

**Q10 · DB 约束映射既有错误码？**
BLOCKING。方案①repository 层捕获 DB 约束冲突并映射到既有 ErrorCode（如 UNIQUE email → USER_EMAIL_DUPLICATE），不泄漏 SQLite 错误；方案②service 层前置校验（先 SELECT 查重再 INSERT，DB 约束只作兜底）。本期选哪个？推荐①（repository 层映射——DB 约束是 SSOT，前置 SELECT 查重有并发竞态；repository 捕获 SQLITE_CONSTRAINT_UNIQUE 按字段映射到对应 ErrorCode）。

**Q11 · 数据类型映射？**
BLOCKING。方案①snake_case 透传（DB 列名 = contracts 字段名，如 department_id/created_at，无转换层）；方案②camelCase 转换（DB 用 snake_case，TS 用 camelCase，repository 层转换）。本期选哪个？推荐①（contracts 已是 snake_case，透传零转换成本；避免命名转换层增加复杂度 + 转换 bug 风险；与既有 entitySchema 字段名 1:1）。

**Q12 · 环境配置？**
BLOCKING。方案①DB 文件路径 env（DB_PATH，缺省 ./data/admin.db）；方案②固定路径；方案③多环境配置文件。本期选哪个？推荐①（env 配置灵活，缺省值保证开箱即用；生产可覆盖路径；测试用 :memory: 不受影响）。

## Out of scope
- 迁移工具 / 版本化 schema 迁移 —— 本期启动时 DDL 建表，schema 变更靠删库重建（Q3 决策）。
- ORM / 查询构建器 —— 本期原生 node:sqlite 手写 SQL（Q5 决策）。
- DB 连接池 —— node:sqlite 是单连接同步 API，无连接池概念；连接池为未来 Postgres 方向。
- 读副本 / 读写分离 —— 本期单库，读写分离为未来方向。
- 数据备份 / 恢复 —— 本期不涉及，为运维方向。
- 内存实现保留作 fallback —— 本期删除内存实现（Q6 决策）。
- 应用层补偿下沉到 DB 事务 —— 本期保留双保障（Q8 决策）。
- Postgres / MySQL 接入 —— 本期 SQLite，其他 DBMS 为未来方向（验证 ARCH-001 闭合后可平移）。
- DB 监控 / 慢查询日志 —— 本期不涉及，为运维方向。
- 数据加密 at-rest —— 本期 DB 文件明文，加密为未来安全方向。
