// apps/web/src/pages/DeptTreePage.tsx —— 部门树/创建/删除/用户分配页（TECH-WEB-ROLE-DEPT-AUDIT-001 §6.4）
//
// 职责：
//   - 首次加载 getDeptTree() → 递归渲染 <DeptNode>（AC-F5-1，D12 递归无深度限制）
//   - 创建根部门 → DeptForm（parentId=null，AC-F5-2）
//   - 删除叶部门/用户分配/添加子部门由 DeptNode 处理（AC-F5-3/7/8/9、AC-F6-1~4）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/departments + components + lib）。
// [约束] D3：DepartmentTreeResult 经 z.infer 派生。
// [约束] D12：递归渲染无深度限制（后端已限 3 层经 DEPT_DEPTH_EXCEEDED 强制）。
// [约束] §5.3：useState 管理本地状态，无 Redux/Zustand。
import { useEffect, useState } from 'react';
import type { DepartmentTreeResult, ErrorCode } from '@admin/contracts';
import { getDeptTree } from '../api/departments.js';
import { ApiError } from '../api/client.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { DeptNode } from '../components/DeptNode.js';
import { DeptForm } from '../components/DeptForm.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';

/** ApiError → 中文提示。contracts 码走 mapErrorToMessage，LocalErrorCode 兜底通用提示。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** DeptTreePage 组件。 */
export function DeptTreePage(): JSX.Element {
  const [tree, setTree] = useState<DepartmentTreeResult['items']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateRoot, setShowCreateRoot] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDeptTree()
      .then((res: DepartmentTreeResult) => {
        if (cancelled) return;
        setTree(res.items);
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
  }, []);

  /** 重新加载树（DeptNode 删除/创建子部门/分配用户后调 onRefresh 触发）。 */
  function refresh(): void {
    setLoading(true);
    getDeptTree()
      .then((res: DepartmentTreeResult) => setTree(res.items))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
      })
      .finally(() => setLoading(false));
  }

  function handleCreated(): void {
    setShowCreateRoot(false);
    refresh();
  }

  return (
    <div>
      <header>
        <h1>部门树</h1>
        <button type="button" onClick={() => setShowCreateRoot(true)}>
          创建根部门
        </button>
      </header>

      <ErrorBanner message={error} />

      {loading && <div>加载中...</div>}

      {!loading && tree.length === 0 && <div>暂无部门</div>}

      {!loading && tree.length > 0 && (
        <ul>
          {tree.map((node) => (
            <DeptNode key={node.id} node={node} onRefresh={refresh} />
          ))}
        </ul>
      )}

      {showCreateRoot && (
        <DeptForm
          onClose={() => setShowCreateRoot(false)}
          onCreated={handleCreated}
          parentId={null}
        />
      )}
    </div>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { DepartmentTreeResult };
