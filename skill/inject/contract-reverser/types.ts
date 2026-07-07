// inject/contract-reverser/types.ts —— P2-3 API 逆向契约类型

/**
 * 准确性标记（建议 7）。
 * - inferred：逆向推断，置信度 < 0.7，须人工 review
 * - verified：人工确认过（或置信度 ≥ 0.9 且类型完整）
 * - partial：部分类型已知（如仅 request 或仅 response），仍需 review
 */
export type AccuracyTag = 'inferred' | 'verified' | 'partial';

export interface ReversedEndpoint {
  method: string;
  path: string;
  handler_file?: string;
  request_schema?: unknown;
  response_schema?: unknown;
  /** 置信度 0-1 */
  confidence: number;
  /** 准确性标记（建议 7：基于 confidence 自动计算） */
  accuracy: AccuracyTag;
  notes?: string;
}

export interface ReversedOpenApi {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  /**
   * 建议 7：标记本 OpenAPI 是 inferred 还是 verified。
   * - inferred：至少 1 个端点未 verified
   * - verified：所有端点都 verified
   */
  accuracy: AccuracyTag;
}

export interface ReverseResult {
  endpoints: ReversedEndpoint[];
  openapi: ReversedOpenApi;
  markdown_report: string;
  warnings: string[];
  /** 汇总：各 accuracy 等级的端点数 */
  accuracy_summary: { inferred: number; partial: number; verified: number };
}
