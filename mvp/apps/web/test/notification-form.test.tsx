// @vitest-environment jsdom
// apps/web/test/notification-form.test.tsx —— ③类新增 NotificationForm 组件测（TECH-WEB-NOTIFICATION-REPORT-001 §9.3 T4）
//
// 覆盖 AC：AC-F2-1~F2-6（创建+自由文本 safeParse+延后校验）、AC-F3-1~F3-5（编辑 partial safeParse+状态守卫+409 重试+空对象）、
//          AC-ARCH-3（safeParse 拦截不发请求）、AC-S1-1（自由文本须 safeParse）
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - jsdom 环境（D20 per-file 注解）+ @testing-library/react + user-event。
//   - mock api.notifications（createNotification/updateNotification），AuthContext.Provider 提供已登录态。
//   - 期望「断言级红」：NotificationForm stub 抛 NOT_IMPLEMENTED，render 失败（非导入级红）。
//   - D4：自由文本表单须 createNotificationInputSchema.safeParse / updateNotificationInputSchema.safeParse（R13 S-1）。
//   - D15：recipient_id 自由文本 UUID 输入 + 存在性延后至 send（N4）。
//   - D21：aria-label 域特定（通知标题/通知内容/收件人 ID，R14 S-10 教训）。
//   - AC-F2-6：create 仅 recipient_id uuid 格式校验，存在性延后至 send（不触发 RECIPIENT_NOT_FOUND）。
//   - AC-F3-5：partial 空对象合法（N2）+ .strict() 拒绝多余字段。
//   - SEC-003b：测试中不 console.log/记录 token 字符串。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Notification } from '@admin/contracts';
import { NotificationForm } from '../src/components/NotificationForm.js';
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

const createNotificationMock = vi.mocked(apiNotifications.createNotification);
const updateNotificationMock = vi.mocked(apiNotifications.updateNotification);

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '00000000-0000-4000-8000-0000000000n1',
    title: '原标题',
    content: '原内容',
    recipient_id: '00000000-0000-4000-8000-0000000000u1',
    status: 'draft',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    sent_at: null,
    read_at: null,
    version: 3,
    ...overrides,
  };
}

function renderCreateForm() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const authValue: AuthContextValue = {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn(),
    logout: vi.fn(),
  };
  const result = render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <NotificationForm mode="create" onClose={onClose} onCreated={onCreated} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return { ...result, onClose, onCreated };
}

function renderEditForm(initial: Notification) {
  const onClose = vi.fn();
  const onUpdated = vi.fn();
  const authValue: AuthContextValue = {
    isAuthenticated: true,
    token: 'stub-token',
    login: vi.fn(),
    logout: vi.fn(),
  };
  const result = render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <NotificationForm mode="edit" initial={initial} onClose={onClose} onUpdated={onUpdated} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return { ...result, onClose, onUpdated };
}

// [R15 impl-writer 改] 原 fixture '...0000u1' 含非 hex 字符 'u'，被 createNotificationInputSchema
//   z.string().uuid() 拒绝（safeParse 失败 → createNotification 永不调用）。
//   改为有效 hex UUID '...000001'（①类 setup 调整，对齐 contracts z.string().uuid() 严格校验）。
const VALID_UUID = '00000000-0000-4000-8000-000000000001';

