// @vitest-environment jsdom
// apps/web/test/performance.test.tsx —— ③类新增 R22 前端性能加固专项测（TECH-FRONTEND-PERFORMANCE-001 §9 T8）
//
// 覆盖 AC：AC-P1（UserRow/RoleRow React.memo）/ AC-P4（UserListPage 行数 > 50 启用 FixedSizeList）/
//          AC-P6（UserListPage 行数 ≤ 50 回退普通 map 保持 <table> DOM）/ AC-P7（App.tsx React.lazy 7 页代码分割）/
//          AC-P8（Suspense fallback 文案"加载中..."）
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react。
//   - 不引入 benchmark 基准测试（PRD Q1 决策①：代码层静态改进 + 落地核验，非定量性能测量）。
//   - memo 核验（AC-P1）：①React.memo 包装标记（$$typeof === Symbol.for('react.memo') + compare=null 默认浅比较）
//     ②行为核验（同 props 引用不触发 re-render，用 render 计数器验证 memo 浅比较跳过机制）。
//   - react-window 核验（AC-P4/P6）：行数 > 50 启用 FixedSizeList（虚拟化 DOM 结构特征——非全量行渲染 +
//     无 <table> 包裹），行数 ≤ 50 回退普通 items.map（<table><tbody><tr> 全量行可见）。
//   - React.lazy 核验（AC-P7/P8）：App.tsx 源码静态 import 改为 lazy 动态 import（每页独立 chunk）+
//     .then(m => ({ default: m.XxxPage })) named→default 转换 + Suspense fallback 文案"加载中..."。
//   - ARCH-003：测试仅 import @admin/contracts + apps/web 内部（components/pages/auth）+ node:fs（静态源码核验）。
//   - CODE-001：禁 any，类型经 z.infer 派生或 inline typed cast（{ $$typeof: symbol }）。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { memo } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { User, UserListResult } from '@admin/contracts';
import { UserRow } from '../src/components/UserRow.js';
import { RoleRow } from '../src/components/RoleRow.js';
import { UserListPage } from '../src/pages/UserListPage.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import * as apiUsers from '../src/api/users.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

vi.mock('../src/api/users.js', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUserStatus: vi.fn(),
}));

const listUsersMock = vi.mocked(apiUsers.listUsers);

// App.tsx 源码路径（静态核验 React.lazy 包装用）。
const thisDir = dirname(fileURLToPath(import.meta.url));
const appTsxPath = join(thisDir, '../src/App.tsx');

// ---------- helpers ----------

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Alice',
    email: 'alice@example.com',
    status: 'active',
    department_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    version: 0,
    ...overrides,
  };
}

/** 生成 n 个有效用户（UUID v4 格式，R15 S-13：z.string().uuid() 严格校验）。 */
function makeUsers(n: number): User[] {
  return Array.from({ length: n }, (_, i) => {
    // 12 位 hex 后缀（padStart 到 12 位），保持 UUID 8-4-4-4-12 格式合法。
    const suffix = String(i).padStart(12, '0');
    return makeUser({
      id: `00000000-0000-4000-8000-${suffix}`,
      name: `User${i}`,
      email: `user${i}@example.com`,
    });
  });
}

function makeListResult(items: User[]): UserListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    totalPages: items.length === 0 ? 0 : 1,
  };
}

function makeAuthValue(): AuthContextValue {
  return {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}

function renderWithAuth(ui: JSX.Element) {
  return render(
    <AuthContext.Provider value={makeAuthValue()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </AuthContext.Provider>,
  );
}

// ---------- AC-P1: UserRow React.memo ----------

describe('R22 AC-P1 · UserRow React.memo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('UserRow 包裹 React.memo（$$typeof === Symbol.for("react.memo") + compare=null 默认浅比较）', () => {
    // React.memo 包装后组件对象 $$typeof 为 REACT_MEMO_TYPE（Symbol.for('react.memo')），
    // compare=null 表示用默认浅比较（shallow equal props 跳过 re-render，AC-P1）。
    // 注：@types/react 18.3 对 FunctionComponent 重载返回 NamedExoticComponent（不暴露 compare），
    // 运行时 React.memo 实际设置 compare=null（默认浅比较），须经 unknown 中转 cast 取运行时字段。
    const memoComponent = UserRow as unknown as {
      $$typeof: symbol;
      compare: ((a: unknown, b: unknown) => boolean) | null;
    };
    expect(memoComponent.$$typeof).toBe(Symbol.for('react.memo'));
    expect(memoComponent.compare).toBeNull();
  });
});

// ---------- AC-P1: RoleRow React.memo ----------

describe('R22 AC-P1 · RoleRow React.memo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('RoleRow 包裹 React.memo（$$typeof === Symbol.for("react.memo") + compare=null 默认浅比较）', () => {
    const memoComponent = RoleRow as unknown as {
      $$typeof: symbol;
      compare: ((a: unknown, b: unknown) => boolean) | null;
    };
    expect(memoComponent.$$typeof).toBe(Symbol.for('react.memo'));
    expect(memoComponent.compare).toBeNull();
  });
});

// ---------- AC-P1 行为核验: React.memo 浅比较跳过 re-render ----------

