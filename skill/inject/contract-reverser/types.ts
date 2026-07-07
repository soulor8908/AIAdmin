// inject/contract-reverser/types.ts —— P2-3 API 逆向契约类型

/**
 * 准确性标记（建议 7 / 问题 6）。
 * - inferred：逆向推断，置信度 < 0.7，须人工 review
 * - partial：部分类型已知（如仅 request 或仅 response），仍需 review
 * - high_confidence：机器推断置信度 ≥ 0.9 且 request/response 类型都已知（问题 6 重命名）
 * - verified：人工确认过（保留给人工确认后使用，机器不自动赋此值）
 *
 * 问题 6 修复：原 `verified` 字面暗示"已人工确认"，但实际是"机器推断置信度高"，
 * 故拆分为 `high_confidence`（机器高置信）+ `verified`（人工确认，未来扩展）。
 */
export type AccuracyTag = 'inferred' | 'high_confidence' | 'partial' | 'verified';

export interface ReversedEndpoint {
  method: string;
  path: string;
  handler_file?: string;
  request_schema?: unknown;
  response_schema?: unknown;
  /** 置信度 0-1 */
  confidence: number;
  /** 准确性标记（建议 7：基于 confidence 自动计算；verified 仅人工赋值） */
  accuracy: AccuracyTag;
  notes?: string;
}

export interface ReversedOpenApi {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  /**
   * 建议 7：标记本 OpenAPI 是 inferred 还是 high_confidence。
   * - inferred：至少 1 个端点未 high_confidence
   * - high_confidence：所有端点都 high_confidence
   * - verified：所有端点都人工 verified（未来扩展）
   */
  accuracy: AccuracyTag;
}

export interface ReverseResult {
  endpoints: ReversedEndpoint[];
  openapi: ReversedOpenApi;
  markdown_report: string;
  warnings: string[];
  /** 汇总：各 accuracy 等级的端点数（verified 仅为人工确认计数） */
  accuracy_summary: { inferred: number; partial: number; high_confidence: number; verified: number };
}
