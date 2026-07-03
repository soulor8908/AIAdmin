// @vitest-environment jsdom
// apps/web/test/notification-list-page.test.tsx —— ③类新增 NotificationListPage 组件测（TECH-WEB-NOTIFICATION-REPORT-001 §9.3 T3）
//
// 覆盖 AC：AC-F1-1~F1-7（列表/分页/status 筛选/筛选+分页复合/空/加载/status 文案+按钮动态显示）、AC-F4-1/F4-4/F4-5/F4-3（发送成功+RECIPIENT 错误+重试仍冲突）、AC-F5-1/F5-4（标记已读成功+重试仍冲突）、AC-F6-1/F6-4/F6-3（删除成功+NOT_FOUND+重试仍冲突）、AC-S1-2（类型派生不 safeParse）
//
// AC-F4-2/F5-2/F5-3/F6-2 状态守卫（sent/read/draft 拒绝）组件层覆盖：Q3 决策①按 status 隐藏不可用按钮（AC-F1-7 已断言按钮可见性），
// 用户无法在 UI 触发非法状态操作；"若绕过直接调" 的错误码映射由 T9 error-mapping-extend-2.test.ts 覆盖（NOTIFICATION_INVALID_TRANSITION → "通知状态不允许此操作"）。
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api.notifications（listNotifications/sendNotification/markNotificationRead/deleteNotification），AuthContext.Provider 提供已登录态。
//   - 期望「断言级红」：NotificationListPage stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D16：首次加载 pageSize=20（不依赖 schema 缺省 10，N1）。
//   - D10：status 文案中文化（草稿/已发送/已读）+ 按 status 动态显示操作按钮（Q3/Q11）。
//   - AC-F1-3：status 选项从 [...notificationStatusSchema.options] SSOT 派生（3 项，AI-005）。
//   - AC-F1-4：筛选+分页复合（R13 S-3 组合场景）。
//   - AC-S1-2：send/markRead/delete 为类型派生操作（id/version 从列表派生，TS 类型保证，不调 safeParse）。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { notificationStatusSchema, type Notification, type NotificationListResult } from '@admin/contracts';
import { NotificationListPage } from '../src/pages/NotificationListPage.js';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext.js';
import { ApiError } from '../src/api/client.js';
import * as apiNotifications from '../src/api/notifications.js';

vi.mock('../src/api/notifications.js', () => ({
  listNotifications: vi.fn(),
  createNotification: vi.fn(),
  updateNotification: vi.fn(),
  sendNotification: vi.fn(),
  markNotificationRead: vi.fn(),
  deleteNotification: vi.fn(),
}));

const listNotificationsMock = vi.mocked(apiNotifications.listNotifications);
const sendNotificationMock = vi.mocked(apiNotifications.sendNotification);
const markNotificationReadMock = vi.mocked(apiNotifications.markNotificationRead);
const deleteNotificationMock = vi.mocked(apiNotifications.deleteNotification);

// SSOT 派生：从 contracts notificationStatusSchema 取全集（AI-005，禁止硬编码）
const ALL_STATUSES = [...notificationStatusSchema.options];

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '00000000-0000-4000-8000-0000000000n1',
    title: '测试通知',
    content: '测试内容',
    recipient_id: '00000000-0000-4000-8000-0000000000u1',
    status: 'draft',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    sent_at: null,
    read_at: null,
    version: 0,
    ...overrides,
  };
}

function makeListResult(
  items: Notification[],
  overrides: Partial<NotificationListResult> = {},
): NotificationListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    totalPages: items.length === 0 ? 0 : 1,
    ...overrides,
  };
}

