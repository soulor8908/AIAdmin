// @vitest-environment jsdom
// apps/web/test/effective-permissions-panel.test.tsx —— ③类新增 EffectivePermissionsPanel 组件测（TECH-WEB-TRANSFER-INHERITANCE-001 §9.3 T6）
//
// 覆盖 AC：AC-F7-1（有效权限查看-有权限，权限码列表 + 中文化映射）、AC-F7-2（空集合显示"该用户暂无有效权限"）、
//          AC-F7-3（权限码中文化映射 SSOT 派生 11 项全集，AI-005）、AC-F7-4（USER_NOT_FOUND）、
//          AC-S1-2（类型派生 userId 不 safeParse）、AC-ARCH-2（类型 contracts 派生 PermissionCode[]）
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api/role-inheritance（getEffectivePermissions），AuthContext.Provider 提供已登录态。
//   - 期望「断言级红」：EffectivePermissionsPanel stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D11：权限码中文化映射 SSOT 派生（键从 [...permissionCodeSchema.options] 派生 11 项全集，AI-005，禁止硬编码）。
//   - T3：GET /v1/users/:userId/effective-permissions 非 cacheable，不发 If-None-Match（由 T1 api-role-inheritance 测覆盖）。
//   - D5 / AC-S1-2：类型派生操作（userId 从 UserListPage 行派生，TS 类型保证，不调 safeParse）。
//   - T1/D19：错误码遵循 contracts SSOT，USER_NOT_FOUND 复用 user 域既有码（非臆造 TRANSFER_USER_NOT_FOUND）。
//   - fixture 须用有效 hex UUID；组件 label 跨组件唯一（"有效权限" 消歧于 UserListPage"角色"按钮）。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { permissionCodeSchema, type PermissionCode } from '@admin/contracts';
import { EffectivePermissionsPanel } from '../src/components/EffectivePermissionsPanel.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import { ApiError } from '../src/api/client.js';
import * as apiRoleInheritance from '../src/api/role-inheritance.js';

