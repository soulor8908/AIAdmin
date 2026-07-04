// apps/web/src/components/NotificationForm.tsx —— 通知创建/编辑表单（TECH-WEB-NOTIFICATION-REPORT-001 §6.2）
//
// 职责：
//   - modal 形态（Q2 决策①），create/edit 双模式
//   - create 模式：createNotificationInputSchema.safeParse 校验（自由文本，D4）
//   - edit 模式：updateNotificationInputSchema.safeParse 校验（partial，空对象合法，N2）
//   - aria-label 域特定（D21）：通知标题/通知内容/收件人 ID
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部。
// [约束] D3：Notification/CreateNotificationInput/UpdateNotificationInput 经 z.infer 派生。
// [约束] D4：自由文本表单须 safeParse。
// [约束] D15：recipient_id 自由文本 UUID 输入 + 存在性延后至 send（N4）。
// [约束] D21：aria-label 域特定。
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createNotificationInputSchema,
  updateNotificationInputSchema,
  type CreateNotificationInput,
  type ErrorCode,
  type Notification,
  type UpdateNotificationInput,
} from '@admin/contracts';
import { createNotification, updateNotification } from '../api/notifications.js';
import { ApiError } from '../api/client.js';
import { mapErrorToMessage } from '../lib/errorMapping.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';

/** NotificationForm 组件 props。 */
export type NotificationFormProps = {
  mode: 'create' | 'edit';
  initial?: Notification | null;
  onClose: () => void;
  onCreated?: (notification: Notification) => void;
  onUpdated?: (notification: Notification) => void;
};

/** UUID 格式正则（与 z.string().uuid() 对齐，用于 advisory 错误映射定位）。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ApiError → 中文提示。LocalErrorCode 兜底通用提示，contracts 码走 mapErrorToMessage。 */
function resolveErrorMessage(err: ApiError): string {
  if (err.code === 'NETWORK_ERROR' || err.code === 'INTERNAL_ERROR') {
    return '操作失败，请稍后重试';
  }
  return mapErrorToMessage(err.code as ErrorCode);
}

/** NotificationForm 组件（创建/编辑 modal，自由文本表单须 safeParse）。 */
export function NotificationForm(props: NotificationFormProps): JSX.Element {
  const { mode, initial, onClose, onCreated, onUpdated } = props;
  const isEdit = mode === 'edit';
  const [title, setTitle] = useState(isEdit ? initial?.title ?? '' : '');
  const [content, setContent] = useState(isEdit ? initial?.content ?? '' : '');
  const [recipientId, setRecipientId] = useState(isEdit ? initial?.recipient_id ?? '' : '');
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

    if (!isEdit) {
      // create 模式：safeParse 全字段（自由文本须 safeParse）
      const raw: CreateNotificationInput = { title, content, recipient_id: recipientId };
      const result = createNotificationInputSchema.safeParse(raw);
      if (!result.success) {
        // 按字段+约束映射中文提示（AC-F2-2/3/4/5）
        if (!title) {
          setFieldError('通知标题必填');
        } else if (title.length > 128) {
          setFieldError('通知标题不超过 128 字符');
        } else if (!content) {
          setFieldError('通知内容必填');
        } else if (content.length > 4000) {
          setFieldError('通知内容不超过 4000 字符');
        } else if (!UUID_RE.test(recipientId)) {
          setFieldError('收件人 ID 须为 UUID 格式');
        } else {
          setFieldError('输入校验失败');
        }
        return;
      }
      setSubmitting(true);
      try {
        const created = await createNotification(result.data);
        onCreated?.(created);
        onClose();
      } catch (err) {
        setFormError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // edit 模式：diff initial → 仅提交变更字段（partial，空对象合法，N2，AC-F3-5）
    const input: UpdateNotificationInput = {};
    if (title !== initial?.title) input.title = title;
    if (content !== initial?.content) input.content = content;
    if (recipientId !== initial?.recipient_id) input.recipient_id = recipientId;
    const result = updateNotificationInputSchema.safeParse(input);
    if (!result.success) {
      // partial 字段校验失败映射（按字段+约束）
      if (input.title !== undefined && !input.title) {
        setFieldError('通知标题必填');
      } else if (input.title !== undefined && input.title.length > 128) {
        setFieldError('通知标题不超过 128 字符');
      } else if (input.content !== undefined && !input.content) {
        setFieldError('通知内容必填');
      } else if (input.content !== undefined && input.content.length > 4000) {
        setFieldError('通知内容不超过 4000 字符');
      } else if (input.recipient_id !== undefined && !UUID_RE.test(input.recipient_id)) {
        setFieldError('收件人 ID 须为 UUID 格式');
      } else {
        setFieldError('输入校验失败');
      }
      return;
    }
    setSubmitting(true);
    try {
      const updated = await updateNotification(initial!.id, result.data, initial!.version);
      onUpdated?.(updated);
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? resolveErrorMessage(err) : '操作失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={isEdit ? '编辑通知' : '创建通知'} ref={rootRef}>
      <form onSubmit={handleSubmit}>
      <h2>{isEdit ? '编辑通知' : '创建通知'}</h2>
      <label>
        通知标题
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="通知标题"
        />
      </label>
      <label>
        通知内容
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-label="通知内容"
        />
      </label>
      <label>
        收件人 ID
        <input
          type="text"
          value={recipientId}
          onChange={(e) => setRecipientId(e.target.value)}
          aria-label="收件人 ID"
        />
      </label>
      {fieldError && <div role="alert">{fieldError}</div>}
      {formError && <div role="alert">{formError}</div>}
      <button type="submit" disabled={submitting}>
        {isEdit ? '保存' : '创建'}
      </button>
      <button type="button" onClick={onClose} disabled={submitting}>
        取消
      </button>
      </form>
    </div>
  );
}

/** 导出类型（contracts 派生），供测试引用。 */
export type { CreateNotificationInput, Notification, UpdateNotificationInput };
