// apps/web/test/api-reports.test.ts —— ③类新增 报表域 API client 契约测（TECH-WEB-NOTIFICATION-REPORT-001 §9.3 T2）
//
// 覆盖 AC：AC-F7-1（group_by repeated key 拼接，D8 string[] query）、AC-F7-2（时间范围 ISO query）、
//          AC-F7-4（entity_type/action query）、AC-F7-5（分页 query）、AC-F7-8（ReportResult 动态维度响应类型）、
//          AC-F9-2（REPORT_GROUP_BY_REQUIRED/REPORT_TIME_RANGE_INVALID 码映射）、AC-ARCH-2
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - mock global.fetch + tokenStore（沿用 R12 api-client.test.ts / R14 api-roles.test.ts 模式），让真实 client.request 运行，
//     验证 api/reports.ts 经 request 发出正确 method/path/query（含 group_by repeated key）。
//   - 期望「断言级红」：api/reports.ts stub 抛 NOT_IMPLEMENTED，调用即抛 → fetch 未被调用 → 断言失败（非导入级红）。
//   - D8 [约束]：group_by 为数组，经扩展后的 RequestOptions.query（支持 string[]）拼接为 repeated key（?group_by=A&group_by=B）。
//     impl-writer 须扩展 client.ts RequestOptions.query 支持 string[] + buildUrl 对数组值多次 append。
//   - wire 格式参考 apps/api/src/server.ts：错误响应 { error: <code>, message, current_version? }（字段名 error）。
//   - server.ts L341 `m.query.getAll('group_by')` 语义：repeated key 收集为数组。
//   - SEC-003b：测试中不 console.log/记录 password 或 token 字符串。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReportResult } from '@admin/contracts';
import { queryOperations } from '../src/api/reports.js';
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
const TOKEN = 'stub-token-report-xyz';

/** 构造 fetch 响应 mock（wire 格式：body 含 error/message/current_version 字段名）。 */
function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function makeReportResult(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    items: [
      { operator_id: '00000000-0000-4000-8000-0000000000u1', count: 5 },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    group_by: ['operator_id'],
    ...overrides,
  };
}

