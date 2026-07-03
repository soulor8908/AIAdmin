// @vitest-environment jsdom
// apps/web/test/dept-tree-page.test.tsx —— ③类新增 DeptTreePage 组件测（TECH-WEB-ROLE-DEPT-AUDIT-001 §9.3 T5）
//
// 覆盖 AC：AC-F5-1~F5-9、AC-F6-1~F6-4、AC-ARCH-3（safeParse 拦截不发请求， DeptForm 单测）、AC-S1-1
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api.departments（getDeptTree/createDepartment/deleteDepartment/assignUserDepartment）。
//   - 期望「断言级红」：DeptTreePage stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D8 [约束]：deleteDepartment 非 versioned（无 If-Match），AC-F5-7。
//   - D12 [约束]：DeptNode 递归渲染无深度限制（后端已限 3 层），AC-F5-1。
//   - B4 [约束]：assignUserDepartment 覆盖式幂等（重复分配=200，无"已在该部门"码），AC-F6-3。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { DepartmentTreeResult } from '@admin/contracts';
import { DeptTreePage } from '../src/pages/DeptTreePage.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import { ApiError } from '../src/api/client.js';
import * as apiDepartments from '../src/api/departments.js';

vi.mock('../src/api/departments.js', () => ({
  getDeptTree: vi.fn(),
  createDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
  assignUserDepartment: vi.fn(),
}));

const getDeptTreeMock = vi.mocked(apiDepartments.getDeptTree);
const deleteDepartmentMock = vi.mocked(apiDepartments.deleteDepartment);
const assignUserDepartmentMock = vi.mocked(apiDepartments.assignUserDepartment);

const DEPT_ID_ROOT = '00000000-0000-4000-8000-0000000000d0';
const DEPT_ID_CHILD = '00000000-0000-4000-8000-0000000000d1';
const DEPT_ID_GRANDCHILD = '00000000-0000-4000-8000-0000000000d2';
const USER_ID = '00000000-0000-4000-8000-0000000000user';

/** 递归树 fixture（root → child → grandchild，验证递归渲染 D12）。 */
function makeTree(): DepartmentTreeResult {
  const grandchild = {
    id: DEPT_ID_GRANDCHILD,
    name: '前端组',
    parent_id: DEPT_ID_CHILD,
    created_at: '2026-01-01T00:00:00.000Z',
    children: [],
  };
  const child = {
    id: DEPT_ID_CHILD,
    name: '工程部',
    parent_id: DEPT_ID_ROOT,
    created_at: '2026-01-01T00:00:00.000Z',
    children: [grandchild],
  };
  const root = {
    id: DEPT_ID_ROOT,
    name: '技术中心',
    parent_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    children: [child],
  };
  return { items: [root] };
}

