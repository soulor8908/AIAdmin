---
doc_type: Tech-Spec
id: TECH-PERSIST-001
title: 持久化层替换（内存 Map → node:sqlite 持久化 DB）+ ARCH-001 闭合收官 Tech-Spec
prd_ref: PRD-PERSIST-001
status: ready
owner: tech-lead@team
created: 2026-07-03
---

# TECH-PERSIST-001 · 持久化层替换 Tech-Spec

> 派生自 PRD-PERSIST-001（status=decided，12 个 BLOCKING 决策已锁定：Q1=③node:sqlite / Q2=①接口签名不变 /
> Q3=①启动 DDL 建表 / Q4=①:memory: 测试隔离 / Q5=①原生 node:sqlite / Q6=①删除内存实现 / Q7=②DB upsert seed /
> Q8=①DB 事务 + 保留 R7 补偿双保障 / Q9=①基础索引 / Q10=①repository 层约束映射 / Q11=①snake_case 透传 / Q12=①DB_PATH env）。
>
> 本 Spec 阶段只产 Tech-Spec（本文）+ DDL（`apps/api/src/db/schema.sql`）；**不改 contracts / errors / repository /
> server.ts / service / domain / router**（impl-writer 阶段落地，§6/§7/§8 描述为 [advisory] 实现提示）。
> 与 R11 TECH-AUTH-001 同范式：换底层机制（持久化）不动四层，ARCH-001 闭合收官（§9）。
>
> 验证基线（产出时实测）：778 测试全绿、`tsc` 0 错误、`lint:rules` ✅；Node v24.15.0 + `node:sqlite` 已实测可用。

## 1. 覆盖范围与既有端点核验（R10 S-2 教训闭合）

**R10 S-2 教训**：Spec 须核验既有路由表，确认是否新增/覆盖端点。本轮为**基础设施替换**（repository 内部实现 Map → SQL），
**不新增任何端点**——PRD F1~F7 全部落在 repository 内部 + server.ts 启动装配 + DDL，router/service/domain 零变更。
故 R10 S-2 端点核验结论：**本轮零新端点，既有路由表（见 TECH-AUTH-001 §1 全集）完全不变**。

本轮 ARCH-001 闭合基准 = **6 个 repository 的公开方法清单 + 接口签名**（AC-F3-1 核心证据）。逐个核验如下，
impl-writer 须保证替换前后签名逐字一致（方法名 / 参数 / 返回类型 / 同步语义）：

### 1.1 UserRepository（`apps/api/src/repository/user.ts`）—— 8 公开方法
| 方法 | 签名 |
|------|------|
| `list` | `(opts: ListOptions) => ListResult` |
| `findById` | `(id: string) => UserEntity \| undefined` |
| `findByIds` | `(ids: string[]) => UserEntity[]` |
| `findByEmail` | `(email: string) => UserEntity \| undefined` |
| `insert` | `(user: UserEntity) => UserEntity` |
| `updateStatus` | `(id: string, status: UserStatus, updatedAt: string) => UserEntity \| undefined` |
| `findByDepartmentId` | `(deptId: string) => UserEntity[]` |
| `updateDepartmentId` | `(userId: string, departmentId: string \| null, updatedAt: string) => UserEntity \| undefined` |

### 1.2 RoleRepository（`apps/api/src/repository/role.ts`）—— 13 公开方法（+构造）
| 方法 | 签名 |
|------|------|
| `list` | `(opts: RoleListOptions) => RoleListResult` |
| `findById` | `(id: string) => RoleEntity \| undefined` |
| `findByName` | `(name: string) => RoleEntity \| undefined` |
| `insert` | `(role: RoleEntity) => RoleEntity` |
| `update` | `(id: string, patch: Partial<RoleEntity>) => RoleEntity \| undefined` |
| `findChildren` | `(roleId: string) => RoleEntity[]` |
| `delete` | `(id: string) => boolean` |
| `insertUserRole` | `(userRole: UserRoleEntity) => UserRoleEntity` |
| `findUserRolesByUser` | `(userId: string) => UserRoleEntity[]` |
| `findUserRolesByRole` | `(roleId: string) => UserRoleEntity[]` |
| `existsUserRole` | `(userId: string, roleId: string) => boolean` |
| `findUserRole` | `(userId: string, roleId: string) => UserRoleEntity \| undefined` |
| `deleteUserRole` | `(userId: string, roleId: string) => boolean` |

> 构造签名当前为 `constructor()`；本轮 [约束] D13 改为 `constructor(db: DatabaseSync)`（实例化方式变更，非方法签名；
> 属 ②类影响，见 §10）。私有 `seedBuiltinAdmin` 保留在构造内，内部改 `INSERT OR IGNORE`（D7）。

### 1.3 DepartmentRepository（`apps/api/src/repository/dept.ts`）—— 7 公开方法
| 方法 | 签名 |
|------|------|
| `list` | `() => DepartmentEntity[]` |
| `findById` | `(id: string) => DepartmentEntity \| undefined` |
| `findByParent` | `(parentId: string \| null) => DepartmentEntity[]` |
| `insert` | `(dept: DepartmentEntity) => DepartmentEntity` |
| `delete` | `(id: string) => boolean` |
| `existsByNameUnderParent` | `(name: string, parentId: string \| null) => boolean` |
| `computeDepth` | `(parentId: string \| null) => number` |

### 1.4 AuditLogRepository（`apps/api/src/repository/audit.ts`）—— 3 公开方法（append-only）
| 方法 | 签名 |
|------|------|
| `insert` | `(log: AuditLog) => AuditLog` |
| `list` | `(opts: AuditLogListOptions) => AuditLogListRepoResult` |
| `listAll` | `(filter?: AuditLogListAllFilter) => AuditLog[]` |

### 1.5 NotificationRepository（`apps/api/src/repository/notification.ts`）—— 7 公开方法
| 方法 | 签名 |
|------|------|
| `findById` | `(id: string) => NotificationEntity \| undefined` |
| `insert` | `(notification: NotificationEntity) => NotificationEntity` |
| `update` | `(id: string, patch: Partial<Omit<NotificationEntity,'id'>>) => NotificationEntity \| undefined` |
| `updateStatusAndSentAt` | `(id: string, sentAt: string, updatedAt: string) => NotificationEntity \| undefined` |
| `updateStatusAndReadAt` | `(id: string, readAt: string, updatedAt: string) => NotificationEntity \| undefined` |
| `delete` | `(id: string) => boolean` |
| `list` | `(opts: NotificationListOptions) => NotificationListRepoResult` |

### 1.6 TokenBlacklistRepository（`apps/api/src/repository/token-blacklist.ts`）—— 2 公开方法
| 方法 | 签名 |
|------|------|
| `add` | `(token: string) => void` |
| `has` | `(token: string) => boolean` |

**核验结论**：6 个 repository 共 **40 个公开方法**，签名本轮**绝对不变**（D2 [约束]，ARCH-001 闭合核心）。
唯一变更是构造签名（`new XxxRepository()` → `new XxxRepository(db)`，D13），属实例化层非方法签名，影响见 §10 ②类。

## 2. 决策清单（D1~D16）

> 每个决策显式标注 `[约束]`（默认禁止偏离，偏离须经 AI-003 流程）或 `[advisory]`（允许偏离，须反向同步 Spec）。
> D1~D12 对齐 PRD Q1~Q12（全 BLOCKING 已锁定）；D13~D16 为本 Spec 派生技术决策。

