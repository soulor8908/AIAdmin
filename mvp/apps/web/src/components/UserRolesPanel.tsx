// apps/web/src/components/UserRolesPanel.tsx —— 用户角色分配面板（TECH-WEB-ROLE-DEPT-AUDIT-001 §6.3）
//
// 职责：
//   - 加载 listUserRoles(userId) → 渲染已分配角色（UserRole[]，B5 裸数组，AC-F4-1）
//   - 并行 listRoles({page:1,pageSize:100}) 取全量角色作 toggle 选项（类型派生，roleId 从列表派生）
//   - toggle 勾选 → assignRole(userId, roleId)（AC-F4-2，类型派生操作，不调 safeParse，D5）
//   - toggle 取消 → removeRole(userId, roleId)（AC-F4-3）
//   - USER_ROLE_ALREADY_ASSIGNED/ROLE_NOT_FOUND/USER_NOT_FOUND 提示（AC-F4-4/5/6）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/roles + api/client + lib/errorMapping）。
// [约束] D3：UserRole/Role 经 z.infer 派生。
// [约束] D5 [R13 S-1]：类型派生操作（roleId 从全量角色列表派生，TS 类型保证 uuid），不调 safeParse（AC-ARCH-4）。
//            toggle 直接派发 assignRole/removeRole，无中间 schema 校验层。
import { useEffect, useState } from 'react';
import type { ErrorCode, Role, UserRole } from '@admin/contracts';
import { assignRole, listRoles, listUserRoles, removeRole } from '../api/roles.js';
import { ApiError } from '../api/client.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';

/** UserRolesPanel 组件 props。userId：目标用户；onClose：关闭面板。 */
export type UserRolesPanelProps = {
  userId: string;
  onClose: () => void;
};

/** ApiError → 中文提示。LocalErrorCode 兜底通用提示，contracts 码走 mapErrorToMessage。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** UserRolesPanel 组件。类型派生 toggle（不调 safeParse，AC-ARCH-4 / AC-S1-2）。 */
export function UserRolesPanel(props: UserRolesPanelProps): JSX.Element {
  const { userId, onClose } = props;
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [assignedRoleIds, setAssignedRoleIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 并行加载用户已分配角色（B5 裸数组）+ 全量角色（pageSize=100 取全量，D22）
    Promise.all([listUserRoles(userId), listRoles({ page: 1, pageSize: 100 })])
      .then(([userRoles, rolesResult]) => {
        if (cancelled) return;
        setAllRoles(rolesResult.items);
        setAssignedRoleIds(new Set(userRoles.map((ur: UserRole) => ur.role_id)));
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
  }, [userId]);

  // 类型派生 toggle（D5）：roleId 从 allRoles 派生（Role.id 为 uuid，TS 类型保证），不调 safeParse。
  async function handleToggle(role: Role): Promise<void> {
    const isAssigned = assignedRoleIds.has(role.id);
    setError(null);
    try {
      if (isAssigned) {
        await removeRole(userId, role.id);
        setAssignedRoleIds((prev) => {
          const next = new Set(prev);
          next.delete(role.id);
          return next;
        });
      } else {
        await assignRole(userId, role.id);
        setAssignedRoleIds((prev) => {
          const next = new Set(prev);
          next.add(role.id);
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
    }
  }

  return (
    <div>
      <h2>用户角色分配</h2>
      <button type="button" onClick={onClose}>
        关闭
      </button>
      {error && <div role="alert">{error}</div>}
      {loading ? (
        <div>加载中...</div>
      ) : (
        <ul>
          {allRoles.map((role) => (
            <li key={role.id}>
              <label>
                <input
                  type="checkbox"
                  checked={assignedRoleIds.has(role.id)}
                  onChange={() => handleToggle(role)}
                />
                {role.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { Role, UserRole };
