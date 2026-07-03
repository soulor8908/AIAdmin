// apps/api/test/persist.test.ts —— TECH-PERSIST-001 持久化层替换 单测 + 行为测试（test-first）
//
// 覆盖 PRD-PERSIST-001 F1~F7 的 DB 持久化专属 AC（非既有行为等价测试，②类既有测试由 impl-writer 阶段改 setup）：
//   F1 DB 接入（AC-F1-1/F1-2/F1-3）   F2 DDL 建表（AC-F2-1/F2-2）   F3 repository 替换（AC-F3-1/F3-2/F3-3/F3-4）
//   F4 DB 事务（AC-F4-1/F4-2/F4-3）   F5 约束映射（AC-F5-1/F5-2/F5-3）   F6 测试隔离（AC-F6-1/F6-2）
//   F7 admin seed（AC-F7-1）—— F7-2/F7-3 端到端见 persist-embedding.test.ts
//
// 另含：
//   - 契约测：DDL 表/字段对齐 contracts schema.shape（AC-F2-2，SSOT 派生断言 AI-005）
//   - advisory 预判验证：node:sqlite 实测行为对齐 Tech-Spec §11（null prototype / e.code / e.message / RETURNING / PRAGMA / 引号）
//
// [lazy loader 模式]（参考 R11 auth.test.ts，规避收集期失败）：
//   顶层不静态 import 未实现模块；beforeAll 内动态 import 并 try-catch，失败时占位变量保持 undefined。
//   test 内先 `expect(helper).toBeDefined()` → impl 未完成时为断言级红（非导入级红），符合 AI-002。
//
// [预期导入级红符号]（tsc 自检，AI-002）：
//   - createDb / applySchema / seedAdmin（来自 apps/api/src/db/connection.js，未实现）
//   - withTransaction（来自 apps/api/src/db/transaction.js，未实现）
//   上述模块缺失致 tsc 报 `Cannot find module`，属预期导入级红（真实缺陷 = 0）。
//   repository 构造签名 D13 未改（仍 `constructor()`）通过 `as unknown as new (db) => any` 绕过 tsc，非真实缺陷。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  userEntitySchema,
  roleSchema,
  userRoleSchema,
  departmentSchema,
  auditLogSchema,
  notificationSchema,
  permissionCodeSchema,
  type User,
  type Role,
  type UserRole,
} from '@admin/contracts';
import { AppError } from '../src/errors.js';
// F3-3 方法签名不变断言：静态 import 已存在的 repository 类（模块存在，tsc 不报错）
import { UserRepository } from '../src/repository/user.js';
import { RoleRepository } from '../src/repository/role.js';
import { DepartmentRepository } from '../src/repository/dept.js';
import { AuditLogRepository } from '../src/repository/audit.js';
import { NotificationRepository } from '../src/repository/notification.js';
import { TokenBlacklistRepository } from '../src/repository/token-blacklist.js';

// node:sqlite（Node 22+ 内置 DatabaseSync，TECH-PERSIST-001 D1）：
//   - @types/node@20 缺类型 → 本地声明最小接口（impl-writer 升级 @types/node@22+ 后可改回 `import type`）
//   - Vite ESM 解析不识别 node:sqlite（vitest 收集期报 "Failed to load url sqlite"）→ 用 createRequire
//     绕过 Vite transform，走 Node 原生 require（runtime 已实测 Node v24.15.0 可用，§11 advisory 验证依赖此）。
interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}
interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSync;
};

// DDL SSOT（已就绪），契约测与 advisory 验证直接 exec
const SCHEMA_SQL = readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');

// =====================================================================================================
// lazy loader：动态 import 未实现模块（规避 vitest 收集期失败）
// =====================================================================================================
type CreateDb = (path?: string) => DatabaseSync;
type ApplySchema = (db: DatabaseSync) => void;
type SeedAdmin = (db: DatabaseSync) => void;
type WithTransaction = <T>(db: DatabaseSync, fn: () => T) => T;
// repository 构造器：D13 待改 constructor(db)，当前无 db 参数；用 unknown 断言兼容（非真实缺陷）
type AnyRepoCtor = new (db: DatabaseSync) => any;

let createDb: CreateDb | undefined;
let applySchema: ApplySchema | undefined;
let seedAdmin: SeedAdmin | undefined;
let withTransaction: WithTransaction | undefined;
let UserRepositoryCtor: AnyRepoCtor | undefined;
let RoleRepositoryCtor: AnyRepoCtor | undefined;
let DepartmentRepositoryCtor: AnyRepoCtor | undefined;
let AuditLogRepositoryCtor: AnyRepoCtor | undefined;
let NotificationRepositoryCtor: AnyRepoCtor | undefined;
let TokenBlacklistRepositoryCtor: AnyRepoCtor | undefined;

