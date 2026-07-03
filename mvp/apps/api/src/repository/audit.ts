// apps/api/src/repository/audit.ts —— 数据访问层：DB 持久化实现（node:sqlite，append-only）
// TECH-PERSIST-001：内存数组 → DB audit_logs 表（重启不丢，AC-F1-2 持久化语义）。
// [约束] 接口签名不变（D2，ARCH-001 闭合）：3 个公开方法逐字不变（insert/list/listAll），仅构造接收 db（D13）。
// [约束] append-only：仅暴露 insert + list + listAll，**无 update/delete 方法**（编译期保障，F4）。
// [约束] 复合字段：before/after JSON 序列化（D14）；列名 before/after 双引号包裹（SQLite 关键字，§11 #3）。
// [约束] list 按 operated_at 倒序（最新优先，Q4）；listAll 无分页无排序（报表聚合用）。
// ARCH-001：repository 不得 import service/router；可 import domain/contracts/db 基础设施。
import type { AuditLog, AuditLogEntityType, AuditLogAction } from '@admin/contracts';
import type { DatabaseSync } from 'node:sqlite';

/**
 * 列表查询选项（F2）：分页 + 时间范围（闭区间）/ 操作者 / 实体类型三维过滤。
 * action 过滤为 Q5 OPEN，本期不提供（listAll 才支持 action）。
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

/** audit_logs 表 DB 行结构（before/after 为 JSON 字符串）。 */
interface AuditLogRow {
  id: string;
  operator_id: string;
  operator_name: string;
  entity_type: string;
  entity_id: string;
  action: string;
  operated_at: string;
  before: string;
  after: string;
  created_at: string;
}

type Stmt = ReturnType<DatabaseSync['prepare']>;

/** 共用过滤维度（list + listAll）：时间范围 / operator_id / entity_type。 */
interface CommonFilter {
  operated_from?: string;
  operated_to?: string;
  operator_id?: string;
  entity_type?: AuditLogEntityType;
}

/** 将 DB 行转为 AuditLog（before/after JSON.parse，D14）。 */
function rowToEntity(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    operator_id: row.operator_id,
    operator_name: row.operator_name,
    entity_type: row.entity_type as AuditLogEntityType,
    entity_id: row.entity_id,
    action: row.action as AuditLogAction,
    operated_at: row.operated_at,
    before: JSON.parse(row.before) as AuditLog['before'],
    after: JSON.parse(row.after) as AuditLog['after'],
    created_at: row.created_at,
  };
}

/** 动态构造 WHERE 子句 + 绑定参数（共用过滤维度：时间范围 / operator_id / entity_type）。
 * [约束] 全部用 ? 占位参数化（防 SQL 注入）；SQL 字符串动态拼接仅含列名（非用户输入）。 */
function buildCommonWhere(filter: CommonFilter): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.operated_from !== undefined) {
    clauses.push('operated_at >= ?');
    params.push(filter.operated_from);
  }
  if (filter.operated_to !== undefined) {
    clauses.push('operated_at <= ?');
    params.push(filter.operated_to);
  }
  if (filter.operator_id !== undefined) {
    clauses.push('operator_id = ?');
    params.push(filter.operator_id);
  }
  if (filter.entity_type !== undefined) {
    clauses.push('entity_type = ?');
    params.push(filter.entity_type);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

/**
 * 操作日志域 DB repository（append-only）。
 * 构造时 **不 seed** 任何内置日志（空起步，日志由三域写操作动态产生）。
 * 仅暴露 insert（仅追加，重复 insert 允许不去重）+ list（过滤+分页+按 operated_at 倒序）+ listAll（全量过滤，供报表聚合），
 * **不暴露 update/delete/patch 方法**（append-only 编译期保障，F4）。
 *
 * [advisory] list/listAll 因过滤维度组合可变，WHERE 子句动态构造；每次查询 db.prepare(sql)（参数化安全）。
 *   audit_logs 为 append-only 低频写入，prepare-per-query 性能可接受（MVP）。
 */
export class AuditLogRepository {
  private readonly db: DatabaseSync;
  private readonly insertStmt: Stmt;

  constructor(db: DatabaseSync) {
    this.db = db;
    // insert 固定 SQL（prepare 一次复用）；before/after 双引号包裹（SQLite 关键字，§11 #3）
    this.insertStmt = db.prepare(
      'INSERT INTO audit_logs (id, operator_id, operator_name, entity_type, entity_id, action, operated_at, "before", "after", created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
  }

  /** 追加一条日志（append-only，不去重，重复 insert 视为追加）。返回写入的 log。 */
  insert(log: AuditLog): AuditLog {
    this.insertStmt.run(
      log.id,
      log.operator_id,
      log.operator_name,
      log.entity_type,
      log.entity_id,
      log.action,
      log.operated_at,
      JSON.stringify(log.before),
      JSON.stringify(log.after),
      log.created_at,
    );
    return log;
  }

  /**
   * 列表查询：按 operated_from/operated_to 闭区间 / operator_id / entity_type 过滤，
   * 按 operated_at 倒序排列（最新优先），分页切片；返回当前页 items 与满足筛选条件的总条数。
   */
  list(opts: AuditLogListOptions): AuditLogListRepoResult {
    const { where, params } = buildCommonWhere(opts);
    // total：满足筛选条件的总条数
    const countSql = `SELECT COUNT(*) AS n FROM audit_logs ${where}`;
    const totalRow = this.db.prepare(countSql).get(...params) as { n: number };
    // items：倒序 + 分页（ISO 8601 字符串字典序与时间序一致）
    const offset = (opts.page - 1) * opts.pageSize;
    const listSql = `SELECT * FROM audit_logs ${where} ORDER BY operated_at DESC LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(listSql).all(...params, opts.pageSize, offset) as AuditLogRow[];
    return { items: rows.map(rowToEntity), total: totalRow.n };
  }

  /**
   * 全量查询（F2 报表聚合用）：按 operated_from/operated_to 闭区间 / operator_id / entity_type / action 过滤，
   * 返回全部满足条件的日志（无分页、无排序），供 ReportService 内存 group by 聚合。
   */
  listAll(filter?: AuditLogListAllFilter): AuditLog[] {
    if (!filter) {
      const rows = this.db.prepare('SELECT * FROM audit_logs').all() as AuditLogRow[];
      return rows.map(rowToEntity);
    }
    // listAll 独有 action 过滤维度（Q5 OPEN for list，listAll 用于报表聚合故支持）
    const { where, params } = buildCommonWhere(filter);
    let finalWhere = where;
    if (filter.action !== undefined) {
      const actionClause = 'action = ?';
      finalWhere = where ? `${where} AND ${actionClause}` : `WHERE ${actionClause}`;
      params.push(filter.action);
    }
    const sql = `SELECT * FROM audit_logs ${finalWhere}`;
    const rows = this.db.prepare(sql).all(...params) as AuditLogRow[];
    return rows.map(rowToEntity);
  }
}