describe('R22 AC-P1 · React.memo 浅比较行为核验（同 props 引用不触发 re-render）', () => {
  it('memo 包装的组件同 props 引用时跳过渲染（render 计数不增长）', () => {
    // 行为核验：用受控的 Inner 组件 + render 计数器验证 React.memo 浅比较机制。
    // 配合 UserRow/RoleRow 的 $$typeof 标记核验，证明行组件 memo 包装有效。
    const renders: number[] = [];
    const Inner = ({ value }: { value: number }): JSX.Element => {
      renders.push(value);
      return <div data-testid="inner">{value}</div>;
    };
    const Memoized = memo(Inner);

    const Tree = ({ flag }: { flag: number }): JSX.Element => (
      <div>
        <span data-testid="flag">{flag}</span>
        <Memoized value={42} />
      </div>
    );

    const { rerender } = render(<Tree flag={0} />);
    // 初始 mount：Inner 渲染 1 次。
    expect(renders).toEqual([42]);

    // 父组件强制 re-render（flag 0→1），Memoized props value 引用不变 → 浅比较通过 → 跳过 Inner 渲染。
    rerender(<Tree flag={1} />);
    expect(renders).toEqual([42]); // 仍只渲染 1 次，memo 阻止了 re-render
    // 父组件确实 re-render 了（flag 变化）。
    expect(screen.getByTestId('flag').textContent).toBe('1');
  });
});

// ---------- AC-P4: UserListPage 行数 > 50 启用 react-window FixedSizeList ----------

describe('R22 AC-P4 · UserListPage 行数 > 50 启用 react-window FixedSizeList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('51 行启用虚拟列表（仅渲染可视区 + overscan 行，非全量 51 行；不渲染 <table>）', async () => {
    // 阈值 50（D5）：items.length > 50 → useVirtualList=true → FixedSizeList 路径。
    // react-window 配置：height=600 / itemSize=48 / overscanCount=5 → 初始渲染约 18 行（13 可见 + 5 overscan）。
    const users = makeUsers(51);
    listUsersMock.mockResolvedValue(makeListResult(users));

    const { container } = renderWithAuth(<UserListPage />);

    // 等待数据加载完成（loading 文案消失，首行渲染）。
    await waitFor(() => expect(screen.getByText('User0')).toBeInTheDocument());

    // 虚拟列表：User0（index 0）在可视区内已渲染；User50（index 50）在 viewport 外未渲染。
    expect(screen.getByText('User0')).toBeInTheDocument();
    expect(screen.queryByText('User50', { exact: true })).toBeNull();

    // 虚拟列表路径不渲染 <table>（FixedSizeList 用 <div style={style}> 包裹行，AC-P4 DOM 结构特征）。
    expect(container.querySelector('table')).toBeNull();
  });
});

// ---------- AC-P6: UserListPage 行数 ≤ 50 回退普通 map ----------

describe('R22 AC-P6 · UserListPage 行数 ≤ 50 回退普通 map', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('5 行回退普通 map（<table> 渲染 + 全量 5 行可见，保持既有 DOM 结构）', async () => {
    // 阈值 50（D5）：items.length ≤ 50 → useVirtualList=false → 普通 items.map 路径。
    // 保持 <table><tbody><tr><td> DOM 结构，避免破坏既有测试（AC-P6）。
    const users = makeUsers(5);
    listUsersMock.mockResolvedValue(makeListResult(users));

    const { container } = renderWithAuth(<UserListPage />);

    await waitFor(() => expect(screen.getByText('User0')).toBeInTheDocument());

    // 普通 map 路径渲染 <table>（既有 DOM 结构保持）。
    expect(container.querySelector('table')).not.toBeNull();

    // 全量 5 行均渲染（非虚拟化，无 viewport 裁剪）。
    for (let i = 0; i < 5; i++) {
      expect(screen.getByText(`User${i}`)).toBeInTheDocument();
    }
  });
});

// ---------- AC-P7/P8: App.tsx React.lazy + Suspense 代码分割 ----------

describe('R22 AC-P7/P8 · App.tsx React.lazy + Suspense 代码分割', () => {
  it('App.tsx 用 React.lazy 包裹全部页面组件（.then(m => ({ default: m.XxxPage })) named→default 转换）', () => {
    // 静态源码核验：App.tsx 改全静态 import 为 React.lazy 动态 import。
    // 8 页全部 lazy（PRD §1.1 列举 8 页名：Login/UserList/RoleList/DeptTree/AuditLog/NotificationList/Report/Transfer，
    // spec 字面"7 页"指首屏后按需加载的 7 个业务页，Login 为首屏 chunk 亦 lazy 包裹统一）。
    const src = readFileSync(appTsxPath, 'utf8');
    const pages = [
      'LoginPage',
      'UserListPage',
      'RoleListPage',
      'DeptTreePage',
      'AuditLogPage',
      'NotificationListPage',
      'ReportPage',
      'TransferPage',
    ];
    // lazy 仅支持 default export，named export 须经 .then(m => ({ default: m.XxxPage })) 转换（D6 [约束]）。
    for (const page of pages) {
      expect(src, `${page} 须用 React.lazy 包裹`).toMatch(
        new RegExp(`const ${page} = lazy\\(\\(\\) => import\\(`),
      );
      expect(src, `${page} 须用 .then 转 named→default`).toMatch(
        new RegExp(`\\.then\\(\\(m\\) => \\(\\{ default: m\\.${page} \\}\\)\\)`),
      );
    }
  });

  it('App.tsx 用 Suspense 包裹 Routes + fallback 文案"加载中..."（AC-P8）', () => {
    const src = readFileSync(appTsxPath, 'utf8');
    // import { lazy, Suspense } from 'react'（D6 [约束]：lazy + Suspense 同源 import）。
    expect(src).toMatch(/import\s*\{\s*lazy,\s*Suspense\s*\}\s*from\s*['"]react['"]/);
    // Suspense fallback 文案"加载中..."（D6 [约束]：与既有 loading 文案一致，避免新文案破坏既有测试断言）。
    expect(src).toMatch(/<Suspense\s+fallback=\{<div>加载中\.\.\.<\/div>\}>/);
  });
});