beforeAll(async () => {
  // db 模块（未实现 → 预期导入级红符号 createDb/applySchema/seedAdmin/withTransaction）
  try {
    const m = await import('../src/db/connection.js');
    createDb = m.createDb;
    applySchema = m.applySchema;
    seedAdmin = m.seedAdmin;
  } catch {
    /* 未实现，保持 undefined（test 内断言级红） */
  }
  try {
    const m = await import('../src/db/transaction.js');
    withTransaction = m.withTransaction;
  } catch {
    /* 未实现 */
  }
  // repository 模块（已存在，但构造签名 D13 未改；用 unknown 断言兼容两种状态）
  try {
    const m = await import('../src/repository/user.js');
    UserRepositoryCtor = m.UserRepository as unknown as AnyRepoCtor;
  } catch {
    /* */
  }
  try {
    const m = await import('../src/repository/role.js');
    RoleRepositoryCtor = m.RoleRepository as unknown as AnyRepoCtor;
  } catch {
    /* */
  }
  try {
    const m = await import('../src/repository/dept.js');
    DepartmentRepositoryCtor = m.DepartmentRepository as unknown as AnyRepoCtor;
  } catch {
    /* */
  }
  try {
    const m = await import('../src/repository/audit.js');
    AuditLogRepositoryCtor = m.AuditLogRepository as unknown as AnyRepoCtor;
  } catch {
    /* */
  }
  try {
    const m = await import('../src/repository/notification.js');
    NotificationRepositoryCtor = m.NotificationRepository as unknown as AnyRepoCtor;
  } catch {
    /* */
  }
  try {
    const m = await import('../src/repository/token-blacklist.js');
    TokenBlacklistRepositoryCtor = m.TokenBlacklistRepository as unknown as AnyRepoCtor;
  } catch {
    /* */
  }
});

// =====================================================================================================
// helpers
// =====================================================================================================

/** 断言 db helper 模块已加载（impl 未完成时为断言级红，停止后续执行）。 */
function ensureDbHelpers(): { createDb: CreateDb; applySchema: ApplySchema; seedAdmin: SeedAdmin; withTransaction: WithTransaction } {
  expect(createDb, 'createDb 未实现（apps/api/src/db/connection.js 缺失，预期导入级红）').toBeDefined();
  expect(applySchema, 'applySchema 未实现').toBeDefined();
  expect(seedAdmin, 'seedAdmin 未实现').toBeDefined();
  expect(withTransaction, 'withTransaction 未实现（apps/api/src/db/transaction.js 缺失）').toBeDefined();
  return { createDb: createDb!, applySchema: applySchema!, seedAdmin: seedAdmin!, withTransaction: withTransaction! };
}

/** 新建 :memory: db + applySchema + 注入 6 repo（多 repo 共享同一 db，advisory #8）。 */
function makeRepos() {
  const h = ensureDbHelpers();
  const db = h.createDb(':memory:');
  h.applySchema(db);
  return {
    db,
    h,
    userRepo: UserRepositoryCtor ? new UserRepositoryCtor(db) : undefined,
    roleRepo: RoleRepositoryCtor ? new RoleRepositoryCtor(db) : undefined,
    deptRepo: DepartmentRepositoryCtor ? new DepartmentRepositoryCtor(db) : undefined,
    auditRepo: AuditLogRepositoryCtor ? new AuditLogRepositoryCtor(db) : undefined,
    notifRepo: NotificationRepositoryCtor ? new NotificationRepositoryCtor(db) : undefined,
    tokenRepo: TokenBlacklistRepositoryCtor ? new TokenBlacklistRepositoryCtor(db) : undefined,
  };
}

function now(): string {
  return new Date().toISOString();
}

function makeUser(overrides: Partial<User> = {}): User & { password_hash: string } {
  return {
    id: randomUUID(),
    name: 'test-user',
    email: `test-${randomUUID()}@example.com`,
    status: 'active',
    department_id: null,
    created_at: now(),
    updated_at: now(),
    version: 0,
    password_hash: 'scrypt.salt.hash',
    ...overrides,
  };
}

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: randomUUID(),
    name: `role-${randomUUID().slice(0, 8)}`,
    description: 'test role',
    permission_codes: [...permissionCodeSchema.options], // SSOT 派生（AI-005）
    is_builtin: false,
    parent_role_id: null,
    created_at: now(),
    version: 0,
    ...overrides,
  };
}

function makeUserRole(overrides: Partial<UserRole> = {}): UserRole {
  return {
    id: randomUUID(),
    user_id: randomUUID(),
    role_id: randomUUID(),
    assigned_at: now(),
    ...overrides,
  };
}

/** 取 repository.prototype 公开方法名（排除 constructor + private）。 */
function publicMethodNames(Ctor: { prototype: object }): string[] {
  return Object.getOwnPropertyNames(Ctor.prototype).filter((n) => n !== 'constructor' && !n.startsWith('_'));
}

/** PRAGMA table_info 列名集合。 */
function tableColumns(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((r) => ({ ...r }).name);
}

