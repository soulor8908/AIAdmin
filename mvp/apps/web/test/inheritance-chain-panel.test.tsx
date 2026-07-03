// @vitest-environment jsdom
// apps/web/test/inheritance-chain-panel.test.tsx —— ③类新增 InheritanceChainPanel 组件测（TECH-WEB-TRANSFER-INHERITANCE-001 §9.3 T5）
//
// 覆盖 AC：AC-F6-1（继承链查看-有父角色，链形文本渲染）、AC-F6-2（根角色空数组显示"无父角色"，D7）、
//          AC-F6-3（多级祖先链形文本" → " 分隔）、AC-F6-4（ROLE_NOT_FOUND）、AC-ARCH-2（类型 contracts 派生 Role[]）
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api/role-inheritance（getInheritanceChain），AuthContext.Provider 提供已登录态。
//   - 期望「断言级红」：InheritanceChainPanel stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D10：链形文本（" → " 分隔，Q6 决策①，不做树形/图表，D23）。
//   - D7 / AC-F6-2：根角色返回 [] 显示"无父角色"。
//   - T3：GET /v1/roles/:roleId/inheritance-chain 非 cacheable，不发 If-None-Match（由 T1 api-role-inheritance 测覆盖，本文件不重复）。
//   - D5 / AC-S1-2：类型派生操作（roleId 从 RoleListPage 行派生，TS 类型保证，不调 safeParse）。
//   - T2/D20：错误码遵循 contracts SSOT，ROLE_NOT_FOUND 复用 role 域既有码（非臆造 ROLE_INHERITANCE_NOT_FOUND）。
//   - R15 S-13：fixture 须用有效 hex UUID；R15 S-14：组件 label 跨组件唯一（"继承链" 消歧）。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Role } from '@admin/contracts';
import { InheritanceChainPanel } from '../src/components/InheritanceChainPanel.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import { ApiError } from '../src/api/client.js';
import * as apiRoleInheritance from '../src/api/role-inheritance.js';

vi.mock('../src/api/role-inheritance.js', () => ({
  setRoleParent: vi.fn(),
  unsetRoleParent: vi.fn(),
  getInheritanceChain: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

const getInheritanceChainMock = vi.mocked(apiRoleInheritance.getInheritanceChain);

// 有效 hex UUID（R15 S-13：z.string().uuid() 严格校验，须全 hex 字符）
const ROLE_ID = '00000000-0000-4000-8000-0000000000a1';

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: ROLE_ID,
    name: 'editor',
    description: '编辑者角色',
    permission_codes: ['user:read'],
    is_builtin: false,
    parent_role_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    version: 0,
    ...overrides,
  };
}

function renderPanel(roleId: string = ROLE_ID) {
  const authValue: AuthContextValue = {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <InheritanceChainPanel roleId={roleId} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('InheritanceChainPanel 继承链展示', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F6-1 有父角色 → 链形文本渲染 ----------
  it('有父角色（chain.length=1）→ 调 getInheritanceChain(roleId) + 渲染父角色名（AC-F6-1，D10 链形文本）', async () => {
    const chain: Role[] = [makeRole({ id: '00000000-0000-4000-8000-0000000000a2', name: '父角色' })];
    getInheritanceChainMock.mockResolvedValue(chain);

    renderPanel();

    await waitFor(() => {
      expect(getInheritanceChainMock).toHaveBeenCalledWith(ROLE_ID);
    });
    expect(await screen.findByText(/父角色/)).toBeInTheDocument();
  });

  // ---------- AC-F6-2 根角色空数组 → "无父角色" ----------
  it('根角色空数组（chain.length=0）→ 显示"无父角色"（AC-F6-2，D7 根角色无父角色）', async () => {
    getInheritanceChainMock.mockResolvedValue([]);

    renderPanel();

    expect(await screen.findByText(/无父角色/)).toBeInTheDocument();
  });

  // ---------- AC-F6-3 多级祖先 → " → " 分隔链形文本 ----------
  it('多级祖先（chain.length>=2）→ " → " 分隔链形文本"父角色 B → 祖父角色 C"（AC-F6-3，D10）', async () => {
    const chain: Role[] = [
      makeRole({ id: '00000000-0000-4000-8000-0000000000a2', name: '父角色B' }),
      makeRole({ id: '00000000-0000-4000-8000-0000000000a3', name: '祖父角色C' }),
      makeRole({ id: '00000000-0000-4000-8000-0000000000a4', name: '曾祖父角色D' }),
    ];
    getInheritanceChainMock.mockResolvedValue(chain);

    renderPanel();

    // 多级祖先按返回顺序用 " → " 分隔（AC-F6-3）
    await waitFor(() => {
      expect(getInheritanceChainMock).toHaveBeenCalled();
    });
    expect(await screen.findByText(/父角色B/)).toBeInTheDocument();
    expect(screen.getByText(/祖父角色C/)).toBeInTheDocument();
    expect(screen.getByText(/曾祖父角色D/)).toBeInTheDocument();
    // 链形文本含 " → " 分隔符（D10/Q6 决策①）
    expect(screen.getByText(/→/)).toBeInTheDocument();
  });

  // ---------- AC-F6-4 ROLE_NOT_FOUND → "角色不存在" ----------
  it('getInheritanceChain ROLE_NOT_FOUND → 显示"角色不存在"（AC-F6-4，T2 roleId 竞态不存在复用 role 域码）', async () => {
    getInheritanceChainMock.mockRejectedValue(new ApiError('ROLE_NOT_FOUND', '角色不存在'));

    renderPanel();

    expect(await screen.findByText(/角色不存在/)).toBeInTheDocument();
  });

  // ---------- AC-F6-1 加载态 ----------
  it('加载态：getInheritanceChain pending → loading 文案（AC-F6-1，D16）', async () => {
    // 永不 resolve（保持 loading 态）
    getInheritanceChainMock.mockReturnValue(new Promise<Role[]>(() => {}));

    renderPanel();

    expect(await screen.findByText(/loading|加载中/i)).toBeInTheDocument();
  });

  // ---------- AC-ARCH-2 类型 contracts 派生（Role[] 经 z.infer 派生自 inheritanceChainResultSchema）----------
  it('InheritanceChainResult 类型经 contracts 派生（AC-ARCH-2，D3，禁止手写 TS 类型副本）', async () => {
    // 静态保证：chain 须满足 Role[]（contracts z.infer 派生自 inheritanceChainResultSchema = z.array(roleSchema)）
    const chain: Role[] = [makeRole()];
    getInheritanceChainMock.mockResolvedValue(chain);

    renderPanel();

    await waitFor(() => {
      expect(getInheritanceChainMock).toHaveBeenCalled();
    });
    // 静态类型保证：makeRole 返回值须满足 Role（contracts z.infer 派生）
    expect(chain[0]?.id).toBe(ROLE_ID);
  });
});
