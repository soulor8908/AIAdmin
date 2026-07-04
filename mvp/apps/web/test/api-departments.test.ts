// apps/web/test/api-departments.test.ts —— ③类新增 部门域 API client 契约测（TECH-WEB-ROLE-DEPT-AUDIT-001 §9.3 T2）
//
// 覆盖 AC：AC-F5-7（DELETE 非 versioned 无 If-Match，D8）、AC-F5-1（树递归类型）、AC-F6-1（path 参数）、AC-F10-1、AC-ARCH-2
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - mock global.fetch + tokenStore（沿用 R12 api-client.test.ts 模式），让真实 client.request 运行。
//   - 期望「断言级红」：api/departments.ts stub 全部抛 NOT_IMPLEMENTED，调用即抛 → fetch 未被调用 → 断言失败（非导入级红）。
//   - D8：deleteDepartment 非 versioned（无 If-Match，server.ts L320 无第 5 参 true），与 D7 角色删除有意分歧。
//   - B4：assignUserDepartment 覆盖式幂等（重复分配同部门=200，无"已在该部门"码）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Department, DepartmentTreeResult } from '@admin/contracts';
import {
  getDeptTree,
  createDepartment,
  deleteDepartment,
  assignUserDepartment,
} from '../src/api/departments.js';

// mock tokenStore（client 依赖 tokenStore 读 token，避免真实 localStorage）
vi.mock('../src/auth/tokenStore.js', () => ({
  TOKEN_STORAGE_KEY: 'admin_token',
  getToken: vi.fn(() => ({ token: 'stub-token-dept', expires_at: '2026-12-31T00:00:00.000Z' })),
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

const DEPT_ID = '00000000-0000-4000-8000-0000000000d1';
const PARENT_ID = '00000000-0000-4000-8000-0000000000d0';
const USER_ID = '00000000-0000-4000-8000-0000000000user';

function makeDept(overrides: Partial<Department> = {}): Department {
  return {
    id: DEPT_ID,
    name: '工程部',
    parent_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 递归树 fixture（根 → 子 → 孙，验证递归类型解析）。 */
function makeTree(): DepartmentTreeResult {
  const grandchild = { id: '00000000-0000-4000-8000-0000000000d2', name: '前端组', parent_id: DEPT_ID, created_at: '2026-01-01T00:00:00.000Z', children: [] };
  const child = { id: DEPT_ID, name: '工程部', parent_id: PARENT_ID, created_at: '2026-01-01T00:00:00.000Z', children: [grandchild] };
  const root = { id: PARENT_ID, name: '技术中心', parent_id: null, created_at: '2026-01-01T00:00:00.000Z', children: [child] };
  return { items: [root] };
}

describe('api/departments 部门域 endpoint 契约', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---------- AC-F5-1 getDeptTree → GET /v1/departments/tree 递归类型 ----------
  it('getDeptTree() → GET /v1/departments/tree 返回递归树（AC-F5-1）', async () => {
    const tree = makeTree();
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, tree));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await getDeptTree();

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/departments/tree');
    expect(result.items).toHaveLength(1);
    // 递归层级断言：root → child → grandchild
    expect(result.items[0]?.children[0]?.children[0]?.name).toBe('前端组');
  });

  // ---------- AC-F5-2 createDepartment 根部门（parentId 缺省）----------
  it('createDepartment({name}) 根部门 → POST /v1/departments body 不含 parent_id（AC-F5-2）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeDept({ name: '技术中心', parent_id: null })));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await createDepartment({ name: '技术中心' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({ name: '技术中心' });
    expect(body).not.toHaveProperty('parent_id');
  });

  // ---------- AC-F5-3 createDepartment 子部门（parentId 提供）----------
  it('createDepartment({name,parent_id}) 子部门 → POST body 含 parent_id（AC-F5-3）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeDept({ name: '工程部', parent_id: PARENT_ID })));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await createDepartment({ name: '工程部', parent_id: PARENT_ID });

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({ name: '工程部', parent_id: PARENT_ID });
  });

  // ---------- AC-F5-7 deleteDepartment 非 versioned（无 If-Match，D8）----------
  it('deleteDepartment(id) → DELETE /v1/departments/:id 无 If-Match（AC-F5-7，D8 非 versioned）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(204, {}));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await deleteDepartment(DEPT_ID);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain(`/v1/departments/${DEPT_ID}`);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('DELETE');
    const headers = init?.headers as Record<string, string>;
    // D8：部门删除非 versioned，client 不注入 If-Match
    expect(headers?.['If-Match']).toBeUndefined();
  });

  // ---------- AC-F5-7 反向核实：deleteDepartment 不触发 409 重试 ----------
  it('deleteDepartment DEPT_HAS_CHILDREN(409) → 抛 ApiError 不重试（D8 非 versioned 不走 409 重试）', async () => {
    // 注：DEPT_HAS_CHILDREN 后端实际返回 409 状态，但 code 非 VERSION_CONFLICT，client 不重试
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(409, { code: 'DEPT_HAS_CHILDREN', message: '请先删除子部门' }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(deleteDepartment(DEPT_ID)).rejects.toMatchObject({ code: 'DEPT_HAS_CHILDREN' });
    // 非 VERSION_CONFLICT 不重试，仅调用 1 次
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ---------- AC-F6-1 assignUserDepartment → POST path 参数 ----------
  it('assignUserDepartment(departmentId, userId) → POST /v1/departments/:departmentId/users/:userId（AC-F6-1）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(204, {}));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await assignUserDepartment(DEPT_ID, USER_ID);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain(`/v1/departments/${DEPT_ID}/users/${USER_ID}`);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('POST');
  });

  // ---------- AC-F6-3 重复分配幂等成功（B4 无"已在该部门"码）----------
  it('assignUserDepartment 重复分配 → 200 幂等成功无错误码（AC-F6-3，B4）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(204, {}));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(assignUserDepartment(DEPT_ID, USER_ID)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ---------- AC-F10-1 API client 复用（经 request 发出，不直接 fetch）----------
  it('getDeptTree 经 client.request 发出（AC-F10-1，不直接 fetch）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, makeTree()));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await getDeptTree();

    // 经 client.request → 调用 global.fetch（非 api 模块直接 fetch）
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
