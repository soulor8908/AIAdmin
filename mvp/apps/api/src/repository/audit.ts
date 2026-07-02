// apps/api/src/repository/audit.ts —— 数据访问层：内存实现（append-only 数组）
// 本 MVP 不连真实 DB；DB schema SSOT 见 Tech-Spec §DB 变更。
// ARCH-001：repository 不得 import service/router；可 import domain/contracts。
// F4 append-only：仅暴露 insert + list + listAll，**无 update/delete 方法**（编译期保障，任何入口均无修改/删除日志路径）。
import type { AuditLog, AuditLogEntityType, AuditLogAction } from '@admin/contracts';

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
 * 全量查询过滤条件（F2 报表聚合用）：与 list(opts) 共用过滤维度，但增加 action 过滤（报表聚合需要）。
 * 无分页，返回全部满足条件的日志，供 ReportService 内存聚合。
 */
export interface AuditLogListAllFilter {
  operated_from?: string;
  operated_to?: string;
  operator_id?: string;
  entity_type?: AuditLogEntityType;
  action?: AuditLogAction;
}

/**
 * 操作日志域内存 repository（append-only）。
 * 构造时 **不 seed** 任何内置日志（空起步，日志由三域写操作动态产生）。
 * 仅暴露 insert（仅追加，重复 insert 允许不去重）+ list（过滤+分页+按 operated_at 倒序）+ listAll（全量过滤，供报表聚合），
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
    const filtered = this.applyFilter(this.logs.slice(), opts);
    // 按 operated_at 倒序（ISO 8601 字符串字典序与时间序一致）
    filtered.sort((a, b) => (b.operated_at > a.operated_at ? 1 : b.operated_at < a.operated_at ? -1 : 0));
    const total = filtered.length;
    const start = (opts.page - 1) * opts.pageSize;
    const items = filtered.slice(start, start + opts.pageSize);
    return { items, total };
  }

  /**
   * 全量查询（F2 报表聚合用）：按 operated_from/operated_to 闭区间 / operator_id / entity_type / action 过滤，
   * 返回全部满足条件的日志（无分页、无排序），供 ReportService 内存 group by 聚合。
   */
  listAll(filter?: AuditLogListAllFilter): AuditLog[] {
    if (!filter) return this.logs.slice();
    return this.applyFilter(this.logs.slice(), filter);
  }

  /**
   * 共用过滤逻辑：按时间范围（闭区间）/ operator_id / entity_type / action（仅 listAll 支持）过滤。
   * action 过滤为 list(opts) 不支持的维度（Q5 OPEN for list），listAll 用于报表聚合故支持。
   */
  private applyFilter(arr: AuditLog[], opts: AuditLogListAllFilter): AuditLog[] {
    let result = arr;
    if (opts.operated_from !== undefined) {
      result = result.filter((l) => l.operated_at >= opts.operated_from!);
    }
    if (opts.operated_to !== undefined) {
      result = result.filter((l) => l.operated_at <= opts.operated_to!);
    }
    if (opts.operator_id !== undefined) {
      result = result.filter((l) => l.operator_id === opts.operator_id!);
    }
    if (opts.entity_type !== undefined) {
      result = result.filter((l) => l.entity_type === opts.entity_type!);
    }
    if (opts.action !== undefined) {
      result = result.filter((l) => l.action === opts.action!);
    }
    return result;
  }
}
