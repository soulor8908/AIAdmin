// apps/web/src/components/InheritanceChainPanel.tsx —— 继承链展示（TECH-WEB-TRANSFER-INHERITANCE-001 §6.5，链形文本 Q6）
//
// 职责（F6）：
//   - 形态：modal/drawer（从 RoleListPage 行操作"查看继承链"按钮触发），传入 roleId。
//   - 加载：getInheritanceChain(roleId)（非 cacheable，T3，不发 If-None-Match）→ 裸 Role[] 祖先数组。
//   - 渲染（D10，Q6 链形文本）：
//     · 有父角色（chain.length > 0）：链形文本"父角色 B → 祖父角色 C → 曾祖父角色 D"（" → " 分隔，按返回顺序，AC-F6-1/F6-3）。
//     · 根角色空数组（chain.length === 0）：显示"无父角色"（D7 / AC-F6-2）。
//   - 错误：ROLE_NOT_FOUND → "角色不存在"（AC-F6-4，T2）。
//
// [约束] ARCH-003：仅 import @admin/contracts（Role 类型派生）+ apps/web 内部（api/role-inheritance）+ 第三方。
// [约束] D5：类型派生操作（roleId 从列表派生，TS 类型保证，不调 safeParse，R13 S-1）。
// [约束] D10：链形文本（" → " 分隔，Q6 决策①，不做树形/图表，D23）。
// [约束] D18：aria-label="继承链"；D21/R15 S-14：label 跨组件唯一。
import { useEffect, useRef, useState } from 'react';
import type { ErrorCode, Role } from '@admin/contracts';
import { getInheritanceChain } from '../api/role-inheritance.js';
import { ApiError } from '../api/client.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';

/** InheritanceChainPanel 组件 props（roleId 从 RoleListPage 行派生，onClose 可选）。 */
export type InheritanceChainPanelProps = {
  roleId: string;
  onClose?: () => void;
};

/** ApiError → 中文提示。LocalErrorCode 兜底通用提示，contracts 码走 mapErrorToMessage。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** InheritanceChainPanel 组件（链形文本 + 根角色空数组"无父角色"）。 */
export function InheritanceChainPanel(props: InheritanceChainPanelProps): JSX.Element {
  const { roleId, onClose } = props;
  const [chain, setChain] = useState<Role[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // R23：modal 焦点陷阱 + ESC 关闭 + focus restore（D1/D5/D6，AC-A11y-2/3/4）
  // InheritanceChainPanel 无 form submit，submitting=false；onClose optional，hook 内 if (!onClose) return 守卫
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusTrap(rootRef, { onClose, enabled: true, submitting: false });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getInheritanceChain(roleId)
      .then((result: Role[]) => {
        if (!cancelled) setChain(result);
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
  }, [roleId]);

  return (
    <div role="dialog" aria-modal="true" aria-label="继承链" ref={rootRef}>
      <h2>继承链</h2>
      {onClose && (
        <button type="button" onClick={onClose}>
          关闭
        </button>
      )}
      {error && <div role="alert">{error}</div>}
      {loading && <div>加载中...</div>}
      {!loading && !error && chain !== null && (
        <div>
          {chain.length === 0 ? (
            <div>无父角色</div>
          ) : (
            <div>{chain.map((r) => r.name).join(' → ')}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { Role };
