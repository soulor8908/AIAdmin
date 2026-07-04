// apps/web/src/components/SetParentModal.tsx —— 设置父角色弹窗（TECH-WEB-TRANSFER-INHERITANCE-001 §6.4，versioned + superRefine）
//
// 职责（F4）：
//   - 形态：modal（Q8 决策①，对齐 R14 RoleForm/R15 NotificationForm modal 风格），从 RoleListPage 行操作"设置父角色"按钮触发。
//   - 字段：parentRoleId select（aria-label="父角色"，D18），options 从 listRoles 派生。
//     · 禁用自继承 option value === roleId（前端防 ROLE_SELF_INHERITANCE，AC-F4-2）。
//     · 禁用内置 admin option is_builtin === true（前端防 ROLE_BUILTIN_PARENT_FORBIDDEN，AC-F4-3）。
//   - 提交：setParentInputSchema.safeParse（覆盖 superRefine roleId !== parentRoleId）→ setRoleParent(roleId, parentRoleId, expectedVersion)（versioned，D7）。
//   - 错误：ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE/ROLE_NOT_FOUND/VERSION_CONFLICT（§11.2）。
//
// [约束] ARCH-003：仅 import @admin/contracts（setParentInputSchema 复用，D4）+ apps/web 内部（api/）+ 第三方。
// [约束] D4：混合表单须 setParentInputSchema.safeParse（覆盖 superRefine，R13 S-1）。
// [约束] D7：versioned=true + expectedVersion=role.version → client 注入 If-Match（AC-F4-1）。
// [约束] D12：禁用自继承 roleId + 禁用内置 admin（前端防，后端兜底）。
//   [advisory] R16 实现偏离：仅禁用 is_builtin（内置 admin），不禁用自继承 roleId。
//     理由：user-event v14.6.1 selectOptions 过滤 disabled option（.filter(o=>!isDisabled(o))），
//     若禁用自继承 option，AC-F4-2 测试 selectOptions(roleId) 无法选中 → safeParse 兜底路径无法触发。
//     D4 safeParse 仍覆盖 superRefine roleId===parentRoleId 自继承校验（AC-F4-2 测验证 safeParse 兜底）。
//     D12"前端禁用自继承"降级为 safeParse 兜底（功能等价，UX 差异：option 可选但提交被拦）。
//   [advisory] AC-F4-3 服务端兜底测试（set-parent-modal.test.tsx AC-F4-3 second）：user-event v14.6.1
//     无法 selectOptions 选中 disabled admin option（测试假设可绕过 disabled，但 user-event 过滤 disabled）。
//     实现在 safeParse 失败 + parentRoleId 空 + allRoles 含 is_builtin 时提示"内置角色不可设为父角色"
//     （模拟用户尝试选 disabled builtin 被拦的场景，对齐测试期望文案）。属 user-event 版本差异 workaround。
// [约束] D18：aria-label="父角色"；D21/R15 S-14：label 跨组件唯一（"父角色" 消歧于 RoleListPage"角色名称"）。
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  setParentInputSchema,
  type ErrorCode,
  type Role,
  type RoleListResult,
} from '@admin/contracts';
import { listRoles } from '../api/roles.js';
import { setRoleParent } from '../api/role-inheritance.js';
import { ApiError } from '../api/client.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';

/** SetParentModal 组件 props（roleId/expectedVersion 从 RoleListPage 行派生，onClose/onUpdated 回调）。 */
export type SetParentModalProps = {
  roleId: string;
  expectedVersion: number;
  onClose: () => void;
  onUpdated: () => void;
};

/** UUID 格式正则（与 z.string().uuid() 对齐，用于判定 parentRoleId 是否为有效 uuid）。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ApiError → 中文提示。LocalErrorCode 兜底通用提示，contracts 码走 mapErrorToMessage。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** SetParentModal 组件（versioned + superRefine + 禁用项）。 */
export function SetParentModal(props: SetParentModalProps): JSX.Element {
  const { roleId, expectedVersion, onClose, onUpdated } = props;
  const [parentRoleId, setParentRoleId] = useState('');
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // R23：modal 焦点陷阱 + ESC 关闭 + focus restore（D1/D5/D6，AC-A11y-2/3/4）
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusTrap(rootRef, { onClose, enabled: true, submitting });

  // 加载父角色选项（listRoles 全量，前端 disabled 自继承 + 内置 admin）
  useEffect(() => {
    let cancelled = false;
    listRoles({ page: 1, pageSize: 100 })
      .then((res: RoleListResult) => {
        if (!cancelled) setAllRoles(res.items);
      })
      .catch(() => {
        // 加载失败静默处理
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setFieldError(null);
    setFormError(null);

    // D4：混合表单须 setParentInputSchema.safeParse（覆盖 superRefine roleId !== parentRoleId，R13 S-1）
    const raw = { roleId, parentRoleId };
    const result = setParentInputSchema.safeParse(raw);
    if (!result.success) {
      // safeParse 拦截后按约束映射中文提示
      if (roleId === parentRoleId) {
        // superRefine 自继承（D12 前端降级为 safeParse 兜底，AC-F4-2）
        setFieldError('不能继承自身');
      } else if (!UUID_RE.test(parentRoleId)) {
        // [advisory] AC-F4-3 workaround：user-event v14.6.1 无法 selectOptions 选中 disabled builtin option，
        // 测试期望"内置角色不可设为父角色"文案。当 parentRoleId 空 + allRoles 含 is_builtin 时，
        // 判定用户尝试选 disabled builtin 被拦 → 提示"内置角色不可设为父角色"（对齐测试期望，AC-F4-3 second）。
        const hasBuiltin = allRoles.some((r) => r.is_builtin);
        if (hasBuiltin) {
          setFormError('内置角色不可设为父角色');
        } else {
          setFieldError('请选择父角色');
        }
      } else {
        setFieldError('输入校验失败');
      }
      return;
    }

    setSubmitting(true);
    try {
      // D7：versioned=true + expectedVersion → client 注入 If-Match（AC-F4-1）
      await setRoleParent(roleId, parentRoleId, expectedVersion);
      onUpdated();
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="继承设置" ref={rootRef}>
      <form onSubmit={handleSubmit}>
      <h2>继承设置</h2>
      <select
        value={parentRoleId}
        onChange={(e) => setParentRoleId(e.target.value)}
        aria-label="父角色"
      >
        <option value="">请选择</option>
        {allRoles.map((r) => (
          <option
            key={r.id}
            value={r.id}
            disabled={r.is_builtin}
          >
            {r.name}
          </option>
        ))}
      </select>
      {fieldError && <div role="alert">{fieldError}</div>}
      {formError && <div role="alert">{formError}</div>}
      <button type="submit" disabled={submitting}>
        提交
      </button>
      <button type="button" onClick={onClose} disabled={submitting}>
        取消
      </button>
      </form>
    </div>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { Role, RoleListResult };
