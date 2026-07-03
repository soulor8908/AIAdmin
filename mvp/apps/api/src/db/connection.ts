// apps/api/src/db/connection.ts —— DB 连接管理 + DDL 应用 + admin seed（TECH-PERSIST-001 §8）
//
// 职责：
//   - createDb(path?)：建 DatabaseSync 连接 + PRAGMA foreign_keys=ON（D15）。
//   - applySchema(db)：执行 schema.sql 幂等建表（D3，CREATE IF NOT EXISTS）。
//   - seedAdmin(db)：INSERT OR IGNORE 内置 admin 角色（D7，UNIQUE name 触发 ignore 幂等）。
//
// [advisory] 本模块为 db 基础设施（layerOf=null，不受 ARCH-001 约束），可 import domain/contracts。
//   server.ts 启动时 createDb → applySchema → seedAdmin → 注入 repository；测试建 :memory: db 复用。
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BUILTIN_ADMIN_ROLE_NAME,
  ALL_PERMISSION_CODES,
} from '../domain/role.js';

/**
 * 建立数据库连接（D1/D12/D15）。
 * - path=':memory:' → 内存库（测试隔离，D4）。
 * - path 缺省 → process.env.DB_PATH ?? './data/admin.db'（D12，缺省保证开箱即用）。
 * - 文件 DB 路径父目录不存在时 mkdirSync recursive（advisory #9，否则 DatabaseSync 抛目录不存在）。
 * - 连接后立即 PRAGMA foreign_keys=ON（D15；node:sqlite Node v24 实测默认已 ON，显式保险幂等无害）。
 */
export function createDb(path?: string): DatabaseSync {
  const dbPath = path ?? process.env.DB_PATH ?? './data/admin.db';
  if (dbPath !== ':memory:') {
    const dir = dirname(dbPath);
    // 缺省路径 './data/admin.db' → 建 './data'；空 dirname（相对当前目录）时跳过
    if (dir && dir !== '.') {
      mkdirSync(dir, { recursive: true });
    }
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON');
  return db;
}

/**
 * 应用 DDL 建表（D3，幂等）。
 * 读取 apps/api/src/db/schema.sql 一次性 exec（CREATE TABLE IF NOT EXISTS 保证幂等，AC-F2-1）。
 */
export function applySchema(db: DatabaseSync): void {
  const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  db.exec(schemaSql);
}

/**
 * 幂等 seed 内置 admin 角色（D7）。
 * 直连 INSERT OR IGNORE（advisory #7，不走 repository.insert —— repository.insert 须抛 ROLE_NAME_DUPLICATE，
 * 但 seed 期望静默幂等）。UNIQUE(name) 冲突时 IGNORE，保证重复调用只一条（AC-F7-1）。
 * permission_codes=JSON.stringify(ALL_PERMISSION_CODES)（D14 复合字段序列化）。
 * is_builtin=1（D16 INTEGER 0/1）。
 *
 * [advisory] RoleRepository 构造内亦有等价的 seedBuiltinAdmin（INSERT OR IGNORE），二者幂等互补：
 *   - 本函数供 server.ts 启动时显式调用 + persist.test.ts 单测直调。
 *   - RoleRepository 构造供测试 new RoleRepository(db) 时自动 seed（既有测试兼容）。
 *   两者先后执行均靠 UNIQUE(name) IGNORE 保证只一条。
 */
export function seedAdmin(db: DatabaseSync): void {
  db.prepare(
    'INSERT OR IGNORE INTO roles (id, name, description, permission_codes, is_builtin, parent_role_id, created_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    randomUUID(),
    BUILTIN_ADMIN_ROLE_NAME,
    'Built-in administrator role with all permissions',
    JSON.stringify(ALL_PERMISSION_CODES),
    1, // is_builtin: true（D16）
    null, // parent_role_id: admin 是根角色（TECH-ROLE-INHERITANCE-001 D1）
    new Date().toISOString(),
    0, // version: 内置 admin 不可更新，version 恒 0（TECH-OPTIMISTIC-LOCKING-001 D8）
  );
}

/**
 * 创建测试用 :memory: db + 应用 DDL（D4 测试隔离，§8 实现提示）。
 * 供 in-process 测试 setup 与 router 默认 auditRepo fallback 复用：`const db = createTestDb(); const repo = new UserRepository(db);`。
 * [约束] :memory: 每调用新建独立实例（AC-F6-1 隔离）；不含 seedAdmin（测试自行决定是否 seed）。
 */
export function createTestDb(): DatabaseSync {
  const db = createDb(':memory:');
  applySchema(db);
  return db;
}
