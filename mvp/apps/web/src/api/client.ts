// apps/web/src/api/client.ts —— fetch 封装 request<T>（TECH-WEB-AUTH-USER-001 §4 核心）
//
// 职责：
//   - 基址：import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'（D5）
//   - Header 注入：Bearer token（D6，除 skipAuth）、If-Match（D7，versioned + expectedVersion）
//   - 响应处理：200→json / 204→undefined / 401 拦截（D8）/ 409 重试（D9）/ wire 适配 error→code（D10）
//   - 网络错误兜底：fetch 抛 → ApiError code='NETWORK_ERROR'（AC-F7-3）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（tokenStore），禁止 import apps/api/src/**。
// [约束] D3：类型经 z.infer 派生自 contracts，禁止手写 TS 类型副本。
// [约束] D5：原生 fetch + URLSearchParams，禁止引入 axios/ky。
// [advisory] D10：wire 适配 INTERNAL_ERROR 降级码（非 contracts），ApiError.code 扩展含 INTERNAL_ERROR
//                以保证类型安全（spec §4.6 字面 `code: ErrorCode = ... : 'INTERNAL_ERROR'` 中 INTERNAL_ERROR
//                非 errorCodeSchema 选项，前端本地补码，对齐 spec §11 "非 contracts INTERNAL_ERROR" 行）。
import { errorCodeSchema, type ErrorCode } from '@admin/contracts';
import { getToken, clearToken } from '../auth/tokenStore.js';

export type RequestOptions = {
  body?: unknown;
  // R15 D8：扩展 query 值类型新增 string[]（承接报表 group_by 数组 query，对齐 server.ts m.query.getAll 语义）。
  // string/number/undefined 行为不变（后向兼容），string[] 为新增能力（repeated key）。
  query?: Record<string, string | number | string[] | undefined>;
  versioned?: boolean;
  expectedVersion?: number;
  skipAuth?: boolean;
};

/** 前端本地错误码（非 contracts，兜底用）：NETWORK_ERROR（fetch 抛错）+ INTERNAL_ERROR（wire 解析失败降级）。 */
type LocalErrorCode = 'NETWORK_ERROR' | 'INTERNAL_ERROR';

/**
 * API client 统一错误类型（contracts ErrorResponse 派生 + 前端本地 NETWORK_ERROR/INTERNAL_ERROR 兜底）。
 * code 经 wire 适配（§4.6）从响应体 error 字段映射而来；message/current_version 字段名 wire 与 contracts 一致。
 */
export class ApiError extends Error {
  readonly code: ErrorCode | LocalErrorCode;
  readonly current_version?: number;
  constructor(code: ErrorCode | LocalErrorCode, message: string, current_version?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    if (current_version !== undefined) {
      this.current_version = current_version;
    }
  }
}

/** 基址（D5 + §4.1）：import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'。 */
const BASE_URL: string =
  ((import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL) ??
  'http://localhost:3000';

/** 鉴权类 401 码（D8）：触发 clearToken + 跳 /login。 */
const AUTH_401_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'UNAUTHORIZED',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'TOKEN_REVOKED',
]);

/** wire 适配解析结果（§4.6）：code 可能为 INTERNAL_ERROR（解析失败降级）。 */
type ParsedError = {
  code: ErrorCode | 'INTERNAL_ERROR';
  message: string;
  current_version?: number;
};

/**
 * wire 格式错误响应体适配（§4.6，D10 [advisory]）。
 * 读 wire `error` 字段 → errorCodeSchema 校验 → 映射为 contracts `code`；
 * 解析失败降级 INTERNAL_ERROR（非 contracts 码，前端本地兜底）。
 * message/current_version 字段名 wire 与 contracts 一致，无需重命名；issues 等额外字段丢弃（D21）。
 */
function parseErrorResponse(body: unknown): ParsedError {
  const raw = (body ?? {}) as Record<string, unknown>;
  const wireCode = raw.error;
  const codeParse = errorCodeSchema.safeParse(wireCode);
  const code: ErrorCode | 'INTERNAL_ERROR' = codeParse.success ? codeParse.data : 'INTERNAL_ERROR';
  const resp: ParsedError = {
    code,
    message: typeof raw.message === 'string' ? raw.message : '操作失败',
  };
  if (typeof raw.current_version === 'number') {
    resp.current_version = raw.current_version;
  }
  return resp;
}

