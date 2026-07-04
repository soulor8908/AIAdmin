// apps/web/src/components/RoleForm.tsx —— 角色创建表单（TECH-WEB-ROLE-DEPT-AUDIT-001 §6.2）
//
// 职责：
//   - 自由文本表单：name（1..64）+ description（max512）须 createRoleInputSchema.safeParse（D4，AC-F2-3/4/5）
//   - permission_codes 多选 select（选项从 [...permissionCodeSchema.options] SSOT 派生，类型派生操作，§3.2-B）
//   - 提交成功 → 关闭 + 刷新；ROLE_NAME_DUPLICATE → 表单内"角色名称已存在"（B1：非 ROLE_CODE_DUPLICATE）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/roles + api/client + lib/errorMapping）。
// [约束] D3：CreateRoleInput/PermissionCode 经 z.infer 派生。
// [约束] D4：自由文本表单须 safeParse（R13 S-1）。permission_codes 多选为类型派生，整体 safeParse 覆盖（§3.2 混合表单）。
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createRoleInputSchema,
  permissionCodeSchema,
  type CreateRoleInput,
  type ErrorCode,
  type PermissionCode,
} from '@admin/contracts';
import { createRole } from '../api/roles.js';
import { ApiError } from '../api/client.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';

/** RoleForm 组件 props。onClose：关闭弹窗；onCreated：创建成功后刷新列表。 */
export type RoleFormProps = {
  onClose: () => void;
  onCreated: () => void;
};

/** 权限码全集 SSOT 派生（AI-005，禁止硬编码 11 项）。 */
const ALL_PERMISSION_CODES: PermissionCode[] = [...permissionCodeSchema.options];

/** ApiError → 中文提示。LocalErrorCode 兜底通用提示，contracts 码走 mapErrorToMessage。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** RoleForm 组件。自由文本表单 + permission_codes 多选 SSOT 派生。 */
export function RoleForm(props: RoleFormProps): JSX.Element {
  const { onClose, onCreated } = props;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissionCodes, setPermissionCodes] = useState<PermissionCode[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // R23：modal 焦点陷阱 + ESC 关闭 + focus restore（D1/D5/D6，AC-A11y-2/3/4）
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusTrap(rootRef, { onClose, enabled: true, submitting });

  function handlePermChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const selected = Array.from(e.target.selectedOptions).map((o) => o.value as PermissionCode);
    setPermissionCodes(selected);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setFieldError(null);
    setFormError(null);
    const trimmedName = name.trim();
    const raw = { name: trimmedName, description, permission_codes: permissionCodes };
    // D4：自由文本表单 safeParse（R13 S-1）。.strict() 拒绝多余字段（如 code）。
    const result = createRoleInputSchema.safeParse(raw);
    if (!result.success) {
      // safeParse 拦截后按字段+约束映射中文提示（AC-F2-3/4/5）
      if (!trimmedName) {
        setFieldError('角色名称必填');
      } else if (trimmedName.length > 64) {
        setFieldError('角色名称不超过 64 字符');
      } else if (description.length > 512) {
        setFieldError('描述不超过 512 字符');
      } else {
        setFieldError('输入校验失败');
      }
      return;
    }
    setSubmitting(true);
    try {
      await createRole(result.data);
      onCreated();
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="创建角色" ref={rootRef}>
      <form onSubmit={handleSubmit}>
      <h2>创建角色</h2>
      <label>
        名称
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="名称"
        />
      </label>
      <label>
        描述
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="描述"
        />
      </label>
      <label>
        权限
        <select
          multiple
          value={permissionCodes}
          onChange={handlePermChange}
          aria-label="权限"
          size={5}
        >
          {ALL_PERMISSION_CODES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      {fieldError && <div role="alert">{fieldError}</div>}
      {formError && <div role="alert">{formError}</div>}
      <button type="submit" disabled={submitting}>
        创建
      </button>
      <button type="button" onClick={onClose} disabled={submitting}>
        取消
      </button>
      </form>
    </div>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { CreateRoleInput, PermissionCode };