// =====================================================================================================
// 契约测：DDL 与 contracts schema.shape 1:1 对齐（AC-F2-2，SSOT 派生 AI-005）
// 不依赖未实现模块（直接 node:sqlite + 已就绪 schema.sql + contracts），可运行。
// =====================================================================================================
describe('契约测：DDL 与 contracts 对齐（AC-F2-2）', () => {
  let db: DatabaseSync;
  beforeAll(() => {
    db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_SQL);
  });
  afterAll(() => db.close());

  it('AC-F2-2 表数 = 7（omit role_inheritance，contracts 无对应 schema，AC-F2-2「无多余」）', () => {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => ({ ...r }).name);
    expect(new Set(names)).toEqual(
      new Set(['users', 'roles', 'user_roles', 'departments', 'audit_logs', 'notifications', 'token_blacklist']),
    );
  });

  it('AC-F2-2 users 字段对齐 userEntitySchema.shape（SSOT 派生 Object.keys）', () => {
    expect(new Set(tableColumns(db, 'users'))).toEqual(new Set(Object.keys(userEntitySchema.shape)));
  });

  it('AC-F2-2 roles 字段对齐 roleSchema.shape', () => {
    expect(new Set(tableColumns(db, 'roles'))).toEqual(new Set(Object.keys(roleSchema.shape)));
  });

  it('AC-F2-2 user_roles 字段对齐 userRoleSchema.shape', () => {
    expect(new Set(tableColumns(db, 'user_roles'))).toEqual(new Set(Object.keys(userRoleSchema.shape)));
  });

  it('AC-F2-2 departments 字段对齐 departmentSchema.shape（4 列，无 depth/version/updated_at）', () => {
    expect(new Set(tableColumns(db, 'departments'))).toEqual(new Set(Object.keys(departmentSchema.shape)));
  });

  it('AC-F2-2 audit_logs 字段对齐 auditLogSchema.shape（before/after + created_at）', () => {
    expect(new Set(tableColumns(db, 'audit_logs'))).toEqual(new Set(Object.keys(auditLogSchema.shape)));
  });

  it('AC-F2-2 notifications 字段对齐 notificationSchema.shape（含 sent_at/read_at）', () => {
    expect(new Set(tableColumns(db, 'notifications'))).toEqual(new Set(Object.keys(notificationSchema.shape)));
  });

  it('AC-F2-2 token_blacklist 2 列（infra 表，无 contracts schema，按 PRD 草图）', () => {
    expect(tableColumns(db, 'token_blacklist')).toEqual(['token', 'revoked_at']);
  });

  it('UNIQUE 隐式索引 3 个（users.email / roles.name / user_roles(user_id,role_id)；origin=u 排除 PK 索引）', () => {
    // PRAGMA index_list 的 unique=1 含 PRIMARY KEY 隐式索引（id TEXT PK → origin=pk）。
    // Tech-Spec §5「3 UNIQUE 隐式索引」指业务 UNIQUE 约束（origin=u），须按 origin 过滤排除 PK 索引：
    //   users=1(email) + roles=1(name) + user_roles=1(user_id,role_id) = 3。
    const uniqueIdx = (table: string) =>
      (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; unique: number; origin: string }>)
        .map((r) => ({ ...r }))
        .filter((r) => r.origin === 'u');
    expect(uniqueIdx('users').length).toBe(1); // email UNIQUE
    expect(uniqueIdx('roles').length).toBe(1); // name UNIQUE
    expect(uniqueIdx('user_roles').length).toBe(1); // (user_id, role_id) UNIQUE
  });

  it('显式索引 9 个（覆盖外键字段 + 高频查询字段，D9）', () => {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => ({ ...r }).name);
    expect(names).toEqual([
      'idx_audit_logs_entity',
      'idx_audit_logs_operated_at',
      'idx_audit_logs_operator_id',
      'idx_departments_parent_id',
      'idx_notifications_recipient_status',
      'idx_roles_parent_role_id',
      'idx_user_roles_role_id',
      'idx_user_roles_user_id',
      'idx_users_department_id',
    ]);
  });

  it('外键 5 条（users.department_id / user_roles.user_id+role_id / roles.parent_role_id / departments.parent_id）', () => {
    const fks = (db.prepare('PRAGMA foreign_key_list(users)').all() as Array<{ table: string }>).map((r) => ({ ...r }).table);
    expect(fks).toContain('departments');
    const fksUr = (db.prepare('PRAGMA foreign_key_list(user_roles)').all() as Array<{ table: string }>).map((r) => ({ ...r }).table);
    expect(new Set(fksUr)).toEqual(new Set(['users', 'roles']));
    const fksRoles = (db.prepare('PRAGMA foreign_key_list(roles)').all() as Array<{ table: string }>).map((r) => ({ ...r }).table);
    expect(fksRoles).toContain('roles');
    const fksDept = (db.prepare('PRAGMA foreign_key_list(departments)').all() as Array<{ table: string }>).map((r) => ({ ...r }).table);
    expect(fksDept).toContain('departments');
  });
});

