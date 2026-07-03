// apps/web/src/components/DeptNode.tsx —— 部门树递归节点组件（TECH-WEB-ROLE-DEPT-AUDIT-001 §6.6）
//
// 职责：
//   - 递归渲染 DepartmentTreeNode：节点 name + 操作按钮（添加子部门/删除/分配用户）
//   - children 递归渲染 <DeptNode>（无深度限制，D12，AC-F5-1）；叶节点 children=[] 不渲染子节点容器
//   - 删除：调 deleteDepartment(node.id)（非 versioned，D8）；DEPT_HAS_CHILDREN/DEPT_NOT_FOUND 提示
//   - 分配用户：调 assignUserDepartment(node.id, userId)（覆盖式幂等，B4）；DEPT_NOT_FOUND/USER_NOT_FOUND 提示
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/departments + api/client + lib/errorMapping + ErrorBanner + DeptForm）。
// [约束] D3：DepartmentTreeNode 经 z.infer 派生（递归 Zod schema，z.lazy）。
// [约束] D12：递归渲染无深度限制（后端已限层级上限 3 经 DEPT_DEPTH_EXCEEDED 强制）。
import { useState } from 'react';
import type { DepartmentTreeNode, ErrorCode } from '@admin/contracts';
import { assignUserDepartment, deleteDepartment } from '../api/departments.js';
import { ApiError } from '../api/client.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';
import { ErrorBanner } from './ErrorBanner.js';
import { DeptForm } from './DeptForm.js';

/** DeptNode 组件 props。node：当前树节点；onRefresh：树刷新回调（删除/创建/分配后触发）。 */
export type DeptNodeProps = {
  node: DepartmentTreeNode;
  onRefresh: () => void;
};

/** ApiError → 中文提示。LocalErrorCode 兜底通用提示，contracts 码走 mapErrorToMessage。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** DeptNode 组件。递归组件：children 中渲染 <DeptNode>。 */
export function DeptNode(props: DeptNodeProps): JSX.Element {
  const { node, onRefresh } = props;
  const [assignUserId, setAssignUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCreateChild, setShowCreateChild] = useState(false);

  async function handleDelete(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      // D8：deleteDepartment 非 versioned（无 If-Match）
      await deleteDepartment(node.id);
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssign(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      // B4：覆盖式幂等（重复分配同部门=200，无"已在该部门"码）
      await assignUserDepartment(node.id, assignUserId.trim());
      setError('部门归属已更新');
      setAssignUserId('');
    } catch (err) {
      setError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  function handleChildCreated(): void {
    setShowCreateChild(false);
    onRefresh();
  }

  return (
    <li>
      <div>
        <span>{node.name}</span>
        <button type="button" onClick={handleDelete} disabled={submitting}>
          删除
        </button>
        <button type="button" onClick={() => setShowCreateChild(true)} disabled={submitting}>
          添加子部门
        </button>
        <label>
          用户ID
          <input
            type="text"
            value={assignUserId}
            onChange={(e) => setAssignUserId(e.target.value)}
            aria-label="用户ID"
          />
        </label>
        <button type="button" onClick={handleAssign} disabled={submitting}>
          分配用户
        </button>
      </div>
      <ErrorBanner message={error} />
      {showCreateChild && (
        <DeptForm
          onClose={() => setShowCreateChild(false)}
          onCreated={handleChildCreated}
          parentId={node.id}
        />
      )}
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <DeptNode key={child.id} node={child} onRefresh={onRefresh} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { DepartmentTreeNode };
