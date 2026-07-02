// apps/api/src/repository/audit.ts —— 数据访问层：内存实现（append-only 数组）
// 本 MVP 不连真实 DB；DB schema SSOT 见 Tech-Spec §DB 变更。
// ARCH-001：repository 不得 import service/router；可 import domain/contracts。
// F4 append-only：仅暴露 insert + list，**无 update/delete 方法**（编译期保障，任何入口均无修改/删除日志路径）。
import type { AuditLog, AuditLogEntityType } from '@admin/contracts';

/**
 * 列表查询选项（F2）：分页 + 时间范围（闭区间）/ 操作者 / 实体类型三维过滤。
 * action 过滤为 Q5 OPEN，本期不提供。
 */
export interface AuditLogListOptions {
  page: number;
  pageSize: number;
  operated_from?: string;
  operated_to?: string;
  operator_id?: string;
  entity_type?: AuditLogEntityType;
}

export interface AuditLogListRepoResult {
  items: AuditLog[];
  total: number;
}

/**
 * 操作日志域内存 repository（append-only）。
 * 构造时 **不 seed** 任何内置日志（空起步，日志由三域写操作动态产生）。
 * 仅暴露 insert（仅追加，重复 insert 允许不去重）+ list（过滤+分页+按 operated_at 倒序），
 * **不暴露 update/delete/patch 方法**（append-only 编译期保障，F4）。
 */
export class AuditLogRepository {
  private readonly logs: AuditLog[] = [];

  /** 追加一条日志（append-only，不去重，重复 insert 视为追加）。返回写入的 log。 */
  insert(log: AuditLog): AuditLog {
    this.logs.push(log);
    return log;
  }

  /**
   * 列表查询：按 operated_from/operated_to 闭区间 / operator_id / entity_type 过滤，
   * 按 operated_at 倒序排列（最新优先），分页切片；返回当前页 items 与满足筛选条件的总条数。
   */
  list(opts: AuditLogListOptions): AuditLogListRepoResult {
    let arr = this.logs.slice();
    if (opts.operated_from !== undefined) {
      arr = arr.filter((l) => l.operated_at >= opts.operated_from!);
    }
    if (opts.operated_to !== undefined) {
      arr = arr.filter((l) => l.operated_at <= opts.operated_to!);
    }
    if (opts.operator_id !== undefined) {
      arr = arr.filter((l) => l.operator_id === opts.operator_id!);
    }
    if (opts.entity_type !== undefined) {
      arr = arr.filter((l) => l.entity_type === opts.entity_type!);
    }
    // 按 operated_at 倒序（ISO 8601 字符串字典序与时间序一致）
    arr.sort((a, b) => (b.operated_at > a.operated_at ? 1 : b.operated_at < a.operated_at ? -1 : 0));
    const total = arr.length;
    const start = (opts.page - 1) * opts.pageSize;
    const items = arr.slice(start, start + opts.pageSize);
    return { items, total };
  }
}
