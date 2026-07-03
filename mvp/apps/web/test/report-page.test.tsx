// @vitest-environment jsdom
// apps/web/test/report-page.test.tsx —— ③类新增 ReportPage 组件测（TECH-WEB-NOTIFICATION-REPORT-001 §9.3 T5）
//
// 覆盖 AC：AC-F7-1~F7-9（group_by checkbox SSOT 派生+时间范围 ISO+operator_id advisory+entity_type/action select SSOT+
//          筛选+分页复合+group_by 缺省/空客户端拦截+时间范围非法客户端拦截+动态列+分页/空/加载）、
//          AC-F9-2（报表错误码提示组件层显示）、AC-S1-1（自由文本 advisory）/AC-S1-2（类型派生 TS 保证）
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api.reports.queryOperations（控制 resolve/reject + 断言入参），AuthContext.Provider 提供已登录态。
//   - 期望「断言级红」：ReportPage stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D12 / R14 S-9：报表整体筛选采用"应用筛选"按钮触发请求（不每键入触发），datetime-local/operator_id 文本输入
//     均经"应用筛选"按钮原子提交，无须 debounce。
//   - AC-F7-1：group_by checkbox 选项从 [...reportGroupByDimSchema.options] SSOT 派生（4 项，AI-005）。
//   - AC-F7-4：entity_type select 从 [...auditLogEntityTypeSchema.options] SSOT 派生（5 项）+ action select 从
//     [...auditLogActionSchema.options] SSOT 派生（6 项），report 复用 audit 枚举。
//   - AC-F7-3 [advisory]：operator_id 文本输入客户端校验 uuid 格式（advisory 不强制 safeParse，空表示不筛）。
//   - AC-F7-6 [advisory+服务端兜底]：group_by 缺省/空 → 客户端 advisory 校验非空显示"请至少选择一个分组维度"不发请求
//     （Q8 决策②不预填默认维度）；服务端 REPORT_GROUP_BY_REQUIRED 码映射由 T2+T9 覆盖。
//   - AC-F7-7 [advisory+服务端兜底]：operated_from > operated_to → 客户端 advisory 校验 from<=to 显示"开始时间不能晚于结束时间"
//     不发请求；服务端 REPORT_TIME_RANGE_INVALID 码映射由 T2+T9 覆盖。
//   - AC-F7-8：动态列——ReportTable 据 result.group_by 渲染列头（维度中文名+计数列），group_by 变化列头动态更新（Q7 决策②）。
//   - AC-S1-2：group_by checkbox + entity_type/action select 为类型派生操作（值经 options 派生保证 ∈ 枚举，TS 类型保证，不调 safeParse）。
//   - AC-S1-1：operator_id/operated_from/operated_to 为自由输入，客户端 advisory 校验（不强制 safeParse reportQuerySchema）。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  reportGroupByDimSchema,
  auditLogEntityTypeSchema,
  auditLogActionSchema,
  type ReportResult,
} from '@admin/contracts';
import { ReportPage } from '../src/pages/ReportPage.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import { ApiError } from '../src/api/client.js';
import * as apiReports from '../src/api/reports.js';

vi.mock('../src/api/reports.js', () => ({
  queryOperations: vi.fn(),
}));

const queryOperationsMock = vi.mocked(apiReports.queryOperations);

// SSOT 派生：从 contracts 取全集（AI-005，禁止硬编码）
const ALL_GROUP_BY_DIMS = [...reportGroupByDimSchema.options];
const ALL_ENTITY_TYPES = [...auditLogEntityTypeSchema.options];
const ALL_ACTIONS = [...auditLogActionSchema.options];

function makeReportResult(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    items: [{ operator_id: '00000000-0000-4000-8000-0000000000u1', count: 5 }],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    group_by: ['operator_id'],
    ...overrides,
  };
}