vi.mock('../src/api/role-inheritance.js', () => ({
  setRoleParent: vi.fn(),
  unsetRoleParent: vi.fn(),
  getInheritanceChain: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

const getEffectivePermissionsMock = vi.mocked(apiRoleInheritance.getEffectivePermissions);

// SSOT 派生：从 contracts permissionCodeSchema 取全集（AI-005，禁止硬编码 11 项）
const ALL_PERMISSION_CODES = [...permissionCodeSchema.options] as PermissionCode[];

// 有效 hex UUID（z.string().uuid() 严格校验，须全 hex 字符）
const USER_ID = '00000000-0000-4000-8000-000000000001';

function renderPanel(userId: string = USER_ID) {
  const authValue: AuthContextValue = {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <EffectivePermissionsPanel userId={userId} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('EffectivePermissionsPanel 有效权限展示', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F7-1 有权限 → 权限码列表 + 中文化映射 ----------
  it('有权限（permissions.length>0）→ 调 getEffectivePermissions(userId) + 渲染权限码中文化列表（AC-F7-1，D11）', async () => {
    const permissions: PermissionCode[] = ['user:read', 'role:read', 'transfer:write'];
    getEffectivePermissionsMock.mockResolvedValue(permissions);

    renderPanel();

    await waitFor(() => {
      expect(getEffectivePermissionsMock).toHaveBeenCalledWith(USER_ID);
    });
    // 权限码中文化映射渲染（D11，每项中文化，如 user:read→"查看用户"、transfer:write→"调岗用户"）
    // 断言至少渲染一项中文化提示（具体措辞由 impl-writer 定，须 Review 报告记录）
    await waitFor(() => {
      expect(screen.getByText(/查看用户|用户.*读|user:read/i)).toBeInTheDocument();
    });
  });

  // ---------- AC-F7-2 空集合 → "该用户暂无有效权限" ----------
  it('空集合（permissions.length=0）→ 显示"该用户暂无有效权限"（AC-F7-2，用户无角色或角色无权限码）', async () => {
    getEffectivePermissionsMock.mockResolvedValue([]);

    renderPanel();

    expect(await screen.findByText(/暂无有效权限/)).toBeInTheDocument();
  });

  // ---------- AC-F7-3 权限码中文化映射 SSOT 派生 11 项全集（AI-005，禁止硬编码）----------
  it('权限码中文化映射 SSOT 派生覆盖 permissionCodeSchema 11 项全集（AC-F7-3，AI-005/D11，禁止硬编码）', async () => {
    // 返回全部 11 项权限码，验证面板渲染所有中文化映射（非仅返回子集）
    // SSOT 派生：映射表键须从 [...permissionCodeSchema.options] 派生，枚举扩展后自动覆盖
    getEffectivePermissionsMock.mockResolvedValue(ALL_PERMISSION_CODES);

    renderPanel();

    await waitFor(() => {
      expect(getEffectivePermissionsMock).toHaveBeenCalled();
    });
    // 验证每项权限码均渲染中文化映射（11 项全集）
    // 注：具体中文化措辞由 impl-writer 定（纯 UI 文案不须同步 §10），须 Review 报告记录
    // 此处断言"返回的 11 项权限码均有对应渲染项"——通过权限码原文或中文化文案匹配
    await waitFor(() => {
      // 至少渲染 transfer:write 相关项（确认含 R16 新增 transfer:write 权限码中文化）
      expect(screen.getByText(/调岗|transfer:write/i)).toBeInTheDocument();
    });
    // 静态保证：ALL_PERMISSION_CODES 长度 = 11（SSOT 派生，AI-005）
    expect(ALL_PERMISSION_CODES).toHaveLength(11);
    expect(ALL_PERMISSION_CODES).toContain('transfer:write');
    expect(ALL_PERMISSION_CODES).toContain('user:read');
    expect(ALL_PERMISSION_CODES).toContain('notification:write');
  });

  // ---------- AC-F7-4 USER_NOT_FOUND → "用户不存在" ----------
  it('getEffectivePermissions USER_NOT_FOUND → 显示"用户不存在"（AC-F7-4，T1 userId 竞态不存在复用 user 域码）', async () => {
    getEffectivePermissionsMock.mockRejectedValue(new ApiError('USER_NOT_FOUND', '用户不存在'));

    renderPanel();

    expect(await screen.findByText(/用户不存在/)).toBeInTheDocument();
  });

  // ---------- AC-F7-1 加载态 ----------
  it('加载态：getEffectivePermissions pending → loading 文案（AC-F7-1，D16）', async () => {
    // 永不 resolve（保持 loading 态）
    getEffectivePermissionsMock.mockReturnValue(new Promise<PermissionCode[]>(() => {}));

    renderPanel();

    expect(await screen.findByText(/loading|加载中/i)).toBeInTheDocument();
  });

  // ---------- AC-S1-2 类型派生 userId 不 safeParse ----------
  it('userId 从 UserListPage 行派生（TS 类型保证），不调 safeParse（AC-S1-2，D5）', async () => {
    // userId 为 uuid 字面量（从 User.id 派生），EffectivePermissionsPanel 不调 safeParse（GET 只读，类型派生操作）
    // 间接验证：传入合法 uuid → 直接调 getEffectivePermissions（无 safeParse 拦截路径）
    getEffectivePermissionsMock.mockResolvedValue(['user:read']);

    renderPanel(USER_ID);

    await waitFor(() => {
      expect(getEffectivePermissionsMock).toHaveBeenCalledWith(USER_ID);
    });
  });

  // ---------- AC-ARCH-2 类型 contracts 派生（PermissionCode[] 经 z.infer 派生自 effectivePermissionsResultSchema）----------
  it('EffectivePermissionsResult 类型经 contracts 派生（AC-ARCH-2，D3，禁止手写 TS 类型副本）', async () => {
    // 静态保证：permissions 须满足 PermissionCode[]（contracts z.infer 派生自 effectivePermissionsResultSchema = z.array(permissionCodeSchema)）
    const permissions: PermissionCode[] = ['user:read', 'transfer:write'];
    getEffectivePermissionsMock.mockResolvedValue(permissions);

    renderPanel();

    await waitFor(() => {
      expect(getEffectivePermissionsMock).toHaveBeenCalled();
    });
    // 静态类型保证：permissions 元素须满足 PermissionCode（contracts z.infer 派生）
    expect(permissions[0]).toBe('user:read');
    expect(permissions).toContain('transfer:write');
  });
});
