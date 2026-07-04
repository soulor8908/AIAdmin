// apps/web/src/api/notifications.ts —— 通知域 endpoint 封装（TECH-WEB-NOTIFICATION-REPORT-001 §4.2.1）
//
// 职责：
//   - listNotifications(query)：GET /v1/notifications（分页 + status 筛选，调用方传 pageSize=20，D16）
//   - createNotification(input)：POST /v1/notifications（body={title, content, recipient_id}）
//   - updateNotification(id, input, expectedVersion)：PATCH /v1/notifications/:id（versioned=true，D7）
//   - sendNotification(id, expectedVersion)：POST /v1/notifications/:id/send（versioned=true，draft→sent）
//   - markNotificationRead(id, expectedVersion)：POST /v1/notifications/:id/read（versioned=true，sent→read）
//   - deleteNotification(id, expectedVersion)：DELETE /v1/notifications/:id（versioned=true，仅 draft）
//
// [约束] ARCH-003：仅 import @admin/contracts + apps/web 内部（api/client），禁止 import apps/api/src/**。
// [约束] D3：全部类型经 z.infer 派生自 contracts。
// [约束] D7：update/send/markRead/delete 须 versioned=true + expectedVersion → client 注入 If-Match（4 versioned 端点，N3）。
// [约束] D9：409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条）。
// [约束] D16：listNotifications 调用方显式传 pageSize=20（抹平契约缺省 10，N1）。
// [约束] D20：函数命名对齐本 Spec §4.2.1 声明。
// [约束] 本文件为类型派生操作（input/output 类型经 z.infer 派生），不调 safeParse。
//                调用方（自由文本表单）负责 safeParse 校验后再传入。
import type {
  CreateNotificationInput,
  ListNotificationQuery,
  Notification,
  NotificationListResult,
  UpdateNotificationInput,
} from '@admin/contracts';
import { request } from './client.js';

/** GET /v1/notifications —— 通知列表（分页 + status 筛选）。调用方显式传 pageSize=20（D16，抹平契约缺省 10，N1）。 */
export function listNotifications(query: ListNotificationQuery): Promise<NotificationListResult> {
  return request<NotificationListResult>('GET', '/v1/notifications', { query });
}

/** POST /v1/notifications —— 创建通知（body={title, content, recipient_id}）。 */
export function createNotification(input: CreateNotificationInput): Promise<Notification> {
  return request<Notification>('POST', '/v1/notifications', { body: input });
}

/**
 * PATCH /v1/notifications/:id —— 编辑通知（仅 draft 态，versioned=true，If-Match=expectedVersion，N3）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9，用 409 body current_version，不 GET 单条）。
 * sent/read 态编辑由后端状态守卫拒绝抛 NOTIFICATION_INVALID_TRANSITION（N2，不重试，仅 VERSION_CONFLICT 重试）。
 */
export function updateNotification(
  id: string,
  input: UpdateNotificationInput,
  expectedVersion: number,
): Promise<Notification> {
  return request<Notification>('PATCH', `/v1/notifications/${id}`, {
    body: input,
    versioned: true,
    expectedVersion,
  });
}

/**
 * POST /v1/notifications/:id/send —— 发送通知（draft→sent，versioned=true，If-Match，N3）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9）。
 * send 时收件人不存在抛 NOTIFICATION_RECIPIENT_NOT_FOUND、收件人 disabled 抛 NOTIFICATION_RECIPIENT_DISABLED（N4 延后校验）。
 */
export function sendNotification(id: string, expectedVersion: number): Promise<Notification> {
  return request<Notification>('POST', `/v1/notifications/${id}/send`, {
    versioned: true,
    expectedVersion,
  });
}

/**
 * POST /v1/notifications/:id/read —— 标记已读（sent→read，versioned=true，If-Match，N3）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9）。
 * draft 态拒绝 / read 态拒绝重复标记抛 NOTIFICATION_INVALID_TRANSITION（N3，不重试）。
 */
export function markNotificationRead(id: string, expectedVersion: number): Promise<Notification> {
  return request<Notification>('POST', `/v1/notifications/${id}/read`, {
    versioned: true,
    expectedVersion,
  });
}

/**
 * DELETE /v1/notifications/:id —— 删除通知（仅 draft，versioned=true，If-Match，N3）。
 * 409 VERSION_CONFLICT 由 client 自动重试 1 次（D9，DELETE 重试幂等——409 表示未删除，重试语义安全）。
 * sent/read 态拒绝抛 NOTIFICATION_INVALID_TRANSITION（N3，append-only 不可删，不重试）。
 */
export function deleteNotification(id: string, expectedVersion: number): Promise<void> {
  return request<void>('DELETE', `/v1/notifications/${id}`, {
    versioned: true,
    expectedVersion,
  });
}
