// apps/web/test/api-roles.test.ts —— ③类新增 角色域 API client 契约测（TECH-WEB-ROLE-DEPT-AUDIT-001 §9.3 T1）
//
// 覆盖 AC：AC-F3-2/F3-3/F3-7、AC-F4-1（裸数组解析 B5）、AC-F9-5/F9-6（401/网络沿用）、AC-F10-1/F10-2、AC-ARCH-2
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - mock global.fetch + tokenStore（沿用 R12 api-client.test.ts 模式），让真实 client.request 运行，
//     验证 api/roles.ts 经 request 发出正确 method/path/query/body/If-Match。
//   - 期望「断言级红」：api/roles.ts stub 全部抛 NOT_IMPLEMENTED，调用即抛 → fetch 未被调用 → 断言失败（非导入级红）。
//   - wire 格式参考 apps/api/src/server.ts：错误响应 { code: <code>, message, current_version? }（字段名 code，对齐 contracts errorResponseSchema.code，D10 已消除）。
//   - B1：createRole input = name+description+permission_codes（无 code 字段）。
//   - B5：listUserRoles 返回裸 UserRole[]（无 envelope）。
//   - D7：deleteRole versioned=true + expectedVersion → client 注入 If-Match（AC-F3-7）。
//   - D9：409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条）。
//   - SEC-003b：测试中不 console.log/记录 password 或 token 字符串。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Role, RoleListResult, UserRole } from '@admin/contracts';
import { listRoles, createRole, deleteRole, listUserRoles, assignRole, removeRole } from '../src/api/roles.js';
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
const TOKEN = 'stub-token-roles-xyz';

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

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    name: 'admin',
    description: '管理员角色',
    permission_codes: ['user:read', 'user:write'],
    is_builtin: true,
    parent_role_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    version: 0,
    ...overrides,
  };
}

function makeRoleListResult(items: Role[], overrides: Partial<RoleListResult> = {}): RoleListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    totalPages: items.length === 0 ? 0 : 1,
    ...overrides,
  };
}