describe('api/reports 报表域 endpoint 契约', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
    vi.mocked(getToken).mockReturnValue({ token: TOKEN, expires_at: '2026-12-31T00:00:00.000Z' });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---------- AC-F7-1 group_by 多维 repeated key 拼接（D8 string[] query）----------
  it('queryOperations({group_by:["operator_id","date"]}) → URL 含 group_by=operator_id&group_by=date（AC-F7-1，D8）', async () => {
    const result = makeReportResult({
      items: [
        { operator_id: '00000000-0000-4000-8000-0000000000u1', date: '2026-07-03', count: 3 },
      ],
      group_by: ['operator_id', 'date'],
    });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, result));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await queryOperations({
      group_by: ['operator_id', 'date'],
      page: 1,
      pageSize: 20,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/reports/operations');
    // D8 repeated key：group_by=operator_id&group_by=date（非 group_by=operator_id%2Cdate）
    expect(calledUrl).toContain('group_by=operator_id');
    expect(calledUrl).toContain('group_by=date');
    // 两个 group_by 参数都出现（repeated key）
    const groupByMatches = calledUrl.match(/group_by=/g);
    expect(groupByMatches).toHaveLength(2);
  });

  // ---------- AC-F7-1 group_by 单维 ----------
  it('queryOperations({group_by:["entity_type"]}) → URL 含 group_by=entity_type（AC-F7-1）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeReportResult({ group_by: ['entity_type'] })));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await queryOperations({
      group_by: ['entity_type'],
      page: 1,
      pageSize: 20,
    });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('group_by=entity_type');
  });

  // ---------- AC-F7-2 时间范围 ISO query ----------
  it('queryOperations 含 operated_from/operated_to → URL 含 ISO 参数（AC-F7-2，D14）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeReportResult()));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await queryOperations({
      group_by: ['operator_id'],
      operated_from: '2026-07-01T00:00:00.000Z',
      operated_to: '2026-07-03T23:59:59.000Z',
      page: 1,
      pageSize: 20,
    });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('operated_from=2026-07-01T00%3A00%3A00.000Z');
    expect(calledUrl).toContain('operated_to=2026-07-03T23%3A59%3A59.000Z');
  });

  // ---------- AC-F7-3 operator_id 筛选 query ----------
  it('queryOperations 含 operator_id → URL 含 operator_id 参数（AC-F7-3）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeReportResult()));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await queryOperations({
      group_by: ['operator_id'],
      operator_id: '00000000-0000-4000-8000-0000000000u1',
      page: 1,
      pageSize: 20,
    });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('operator_id=00000000-0000-4000-8000-0000000000u1');
  });

  // ---------- AC-F7-4 entity_type + action 筛选 query ----------
  it('queryOperations 含 entity_type=role + action=create → URL 含筛选参数（AC-F7-4）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeReportResult()));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await queryOperations({
      group_by: ['entity_type', 'action'],
      entity_type: 'role',
      action: 'create',
      page: 1,
      pageSize: 20,
    });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('entity_type=role');
    expect(calledUrl).toContain('action=create');
  });

  // ---------- AC-F7-5 分页 query ----------
  it('queryOperations({page:2,pageSize:20}) → URL 含 page=2&pageSize=20（AC-F7-5）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeReportResult({ page: 2 })));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await queryOperations({
      group_by: ['operator_id'],
      page: 2,
      pageSize: 20,
    });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('page=2');
    expect(calledUrl).toContain('pageSize=20');
  });

  // ---------- AC-F7-8 ReportResult 动态维度响应类型（多维 items）----------
  it('queryOperations 响应 ReportResult 动态维度 items（AC-F7-8，N6）', async () => {
    const multiDimResult = makeReportResult({
      items: [
        { operator_id: '00000000-0000-4000-8000-0000000000u1', date: '2026-07-03', count: 3 },
        { operator_id: '00000000-0000-4000-8000-0000000000u2', date: '2026-07-03', count: 7 },
      ],
      total: 2,
      group_by: ['operator_id', 'date'],
    });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, multiDimResult));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await queryOperations({
      group_by: ['operator_id', 'date'],
      page: 1,
      pageSize: 20,
    });

    expect(result.items).toHaveLength(2);
    expect(result.group_by).toEqual(['operator_id', 'date']);
    expect(result.items[0]?.count).toBe(3);
    expect(result.items[0]?.operator_id).toBe('00000000-0000-4000-8000-0000000000u1');
    expect(result.items[0]?.date).toBe('2026-07-03');
  });

  // ---------- AC-F9-2 REPORT_GROUP_BY_REQUIRED 码映射 ----------
  it('wire 适配：{error:"REPORT_GROUP_BY_REQUIRED"} → ApiError.code（AC-F9-2，N5）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(400, { error: 'REPORT_GROUP_BY_REQUIRED', message: '请至少选择一个分组维度' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(
      queryOperations({ page: 1, pageSize: 20 }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      queryOperations({ page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ code: 'REPORT_GROUP_BY_REQUIRED' });
  });

  // ---------- AC-F9-2 REPORT_TIME_RANGE_INVALID 码映射 ----------
  it('wire 适配：{error:"REPORT_TIME_RANGE_INVALID"} → ApiError.code（AC-F9-2，N5）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(400, { error: 'REPORT_TIME_RANGE_INVALID', message: '时间范围非法' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(
      queryOperations({
        group_by: ['operator_id'],
        operated_from: '2026-07-03T00:00:00.000Z',
        operated_to: '2026-07-01T00:00:00.000Z',
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toMatchObject({ code: 'REPORT_TIME_RANGE_INVALID' });
  });

  // ---------- AC-F10-2 Bearer token 注入 ----------
  it('已登录态 → Authorization: Bearer <token> 注入（AC-F10-2，R12 D6）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeReportResult()));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await queryOperations({
      group_by: ['operator_id'],
      page: 1,
      pageSize: 20,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init?.headers as Record<string, string>;
    expect(headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  // ---------- AC-F10-1 经 client.request 发出（GET method）----------
  it('queryOperations 经 client.request 发出 GET（AC-F10-1，不直接调 fetch）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeReportResult()));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await queryOperations({
      group_by: ['operator_id'],
      page: 1,
      pageSize: 20,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('GET');
  });
});
