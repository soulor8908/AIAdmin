// apps/web/src/pages/AuditLogPage.tsx —— 审计日志只读列表/筛选页（TECH-WEB-ROLE-DEPT-AUDIT-001 §6.7）
//
// 职责：
//   - 首次加载 listAuditLogs({page:1,pageSize:20})（D21，AC-F7-1）
//   - 渲染日志行（operated_at/operator_name/entity_type/action/变更摘要，AC-F7-1）
//   - 分页（AC-F7-2）；筛选 entity_type/operator_id/date_range（AC-F7-3/4/5，无 action，B3）
//   - 筛选+分页复合（AC-F7-6，翻页保持筛选条件）
//   - PII 脱敏展示（before/after pii=true 字段展示脱敏值，AC-F7-10，D10）
//   - 只读无写入口（AC-F7-11，append-only）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/audit-logs + components + lib）。
// [约束] D3：RedactedAuditLog/AuditLogListResult/ListAuditLogQuery 经 z.infer 派生（D10 禁用 auditLogSchema）。
// [约束] D14：筛选区仅 entity_type/operator_id/operated_from/operated_to（无 action，B3）。
// [约束] D15：date_range 用 datetime-local + ISO 归一（new Date(...).toISOString()）。
// [约束] AC-F7-3：entity_type select 选项从 [...auditLogEntityTypeSchema.options] SSOT 派生（AI-005）。
// [约束] §5.3：useState 管理本地状态，无 Redux/Zustand。
import { useEffect, useState } from 'react';
import {
  auditLogEntityTypeSchema,
  type AuditLogListResult,
  type ErrorCode,
  type ListAuditLogQuery,
  type RedactedAuditLog,
} from '@admin/contracts';
import { listAuditLogs } from '../api/audit-logs.js';
import { ApiError } from '../api/client.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';

/** 前端固定 pageSize=20（D21，不依赖 schema 缺省 20）。 */
const PAGE_SIZE = 20;

/** entity_type 全集 SSOT 派生（AI-005，禁止硬编码 5 项）。 */
const ALL_ENTITY_TYPES = [...auditLogEntityTypeSchema.options];

/** ApiError → 中文提示。contracts 码走 mapErrorToMessage，LocalErrorCode 兜底通用提示。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/**
 * D15：datetime-local 输入归一为 ISO 8601 datetime（含秒+Z）。
 * 输入 'YYYY-MM-DDTHH:mm' → new Date(...).toISOString() → 'YYYY-MM-DDTHH:mm:ss.000Z'。
 * 无效/空输入 → undefined（不传该筛选字段，避免 listAuditLogQuerySchema z.string().datetime() 拒绝）。
 */
function normalizeDatetime(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** AuditLogPage 组件。只读列表 + 筛选 + 分页（无写入口，AC-F7-11）。 */
export function AuditLogPage(): JSX.Element {
  const [items, setItems] = useState<RedactedAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<string>('');
  const [operatorId, setOperatorId] = useState('');
  const [operatedFrom, setOperatedFrom] = useState('');
  const [operatedTo, setOperatedTo] = useState('');

  useEffect(() => {
    const query: ListAuditLogQuery = { page, pageSize: PAGE_SIZE };
    if (entityType) {
      query.entity_type = entityType as ListAuditLogQuery['entity_type'];
    }
    if (operatorId) {
      query.operator_id = operatorId;
    }
    const from = normalizeDatetime(operatedFrom);
    const to = normalizeDatetime(operatedTo);
    if (from) query.operated_from = from;
    if (to) query.operated_to = to;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAuditLogs(query)
      .then((res: AuditLogListResult) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, entityType, operatorId, operatedFrom, operatedTo]);

  function handleNextPage(): void {
    if (page < totalPages) setPage(page + 1);
  }

  function handlePrevPage(): void {
    if (page > 1) setPage(page - 1);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">审计日志</h1>
      </div>

      <div className="page-filters">
        <div className="page-filter-group">
          <label className="form-label">实体类型</label>
          <select
            className="form-select"
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setPage(1);
            }}
            aria-label="实体类型"
          >
            <option value="">全部</option>
            {ALL_ENTITY_TYPES.map((et) => (
              <option key={et} value={et}>
                {et}
              </option>
            ))}
          </select>
        </div>
        <div className="page-filter-group">
          <label className="form-label">操作者</label>
          <input
            type="text"
            className="form-input"
            value={operatorId}
            onChange={(e) => {
              setOperatorId(e.target.value);
              setPage(1);
            }}
            aria-label="操作者"
          />
        </div>
        <div className="page-filter-group">
          <label className="form-label">开始</label>
          <input
            type="datetime-local"
            className="form-input"
            value={operatedFrom}
            onChange={(e) => {
              setOperatedFrom(e.target.value);
              setPage(1);
            }}
            aria-label="开始"
          />
        </div>
        <div className="page-filter-group">
          <label className="form-label">结束</label>
          <input
            type="datetime-local"
            className="form-input"
            value={operatedTo}
            onChange={(e) => {
              setOperatedTo(e.target.value);
              setPage(1);
            }}
            aria-label="结束"
          />
        </div>
      </div>

      <ErrorBanner message={error} />

      {loading && (
        <div className="loading-container">
          <span className="spinner" />
          <span>加载中...</span>
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-title">暂无审计日志</div>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>操作时间</th>
                <th>操作者</th>
                <th>实体类型</th>
                <th>动作</th>
                <th>变更</th>
              </tr>
            </thead>
            <tbody>
              {items.map((log) => (
                <tr key={log.id}>
                  <td>{log.operated_at}</td>
                  <td>{log.operator_name}</td>
                  <td>{log.entity_type}</td>
                  <td>{log.action}</td>
                  <td>
                    {log.after.map((f, i) => (
                      <span key={i}>{String(f.value)}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="pagination">
          <div className="pagination-info">共 {total} 条，第 {page}/{totalPages} 页</div>
          <div className="pagination-buttons">
            <button type="button" className="btn btn-secondary btn-sm" onClick={handlePrevPage} disabled={page <= 1}>
              上一页
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleNextPage} disabled={page >= totalPages}>
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { AuditLogListResult, ListAuditLogQuery, RedactedAuditLog };