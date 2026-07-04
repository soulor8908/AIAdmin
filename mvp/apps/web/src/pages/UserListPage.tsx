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
//   - R16 扩展（TECH-WEB-TRANSFER-INHERITANCE-001 §6.7 行操作）：
//     · 有效权限按钮 → EffectivePermissionsPanel modal（AC-F7-1~4）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/users + auth/AuthContext + components + lib）。
// [约束] D3：User/UserListResult/ListUserQuery 经 z.infer 派生。
// [约束] D5 / AC-S1-2：有效权限按钮为类型派生操作（userId 从行派生自 User.id，不调 safeParse）。
// [约束] D18/R16：有效权限按钮 aria-label 域特定（"有效权限"）。
// [约束] §5.3：用 useState 管理本地状态，无 Redux/Zustand（D5）。
// [约束] R22 D2/D3 / AC-P2/P4/P6：useCallback 稳定回调 + useMemo 缓存 itemData + react-window FixedSizeList
//          行数 > 50 启用虚拟列表，≤ 50 回退普通 items.map 保持既有 <table><tr><td> DOM 结构（避免破坏既有测试）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FixedSizeList } from 'react-window';
import type { ErrorCode, ListUserQuery, User, UserListResult, UserStatus } from '@admin/contracts';
import { listUsers, updateUserStatus } from '../api/users.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { UserRow } from '../components/UserRow.js';
import { CreateUserModal } from '../components/CreateUserModal.js';
import { UserRolesPanel } from '../components/UserRolesPanel.js';
import { EffectivePermissionsPanel } from '../components/EffectivePermissionsPanel.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';

/** 前端固定 pageSize=20（D14，不依赖 schema 缺省 10）。 */
const PAGE_SIZE = 20;

/** R22 D5：react-window 启用阈值（行数 > 50 启用 FixedSizeList，≤ 50 回退普通 map）。 */
const VIRTUAL_LIST_THRESHOLD = 50;

/** R22 D2：react-window FixedSizeList 配置常量（itemSize=48px / height=600 / overscanCount=5）。 */
const VIRTUAL_ITEM_SIZE = 48;
const VIRTUAL_LIST_HEIGHT = 600;
const VIRTUAL_OVERSCAN_COUNT = 5;

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
  // R16：有效权限面板 modal 状态（目标用户 id，null 表示面板关闭，AC-F7-1）
  const [effectivePermUserId, setEffectivePermUserId] = useState<string | null>(null);

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

  /** 重新加载当前页（启停成功 / 创建成功后调用）。 */
  const refresh = useCallback((): void => {
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
  }, [page, statusFilter]);

  /**
   * 状态切换：active→disabled / disabled→active，传 user.version 作 If-Match（AC-F4-1/2/7）。
   * UserRow 按钮文案统一"禁用"，但 newStatus 据 user.status 双向切换（功能完整）。
   * R22 D3 / AC-P2：useCallback 稳定引用（依赖 page + statusFilter → refresh 内部用这俩）。
   */
  const handleToggleStatus = useCallback(async (user: User): Promise<void> => {
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
  }, [refresh]);

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
   * R22 D3 / AC-P2：useCallback 稳定引用（无外部依赖，空数组）。
   */
  const handleToggleRoles = useCallback((user: User): void => {
    setError(null);
    setRolesPanelUserId(user.id);
  }, []);

  /**
   * R16：行内"有效权限"按钮点击 → 弹 EffectivePermissionsPanel modal（设置目标 userId，AC-F7-1）。
   * D5 / AC-S1-2：类型派生操作（userId 从行 User.id 派生，TS 类型保证，不调 safeParse）。
   * R22 D3 / AC-P2：useCallback 稳定引用（无外部依赖，空数组）。
   */
  const handleViewEffectivePermissions = useCallback((user: User): void => {
    setError(null);
    setEffectivePermUserId(user.id);
  }, []);

  // R22 D2 / AC-P4：行数 > 50 启用 react-window FixedSizeList（仅渲染可视区行）；
  // 行数 ≤ 50 回退普通 items.map（保持既有 <table><tr><td> DOM 结构，避免破坏既有测试，AC-P6）。
  const useVirtualList = items.length > VIRTUAL_LIST_THRESHOLD;

  // R22 D2 / AC-P2：useMemo 缓存 itemData + 回调对象（避免父组件每次 render 重建 → 子行 memo 失效，react-window FAQ 最常见坑）。
  const itemData = useMemo<{ items: User[]; onToggleStatus: (user: User) => void; onToggleRoles: (user: User) => void; onViewEffectivePermissions: (user: User) => void }>(
    () => ({ items, onToggleStatus: handleToggleStatus, onToggleRoles: handleToggleRoles, onViewEffectivePermissions: handleViewEffectivePermissions }),
    [items, handleToggleStatus, handleToggleRoles, handleViewEffectivePermissions],
  );

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
        useVirtualList ? (
          // R22 D2 / AC-P4：react-window FixedSizeList 虚拟列表（行数 > 50）。
          // [约束] children render prop 须透传 style 到根 DOM（react-window 通过绝对定位实现虚拟化）。
          <FixedSizeList
            height={VIRTUAL_LIST_HEIGHT}
            itemCount={items.length}
            itemSize={VIRTUAL_ITEM_SIZE}
            width="100%"
            itemData={itemData}
            overscanCount={VIRTUAL_OVERSCAN_COUNT}
          >
            {({ index, style, data }) => {
              // noUncheckedIndexedAccess：数组下标访问返回 T | undefined，须守卫。
              // react-window 保证 0 ≤ index < itemCount，分支为死代码但满足类型安全。
              const user = data.items[index];
              if (!user) return null;
              return (
                <div style={style}>
                  <UserRow
                    user={user}
                    onToggleStatus={data.onToggleStatus}
                    onToggleRoles={data.onToggleRoles}
                    onViewEffectivePermissions={data.onViewEffectivePermissions}
                  />
                </div>
              );
            }}
          </FixedSizeList>
        ) : (
          // R22 D5 / AC-P6：行数 ≤ 50 回退普通 map（保持既有 <table><tr><td> DOM 结构，避免破坏既有测试）。
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
                  onViewEffectivePermissions={handleViewEffectivePermissions}
                />
              ))}
            </tbody>
          </table>
        )
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

      {/* R16：有效权限面板 modal（AC-F7-1，D5 类型派生 userId） */}
      {effectivePermUserId && (
        <EffectivePermissionsPanel
          userId={effectivePermUserId}
          onClose={() => setEffectivePermUserId(null)}
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
