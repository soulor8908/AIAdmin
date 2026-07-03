-- apps/api/src/db/schema.sql —— 持久化层 DDL（TECH-PERSIST-001 §5）
--
-- 派生自 PRD-PERSIST-001（status=decided，Q1=③node:sqlite / Q3=①启动建表 / Q9=①基础索引 / Q11=①snake_case透传）。
-- 由 server.ts 启动时 db.exec() 幂等执行（CREATE TABLE IF NOT EXISTS，AC-F2-1）。
--
-- [约束] AC-F2-2：DDL 表/字段须与 packages/contracts 的 entitySchema 1:1 对齐（无字段遗漏或多余）。
--         逐表字段对齐表见 docs/spec/persist.tech.md §5。
-- [约束] Q11 snake_case 透传：DB 列名 = contracts 字段名（department_id / created_at / parent_role_id ...），无命名转换层。
-- [约束] D15：外键须在连接时 PRAGMA foreign_keys=ON 方生效（SQLite 默认 OFF）。
--
-- 数据类型映射（Q11 / TECH-PERSIST-001 D16）：
--   - uuid / datetime / enum / status / 文本 → TEXT
--   - version / is_builtin（boolean）→ INTEGER（is_builtin 存 0/1，repository 层 Boolean 转换）
--   - 可空字段（department_id / parent_id / parent_role_id / sent_at / read_at）→ TEXT NULL
--   - 复合字段（roles.permission_codes 数组 / audit_logs.before / audit_logs.after 结构化变更快照数组）
--     → TEXT 存 JSON 字符串，repository 层 JSON.stringify/parse 序列化（D14）
--
-- ⚠ 关键校正（TECH-PERSIST-001 §5 / §11）—— PRD DDL 草图与 contracts SSOT 的不一致，按 AC-F2-2 以 contracts 为准：
--   1. role_inheritance 表：PRD 草图列此表，但 contracts roleSchema 用单继承（parent_role_id 直接挂在 role 行上），
--      无 roleInheritanceSchema 且 RoleRepository 无任何 role_inheritance 代码路径（findChildren/update/setParent
--      均操作 role.parent_role_id）。按 AC-F2-2「无多余」omit 该表 → 实际 7 张表（非 8）。
--   2. departments 表：PRD 草图多列 depth/updated_at/version，contracts departmentSchema 仅 id/name/parent_id/created_at
--      （depth 由 computeDepth 动态推导不存储；dept 不可编辑无 version/updated_at）。按 AC-F2-2 仅留 4 列。
--   3. audit_logs 表：PRD 草图用 before_state/after_state 且漏 created_at；contracts auditLogSchema 字段为
--      before/after（非空数组）+ operated_at + created_at。按 AC-F2-2 列名用 before/after + 含 created_at。
--      before/after 是 SQLite 关键字（BEFORE/AFTER trigger），DDL 与所有 SQL 中须用双引号 "before"/"after" 包裹（§11 advisory）。
--   4. roles 表：PRD 草图漏 description 与 parent_role_id、误加 updated_at；contracts roleSchema 含
--      id/name/description/permission_codes/is_builtin/parent_role_id/created_at/version（8 列，无 updated_at）。按 contracts。
--   5. user_roles 表：PRD 草图以 (user_id, role_id) 为 PK 且漏 id；contracts userRoleSchema 含 id（uuid），
--      业务唯一性为 (user_id, role_id)。按 contracts：id 为 PK，(user_id, role_id) 为 UNIQUE。
--   6. notifications 表：PRD 草图漏 sent_at/read_at；contracts notificationSchema 含 sent_at/read_at（nullable）。按 contracts。
--
-- token_blacklist 表无对应 entitySchema（TokenBlacklistRepository 仅 add(token)/has(token)，infra 表），
-- 按 PRD 草图 token(PK) + revoked_at 落地（AC-F2-2 无 schema 可对齐，不构成「多余」）。
-- ======================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. users —— 对齐 contracts.userEntitySchema（含 password_hash，TECH-AUTH-001 D5 存储实体）
--    字段：id / name / email / status / department_id / created_at / updated_at / version / password_hash
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             TEXT    PRIMARY KEY,                       -- uuid
  name           TEXT    NOT NULL,
  email          TEXT    NOT NULL UNIQUE,                   -- UNIQUE → USER_EMAIL_DUPLICATE（AC-F5-1）
  status         TEXT    NOT NULL,                           -- 'active' | 'disabled'（userStatusSchema）
  department_id  TEXT    NULL,                              -- 跨域联动（TECH-DEPT-001），null=未归属
  created_at     TEXT    NOT NULL,                           -- ISO datetime
  updated_at     TEXT    NOT NULL,                           -- ISO datetime
  version        INTEGER NOT NULL DEFAULT 0,                -- 乐观锁版本号（TECH-OPTIMISTIC-LOCKING-001 D1）
  password_hash  TEXT    NOT NULL,                           -- scrypt salt.hash（TECH-AUTH-001 D2），输出前剥离
  FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL
    -- 部门删除 → 用户归属解除（PRD-DEPT-001 Q1①）；service 层亦可手动解除（冗余无害，双保障）
);

