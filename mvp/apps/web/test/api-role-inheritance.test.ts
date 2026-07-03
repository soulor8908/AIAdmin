// apps/web/test/api-role-inheritance.test.ts —— ③类新增 角色继承域 API client 契约测（TECH-WEB-TRANSFER-INHERITANCE-001 §9.3 T1）
//
// 覆盖 AC：AC-F4-1（setRoleParent versioned If-Match，T3/D7）、AC-F4-5/F4-6（409 VERSION_CONFLICT 重试用 current_version）、
//          AC-F4-4（409 ROLE_INHERITANCE_CYCLE 不重试抛 ApiError）、AC-F4-3（409 ROLE_BUILTIN_PARENT_FORBIDDEN 不重试）、
//          AC-F5-1（unsetRoleParent versioned DELETE）、AC-F5-3（unsetRoleParent 409 重试幂等）、
//          AC-F6-1（getInheritanceChain GET 非 cacheable 不发 If-None-Match，T3 + 裸数组 Role[]）、
//          AC-F7-1（getEffectivePermissions GET 非 cacheable + 裸数组 PermissionCode[]）、AC-F10-2、AC-ARCH-2
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - mock global.fetch + tokenStore（沿用 R14 api-roles.test.ts 模式），让真实 client.request 运行，
//     验证 api/role-inheritance.ts 经 request 发出正确 method/path/body/If-Match。
//   - 期望「断言级红」：api/role-inheritance.ts stub 全部抛 NOT_IMPLEMENTED，调用即抛 → fetch 未被调用 → 断言失败（非导入级红）。
//   - D7/T3：setRoleParent/unsetRoleParent versioned=true + expectedVersion → client 注入 If-Match（AC-F4-1/F5-1）。
//   - D9：409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条）。
//   - D7 注：409 ROLE_INHERITANCE_CYCLE/ROLE_BUILTIN_PARENT_FORBIDDEN 非 VERSION_CONFLICT，不重试抛 ApiError（T2）。
//   - T3：getInheritanceChain/getEffectivePermissions 非 cacheable，不发 If-None-Match（R12 D15 前端统一不发，行为一致）。
//   - D20/T2：错误码遵循 contracts SSOT，非臆造 ROLE_INHERITANCE_NOT_FOUND（roleId 不存在复用 ROLE_NOT_FOUND）。
//   - R15 S-13：fixture 须用有效 hex UUID。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PermissionCode, Role } from '@admin/contracts';
import {
  setRoleParent,
  unsetRoleParent,
  getInheritanceChain,
  getEffectivePermissions,
} from '../src/api/role-inheritance.js';
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
const TOKEN = 'stub-token-inheritance-xyz';

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
const ROLE_ID = '00000000-0000-4000-8000-0000000000a1';
const PARENT_ROLE_ID = '00000000-0000-4000-8000-0000000000a2';
const USER_ID = '00000000-0000-4000-8000-000000000001';

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: ROLE_ID,
    name: 'editor',
    description: '编辑者角色',
    permission_codes: ['user:read', 'user:write'],
    is_builtin: false,
    parent_role_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    version: 0,
    ...overrides,
  };
}