describe('NotificationForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- AC-F2-1 创建成功 ----------
  it('创建成功 → createNotification 调用 + 关闭弹窗 + onCreated 回调（AC-F2-1）', async () => {
    createNotificationMock.mockResolvedValue(makeNotification({ title: '新通知', version: 0 }));
    const user = userEvent.setup();
    const { onClose, onCreated } = renderCreateForm();

    await user.type(screen.getByLabelText(/通知标题/i), '新通知');
    await user.type(screen.getByLabelText(/通知内容/i), '通知内容');
    await user.type(screen.getByLabelText(/收件人\s*ID/i), VALID_UUID);
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    await waitFor(() => {
      expect(createNotificationMock).toHaveBeenCalledWith({
        title: '新通知',
        content: '通知内容',
        recipient_id: VALID_UUID,
      });
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ---------- AC-F2-1 创建后 status='draft', version=0, sent_at/read_at=null ----------
  it('创建返回 Notification status=draft version=0 sent_at=null read_at=null（AC-F2-1）', async () => {
    const created = makeNotification({ title: '新通知', status: 'draft', version: 0, sent_at: null, read_at: null });
    createNotificationMock.mockResolvedValue(created);
    const user = userEvent.setup();
    renderCreateForm();

    await user.type(screen.getByLabelText(/通知标题/i), '新通知');
    await user.type(screen.getByLabelText(/通知内容/i), '通知内容');
    await user.type(screen.getByLabelText(/收件人\s*ID/i), VALID_UUID);
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    await waitFor(() => {
      expect(createNotificationMock).toHaveBeenCalledTimes(1);
    });
    const returned = createNotificationMock.mock.results[0]?.value;
    const resolved = await returned;
    expect(resolved.status).toBe('draft');
    expect(resolved.version).toBe(0);
    expect(resolved.sent_at).toBeNull();
    expect(resolved.read_at).toBeNull();
  });

  // ---------- AC-F2-2 title 空 → safeParse 拦截 ----------
  it('title 空 → safeParse 拦截显示"通知标题必填"（AC-F2-2，AC-ARCH-3 不发请求）', async () => {
    const user = userEvent.setup();
    renderCreateForm();

    // 不填 title，仅填 content + recipient_id 后提交
    await user.type(screen.getByLabelText(/通知内容/i), '通知内容');
    await user.type(screen.getByLabelText(/收件人\s*ID/i), VALID_UUID);
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/通知标题必填|标题.*必填/i)).toBeInTheDocument();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F2-3 title > 128 → safeParse 拦截 ----------
  it('title > 128 字符 → safeParse 拦截显示"通知标题不超过 128 字符"（AC-F2-3，AC-ARCH-3 不发请求）', async () => {
    const user = userEvent.setup();
    renderCreateForm();

    await user.type(screen.getByLabelText(/通知标题/i), 'a'.repeat(129));
    await user.type(screen.getByLabelText(/通知内容/i), '通知内容');
    await user.type(screen.getByLabelText(/收件人\s*ID/i), VALID_UUID);
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/不超过\s*128|标题.*128/i)).toBeInTheDocument();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F2-4 content 空/超长 → safeParse 拦截 ----------
  it('content 空 → safeParse 拦截显示"通知内容必填"（AC-F2-4，AC-ARCH-3 不发请求）', async () => {
    const user = userEvent.setup();
    renderCreateForm();

    await user.type(screen.getByLabelText(/通知标题/i), '标题');
    // 不填 content
    await user.type(screen.getByLabelText(/收件人\s*ID/i), VALID_UUID);
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/通知内容必填|内容.*必填/i)).toBeInTheDocument();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('content > 4000 字符 → safeParse 拦截显示"通知内容不超过 4000 字符"（AC-F2-4）', async () => {
    const user = userEvent.setup();
    renderCreateForm();

    await user.type(screen.getByLabelText(/通知标题/i), '标题');
    await user.type(screen.getByLabelText(/通知内容/i), 'a'.repeat(4001));
    await user.type(screen.getByLabelText(/收件人\s*ID/i), VALID_UUID);
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/不超过\s*4000|内容.*4000/i)).toBeInTheDocument();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F2-5 recipient_id 非 uuid → safeParse 拦截 ----------
  it('recipient_id 非 uuid → safeParse 拦截显示"收件人 ID 须为 UUID 格式"（AC-F2-5，AC-ARCH-3 不发请求）', async () => {
    const user = userEvent.setup();
    renderCreateForm();

    await user.type(screen.getByLabelText(/通知标题/i), '标题');
    await user.type(screen.getByLabelText(/通知内容/i), '通知内容');
    await user.type(screen.getByLabelText(/收件人\s*ID/i), 'abc');
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    expect(await screen.findByText(/UUID 格式|收件人.*UUID/i)).toBeInTheDocument();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  // ---------- AC-F2-6 create 仅 uuid 格式校验，存在性延后至 send（N4）----------
  it('create 仅 recipient_id uuid 格式校验，合法 uuid 不触发 RECIPIENT_NOT_FOUND（AC-F2-6，N4 延后校验）', async () => {
    // create 成功（recipient_id 为合法 uuid 但实际不存在也创建成功，存在性延后至 send）
    createNotificationMock.mockResolvedValue(makeNotification({ title: '标题', version: 0 }));
    const user = userEvent.setup();
    renderCreateForm();

    await user.type(screen.getByLabelText(/通知标题/i), '标题');
    await user.type(screen.getByLabelText(/通知内容/i), '通知内容');
    await user.type(screen.getByLabelText(/收件人\s*ID/i), VALID_UUID);
    await user.click(screen.getByRole('button', { name: /创建|提交|确定/i }));

    // create 成功，不触发 NOTIFICATION_RECIPIENT_NOT_FOUND（存在性延后至 send）
    await waitFor(() => {
      expect(createNotificationMock).toHaveBeenCalledTimes(1);
    });
    // createNotificationMock 不应被以 RECIPIENT_NOT_FOUND reject（create 阶段不校验存在性）
    expect(createNotificationMock.mock.results[0]?.value).toBeDefined();
  });

  // ---------- AC-F3-1 编辑成功（draft 态，versioned）----------
  it('编辑成功 → updateNotification(id, input, version) + If-Match（AC-F3-1，D7）', async () => {
    const initial = makeNotification({ title: '原标题', version: 3 });
    const updated = makeNotification({ title: '改后标题', version: 4 });
    updateNotificationMock.mockResolvedValue(updated);
    const user = userEvent.setup();
    const { onClose, onUpdated } = renderEditForm(initial);

    // 修改 title
    await user.clear(screen.getByLabelText(/通知标题/i));
    await user.type(screen.getByLabelText(/通知标题/i), '改后标题');
    await user.click(screen.getByRole('button', { name: /保存|提交|确定/i }));

    await waitFor(() => {
      expect(updateNotificationMock).toHaveBeenCalledWith(
        initial.id,
        expect.objectContaining({ title: '改后标题' }),
        3, // expectedVersion = initial.version
      );
    });
    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ---------- AC-F3-2 sent/read 态拒绝编辑（INVALID_TRANSITION）----------
  it('编辑 sent 态通知 → 后端返回 NOTIFICATION_INVALID_TRANSITION → 显示"通知状态不允许此操作"（AC-F3-2，N2/N3）', async () => {
    // 注：前端按 status 隐藏编辑按钮（AC-F1-7），但若绕过直接调 update → 后端拒绝
    const initial = makeNotification({ status: 'sent', version: 1 });
    updateNotificationMock.mockRejectedValue(
      new ApiError('NOTIFICATION_INVALID_TRANSITION', '通知状态不允许此操作'),
    );
    const user = userEvent.setup();
    renderEditForm(initial);

    await user.click(screen.getByRole('button', { name: /保存|提交|确定/i }));

    expect(await screen.findByText(/通知状态不允许此操作/)).toBeInTheDocument();
  });

  // ---------- AC-F3-3 VERSION_CONFLICT 自动重试（client 层，组件层验证刷新）----------
  it('编辑 409 VERSION_CONFLICT 重试成功 → 刷新列表（AC-F3-3）', async () => {
    const initial = makeNotification({ title: '原标题', version: 3 });
    const updated = makeNotification({ title: '改后标题', version: 5 });
    // client 层自动重试后成功（updateNotificationMock 被 client 调用 1 次，client 内部重试由 mock fetch 控制）
    // 组件层：updateNotification 返回成功 → onUpdated 回调
    updateNotificationMock.mockResolvedValue(updated);
    const user = userEvent.setup();
    const { onUpdated } = renderEditForm(initial);

    await user.clear(screen.getByLabelText(/通知标题/i));
    await user.type(screen.getByLabelText(/通知标题/i), '改后标题');
    await user.click(screen.getByRole('button', { name: /保存|提交|确定/i }));

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalled();
    });
  });

  // ---------- AC-F3-4 重试仍冲突 → 提示"数据已被修改" ----------
  it('编辑重试仍 VERSION_CONFLICT → 显示"数据已被修改"提示（AC-F3-4）', async () => {
    const initial = makeNotification({ title: '原标题', version: 3 });
    updateNotificationMock.mockRejectedValue(
      new ApiError('VERSION_CONFLICT', '数据已被修改，请刷新后重试', 5),
    );
    const user = userEvent.setup();
    renderEditForm(initial);

    await user.click(screen.getByRole('button', { name: /保存|提交|确定/i }));

    expect(await screen.findByText(/数据已被修改/)).toBeInTheDocument();
  });

  // ---------- AC-F3-5 空对象 partial 合法（N2）----------
  it('编辑提交空对象 → updateNotificationInputSchema.safeParse({}) 通过（AC-F3-5，N2 partial 空对象合法）', async () => {
    const initial = makeNotification({ title: '原标题', version: 3 });
    const updated = makeNotification({ title: '原标题', version: 4 });
    updateNotificationMock.mockResolvedValue(updated);
    const user = userEvent.setup();
    const { onUpdated } = renderEditForm(initial);

    // 不修改任何字段，直接提交（空对象 partial）
    await user.click(screen.getByRole('button', { name: /保存|提交|确定/i }));

    // safeParse({}) 通过（partial 空对象合法），调用 updateNotification
    await waitFor(() => {
      expect(updateNotificationMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalled();
    });
  });
});
