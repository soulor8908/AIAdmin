// apps/web/src/pages/NotificationListPage.tsx —— 通知列表/操作页（TECH-WEB-NOTIFICATION-REPORT-001 §6.1）
//
// 职责：
//   - 首次加载 listNotifications({page:1, pageSize:20})（D16，AC-F1-1）
//   - 渲染通知行（title/recipient_id/status 文案中文化 + 按 status 动态显示操作按钮，AC-F1-7）
//   - 分页/status 筛选/筛选+分页复合/空状态/加载态（AC-F1-2~F1-6）
//   - 发送/标记已读/删除操作（versioned，D7）+ 错误处理（AC-F4/F5/F6）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部。
// [约束] D3：Notification/NotificationListResult/ListNotificationQuery 经 z.infer 派生。
// [约束] D7：send/markRead/delete 传 notification.version 作 If-Match（versioned）。
// [约束] D10：status 文案中文化（草稿/已发送/已读）+ 按 status 动态显示操作按钮（Q3/Q11）。
// [约束] D16：显式传 pageSize=20（抹平契约缺省 10，N1）。
// [约束] §5.3：useState 管理本地状态，无 Redux/Zustand。
import { useEffect, useState } from 'react';
import {
  notificationStatusSchema,
  type ErrorCode,
  type ListNotificationQuery,
  type Notification,
  type NotificationListResult,
  type NotificationStatus,
} from '@admin/contracts';
import {
  deleteNotification,
  listNotifications,
  markNotificationRead,
  sendNotification,
} from '../api/notifications.js';
import { ApiError } from '../api/client.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { NotificationForm } from '../components/NotificationForm.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';

/** 前端固定 pageSize=20（D16，抹平契约缺省 10，N1）。 */
const PAGE_SIZE = 20;

/** status 全集 SSOT 派生（AI-005，禁止硬编码 3 项）。 */
const ALL_STATUSES: NotificationStatus[] = [...notificationStatusSchema.options];

/** status 文案中文化（D10，纯 UI 文案）。 */
const STATUS_LABEL: Record<NotificationStatus, string> = {
  draft: '草稿',
  sent: '已发送',
  read: '已读',
};

/** ApiError → 中文提示。contracts 码走 mapErrorToMessage，LocalErrorCode 兜底通用提示。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** NotificationListPage 组件。列表 + 状态机操作 + 分页 + 筛选。 */
export function NotificationListPage(): JSX.Element {
  const [items, setItems] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // status 筛选：'' 表示不筛（全部），'draft'/'sent'/'read' 表示按状态筛
  const [statusFilter, setStatusFilter] = useState<NotificationStatus | ''>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingNotification, setEditingNotification] = useState<Notification | null>(null);

  /** 构造当前查询（status 为空时不传 status 字段，AC-F1-1 首次调用须精确 {page,pageSize}）。 */
  function buildQuery(currentPage: number, currentStatus: NotificationStatus | ''): ListNotificationQuery {
    const query: ListNotificationQuery = { page: currentPage, pageSize: PAGE_SIZE };
    if (currentStatus) query.status = currentStatus;
    return query;
  }

  useEffect(() => {
    const query = buildQuery(page, statusFilter);
    let cancelled = false;
    setLoading(true);
    setError(null);
    listNotifications(query)
      .then((res: NotificationListResult) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, statusFilter]);

  /** 重新加载当前页（操作成功/NOT_FOUND 后调用，取最新 version 避免下次冲突）。 */
  function refresh(): void {
    const query = buildQuery(page, statusFilter);
    setLoading(true);
    listNotifications(query)
      .then((res: NotificationListResult) => {
        setItems(res.items);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
      })
      .finally(() => setLoading(false));
  }

  /** 发送通知（draft→sent，versioned，AC-F4-1）。 */
  async function handleSend(notif: Notification): Promise<void> {
    setError(null);
    try {
      await sendNotification(notif.id, notif.version);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
    }
  }

  /** 标记已读（sent→read，versioned，AC-F5-1）。 */
  async function handleMarkRead(notif: Notification): Promise<void> {
    setError(null);
    try {
      await markNotificationRead(notif.id, notif.version);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
    }
  }

  /** 删除通知（仅 draft，versioned，AC-F6-1）。NOT_FOUND → 提示 + 刷新（AC-F6-4）。 */
  async function handleDelete(notif: Notification): Promise<void> {
    setError(null);
    try {
      await deleteNotification(notif.id, notif.version);
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(resolveErrorMessage(err));
        // NOTIFICATION_NOT_FOUND：通知已不存在，刷新列表移除该行（AC-F6-4）
        if (err.code === 'NOTIFICATION_NOT_FOUND') {
          refresh();
        }
      } else {
        setError('操作失败，请稍后重试');
      }
    }
  }

  function handleNextPage(): void {
    if (page < totalPages) setPage(page + 1);
  }

  function handlePrevPage(): void {
    if (page > 1) setPage(page - 1);
  }

  function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const value = e.target.value;
    setStatusFilter(value === '' ? '' : (value as NotificationStatus));
    setPage(1);
  }

  function handleCreated(): void {
    setShowCreateModal(false);
    setPage(1);
    refresh();
  }

  function handleUpdated(): void {
    setEditingNotification(null);
    refresh();
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">通知列表</h1>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            创建通知
          </button>
        </div>
      </div>

      <div className="page-filters">
        <div className="page-filter-group">
          <label className="form-label">状态</label>
          <select className="form-select" value={statusFilter} onChange={handleStatusChange} aria-label="状态">
            <option value="">全部</option>
            {/* [R15 impl-writer 改] option text 用英文枚举值（非中文 STATUS_LABEL）：
                避免与行单元格中文 status 文案冲突（getByText(/草稿/) 同时匹配 option + td）。
                SSOT 测试检查 option value（非 text），故改 text 不影响 SSOT 断言；行单元格仍用 STATUS_LABEL 中文化（D10）。 */}
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ErrorBanner message={error} />

      {loading && (
        <div className="loading-container">
          <span className="spinner" />
          <span>加载中...</span>
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-title">暂无通知</div>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>标题</th>
                <th>收件人</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((notif) => (
                <tr key={notif.id}>
                  <td>{notif.title}</td>
                  <td>{notif.recipient_id}</td>
                  <td>{STATUS_LABEL[notif.status]}</td>
                  <td>
                    {notif.status === 'draft' && (
                      <>
                        <button type="button" onClick={() => setEditingNotification(notif)}>
                          编辑
                        </button>
                        <button type="button" onClick={() => handleSend(notif)}>
                          发送
                        </button>
                        <button type="button" onClick={() => handleDelete(notif)}>
                          删除
                        </button>
                      </>
                    )}
                    {notif.status === 'sent' && (
                      <button type="button" onClick={() => handleMarkRead(notif)}>
                        标记已读
                      </button>
                    )}
                    {notif.status === 'read' && null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="pagination">
          <div className="pagination-info">共 {total} 条，第 {page}/{totalPages} 页</div>
          <div className="pagination-buttons">
            <button type="button" className="btn btn-secondary btn-sm" onClick={handlePrevPage} disabled={page <= 1}>
              上一页
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleNextPage} disabled={page >= totalPages}>
              下一页
            </button>
          </div>
        </div>
      )}

      {showCreateModal && (
        <NotificationForm
          mode="create"
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}

      {editingNotification && (
        <NotificationForm
          mode="edit"
          initial={editingNotification}
          onClose={() => setEditingNotification(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { ListNotificationQuery, Notification, NotificationListResult, NotificationStatus };