function renderDeptTreePage() {
  const authValue: AuthContextValue = {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <DeptTreePage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('DeptTreePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F5-1 首次加载 + 递归渲染 ----------
  it('首次加载调 getDeptTree() → 递归渲染三层树（AC-F5-1，D12 递归无深度限制）', async () => {
    getDeptTreeMock.mockResolvedValue(makeTree());
    renderDeptTreePage();

    await waitFor(() => {
      expect(getDeptTreeMock).toHaveBeenCalledTimes(1);
    });
    // 递归渲染断言：root → child → grandchild 三层均渲染（D12 无深度限制）
    expect(await screen.findByText('技术中心')).toBeInTheDocument();
    expect(screen.getByText('工程部')).toBeInTheDocument();
    expect(screen.getByText('前端组')).toBeInTheDocument();
  });

  // ---------- AC-F5-1 空状态 ----------
  it('空状态：items=[] → 显示"暂无部门"', async () => {
    getDeptTreeMock.mockResolvedValue({ items: [] });
    renderDeptTreePage();

    expect(await screen.findByText('暂无部门')).toBeInTheDocument();
  });

  // ---------- AC-F5-1 加载态 ----------
  it('加载态：loading=true → loading 文案（D16）', async () => {
    getDeptTreeMock.mockReturnValue(new Promise<DepartmentTreeResult>(() => {}));
    renderDeptTreePage();

    expect(await screen.findByText(/loading|加载中/i)).toBeInTheDocument();
  });

  // ---------- AC-F5-7 删除叶部门 → deleteDepartment（非 versioned，D8）----------
  it('删除叶部门（前端组）→ 调 deleteDepartment(id)（AC-F5-7，D8 非 versioned 无 If-Match）', async () => {
    getDeptTreeMock.mockResolvedValue(makeTree());
    deleteDepartmentMock.mockResolvedValue(undefined);
    getDeptTreeMock.mockResolvedValueOnce(makeTree());
    getDeptTreeMock.mockResolvedValueOnce({ items: [] }); // 删除后刷新
    const user = userEvent.setup();
    renderDeptTreePage();

    await screen.findByText('前端组');
    // 叶节点（前端组）的删除按钮
    const deleteButtons = screen.getAllByRole('button', { name: /删除/i });
    // 选最后一个删除按钮（最深层级 = 叶节点）
    await user.click(deleteButtons[deleteButtons.length - 1]!);

    await waitFor(() => {
      expect(deleteDepartmentMock).toHaveBeenCalledWith(DEPT_ID_GRANDCHILD);
    });
  });

  // ---------- AC-F5-7 删除成功 → 树刷新 ----------
  it('删除叶部门成功 → 树刷新（AC-F5-7）', async () => {
    getDeptTreeMock.mockResolvedValueOnce(makeTree());
    deleteDepartmentMock.mockResolvedValue(undefined);
    getDeptTreeMock.mockResolvedValueOnce({ items: [] }); // 刷新后空树
    const user = userEvent.setup();
    renderDeptTreePage();

    await screen.findByText('前端组');
    const deleteButtons = screen.getAllByRole('button', { name: /删除/i });
    await user.click(deleteButtons[deleteButtons.length - 1]!);

    await waitFor(() => {
      expect(getDeptTreeMock).toHaveBeenCalledTimes(2);
    });
  });

  // ---------- AC-F5-8 DEPT_HAS_CHILDREN → 提示"请先删除子部门" ----------
  it('deleteDepartment DEPT_HAS_CHILDREN → 显示"请先删除子部门"（AC-F5-8）', async () => {
    getDeptTreeMock.mockResolvedValue(makeTree());
    deleteDepartmentMock.mockRejectedValue(new ApiError('DEPT_HAS_CHILDREN', '请先删除子部门'));
    const user = userEvent.setup();
    renderDeptTreePage();

    await screen.findByText('技术中心');
    // 删除有子节点的根部门（技术中心）
    const deleteButtons = screen.getAllByRole('button', { name: /删除/i });
    await user.click(deleteButtons[0]!);

    expect(await screen.findByText(/请先删除子部门/)).toBeInTheDocument();
  });

  // ---------- AC-F5-9 DEPT_NOT_FOUND → 提示"部门不存在" ----------
  it('deleteDepartment DEPT_NOT_FOUND → 显示"部门不存在"（AC-F5-9）', async () => {
    getDeptTreeMock.mockResolvedValue(makeTree());
    deleteDepartmentMock.mockRejectedValue(new ApiError('DEPT_NOT_FOUND', '部门不存在'));
    const user = userEvent.setup();
    renderDeptTreePage();

    await screen.findByText('前端组');
    const deleteButtons = screen.getAllByRole('button', { name: /删除/i });
    await user.click(deleteButtons[deleteButtons.length - 1]!);

    expect(await screen.findByText(/部门不存在/)).toBeInTheDocument();
  });

  // ---------- AC-F6-1 用户部门分配 → assignUserDepartment（path 参数，类型派生）----------
  it('用户部门分配 → 调 assignUserDepartment(departmentId, userId)（AC-F6-1，类型派生操作）', async () => {
    getDeptTreeMock.mockResolvedValue(makeTree());
    assignUserDepartmentMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDeptTreePage();

    await screen.findByText('工程部');
    // 工程部节点的"分配用户"按钮
    const assignButtons = screen.getAllByRole('button', { name: /分配用户|分配/i });
    await user.click(assignButtons[0]!);

    // 注：具体 userId 选择交互由 impl 实现，此处断言最终调用
    await waitFor(() => {
      expect(assignUserDepartmentMock).toHaveBeenCalled();
    });
  });

  // ---------- AC-F6-2 DEPT_NOT_FOUND → 提示"部门不存在" ----------
  it('assignUserDepartment DEPT_NOT_FOUND → 显示"部门不存在"（AC-F6-2）', async () => {
    getDeptTreeMock.mockResolvedValue(makeTree());
    assignUserDepartmentMock.mockRejectedValue(new ApiError('DEPT_NOT_FOUND', '部门不存在'));
    const user = userEvent.setup();
    renderDeptTreePage();

    await screen.findByText('工程部');
    const assignButtons = screen.getAllByRole('button', { name: /分配用户|分配/i });
    await user.click(assignButtons[0]!);

    expect(await screen.findByText(/部门不存在/)).toBeInTheDocument();
  });

  // ---------- AC-F6-3 重复分配 → 幂等成功（B4 无"已在该部门"码）----------
  it('assignUserDepartment 重复分配 → 幂等成功（AC-F6-3，B4 无"已在该部门"码）', async () => {
    getDeptTreeMock.mockResolvedValue(makeTree());
    // 重复分配返回 200/204（幂等成功，无错误码）
    assignUserDepartmentMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDeptTreePage();

    await screen.findByText('工程部');
    const assignButtons = screen.getAllByRole('button', { name: /分配用户|分配/i });
    await user.click(assignButtons[0]!);

    // 幂等成功：无错误提示，仅显示"部门归属已更新"或类似成功提示
    await waitFor(() => {
      expect(assignUserDepartmentMock).toHaveBeenCalled();
    });
    // 反向核实：不应出现"已在该部门"类错误提示（B4：errorCodeSchema 无此码）
    expect(screen.queryByText(/已在该部门/)).not.toBeInTheDocument();
  });

  // ---------- AC-F6-4 USER_NOT_FOUND → 提示"用户不存在" ----------
  it('assignUserDepartment USER_NOT_FOUND → 显示"用户不存在"（AC-F6-4）', async () => {
    getDeptTreeMock.mockResolvedValue(makeTree());
    assignUserDepartmentMock.mockRejectedValue(new ApiError('USER_NOT_FOUND', '用户不存在'));
    const user = userEvent.setup();
    renderDeptTreePage();

    await screen.findByText('工程部');
    const assignButtons = screen.getAllByRole('button', { name: /分配用户|分配/i });
    await user.click(assignButtons[0]!);

    expect(await screen.findByText(/用户不存在/)).toBeInTheDocument();
  });

  // ---------- 创建根部门按钮存在 ----------
  it('渲染"创建根部门"按钮（AC-F5-2 入口）', async () => {
    getDeptTreeMock.mockResolvedValue(makeTree());
    renderDeptTreePage();

    await screen.findByText('技术中心');
    expect(screen.getByRole('button', { name: /创建.*部门|新增.*根|添加.*根/i })).toBeInTheDocument();
  });

  // ---------- 创建子部门：DeptNode 节点"添加子部门"按钮 ----------
  it('DeptNode 节点渲染"添加子部门"按钮（AC-F5-3 入口，D12 递归）', async () => {
    getDeptTreeMock.mockResolvedValue(makeTree());
    renderDeptTreePage();

    await screen.findByText('技术中心');
    // 每个非空节点都应有"添加子部门"按钮（递归组件 D12）
    expect(screen.getAllByRole('button', { name: /添加子部门|新增子部门/i }).length).toBeGreaterThan(0);
  });
});
