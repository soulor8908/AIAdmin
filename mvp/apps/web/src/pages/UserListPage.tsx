// apps/web/src/pages/UserListPage.tsx —— F2/F3/F4 用户列表页（TECH-WEB-AUTH-USER-001 §6.2）
//
// 职责：
//   - 首次加载：api.users.list({page:1, pageSize:20})（D14，AC-F2-1）
//   - 渲染：每行 UserRow（name/email/status + 启停按钮 + version 隐藏用于 If-Match）
//   - 分页/筛选：改 state → useEffect 触发 list（AC-F2-2/3/4）
//   - 空状态："暂无用户"（AC-F2-5）；分页信息："共 X 条，第 Y/Z 页"（AC-F2-6）
//   - 加载态：loading 文案（AC-F2-7，D16）
//   - 启停：调 updateUserStatus（versioned=true, expectedVersion=user.version）
//     - VERSION_CONFLICT：client 自动重试（D9）；重试仍冲突显示"数据已被修改"（AC-F4-4）
//     - USER_DISABLE_SELF_FORBIDDEN：显示"不能禁用自身账号"（AC-F4-5）
//     - USER_ALREADY_DISABLED/ACTIVE：显示对应提示（AC-F4-6）
//   - 登出按钮：调 useAuth().logout()（AC-F6-2）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/users + auth/AuthContext + components + lib）。
// [约束] D3：User/UserListResult/ListUserQuery 经 z.infer 派生。
// [约束] §5.3：用 useState 管理本地状态，无 Redux/Zustand（D5）。
import { useEffect, useState } from 'react';
import type { ErrorCode, ListUserQuery, User, UserListResult, UserStatus } from '@admin/contracts';
import { listUsers, updateUserStatus } from '../api/users.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { UserRow } from '../components/UserRow.js';
import { CreateUserModal } from '../components/CreateUserModal.js';
import { UserRolesPanel } from '../components/UserRolesPanel.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';

/** 前端固定 pageSize=20（D14，不依赖 schema 缺省 10）。 */
const PAGE_SIZE = 20;

/** UserListPage 组件。 */
export function UserListPage(): JSX.Element {
  const { logout } = useAuth();
  const [items, setItems] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [statusFilter, setStatusFilter] = useState<UserStatus | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // D24：角色分配面板 modal 状态（目标用户 id，null 表示面板关闭）
  const [rolesPanelUserId, setRolesPanelUserId] = useState<string | null>(null);

  // 列表加载：依赖 page + statusFilter，首次及状态变化均触发（AC-F2-1/2/3/4）
  useEffect(() => {
    const query: ListUserQuery = { page, pageSize: PAGE_SIZE };
    if (statusFilter) query.status = statusFilter;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listUsers(query)
      .then((res: UserListResult) => {
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

  /**
   * 状态切换：active→disabled / disabled→active，传 user.version 作 If-Match（AC-F4-1/2/7）。
   * UserRow 按钮文案统一"禁用"，但 newStatus 据 user.status 双向切换（功能完整）。
   */
  async function handleToggleStatus(user: User): Promise<void> {
    const newStatus: UserStatus = user.status === 'active' ? 'disabled' : 'active';
    setError(null);
    try {
      await updateUserStatus(user.id, { status: newStatus }, user.version);
      // 成功：刷新列表取最新 version（避免下次冲突，AC-F4-3 重试成功亦刷新）
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(resolveErrorMessage(err));
      } else {
        setError('操作失败，请稍后重试');
      }
    }
  }

  /** 重新加载当前页（启停成功 / 创建成功后调用）。 */
  function refresh(): void {
    const query: ListUserQuery = { page, pageSize: PAGE_SIZE };
    if (statusFilter) query.status = statusFilter;
    setLoading(true);
    listUsers(query)
      .then((res: UserListResult) => {
        setItems(res.items);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
      })
      .finally(() => setLoading(false));
  }

  function handleStatusFilterChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const val = e.target.value;
    // 选空 → undefined（不按状态过滤）；改筛选重置 page=1（AC-F2-3/4）
    setStatusFilter(val ? (val as UserStatus) : undefined);
    setPage(1);
  }

  function handleNextPage(): void {
    if (page < totalPages) setPage(page + 1);
  }

  function handlePrevPage(): void {
    if (page > 1) setPage(page - 1);
  }

  function handleCreated(): void {
    setShowCreateModal(false);
    // 创建成功：刷新列表含新用户（AC-F3-1）
    setPage(1);
    refresh();
  }

  /**
   * D24：行内"角色"按钮点击 → 弹 UserRolesPanel modal（设置目标 userId）。
   * 角色分配/移除由 UserRolesPanel 内部处理（类型派生 toggle，不调 safeParse）。
   */
  function handleToggleRoles(user: User): void {
    setError(null);
    setRolesPanelUserId(user.id);
  }

  return (
    <div>
      <header>
        <h1>用户列表</h1>
        <button type="button" onClick={() => logout()}>
          登出
        </button>
        <button type="button" onClick={() => setShowCreateModal(true)}>
          创建用户
        </button>
      </header>

      <div>
        <label>
          状态筛选
          <select
            value={statusFilter ?? ''}
            onChange={handleStatusFilterChange}
            aria-label="状态筛选"
          >
            <option value="">全部</option>
            <option value="active">已激活</option>
            <option value="disabled">已停用</option>
          </select>
        </label>
      </div>

      <ErrorBanner message={error} />

      {loading && <div>加载中...</div>}

      {!loading && items.length === 0 && <div>暂无用户</div>}

      {!loading && items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>姓名</th>
              <th>邮箱</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                onToggleStatus={handleToggleStatus}
                onToggleRoles={handleToggleRoles}
              />
            ))}
          </tbody>
        </table>
      )}

      {!loading && items.length > 0 && (
        <div>
          <span>共 {total} 条</span>
          <span>
            第 {page}/{totalPages} 页
          </span>
          <button type="button" onClick={handlePrevPage} disabled={page <= 1}>
            上一页
          </button>
          <button
            type="button"
            onClick={handleNextPage}
            disabled={page >= totalPages}
          >
            下一页
          </button>
        </div>
      )}

      {showCreateModal && (
        <CreateUserModal onClose={() => setShowCreateModal(false)} onCreated={handleCreated} />
      )}

      {rolesPanelUserId && (
        <UserRolesPanel
          userId={rolesPanelUserId}
          onClose={() => setRolesPanelUserId(null)}
        />
      )}
    </div>
  );
}

/** ApiError → 中文提示。contracts 码走 mapErrorToMessage（D11 SSOT），LocalErrorCode 兜底通用提示。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { User, UserListResult, ListUserQuery, UserStatus };