### D1 · DB 选型 = `node:sqlite` DatabaseSync `[约束]`（PRD Q1③）
- 采用 Node 22+ 内置 `node:sqlite`（`DatabaseSync`，同步 API，零新依赖）。**已实测 Node v24.15.0 可用**。
- 理由：零依赖精神（与 R11 `node:crypto` 一致）；同步 API 保持 repository 接口同步不变（ARCH-001 闭合关键，D2）；
  不引入 native 编译（better-sqlite3 需 node-gyp）/ ORM（Drizzle/Prisma 增抽象层，违反 ARCH-002）。
- API 形态：`new DatabaseSync(path)` / `db.exec(sql)` / `db.prepare(sql).get/all/run` / `stmt.run(...params)` 返回 `{changes,lastInsertRowid}`。

### D2 · repository 接口签名完全不变 `[约束]`（PRD Q2①，ARCH-001 闭合核心）
- 6 个 repository 的 40 个公开方法签名**逐字不变**（方法名 / 参数 / 返回类型 / 同步语义，见 §1）。
- service / router / domain / contracts **零变更**。仅 repository 内部实现 Map 操作 → SQL prepare/run/get/all。
- **禁止**改 async（会破坏 service 全部调用，违背"换 DB 不动上层"目标）。

### D3 · 迁移策略 = 启动时 DDL `CREATE TABLE IF NOT EXISTS` 幂等 `[约束]`（PRD Q3①）
- server.ts 启动时 `db.exec(schemaSql)`（读 `apps/api/src/db/schema.sql`）一次性建全部表 + 索引。
- `IF NOT EXISTS` 保证幂等（AC-F2-1：再次启动不报错）。schema 变更靠删库重建（MVP 可接受，Out of scope：迁移工具）。

### D4 · 测试隔离 = `:memory:` 每测试新建连接 `[约束]`（PRD Q4①）
- 每个 in-process 测试新建 `new DatabaseSync(':memory:')` + 执行 DDL + 注入 repository，测试间数据零串（AC-F6-1）。
- 既有 in-process 测试改 setup：原 `new XxxRepository()` → 先建 `:memory:` db → `new XxxRepository(db)`（②类影响，§10）。
- 端到端 spawn 测试用临时文件 DB（AC-F6-3，验证持久化语义，非 :memory:），见 §10 ②类。

### D5 · 驱动层 = 原生 node:sqlite 手写 SQL `[约束]`（PRD Q5①）
- 直接 `db.prepare(sql).get/all/run`，手写 SQL，无 ORM/查询构建器。repository 层已是抽象边界，ORM 增抽象无收益（ARCH-002）。
- PreparedStatement 复用：repository 内模块级 `this.stmts = { findById: db.prepare(...), ... }`（构造时 prepare 一次，[advisory] 实现提示）。

### D6 · 删除内存实现 `[约束]`（PRD Q6①）
- 6 个 repository 的 Map/Set 内部存储代码删除，统一用 DB。避免双实现维护成本；ARCH-001 闭合要求单一持久化路径。
- 既有测试改为注入 DB 连接（D4），行为等价则无需保留内存版（AC-F6-2）。

### D7 · admin seed = `INSERT OR IGNORE` 幂等 `[约束]`（PRD Q7②）
- 角色 seed（`RoleRepository.seedBuiltinAdmin`）：构造内 `INSERT OR IGNORE INTO roles ...`（UNIQUE name 触发 ignore，幂等）。
- 用户 seed（`server.ts.seedDemoData`）：`INSERT OR IGNORE INTO users ...`（UNIQUE email 触发 ignore）或保留既有 `findByEmail` 守卫（亦幂等，[advisory] 二选一）。
- 持久化语义：seed 后重启不重建（AC-F7-3），区别于"每次启动 DELETE+INSERT"（Q7①已否决）。

### D8 · DB 事务 + R7 应用层补偿双保障 `[约束]`（PRD Q8①）
- R7 transfer 多步写用 DB 原生事务包裹：`BEGIN` → A 改部门 / B 移除旧角色 / C 分配新角色 → `COMMIT`；任一步失败 `ROLLBACK`。
- **保留** R7 既有应用层补偿闭包（不删除，已测试覆盖，删除有回归风险）。双保障：DB ROLLBACK（数据层）+ 补偿闭包（应用层）。
- 协同细节与补偿幂等性见 §3.2（关键：ROLLBACK 后补偿闭包须幂等，避免假性 `TRANSFER_COMPENSATION_FAILED`）。

### D9 · 索引策略 = 基础索引 `[约束]`（PRD Q9①）
- 覆盖：UNIQUE 约束字段（隐式索引）+ 外键字段 + 高频查询字段。清单见 §5（7 表共 9 显式索引 + 3 UNIQUE 隐式索引）。
- 不做全量索引（数据量小，MVP 不必）；无索引亦非选项（唯一约束需索引防重 + 生产习惯）。

### D10 · 约束映射 = repository 捕获 `SQLITE_CONSTRAINT` → 既有 ErrorCode `[约束]`（PRD Q10①）
- repository 层 `try { stmt.run(...) } catch (e)`，按 `e.message` 特征映射到对应 ErrorCode（不泄漏 SQLite 原始错误，AC-F5-3）。
- 映射表见 §4。关键：node:sqlite 的 `e.code` 对所有约束均为通用 `'ERR_SQLITE_ERROR'`，**须解析 `e.message`** 区分 UNIQUE/NOT NULL/FK（§11 advisory）。
- DB 约束是 SSOT（前置 SELECT 查重有并发竞态，Q10①已否决方案②）。

### D11 · 数据类型映射 = snake_case 透传 `[约束]`（PRD Q11①）
- DB 列名 = contracts 字段名（`department_id` / `created_at` / `parent_role_id` / `operated_at` ...），无命名转换层。
- 类型映射见 D16。contracts 已是 snake_case，透传零转换成本 + 与 entitySchema 1:1（AC-F2-2）。

### D12 · 环境配置 = `DB_PATH` env `[约束]`（PRD Q12①）
- `const dbPath = process.env.DB_PATH ?? './data/admin.db'`（缺省保证开箱即用，AC-F1-3）。
- 生产可覆盖路径；测试用 `:memory:`（D4）或临时文件（AC-F6-3），不受缺省影响。
- server.ts 须确保缺省路径父目录存在（`fs.mkdirSync('./data', {recursive:true})`，[advisory] 实现提示）。

### D13 · DB 连接注入 = repository 构造接收 `db` `[约束]`（派生自 Q2/Q4）
- 6 个 repository 构造签名统一改为 `constructor(db: DatabaseSync)`（`TokenBlacklistRepository` 同）。
- server.ts 创建单例 `db` → 注入全部 repository；测试建 `:memory:` db → 注入。
- **此为实例化层变更，非方法签名变更**（D2 不冲突）：service 调用的是 repository 方法（不变），不感知 db 来源。
- db 类型用 `DatabaseSync`（`import type { DatabaseSync } from 'node:sqlite'`）。

### D14 · 复合字段 JSON 序列化 `[约束]`（派生自 Q11）
- `roles.permission_codes`（`PermissionCode[]`）→ TEXT 存 `JSON.stringify`，读时 `JSON.parse`。
- `audit_logs.before` / `audit_logs.after`（`ChangeField[]`，非空数组）→ TEXT 存 JSON；create 时 before=`"[]"`，delete 时 after=`"[]"`。
- null 处理：可空标量字段（department_id/sent_at/read_at）直接存 NULL，非复合字段不序列化。复合字段不可空（NOT NULL），空数组存 `"[]"`。
- 序列化在 repository 层完成（透传边界），service/domain 不感知存储格式。