function makeUserRole(overrides: Partial<UserRole> = {}): UserRole {
  return {
    id: '00000000-0000-4000-8000-0000000000u1',
    user_id: '00000000-0000-4000-8000-0000000000user',
    role_id: '00000000-0000-4000-8000-0000000000a1',
    assigned_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('api/roles 角色域 endpoint 契约', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
    vi.mocked(getToken).mockReturnValue({ token: TOKEN, expires_at: '2026-12-31T00:00:00.000Z' });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---------- AC-F1-1 listRoles → GET /v1/roles?page&pageSize ----------
  it('listRoles({page:1,pageSize:20}) → GET /v1/roles?page=1&pageSize=20（AC-F1-1，D21）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeRoleListResult([makeRole()])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await listRoles({ page: 1, pageSize: 20 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/roles');
    expect(calledUrl).toContain('page=1');
    expect(calledUrl).toContain('pageSize=20');
    expect(result.items).toHaveLength(1);
  });

  // ---------- AC-F2-1 createRole → POST /v1/roles（B1: name+description+permission_codes）----------
  it('createRole({name,description,permission_codes}) → POST /v1/roles body 含三字段（AC-F2-1，B1 无 code）', async () => {
    const created = makeRole({ name: 'editor', is_builtin: false, version: 0 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, created));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const input = { name: 'editor', description: '编辑者', permission_codes: ['user:read' as const] };
    const result = await createRole(input);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('POST');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/roles');
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({ name: 'editor', description: '编辑者', permission_codes: ['user:read'] });
    expect(body).not.toHaveProperty('code');
    expect(result.name).toBe('editor');
  });

  // ---------- AC-F3-7 deleteRole 注入 If-Match（versioned）----------
  it('deleteRole(id, expectedVersion) → DELETE /v1/roles/:id + If-Match header（AC-F3-7，D7）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(204, {}));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await deleteRole('00000000-0000-4000-8000-0000000000a1', 3);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/roles/00000000-0000-4000-8000-0000000000a1');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('DELETE');
    const headers = init?.headers as Record<string, string>;
    expect(headers?.['If-Match']).toBe('3');
  });

  // ---------- AC-F3-2 409 VERSION_CONFLICT 自动重试（D9，用 current_version）----------
  it('deleteRole 409 VERSION_CONFLICT → 用 current_version 重试 1 次（AC-F3-2，D9）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(409, { code: 'VERSION_CONFLICT', message: 'conflict', current_version: 5 }))
      .mockResolvedValueOnce(mockResponse(204, {}));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await deleteRole('00000000-0000-4000-8000-0000000000a1', 3);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const retryHeaders = retryInit?.headers as Record<string, string>;
    expect(retryHeaders?.['If-Match']).toBe('5');
  });

  // ---------- AC-F3-3 重试仍 409 → 抛 ApiError ----------
  it('deleteRole 重试仍 409 → 抛 ApiError(VERSION_CONFLICT)（AC-F3-3）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(409, { code: 'VERSION_CONFLICT', message: 'still conflict', current_version: 6 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(
      deleteRole('00000000-0000-4000-8000-0000000000a1', 3),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', current_version: 6 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  // ---------- AC-F4-1 listUserRoles → 裸 UserRole[]（B5 无 envelope）----------
  it('listUserRoles(userId) → GET /v1/users/:userId/roles 返回裸 UserRole[]（AC-F4-1，B5）', async () => {
    const userRoles = [makeUserRole()];
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, userRoles));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await listUserRoles('00000000-0000-4000-8000-0000000000user');

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/users/00000000-0000-4000-8000-0000000000user/roles');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]?.role_id).toBe('00000000-0000-4000-8000-0000000000a1');
  });

  // ---------- AC-F4-2 assignRole → POST path 参数 body 空 ----------
  it('assignRole(userId, roleId) → POST /v1/users/:userId/roles/:roleId（AC-F4-2，path 参数）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(204, {}));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await assignRole('00000000-0000-4000-8000-0000000000user', '00000000-0000-4000-8000-0000000000a1');

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/users/00000000-0000-4000-8000-0000000000user/roles/00000000-0000-4000-8000-0000000000a1');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('POST');
  });

  // ---------- AC-F4-3 removeRole → DELETE path 参数 ----------
  it('removeRole(userId, roleId) → DELETE /v1/users/:userId/roles/:roleId（AC-F4-3，path 参数）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(204, {}));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await removeRole('00000000-0000-4000-8000-0000000000user', '00000000-0000-4000-8000-0000000000a1');

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/users/00000000-0000-4000-8000-0000000000user/roles/00000000-0000-4000-8000-0000000000a1');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('DELETE');
  });

  // ---------- AC-F10-2 Bearer token 注入 ----------
  it('已登录态 → Authorization: Bearer <token> 注入（AC-F10-2，R12 D6）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeRoleListResult([])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await listRoles({ page: 1, pageSize: 20 });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init?.headers as Record<string, string>;
    expect(headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  // ---------- AC-F9-5 401 拦截复用 R12（鉴权码清 token）----------
  it('401 TOKEN_EXPIRED → 抛 ApiError（AC-F9-5，R12 D8 沿用）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(401, { code: 'TOKEN_EXPIRED', message: 'expired' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(listRoles({ page: 1, pageSize: 20 })).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  // ---------- AC-F9-6 网络错误兜底复用 R12 ----------
  it('fetch 抛错 → ApiError(NETWORK_ERROR)（AC-F9-6，R12 沿用）', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof globalThis.fetch;

    await expect(listRoles({ page: 1, pageSize: 20 })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  // ---------- wire 适配 角色域错误码（AC-ARCH-2 类型 contracts 派生）----------
  it('wire 适配：{code:"ROLE_IN_USE"} → ApiError.code === "ROLE_IN_USE"（AC-ARCH-2）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(409, { code: 'ROLE_IN_USE', message: '角色已分配' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(
      deleteRole('00000000-0000-4000-8000-0000000000a1', 0),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      deleteRole('00000000-0000-4000-8000-0000000000a1', 0),
    ).rejects.toMatchObject({ code: 'ROLE_IN_USE' });
  });
});
