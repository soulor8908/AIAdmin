// apps/web/src/components/TransferForm.tsx —— 调岗混合表单（TECH-WEB-TRANSFER-INHERITANCE-001 §6.2，T4 superRefine）
//
// 职责（F1/F2/F3）：
//   - 4 字段控件（D13 选择器混合，Q2 决策②）：
//     · userId：input type=text（aria-label="用户 ID"，D18），自由文本 UUID 输入。
//     · toDepartmentId：select（aria-label="目标部门"，D18），options 从 getDeptTree 派生。
//     · oldRoleId：select（aria-label="原角色"，D18），options 从 listRoles 派生（全量角色可选，服务端校验用户是否持有）。
//     · newRoleId：select（aria-label="新角色"，D18），options 从 listRoles 派生。
//     · "提交调岗"按钮（aria-label="提交调岗"，D18）。
//   - 提交：transferInputSchema.safeParse 整体校验（覆盖 userId uuid + 4 字段 uuid + .strict() + superRefine oldRoleId !== newRoleId）。
//   - 成功：onSubmitted 回调（TransferPage 显示"调岗成功" + 重置，AC-F1-3）。
//
// [约束] ARCH-003：仅 import @admin/contracts（transferInputSchema 复用，D4）+ apps/web 内部（api/）+ 第三方。
// [约束] D4：自由文本/选择器混合表单须 transferInputSchema.safeParse（覆盖 superRefine + .strict() + uuid）。
// [约束] D13：userId 自由文本 + oldRoleId/newRoleId/toDepartmentId select（选择器数据源见 §6.1/§6.2）。
// [约束] D14：提交按钮原子提交（userId 输入失焦/完整 uuid 触发 listUserRoles，不每键入触发）。
// [约束] D18：aria-label 域特定（"用户 ID"/"目标部门"/"原角色"/"新角色"/"提交调岗"）。
// [约束] D21：测试 fixture 须用有效 hex UUID；label 跨组件唯一。
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  transferInputSchema,
  type DepartmentTreeNode,
  type ErrorCode,
  type Role,
  type RoleListResult,
} from '@admin/contracts';
import { listRoles, listUserRoles } from '../api/roles.js';
import { getDeptTree } from '../api/departments.js';
import { transferUser } from '../api/transfer.js';
import { ApiError } from '../api/client.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';

/** TransferForm 组件 props（onSubmitted 成功回调，TransferPage 显示"调岗成功"+ 重置）。 */
export type TransferFormProps = {
  onSubmitted?: () => void;
};

/** UUID 格式正则（与 z.string().uuid() 对齐，用于失焦触发 listUserRoles 判定）。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ApiError → 中文提示。LocalErrorCode 兜底通用提示，contracts 码走 mapErrorToMessage。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** 递归展平部门树为节点列表（用于 select options，D13 选择器数据源）。 */
function flattenDepts(nodes: DepartmentTreeNode[]): DepartmentTreeNode[] {
  const result: DepartmentTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(...flattenDepts(node.children));
  }
  return result;
}

/** TransferForm 组件（混合表单 safeParse + superRefine + 4 字段控件）。 */
export function TransferForm(props: TransferFormProps): JSX.Element {
  const { onSubmitted } = props;
  const [userId, setUserId] = useState('');
  const [toDepartmentId, setToDepartmentId] = useState('');
  const [oldRoleId, setOldRoleId] = useState('');
  const [newRoleId, setNewRoleId] = useState('');
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [allDepts, setAllDepts] = useState<DepartmentTreeNode[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 加载选择器数据源：listRoles（原角色/新角色 options）+ getDeptTree（目标部门 options）
  useEffect(() => {
    let cancelled = false;
    Promise.all([listRoles({ page: 1, pageSize: 100 }), getDeptTree()])
      .then(([rolesResult, deptTree]) => {
        if (cancelled) return;
        setAllRoles(rolesResult.items);
        setAllDepts(flattenDepts(deptTree.items));
      })
      .catch(() => {
        // 选择器加载失败静默处理，表单仍可提交（服务端校验兜底）
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * userId 失焦 → 若为有效 uuid 则触发 listUserRoles（AC-F1-2，D14：不每键入触发）。
   * listUserRoles 用于加载用户已分配角色（前端可据此预填/过滤 oldRoleId，但 oldRoleId select 仍展示全量角色，
   * 服务端通过 TRANSFER_OLD_ROLE_NOT_ASSIGNED 兜底校验用户是否持有 oldRoleId）。
   */
  function handleUserIdBlur(): void {
    if (UUID_RE.test(userId)) {
      listUserRoles(userId).catch(() => {
        // 加载失败静默处理（oldRoleId select 仍展示全量角色）
      });
    }
  }

  const isFormComplete = Boolean(userId && toDepartmentId && oldRoleId && newRoleId);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setFieldError(null);
    setFormError(null);

    // D4：混合表单须 transferInputSchema.safeParse（覆盖 superRefine + .strict() + uuid）
    const raw = { userId, toDepartmentId, oldRoleId, newRoleId };
    const result = transferInputSchema.safeParse(raw);
    if (!result.success) {
      // safeParse 拦截后按字段+约束映射中文提示
      const issues = result.error.issues;
      const userIdIssue = issues.find((i) => i.path[0] === 'userId');
      const newRoleIdIssue = issues.find((i) => i.path[0] === 'newRoleId');
      if (userIdIssue) {
        setFieldError('用户 ID 须为 UUID 格式');
      } else if (newRoleIdIssue) {
        // superRefine oldRoleId === newRoleId → path=['newRoleId']（T4）
        setFieldError('新角色不能与原角色相同');
      } else {
        setFieldError('输入校验失败');
      }
      return;
    }

    setSubmitting(true);
    try {
      await transferUser(result.data);
      // D14：调岗成功 → 表单重置（AC-F1-3）
      setUserId('');
      setToDepartmentId('');
      setOldRoleId('');
      setNewRoleId('');
      onSubmitted?.();
    } catch (err) {
      setFormError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        用户 ID
        <input
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          onBlur={handleUserIdBlur}
          aria-label="用户 ID"
        />
      </label>
      <label>
        目标部门
        <select
          value={toDepartmentId}
          onChange={(e) => setToDepartmentId(e.target.value)}
          aria-label="目标部门"
        >
          <option value="">请选择</option>
          {allDepts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        原角色
        <select value={oldRoleId} onChange={(e) => setOldRoleId(e.target.value)} aria-label="原角色">
          <option value="">请选择</option>
          {allRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        新角色
        <select value={newRoleId} onChange={(e) => setNewRoleId(e.target.value)} aria-label="新角色">
          <option value="">请选择</option>
          {allRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {fieldError && <div role="alert">{fieldError}</div>}
      {formError && <div role="alert">{formError}</div>}
      <button
        type="submit"
        disabled={submitting || !isFormComplete}
        aria-label="提交调岗"
      >
        提交调岗
      </button>
    </form>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { Role, RoleListResult, DepartmentTreeNode };