### D15 · `PRAGMA foreign_keys=ON` 外键启用 `[约束]`（派生，DB 层一致性）
- 连接创建后立即 `db.exec('PRAGMA foreign_keys=ON')`。SQLite 默认 OFF（与 Postgres 相反），不启用则 FK 形同虚设。
- FK 约束清单见 §5（users.department_id / user_roles.user_id+role_id / roles.parent_role_id / departments.parent_id）。
- audit_logs / notifications 故意不 FK（快照引用，append-only 须留存被删实体，§5）。

### D16 · SQLite 类型映射 `[约束]` + `[advisory]`（派生自 Q11）
- `[约束]` 映射表：TEXT（uuid/datetime/enum/status/文本/JSON 复合）、INTEGER（version；is_builtin 存 0/1）、NULL（可空字段）。
- `[约束]` SQLite 无 BOOLEAN：`is_builtin` 用 INTEGER 0/1，repository 层 `Boolean(row.is_builtin)` 读 / `bool?1:0` 写。
- `[约束]` 保持插入顺序（AC-F3-4）：list/findByIds/findByParent 等用 `ORDER BY rowid`（SQLite rowid 天然反映插入顺序）。
- `[advisory]` UPDATE 返回更新后实体：用 `UPDATE ... RETURNING *`（SQLite 3.35+，Node 24 已实测支持，§11）或 UPDATE+SELECT 两步。

## 3. 状态机

### 3.1 DB 事务状态机（本轮无新业务状态机；业务状态机在 domain 层不变）
```
   transfer 入口（TransferService.transfer）
            │
            ↓
        BEGIN              ← db.exec('BEGIN')（共享 db 连接，跨 repo 生效）
            │
   ┌────────┴────────┐
   │  A 改部门        │   userRepo.updateDepartmentId（经 deptService.assignUserDepartment）
   │  B 移除旧角色    │   roleRepo.deleteUserRole（经 roleService.remove）
   │  C 分配新角色    │   roleRepo.insertUserRole（经 roleService.assign）
   └────────┬────────┘
            │
      全部成功？
      ├─ 是 → COMMIT               ← db.exec('COMMIT')；构造聚合 WriteResult 返回
      └─ 否 → ROLLBACK             ← db.exec('ROLLBACK')（DB 数据层回滚，AC-F4-1）
                  │
                  ↓
            执行 R7 补偿闭包（逆序，双保障 D8）
                  │
                  ↓
            抛 TRANSFER_FAILED（补偿全成功）/ TRANSFER_COMPENSATION_FAILED（补偿失败，CODE-002）
```

### 3.2 DB 事务与 R7 补偿协同（D8 双保障关键设计）
**冲突识别**：DB `ROLLBACK` 已把 A/B 成功步骤的数据回滚到原始态。若随后无条件运行 R7 补偿闭包：
- A 补偿（`updateDepartmentId(userId, fromDeptId)`）：rollback 后 department_id 已是 fromDeptId → 幂等 no-op，安全。
- B 补偿（`insertUserRole({oldRoleId})`）：rollback 后 oldRole 关联已被 DB 恢复 → 再 INSERT 命中 `UNIQUE(user_id,role_id)`
  → 抛 `USER_ROLE_ALREADY_ASSIGNED` → 被补偿 catch 块当作"补偿失败" → 假性 `TRANSFER_COMPENSATION_FAILED`。**这是假警报**。
- C 补偿（`deleteUserRole(userId, newRoleId)`）：rollback 后 newRole 关联本就不存在 → DELETE 0 行 → 返回 false，幂等安全。

**解决（impl-writer 落地，[advisory] 实现提示）**：补偿闭包须**幂等**——对"已被 DB rollback 恢复"的状态视为成功而非失败：
- A/C 补偿天然幂等（UPDATE 同值 no-op / DELETE 0 行返回 false 不抛）。
- B 补偿 `insertUserRole`：catch `USER_ROLE_ALREADY_ASSIGNED`（或底层 UNIQUE 冲突）→ 视为"已恢复"=补偿成功，不抛。
- 补偿闭包的 push/pop/逆序/`TRANSFER_COMPENSATION_FAILED` 语义**不变**（保留 R7 已测试逻辑，D8 要求）；仅放宽"已恢复"判定。
- 等价替代方案（impl-writer 可选，[advisory]）：仅当 `ROLLBACK` 自身抛错时才运行补偿（真 fallback）；正常 rollback 后跳过。
  此方案改动 R7 控制流较大，预判偏离概率：低；推荐幂等闭包方案。

> ⚠ 此协同是 impl-writer 必须处理的隐式偏离点（§11 #1）。当前 transfer.ts 补偿闭包按 Map 语义写（insertUserRole 幂等覆写），
> DB 化后 insertUserRole 抛 UNIQUE → 须调整补偿闭包 catch。**属 service 层 impl 改动**（非本阶段），但 Tech-Spec 须预判。

## 4. 边界与异常（约束映射表，对齐 errors.ts errorCodeToHttpStatus）

> node:sqlite 约束异常 `e.code` 对所有约束均为通用 `'ERR_SQLITE_ERROR'`，**须解析 `e.message`** 区分类型（§11 #2）。
> 实测消息格式：UNIQUE=`"UNIQUE constraint failed: <table>.<col>[, <table>.<col>]"`；FK=`"FOREIGN KEY constraint failed"`（**无表/列信息**）；
> NOT NULL=`"NOT NULL constraint failed: <table>.<col>"`。

| DB 异常 | `e.message` 特征 | 映射 ErrorCode | HTTP | 触发场景 | 触发位置 |
|---------|------------------|----------------|------|----------|----------|
| UNIQUE `users.email` | `UNIQUE constraint failed: users.email` | `USER_EMAIL_DUPLICATE` | 409 | insert 重复 email | UserRepository.insert |
| UNIQUE `roles.name` | `UNIQUE constraint failed: roles.name` | `ROLE_NAME_DUPLICATE` | 409 | insert 重复角色名 | RoleRepository.insert |
| UNIQUE `user_roles(user_id,role_id)` | `UNIQUE constraint failed: user_roles.user_id, user_roles.role_id` | `USER_ROLE_ALREADY_ASSIGNED` | 409 | 重复分配角色 | RoleRepository.insertUserRole |
| FK 通用 | `FOREIGN KEY constraint failed`（无列名） | `500 INTERNAL`* | 500 | race / 编程错误 | repository 写操作 |
| NOT NULL | `NOT NULL constraint failed: <t>.<c>` | `500 INTERNAL`* | 500 | 编程错误（service 构造实体应填全） | repository 写操作 |
| CHECK（本期 DDL 未加 CHECK，预留） | `CHECK constraint failed: <t>` | `500 INTERNAL`* | 500 | 枚举非法（预留） | repository 写操作 |

\* FK / NOT NULL / CHECK 在正常流程**不可达**：service 层已前置校验（dept/role/user 存在性、enum 来自 contracts Zod 校验、
字段必填由 service 构造实体保证）。DB 约束为**backstop**（防 race / 编程错误）。若触发，映射为 500 INTERNAL（非业务码），
server.ts catch 块统一兜底为 `{error:'INTERNAL_ERROR', message}`。**不新增 ErrorCode**（本轮 contracts/errors 不改，已就绪）。

补充：
- DB 连接失败（启动时 `new DatabaseSync(path)` 抛）→ 进程启动失败退出（server.ts 顶层未 catch → node 退出）。AC-F1-1 间接覆盖。
- 磁盘满 / IO 错误（COMMIT 时抛）→ 500 INTERNAL（server.ts catch 块兜底）。
- repository 约束映射须在**抛出前**构造 `AppError(code, message)`（不含 SQLite 内部信息，AC-F5-3）。

## 5. DDL 设计（详见 `apps/api/src/db/schema.sql`）

> 完整 DDL 见 `apps/api/src/db/schema.sql`（已实测可执行、幂等、约束生效）。本节给出表清单 + 字段对齐核验。

