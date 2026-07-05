// apps/web/src/api/client.ts —— fetch 封装 request<T>（TECH-WEB-AUTH-USER-001 §4 核心 + TECH-ETAG-CACHING-001 D7 前端消费）
//
// 职责：
//   - 基址：import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'（D5）
//   - Header 注入：Bearer token（D6，除 skipAuth）、If-Match（D7，versioned + expectedVersion）
//     + If-None-Match（TECH-ETAG-CACHING-001 D7：cacheable 端点协商缓存，基于上次 ETag）
//   - 响应处理：200→json / 204→undefined / 304→返回缓存（TECH-ETAG-CACHING-001）/ 401 拦截（D8）/ 409 重试（D9）/ 错误体读 raw.code（D10 已消除）
//   - 网络错误兜底：fetch 抛 → ApiError code='NETWORK_ERROR'（AC-F7-3）
//   - ETag 缓存：cacheable 端点（GET /v1/users, /v1/roles, /v1/notifications 等）的 200 响应携带 ETag，
//     下次同路径请求注入 If-None-Match；服务端匹配则返 304，client 返回上次缓存的 body（避免重新解析）。
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（tokenStore），禁止 import apps/api/src/**。
// [约束] D3：类型经 z.infer 派生自 contracts，禁止手写 TS 类型副本。
// [约束] D5：原生 fetch + URLSearchParams，禁止引入 axios/ky。
// [约束] D10 已消除（R18，TECH-USER-DETAIL-WIRE-001 D1）：wire 字段名已对齐 contracts errorResponseSchema.code，
//          parseErrorResponse 直接读 raw.code，不再读 raw.error 适配。INTERNAL_ERROR 仍为前端本地补码（D7，
//          非 contracts 码 fallback，与 D10 wire 适配独立，未消除）——ApiError.code 扩展含 INTERNAL_ERROR
//          以保证类型安全（spec §11 "非 contracts INTERNAL_ERROR" 行，server 发 INTERNAL_ERROR → client 收到一致）。
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
  /**
   * 是否启用 ETag 协商缓存（TECH-ETAG-CACHING-001 D7 前端消费）。
   * cacheable=true 时：200 响应的 ETag 被缓存，下次同方法+路径请求注入 If-None-Match；
   * 服务端匹配返 304 → client 返回上次缓存的 body（无网络传输体，省带宽 + 解析）。
   * 缺省 false（写操作/不可缓存端点不启用）。
   */
  cacheable?: boolean;
};

/** 前端本地错误码（非 contracts，兜底用）：NETWORK_ERROR（fetch 抛错）+ INTERNAL_ERROR（wire 解析失败降级）。 */
type LocalErrorCode = 'NETWORK_ERROR' | 'INTERNAL_ERROR';

/**
 * API client 统一错误类型（contracts ErrorResponse 派生 + 前端本地 NETWORK_ERROR/INTERNAL_ERROR 兜底）。
 * code 直接读响应体 code 字段（D10 已消除，wire 与 contracts 字段名一致）；message/current_version 字段名 wire 与 contracts 一致。
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

/**
 * ETag 协商缓存存储（TECH-ETAG-CACHING-001 D7 前端消费）。
 * key = `${method} ${path}`（不含 query；query 变化由调用方控制，同 path 不同 query 视为不同资源，
 * 简化处理：query 变化时 ETag 不命中，服务端返 200 + 新 ETag，自动覆盖）。
 * value = { etag, body }（上次 200 响应的 ETag + 解析后的 body，304 时直接返回缓存的 body）。
 *
 * 设计取舍：用模块级 Map 而非 sessionStorage —— SPA 生命周期内有效，刷新页清空（避免持久化脏缓存）。
 * 生产级实现应考虑缓存淘汰策略（LRU）+ 大 body 内存压力，MVP 规模下 Map 足够。
 */
interface EtagCacheEntry {
  etag: string;
  body: unknown;
}
const etagCache = new Map<string, EtagCacheEntry>();

/** 错误响应解析结果（§4.6，D10 已消除）：code 可能为 INTERNAL_ERROR（解析失败降级，D7 非 contracts 码 fallback）。 */
type ParsedError = {
  code: ErrorCode | 'INTERNAL_ERROR';
  message: string;
  current_version?: number;
};

