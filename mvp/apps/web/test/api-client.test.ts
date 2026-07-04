// apps/web/test/api-client.test.ts —— ③类新增 API client 单测（TECH-WEB-AUTH-USER-001 §9.3 #1）
//
// 覆盖 AC：AC-F5-1/2/3/4/5、AC-F7-1/3、AC-F4-3/4/7、AC-ARCH-2
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - mock global.fetch + mock tokenStore（vi.mock），验证 request() 的 header 注入 / 401 拦截 / 409 重试 / wire 适配。
//   - 期望「断言级红」：request() stub 抛 NOT_IMPLEMENTED，所有行为断言失败（非导入级红，因 client.ts 已导出 request/ApiError/RequestOptions）。
//   - 期望「导入级红」符号：无（全部符号已导出）。
//   - wire 格式参考 apps/api/src/server.ts L594：响应体 { code: <code>, message, current_version? }（字段名 code，对齐 contracts errorResponseSchema.code，D10 已消除）。
//   - 401 拦截 4 鉴权码（D8）：UNAUTHORIZED / TOKEN_INVALID / TOKEN_EXPIRED / TOKEN_REVOKED → clearToken + 抛错。
//   - INVALID_CREDENTIALS 401 不拦截（Q2 决策①，login 业务错误非鉴权失败）。
//   - 409 VERSION_CONFLICT + current_version → 重试 1 次，重试 If-Match = current_version（D9）。
//   - SEC-003b：测试中不 console.log/记录 password 或 token 字符串（token 仅用占位常量，不输出）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { request, ApiError, type RequestOptions } from '../src/api/client.js';

