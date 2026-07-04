// apps/web/test/api-audit-logs.test.ts —— ③类新增 审计域 API client 契约测（TECH-WEB-ROLE-DEPT-AUDIT-001 §9.3 T3）
//
// 覆盖 AC：AC-F7-1/F7-2/F7-3~F7-6（query 拼接 + 脱敏响应类型 RedactedAuditLog）、AC-F10-1、AC-ARCH-2
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - mock global.fetch + tokenStore（沿用 R12 api-client.test.ts 模式），让真实 client.request 运行。
//   - 期望「断言级红」：api/audit-logs.ts stub 抛 NOT_IMPLEMENTED，调用即抛 → fetch 未被调用 → 断言失败（非导入级红）。
//   - B3：query 仅 page/pageSize/operated_from/operated_to/operator_id/entity_type（无 action）。
//   - D10：items 为 RedactedAuditLog[]（脱敏态），禁用 auditLogSchema（存储态含未脱敏 PII）。
//   - D21：前端显式传 pageSize=20（不依赖 schema 缺省 20）。
//   - SEC-003b：测试中不 console.log/记录 operator_id/operator_name/before/after 字段。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AuditLogListResult, RedactedAuditLog } from '@admin/contracts';
import { listAuditLogs } from '../src/api/audit-logs.js';

// mock tokenStore
vi.mock('../src/auth/tokenStore.js', () => ({
  TOKEN_STORAGE_KEY: 'admin_token',
  getToken: vi.fn(() => ({ token: 'stub-token-audit', expires_at: '2026-12-31T00:00:00.000Z' })),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

/** 构造 fetch 响应 mock。 */
function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const OPERATOR_ID = '00000000-0000-4000-8000-0000000000op';
const ENTITY_ID = '00000000-0000-4000-8000-0000000000e1';

/** 脱敏审计日志 fixture（before/after 中 pii=true 字段值已脱敏为 ab***@example.com，D10）。 */
function makeRedactedLog(overrides: Partial<RedactedAuditLog> = {}): RedactedAuditLog {
  return {
    id: '00000000-0000-4000-8000-0000000000log',
    operator_id: OPERATOR_ID,
    operator_name: '管理员',
    entity_type: 'user',
    entity_id: ENTITY_ID,
    action: 'create',
    operated_at: '2026-07-03T10:00:00.000Z',
    before: [],
    after: [{ field: 'email', value: 'ab***@example.com', pii: true }],
    created_at: '2026-07-03T10:00:00.000Z',
    ...overrides,
  };
}

function makeListResult(items: RedactedAuditLog[], overrides: Partial<AuditLogListResult> = {}): AuditLogListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    totalPages: items.length === 0 ? 0 : 1,
    ...overrides,
  };
}

describe('api/audit-logs 审计域 endpoint 契约', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---------- AC-F7-1 listAuditLogs 默认分页 → GET /v1/audit-logs?page=1&pageSize=20 ----------
  it('listAuditLogs({page:1,pageSize:20}) → GET /v1/audit-logs?page=1&pageSize=20（AC-F7-1，D21）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeListResult([makeRedactedLog()])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await listAuditLogs({ page: 1, pageSize: 20 });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/audit-logs');
    expect(calledUrl).toContain('page=1');
    expect(calledUrl).toContain('pageSize=20');
    expect(result.items).toHaveLength(1);
  });

  // ---------- AC-F7-3 筛选 entity_type ----------
  it('listAuditLogs 筛选 entity_type=role → query 含 entity_type=role（AC-F7-3）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeListResult([])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await listAuditLogs({ page: 1, pageSize: 20, entity_type: 'role' });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('entity_type=role');
  });

  // ---------- AC-F7-4 筛选 operator_id ----------
  it('listAuditLogs 筛选 operator_id → query 含 operator_id=<uuid>（AC-F7-4）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeListResult([])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await listAuditLogs({ page: 1, pageSize: 20, operator_id: OPERATOR_ID });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain(`operator_id=${OPERATOR_ID}`);
  });

  // ---------- AC-F7-5 筛选 date_range（operated_from + operated_to）----------
  it('listAuditLogs 筛选 operated_from+operated_to → query 拼接 ISO（AC-F7-5）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeListResult([])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const operatedFrom = '2026-07-01T00:00:00.000Z';
    const operatedTo = '2026-07-03T23:59:59.000Z';
    await listAuditLogs({ page: 1, pageSize: 20, operated_from: operatedFrom, operated_to: operatedTo });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain(`operated_from=${encodeURIComponent(operatedFrom)}`);
    expect(calledUrl).toContain(`operated_to=${encodeURIComponent(operatedTo)}`);
  });

  // ---------- B3 反向核实：query 无 action ----------
  it('listAuditLogs query 不含 action（B3，contract 不支持 action 筛选）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeListResult([])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await listAuditLogs({ page: 1, pageSize: 20 });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).not.toContain('action=');
  });

  // ---------- AC-F7-6 筛选+分页复合（组合场景）----------
  it('listAuditLogs 筛选+分页复合 → query 同时含 entity_type + page=2（AC-F7-6，R13 S-3）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeListResult([], { page: 2, totalPages: 2, total: 25 })));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await listAuditLogs({ page: 2, pageSize: 20, entity_type: 'role' });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('entity_type=role');
    expect(calledUrl).toContain('page=2');
  });

  // ---------- D10 items 为 RedactedAuditLog[]（脱敏态）----------
  it('listAuditLogs 返回 items 为 RedactedAuditLog[]（D10，pii 字段已脱敏）', async () => {
    const log = makeRedactedLog({
      after: [{ field: 'email', value: 'ab***@example.com', pii: true }],
    });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeListResult([log])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await listAuditLogs({ page: 1, pageSize: 20 });

    const afterField = result.items[0]?.after[0];
    expect(afterField?.pii).toBe(true);
    // 脱敏值形态：首2字符+***+@+域名（匹配 redactedEmailSchema，AC-F7-10）
    expect(String(afterField?.value)).toMatch(/^.{2}\*\*\*@[^\s@]+$/);
  });

  // ---------- AC-F10-1 API client 复用 ----------
  it('listAuditLogs 经 client.request 发出（AC-F10-1）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeListResult([])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await listAuditLogs({ page: 1, pageSize: 20 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
