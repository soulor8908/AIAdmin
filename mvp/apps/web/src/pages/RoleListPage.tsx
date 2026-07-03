// apps/web/src/pages/RoleListPage.tsx —— 角色列表/创建/删除页（TECH-WEB-ROLE-DEPT-AUDIT-001 §6.1）
//
// 职责：
//   - 首次加载 listRoles({page:1,pageSize:20})（D21，AC-F1-1）
//   - 渲染角色行（name/description/is_builtin 标识 + 操作按钮，AC-F1-5）
//   - 分页/空状态/加载态/客户端名称搜索 [advisory]（AC-F1-2/3/4/6）
//   - 创建角色 → RoleForm（AC-F2-1~6）；删除角色 versioned（AC-F3-1~7）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/roles + components + lib）。
// [约束] D3：Role/RoleListResult/ListRoleQuery 经 z.infer 派生。
// [约束] D7：deleteRole 传 role.version 作 If-Match（versioned）。
// [约束] D11 [advisory]：客户端名称搜索仅过滤当前页 items（非服务端筛选），不发新请求。
// [约束] §5.3：useState 管理本地状态，无 Redux/Zustand。
import { useEffect, useState } from 'react';
import type { ErrorCode, ListRoleQuery, Role, RoleListResult } from '@admin/contracts';
import { deleteRole, listRoles } from '../api/roles.js';
import { ApiError } from '../api/client.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { RoleForm } from '../components/RoleForm.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';

/** 前端固定 pageSize=20（D21，不依赖 schema 缺省 10）。 */
const PAGE_SIZE = 20;

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
  function refresh(): void {
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
  }

  /**
   * 删除角色（versioned，传 role.version 作 If-Match，AC-F3-1/7）。
   * 成功 → 刷新列表；ROLE_NOT_FOUND → 提示 + 刷新（角色已不存在，AC-F3-6）；
   * 其他错误 → 提示（VERSION_CONFLICT/ROLE_BUILTIN_FORBIDDEN/ROLE_IN_USE，AC-F3-3/4/5）。
   */
  async function handleDelete(role: Role): Promise<void> {
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
  }

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
  const keyword = searchKeyword.trim().toLowerCase();
  const filteredItems = keyword
    ? items.filter((r) => r.name.toLowerCase().includes(keyword))
    : items;

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
              <tr key={role.id}>
                <td>{role.name}</td>
                <td>{role.description}</td>
                <td>{role.is_builtin ? '内置' : '自定义'}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => handleDelete(role)}
                    disabled={role.is_builtin}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    </div>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { Role, RoleListResult, ListRoleQuery };
