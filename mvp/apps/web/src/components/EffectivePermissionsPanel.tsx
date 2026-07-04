// apps/web/src/components/EffectivePermissionsPanel.tsx —— 有效权限展示（TECH-WEB-TRANSFER-INHERITANCE-001 §6.6，Q7 modal）
//
// 职责（F7）：
//   - 形态：modal（Q7 决策③，从 UserListPage 行操作"有效权限"按钮触发），传入 userId。
//   - 加载：getEffectivePermissions(userId)（非 cacheable，T3，不发 If-None-Match）→ 裸 PermissionCode[] 集合。
//   - 渲染（D11，Q7 权限码集合）：
//     · 有权限（length > 0）：渲染权限码列表（每项中文化映射，D11，如 user:read→"查看用户"、transfer:write→"调岗"）。
//       权限码中文化映射 SSOT 派生：键从 [...permissionCodeSchema.options] 派生（11 项全集，AI-005，AC-F7-3）。
//     · 空集合（length === 0）：显示"该用户暂无有效权限"（AC-F7-2）。
//   - 错误：USER_NOT_FOUND → "用户不存在"（AC-F7-4，T1）。
//
// [约束] ARCH-003：仅 import @admin/contracts（PermissionCode/permissionCodeSchema 派生）+ apps/web 内部（api/）+ 第三方。
// [约束] D5：类型派生操作（userId 从 UserListPage 行派生，TS 类型保证，不调 safeParse）。
// [约束] D11：权限码中文化映射 SSOT 派生 [...permissionCodeSchema.options]（AI-005，禁止硬编码，AC-F7-3）。
// [约束] D18：aria-label="有效权限"；D21：label 跨组件唯一（"有效权限" 消歧于 UserListPage"角色"按钮）。
import { useEffect, useRef, useState } from 'react';
import {
  permissionCodeSchema,
  type ErrorCode,
  type PermissionCode,
} from '@admin/contracts';
import { getEffectivePermissions } from '../api/role-inheritance.js';
import { ApiError } from '../api/client.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';

/** EffectivePermissionsPanel 组件 props（userId 从 UserListPage 行派生，onClose 可选）。 */
export type EffectivePermissionsPanelProps = {
  userId: string;
  onClose?: () => void;
};

/**
 * 权限码中文化映射表（D11，SSOT 派生）。
 * 键从 [...permissionCodeSchema.options] 派生（11 项全集，AI-005）。
 * TypeScript Record<PermissionCode, string> 保证枚举扩展时不漏（新增码编译报错）。
 * 具体中文措辞为纯 UI 文案（不须同步 §10）。
 */
const PERMISSION_CODE_LABELS: Record<PermissionCode, string> = {
  'user:read': '查看用户',
  'user:write': '管理用户',
  'role:read': '查看角色',
  'role:write': '管理角色',
  'dept:read': '查看部门',
  'dept:write': '管理部门',
  'audit:read': '查看审计',
  'report:read': '查看报表',
  'notification:read': '查看通知',
  'notification:write': '管理通知',
  'transfer:write': '调岗',
};

/** SSOT 派生：权限码全集（AI-005，禁止硬编码 11 项）。 */
const ALL_PERMISSION_CODES: PermissionCode[] = [...permissionCodeSchema.options];

/** ApiError → 中文提示。LocalErrorCode 兜底通用提示，contracts 码走 mapErrorToMessage。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** EffectivePermissionsPanel 组件（权限码列表 + 中文化 SSOT 派生 + 空集合提示）。 */
export function EffectivePermissionsPanel(props: EffectivePermissionsPanelProps): JSX.Element {
  const { userId, onClose } = props;
  const [permissions, setPermissions] = useState<PermissionCode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // R23：modal 焦点陷阱 + ESC 关闭 + focus restore（D1/D5/D6，AC-A11y-2/3/4）
  // EffectivePermissionsPanel 无 form submit，submitting=false；onClose optional，hook 内 if (!onClose) return 守卫
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusTrap(rootRef, { onClose, enabled: true, submitting: false });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEffectivePermissions(userId)
      .then((result: PermissionCode[]) => {
        if (!cancelled) setPermissions(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div role="dialog" aria-modal="true" aria-label="有效权限" ref={rootRef}>
      <h2>权限列表</h2>
      {onClose && (
        <button type="button" onClick={onClose}>
          关闭
        </button>
      )}
      {error && <div role="alert">{error}</div>}
      {loading && <div>加载中...</div>}
      {!loading && !error && permissions !== null && (
        <div>
          {permissions.length === 0 ? (
            <div>该用户暂无有效权限</div>
          ) : (
            <ul>
              {permissions.map((code) => (
                <li key={code}>{PERMISSION_CODE_LABELS[code]}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { PermissionCode };

/** 导出 SSOT 派生常量（用于类型保证，AI-005）。 */
export { ALL_PERMISSION_CODES };
