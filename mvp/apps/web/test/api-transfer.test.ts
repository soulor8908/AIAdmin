// apps/web/test/api-transfer.test.ts —— ③类新增 调岗域 API client 契约测（TECH-WEB-TRANSFER-INHERITANCE-001 §9.3 T1）
//
// 覆盖 AC：AC-F1-3（transfer POST 非 versioned 不传 If-Match，T4/D8 + body={toDepartmentId, oldRoleId, newRoleId}，userId 在 path）、
//          AC-F3-1~F3-7（各错误码 wire 适配，T1 SSOT 真实码非臆造）、AC-F10-1/F10-2（Bearer 注入非 versioned 不注入 If-Match）、
//          AC-ARCH-2（类型 contracts 派生）
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - mock global.fetch + tokenStore（沿用 R12/R14 api-roles.test.ts 模式），让真实 client.request 运行，
//     验证 api/transfer.ts 经 request 发出正确 method/path/body/If-Match（非 versioned 不注入 If-Match）。
//   - 期望「断言级红」：api/transfer.ts stub 抛 NOT_IMPLEMENTED，调用即抛 → fetch 未被调用 → 断言失败（非导入级红）。
//   - wire 格式参考 apps/api/src/server.ts：错误响应 { error: <code>, message, current_version? }（字段名 error）。
//   - D8/T4：transfer 非 versioned，不传 versioned/expectedVersion → client 不注入 If-Match（区别于 R14/R15 versioned 写端点）。
//   - D19/T1：错误码遵循 contracts SSOT，USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN 复用各域既有码
//             （非臆造 TRANSFER_*_NOT_FOUND）；transfer 专属码 TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_FAILED/TRANSFER_COMPENSATION_FAILED。
//   - R15 S-13：fixture 须用有效 hex UUID（如 00000000-0000-4000-8000-000000000001），避免 z.string().uuid() 严格校验拒绝非 hex 字符。
//   - SEC-003b：测试中不 console.log/记录 password 或 token 字符串。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { TransferInput } from '@admin/contracts';
import { transferUser } from '../src/api/transfer.js';
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
const TOKEN = 'stub-token-transfer-xyz';

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

// 有效 hex UUID（R15 S-13：z.string().uuid() 严格校验，须全 hex 字符）
const USER_ID = '00000000-0000-4000-8000-000000000001';
const DEPT_ID = '00000000-0000-4000-8000-0000000000d1';
const OLD_ROLE_ID = '00000000-0000-4000-8000-0000000000b1';
const NEW_ROLE_ID = '00000000-0000-4000-8000-0000000000c1';

function makeTransferInput(overrides: Partial<TransferInput> = {}): TransferInput {
  return {
    userId: USER_ID,
    toDepartmentId: DEPT_ID,
    oldRoleId: OLD_ROLE_ID,
    newRoleId: NEW_ROLE_ID,
    ...overrides,
  };
}

