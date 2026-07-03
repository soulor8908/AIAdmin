// apps/web/src/api/client.ts —— fetch 封装 request<T>（TECH-WEB-AUTH-USER-001 §4 核心）
//
// 职责（impl-writer 落地，本文件为 stub）：
//   - 基址：import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'（D5）
//   - Header 注入：Bearer token（D6，除 skipAuth）、If-Match（D7，versioned + expectedVersion）
//   - 响应处理：200→json / 204→undefined / 401 拦截（D8）/ 409 重试（D9）/ wire 适配 error→code（D10）
//   - 网络错误兜底：fetch 抛 → ApiError code='NETWORK_ERROR'（AC-F7-3）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（tokenStore），禁止 import apps/api/src/**。
// [约束] D3：类型经 z.infer 派生自 contracts，禁止手写 TS 类型副本。
// [约束] D5：原生 fetch + URLSearchParams，禁止引入 axios/ky。
//
// stub 说明：request() 抛 NOT_IMPLEMENTED（断言级红，非导入级红）。ApiError 为类型定义（构造器赋字段，无逻辑）。
import type { ErrorCode } from '@admin/contracts';

export type RequestOptions = {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  versioned?: boolean;
  expectedVersion?: number;
  skipAuth?: boolean;
};

/**
 * API client 统一错误类型（contracts ErrorResponse 派生 + 前端本地 NETWORK_ERROR 兜底）。
 * code 经 wire 适配（§4.6）从响应体 error 字段映射而来；message/current_version 字段名 wire 与 contracts 一致。
 */
export class ApiError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR';
  readonly current_version?: number;
  constructor(code: ErrorCode | 'NETWORK_ERROR', message: string, current_version?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    if (current_version !== undefined) {
      this.current_version = current_version;
    }
  }
}

/**
 * 统一 fetch 封装。AC-F5-1：前端所有 HTTP 调用经此函数，不直接调 fetch（除 client 内部）。
 * impl-writer 须实现 §4.1~§4.6 全部行为（header 注入 / 401 拦截 / 409 重试 / wire 适配）。
 */
export async function request<T>(
  _method: string,
  _path: string,
  _opts: RequestOptions = {},
): Promise<T> {
  throw new Error('NOT_IMPLEMENTED');
}
