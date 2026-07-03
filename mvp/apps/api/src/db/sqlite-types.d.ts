// apps/api/src/db/sqlite-types.d.ts —— node:sqlite 最小本地类型声明
//
// 背景：@types/node@20.19.43 缺 node:sqlite 类型（TECH-PERSIST-001 §11 advisory #1）。
// 本声明提供 DatabaseSync / SqliteStatement 的最小接口，供 apps/api/src 下实现模块使用。
// 升级 @types/node@22+ 后可删除本文件（改回 `import type { DatabaseSync } from 'node:sqlite'`）。
//
// [advisory] 偏离（AI-003）：本声明仅覆盖实现使用的子集（exec/prepare/close + get/all/run），
//   不覆盖 Statement.iterate / db.function / db.aggregate 等未用 API。
//   类型保守用 unknown（CODE-001 禁 any），调用方在 repository 层用类型守卫/具体接口 cast。
declare module 'node:sqlite' {
  /** 预编译语句（db.prepare 返回）。get=单行、all=多行、run=写入看 changes。 */
  export interface SqliteStatement {
    /** 取首行（无行返回 undefined）。行对象原型为 null，须 {...row} 转普通对象。 */
    get(...params: unknown[]): unknown;
    /** 取全部行（数组）。每行原型为 null，须 {...row} 转普通对象。 */
    all(...params: unknown[]): unknown[];
    /** 执行写入（INSERT/UPDATE/DELETE），返回受影响行数 + 最后插入的 rowid。 */
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }

  /** node:sqlite 同步数据库连接（Node 22+ 内置）。 */
  export class DatabaseSync {
    constructor(path: string);
    /** 执行 SQL（无参数绑定，DDL/事务控制/多条语句）。 */
    exec(sql: string): void;
    /** 预编译语句（复用 PreparedStatement）。 */
    prepare(sql: string): SqliteStatement;
    /** 关闭连接（文件 DB 刷盘）。 */
    close(): void;
  }
}
