// apps/api/test/helpers/db.ts —— 测试 DB helper（TECH-PERSIST-001 §10 ②-A / §8）
//
// 职责：为 in-process 测试提供 :memory: db 工厂（D4 测试隔离）。
//   - createTestDb()：建独立 :memory: db + 应用 DDL（每个调用新建实例，AC-F6-1 隔离）。
//   - 多 repo 测试（transfer/audit-embedding 等）须共享同一 createTestDb() 返回值（advisory #8）。
//
// 薄封装 re-export：测试统一从本文件 import，便于后续如需调整测试 DB 工厂只改一处。
export { createTestDb } from '../../src/db/connection.js';
