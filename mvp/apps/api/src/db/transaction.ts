// apps/api/src/db/transaction.ts —— DB 事务 helper（TECH-PERSIST-001 §8 / D8）
//
// 职责：
//   - withTransaction<T>(db, fn): T —— BEGIN → fn() → COMMIT（成功）/ ROLLBACK（异常）。
//     node:sqlite 无 transaction helper（advisory 实测确认），手动管理事务边界。
//
// [advisory] 本模块为 db 基础设施（layerOf=null，不受 ARCH-001 约束）。
//   TransferService.transfer 用其包裹 A 改部门 / B 移除旧角色 / C 分配新角色 三步跨 repo 写操作（§3.1）。
//   注意：node:sqlite 单连接同步，事务在连接级别生效；多 repo 须共享同一 db 连接（advisory #8），
//   事务内调用的 service/repo 方法自动纳入事务（同步执行，无连接池语义）。
//
// [advisory] 偏离 §8 原提示（已反向同步）：原提示写 fn 为同步闭包。实现期发现 TransferService.transfer 的
//   A/B/C 经 deptService/roleService 调用，service 方法声明为 async（返回 Promise），无法在同步闭包内 await。
//   故 withTransaction 通过重载支持同步 fn（返回 T）与异步 fn（返回 Promise<T>）两种形态：
//     - 同步 fn（persist.test.ts AC-F4-1/F4-2）：BEGIN → fn() → COMMIT/ROLLBACK，同步返回 T。
//     - 异步 fn（TransferService.transfer）：BEGIN → fn() 返回 Promise → .then(COMMIT) / .catch(ROLLBACK)，
//       返回 Promise<T>。事务跨越 await 边界（node:sqlite 单连接同步，无并发竞态）。
import type { DatabaseSync } from 'node:sqlite';

/**
 * 在 DB 事务中执行 fn（D8 双保障：DB 原生事务 + R7 应用层补偿闭包）。
 * - 成功：BEGIN → fn() → COMMIT，返回 fn() 的返回值。
 * - 失败：BEGIN → fn() 抛错 → ROLLBACK，重新抛出原错误（数据层回滚，AC-F4-1）。
 *
 * [约束] 不吞错、不重试（CODE-002）。ROLLBACK 后的「已恢复」判定由 R7 补偿闭包幂等性处理（service/transfer.ts，
 *   advisory #1 / §3.2），本 helper 仅负责事务边界。
 *
 * 重载：
 *   - 同步 fn（fn: () => T）→ 同步返回 T（persist.test.ts AC-F4-1/F4-2 用此形态）。
 *   - 异步 fn（fn: () => Promise<T>）→ 返回 Promise<T>（TransferService.transfer 用此形态，A/B/C 经 async service）。
 *
 * @example 同步
 *   const result = withTransaction(db, () => {
 *     userRepo.updateDepartmentId(userId, toDeptId, now);
 *     return 'ok';
 *   });
 * @example 异步
 *   const result = await withTransaction(db, async () => {
 *     await deptService.assignUserDepartment(userId, toDeptId, ctx);
 *     return writeResult;
 *   });
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T;
export function withTransaction<T>(db: DatabaseSync, fn: () => Promise<T>): Promise<T>;
export function withTransaction<T>(db: DatabaseSync, fn: () => T | Promise<T>): T | Promise<T> {
  db.exec('BEGIN');
  try {
    const result = fn();
    // 异步 fn：返回 Promise，事务跨越 await 边界（.then COMMIT / .catch ROLLBACK）
    if (result instanceof Promise) {
      return result.then(
        (r) => {
          db.exec('COMMIT');
          return r;
        },
        (e) => {
          db.exec('ROLLBACK');
          throw e;
        },
      );
    }
    // 同步 fn：立即 COMMIT
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
