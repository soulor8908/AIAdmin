// apps/web/test/api-notifications.test.ts —— ③类新增 通知域 API client 契约测（TECH-WEB-NOTIFICATION-REPORT-001 §9.3 T1）
//
// 覆盖 AC：AC-F1-1（pageSize=20）、AC-F2-1（create body）、AC-F3-1（update versioned If-Match）、AC-F3-3/F3-4（409 重试）、
//          AC-F4-1（send versioned）、AC-F4-3（send 409 重试）、AC-F5-1（read versioned）、AC-F5-4（read 409 重试）、
//          AC-F6-1（delete versioned）、AC-F6-3（delete 409 重试幂等）、AC-F10-1/F10-2（Bearer/If-Match 注入）、AC-ARCH-2
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - mock global.fetch + tokenStore（沿用 R12 api-client.test.ts / R14 api-roles.test.ts 模式），让真实 client.request 运行，
//     验证 api/notifications.ts 经 request 发出正确 method/path/query/body/If-Match。
//   - 期望「断言级红」：api/notifications.ts stub 全部抛 NOT_IMPLEMENTED，调用即抛 → fetch 未被调用 → 断言失败（非导入级红）。
//   - wire 格式参考 apps/api/src/server.ts：错误响应 { code: <code>, message, current_version? }（字段名 code，对齐 contracts errorResponseSchema.code，D10 已消除）。
//   - D7：update/send/markRead/delete 须 versioned=true + expectedVersion → client 注入 If-Match（4 versioned 端点，N3）。
//   - D9：409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条）。
//   - D16：listNotifications 调用方显式传 pageSize=20（抹平契约缺省 10，N1）。
//   - SEC-003b：测试中不 console.log/记录 password 或 token 字符串。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Notification, NotificationListResult } from '@admin/contracts';
import {
  listNotifications,
  createNotification,
  updateNotification,
  sendNotification,
  markNotificationRead,
  deleteNotification,
} from '../src/api/notifications.js';
import { ApiError } from '../src/api/client.js';

// mock tokenStore（client 依赖 tokenStore 读 token，避免真实 localStorage）
vi.mock('../src/auth/tokenStore.js', () => ({
  TOKEN_STORAGE_KEY: 'admin_token',
  getToken: vi.fn(() => null),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

import { getToken } from '../src/auth/tokenStore.js';

// 占位 token（SEC-003b：不输出到日志，仅用于断言 header 值）
const TOKEN = 'stub-token-notif-xyz';

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

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '00000000-0000-4000-8000-0000000000n1',
    title: '测试通知',
    content: '测试内容',
    recipient_id: '00000000-0000-4000-8000-0000000000u1',
    status: 'draft',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    sent_at: null,
    read_at: null,
    version: 0,
    ...overrides,
  };
}

function makeListResult(
  items: Notification[],
  overrides: Partial<NotificationListResult> = {},
): NotificationListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    totalPages: items.length === 0 ? 0 : 1,
    ...overrides,
  };
}