/**
 * 错误响应体解析（§4.6，D10 已消除 R18）。
 * 直接读 wire `code` 字段（与 contracts errorResponseSchema.code 一致）→ errorCodeSchema.safeParse 校验；
 * 解析失败降级 INTERNAL_ERROR（非 contracts 码，前端本地兜底，D7）。
 * 保留 safeParse + fallback（D7）：INTERNAL_ERROR/NOT_FOUND 非 contracts 码仍降级，不扩 errorCodeSchema（Q2）。
 * 保留手动读字段（不 errorResponseSchema.parse(body) 直校）：D21 issues 仍存在（Q7 不消除），.strict() 会拒绝含 issues 的 body。
 * message/current_version 字段名 wire 与 contracts 一致，无需重命名；issues 等额外字段丢弃（D21）。
 */
function parseErrorResponse(body: unknown): ParsedError {
  const raw = (body ?? {}) as Record<string, unknown>;
  const wireCode = raw.code;   // D10 已消除（R18）：直接读 raw.code，原 raw.error wire 适配已删除
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

/** 构建请求 headers（Bearer D6 + If-Match D7 + If-None-Match D7 注入）。 */
function buildHeaders(opts: RequestOptions, etagKey: string | null): Record<string, string> {
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
  // TECH-ETAG-CACHING-001 D7：cacheable 端点注入 If-None-Match（基于上次同 path 的 ETag 缓存）
  if (opts.cacheable && etagKey !== null) {
    const cached = etagCache.get(etagKey);
    if (cached) {
      headers['If-None-Match'] = cached.etag;
    }
  }
  return headers;
}

/**
 * 统一 fetch 封装。AC-F5-1：前端所有 HTTP 调用经此函数，不直接调 fetch（除 client 内部）。
 * 实现 §4.1~§4.6：header 注入（D6/D7）/ 401 拦截（D8）/ 409 重试（D9）/ 错误体读 raw.code（D10 已消除）。
 * TECH-ETAG-CACHING-001 D7：cacheable 端点 304 → 返回缓存 body（协商缓存消费）。
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
  // TECH-ETAG-CACHING-001 D7：ETag 缓存 key（method + path，不含 query）
  const etagKey = opts.cacheable ? `${method} ${path}` : null;
  const url = buildUrl(path, opts.query);
  const headers = buildHeaders(opts, etagKey);
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

  // TECH-ETAG-CACHING-001 D7：304 Not Modified → 返回上次缓存的 body（协商缓存命中）
  // 服务端 If-None-Match 匹配时返 304（空体 + ETag header），client 直接返回上次 200 缓存的 body。
  // 缓存丢失（理论上不会发生，因 If-None-Match 只在缓存存在时注入）→ 降级走 200 路径重新拉取。
  if (res.status === 304 && etagKey !== null) {
    const cached = etagCache.get(etagKey);
    if (cached) {
      return cached.body as T;
    }
    // 缓存丢失：降级抛错（不应发生，防御性处理）
    throw new ApiError('INTERNAL_ERROR', '协商缓存命中但本地缓存丢失');
  }

  // 401 拦截（D8）：先解析错误体取 code（D10 已消除，直接读 raw.code），再按 code 分支
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

  // 200 → res.json() + 缓存 ETag（cacheable 端点）
  if (res.status >= 200 && res.status < 300) {
    const body = (await res.json()) as T;
    // TECH-ETAG-CACHING-001 D7：缓存 200 响应的 ETag + body，供下次 If-None-Match 协商
    if (opts.cacheable && etagKey !== null) {
      const etag = res.headers.get('ETag');
      if (etag) {
        etagCache.set(etagKey, { etag, body });
      }
    }
    return body;
  }

  // 其余 4xx/5xx → 解析错误体抛 ApiError（D10 已消除，直接读 raw.code）
  const body = await safeReadJson(res);
  const err = parseErrorResponse(body);
  throw new ApiError(err.code, err.message, err.current_version);
}

/**
 * 清除指定路径的 ETag 缓存（TECH-ETAG-CACHING-001 D7）。
 * 写操作成功后调用，确保下次 GET 拉取最新数据而非命中过期缓存。
 * @param method HTTP 方法（如 'GET'）
 * @param path API 路径（如 '/v1/users'）
 */
export function invalidateEtagCache(method: string, path: string): void {
  etagCache.delete(`${method} ${path}`);
}

/** 清除所有 ETag 缓存（logout 等场景，避免跨账号缓存污染）。 */
export function clearEtagCache(): void {
  etagCache.clear();
}