### 5.0 ⚠ 关键校正：PRD DDL 草图与 contracts SSOT 的不一致（按 AC-F2-2 以 contracts 为准）
PRD §数据实体草图 列 8 张表，但草图与 contracts entitySchema 存在 6 处不一致。**AC-F2-2 [约束] 要求 DDL 与 entitySchema
1:1 对齐（无字段遗漏或多余）**，contracts 是 SSOT，故 DDL 以 contracts 为准：

| # | 表 | PRD 草图 | contracts entitySchema | 本 DDL 决策 |
|---|----|---------|------------------------|-------------|
| 1 | role_inheritance | 列为独立表 | **无对应 schema**；roleSchema 用单继承 `parent_role_id`（直接挂 role 行），RoleRepository 全部继承逻辑（findChildren/update/setParent/cycle 检测）操作 `role.parent_role_id`，无任何 role_inheritance 代码路径 | **omit 该表**（AC-F2-2「无多余」）→ 实际 **7 张表** |
| 2 | departments | 多列 depth/updated_at/version | `departmentSchema` 仅 id/name/parent_id/created_at（depth 由 `computeDepth` 动态推导不存储；dept 不可编辑无 version/updated_at） | 仅留 4 列 |
| 3 | audit_logs | before_state/after_state，漏 created_at | `auditLogSchema` 字段 before/after（非空数组）+ operated_at + created_at | 列名 before/after + 含 created_at |
| 4 | roles | 漏 description/parent_role_id，误加 updated_at | `roleSchema` 含 id/name/description/permission_codes/is_builtin/parent_role_id/created_at/version（8 列，无 updated_at） | 按 contracts 8 列 |
| 5 | user_roles | (user_id,role_id) 为 PK，漏 id | `userRoleSchema` 含 id（uuid）；业务唯一为 (user_id,role_id) | id 为 PK，(user_id,role_id) UNIQUE |
| 6 | notifications | 漏 sent_at/read_at | `notificationSchema` 含 sent_at/read_at（nullable） | 含 sent_at/read_at |

> task 描述提及"复合字段 permission_codes/before_state/after_state"沿用 PRD 草图措辞；按 AC-F2-2 实际列名为
> `permission_codes` / `before` / `after`（对齐 contracts）。`before`/`after` 是 SQLite 关键字，DDL 与 SQL 须双引号包裹（§11 #3）。

### 5.1 表清单（7 张）+ 字段对齐 entitySchema 1:1 核验

#### 表1 users（对齐 `userEntitySchema`，9 列）
| DDL 列 | 类型/约束 | entitySchema 字段 | 对齐 |
|--------|----------|-------------------|------|
| id | TEXT PK | id: uuid | ✓ |
| name | TEXT NOT NULL | name: string min(1) | ✓ |
| email | TEXT NOT NULL UNIQUE | email: string email | ✓ UNIQUE |
| status | TEXT NOT NULL | status: userStatusSchema | ✓ |
| department_id | TEXT NULL | department_id: uuid nullable optional | ✓ NULL |
| created_at | TEXT NOT NULL | created_at: datetime | ✓ |
| updated_at | TEXT NOT NULL | updated_at: datetime | ✓ |
| version | INTEGER NOT NULL DEFAULT 0 | version: int min(0) | ✓ |
| password_hash | TEXT NOT NULL | password_hash: string min(1) | ✓ |
FK: department_id → departments(id) ON DELETE SET NULL。索引: idx_users_department_id。

#### 表2 roles（对齐 `roleSchema`，8 列）
| DDL 列 | 类型/约束 | entitySchema 字段 | 对齐 |
|--------|----------|-------------------|------|
| id | TEXT PK | id: uuid | ✓ |
| name | TEXT NOT NULL UNIQUE | name: string 1..64 | ✓ UNIQUE |
| description | TEXT NOT NULL | description: string max(512) | ✓ |
| permission_codes | TEXT NOT NULL（JSON） | permission_codes: PermissionCode[] | ✓ D14 JSON |
| is_builtin | INTEGER NOT NULL | is_builtin: boolean | ✓ 0/1 (D16) |
| parent_role_id | TEXT NULL | parent_role_id: uuid nullable | ✓ NULL |
| created_at | TEXT NOT NULL | created_at: datetime | ✓ |
| version | INTEGER NOT NULL DEFAULT 0 | version: int min(0) | ✓ |
FK: parent_role_id → roles(id) ON DELETE RESTRICT。索引: idx_roles_parent_role_id。

#### 表3 user_roles（对齐 `userRoleSchema`，4 列）
| DDL 列 | 类型/约束 | entitySchema 字段 | 对齐 |
|--------|----------|-------------------|------|
| id | TEXT PK | id: uuid | ✓ |
| user_id | TEXT NOT NULL | user_id: uuid | ✓ |
| role_id | TEXT NOT NULL | role_id: uuid | ✓ |
| assigned_at | TEXT NOT NULL | assigned_at: datetime | ✓ |
UNIQUE(user_id, role_id)。FK: user_id→users(id) ON DELETE CASCADE, role_id→roles(id) ON DELETE CASCADE。
索引: idx_user_roles_user_id, idx_user_roles_role_id。

#### 表4 departments（对齐 `departmentSchema`，4 列）
| DDL 列 | 类型/约束 | entitySchema 字段 | 对齐 |
|--------|----------|-------------------|------|
| id | TEXT PK | id: uuid | ✓ |
| name | TEXT NOT NULL | name: string 1..64 | ✓ |
| parent_id | TEXT NULL | parent_id: uuid nullable | ✓ NULL |
| created_at | TEXT NOT NULL | created_at: datetime | ✓ |
FK: parent_id → departments(id) ON DELETE RESTRICT。索引: idx_departments_parent_id。

#### 表5 audit_logs（对齐 `auditLogSchema`，10 列）
| DDL 列 | 类型/约束 | entitySchema 字段 | 对齐 |
|--------|----------|-------------------|------|
| id | TEXT NOT NULL（[advisory] 去 PK，见下注） | id: uuid | ✓ |
| operator_id | TEXT NOT NULL | operator_id: uuid | ✓（不 FK，快照） |
| operator_name | TEXT NOT NULL | operator_name: string min(1) | ✓ |
| entity_type | TEXT NOT NULL | entity_type: AuditLogEntityType | ✓ |
| entity_id | TEXT NOT NULL | entity_id: uuid | ✓（不 FK，快照） |
| action | TEXT NOT NULL | action: AuditLogAction | ✓ |
| operated_at | TEXT NOT NULL | operated_at: datetime | ✓ |
| "before" | TEXT NOT NULL（JSON） | before: ChangeField[] 非空数组 | ✓ D14 JSON，引号 §11#3 |
| "after" | TEXT NOT NULL（JSON） | after: ChangeField[] 非空数组 | ✓ D14 JSON，引号 §11#3 |
| created_at | TEXT NOT NULL | created_at: datetime | ✓ |
无 FK（append-only 快照）。索引: idx_audit_logs_entity(entity_type,entity_id), idx_audit_logs_operated_at, idx_audit_logs_operator_id。
> [advisory] 偏离 §5.1 原设计（impl-writer 反向同步，REVIEW-PERSIST-001 blocker #1）：原设计 `id TEXT PK`，但 audit_logs 是 append-only 实体（同一 entity_id 可有多条审计记录），内存 Map 实现以 id 为 key 会覆写（隐藏语义缺陷），DB PRIMARY KEY 拒绝重复插入暴露此缺陷。修复：移除 PRIMARY KEY，改为 `id TEXT NOT NULL`，SQLite 隐式 rowid 充当内部行标识。根因：内存实现容忍 append-only 覆写语义缺陷，DB 严格性暴露。retro 素材。

