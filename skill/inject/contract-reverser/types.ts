// inject/contract-reverser/types.ts —— P2-3 API 逆向契约类型
export interface ReversedEndpoint {
  method: string;
  path: string;
  handler_file?: string;
  request_schema?: unknown;
  response_schema?: unknown;
  confidence: number;
  notes?: string;
}

export interface ReversedOpenApi {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
}

export interface ReverseResult {
  endpoints: ReversedEndpoint[];
  openapi: ReversedOpenApi;
  markdown_report: string;
  warnings: string[];
}
