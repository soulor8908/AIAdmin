// apps/web/src/components/DeptForm.tsx —— 部门创建表单（TECH-WEB-ROLE-DEPT-AUDIT-001 §6.5）
//
// 职责：
//   - 自由文本表单：name（1..64）须 createDepartmentInputSchema.safeParse（D4，AC-F5-4）
//   - parentId 可选（缺省/null=根部门，Q5 决策①；提供 uuid=子部门，AC-F5-2/3）
//   - 提交成功 → 关闭 + 刷新树；DEPT_NAME_DUPLICATE/DEPT_DEPTH_EXCEEDED → 表单内提示
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/departments + api/client + lib/errorMapping）。
// [约束] D3：CreateDepartmentInput 经 z.infer 派生。
// [约束] D4：自由文本表单须 safeParse（R13 S-1）。
// [约束] D13：parentId 可选（缺省/null=根部门），提交 body 据 parentId 含/不含 parent_id。
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createDepartmentInputSchema,
  type CreateDepartmentInput,
  type ErrorCode,
} from '@admin/contracts';
import { createDepartment } from '../api/departments.js';
import { ApiError } from '../api/client.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';

/** DeptForm 组件 props。parentId 缺省/null=根部门；提供=子部门。 */
export type DeptFormProps = {
  onClose: () => void;
  onCreated: () => void;
  parentId?: string | null;
};

/** ApiError → 中文提示。LocalErrorCode 兜底通用提示，contracts 码走 mapErrorToMessage。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** DeptForm 组件。自由文本表单 + parentId 可选（D13）。 */
export function DeptForm(props: DeptFormProps): JSX.Element {
  const { onClose, onCreated, parentId } = props;
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // R23：modal 焦点陷阱 + ESC 关闭 + focus restore（D1/D5/D6，AC-A11y-2/3/4）
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusTrap(rootRef, { onClose, enabled: true, submitting });

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setFieldError(null);
    setFormError(null);
    const trimmedName = name.trim();
    // D13：parentId 缺省/null → raw 不含 parent_id（根部门）；提供 uuid → raw.parent_id
    const raw: { name: string; parent_id?: string | null } = { name: trimmedName };
    if (parentId !== undefined && parentId !== null) {
      raw.parent_id = parentId;
    }
    // D4：自由文本表单 safeParse（R13 S-1）。.strict() 拒绝多余字段。
    const result = createDepartmentInputSchema.safeParse(raw);
    if (!result.success) {
      // safeParse 拦截后按字段+约束映射中文提示（AC-F5-4）
      if (!trimmedName) {
        setFieldError('部门名称必填');
      } else if (trimmedName.length > 64) {
        setFieldError('部门名称不超过 64 字符');
      } else {
        setFieldError('输入校验失败');
      }
      return;
    }
    setSubmitting(true);
    try {
      // result.data 据 raw 含/不含 parent_id（.strict() safeParse 保留提供字段）
      await createDepartment(result.data);
      onCreated();
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="创建部门" ref={rootRef}>
      <form onSubmit={handleSubmit}>
      <h2>创建部门</h2>
      <label>
        名称
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="名称"
        />
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
export type { CreateDepartmentInput };