#### 表6 notifications（对齐 `notificationSchema`，10 列）
| DDL 列 | 类型/约束 | entitySchema 字段 | 对齐 |
|--------|----------|-------------------|------|
| id | TEXT PK | id: uuid | ✓ |
| title | TEXT NOT NULL | title: string 1..128 | ✓ |
| content | TEXT NOT NULL | content: string 1..4000 | ✓ |
| recipient_id | TEXT NOT NULL | recipient_id: uuid | ✓（不 FK，send 时 service 校验） |
| status | TEXT NOT NULL | status: notificationStatusSchema | ✓ |
| created_at | TEXT NOT NULL | created_at: datetime | ✓ |
| updated_at | TEXT NOT NULL | updated_at: datetime | ✓ |
| sent_at | TEXT NULL | sent_at: datetime nullable | ✓ NULL |
| read_at | TEXT NULL | read_at: datetime nullable | ✓ NULL |
| version | INTEGER NOT NULL DEFAULT 0 | version: int min(0) | ✓ |
无 FK（recipient 快照）。索引: idx_notifications_recipient_status(recipient_id,status)。

#### 表7 token_blacklist（无 entitySchema，infra 表，2 列）
| DDL 列 | 类型/约束 | 说明 |
|--------|----------|------|
| token | TEXT PK | TokenBlacklistRepository.add/has 操作 |
| revoked_at | TEXT NOT NULL | 登出时刻（未来 TTL 清理用，advisory） |
> token_blacklist 无 contracts schema（infra 表，不暴露 API），AC-F2-2 无对齐对象，按 PRD 草图落地，不构成「多余」。

### 5.2 索引清单（9 显式 + 3 UNIQUE 隐式）
**UNIQUE 隐式索引**（3）：users(email)、roles(name)、user_roles(user_id,role_id)。
**显式索引**（9）：idx_users_department_id、idx_roles_parent_role_id、idx_user_roles_user_id、idx_user_roles_role_id、
idx_departments_parent_id、idx_audit_logs_entity、idx_audit_logs_operated_at、idx_audit_logs_operator_id、idx_notifications_recipient_status。

### 5.3 外键清单（5 条 FK，须 PRAGMA foreign_keys=ON）
- users.department_id → departments(id) ON DELETE SET NULL（dept 删 → 用户归属解除，PRD-DEPT Q1①）
- user_roles.user_id → users(id) ON DELETE CASCADE
- user_roles.role_id → roles(id) ON DELETE CASCADE
- roles.parent_role_id → roles(id) ON DELETE RESTRICT（ROLE_HAS_CHILDREN backstop）
- departments.parent_id → departments(id) ON DELETE RESTRICT（DEPT_HAS_CHILDREN backstop）
> audit_logs（operator_id/entity_id）与 notifications(recipient_id) 故意不 FK：append-only / 引用快照，被引用实体可能被删，须留存。

## 6. repository 改动方案（impl-writer 阶段，[advisory] 实现提示）

> 本阶段不改 repository。以下为 impl-writer 实现指引：每个方法列对应 SQL + Map→SQL 映射。接口签名严格不变（D2）。
> 通用模式：构造 `this.db = db` + 模块级 `this.stmts = { ... }`（prepare 一次）；查询用 `get()`(单行)/`all()`(多行)；
> 写入用 `run()`（看 `result.changes`）；约束冲突 try-catch 映射（§4）；行对象 `[Object: null prototype]` 须 `{...row}` 转普通对象（§11 #4）。

### 6.1 UserRepository
| 方法 | SQL | 备注 |
|------|-----|------|
| list | `SELECT * FROM users [WHERE status=?] ORDER BY rowid LIMIT ? OFFSET ?` + `SELECT COUNT(*) FROM users [WHERE status=?]` | 两查询（items+total），ORDER BY rowid 保插入序（AC-F3-4） |
| findById | `SELECT * FROM users WHERE id=?` | get()，undefined→undefined |
| findByIds | `SELECT * FROM users WHERE id IN (...) ORDER BY rowid` | all()；保插入序；IN 占位按 ids 长度展开 |
| findByEmail | `SELECT * FROM users WHERE email=?` | get() |
| insert | `INSERT INTO users (id,name,email,status,department_id,created_at,updated_at,version,password_hash) VALUES (?,?,?,?,?,?,?,?,?)` | run()；catch UNIQUE email → USER_EMAIL_DUPLICATE（§4） |
| updateStatus | `UPDATE users SET status=?, updated_at=?, version=version+1 WHERE id=? RETURNING *` | RETURNING 取更新行（D16 advisory）；无 RETURNING 则 UPDATE+SELECT |
| findByDepartmentId | `SELECT * FROM users WHERE department_id=? ORDER BY rowid` | all() |
| updateDepartmentId | `UPDATE users SET department_id=?, updated_at=?, version=version+1 WHERE id=? RETURNING *` | 同上；departmentId=null 时绑 NULL |

### 6.2 RoleRepository
| 方法 | SQL | 备注 |
|------|-----|------|
| (seed) | `INSERT OR IGNORE INTO roles (id,name,description,permission_codes,is_builtin,parent_role_id,created_at,version) VALUES (?,?,?,?,?,?,?,?)` | 构造内调用，UNIQUE name 触发 IGNORE（D7）；permission_codes=JSON.stringify(ALL_PERMISSION_CODES) |
| list | `SELECT * FROM roles ORDER BY rowid LIMIT ? OFFSET ?` + COUNT | |
| findById / findByName | `SELECT * FROM roles WHERE id=?` / `WHERE name=?` | get() |
| insert | `INSERT INTO roles (...) VALUES (...)` | permission_codes JSON；catch UNIQUE name → ROLE_NAME_DUPLICATE |
| update | SELECT 现有 → JS 合并 patch → `UPDATE roles SET name=?,description=?,permission_codes=?,is_builtin=?,parent_role_id=?,version=version+1 WHERE id=? RETURNING *` | Partial patch 用 read-merge-write（COALESCE 对 nullable parent_role_id 不适用） |
| findChildren | `SELECT * FROM roles WHERE parent_role_id=? ORDER BY rowid` | all() |
| delete | `DELETE FROM roles WHERE id=?` | changes===1；FK RESTRICT 防 children 漏删（backstop） |
| insertUserRole | `INSERT INTO user_roles (id,user_id,role_id,assigned_at) VALUES (?,?,?,?)` | catch UNIQUE(user_id,role_id) → USER_ROLE_ALREADY_ASSIGNED（§4） |
| findUserRolesByUser / byRole | `SELECT * FROM user_roles WHERE user_id=? ORDER BY rowid` / `WHERE role_id=?` | all() |
| existsUserRole | `SELECT 1 FROM user_roles WHERE user_id=? AND role_id=?` | get() !== undefined |
| findUserRole | `SELECT * FROM user_roles WHERE user_id=? AND role_id=?` | get() |
| deleteUserRole | `DELETE FROM user_roles WHERE user_id=? AND role_id=?` | changes===1 |

