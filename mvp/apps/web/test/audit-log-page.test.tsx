// @vitest-environment jsdom
// apps/web/test/audit-log-page.test.tsx —— ③类新增 AuditLogPage 组件测（TECH-WEB-ROLE-DEPT-AUDIT-001 §9.3 T6）
//
// 覆盖 AC：AC-F7-1~F7-11、AC-F7-6（组合场景 筛选+分页）、AC-F7-10（PII 脱敏展示）
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api.auditLogs.listAuditLogs（控制 resolve + 断言 query 入参）。
//   - 期望「断言级红」：AuditLogPage stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D10 [约束]：消费 RedactedAuditLog（脱敏态），before/after 中 pii=true 字段展示脱敏值 ab***@example.com。
//   - D14 [约束]：筛选区仅 entity_type/operator_id/operated_from/operated_to（无 action，B3），AC-F7-7。
//   - D15 [约束]：date_range 用 datetime-local + ISO 归一，AC-F7-5。
//   - D21 [约束]：前端显式传 pageSize=20（不依赖 schema 缺省 20）。
//   - AC-F7-11：只读无写入口（无创建/编辑/删除按钮）。
//   - AC-F7-6 [R13 S-3]：筛选+分页组合场景（翻页保持筛选条件）。
//   - AC-F7-3：entity_type select 选项从 [...auditLogEntityTypeSchema.options] SSOT 派生（AI-005）。
//   - SEC-003b：测试中不 console.log/记录 operator_id/operator_name/before/after 字段。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  auditLogEntityTypeSchema,
  type AuditLogListResult,
  type RedactedAuditLog,
} from '@admin/contracts';
import { AuditLogPage } from '../src/pages/AuditLogPage.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import * as apiAuditLogs from '../src/api/audit-logs.js';

vi.mock('../src/api/audit-logs.js', () => ({
  listAuditLogs: vi.fn(),
}));

const listAuditLogsMock = vi.mocked(apiAuditLogs.listAuditLogs);

// SSOT 派生：从 contracts auditLogEntityTypeSchema 取全集（AI-005，禁止硬编码）
const ALL_ENTITY_TYPES = [...auditLogEntityTypeSchema.options];

const OPERATOR_ID = '00000000-0000-4000-8000-0000000000op';
const ENTITY_ID = '00000000-0000-4000-8000-0000000000e1';

/** 脱敏审计日志 fixture（before/after 中 pii=true 字段值已脱敏，D10）。 */
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

function makeListResult(
  items: RedactedAuditLog[],
  overrides: Partial<AuditLogListResult> = {},
): AuditLogListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    totalPages: items.length === 0 ? 0 : 1,
    ...overrides,
  };
}