// mock tokenStore（client 依赖 tokenStore 读 token，避免真实 localStorage）
vi.mock('../src/auth/tokenStore.js', () => ({
  TOKEN_STORAGE_KEY: 'admin_token',
  getToken: vi.fn(() => null),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

import { getToken, setToken, clearToken } from '../src/auth/tokenStore.js';

// 占位 token（SEC-003b：不输出到日志，仅用于断言 header 值）
const TOKEN = 'stub-token-xyz';

/** 构造 fetch 响应 mock（wire 格式：body 含 code/message/current_version 字段名，D10 已消除）。 */
function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('api client request()', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---------- AC-F5-2 Bearer token 自动注入 ----------
  it('注入 Authorization: Bearer <token>（已登录态，AC-F5-2）', async () => {
    vi.mocked(getToken).mockReturnValue({ token: TOKEN, expires_at: '2026-12-31T00:00:00.000Z' });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await request('GET', '/v1/users');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init?.headers as Record<string, string>;
    expect(headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('skipAuth=true 不注入 Bearer（login 用，AC-F5-2 例外）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { token: 't' }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await request('POST', '/v1/auth/login', {
      body: { email: 'a@b.com', password: 'password123' },
      skipAuth: true,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init?.headers as Record<string, string>;
    expect(headers?.Authorization).toBeUndefined();
  });

  // ---------- AC-F5-3 If-Match 注入 ----------
  it('versioned=true + expectedVersion → 注入 If-Match header（AC-F5-3/AC-F4-7）', async () => {
    vi.mocked(getToken).mockReturnValue({ token: TOKEN, expires_at: '2026-12-31T00:00:00.000Z' });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { id: 'u1', version: 5 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await request('PATCH', '/v1/users/u1/status', {
      body: { status: 'disabled' },
      versioned: true,
      expectedVersion: 4,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init?.headers as Record<string, string>;
    expect(headers?.['If-Match']).toBe('4');
  });

  // ---------- AC-F7-1 401 拦截（4 鉴权码）----------
  it.each(['UNAUTHORIZED', 'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_REVOKED'] as const)(
    '401 %s → clearToken + 抛错（AC-F7-1，D8）',
    async (code) => {
      vi.mocked(getToken).mockReturnValue({ token: TOKEN, expires_at: '2026-12-31T00:00:00.000Z' });
      const fetchMock = vi.fn().mockResolvedValue(mockResponse(401, { code: code, message: 'auth fail' }));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await expect(request('GET', '/v1/users')).rejects.toMatchObject({ code });
      expect(clearToken).toHaveBeenCalled();
    },
  );

  // ---------- Q2 决策① INVALID_CREDENTIALS 不拦截 ----------
  it('401 INVALID_CREDENTIALS 不拦截（不调 clearToken），原样抛（Q2 决策①）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(401, { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(
      request('POST', '/v1/auth/login', {
        body: { email: 'a@b.com', password: 'wrongpass1' },
        skipAuth: true,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(clearToken).not.toHaveBeenCalled();
  });

  // ---------- AC-F4-3 409 VERSION_CONFLICT 重试 ----------
  it('409 VERSION_CONFLICT + current_version → 重试 1 次，重试 If-Match = current_version（AC-F4-3，D9）', async () => {
    vi.mocked(getToken).mockReturnValue({ token: TOKEN, expires_at: '2026-12-31T00:00:00.000Z' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(409, { code: 'VERSION_CONFLICT', message: 'conflict', current_version: 5 }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'u1', status: 'disabled', version: 5 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await request('PATCH', '/v1/users/u1/status', {
      body: { status: 'disabled' },
      versioned: true,
      expectedVersion: 4,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const retryHeaders = retryInit?.headers as Record<string, string>;
    expect(retryHeaders?.['If-Match']).toBe('5');
    expect(result).toMatchObject({ version: 5 });
  });

  // ---------- AC-F4-4 重试仍 409 → 抛错 ----------
  it('409 重试仍 409 → 抛 ApiError（含 current_version，AC-F4-4）', async () => {
    vi.mocked(getToken).mockReturnValue({ token: TOKEN, expires_at: '2026-12-31T00:00:00.000Z' });
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(409, { code: 'VERSION_CONFLICT', message: 'still conflict', current_version: 6 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(
      request('PATCH', '/v1/users/u1/status', {
        body: { status: 'disabled' },
        versioned: true,
        expectedVersion: 4,
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', current_version: 6 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  // ---------- D10 wire 字段对齐 error→code（已消除）----------
  it('wire 字段对齐：响应 {code:"USER_NOT_FOUND"} → ApiError.code === "USER_NOT_FOUND"（D10 已消除）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(404, { code: 'USER_NOT_FOUND', message: '用户不存在' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      await request('GET', '/v1/users/nonexistent');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('USER_NOT_FOUND');
      expect((e as ApiError).message).toBe('用户不存在');
    }
  });

  // ---------- AC-F7-3 网络错误兜底 ----------
  it('网络错误：fetch 抛 → ApiError.code === "NETWORK_ERROR"（AC-F7-3）', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof globalThis.fetch;

    try {
      await request('GET', '/v1/users');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('NETWORK_ERROR');
    }
  });

  // ---------- 200 → res.json() ----------
  it('200 → 返回 res.json()（AC-F5-1）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { id: 'u1', name: 'Alice' }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await request<{ id: string; name: string }>('GET', '/v1/users/u1');
    expect(result).toEqual({ id: 'u1', name: 'Alice' });
  });

  // ---------- 204 → undefined ----------
  it('204 → 返回 undefined（logout 场景）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(204, {}));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await request<void>('POST', '/v1/auth/logout');
    expect(result).toBeUndefined();
  });

  // ---------- AC-ARCH-2 类型全部 contracts 派生（tsc 保证，此断言验证 RequestOptions 结构）----------
  it('RequestOptions 类型结构对齐 Tech-Spec §4.1 签名（AC-ARCH-2，tsc 保证）', () => {
    const opts: RequestOptions = {
      body: { status: 'disabled' },
      query: { page: 1 },
      versioned: true,
      expectedVersion: 4,
      skipAuth: false,
    };
    expect(opts.versioned).toBe(true);
    expect(opts.expectedVersion).toBe(4);
  });
});