### 6.3 DepartmentRepository
| 方法 | SQL | 备注 |
|------|-----|------|
| list | `SELECT * FROM departments ORDER BY rowid` | all() |
| findById | `SELECT * FROM departments WHERE id=?` | get() |
| findByParent | `SELECT * FROM departments WHERE parent_id IS ? ORDER BY rowid` | parentId=null 时 `IS NULL`（=NULL 不匹配 null，须 IS）；可分支两 SQL 或用 `parent_id IS ?`+绑 null |
| insert | `INSERT INTO departments (id,name,parent_id,created_at) VALUES (?,?,?,?)` | 无 UNIQUE 约束（同父唯一 service 层 existsByNameUnderParent 裁决，advisory 既有） |
| delete | `DELETE FROM departments WHERE id=?` | changes===1；FK RESTRICT 防 children 漏删 |
| existsByNameUnderParent | `SELECT 1 FROM departments WHERE name=? AND parent_id IS ?` | get()（parent_id null 用 IS） |
| computeDepth | `SELECT parent_id FROM departments WHERE id=?` 逐层向上 | 循环 SELECT 沿 parent_id 链；与内存版同算法（不变签名） |

### 6.4 AuditLogRepository（append-only）
| 方法 | SQL | 备注 |
|------|-----|------|
| insert | `INSERT INTO audit_logs (id,operator_id,operator_name,entity_type,entity_id,action,operated_at,"before","after",created_at) VALUES (?,?,?,?,?,?,?,?,?,?)` | before/after=JSON.stringify（D14），双引号包裹列名（§11#3） |
| list | `SELECT * FROM audit_logs WHERE (<过滤>) ORDER BY operated_at DESC LIMIT ? OFFSET ?` + `SELECT COUNT(*) FROM audit_logs WHERE (<过滤>)` | 过滤维度：operated_from/operated_to（闭区间）/operator_id/entity_type；DESC 倒序 |
| listAll | `SELECT * FROM audit_logs WHERE (<过滤>)` | 无分页无排序；过滤含 action（listAll 独有）；before/after 读出 JSON.parse |
> append-only 编译期保障保留：不暴露 update/delete 方法（既有约束，DB 实现亦不增）。

### 6.5 NotificationRepository
| 方法 | SQL | 备注 |
|------|-----|------|
| findById | `SELECT * FROM notifications WHERE id=?` | get() |
| insert | `INSERT INTO notifications (id,title,content,recipient_id,status,created_at,updated_at,sent_at,read_at,version) VALUES (?,?,?,?,?,?,?,?,?,?)` | sent_at/read_at 绑 null |
| update | SELECT 现有 → JS 合并 patch → `UPDATE notifications SET title=?,content=?,recipient_id=?,updated_at=?,version=version+1 WHERE id=? RETURNING *` | read-merge-write（Partial） |
| updateStatusAndSentAt | `UPDATE notifications SET status='sent', sent_at=?, updated_at=?, version=version+1 WHERE id=? RETURNING *` | |
| updateStatusAndReadAt | `UPDATE notifications SET status='read', read_at=?, updated_at=?, version=version+1 WHERE id=? RETURNING *` | |
| delete | `DELETE FROM notifications WHERE id=?` | changes===1 |
| list | `SELECT * FROM notifications [WHERE status=?] ORDER BY rowid LIMIT ? OFFSET ?` + COUNT | |

### 6.6 TokenBlacklistRepository
| 方法 | SQL | 备注 |
|------|-----|------|
| add | `INSERT OR IGNORE INTO token_blacklist (token, revoked_at) VALUES (?,?)` | INSERT OR IGNORE 幂等（PK token 去重）；revoked_at=now() |
| has | `SELECT 1 FROM token_blacklist WHERE token=?` | get() !== undefined |

## 7. server.ts 改动（impl-writer 阶段，[advisory] 实现提示）

> 本阶段不改 server.ts。以下为 impl-writer 实现指引。server.ts 为工程脚手架（layerOf 返回 null，不受 ARCH-001 约束）。

1. **建连接**（D1/D12/D15）：模块级
   ```ts
   import { DatabaseSync } from 'node:sqlite';
   import { readFileSync } from 'node:fs';
   const dbPath = process.env.DB_PATH ?? './data/admin.db';
   fs.mkdirSync(dirname(dbPath), { recursive: true });  // 缺省路径建父目录
   const db = new DatabaseSync(dbPath);
   db.exec('PRAGMA foreign_keys=ON');
   db.exec(readFileSync(new URL('./db/schema.sql', import.meta.url), 'utf8'));  // DDL 幂等建表
   ```
2. **repository 实例化注入 db**（D13）：`new UserRepository(db)` / `new RoleRepository(db)` / ... / `new TokenBlacklistRepository(db)`（6 处，L76~L82）。
3. **seed 改 INSERT OR IGNORE**（D7）：`seedDemoData()` 的 admin/alice 用户 insert 改 `INSERT OR IGNORE INTO users ...`（直连 db，
   绕过 userRepo.insert 的 UNIQUE→USER_EMAIL_DUPLICATE 映射，因 seed 期望静默幂等），或保留 `findByEmail` 守卫（亦幂等，二选一 [advisory]）。
4. **DB 路径 env**（D12）：启动 banner 可补 `db: ${dbPath}` 提示。
5. **shutdown**：`process.on('SIGINT', ...)` 内补 `db.close()`（advisory，确保文件刷盘）。

## 8. 实现提示（新增 db 模块 + 事务 helper，impl-writer 阶段，全 `[advisory]`）

> 本阶段不改代码。以下为 impl-writer 实现指引（[advisory]，可按实际调整并反向同步）。

- **`apps/api/src/db/connection.ts`**（新增）：`createDb(path?: string): DatabaseSync` 封装建连接 + PRAGMA foreign_keys=ON + 执行 DDL。
  生产用 `process.env.DB_PATH`；测试用 `:memory:`（传参或独立 `createTestDb()`）。
- **`apps/api/src/db/schema.sql`**（本轮已产）：由 connection.ts `readFileSync` 读取 `db.exec`。
- **`apps/api/src/db/transaction.ts`**（新增，D8）：`withTransaction<T>(db, fn: () => T): T`
  ```ts
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  ```
  TransferService.transfer 用其包裹 A/B/C（§3.1）。注意：嵌套调用 service 方法（deptService/roleService）共享同一 db 连接，
  事务在连接级别生效（node:sqlite 单连接同步，无连接池语义）。
  > [advisory] 偏离 §8 原提示（impl-writer 反向同步，REVIEW-PERSIST-001 blocker #2）：原提示 fn 为同步闭包 `() => T`，但 TransferService.transfer 的 A/B/C 经 deptService/roleService 调用，service 方法声明为 async（返回 Promise），无法在同步闭包内 await。实现加重载支持 `() => T` 与 `() => Promise<T>` 两种形态：异步 fn 时 `result.then(COMMIT, ROLLBACK)`，事务跨越 await 边界（node:sqlite 单连接同步，事务在连接级生效，await 期间连接不被其他操作抢占，安全）。
- **repository 构造**：`constructor(db: DatabaseSync)`，构造时 `this.stmts = { findById: db.prepare(...), ... }` 复用 PreparedStatement。
- **行对象转普通对象**：`get()`/`all()` 返回 `[Object: null prototype]`，须 `{...row}` 转普通对象再返回（避免下游 `Object.keys`/展开异常，§11 #4）。
- **is_builtin 转换**：读 `Boolean(row.is_builtin)`，写 `bool ? 1 : 0`（D16）。
- **复合字段**：读写 permission_codes/before/after 经 JSON.stringify/parse（D14）。

## 9. ARCH-001 闭合论证（本轮核心）

**论点**：repository 接口签名不变（D2）+ Ctx 接口不变（呼应 R11）→ service / router / domain / contracts 零变更，
仅 repository 内部实现（Map→SQL）+ server.ts 装配 + 新增 db 模块变更。

