// apps/api/src/domain/notification.ts —— 领域层：状态机转移纯函数 + 合法转移 SSOT（无 IO）
// ARCH-001：domain 不得 import 上层（service/repository/router），仅可 import @admin/contracts。
// 状态机裁决（D3）：纯函数 transitionStatus(from, to)，由 service 层调用并把 errorCode 转抛为 AppError。
// 参考 apps/api/src/domain/user.ts 的 transitionStatus 模式（同一形状：ok+next / ok:false+errorCode）。
import type { NotificationStatus, NotificationTransition, Notification } from '@admin/contracts';

/** 通知实体类型别名（与契约 notificationSchema 的 Notification 一致，SSOT 在 contracts，禁止手写副本）。 */
export type NotificationEntity = Notification;

/**
 * 合法转移 SSOT（PRD Q1 / Tech-Spec D3）：
 * - draft → sent（send，运营操作）
 * - sent  → read（markRead，收件人自服务）
 * 非法转移（统一 NOTIFICATION_INVALID_TRANSITION）：跳过（draft→read）/ 同态 / 回退（read 为终态）。
 * runtime 数据 SSOT 在 domain（contracts 的 notificationTransitionSchema 只定义形状，ARCH-002）。
 */
export const ALLOWED_NOTIFICATION_TRANSITIONS: NotificationTransition[] = [
  { from: 'draft', to: 'sent' },
  { from: 'sent', to: 'read' },
];

/**
 * 状态机转移结果：合法返回下一态，非法统一返回 NOTIFICATION_INVALID_TRANSITION（单码覆盖所有状态非法，Q1）。
 * 参考 user 域 TransitionResult 形状（ok:true+next / ok:false+errorCode）。
 */
export type TransitionResult =
  | { ok: true; next: NotificationStatus }
  | { ok: false; errorCode: 'NOTIFICATION_INVALID_TRANSITION' };

/**
 * 状态机裁决（纯函数）：合法转移见 ALLOWED_NOTIFICATION_TRANSITIONS；同态/跳过/回退均非法。
 * 不读写 IO，由 service 层调用并把 errorCode 转抛为 AppError。
 * service 层 send/markRead 用本函数统一裁决；update/delete 用"当前态 !== 'draft'"守卫判定（同样抛 NOTIFICATION_INVALID_TRANSITION）。
 */
export function transitionStatus(
  from: NotificationStatus,
  to: NotificationStatus,
): TransitionResult {
  const allowed = ALLOWED_NOTIFICATION_TRANSITIONS.some((t) => t.from === from && t.to === to);
  if (!allowed) return { ok: false, errorCode: 'NOTIFICATION_INVALID_TRANSITION' };
  return { ok: true, next: to };
}
