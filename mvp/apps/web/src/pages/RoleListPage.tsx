// apps/web/src/pages/RoleListPage.tsx —— 角色列表/创建/删除页（TECH-WEB-ROLE-DEPT-AUDIT-001 §6.1）
//
// 职责：
//   - 首次加载 listRoles({page:1,pageSize:20})（D21，AC-F1-1）
//   - 渲染角色行（name/description/is_builtin 标识 + 操作按钮，AC-F1-5）
//   - 分页/空状态/加载态/客户端名称搜索 [advisory]（AC-F1-2/3/4/6）
//   - 创建角色 → RoleForm（AC-F2-1~6）；删除角色 versioned（AC-F3-1~7）
//   - R16 扩展（TECH-WEB-TRANSFER-INHERITANCE-001 §6.1 行操作）：
//     · 设置父角色 → SetParentModal（versioned，AC-F4-1）
//     · 解除父角色 → unsetRoleParent versioned DELETE（AC-F5-1~4，根角色不显示按钮 AC-F5-2）
//     · 查看继承链 → InheritanceChainPanel（AC-F6-1）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/roles + api/role-inheritance + components + lib）。
// [约束] D3：Role/RoleListResult/ListRoleQuery 经 z.infer 派生。
// [约束] D7：deleteRole/unsetRoleParent 传 role.version 作 If-Match（versioned）。
// [约束] D5 / AC-S1-2：解除父角色/查看继承链为类型派生操作（roleId/version 从列表项派生，不调 safeParse）。
// [约束] D11 [advisory]：客户端名称搜索仅过滤当前页 items（非服务端筛选），不发新请求。
// [约束] D12：解除父角色按钮仅 parent_role_id !== null 时显示（根角色不显示，AC-F5-2）。
// [约束] D18：行操作按钮 aria-label 域特定（"设置父角色"/"解除父角色"/"查看继承链"，禁止通用"button"）。
// [约束] §5.3：useState 管理本地状态，无 Redux/Zustand。
// [约束] R22 D2/D3/D4 / AC-P1/P2/P3/P5/P6：RoleRow 提取 + memo + useCallback 稳定回调 + useMemo 缓存
//          filteredItems + react-window FixedSizeList 行数 > 50 启用虚拟列表，≤ 50 回退普通 map。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FixedSizeList } from 'react-window';
import type { ErrorCode, ListRoleQuery, Role, RoleListResult } from '@admin/contracts';
import { deleteRole, listRoles } from '../api/roles.js';
import { unsetRoleParent } from '../api/role-inheritance.js';
import { ApiError } from '../api/client.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { RoleRow } from '../components/RoleRow.js';
import { RoleForm } from '../components/RoleForm.js';
import { SetParentModal } from '../components/SetParentModal.js';
import { InheritanceChainPanel } from '../components/InheritanceChainPanel.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';

/** 前端固定 pageSize=20（D21，不依赖 schema 缺省 10）。 */
const PAGE_SIZE = 20;

/** R22 D5：react-window 启用阈值（行数 > 50 启用 FixedSizeList，≤ 50 回退普通 map）。 */
const VIRTUAL_LIST_THRESHOLD = 50;

/** R22 D2：react-window FixedSizeList 配置常量（itemSize=48px / height=600 / overscanCount=5）。 */
const VIRTUAL_ITEM_SIZE = 48;
const VIRTUAL_LIST_HEIGHT = 600;
const VIRTUAL_OVERSCAN_COUNT = 5;