describe('api/transfer 调岗域 endpoint 契约', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
    vi.mocked(getToken).mockReturnValue({ token: TOKEN, expires_at: '2026-12-31T00:00:00.000Z' });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---------- AC-F1-3 transferUser → POST /v1/users/:userId/transfer（非 versioned，T4/D8）----------
  it('transferUser(input) → POST /v1/users/:userId/transfer，body={toDepartmentId, oldRoleId, newRoleId}（AC-F1-3，T4 path+body 合并）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(204, {}));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await transferUser(makeTransferInput());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/users/00000000-0000-4000-8000-000000000001/transfer');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    // body 仅含 toDepartmentId/oldRoleId/newRoleId（userId 在 path，T4）
    expect(body).toEqual({
      toDepartmentId: DEPT_ID,
      oldRoleId: OLD_ROLE_ID,
      newRoleId: NEW_ROLE_ID,
    });
    expect(body).not.toHaveProperty('userId');
  });

  // ---------- AC-F1-3 非 versioned 不注入 If-Match（D8/T4，区别于 R14/R15 versioned 写端点）----------
  it('transferUser 非 versioned → 不注入 If-Match header（AC-F1-3，D8/T4）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(204, {}));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await transferUser(makeTransferInput());

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init?.headers as Record<string, string>;
    expect(headers?.['If-Match']).toBeUndefined();
  });

  // ---------- AC-F10-2 Bearer token 注入（非 versioned 仍注入 Bearer）----------
  it('已登录态 → Authorization: Bearer <token> 注入（AC-F10-2，R12 D6）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(204, {}));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await transferUser(makeTransferInput());

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init?.headers as Record<string, string>;
    expect(headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  // ---------- AC-F3-6 TRANSFER_FAILED 聚合码 wire 适配（message 透传，T1）----------
  it('wire 适配：{error:"TRANSFER_FAILED", message:"..."} → ApiError(TRANSFER_FAILED) 含 message（AC-F3-6，T1 聚合码）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(500, { error: 'TRANSFER_FAILED', message: '调岗失败：步骤 C 移除原角色失败 - role:write 权限不足' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(transferUser(makeTransferInput())).rejects.toMatchObject({
      code: 'TRANSFER_FAILED',
    });
    await expect(transferUser(makeTransferInput())).rejects.toBeInstanceOf(ApiError);
  });

  // ---------- AC-F3-7 TRANSFER_SAME_ROLE 服务端兜底（客户端 safeParse 未拦截绕过直接调 API 时）----------
  it('wire 适配：{error:"TRANSFER_SAME_ROLE"} → ApiError(TRANSFER_SAME_ROLE)（AC-F3-7，服务端兜底 superRefine）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(400, { error: 'TRANSFER_SAME_ROLE', message: '新角色不能与原角色相同' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(transferUser(makeTransferInput())).rejects.toMatchObject({
      code: 'TRANSFER_SAME_ROLE',
    });
  });

  // ---------- AC-F3-1 USER_NOT_FOUND（T1 复用 user 域既有码，非臆造 TRANSFER_USER_NOT_FOUND）----------
  it('wire 适配：{error:"USER_NOT_FOUND"} → ApiError(USER_NOT_FOUND)（AC-F3-1，T1 复用 user 域码）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(404, { error: 'USER_NOT_FOUND', message: '用户不存在' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(transferUser(makeTransferInput())).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });

  // ---------- AC-F3-2 DEPT_NOT_FOUND（T1 复用 dept 域既有码）----------
  it('wire 适配：{error:"DEPT_NOT_FOUND"} → ApiError(DEPT_NOT_FOUND)（AC-F3-2，T1 复用 dept 域码）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(404, { error: 'DEPT_NOT_FOUND', message: '部门不存在' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(transferUser(makeTransferInput())).rejects.toMatchObject({
      code: 'DEPT_NOT_FOUND',
    });
  });

  // ---------- AC-F3-3 ROLE_NOT_FOUND（T1 复用 role 域既有码）----------
  it('wire 适配：{error:"ROLE_NOT_FOUND"} → ApiError(ROLE_NOT_FOUND)（AC-F3-3，T1 复用 role 域码）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(404, { error: 'ROLE_NOT_FOUND', message: '角色不存在' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(transferUser(makeTransferInput())).rejects.toMatchObject({
      code: 'ROLE_NOT_FOUND',
    });
  });

  // ---------- AC-F3-4 ROLE_BUILTIN_FORBIDDEN（T1 复用 role 域既有码，oldRole 为内置角色）----------
  it('wire 适配：{error:"ROLE_BUILTIN_FORBIDDEN"} → ApiError(ROLE_BUILTIN_FORBIDDEN)（AC-F3-4，T1 复用 role 域码）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(403, { error: 'ROLE_BUILTIN_FORBIDDEN', message: '内置角色不可移除' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(transferUser(makeTransferInput())).rejects.toMatchObject({
      code: 'ROLE_BUILTIN_FORBIDDEN',
    });
  });

  // ---------- AC-F3-5 TRANSFER_OLD_ROLE_NOT_ASSIGNED（T1 transfer 专属码，竞态）----------
  it('wire 适配：{error:"TRANSFER_OLD_ROLE_NOT_ASSIGNED"} → ApiError(TRANSFER_OLD_ROLE_NOT_ASSIGNED)（AC-F3-5，T1 transfer 专属码）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(409, { error: 'TRANSFER_OLD_ROLE_NOT_ASSIGNED', message: '用户未持有原角色' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(transferUser(makeTransferInput())).rejects.toMatchObject({
      code: 'TRANSFER_OLD_ROLE_NOT_ASSIGNED',
    });
  });

  // ---------- AC-F3-6 TRANSFER_COMPENSATION_FAILED（T1 transfer 专属码，补偿失败需运维）----------
  it('wire 适配：{error:"TRANSFER_COMPENSATION_FAILED"} → ApiError(TRANSFER_COMPENSATION_FAILED)（AC-F3-6 补偿场景）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(500, { error: 'TRANSFER_COMPENSATION_FAILED', message: '调岗补偿失败' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(transferUser(makeTransferInput())).rejects.toMatchObject({
      code: 'TRANSFER_COMPENSATION_FAILED',
    });
  });

  // ---------- AC-F9-5 401 拦截复用 R12（鉴权码清 token）----------
  it('401 TOKEN_EXPIRED → 抛 ApiError（AC-F9-5，R12 D8 沿用，transfer 请求自动受 401 拦截）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(401, { error: 'TOKEN_EXPIRED', message: 'expired' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(transferUser(makeTransferInput())).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  // ---------- AC-F9-6 网络错误兜底复用 R12 ----------
  it('fetch 抛错 → ApiError(NETWORK_ERROR)（AC-F9-6，R12 沿用）', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof globalThis.fetch;

    await expect(transferUser(makeTransferInput())).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  // ---------- AC-ARCH-2 类型 contracts 派生（TransferInput 经 z.infer 派生自 transferInputSchema）----------
  it('TransferInput 类型经 contracts 派生（AC-ARCH-2，D3，禁止手写 TS 类型副本）', async () => {
    // 静态保证：makeTransferInput 返回值须满足 TransferInput（contracts z.infer 派生）
    const input: TransferInput = makeTransferInput();
    expect(input.userId).toBe(USER_ID);
    expect(input.toDepartmentId).toBe(DEPT_ID);
    expect(input.oldRoleId).toBe(OLD_ROLE_ID);
    expect(input.newRoleId).toBe(NEW_ROLE_ID);
  });
});