/** 跳 /login（D8）。client.ts 不依赖 router，用 window.location 最简；node 环境（测试）无 window 时跳过。 */
function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  try {
    window.location.href = '/login';
  } catch {
    // jsdom 导航限制：忽略
  }
}

/** 安全读 JSON 响应体（解析失败返回空对象，避免二次抛错致白屏）。 */
async function safeReadJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * 构建完整 URL（base + path + query string，D5 用 URLSearchParams）。
 * R15 D8：对 Array.isArray(value) 分支逐元素 append 为 repeated key（对齐 server.ts m.query.getAll），
 *         string/number/undefined 行为不变；空数组跳过避免拼接 `?key=` 空值。
 */
function buildUrl(
  path: string,
  query?: Record<string, string | number | string[] | undefined>,
): string {
  if (!query) return BASE_URL + path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      // 数组值：每个元素 append 为 repeated key（对齐 server.ts m.query.getAll）
      for (const v of value) params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${BASE_URL}${path}?${qs}` : `${BASE_URL}${path}`;
}

/** 构建请求 headers（Bearer D6 + If-Match D7 注入）。 */
function buildHeaders(opts: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (!opts.skipAuth) {
    const stored = getToken();
    if (stored?.token) {
      headers['Authorization'] = `Bearer ${stored.token}`;
    }
  }
  if (opts.versioned && opts.expectedVersion !== undefined) {
    headers['If-Match'] = String(opts.expectedVersion);
  }
  return headers;
}

/**
 * 统一 fetch 封装。AC-F5-1：前端所有 HTTP 调用经此函数，不直接调 fetch（除 client 内部）。
 * 实现 §4.1~§4.6：header 注入（D6/D7）/ 401 拦截（D8）/ 409 重试（D9）/ wire 适配（D10）。
 */
export async function request<T>(
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  return doRequest<T>(method, path, opts, false);
}

/** 内部实现，isRetry 标记防 409 重试活锁（D9 仅重试 1 次）。 */
async function doRequest<T>(
  method: string,
  path: string,
  opts: RequestOptions,
  isRetry: boolean,
): Promise<T> {
  const url = buildUrl(path, opts.query);
  const headers = buildHeaders(opts);
  const init: RequestInit = {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    // AC-F7-3：fetch 抛错（网络断开/服务不可达）→ NETWORK_ERROR 兜底
    throw new ApiError('NETWORK_ERROR', '网络异常，请稍后重试');
  }

  // 204 → undefined（logout 场景）
  if (res.status === 204) {
    return undefined as T;
  }

  // 401 拦截（D8）：先 wire 适配取 code，再按 code 分支
  // 多约束组合副作用 #1：401 分支先于 409（重试响应若 401 仍拦截终止重试链）
  if (res.status === 401) {
    const body = await safeReadJson(res);
    const err = parseErrorResponse(body);
    if (err.code === 'INVALID_CREDENTIALS') {
      // Q2 决策①：login 业务错误（凭据错），原样抛登录页，不拦截、不清 token
      throw new ApiError(err.code, err.message, err.current_version);
    }
    // 鉴权类 4 码 OR 解析失败降级 INTERNAL_ERROR（多约束组合 #2：401 解析失败按 UNAUTHORIZED 行为跳登录，避免白屏）
    if (err.code === 'INTERNAL_ERROR' || AUTH_401_CODES.has(err.code as ErrorCode)) {
      clearToken();
      redirectToLogin();
    }
    throw new ApiError(err.code, err.message, err.current_version);
  }

  // 409 重试（D9）：VERSION_CONFLICT + current_version + 未重试过 → 用 current_version 重试 1 次
  if (res.status === 409) {
    const body = await safeReadJson(res);
    const err = parseErrorResponse(body);
    if (err.code === 'VERSION_CONFLICT' && err.current_version !== undefined && !isRetry) {
      // 重试用 409 body current_version 作为新 expectedVersion（D9，不 GET 单条）
      // 重试响应再走 401/409 分支：401 仍拦截（终止），409 不再重试（isRetry=true）
      return doRequest<T>(method, path, { ...opts, expectedVersion: err.current_version }, true);
    }
    throw new ApiError(err.code, err.message, err.current_version);
  }

  // 200 → res.json()
  if (res.status >= 200 && res.status < 300) {
    return (await res.json()) as T;
  }

  // 其余 4xx/5xx → wire 适配抛 ApiError
  const body = await safeReadJson(res);
  const err = parseErrorResponse(body);
  throw new ApiError(err.code, err.message, err.current_version);
}