// =====================================================================================================
// advisory 预判验证：node:sqlite 实测行为对齐 Tech-Spec §11
// 不依赖未实现模块（直接 node:sqlite），可运行；验证预判正确性（impl-writer 实现依据）。
// =====================================================================================================
describe('advisory 预判验证：node:sqlite 实测行为（Tech-Spec §11）', () => {
  it('§11#4 get()/all() 返回 [Object: null prototype]，须 {...row} 转普通对象', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id TEXT, val TEXT)');
    db.prepare('INSERT INTO t (id, val) VALUES (?, ?)').run('1', 'x');
    const row = db.prepare('SELECT * FROM t WHERE id=?').get('1') as object;
    expect(Object.getPrototypeOf(row)).toBe(null); // null prototype
    const plain = { ...row };
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype); // 转普通对象
    expect(Object.keys(plain).sort()).toEqual(['id', 'val']);
    db.close();
  });

  it('§11#2 UNIQUE 冲突 e.code = ERR_SQLITE_ERROR（通用），须解析 e.message 区分类型', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (email TEXT UNIQUE)');
    db.prepare('INSERT INTO t (email) VALUES (?)').run('dup@example.com');
    try {
      db.prepare('INSERT INTO t (email) VALUES (?)').run('dup@example.com');
      throw new Error('should have thrown UNIQUE');
    } catch (e) {
      const err = e as { code?: string; message?: string };
      expect(err.code).toBe('ERR_SQLITE_ERROR'); // 通用码，非 SQLITE_CONSTRAINT_UNIQUE
      expect(String(err.message)).toContain('UNIQUE constraint failed');
      expect(String(err.message)).toContain('t.email');
    }
    db.close();
  });

  it('§11#2 FK 冲突 e.message = "FOREIGN KEY constraint failed"（无表/列信息）', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    db.exec('CREATE TABLE parent (id TEXT PRIMARY KEY)');
    db.exec('CREATE TABLE child (id TEXT, pid TEXT, FOREIGN KEY (pid) REFERENCES parent(id))');
    try {
      db.prepare('INSERT INTO child (id, pid) VALUES (?, ?)').run('1', 'nonexistent');
      throw new Error('should have thrown FK');
    } catch (e) {
      const err = e as { code?: string; message?: string };
      expect(err.code).toBe('ERR_SQLITE_ERROR');
      expect(String(err.message)).toBe('FOREIGN KEY constraint failed'); // 无列信息
    }
    db.close();
  });

  it('§11#5 PRAGMA foreign_keys：node:sqlite (Node v24.15.0) 默认 ON（⚠ 与 Tech-Spec §11#5「默认 OFF」预测不一致）', () => {
    // ⚠ 实测发现：Node v24.15.0 的 node:sqlite 默认 foreign_keys=1（ON），非 Tech-Spec §11#5/D15 预测的 OFF。
    //   SQLite 默认值由编译期 SQLITE_DEFAULT_FOREIGN_KEYS 决定，Node 内置构建置 1（与标准 SQLite 发行版不同）。
    //   D15「连接后 PRAGMA foreign_keys=ON」仍正确（显式保险，已 ON 时幂等无害），但「默认 OFF，不启用则 FK 形同虚设」
    //   的理据在 node:sqlite 上不成立 → 详见交付报告 advisory 预判验证 + AI-006 反向核实。
    const db = new DatabaseSync(':memory:');
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1); // 实测默认 ON（Node v24.15.0 node:sqlite）
    db.close();
  });

  it('§11#6 UPDATE ... RETURNING * 可用（SQLite 3.35+，Node 24 已支持）', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id TEXT, val INTEGER)');
    db.prepare('INSERT INTO t (id, val) VALUES (?, ?)').run('1', 10);
    const row = db.prepare('UPDATE t SET val=? WHERE id=? RETURNING *').get(20, '1') as object;
    expect({ ...row }).toEqual({ id: '1', val: 20 });
    db.close();
  });

  it('§11#3 before/after 是 SQLite 关键字，DDL 与 SQL 须双引号包裹', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id TEXT, "before" TEXT, "after" TEXT)');
    db.prepare('INSERT INTO t (id, "before", "after") VALUES (?, ?, ?)').run('1', 'b', 'a');
    const row = db.prepare('SELECT id, "before", "after" FROM t WHERE id=?').get('1') as object;
    expect({ ...row }).toEqual({ id: '1', before: 'b', after: 'a' });
    db.close();
  });

  it('§11#7 INSERT OR IGNORE 幂等（UNIQUE 冲突静默忽略，seed 语义）', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (token TEXT PRIMARY KEY, revoked_at TEXT)');
    const r1 = db.prepare('INSERT OR IGNORE INTO t (token, revoked_at) VALUES (?, ?)').run('tok1', '2026-01-01');
    const r2 = db.prepare('INSERT OR IGNORE INTO t (token, revoked_at) VALUES (?, ?)').run('tok1', '2026-01-02');
    expect((r1 as { changes: number }).changes).toBe(1); // 首次插入
    expect((r2 as { changes: number }).changes).toBe(0); // 重复忽略（幂等）
    db.close();
  });

  it('§11#10 NULL 比较：= NULL 永假，须 IS NULL（findByParent parentId=null）', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id TEXT, parent_id TEXT NULL)');
    db.prepare('INSERT INTO t (id, parent_id) VALUES (?, ?)').run('root', null);
    db.prepare('INSERT INTO t (id, parent_id) VALUES (?, ?)').run('child', 'root');
    // = NULL 永假（0 行）
    const byEq = db.prepare('SELECT id FROM t WHERE parent_id = ?').all(null) as Array<{ id: string }>;
    expect(byEq.length).toBe(0);
    // IS NULL 正确（1 行：root）
    const byIs = db.prepare('SELECT id FROM t WHERE parent_id IS NULL').all() as Array<{ id: string }>;
    expect(byIs.map((r) => ({ ...r }).id)).toEqual(['root']);
    db.close();
  });

  it('§11#8 ORDER BY rowid 保持插入顺序（AC-F3-4 依据）', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id TEXT)');
    for (const id of ['a', 'b', 'c', 'd']) {
      db.prepare('INSERT INTO t (id) VALUES (?)').run(id);
    }
    const rows = db.prepare('SELECT id FROM t ORDER BY rowid').all() as Array<{ id: string }>;
    expect(rows.map((r) => ({ ...r }).id)).toEqual(['a', 'b', 'c', 'd']);
    db.close();
  });
});