CREATE INDEX IF NOT EXISTS idx_users_department_id ON users (department_id);  -- findByDepartmentId + FK


-- ---------------------------------------------------------------------------------------------------
-- 2. roles —— 对齐 contracts.roleSchema
--    字段：id / name / description / permission_codes / is_builtin / parent_role_id / created_at / version
--    说明：单继承经 parent_role_id（TECH-ROLE-INHERITANCE-001 D1）；无独立 role_inheritance 表（见上方校正1）
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id                TEXT    PRIMARY KEY,                    -- uuid
  name              TEXT    NOT NULL UNIQUE,                 -- 全局唯一（Q3）→ ROLE_NAME_DUPLICATE（AC-F5-1）
  description       TEXT    NOT NULL,                        -- 长度 ≤512（roleSchema）
  permission_codes  TEXT    NOT NULL,                        -- JSON 数组（permissionCodeSchema[]），repository 序列化（D14）
  is_builtin        INTEGER NOT NULL,                        -- 0/1，repository 层 Boolean 转换（D16）
  parent_role_id    TEXT    NULL,                            -- 单继承父角色（null=根角色，admin 恒 null）
  created_at        TEXT    NOT NULL,                        -- ISO datetime
  version           INTEGER NOT NULL DEFAULT 0,             -- 乐观锁（setParent/unsetParent +1；builtin admin 恒 0）
  FOREIGN KEY (parent_role_id) REFERENCES roles (id) ON DELETE RESTRICT
    -- 删除守卫 ROLE_HAS_CHILDREN 的 DB 层 backstop（service 层先拦；FK 防漏）
);

CREATE INDEX IF NOT EXISTS idx_roles_parent_role_id ON roles (parent_role_id);  -- findChildren + FK