**逐层论证**：
- **contracts**：本轮**零改动**（无新 schema / 无新错误码 / 无枚举扩展，已就绪）。contracts 是 SSOT，DDL 反向对齐它（§5）。
- **domain**：纯函数（状态机 / 常量 / 脱敏 / WriteResult），无存储依赖 → 零变更。computeDepth 算法不变（仅从 DB SELECT 链路推导）。
- **repository**：40 个公开方法签名**逐字不变**（§1，D2）。内部 Map→SQL（§6）。构造签名变 `+db`（D13）——但 service 调用的是方法不是构造，
  service 不感知 db。约束映射在 repository 内部完成（§4），抛 `AppError` 与内存版语义一致。
- **service**：调用 repository 方法签名不变 → service 代码零变更。TransferService.transfer 的补偿闭包可能需幂等调整（§3.2，[advisory]），
  但 transfer 方法签名 / 返回 WriteResult / 错误码语义不变 → service 层测试行为等价（AC-F3-3）。
  > [advisory] 偏离 §9 原论证（impl-writer 反向同步，REVIEW-PERSIST-001 blocker #3）：原论证写"service 代码零变更"，实际 TransferService 构造加第 7 参数 `db: DatabaseSync`（用于 withTransaction 包裹 A/B/C）。判定：**非 ARCH-001 违规**——①db infra 不属四层之一（layerOf 返回 null），service→db 非 reverse dependency；②transfer 公开方法签名不变（D2 闭合核心）；③D8 事务需求驱动。但 service 构造签名变更是"换 DB 影响 service"的体现，须显式标注。impl-writer 还修复 2 个 service 内部 bug（NotificationService.update undefined 传参 + DepartmentService.assignUserDepartment password_hash 泄露），均为"内存容忍 sloppy，DB 暴露"的内部逻辑修复，非公开签名变更。
- **router**：不感知存储（调 service），零变更。procedure 类型 `Procedure<I, Ctx>` 复用。
- **Ctx 接口**（context.ts）：绝对不变（呼应 R11 ARCH-001 闭合锚点）。buildCtx 来源不变（仍 Bearer 验签）。
- **唯一变更层**：repository 内部实现 + server.ts（db 装配 + seed + DDL）+ 新增 db 模块（connection/transaction/schema.sql）。
  server.ts 为工程脚手架（layerOf=null，不受 ARCH-001 反向依赖约束）。

**结论**：ARCH-001 闭合 —— 持久化机制是 repository 内部 + 工程脚手架层职责，不污染 domain/service/router/contracts 四层。
repository 方法签名不变是闭合的契约锚点。与 R11"换鉴权来源不动四层"呼应，标志 MVP 工作流验证收官。

## 10. 受影响测试清单（AI-006 两类标注 + ①类隐式影响）

> 严格遵守 AI-006：①类 contracts 联动（grep 命中 + 隐式子类）+ ②类 既有签名/行为变更驱动（手动分析 + grep），缺一记 blocker。
> 本轮 contracts/errors **零改动**，故 ①类显式 = 零；重点在 ①类隐式 + ②类（构造注入）。

### ① 类：contracts 联动驱动

**①类显式（grep 命中 contracts 符号）= 零**：本轮不改 contracts（无 schema/错误码/枚举扩展）。grep `permissionCodeSchema |
errorCodeSchema | userSchema | auditLogSchema | notificationSchema` 在 `apps/api/test/` 的引用点全部**零影响**
（被引符号未变）。`role.test.ts:133` 的 `expect(ALL_PERMISSION_CODES).toEqual([...permissionCodeSchema.options])` 全集断言
—— permissionCodeSchema 未变，断言仍通过。

**①类隐式（repository 内部实现全改，是否影响既有测试对内部状态的断言）= 零**：
grep `apps/api/test/**` 中直接断言 repository 内部状态的模式（`.store` / `.logs` / `.roles` / `.userRoles` / `Map.size` / `.size`）：
- 仅命中 2 处 `new Set(...)`（`audit-embedding.test.ts:561,598`），均作用于 **公开方法** `auditRepo.listAll()` 的返回值
  （`new Set(listAll().map(...))`），非访问内部 `logs` 字段。
- **结论**：既有测试全部经 repository 公开方法断言，**无人断言内部 Map/Set/array 状态** → ①类隐式影响 = 零。
  repository 内部 Map→SQL 替换对既有测试透明（AC-F3-3 行为等价，AC-F6-2 零破坏）。

> test-writer 须反向核实：若发现清单外有断言 repository 内部状态的测试点，显式列出差异并修正（AI-006 要求）。

### ② 类：既有签名/行为变更驱动（构造签名 `new XxxRepository()` → `new XxxRepository(db)`，D13）

repository **方法签名不变**（D2）→ service 层测试断言零影响。但**实例化方式变**（构造接收 db）→ 所有 `new XxxRepository()`
调用点须改 + spawn 测试须配 DB env。

**②-A in-process 测试（直接 `new XxxRepository()`，须改 setup 注入 :memory: db）—— 15 文件：**

| # | 文件 | 命中（`new XxxRepository()` 调用 repo 类型） | 影响判定 | 需改的点 |
|---|------|------|----------|----------|
| 1 | `user.test.ts` | UserRepository | 须改 | setup 建 :memory: db + DDL，`new UserRepository(db)` |
| 2 | `role.test.ts` | RoleRepository×9, UserRepository×2 | 须改 | 同上；RoleRepository 构造仍 seed admin（INSERT OR IGNORE） |
| 3 | `dept.test.ts` | DepartmentRepository×10, UserRepository×2 | 须改 | 同上 |
| 4 | `notification.test.ts` | UserRepository, NotificationRepository | 须改 | 同上 |
| 5 | `audit.test.ts` | AuditLogRepository×12 | 须改 | 同上 |
| 6 | `report.test.ts` | AuditLogRepository | 须改 | 同上 |
| 7 | `transfer.test.ts` | UserRepository×3, RoleRepository×3, DepartmentRepository×3 | 须改 | 多 repo 须共享同一 :memory: db（transfer 跨 repo） |
| 8 | `optimistic-locking.test.ts` | UserRepository×3, RoleRepository, NotificationRepository | 须改 | 同上 |
| 9 | `etag-caching.test.ts` | UserRepository×5, RoleRepository, NotificationRepository×2 | 须改 | 同上 |
| 10 | `auth.test.ts` | UserRepository, AuditLogRepository, TokenBlacklistRepository | 须改 | 同上（含 TokenBlacklistRepository(db)） |
| 11 | `role-inheritance.test.ts` | RoleRepository, UserRepository | 须改 | 同上 |
| 12 | `audit-embedding.test.ts` | AuditLogRepository×2, UserRepository×2, RoleRepository, DepartmentRepository, NotificationRepository | 须改 | 多 repo 共享 db |
| 13 | `notification-embedding.test.ts` | AuditLogRepository×2, UserRepository×2, NotificationRepository×2 | 须改 | 同上 |
| 14 | `transfer-embedding.test.ts` | UserRepository×3, RoleRepository×3, DepartmentRepository×3, AuditLogRepository×3 | 须改 | 同上 |
| 15 | `role-inheritance-embedding.test.ts` | RoleRepository, UserRepository, AuditLogRepository | 须改 | 同上 |

> 15 文件均**仅改 setup**（建 :memory: db + DDL + 注入构造），**不改断言**（方法签名不变，AC-F3-3 行为等价）。
> 推荐抽 `createTestDb()` helper（connection.ts，§8）复用：`const db = createTestDb(); const repo = new UserRepository(db);`。
> 多 repo 测试（transfer/audit-embedding 等）须**共享同一 db 实例**（外键 + 跨 repo 查询一致性）。

**②-B spawn 端到端测试（spawn server.ts，须配 DB_PATH 临时文件）—— 3 文件：**