describe('api/notifications 通知域 endpoint 契约', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
    vi.mocked(getToken).mockReturnValue({ token: TOKEN, expires_at: '2026-12-31T00:00:00.000Z' });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---------- AC-F1-1 listNotifications → GET /v1/notifications?page&pageSize=20 ----------
  it('listNotifications({page:1,pageSize:20}) → GET /v1/notifications?page=1&pageSize=20（AC-F1-1，D16）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeListResult([makeNotification()])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await listNotifications({ page: 1, pageSize: 20 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/notifications');
    expect(calledUrl).toContain('page=1');
    expect(calledUrl).toContain('pageSize=20');
    expect(result.items).toHaveLength(1);
  });

  // ---------- AC-F1-1 listNotifications with status 筛选 ----------
  it('listNotifications({page:1,pageSize:20,status:"sent"}) → query 含 status=sent（AC-F1-1/F1-3）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeListResult([])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await listNotifications({ page: 1, pageSize: 20, status: 'sent' });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('status=sent');
  });

  // ---------- AC-F2-1 createNotification → POST /v1/notifications body ----------
  it('createNotification({title,content,recipient_id}) → POST /v1/notifications body 含三字段（AC-F2-1）', async () => {
    const created = makeNotification({ title: '新通知', version: 0 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, created));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const input = {
      title: '新通知',
      content: '通知内容',
      recipient_id: '00000000-0000-4000-8000-0000000000u1',
    };
    const result = await createNotification(input);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('POST');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/notifications');
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual(input);
    expect(result.title).toBe('新通知');
    expect(result.status).toBe('draft');
    expect(result.version).toBe(0);
    expect(result.sent_at).toBeNull();
    expect(result.read_at).toBeNull();
  });

  // ---------- AC-F3-1 updateNotification 注入 If-Match（versioned）----------
  it('updateNotification(id, input, expectedVersion) → PATCH /v1/notifications/:id + If-Match（AC-F3-1，D7）', async () => {
    const updated = makeNotification({ title: '改后', version: 4 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, updated));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await updateNotification(
      '00000000-0000-4000-8000-0000000000n1',
      { title: '改后' },
      3,
    );

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/notifications/00000000-0000-4000-8000-0000000000n1');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('PATCH');
    const headers = init?.headers as Record<string, string>;
    expect(headers?.['If-Match']).toBe('3');
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({ title: '改后' });
    expect(result.version).toBe(4);
  });

  // ---------- AC-F4-1 sendNotification 注入 If-Match（versioned）----------
  it('sendNotification(id, expectedVersion) → POST /v1/notifications/:id/send + If-Match（AC-F4-1，D7）', async () => {
    const sent = makeNotification({ status: 'sent', sent_at: '2026-07-03T10:00:00.000Z', version: 4 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, sent));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await sendNotification('00000000-0000-4000-8000-0000000000n1', 3);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/notifications/00000000-0000-4000-8000-0000000000n1/send');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers?.['If-Match']).toBe('3');
    expect(result.status).toBe('sent');
    expect(result.sent_at).not.toBeNull();
  });

  // ---------- AC-F5-1 markNotificationRead 注入 If-Match（versioned）----------
  it('markNotificationRead(id, expectedVersion) → POST /v1/notifications/:id/read + If-Match（AC-F5-1，D7）', async () => {
    const read = makeNotification({ status: 'read', sent_at: '2026-07-03T10:00:00.000Z', read_at: '2026-07-03T11:00:00.000Z', version: 5 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, read));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await markNotificationRead('00000000-0000-4000-8000-0000000000n1', 4);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/notifications/00000000-0000-4000-8000-0000000000n1/read');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers?.['If-Match']).toBe('4');
    expect(result.status).toBe('read');
    expect(result.read_at).not.toBeNull();
  });

  // ---------- AC-F6-1 deleteNotification 注入 If-Match（versioned）----------
  it('deleteNotification(id, expectedVersion) → DELETE /v1/notifications/:id + If-Match（AC-F6-1，D7）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(204, {}));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await deleteNotification('00000000-0000-4000-8000-0000000000n1', 3);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/notifications/00000000-0000-4000-8000-0000000000n1');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('DELETE');
    const headers = init?.headers as Record<string, string>;
    expect(headers?.['If-Match']).toBe('3');
  });

  // ---------- AC-F3-3 updateNotification 409 VERSION_CONFLICT 自动重试（D9）----------
  it('updateNotification 409 VERSION_CONFLICT → 用 current_version 重试 1 次（AC-F3-3，D9）', async () => {
    const updated = makeNotification({ version: 5 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(409, { code: 'VERSION_CONFLICT', message: 'conflict', current_version: 5 }))
      .mockResolvedValueOnce(mockResponse(200, updated));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await updateNotification('00000000-0000-4000-8000-0000000000n1', { title: '改' }, 3);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const retryHeaders = retryInit?.headers as Record<string, string>;
    expect(retryHeaders?.['If-Match']).toBe('5');
  });

  // ---------- AC-F4-3 sendNotification 409 重试 ----------
  it('sendNotification 409 VERSION_CONFLICT → 用 current_version 重试 1 次（AC-F4-3，D9）', async () => {
    const sent = makeNotification({ status: 'sent', sent_at: '2026-07-03T10:00:00.000Z', version: 5 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(409, { code: 'VERSION_CONFLICT', message: 'conflict', current_version: 5 }))
      .mockResolvedValueOnce(mockResponse(200, sent));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await sendNotification('00000000-0000-4000-8000-0000000000n1', 3);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const retryHeaders = retryInit?.headers as Record<string, string>;
    expect(retryHeaders?.['If-Match']).toBe('5');
  });

  // ---------- AC-F5-4 markNotificationRead 409 重试 ----------
  it('markNotificationRead 409 VERSION_CONFLICT → 用 current_version 重试 1 次（AC-F5-4，D9）', async () => {
    const read = makeNotification({ status: 'read', read_at: '2026-07-03T11:00:00.000Z', version: 6 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(409, { code: 'VERSION_CONFLICT', message: 'conflict', current_version: 6 }))
      .mockResolvedValueOnce(mockResponse(200, read));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await markNotificationRead('00000000-0000-4000-8000-0000000000n1', 4);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const retryHeaders = retryInit?.headers as Record<string, string>;
    expect(retryHeaders?.['If-Match']).toBe('6');
  });

  // ---------- AC-F6-3 deleteNotification 409 重试（DELETE 幂等）----------
  it('deleteNotification 409 VERSION_CONFLICT → 用 current_version 重试 1 次（AC-F6-3，DELETE 幂等，D9）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(409, { code: 'VERSION_CONFLICT', message: 'conflict', current_version: 5 }))
      .mockResolvedValueOnce(mockResponse(204, {}));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await deleteNotification('00000000-0000-4000-8000-0000000000n1', 3);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const retryHeaders = retryInit?.headers as Record<string, string>;
    expect(retryHeaders?.['If-Match']).toBe('5');
    expect(retryInit?.method).toBe('DELETE');
  });

  // ---------- AC-F3-4 重试仍 409 → 抛 ApiError ----------
  it('updateNotification 重试仍 409 → 抛 ApiError(VERSION_CONFLICT)（AC-F3-4）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(409, { code: 'VERSION_CONFLICT', message: 'still conflict', current_version: 6 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(
      updateNotification('00000000-0000-4000-8000-0000000000n1', { title: '改' }, 3),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', current_version: 6 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  // ---------- AC-F10-2 Bearer token 注入 ----------
  it('已登录态 → Authorization: Bearer <token> 注入（AC-F10-2，R12 D6）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeListResult([])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await listNotifications({ page: 1, pageSize: 20 });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init?.headers as Record<string, string>;
    expect(headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  // ---------- wire 适配 通知域错误码（AC-ARCH-2 类型 contracts 派生）----------
  it('wire 适配：{code:"NOTIFICATION_NOT_FOUND"} → ApiError.code === "NOTIFICATION_NOT_FOUND"（AC-ARCH-2）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(404, { code: 'NOTIFICATION_NOT_FOUND', message: '通知不存在' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(
      deleteNotification('00000000-0000-4000-8000-0000000000n1', 0),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      deleteNotification('00000000-0000-4000-8000-0000000000n1', 0),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });
  });

  // ---------- wire 适配 NOTIFICATION_INVALID_TRANSITION（非 VERSION_CONFLICT，不重试）----------
  it('wire 适配：{code:"NOTIFICATION_INVALID_TRANSITION"} 不触发 409 重试（AC-ARCH-2，D7 多约束组合副作用 #1）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(409, { code: 'NOTIFICATION_INVALID_TRANSITION', message: '状态不允许此操作' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(
      sendNotification('00000000-0000-4000-8000-0000000000n1', 0),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_INVALID_TRANSITION' });
    // 非 VERSION_CONFLICT → 不重试，仅 1 次调用
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ---------- wire 适配 NOTIFICATION_RECIPIENT_NOT_FOUND（N4 send 时延后校验）----------
  it('wire 适配：{code:"NOTIFICATION_RECIPIENT_NOT_FOUND"} → ApiError.code（AC-F4-4，N4）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(404, { code: 'NOTIFICATION_RECIPIENT_NOT_FOUND', message: '收件人不存在' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(
      sendNotification('00000000-0000-4000-8000-0000000000n1', 0),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_RECIPIENT_NOT_FOUND' });
  });

  // ---------- AC-F10-1 经 client.request 发出（不直接调 fetch）----------
  it('listNotifications 经 client.request 发出 fetch（AC-F10-1，不直接调 fetch）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeListResult([makeNotification()])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await listNotifications({ page: 1, pageSize: 20 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('GET');
  });
});