/** ApiError → 中文提示。contracts 码走 mapErrorToMessage，LocalErrorCode 兜底通用提示。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** RoleListPage 组件。 */
export function RoleListPage(): JSX.Element {
  const [items, setItems] = useState<Role[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  // R16 行操作扩展：设置父角色 / 查看继承链弹窗状态（D18 aria-label 域特定，D5 类型派生）
  const [setParentTarget, setSetParentTarget] = useState<Role | null>(null);
  const [chainViewRoleId, setChainViewRoleId] = useState<string | null>(null);

  useEffect(() => {
    const query: ListRoleQuery = { page, pageSize: PAGE_SIZE };
    let cancelled = false;
    setLoading(true);
    setError(null);
    listRoles(query)
      .then((res: RoleListResult) => {
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
  }, [page]);

  /** 重新加载当前页（删除成功/ROLE_NOT_FOUND 后调用）。 */
  const refresh = useCallback((): void => {
    const query: ListRoleQuery = { page, pageSize: PAGE_SIZE };
    setLoading(true);
    listRoles(query)
      .then((res: RoleListResult) => {
        setItems(res.items);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
      })
      .finally(() => setLoading(false));
  }, [page]);

  /**
   * 删除角色（versioned，传 role.version 作 If-Match，AC-F3-1/7）。
   * 成功 → 刷新列表；ROLE_NOT_FOUND → 提示 + 刷新（角色已不存在，AC-F3-6）；
   * 其他错误 → 提示（VERSION_CONFLICT/ROLE_BUILTIN_FORBIDDEN/ROLE_IN_USE，AC-F3-3/4/5）。
   * R22 D3 / AC-P2：useCallback 稳定引用（依赖 refresh → refresh 内部用 page）。
   */
  const handleDelete = useCallback(async (role: Role): Promise<void> => {
    setError(null);
    try {
      await deleteRole(role.id, role.version);
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(resolveErrorMessage(err));
        // ROLE_NOT_FOUND：角色已不存在，刷新列表移除该行（AC-F3-6）
        if (err.code === 'ROLE_NOT_FOUND') {
          refresh();
        }
      } else {
        setError('操作失败，请稍后重试');
      }
    }
  }, [refresh]);

  /**
   * 解除父角色（R16，versioned DELETE，AC-F5-1~4）。
   * D5 / AC-S1-2：类型派生操作（roleId/version 从 RoleListPage 列表项派生，TS 类型保证，不调 safeParse）。
   * 成功 → 刷新列表；ROLE_NOT_FOUND → 提示 + 刷新（角色已不存在，AC-F5-4）；
   * 其他错误 → 提示（VERSION_CONFLICT 由 client 自动重试，仍失败抛出 → "数据已被修改"，AC-F5-3）。
   * R22 D3 / AC-P2：useCallback 稳定引用（依赖 refresh）。
   */
  const handleUnsetParent = useCallback(async (role: Role): Promise<void> => {
    setError(null);
    try {
      await unsetRoleParent(role.id, role.version);
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(resolveErrorMessage(err));
        // ROLE_NOT_FOUND：角色已不存在，刷新列表移除该行（AC-F5-4，T2 roleId 竞态）
        if (err.code === 'ROLE_NOT_FOUND') {
          refresh();
        }
      } else {
        setError('操作失败，请稍后重试');
      }
    }
  }, [refresh]);

  /** SetParentModal 设置成功回调 → 关闭弹窗 + 刷新列表（AC-F4-1，D7 versioned）。 */
  const handleSetParentUpdated = useCallback((): void => {
    setSetParentTarget(null);
    refresh();
  }, [refresh]);

  /**
   * R16：行内"设置父角色"按钮点击 → 弹 SetParentModal（设置目标 role）。
   * R22 D3 / AC-P2：useCallback 稳定引用（无外部依赖，空数组）。
   */
  const handleSetParent = useCallback((role: Role): void => {
    setSetParentTarget(role);
  }, []);

  /**
   * R16：行内"查看继承链"按钮点击 → 弹 InheritanceChainPanel（设置目标 roleId，AC-F6-1）。
   * D5 / AC-S1-2：类型派生操作（roleId 从 Role.id 派生，TS 类型保证，不调 safeParse）。
   * R22 D3 / AC-P2：useCallback 稳定引用（无外部依赖，空数组）。
   */
  const handleViewChain = useCallback((roleId: string): void => {
    setChainViewRoleId(roleId);
  }, []);

  function handleNextPage(): void {
    if (page < totalPages) setPage(page + 1);
  }

  function handlePrevPage(): void {
    if (page > 1) setPage(page - 1);
  }

  function handleCreated(): void {
    setShowCreateModal(false);
    setPage(1);
    refresh();
  }

  // D11 [advisory] 客户端名称搜索：仅过滤当前页 items（非服务端筛选，不发新请求）
  // R22 D4 / AC-P3：useMemo 缓存 filteredItems（依赖 [items, searchKeyword]，避免每次 render 重算）。
  const filteredItems = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return keyword ? items.filter((r) => r.name.toLowerCase().includes(keyword)) : items;
  }, [items, searchKeyword]);

  // R22 D2 / AC-P5：行数 > 50 启用 react-window FixedSizeList（仅渲染可视区行）；
  // 行数 ≤ 50 回退普通 items.map（保持既有 <table><tr><td> DOM 结构，避免破坏既有测试，AC-P6）。
  const useVirtualList = filteredItems.length > VIRTUAL_LIST_THRESHOLD;

  // R22 D2 / AC-P2：useMemo 缓存 itemData + 回调对象（避免父组件每次 render 重建 → 子行 memo 失效，react-window FAQ 最常见坑）。
  const itemData = useMemo<{ items: Role[]; onDelete: (role: Role) => void; onSetParent: (role: Role) => void; onUnsetParent: (role: Role) => void; onViewChain: (roleId: string) => void }>(
    () => ({ items: filteredItems, onDelete: handleDelete, onSetParent: handleSetParent, onUnsetParent: handleUnsetParent, onViewChain: handleViewChain }),
    [filteredItems, handleDelete, handleSetParent, handleUnsetParent, handleViewChain],
  );

  return (
    <div>
      <header>
        <h1>角色列表</h1>
        <button type="button" onClick={() => setShowCreateModal(true)}>
          创建角色
        </button>
      </header>

      <div>
        <input
          type="text"
          placeholder="搜索角色名称"
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
        />
      </div>

      <ErrorBanner message={error} />

      {loading && <div>加载中...</div>}

      {!loading && filteredItems.length === 0 && <div>暂无角色</div>}

      {!loading && filteredItems.length > 0 && (
        useVirtualList ? (
          // R22 D2 / AC-P5：react-window FixedSizeList 虚拟列表（行数 > 50）。
          // [约束] children render prop 须透传 style 到根 DOM（react-window 通过绝对定位实现虚拟化）。
          <FixedSizeList
            height={VIRTUAL_LIST_HEIGHT}
            itemCount={filteredItems.length}
            itemSize={VIRTUAL_ITEM_SIZE}
            width="100%"
            itemData={itemData}
            overscanCount={VIRTUAL_OVERSCAN_COUNT}
          >
            {({ index, style, data }) => {
              // noUncheckedIndexedAccess：数组下标访问返回 T | undefined，须守卫。
              // react-window 保证 0 ≤ index < itemCount，分支为死代码但满足类型安全。
              const role = data.items[index];
              if (!role) return null;
              return (
                <div style={style}>
                  <RoleRow
                    role={role}
                    onDelete={data.onDelete}
                    onSetParent={data.onSetParent}
                    onUnsetParent={data.onUnsetParent}
                    onViewChain={data.onViewChain}
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
                <th>名称</th>
                <th>描述</th>
                <th>类型</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((role) => (
                <RoleRow
                  key={role.id}
                  role={role}
                  onDelete={handleDelete}
                  onSetParent={handleSetParent}
                  onUnsetParent={handleUnsetParent}
                  onViewChain={handleViewChain}
                />
              ))}
            </tbody>
          </table>
        )
      )}

      {!loading && filteredItems.length > 0 && (
        <div>
          <span>共 {total} 条</span>
          <span>
            第 {page}/{totalPages} 页
          </span>
          <button type="button" onClick={handlePrevPage} disabled={page <= 1}>
            上一页
          </button>
          <button type="button" onClick={handleNextPage} disabled={page >= totalPages}>
            下一页
          </button>
        </div>
      )}

      {showCreateModal && (
        <RoleForm onClose={() => setShowCreateModal(false)} onCreated={handleCreated} />
      )}

      {/* R16 行操作扩展：设置父角色弹窗（versioned，AC-F4-1，D7） */}
      {setParentTarget && (
        <SetParentModal
          roleId={setParentTarget.id}
          expectedVersion={setParentTarget.version}
          onClose={() => setSetParentTarget(null)}
          onUpdated={handleSetParentUpdated}
        />
      )}

      {/* R16 行操作扩展：查看继承链弹窗（AC-F6-1，D5 类型派生） */}
      {chainViewRoleId && (
        <InheritanceChainPanel
          roleId={chainViewRoleId}
          onClose={() => setChainViewRoleId(null)}
        />
      )}
    </div>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { Role, RoleListResult, ListRoleQuery };