-- ---------------------------------------------------------------------------------------------------
-- 3. user_roles —— 对齐 contracts.userRoleSchema
--    字段：id / user_id / role_id / assigned_at
--    业务唯一：(user_id, role_id) → UNIQUE → USER_ROLE_ALREADY_ASSIGNED（AC-F5-1）
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_roles (
  id           TEXT    PRIMARY KEY,                          -- uuid（userRoleSchema.id）
  user_id      TEXT    NOT NULL,
  role_id      TEXT    NOT NULL,
  assigned_at  TEXT    NOT NULL,                             -- ISO datetime
  UNIQUE (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles (user_id);  -- findUserRolesByUser
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles (role_id);  -- findUserRolesByRole + delete 守卫


-- ---------------------------------------------------------------------------------------------------
-- 4. departments —— 对齐 contracts.departmentSchema
--    字段：id / name / parent_id / created_at（仅 4 列；depth 动态推导，无 version/updated_at）
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id          TEXT    PRIMARY KEY,                           -- uuid
  name        TEXT    NOT NULL,                              -- 同父下唯一（service 层 existsByNameUnderParent → DEPT_NAME_DUPLICATE）
  parent_id   TEXT    NULL,                                  -- null=根部门（第 1 层）；自引用
  created_at  TEXT    NOT NULL,                              -- ISO datetime
  FOREIGN KEY (parent_id) REFERENCES departments (id) ON DELETE RESTRICT
    -- 删除守卫 DEPT_HAS_CHILDREN 的 DB 层 backstop（service 层先拦；FK 防漏）
);

CREATE INDEX IF NOT EXISTS idx_departments_parent_id ON departments (parent_id);  -- findByParent + computeDepth + FK


-- ---------------------------------------------------------------------------------------------------
-- 5. audit_logs —— 对齐 contracts.auditLogSchema（append-only，F4）
--    字段：id / operator_id / operator_name / entity_type / entity_id / action / operated_at / before / after / created_at
--    注意：before/after 为 SQLite 关键字，DDL 与 SQL 须用双引号 "before"/"after" 包裹（§11 advisory）。
--    无外键：operator_id/entity_id 为快照引用（append-only 不可变，被引用实体可能被删，日志须留存）。
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id             TEXT    NOT NULL,                           -- uuid（append-only 允许重复 id，无 PRIMARY KEY，F4）
  operator_id    TEXT    NOT NULL,                           -- uuid（操作者快照，不 FK users）
  operator_name  TEXT    NOT NULL,                           -- 操作者姓名快照（防用户改名脱节）
  entity_type    TEXT    NOT NULL,                           -- 'user'|'role'|'dept'|'notification'|'auth'
  entity_id      TEXT    NOT NULL,                           -- uuid（目标实体快照，不 FK）
  action         TEXT    NOT NULL,                           -- 'create'|'update'|'delete'|'login'|'login_failed'|'logout'
  operated_at    TEXT    NOT NULL,                           -- ISO datetime（list 倒序排序键）
  "before"       TEXT    NOT NULL,                           -- JSON 数组 changeField[]（create 时 "[]"，D14 序列化）
  "after"        TEXT    NOT NULL,                           -- JSON 数组 changeField[]（delete 时 "[]"，D14 序列化）
  created_at     TEXT    NOT NULL                            -- ISO datetime（保留期清理任务用，AUDIT_LOG_RETENTION_DAYS）
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity     ON audit_logs (entity_type, entity_id);  -- list 过滤 + 联动查询
CREATE INDEX IF NOT EXISTS idx_audit_logs_operated_at ON audit_logs (operated_at);            -- list 倒序 + 时间范围过滤
CREATE INDEX IF NOT EXISTS idx_audit_logs_operator_id ON audit_logs (operator_id);            -- list 过滤


-- ---------------------------------------------------------------------------------------------------
-- 6. notifications —— 对齐 contracts.notificationSchema
--    字段：id / title / content / recipient_id / status / created_at / updated_at / sent_at / read_at / version
--    无外键：recipient_id 为引用快照（service 层 send 时校验存在+active；收件人可能被删，通知须留存/可读）。
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT    PRIMARY KEY,                         -- uuid
  title         TEXT    NOT NULL,                            -- 1..128
  content       TEXT    NOT NULL,                            -- 1..4000
  recipient_id  TEXT    NOT NULL,                            -- uuid（不 FK users，send 时 service 校验）
  status        TEXT    NOT NULL,                            -- 'draft'|'sent'|'read'（notificationStatusSchema）
  created_at    TEXT    NOT NULL,                            -- ISO datetime
  updated_at    TEXT    NOT NULL,                            -- ISO datetime
  sent_at       TEXT    NULL,                                -- draft 态 null，send 时置非空
  read_at       TEXT    NULL,                                -- draft/sent 态 null，markRead 时置非空
  version       INTEGER NOT NULL DEFAULT 0                  -- 乐观锁（update/send/markRead/delete +1）
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_status ON notifications (recipient_id, status);  -- list 过滤


-- ---------------------------------------------------------------------------------------------------
-- 7. token_blacklist —— TokenBlacklistRepository 专用 infra 表（无 entitySchema，PRD 草图落地）
--    字段：token / revoked_at
--    说明：登出吊销黑名单（TECH-AUTH-001 D4），原内存 Set → DB 持久化（重启不丢）。
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS token_blacklist (
  token        TEXT    PRIMARY KEY,                          -- JWT-like 不透明 token 字符串
  revoked_at   TEXT    NOT NULL                              -- ISO datetime（登出时刻；未来 TTL 清理用，advisory）
);