describe('api/role-inheritance 角色继承域 endpoint 契约', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
    vi.mocked(getToken).mockReturnValue({ token: TOKEN, expires_at: '2026-12-31T00:00:00.000Z' });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---------- AC-F4-1 setRoleParent → POST /v1/roles/:roleId/parent（versioned，If-Match）----------
  it('setRoleParent(roleId, parentRoleId, expectedVersion) → POST /v1/roles/:roleId/parent + If-Match（AC-F4-1，D7/T3）', async () => {
    const updated = makeRole({ parent_role_id: PARENT_ROLE_ID, version: 4 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, updated));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await setRoleParent(ROLE_ID, PARENT_ROLE_ID, 3);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/roles/00000000-0000-4000-8000-0000000000a1/parent');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    // body 仅含 parentRoleId（roleId 在 path，path+body 合并风格）
    expect(body).toEqual({ parentRoleId: PARENT_ROLE_ID });
    const headers = init?.headers as Record<string, string>;
    expect(headers?.['If-Match']).toBe('3');
  });

  // ---------- AC-F4-5 409 VERSION_CONFLICT 自动重试（用 current_version，D9）----------
  it('setRoleParent 409 VERSION_CONFLICT → 用 current_version 重试 1 次（AC-F4-5，D9）', async () => {
    const updated = makeRole({ parent_role_id: PARENT_ROLE_ID, version: 5 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(409, { error: 'VERSION_CONFLICT', message: 'conflict', current_version: 5 }))
      .mockResolvedValueOnce(mockResponse(200, updated));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await setRoleParent(ROLE_ID, PARENT_ROLE_ID, 3);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const retryHeaders = retryInit?.headers as Record<string, string>;
    expect(retryHeaders?.['If-Match']).toBe('5');
  });

  // ---------- AC-F4-6 重试仍 409 → 抛 ApiError ----------
  it('setRoleParent 重试仍 409 → 抛 ApiError(VERSION_CONFLICT)（AC-F4-6）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(409, { error: 'VERSION_CONFLICT', message: 'still conflict', current_version: 6 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(setRoleParent(ROLE_ID, PARENT_ROLE_ID, 3)).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      current_version: 6,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  // ---------- AC-F4-4 409 ROLE_INHERITANCE_CYCLE 不重试（非 VERSION_CONFLICT，T2）----------
  it('setRoleParent 409 ROLE_INHERITANCE_CYCLE → 不重试抛 ApiError（AC-F4-4，T2 环检测非 VERSION_CONFLICT）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(409, { error: 'ROLE_INHERITANCE_CYCLE', message: '会形成继承环：A → B → A' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(setRoleParent(ROLE_ID, PARENT_ROLE_ID, 3)).rejects.toMatchObject({
      code: 'ROLE_INHERITANCE_CYCLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // 不重试
  });

  // ---------- AC-F4-3 409 ROLE_BUILTIN_PARENT_FORBIDDEN 不重试（T2）----------
  it('setRoleParent 409 ROLE_BUILTIN_PARENT_FORBIDDEN → 不重试抛 ApiError（AC-F4-3，T2 内置 admin 不可设为父）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(403, { error: 'ROLE_BUILTIN_PARENT_FORBIDDEN', message: '内置角色不可设为父角色' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(setRoleParent(ROLE_ID, PARENT_ROLE_ID, 3)).rejects.toMatchObject({
      code: 'ROLE_BUILTIN_PARENT_FORBIDDEN',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // 不重试
  });

  // ---------- AC-F5-1 unsetRoleParent → DELETE /v1/roles/:roleId/parent（versioned，DELETE 重试幂等）----------
  it('unsetRoleParent(roleId, expectedVersion) → DELETE /v1/roles/:roleId/parent + If-Match（AC-F5-1，D7/T3）', async () => {
    const updated = makeRole({ parent_role_id: null, version: 4 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, updated));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await unsetRoleParent(ROLE_ID, 3);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/roles/00000000-0000-4000-8000-0000000000a1/parent');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('DELETE');
    const headers = init?.headers as Record<string, string>;
    expect(headers?.['If-Match']).toBe('3');
  });

  // ---------- AC-F5-3 unsetRoleParent 409 VERSION_CONFLICT 重试（DELETE 重试幂等）----------
  it('unsetRoleParent 409 VERSION_CONFLICT → 用 current_version 重试 1 次（AC-F5-3，D9 DELETE 重试幂等）', async () => {
    const updated = makeRole({ parent_role_id: null, version: 5 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(409, { error: 'VERSION_CONFLICT', message: 'conflict', current_version: 5 }))
      .mockResolvedValueOnce(mockResponse(200, updated));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await unsetRoleParent(ROLE_ID, 3);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const retryHeaders = retryInit?.headers as Record<string, string>;
    expect(retryHeaders?.['If-Match']).toBe('5');
  });

  // ---------- AC-F6-1 getInheritanceChain → GET /v1/roles/:roleId/inheritance-chain（非 cacheable，T3，裸 Role[]）----------
  it('getInheritanceChain(roleId) → GET /v1/roles/:roleId/inheritance-chain 返回裸 Role[]（AC-F6-1，T3 非 cacheable）', async () => {
    const chain = [
      makeRole({ id: PARENT_ROLE_ID, name: '父角色' }),
      makeRole({ id: '00000000-0000-4000-8000-0000000000a3', name: '祖父角色' }),
    ];
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, chain));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await getInheritanceChain(ROLE_ID);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/roles/00000000-0000-4000-8000-0000000000a1/inheritance-chain');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('GET');
    // 裸数组无 envelope（B5 模式）
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('父角色');
    // 非 cacheable 不发 If-None-Match（T3，R12 D15 前端统一不发）
    const headers = init?.headers as Record<string, string>;
    expect(headers?.['If-None-Match']).toBeUndefined();
  });

  // ---------- AC-F6-1 根角色返回空数组（D7，前端展示"无父角色"）----------
  it('getInheritanceChain 根角色 → 返回空数组 []（AC-F6-1/D7，根角色无父角色）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, []));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await getInheritanceChain(ROLE_ID);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  // ---------- AC-F7-1 getEffectivePermissions → GET /v1/users/:userId/effective-permissions（非 cacheable，T3，裸 PermissionCode[]）----------
  it('getEffectivePermissions(userId) → GET /v1/users/:userId/effective-permissions 返回裸 PermissionCode[]（AC-F7-1，T3 非 cacheable）', async () => {
    const permissions: PermissionCode[] = ['user:read', 'role:read', 'transfer:write'];
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, permissions));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await getEffectivePermissions(USER_ID);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/users/00000000-0000-4000-8000-000000000001/effective-permissions');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('GET');
    // 裸数组无 envelope（B5 模式）
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(result).toContain('transfer:write');
    // 非 cacheable 不发 If-None-Match（T3）
    const headers = init?.headers as Record<string, string>;
    expect(headers?.['If-None-Match']).toBeUndefined();
  });

  // ---------- AC-F7-2 空集合（用户无角色或角色无权限码）----------
  it('getEffectivePermissions 空集合 → 返回 []（AC-F7-2，用户无有效权限）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, []));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await getEffectivePermissions(USER_ID);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  // ---------- AC-F10-2 Bearer token 注入 ----------
  it('已登录态 → Authorization: Bearer <token> 注入（AC-F10-2，R12 D6）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, []));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await getInheritanceChain(ROLE_ID);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init?.headers as Record<string, string>;
    expect(headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  // ---------- AC-F4-7 ROLE_NOT_FOUND wire 适配（T2 roleId/parentRoleId 不存在复用 ROLE_NOT_FOUND）----------
  it('wire 适配：{error:"ROLE_NOT_FOUND"} → ApiError(ROLE_NOT_FOUND)（AC-F4-7，T2 复用 role 域码非臆造 ROLE_INHERITANCE_NOT_FOUND）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(404, { error: 'ROLE_NOT_FOUND', message: '角色不存在' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(setRoleParent(ROLE_ID, PARENT_ROLE_ID, 3)).rejects.toBeInstanceOf(ApiError);
    await expect(setRoleParent(ROLE_ID, PARENT_ROLE_ID, 3)).rejects.toMatchObject({
      code: 'ROLE_NOT_FOUND',
    });
  });

  // ---------- AC-F6-4 getInheritanceChain ROLE_NOT_FOUND（roleId 竞态不存在）----------
  it('getInheritanceChain 404 ROLE_NOT_FOUND → 抛 ApiError(ROLE_NOT_FOUND)（AC-F6-4，T2 roleId 竞态）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(404, { error: 'ROLE_NOT_FOUND', message: '角色不存在' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(getInheritanceChain(ROLE_ID)).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
  });

  // ---------- AC-F7-4 getEffectivePermissions USER_NOT_FOUND（T1 userId 竞态不存在）----------
  it('getEffectivePermissions 404 USER_NOT_FOUND → 抛 ApiError(USER_NOT_FOUND)（AC-F7-4，T1 userId 竞态）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(404, { error: 'USER_NOT_FOUND', message: '用户不存在' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(getEffectivePermissions(USER_ID)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  // ---------- AC-ARCH-2 类型 contracts 派生（Role/PermissionCode 经 z.infer 派生）----------
  it('Role/PermissionCode 类型经 contracts 派生（AC-ARCH-2，D3，禁止手写 TS 类型副本）', async () => {
    // 静态保证：makeRole 返回值须满足 Role（contracts z.infer 派生），permissions 须满足 PermissionCode[]
    const role: Role = makeRole();
    expect(role.id).toBe(ROLE_ID);
    const permissions: PermissionCode[] = ['user:read'];
    expect(permissions[0]).toBe('user:read');
  });
});