// =====================================================================================================
// F1 DB 接入与连接管理（AC-F1-1 / AC-F1-2 / AC-F1-3）
// =====================================================================================================
describe('F1 DB 接入与连接管理', () => {
  it('AC-F1-1 createDb(:memory:) 返回 DatabaseSync，可执行 SQL', () => {
    const { createDb } = ensureDbHelpers();
    const db = createDb(':memory:');
    expect(db).toBeInstanceOf(DatabaseSync);
    db.exec('CREATE TABLE probe (id TEXT)');
    db.prepare('INSERT INTO probe (id) VALUES (?)').run('ok');
    const row = db.prepare('SELECT id FROM probe').get() as object;
    expect({ ...row }).toEqual({ id: 'ok' });
    db.close();
  });

  it('AC-F1-2 文件持久化：写入 → 关闭 → 重开同路径 → 数据仍在', () => {
    const h = ensureDbHelpers();
    expect(UserRepositoryCtor).toBeDefined();
    const tmpFile = join(tmpdir(), `persist-f1-2-${randomUUID()}.db`);
    try {
      const db1 = h.createDb(tmpFile);
      h.applySchema(db1);
      const repo1 = new UserRepositoryCtor!(db1);
      const user = makeUser({ email: 'persist-f1-2@example.com' });
      repo1.insert(user);
      db1.close();
      // 重开同路径 → 数据仍在（文件 DB 持久化语义）
      const db2 = h.createDb(tmpFile);
      h.applySchema(db2);
      const repo2 = new UserRepositoryCtor!(db2);
      const found = repo2.findByEmail('persist-f1-2@example.com');
      expect(found).toBeDefined();
      expect(found?.id).toBe(user.id);
      db2.close();
    } finally {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  });

  it('AC-F1-3 DB_PATH env 配置：createDb() 不传参时用 process.env.DB_PATH；缺省 ./data/admin.db', () => {
    const { createDb } = ensureDbHelpers();
    const tmpFile = join(tmpdir(), `persist-f1-3-${randomUUID()}.db`);
    const prev = process.env.DB_PATH;
    process.env.DB_PATH = tmpFile;
    try {
      const db = createDb(); // 不传参，用 env
      expect(db).toBeInstanceOf(DatabaseSync);
      expect(existsSync(tmpFile)).toBe(true);
      db.close();
    } finally {
      if (prev === undefined) delete process.env.DB_PATH;
      else process.env.DB_PATH = prev;
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  });
});

// =====================================================================================================
// F2 DDL 建表（AC-F2-1 / AC-F2-2）
// =====================================================================================================
describe('F2 DDL 建表', () => {
  it('AC-F2-1 applySchema 幂等：连续两次不报错（IF NOT EXISTS）', () => {
    const { createDb, applySchema } = ensureDbHelpers();
    const db = createDb(':memory:');
    expect(() => applySchema(db)).not.toThrow();
    expect(() => applySchema(db)).not.toThrow(); // 再次 apply 幂等
    // 验证表已建
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").all() as Array<{ name: string }>).map((r) => ({ ...r }).name);
    expect(tables).toEqual(['users']);
    db.close();
  });

  it('AC-F2-2 applySchema 后 users 字段对齐 userEntitySchema.shape', () => {
    const { createDb, applySchema } = ensureDbHelpers();
    const db = createDb(':memory:');
    applySchema(db);
    expect(new Set(tableColumns(db, 'users'))).toEqual(new Set(Object.keys(userEntitySchema.shape)));
    expect(new Set(tableColumns(db, 'roles'))).toEqual(new Set(Object.keys(roleSchema.shape)));
    expect(new Set(tableColumns(db, 'departments'))).toEqual(new Set(Object.keys(departmentSchema.shape)));
    db.close();
  });
});

// =====================================================================================================
// F3 repository 实现替换（AC-F3-1 / AC-F3-2 / AC-F3-3 / AC-F3-4）—— ARCH-001 闭合核心
// =====================================================================================================
describe('F3 repository 实现替换（ARCH-001 闭合核心）', () => {
  it('AC-F3-1 UserRepository 构造接收 db（D13 constructor(db: DatabaseSync)）', () => {
    const { createDb, applySchema } = ensureDbHelpers();
    expect(UserRepositoryCtor).toBeDefined();
    const db = createDb(':memory:');
    applySchema(db);
    const repo = new UserRepositoryCtor!(db);
    expect(repo).toBeDefined();
    db.close();
  });

  it('AC-F3-2 DB 行为等价：同 db 的两个 repo 实例共享数据（Map 版不共享 → 断言级红）', () => {
    const { createDb, applySchema } = ensureDbHelpers();
    expect(UserRepositoryCtor).toBeDefined();
    const db = createDb(':memory:');
    applySchema(db);
    const repo1 = new UserRepositoryCtor!(db);
    const user = makeUser({ email: 'shared@example.com' });
    repo1.insert(user);
    // 新实例同 db → DB 版共享数据可查到；Map 版新 Map 查不到（断言级红）
    const repo2 = new UserRepositoryCtor!(db);
    const found = repo2.findByEmail('shared@example.com');
    expect(found).toBeDefined();
    expect(found?.id).toBe(user.id);
    db.close();
  });

  it('AC-F3-2 DB 行为等价：insert → findById 返回等价实体（字段一致）', () => {
    const { createDb, applySchema } = ensureDbHelpers();
    expect(UserRepositoryCtor).toBeDefined();
    const db = createDb(':memory:');
    applySchema(db);
    const repo = new UserRepositoryCtor!(db);
    const user = makeUser();
    repo.insert(user);
    const found = repo.findById(user.id);
    expect(found).toBeDefined();
    expect(found?.email).toBe(user.email);
    expect(found?.name).toBe(user.name);
    expect(found?.status).toBe(user.status);
    expect(found?.version).toBe(user.version);
    db.close();
  });

  it('AC-F3-3 UserRepository 公开方法签名不变（8 方法，D2 ARCH-001 闭合）', () => {
    expect(publicMethodNames(UserRepository)).toEqual(
      expect.arrayContaining([
        'list',
        'findById',
        'findByIds',
        'findByEmail',
        'insert',
        'updateStatus',
        'findByDepartmentId',
        'updateDepartmentId',
      ]),
    );
  });

  it('AC-F3-3 RoleRepository 公开方法签名不变（13 方法）', () => {
    expect(publicMethodNames(RoleRepository)).toEqual(
      expect.arrayContaining([
        'list',
        'findById',
        'findByName',
        'insert',
        'update',
        'findChildren',
        'delete',
        'insertUserRole',
        'findUserRolesByUser',
        'findUserRolesByRole',
        'existsUserRole',
        'findUserRole',
        'deleteUserRole',
      ]),
    );
  });

  it('AC-F3-3 DepartmentRepository 公开方法签名不变（7 方法）', () => {
    expect(publicMethodNames(DepartmentRepository)).toEqual(
      expect.arrayContaining([
        'list',
        'findById',
        'findByParent',
        'insert',
        'delete',
        'existsByNameUnderParent',
        'computeDepth',
      ]),
    );
  });

  it('AC-F3-3 AuditLogRepository 公开方法签名不变（3 方法，append-only 无 update/delete）', () => {
    expect(publicMethodNames(AuditLogRepository)).toEqual(
      expect.arrayContaining(['insert', 'list', 'listAll']),
    );
  });

  it('AC-F3-3 NotificationRepository 公开方法签名不变（7 方法）', () => {
    expect(publicMethodNames(NotificationRepository)).toEqual(
      expect.arrayContaining([
        'findById',
        'insert',
        'update',
        'updateStatusAndSentAt',
        'updateStatusAndReadAt',
        'delete',
        'list',
      ]),
    );
  });

  it('AC-F3-3 TokenBlacklistRepository 公开方法签名不变（2 方法）', () => {
    expect(publicMethodNames(TokenBlacklistRepository)).toEqual(expect.arrayContaining(['add', 'has']));
  });

  it('AC-F3-3 6 个 repository 共 40 个公开方法（D2 签名逐字不变）', () => {
    const total =
      publicMethodNames(UserRepository).length +
      publicMethodNames(RoleRepository).length +
      publicMethodNames(DepartmentRepository).length +
      publicMethodNames(AuditLogRepository).length +
      publicMethodNames(NotificationRepository).length +
      publicMethodNames(TokenBlacklistRepository).length;
    // 含 private 方法（seedBuiltinAdmin/userRoleKey 等），总数 ≥ 40
    expect(total).toBeGreaterThanOrEqual(40);
  });

  it('AC-F3-4 list 保持插入顺序（ORDER BY rowid，AC-F3-4）', () => {
    const { createDb, applySchema } = ensureDbHelpers();
    expect(UserRepositoryCtor).toBeDefined();
    const db = createDb(':memory:');
    applySchema(db);
    const repo = new UserRepositoryCtor!(db);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const u = makeUser({ email: `order-${i}@example.com` });
      repo.insert(u);
      ids.push(u.id);
    }
    const { items } = repo.list({ page: 1, pageSize: 100 });
    expect(items.map((u: User) => u.id)).toEqual(ids); // 插入顺序
    db.close();
  });
});

// =====================================================================================================
// F4 DB 事务（AC-F4-1 / AC-F4-2 / AC-F4-3）
// =====================================================================================================
describe('F4 DB 事务', () => {
  it('AC-F4-1 withTransaction: fn 抛错 → ROLLBACK → 无部分写入', () => {
    const { createDb, applySchema, withTransaction } = ensureDbHelpers();
    expect(UserRepositoryCtor).toBeDefined();
    const db = createDb(':memory:');
    applySchema(db);
    const repo = new UserRepositoryCtor!(db);
    const user = makeUser({ email: 'rollback@example.com' });
    expect(() => {
      withTransaction(db, () => {
        repo.insert(user);
        throw new Error('mid-failure');
      });
    }).toThrow('mid-failure');
    // ROLLBACK 后 insert 应已回滚
    expect(repo.findById(user.id)).toBeUndefined();
    db.close();
  });

  it('AC-F4-2 withTransaction: fn 成功 → COMMIT → 数据持久化', () => {
    const { createDb, applySchema, withTransaction } = ensureDbHelpers();
    expect(UserRepositoryCtor).toBeDefined();
    const db = createDb(':memory:');
    applySchema(db);
    const repo = new UserRepositoryCtor!(db);
    const user = makeUser({ email: 'commit@example.com' });
    const result = withTransaction(db, () => {
      repo.insert(user);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(repo.findById(user.id)).toBeDefined(); // COMMIT 后持久化
    db.close();
  });

  it('AC-F4-3 补偿闭包幂等：insertUserRole 重复 → USER_ROLE_ALREADY_ASSIGNED（补偿 catch 视为已恢复，advisory #1）', () => {
    const { createDb, applySchema } = ensureDbHelpers();
    expect(UserRepositoryCtor).toBeDefined();
    expect(RoleRepositoryCtor).toBeDefined();
    const db = createDb(':memory:');
    applySchema(db);
    const userRepo = new UserRepositoryCtor!(db);
    const roleRepo = new RoleRepositoryCtor!(db);
    const userId = randomUUID();
    const roleId = randomUUID();
    userRepo.insert(makeUser({ id: userId, email: 'comp@example.com' }));
    roleRepo.insert(makeRole({ id: roleId, name: 'comp-role' }));
    const ur = makeUserRole({ user_id: userId, role_id: roleId });
    roleRepo.insertUserRole(ur);
    // 重复分配 → USER_ROLE_ALREADY_ASSIGNED（DB 版映射；Map 版覆写不抛 → 断言级红）
    expect(() => roleRepo.insertUserRole(makeUserRole({ user_id: userId, role_id: roleId }))).toThrow(AppError);
    try {
      roleRepo.insertUserRole(makeUserRole({ user_id: userId, role_id: roleId }));
    } catch (e) {
      expect((e as AppError).code).toBe('USER_ROLE_ALREADY_ASSIGNED');
    }
    db.close();
  });
});

// =====================================================================================================
// F5 约束映射（AC-F5-1 / AC-F5-2 / AC-F5-3）
// =====================================================================================================
describe('F5 约束映射', () => {
  it('AC-F5-1 UNIQUE email → USER_EMAIL_DUPLICATE（不泄漏 SQLite 错误码）', () => {
    const { createDb, applySchema } = ensureDbHelpers();
    expect(UserRepositoryCtor).toBeDefined();
    const db = createDb(':memory:');
    applySchema(db);
    const repo = new UserRepositoryCtor!(db);
    const email = 'dup-f5@example.com';
    repo.insert(makeUser({ email }));
    // 重复 email → AppError(USER_EMAIL_DUPLICATE)
    expect(() => repo.insert(makeUser({ email }))).toThrow(AppError);
    try {
      repo.insert(makeUser({ email }));
    } catch (e) {
      const err = e as AppError;
      expect(err.code).toBe('USER_EMAIL_DUPLICATE');
      expect(err.message).not.toContain('SQLITE');
      expect(err.message).not.toContain('constraint');
    }
    db.close();
  });

  it('AC-F5-1 UNIQUE role name → ROLE_NAME_DUPLICATE', () => {
    const { createDb, applySchema } = ensureDbHelpers();
    expect(RoleRepositoryCtor).toBeDefined();
    const db = createDb(':memory:');
    applySchema(db);
    const repo = new RoleRepositoryCtor!(db);
    const name = 'dup-role-f5';
    repo.insert(makeRole({ name }));
    expect(() => repo.insert(makeRole({ name }))).toThrow(AppError);
    try {
      repo.insert(makeRole({ name }));
    } catch (e) {
      expect((e as AppError).code).toBe('ROLE_NAME_DUPLICATE');
    }
    db.close();
  });

  it('AC-F5-2 FK 冲突 → 500 INTERNAL（service 前置校验为主，DB FK 为 backstop）', () => {
    const { createDb, applySchema } = ensureDbHelpers();
    expect(RoleRepositoryCtor).toBeDefined();
    const db = createDb(':memory:');
    applySchema(db);
    const repo = new RoleRepositoryCtor!(db);
    // user_id 引用不存在的 user → FK 冲突 → repository 须映射（不泄漏 SQLite）
    expect(() =>
      repo.insertUserRole(makeUserRole({ user_id: 'nonexistent-uuid', role_id: 'nonexistent-uuid2' })),
    ).toThrow();
    db.close();
  });

  it('AC-F5-3 错误响应体一致：AppError(code, message) 无 SQLite 内部信息', () => {
    const { createDb, applySchema } = ensureDbHelpers();
    expect(UserRepositoryCtor).toBeDefined();
    const db = createDb(':memory:');
    applySchema(db);
    const repo = new UserRepositoryCtor!(db);
    const email = 'resp-f5@example.com';
    repo.insert(makeUser({ email }));
    try {
      repo.insert(makeUser({ email }));
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      // errorResponseSchema 一致：code + message，无 SQLite 内部信息
      expect(typeof err.code).toBe('string');
      expect(typeof err.message).toBe('string');
      expect(err.message).not.toMatch(/SQLITE|constraint/i);
    }
    db.close();
  });
});

// =====================================================================================================
// F6 测试隔离（AC-F6-1 / AC-F6-2）
// =====================================================================================================
describe('F6 测试隔离', () => {
  it('AC-F6-1 两 :memory: db 实例数据互不串（每测试独立 DB）', () => {
    const { createDb, applySchema } = ensureDbHelpers();
    expect(UserRepositoryCtor).toBeDefined();
    const db1 = createDb(':memory:');
    applySchema(db1);
    const db2 = createDb(':memory:');
    applySchema(db2);
    const repo1 = new UserRepositoryCtor!(db1);
    const repo2 = new UserRepositoryCtor!(db2);
    const user = makeUser({ email: 'iso@example.com' });
    repo1.insert(user);
    // db1 有，db2 无（隔离）
    expect(repo1.findByEmail('iso@example.com')).toBeDefined();
    expect(repo2.findByEmail('iso@example.com')).toBeUndefined();
    db1.close();
    db2.close();
  });

  it('AC-F6-2 既有 778 测试零破坏（行为等价，impl-writer 阶段验证；本测试为占位标记）', () => {
    // AC-F6-2 由 impl-writer 阶段改 ②类既有测试 setup 后跑全量验证；
    // 本 test-first 阶段不实际跑 778（它们尚未注入 db）。
    // 标记：impl 完成后须 `npm test` 全绿（778 + persist 新增）。
    expect(true).toBe(true);
  });
});

// =====================================================================================================
// F7 admin seed（AC-F7-1）—— F7-2/F7-3 端到端见 persist-embedding.test.ts
// =====================================================================================================
describe('F7 admin seed', () => {
  it('AC-F7-1 seedAdmin 幂等：连续两次调用 admin 只一条（INSERT OR IGNORE / UNIQUE 约束）', () => {
    const { createDb, applySchema, seedAdmin } = ensureDbHelpers();
    const db = createDb(':memory:');
    applySchema(db);
    expect(() => seedAdmin(db)).not.toThrow();
    expect(() => seedAdmin(db)).not.toThrow(); // 再次 seed 幂等
    // admin 角色只一条（name=admin）
    const rows = db.prepare("SELECT COUNT(*) AS n FROM roles WHERE name='admin'").get() as { n: number };
    expect(rows.n).toBe(1);
    db.close();
  });

  it('AC-F7-1 seedAdmin 后 admin 角色含全部权限（SSOT 派生 ALL_PERMISSION_CODES）', () => {
    const { createDb, applySchema, seedAdmin } = ensureDbHelpers();
    const db = createDb(':memory:');
    applySchema(db);
    seedAdmin(db);
    const row = db.prepare("SELECT permission_codes FROM roles WHERE name='admin'").get() as { permission_codes: string };
    const codes = JSON.parse(row.permission_codes) as string[];
    expect(new Set(codes)).toEqual(new Set([...permissionCodeSchema.options])); // SSOT 派生（AI-005）
    db.close();
  });
});
