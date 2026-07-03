// apps/api/src/db/constraints.ts —— SQLite 约束异常解析 helper（TECH-PERSIST-001 D10 / §11 advisory #2）
//
// 职责：解析 node:sqlite 的约束异常 e.message，按 UNIQUE 字段映射到对应 ErrorCode。
//
// [advisory] node:sqlite 的 e.code 对所有约束（UNIQUE/FK/NOT NULL/CHECK）均为通用 'ERR_SQLITE_ERROR'，
//   e.errcode/e.errstr 亦无可靠区分（实测）。须解析 e.message：
//     UNIQUE=`"UNIQUE constraint failed: <table>.<col>[, <table>.<col>]"`
//     FK=`"FOREIGN KEY constraint failed"`（无表/列信息）
//     NOT NULL=`"NOT NULL constraint failed: <table>.<col>"`
//
// [advisory] 本模块为 db 基础设施（layerOf=null，不受 ARCH-001 约束），可 import errors/contracts。
//   repository 层调本 helper 解析异常后抛 AppError（不含 SQLite 内部信息，AC-F5-3）。
import type { ErrorCode } from '@admin/contracts';
import { AppError } from '../errors.js';

/**
 * 检测异常是否为 UNIQUE 约束冲突，且匹配指定的表.字段组合（D10）。
 * @param e 待检测异常
 * @param table 表名（如 'users'）
 * @param columns 冲突字段名（如 ['email'] / ['user_id','role_id']）
 * @returns true 当 e.message 为 UNIQUE 冲突且冲突字段集与 columns 完全匹配
 *
 * @example
 *   if (isUniqueViolation(e, 'users', 'email')) throw toAppError('USER_EMAIL_DUPLICATE', '邮箱已存在');
 */
export function isUniqueViolation(e: unknown, table: string, ...columns: string[]): boolean {
  if (!(e instanceof Error)) return false;
  const msg = String(e.message);
  const prefix = 'UNIQUE constraint failed:';
  if (!msg.startsWith(prefix)) return false;
  // 实际冲突字段：解析 "UNIQUE constraint failed: users.email, users.role_id" → ['users.email','users.role_id']
  const actual = msg
    .slice(prefix.length)
    .trim()
    .split(',')
    .map((s) => s.trim());
  const expected = columns.map((c) => `${table}.${c}`);
  // 完全匹配（顺序无关，集合相等）
  return expected.length === actual.length && expected.every((f) => actual.includes(f));
}

/**
 * 将约束异常转换为 AppError（无 SQLite 内部信息，AC-F5-3）。
 * repository 层在 catch 块调用：先判 isUniqueViolation → 命中则抛业务码；否则重抛（backstop 500 INTERNAL）。
 *
 * @param code 业务错误码（如 USER_EMAIL_DUPLICATE）
 * @param context 人类可读的错误描述（不含 'constraint'/'SQLITE' 等内部字样）
 * @throws AppError 永远抛出（never 返回）
 */
export function toAppError(code: ErrorCode, context: string): never {
  throw new AppError(code, context);
}