function renderReportPage() {
  const authValue: AuthContextValue = {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <ReportPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

/** 勾选一个 group_by 维度 checkbox（按维度值 aria-label 定位）。
 * [R15 impl-writer 改] checkbox 改用 aria-label={dim}（英文维度值），避免 getByLabelText(/实体类型/)
 *   同时匹配 checkbox + select；helper 改用 dim（英文）做 regex（①类 setup 调整）。 */
async function checkGroupByDim(user: ReturnType<typeof userEvent.setup>, dim: string) {
  await user.click(screen.getByRole('checkbox', { name: new RegExp(dim) }));
}

describe('ReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F7-1 group_by checkbox SSOT 派生（4 项）----------
  it('group_by checkbox 选项 = [...reportGroupByDimSchema.options] SSOT 派生 4 项（AC-F7-1，AI-005，AC-S1-2 类型派生）', () => {
    renderReportPage();
    const group = screen.getByRole('group', { name: /分组维度/ });
    const checkboxes = group.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(ALL_GROUP_BY_DIMS.length);
    const values = Array.from(checkboxes).map((c) => c.getAttribute('value'));
    for (const dim of ALL_GROUP_BY_DIMS) {
      expect(values).toContain(dim);
    }
  });

  // ---------- AC-F7-4 entity_type select SSOT 派生（5 项）----------
  it('entity_type select 选项 = [...auditLogEntityTypeSchema.options] SSOT 派生 5 项（AC-F7-4，AI-005，AC-S1-2）', () => {
    renderReportPage();
    const select = screen.getByLabelText(/实体类型/);
    const optionValues = Array.from(select.querySelectorAll('option'))
      .map((o) => o.getAttribute('value'))
      .filter((v): v is string => v !== null && v !== '');
    for (const et of ALL_ENTITY_TYPES) {
      expect(optionValues).toContain(et);
    }
  });

  // ---------- AC-F7-4 action select SSOT 派生（6 项）----------
  it('action select 选项 = [...auditLogActionSchema.options] SSOT 派生 6 项（AC-F7-4，AI-005，AC-S1-2）', () => {
    renderReportPage();
    const select = screen.getByLabelText(/动作/);
    const optionValues = Array.from(select.querySelectorAll('option'))
      .map((o) => o.getAttribute('value'))
      .filter((v): v is string => v !== null && v !== '');
    for (const a of ALL_ACTIONS) {
      expect(optionValues).toContain(a);
    }
  });

  // ---------- AC-F7-1 勾选 operator_id + 应用筛选 → queryOperations(group_by:['operator_id']) ----------
  it('勾选 operator_id + 应用筛选 → queryOperations 含 group_by:["operator_id"]（AC-F7-1，D12 应用筛选按钮）', async () => {
    queryOperationsMock.mockResolvedValue(makeReportResult());
    const user = userEvent.setup();
    renderReportPage();

    await checkGroupByDim(user, 'operator_id');
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    await waitFor(() => {
      expect(queryOperationsMock).toHaveBeenCalledWith(
        expect.objectContaining({ group_by: ['operator_id'] }),
      );
    });
  });

  // ---------- AC-F7-2 时间范围 datetime-local → ISO 归一 ----------
  it('填时间范围 + 应用筛选 → queryOperations 含 operated_from/operated_to ISO 字符串（AC-F7-2，Q6 datetime-local 归一）', async () => {
    queryOperationsMock.mockResolvedValue(makeReportResult());
    const user = userEvent.setup();
    renderReportPage();

    await checkGroupByDim(user, 'operator_id');
    // datetime-local 输入（jsdom 用 fireEvent.change 设值）
    fireEvent.change(screen.getByLabelText(/开始时间/), { target: { value: '2026-07-03T12:00' } });
    fireEvent.change(screen.getByLabelText(/结束时间/), { target: { value: '2026-07-03T18:00' } });
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    await waitFor(() => {
      expect(queryOperationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          operated_from: expect.stringContaining('2026-07-03'),
          operated_to: expect.stringContaining('2026-07-03'),
        }),
      );
    });
  });

  // ---------- AC-F7-3 operator_id 合法 uuid → query 含 operator_id ----------
  it('填合法 operator_id uuid + 应用筛选 → queryOperations 含 operator_id（AC-F7-3）', async () => {
    queryOperationsMock.mockResolvedValue(makeReportResult());
    const user = userEvent.setup();
    renderReportPage();

    await checkGroupByDim(user, 'operator_id');
    // [R15 impl-writer 改] 原 fixture '...0000u1' 含非 hex 字符 'u'，被 ReportFilter advisory UUID_RE 拦截（不发请求）。
    //   改为有效 hex UUID '...000001'（①类 setup 调整，对齐 z.string().uuid() 严格校验）。
    await user.type(screen.getByLabelText(/操作者 ID|operator id/i), '00000000-0000-4000-8000-000000000001');
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    await waitFor(() => {
      expect(queryOperationsMock).toHaveBeenCalledWith(
        expect.objectContaining({ operator_id: '00000000-0000-4000-8000-000000000001' }),
      );
    });
  });

  // ---------- AC-F7-3 operator_id 非 uuid → advisory 拦截不发请求 ----------
  it('operator_id 非 uuid 格式 → 显示"操作者 ID 须为 UUID 格式" + 不发请求（AC-F7-3，AC-S1-1 advisory）', async () => {
    const user = userEvent.setup();
    renderReportPage();

    await checkGroupByDim(user, 'operator_id');
    await user.type(screen.getByLabelText(/操作者 ID|operator id/i), 'not-a-uuid');
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    expect(await screen.findByText(/操作者 ID 须为 UUID 格式/)).toBeInTheDocument();
    expect(queryOperationsMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F7-4 entity_type=role + action=create → query 含两者 ----------
  it('选 entity_type=role + action=create + 应用筛选 → queryOperations 含两者（AC-F7-4，AC-S1-2 select 类型派生）', async () => {
    queryOperationsMock.mockResolvedValue(
      makeReportResult({ items: [{ entity_type: 'role', action: 'create', count: 3 }], group_by: ['entity_type', 'action'] }),
    );
    const user = userEvent.setup();
    renderReportPage();

    await checkGroupByDim(user, 'entity_type');
    await checkGroupByDim(user, 'action');
    await user.selectOptions(screen.getByLabelText(/实体类型/), 'role');
    await user.selectOptions(screen.getByLabelText(/动作/), 'create');
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    await waitFor(() => {
      expect(queryOperationsMock).toHaveBeenCalledWith(
        expect.objectContaining({ entity_type: 'role', action: 'create' }),
      );
    });
  });

  // ---------- AC-F7-6 group_by 空 → 客户端 advisory 拦截 ----------
  it('未勾选任何 group_by + 应用筛选 → 显示"请至少选择一个分组维度" + 不发请求（AC-F7-6，Q8 不预填，AC-S1-1 advisory）', async () => {
    const user = userEvent.setup();
    renderReportPage();

    // 不勾选任何 group_by，直接应用筛选
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    expect(await screen.findByText(/请至少选择一个分组维度/)).toBeInTheDocument();
    expect(queryOperationsMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F7-7 operated_from > operated_to → 客户端 advisory 拦截 ----------
  it('开始时间晚于结束时间 → 显示"开始时间不能晚于结束时间" + 不发请求（AC-F7-7，AC-S1-1 advisory）', async () => {
    const user = userEvent.setup();
    renderReportPage();

    await checkGroupByDim(user, 'operator_id');
    fireEvent.change(screen.getByLabelText(/开始时间/), { target: { value: '2026-07-03T18:00' } });
    fireEvent.change(screen.getByLabelText(/结束时间/), { target: { value: '2026-07-03T12:00' } });
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    expect(await screen.findByText(/开始时间不能晚于结束时间/)).toBeInTheDocument();
    expect(queryOperationsMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F9-2/F7-7 服务端兜底码组件层显示（REPORT_TIME_RANGE_INVALID）----------
  it('queryOperations 拒绝 REPORT_TIME_RANGE_INVALID → 显示"开始时间不能晚于结束时间"（AC-F9-2，服务端兜底组件层显示）', async () => {
    queryOperationsMock.mockRejectedValue(
      new ApiError('REPORT_TIME_RANGE_INVALID', '开始时间不能晚于结束时间'),
    );
    const user = userEvent.setup();
    renderReportPage();

    await checkGroupByDim(user, 'operator_id');
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    expect(await screen.findByText(/开始时间不能晚于结束时间/)).toBeInTheDocument();
  });

  // ---------- AC-F7-8 动态列渲染（group_by=['operator_id','date']）----------
  it('响应 group_by=["operator_id","date"] → 表头含"操作者"+"日期"+"计数"列 + 行 count（AC-F7-8，Q7 动态列）', async () => {
    queryOperationsMock.mockResolvedValue(
      makeReportResult({
        items: [
          { operator_id: '00000000-0000-4000-8000-0000000000u1', date: '2026-07-03', count: 42 },
        ],
        total: 1,
        group_by: ['operator_id', 'date'],
      }),
    );
    const user = userEvent.setup();
    renderReportPage();

    await checkGroupByDim(user, 'operator_id');
    await checkGroupByDim(user, 'date');
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    // 动态列头：维度中文名 + 计数列
    expect(await screen.findByText('操作者')).toBeInTheDocument();
    expect(screen.getByText('日期')).toBeInTheDocument();
    expect(screen.getByText(/计数/)).toBeInTheDocument();
    // 行 count 值
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  // ---------- AC-F7-8 动态列随 group_by 变化（['entity_type','action']）----------
  it('响应 group_by=["entity_type","action"] → 表头含"实体类型"+"动作"+"计数"列（AC-F7-8，列头动态更新）', async () => {
    queryOperationsMock.mockResolvedValue(
      makeReportResult({
        items: [{ entity_type: 'role', action: 'create', count: 7 }],
        total: 1,
        group_by: ['entity_type', 'action'],
      }),
    );
    const user = userEvent.setup();
    renderReportPage();

    await checkGroupByDim(user, 'entity_type');
    await checkGroupByDim(user, 'action');
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    expect(await screen.findByText('实体类型')).toBeInTheDocument();
    expect(screen.getByText('动作')).toBeInTheDocument();
    expect(screen.getByText(/计数/)).toBeInTheDocument();
  });

  // ---------- AC-F7-9 分页信息（共 X 条，第 Y/Z 页）----------
  it('响应 total=25 totalPages=2 → 显示"共 25 条"+"第 1/2 页"（AC-F7-9）', async () => {
    queryOperationsMock.mockResolvedValue(
      makeReportResult({ total: 25, page: 1, totalPages: 2 }),
    );
    const user = userEvent.setup();
    renderReportPage();

    await checkGroupByDim(user, 'operator_id');
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    expect(await screen.findByText(/共.*25.*条/)).toBeInTheDocument();
    expect(screen.getByText(/1.*\/.*2.*页|第\s*1\s*\/\s*2/)).toBeInTheDocument();
  });

  // ---------- AC-F7-5 筛选+分页复合（R13 S-3 组合场景）----------
  it('筛选+分页复合：勾选 group_by 后翻页 → queryOperations 含 group_by + page=2（AC-F7-5，R13 S-3）', async () => {
    queryOperationsMock.mockResolvedValue(
      makeReportResult({ total: 25, page: 1, totalPages: 2 }),
    );
    const user = userEvent.setup();
    renderReportPage();

    await checkGroupByDim(user, 'operator_id');
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));
    await screen.findByText(/共.*25.*条/);

    await user.click(screen.getByRole('button', { name: /下一页|>|next/i }));

    await waitFor(() => {
      expect(queryOperationsMock).toHaveBeenCalledWith(
        expect.objectContaining({ group_by: ['operator_id'], page: 2 }),
      );
    });
  });

  // ---------- AC-F7-9 空状态 ----------
  it('空状态：items=[] total=0 → 显示"暂无统计数据"（AC-F7-9）', async () => {
    queryOperationsMock.mockResolvedValue(
      makeReportResult({ items: [], total: 0, totalPages: 0 }),
    );
    const user = userEvent.setup();
    renderReportPage();

    await checkGroupByDim(user, 'operator_id');
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    expect(await screen.findByText(/暂无统计数据/)).toBeInTheDocument();
  });

  // ---------- AC-F7-9 加载态 ----------
  it('加载态：请求进行中 → loading 文案（AC-F7-9，R12 D16）', async () => {
    queryOperationsMock.mockReturnValue(new Promise<ReportResult>(() => {}));
    const user = userEvent.setup();
    renderReportPage();

    await checkGroupByDim(user, 'operator_id');
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    expect(await screen.findByText(/loading|加载中/i)).toBeInTheDocument();
  });
});