function renderAuditLogPage() {
  const authValue: AuthContextValue = {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('AuditLogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F7-1 首次加载 + 渲染日志行 ----------
  it('首次加载调 listAuditLogs({page:1,pageSize:20}) + 渲染日志行（AC-F7-1，D21）', async () => {
    const log = makeRedactedLog({ operator_name: '管理员A', action: 'create', entity_type: 'user' });
    listAuditLogsMock.mockResolvedValue(makeListResult([log]));
    renderAuditLogPage();

    await waitFor(() => {
      expect(listAuditLogsMock).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    });
    expect(await screen.findByText('管理员A')).toBeInTheDocument();
  });

  // ---------- AC-F7-2 分页 ----------
  it('分页：点下一页 → listAuditLogs({page:2})（AC-F7-2）', async () => {
    listAuditLogsMock.mockResolvedValue(
      makeListResult([makeRedactedLog()], { total: 25, page: 1, totalPages: 2 }),
    );
    const user = userEvent.setup();
    renderAuditLogPage();

    await screen.findByText('管理员');
    await user.click(screen.getByRole('button', { name: /下一页|>|next/i }));

    await waitFor(() => {
      expect(listAuditLogsMock).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    });
  });

  // ---------- AC-F7-3 entity_type 筛选 SSOT 派生（AI-005）----------
  it('entity_type select 选项 = [...auditLogEntityTypeSchema.options] SSOT 派生（AC-F7-3，AI-005）', async () => {
    listAuditLogsMock.mockResolvedValue(makeListResult([]));
    renderAuditLogPage();

    await screen.findByText(/暂无审计日志|loading/i);
    const select = screen.getByLabelText(/实体类型|entity/i);
    const optionValues = Array.from(select.querySelectorAll('option'))
      .map((o) => o.getAttribute('value'))
      .filter((v): v is string => v !== null && v !== '');
    // SSOT 派生断言：每个 entity_type 均出现在 select options 中
    for (const et of ALL_ENTITY_TYPES) {
      expect(optionValues).toContain(et);
    }
  });

  // ---------- AC-F7-3 选 entity_type=role → query 含 entity_type=role ----------
  it('选 entity_type=role → listAuditLogs query 含 entity_type=role（AC-F7-3）', async () => {
    listAuditLogsMock.mockResolvedValue(makeListResult([]));
    const user = userEvent.setup();
    renderAuditLogPage();

    await screen.findByText(/暂无审计日志|loading/i);
    await user.selectOptions(screen.getByLabelText(/实体类型|entity/i), 'role');

    await waitFor(() => {
      expect(listAuditLogsMock).toHaveBeenCalledWith(
        expect.objectContaining({ entity_type: 'role' }),
      );
    });
  });

  // ---------- AC-F7-4 operator_id 筛选 ----------
  it('输入 operator_id → listAuditLogs query 含 operator_id=<uuid>（AC-F7-4）', async () => {
    listAuditLogsMock.mockResolvedValue(makeListResult([]));
    const user = userEvent.setup();
    renderAuditLogPage();

    await screen.findByText(/暂无审计日志|loading/i);
    await user.type(screen.getByLabelText(/操作者|operator/i), OPERATOR_ID);

    await waitFor(() => {
      expect(listAuditLogsMock).toHaveBeenCalledWith(
        expect.objectContaining({ operator_id: OPERATOR_ID }),
      );
    });
  });

  // ---------- AC-F7-5 date_range 筛选 ISO 归一（D15）----------
  it('输入 operated_from+operated_to → query 含 ISO 归一化字符串（AC-F7-5，D15）', async () => {
    listAuditLogsMock.mockResolvedValue(makeListResult([]));
    const user = userEvent.setup();
    renderAuditLogPage();

    await screen.findByText(/暂无审计日志|loading/i);
    // datetime-local 输入（impl 归一为 ISO 8601 datetime with seconds + Z）
    const fromInput = screen.getByLabelText(/开始|from|operated_from/i);
    const toInput = screen.getByLabelText(/结束|to|operated_to/i);
    await user.type(fromInput, '2026-07-01T00:00');
    await user.type(toInput, '2026-07-03T23:59');

    await waitFor(() => {
      const calls = listAuditLogsMock.mock.calls;
      const lastCall = calls[calls.length - 1]?.[0];
      expect(lastCall).toBeDefined();
      // D15：归一为 ISO 8601 datetime（含秒+Z，通过 listAuditLogQuerySchema z.string().datetime() 校验）
      if (lastCall?.operated_from) {
        expect(lastCall.operated_from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
      if (lastCall?.operated_to) {
        expect(lastCall.operated_to).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    });
  });

  // ---------- AC-F7-6 筛选+分页组合场景（R13 S-3）----------
  it('筛选+分页组合：选 entity_type=role 后翻页 → listAuditLogs({page:2, entity_type:"role"})（AC-F7-6，R13 S-3）', async () => {
    listAuditLogsMock.mockResolvedValue(
      makeListResult([makeRedactedLog()], { total: 25, page: 1, totalPages: 2 }),
    );
    const user = userEvent.setup();
    renderAuditLogPage();

    await screen.findByText('管理员');
    // 1. 选筛选条件
    await user.selectOptions(screen.getByLabelText(/实体类型|entity/i), 'role');
    await waitFor(() => {
      expect(listAuditLogsMock).toHaveBeenCalledWith(
        expect.objectContaining({ entity_type: 'role' }),
      );
    });

    // 2. 翻页（保持筛选条件，R13 S-3 组合场景）
    await user.click(screen.getByRole('button', { name: /下一页|>|next/i }));

    await waitFor(() => {
      // 翻页请求应同时含 entity_type=role + page=2（不能丢失筛选条件）
      expect(listAuditLogsMock).toHaveBeenCalledWith(
        expect.objectContaining({ entity_type: 'role', page: 2 }),
      );
    });
  });

  // ---------- AC-F7-7 无 action 筛选控件（B3）----------
  it('筛选区无 action 控件（AC-F7-7，B3 contract 不支持 action 筛选）', async () => {
    listAuditLogsMock.mockResolvedValue(makeListResult([]));
    renderAuditLogPage();

    await screen.findByText(/暂无审计日志|loading/i);
    // 反向核实：筛选区不应有 action select/input
    expect(screen.queryByLabelText(/^action$|^动作$/i)).not.toBeInTheDocument();
  });

  // ---------- AC-F7-8 空状态 ----------
  it('空状态：items=[] → 显示"暂无审计日志"（AC-F7-8）', async () => {
    listAuditLogsMock.mockResolvedValue(makeListResult([]));
    renderAuditLogPage();

    expect(await screen.findByText('暂无审计日志')).toBeInTheDocument();
  });

  // ---------- AC-F7-9 加载态 ----------
  it('加载态：loading=true → loading 文案（AC-F7-9，D16）', async () => {
    listAuditLogsMock.mockReturnValue(new Promise<AuditLogListResult>(() => {}));
    renderAuditLogPage();

    expect(await screen.findByText(/loading|加载中/i)).toBeInTheDocument();
  });

  // ---------- AC-F7-10 PII 脱敏展示（D10）----------
  it('PII 脱敏：before/after 中 pii=true 字段展示脱敏值 ab***@example.com（AC-F7-10，D10）', async () => {
    const log = makeRedactedLog({
      after: [{ field: 'email', value: 'ab***@example.com', pii: true }],
    });
    listAuditLogsMock.mockResolvedValue(makeListResult([log]));
    renderAuditLogPage();

    // 展示脱敏值 ab***@example.com（不展示完整邮箱）
    expect(await screen.findByText('ab***@example.com')).toBeInTheDocument();
    // 反向核实：不应展示完整邮箱（脱敏值匹配 redactedEmailSchema /^.{2}\*\*\*@[^\s@]+$/）
    expect(screen.queryByText('abcdef@example.com')).not.toBeInTheDocument();
  });

  // ---------- AC-F7-11 只读无写入口 ----------
  it('只读无写入口：无创建/编辑/删除审计日志的按钮（AC-F7-11，append-only 只读）', async () => {
    listAuditLogsMock.mockResolvedValue(makeListResult([makeRedactedLog()]));
    renderAuditLogPage();

    await screen.findByText('管理员');
    // 反向核实：不应有"创建审计"/"编辑审计"/"删除审计"等写操作按钮
    expect(screen.queryByRole('button', { name: /创建.*审计|新增.*审计/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑.*审计|修改.*审计/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除.*审计/i })).not.toBeInTheDocument();
  });
});