function renderNotificationListPage() {
  const authValue: AuthContextValue = {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <NotificationListPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('NotificationListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F1-1 首次加载 ----------
  it('首次加载调 listNotifications({page:1, pageSize:20})（AC-F1-1，D16）', async () => {
    listNotificationsMock.mockResolvedValue(makeListResult([makeNotification()]));
    renderNotificationListPage();

    await waitFor(() => {
      expect(listNotificationsMock).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    });
  });

  // ---------- AC-F1-1 渲染通知行 ----------
  it('渲染通知行（title/recipient_id/status 文案中文化，AC-F1-1/F1-7）', async () => {
    const notif = makeNotification({ title: '系统维护通知', status: 'draft' });
    listNotificationsMock.mockResolvedValue(makeListResult([notif]));
    renderNotificationListPage();

    expect(await screen.findByText('系统维护通知')).toBeInTheDocument();
    // D10：status 文案中文化（draft→草稿）
    expect(screen.getByText(/草稿/)).toBeInTheDocument();
  });

  // ---------- AC-F1-7 status 文案 + 按 status 动态显示操作按钮（Q3/Q11）----------
  it('draft 行显示"草稿" + "编辑"/"发送"/"删除"按钮（AC-F1-7，D10）', async () => {
    const notif = makeNotification({ status: 'draft' });
    listNotificationsMock.mockResolvedValue(makeListResult([notif]));
    renderNotificationListPage();

    expect(await screen.findByText(/草稿/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /编辑/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /发送/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /删除/i })).toBeInTheDocument();
  });

  // ---------- AC-F1-7 sent 行显示"已发送" + 仅"标记已读"按钮 ----------
  it('sent 行显示"已发送" + 仅"标记已读"按钮（无编辑/发送/删除，AC-F1-7，Q3 决策①）', async () => {
    const notif = makeNotification({
      status: 'sent',
      sent_at: '2026-07-03T10:00:00.000Z',
      version: 1,
    });
    listNotificationsMock.mockResolvedValue(makeListResult([notif]));
    renderNotificationListPage();

    expect(await screen.findByText(/已发送/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /标记已读/i })).toBeInTheDocument();
    // Q3 决策①隐藏不可用按钮（非全显示禁用）
    expect(screen.queryByRole('button', { name: /^编辑$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^发送$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^删除$/i })).not.toBeInTheDocument();
  });

  // ---------- AC-F1-7 read 行显示"已读" + 无操作按钮 ----------
  it('read 行显示"已读" + 无操作按钮（AC-F1-7，Q3 决策①）', async () => {
    const notif = makeNotification({
      status: 'read',
      sent_at: '2026-07-03T10:00:00.000Z',
      read_at: '2026-07-03T11:00:00.000Z',
      version: 2,
    });
    listNotificationsMock.mockResolvedValue(makeListResult([notif]));
    renderNotificationListPage();

    expect(await screen.findByText(/已读/)).toBeInTheDocument();
    // read 为终态，无操作按钮
    expect(screen.queryByRole('button', { name: /编辑|发送|删除|标记已读/i })).not.toBeInTheDocument();
  });

  // ---------- AC-F1-2 分页 ----------
  it('分页：点下一页 → listNotifications({page:2})（AC-F1-2）', async () => {
    listNotificationsMock.mockResolvedValue(
      makeListResult([makeNotification()], { total: 25, page: 1, totalPages: 2 }),
    );
    const user = userEvent.setup();
    renderNotificationListPage();

    await screen.findByText(/测试通知/);
    await user.click(screen.getByRole('button', { name: /下一页|>|next/i }));

    await waitFor(() => {
      expect(listNotificationsMock).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    });
  });

  // ---------- AC-F1-3 status 筛选 SSOT 派生（3 项）----------
  it('status 筛选选项 = [...notificationStatusSchema.options] SSOT 派生 3 项（AC-F1-3，AI-005）', async () => {
    listNotificationsMock.mockResolvedValue(makeListResult([makeNotification()]));
    renderNotificationListPage();

    await screen.findByText(/测试通知/);
    // status 筛选 select 的 options 应覆盖全部 3 个状态（SSOT 派生，禁止硬编码）
    const select = screen.getByLabelText(/状态|status/i);
    const optionValues = Array.from(select.querySelectorAll('option'))
      .map((o) => o.getAttribute('value'))
      .filter((v): v is string => v !== null && v !== '');
    for (const status of ALL_STATUSES) {
      expect(optionValues).toContain(status);
    }
  });

  // ---------- AC-F1-3 status 筛选触发请求 ----------
  it('选择 status=sent 筛选 → listNotifications 含 status=sent&page=1（AC-F1-3）', async () => {
    listNotificationsMock.mockResolvedValue(makeListResult([makeNotification()]));
    const user = userEvent.setup();
    renderNotificationListPage();

    await screen.findByText(/测试通知/);
    await user.selectOptions(screen.getByLabelText(/状态|status/i), 'sent');

    await waitFor(() => {
      expect(listNotificationsMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', page: 1 }));
    });
  });

  // ---------- AC-F1-4 筛选+分页复合（R13 S-3 组合场景）----------
  it('筛选+分页复合：选 status=sent 后翻页 → 保持 status=sent&page=2（AC-F1-4，R13 S-3）', async () => {
    listNotificationsMock.mockResolvedValue(
      makeListResult([makeNotification({ status: 'sent' })], { total: 25, page: 1, totalPages: 2 }),
    );
    const user = userEvent.setup();
    renderNotificationListPage();

    await screen.findByText(/测试通知/);
    await user.selectOptions(screen.getByLabelText(/状态|status/i), 'sent');

    await waitFor(() => {
      expect(listNotificationsMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', page: 1 }));
    });

    await user.click(screen.getByRole('button', { name: /下一页|>|next/i }));

    await waitFor(() => {
      expect(listNotificationsMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', page: 2 }));
    });
  });

  // ---------- AC-F1-5 空状态 ----------
  it('空状态：items=[] → 显示"暂无通知"（AC-F1-5）', async () => {
    listNotificationsMock.mockResolvedValue(makeListResult([]));
    renderNotificationListPage();

    expect(await screen.findByText(/暂无通知/)).toBeInTheDocument();
  });

  // ---------- AC-F1-6 加载态 ----------
  it('加载态：loading=true → loading 文案（AC-F1-6，R12 D16）', async () => {
    listNotificationsMock.mockReturnValue(new Promise<NotificationListResult>(() => {}));
    renderNotificationListPage();

    expect(await screen.findByText(/loading|加载中/i)).toBeInTheDocument();
  });

  // ========== F4 通知发送（类型派生操作，id/version 从列表派生，AC-S1-2 不调 safeParse）==========

  // ---------- AC-F4-1 发送成功 ----------
  it('点击"发送"(draft) → sendNotification(id, version) + 列表刷新（AC-F4-1，AC-S1-2 类型派生）', async () => {
    const notif = makeNotification({ status: 'draft', version: 3 });
    const sentNotif: Notification = {
      ...notif,
      status: 'sent',
      sent_at: '2026-07-03T10:00:00.000Z',
      version: 4,
    };
    listNotificationsMock.mockResolvedValueOnce(makeListResult([notif]));
    listNotificationsMock.mockResolvedValueOnce(makeListResult([sentNotif]));
    sendNotificationMock.mockResolvedValue(sentNotif);
    const user = userEvent.setup();
    renderNotificationListPage();

    await screen.findByText(/草稿/);
    await user.click(screen.getByRole('button', { name: /发送/i }));

    // 类型派生操作：id/version 从列表项派生，TS 类型保证，不调 safeParse（AC-S1-2）
    await waitFor(() => {
      expect(sendNotificationMock).toHaveBeenCalledWith(notif.id, 3);
    });
    // 列表刷新（listNotifications 至少 2 次：初始 + 发送后刷新）
    await waitFor(() => {
      expect(listNotificationsMock).toHaveBeenCalledTimes(2);
    });
  });

  // ---------- AC-F4-4 RECIPIENT_NOT_FOUND（N4 send 时延后校验）----------
  it('发送 draft → NOTIFICATION_RECIPIENT_NOT_FOUND → 显示"收件人不存在"（AC-F4-4，N4 延后校验）', async () => {
    const notif = makeNotification({ status: 'draft', version: 0 });
    listNotificationsMock.mockResolvedValue(makeListResult([notif]));
    sendNotificationMock.mockRejectedValue(
      new ApiError('NOTIFICATION_RECIPIENT_NOT_FOUND', '收件人不存在'),
    );
    const user = userEvent.setup();
    renderNotificationListPage();

    await screen.findByText(/草稿/);
    await user.click(screen.getByRole('button', { name: /发送/i }));

    expect(await screen.findByText(/收件人不存在/)).toBeInTheDocument();
  });

  // ---------- AC-F4-5 RECIPIENT_DISABLED（N4 send 时延后校验）----------
  it('发送 draft → NOTIFICATION_RECIPIENT_DISABLED → 显示"收件人已禁用"（AC-F4-5，N4 延后校验）', async () => {
    const notif = makeNotification({ status: 'draft', version: 0 });
    listNotificationsMock.mockResolvedValue(makeListResult([notif]));
    sendNotificationMock.mockRejectedValue(
      new ApiError('NOTIFICATION_RECIPIENT_DISABLED', '收件人已禁用'),
    );
    const user = userEvent.setup();
    renderNotificationListPage();

    await screen.findByText(/草稿/);
    await user.click(screen.getByRole('button', { name: /发送/i }));

    expect(await screen.findByText(/收件人已禁用/)).toBeInTheDocument();
  });

  // ---------- AC-F4-3 重试仍冲突 → "数据已被修改"（组件层：client 重试耗尽后仍冲突提示）----------
  it('发送 draft → VERSION_CONFLICT（重试仍冲突）→ 显示"数据已被修改"（AC-F4-3，组件层重试后仍冲突提示）', async () => {
    const notif = makeNotification({ status: 'draft', version: 0 });
    listNotificationsMock.mockResolvedValue(makeListResult([notif]));
    // client D9 重试耗尽后仍 409 → 抛 VERSION_CONFLICT 给组件
    sendNotificationMock.mockRejectedValue(
      new ApiError('VERSION_CONFLICT', '数据已被修改，请刷新后重试', 5),
    );
    const user = userEvent.setup();
    renderNotificationListPage();

    await screen.findByText(/草稿/);
    await user.click(screen.getByRole('button', { name: /发送/i }));

    expect(await screen.findByText(/数据已被修改/)).toBeInTheDocument();
  });

  // ========== F5 通知标记已读（类型派生操作，AC-S1-2）==========

  // ---------- AC-F5-1 标记已读成功 ----------
  it('点击"标记已读"(sent) → markNotificationRead(id, version) + 列表刷新（AC-F5-1，AC-S1-2 类型派生）', async () => {
    const notif = makeNotification({
      status: 'sent',
      sent_at: '2026-07-03T10:00:00.000Z',
      version: 1,
    });
    const readNotif: Notification = {
      ...notif,
      status: 'read',
      read_at: '2026-07-03T11:00:00.000Z',
      version: 2,
    };
    listNotificationsMock.mockResolvedValueOnce(makeListResult([notif]));
    listNotificationsMock.mockResolvedValueOnce(makeListResult([readNotif]));
    markNotificationReadMock.mockResolvedValue(readNotif);
    const user = userEvent.setup();
    renderNotificationListPage();

    await screen.findByText(/已发送/);
    await user.click(screen.getByRole('button', { name: /标记已读/i }));

    await waitFor(() => {
      expect(markNotificationReadMock).toHaveBeenCalledWith(notif.id, 1);
    });
    await waitFor(() => {
      expect(listNotificationsMock).toHaveBeenCalledTimes(2);
    });
  });

  // ---------- AC-F5-4 重试仍冲突 → "数据已被修改"（组件层）----------
  it('标记已读 sent → VERSION_CONFLICT（重试仍冲突）→ 显示"数据已被修改"（AC-F5-4，组件层重试后仍冲突提示）', async () => {
    const notif = makeNotification({
      status: 'sent',
      sent_at: '2026-07-03T10:00:00.000Z',
      version: 1,
    });
    listNotificationsMock.mockResolvedValue(makeListResult([notif]));
    markNotificationReadMock.mockRejectedValue(
      new ApiError('VERSION_CONFLICT', '数据已被修改，请刷新后重试', 5),
    );
    const user = userEvent.setup();
    renderNotificationListPage();

    await screen.findByText(/已发送/);
    await user.click(screen.getByRole('button', { name: /标记已读/i }));

    expect(await screen.findByText(/数据已被修改/)).toBeInTheDocument();
  });

  // ========== F6 通知删除（类型派生操作，AC-S1-2）==========

  // ---------- AC-F6-1 删除成功 ----------
  it('点击"删除"(draft) → deleteNotification(id, version) + 列表刷新（AC-F6-1，AC-S1-2 类型派生）', async () => {
    const notif = makeNotification({ status: 'draft', version: 0 });
    listNotificationsMock.mockResolvedValueOnce(makeListResult([notif]));
    listNotificationsMock.mockResolvedValueOnce(makeListResult([]));
    deleteNotificationMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderNotificationListPage();

    await screen.findByText(/草稿/);
    await user.click(screen.getByRole('button', { name: /删除/i }));

    await waitFor(() => {
      expect(deleteNotificationMock).toHaveBeenCalledWith(notif.id, 0);
    });
    await waitFor(() => {
      expect(listNotificationsMock).toHaveBeenCalledTimes(2);
    });
  });

  // ---------- AC-F6-4 NOTIFICATION_NOT_FOUND → "通知不存在" + 列表刷新 ----------
  it('删除 draft → NOTIFICATION_NOT_FOUND → 显示"通知不存在" + 列表刷新（AC-F6-4）', async () => {
    const notif = makeNotification({ status: 'draft', version: 0 });
    listNotificationsMock.mockResolvedValue(makeListResult([notif]));
    deleteNotificationMock.mockRejectedValue(
      new ApiError('NOTIFICATION_NOT_FOUND', '通知不存在'),
    );
    const user = userEvent.setup();
    renderNotificationListPage();

    await screen.findByText(/草稿/);
    await user.click(screen.getByRole('button', { name: /删除/i }));

    expect(await screen.findByText(/通知不存在/)).toBeInTheDocument();
    // 列表刷新（AC-F6-4：删除不存在 → 刷新列表移除该行）
    await waitFor(() => {
      expect(listNotificationsMock).toHaveBeenCalledTimes(2);
    });
  });

  // ---------- AC-F6-3 重试仍冲突 → "数据已被修改"（组件层，DELETE 重试幂等）----------
  it('删除 draft → VERSION_CONFLICT（重试仍冲突）→ 显示"数据已被修改"（AC-F6-3，DELETE 重试幂等，组件层重试后仍冲突提示）', async () => {
    const notif = makeNotification({ status: 'draft', version: 0 });
    listNotificationsMock.mockResolvedValue(makeListResult([notif]));
    deleteNotificationMock.mockRejectedValue(
      new ApiError('VERSION_CONFLICT', '数据已被修改，请刷新后重试', 5),
    );
    const user = userEvent.setup();
    renderNotificationListPage();

    await screen.findByText(/草稿/);
    await user.click(screen.getByRole('button', { name: /删除/i }));

    expect(await screen.findByText(/数据已被修改/)).toBeInTheDocument();
  });
});
