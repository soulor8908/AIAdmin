// apps/web/src/pages/ReportPage.tsx —— 报表筛选 + 聚合表格页（TECH-WEB-NOTIFICATION-REPORT-001 §6.3）
//
// 职责：
//   - 渲染 ReportFilter 筛选区 + ReportTable 聚合表格区
//   - "应用筛选"按钮触发请求（D12，R14 S-9 教训，不每键入触发）
//   - 客户端 advisory 校验（group_by 非空 / from<=to，D13/D14，由 ReportFilter 内联执行）
//   - 分页/空状态/加载态（AC-F7-9）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部。
// [约束] D3：ReportResult/ReportQuery 经 z.infer 派生。
// [约束] D12：应用筛选按钮触发请求（不每键入触发，R14 S-9 教训）。
// [约束] D13：group_by 默认不勾选 + 客户端 advisory 校验非空（ReportFilter 内联校验）。
// [约束] §5.3：useState 管理本地状态，无 Redux/Zustand。
import { useState } from 'react';
import type { ErrorCode, ReportQuery, ReportResult } from '@admin/contracts';
import { queryOperations } from '../api/reports.js';
import { ApiError } from '../api/client.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { ReportFilter } from '../components/ReportFilter.js';
import { ReportTable } from '../components/ReportTable.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';

/** 前端固定 pageSize=20（沿用 R14 D21，与 reportQuerySchema default 一致）。 */
const PAGE_SIZE = 20;

/** ApiError → 中文提示。contracts 码走 mapErrorToMessage，LocalErrorCode 兜底通用提示。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** ReportPage 组件。筛选 + 聚合表格 + 分页。 */
export function ReportPage(): JSX.Element {
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 最近一次应用的筛选（含 group_by/时间/operator_id/entity_type/action，page 字段用于翻页覆盖）
  const [appliedFilters, setAppliedFilters] = useState<ReportQuery | null>(null);
  const [page, setPage] = useState(1);

  /** 触发查询（应用筛选或翻页共用）。 */
  function runQuery(query: ReportQuery): void {
    setLoading(true);
    setError(null);
    queryOperations(query)
      .then((res: ReportResult) => {
        setResult(res);
        setPage(res.page);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
      })
      .finally(() => {
        setLoading(false);
      });
  }

  /** ReportFilter 应用筛选回调：存筛选 + 翻页重置 1 + 触发查询（D12）。 */
  function handleApply(filters: ReportQuery): void {
    setAppliedFilters(filters);
    runQuery(filters);
  }

  function handleNextPage(): void {
    if (!appliedFilters || !result || page >= result.totalPages) return;
    const next = page + 1;
    runQuery({ ...appliedFilters, page: next, pageSize: PAGE_SIZE });
  }

  function handlePrevPage(): void {
    if (!appliedFilters || page <= 1) return;
    const prev = page - 1;
    runQuery({ ...appliedFilters, page: prev, pageSize: PAGE_SIZE });
  }

  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 0;
  const hasResult = result !== null;

  return (
    <div>
      <header>
        <h1>操作统计报表</h1>
      </header>

      <ReportFilter onApply={handleApply} />

      <ErrorBanner message={error} />

      {loading && <div>加载中...</div>}

      {!loading && !hasResult && (
        <div>请选择分组维度后应用筛选</div>
      )}

      {!loading && hasResult && (
        <>
          <ReportTable result={result} />
          {result.items.length > 0 && (
            <div>
              <span>共 {total} 条</span>
              <span>
                第 {page}/{totalPages} 页
              </span>
              <button type="button" onClick={handlePrevPage} disabled={page <= 1}>
                上一页
              </button>
              <button
                type="button"
                onClick={handleNextPage}
                disabled={page >= totalPages}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