| # | 文件 | 命中 | 影响判定 | 需改的点 |
|---|------|------|----------|----------|
| 16 | `auth-embedding.test.ts` | `spawn('npx',['tsx','apps/api/src/server.ts'])` | 须改 | spawn env 加 `DB_PATH=<临时文件>`（AC-F6-3，验证持久化语义非 :memory:）；afterAll 清理临时文件 |
| 17 | `etag-caching-embedding.test.ts` | 同上 | 须改 | 同上 |
| 18 | `optimistic-locking-embedding.test.ts` | 同上 | 须改 | 同上 |

> spawn 测试用临时文件 DB（非 :memory:），验证"重启数据不丢"持久化语义（AC-F6-3）。每测试用唯一临时路径（如 `os.tmpdir()+/test-<pid>-<random>.db`），
> afterAll 删除。注：auth-embedding 的 AC-F5-1/F5-3（seed 幂等 + 持久化）依赖文件 DB 才能验证"重启 admin 仍在"。

**②类小结**：**15 文件改 setup 注入 db** + **3 文件 spawn 配 DB_PATH** + **server.ts 6 处 `new XxxRepository(db)`**（§7）。
**零断言改动**（方法签名不变）。service/router/domain/contracts 测试的行为断言全部等价（AC-F6-2）。

### ③ 类：新增测试（impl/test-writer 阶段）
DB 持久化专属测试（`persist.test.ts` / `persist-embedding.test.ts`，端到端 AI-007 验收）：
- **重启持久化**（AC-F1-2 / AC-F7-3）：写数据 → 关闭 db → 重开同路径 → 数据仍在（文件 DB）。
- **DDL 幂等**（AC-F2-1）：连续两次 `db.exec(schemaSql)` 不报错；表/索引齐全。
- **测试隔离**（AC-F6-1）：两 :memory: db 实例数据互不串。
- **事务回滚**（AC-F4-1 / AC-F4-2）：transfer 中间步失败 → ROLLBACK → 无部分写入；全成功 → COMMIT → 持久化。
- **约束映射**（AC-F5-1 / AC-F5-3）：重复 email → USER_EMAIL_DUPLICATE（409，无 SQLite 内部信息）；重复 role name → ROLE_NAME_DUPLICATE；
  重复分配 → USER_ROLE_ALREADY_ASSIGNED。
- **seed 幂等**（AC-F7-1 / AC-F7-2）：空库启动 seed admin；再启动不重复；seed 后可 login。
- 既有 778 测试行为等价（AC-F6-2），新测试为补充（非替代）。

## 11. advisory 偏离预判（参考 R11 / R10 S-2 教训）

> 提前标注可能偏离项，impl-writer 偏离时按 AI-003 流程反向同步。已实测项标注「实测」。

1. **R7 补偿闭包幂等性**（D8，§3.2，**高概率**）：DB ROLLBACK 后运行补偿闭包，B 补偿 `insertUserRole` 会命中 UNIQUE
   → 假性 TRANSFER_COMPENSATION_FAILED。impl-writer 须让补偿闭包幂等（catch USER_ROLE_ALREADY_ASSIGNED 视为已恢复），
   或改为"仅 ROLLBACK 失败时运行补偿"。**属 service 层 impl 改动**（transfer.ts），非本阶段。预判偏离概率：高（必须处理）。
2. **约束映射须解析 `e.message`**（D10，**实测**）：node:sqlite 的 `e.code` 对 UNIQUE/FK/NOT NULL 均为通用 `'ERR_SQLITE_ERROR'`，
   `e.errcode`/`e.errstr` 亦无可靠区分（实测）。须 `String(e.message).startsWith('UNIQUE constraint failed:')` 等解析消息。
   FK 消息 `"FOREIGN KEY constraint failed"` **无表/列信息** → 无法精确映射，故 FK 走 500 INTERNAL（service 前置校验为主，§4）。
3. **`before`/`after` 列名是 SQLite 关键字**（D14，§5，**实测**）：`BEFORE`/`AFTER` 是 trigger 关键字。DDL 与所有 SQL 须用双引号
   `"before"`/`"after"` 包裹。实测 `INSERT ... "before","after" ...` + `SELECT "before","after"` 读写正常。impl-writer 须一致引号。
4. **`get()`/`all()` 返回 `[Object: null prototype]`**（**实测**，R11 式 advisory）：行对象原型为 null，
   须 `{...row}` 转普通对象再返回（避免 `Object.keys` / JSON.stringify / 下游展开异常）。PRAGMA 返回亦同（实测 `foreign_keys` 行 proto null）。
5. **PRAGMA foreign_keys 默认 OFF**（D15，**实测**）：须连接后立即 `db.exec('PRAGMA foreign_keys=ON')`，否则 FK 形同虚设。
   且 PRAGMA 是连接级（每连接须设）；:memory: 每测试新连接须重设。
   > [advisory] 实测修正（test-writer 反向同步，REVIEW-PERSIST-001 blocker #4）：Node v24.15.0 的 node:sqlite **默认 foreign_keys=1（ON）**（SQLite 默认值由编译期 SQLITE_DEFAULT_FOREIGN_KEYS 决定，Node 内置构建置 1），与原预判"默认 OFF"不一致。D15 显式 `PRAGMA foreign_keys=ON` 仍正确（已 ON 时幂等无害），impl-writer 无需调整实现。test-writer 在 persist.test.ts:371 实测记录。
6. **`UPDATE ... RETURNING *` 可用**（D16，**实测**）：Node 24 bundled SQLite ≥3.35 支持 RETURNING。
   impl-writer 可用 RETURNING 一步取更新行；若顾虑兼容可回退 UPDATE+SELECT 两步（须反向同步）。
7. **`INSERT OR IGNORE` 与 repository.insert 的 UNIQUE 映射冲突**（D7，§6/§7）：repository.insert 须抛 USER_EMAIL_DUPLICATE（业务路径），
   但 seed 须静默幂等。故 seed **不走 repository.insert**，直连 `db.prepare('INSERT OR IGNORE ...').run(...)`（server.ts / RoleRepository 构造内，
   工程脚手架层）。impl-writer 勿让 seed 复用 repository.insert（否则 seed 命中已存在抛 409）。
8. **多 repo 须共享同一 db 连接**（D8/D13，§10 ②-A）：transfer / embedding 等跨 repo 测试，多个 repository 须注入**同一** :memory: db
   实例（否则外键 + 跨 repo 查询失败）。`createTestDb()` 返回单实例传给所有 repo。
9. **缺省 DB 路径父目录**（D12，§7）：`./data/admin.db` 缺省时须 `fs.mkdirSync('./data',{recursive:true})`，否则 `DatabaseSync` 抛目录不存在。
10. **`findByParent` 的 NULL 比较**（§6.3）：SQL `parent_id = NULL` 永假，须 `parent_id IS NULL`（parentId=null 时）或 `parent_id = ?`（非 null）。
    impl-writer 须分支或用 `parent_id IS ?`（SQLite `IS` 对 null/非 null 均工作）。
11. **表数 7 vs PRD 草图 8**（§5.0）：本 Spec 按 AC-F2-2 [约束] omit role_inheritance（contracts 无对应 schema，RoleRepository 用单继承 parent_role_id）。
    非偏离 [约束]（AC-F2-2 要求 1:1 无多余，omit 多余表是合规）。若需 8 表须先扩 contracts（本轮 out of scope）。预判：父 agent 须确认此校正。
12. **DDL 字段名校正 6 处**（§5.0）：PRD 草图 vs contracts 不一致（departments 多 depth/updated_at/version；audit_logs before_state→before + 补 created_at；
    roles 补 description/parent_role_id 去 updated_at；user_roles 补 id；notifications 补 sent_at/read_at）。按 AC-F2-2 以 contracts 为准，非偏离。
