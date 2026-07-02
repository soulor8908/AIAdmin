// packages/contracts/src/schemas/notification.ts —— 通知管理契约层（SSOT）
// 派生自 Tech-Spec TECH-NOTIFICATION-001（prd_ref: PRD-NOTIFICATION-001）。
// 约束：所有类型经 z.infer 派生，禁止手写 TS 类型副本（ARCH-002 / CODE-004）。
// 约束：错误码 SSOT 为 user.ts 的 errorCodeSchema（跨域共享单一枚举），通知相关 4 码已追加其中；
//       本文件不重复定义 errorCodeSchema，避免 export * 重名冲突（详见 Tech-Spec §API 契约）。
// 约束：id / recipient_id 用 z.string().uuid()；created_at / updated_at / sent_at / read_at 用 z.string().datetime()。
// 约束：notification 字段均非 PII（title/content 为业务文本，recipient_id 为 uuid 引用，status/时间戳为状态/时间）；
//       PII_FIELD_REGISTRY 不新增 notification 条目（markPii('notification', ...) 全 false，沿用第五轮仅 {user: {email}}）。

import { z } from 'zod';

/**
 * 通知状态机取值（F1 Q1）：
 * - draft = 草稿（默认初始态，可编辑/可删除）
 * - sent  = 已发送（append-only，不可改不可删；可 markRead）
 * - read  = 已读（终态，append-only）
 * 合法转移：draft→sent（send）、sent→read（markRead，收件人自服务）。
 */
export const notificationStatusSchema = z.enum(['draft', 'sent', 'read']);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

/**
 * 通知实体：DB notifications 表行的契约投影。
 * 字段命名沿用 snake_case 以与 DB schema 对齐（recipient_id / created_at / updated_at / sent_at / read_at）。
 * [约束] recipient_id 引用 user 域 user.id（跨域依赖 F3，send 时校验存在与 active）；draft 创建时仅 uuid 格式校验，存在性延后至 send（Q8）。
 * [约束] sent_at：draft 态 null，send 时置非空 ISO datetime；read_at：draft/sent 态 null，markRead 时置非空 ISO datetime。
 * [约束] sent/read 态 append-only（不可 update/delete，由 service 层状态守卫裁决 B6）。
 * [约束] 输出 schema 带 .strict()（SEC-003a）。
 */
export const notificationSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(128),
    content: z.string().min(1).max(4000),
    recipient_id: z.string().uuid(),
    status: notificationStatusSchema,
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    sent_at: z.string().datetime().nullable(),
    read_at: z.string().datetime().nullable(),
  })
  .strict();
export type Notification = z.infer<typeof notificationSchema>;

/**
 * 新建通知输入（F1 Q4）。
 * [约束] title 1..128；content 1..4000；recipient_id uuid。
 * [约束] id / status / created_at / updated_at / sent_at / read_at 由服务端生成/维护，不入输入（.strict() 拒绝多余字段）。
 * [约束] recipient_id 仅做 uuid 格式校验，存在性/禁用态校验延后至 send（Q8 延后校验，允许"先草拟后发送"工作流）。
 */
export const createNotificationInputSchema = z
  .object({
    title: z.string().min(1).max(128),
    content: z.string().min(1).max(4000),
    recipient_id: z.string().uuid(),
  })
  .strict();
export type CreateNotificationInput = z.infer<typeof createNotificationInputSchema>;

/**
 * 更新通知输入（F1 Q2，draft 可编辑字段 partial）。
 * [约束] draft 态可编辑 title/content/recipient_id；status/sent_at/read_at/created_at/updated_at 不可由调用方改。
 * [约束] 空对象合法（partial，全缺省 → 无字段变更）；sent/read 态执行 update 由 service 状态守卫拒绝（B6 INVALID_TRANSITION）。
 * [约束] .strict() 拒绝多余字段（含 status/sent_at 等服务端字段）。
 */
export const updateNotificationInputSchema = z
  .object({
    title: z.string().min(1).max(128).optional(),
    content: z.string().min(1).max(4000).optional(),
    recipient_id: z.string().uuid().optional(),
  })
  .strict();
export type UpdateNotificationInput = z.infer<typeof updateNotificationInputSchema>;

/**
 * 通知状态转移形状 SSOT（contracts 只定义形状，runtime 合法转移数据在 domain 的 ALLOWED_NOTIFICATION_TRANSITIONS）。
 * [约束] {from, to} 形状，.strict() 拒绝多余字段；合法性由 domain transitionStatus 裁决（schema 不校验转移合法性）。
 * [约束] 与 PII_FIELD_REGISTRY 同先例：contracts 持形状，domain 持 runtime 数据（ARCH-002）。
 */
export const notificationTransitionSchema = z
  .object({
    from: notificationStatusSchema,
    to: notificationStatusSchema,
  })
  .strict();
export type NotificationTransition = z.infer<typeof notificationTransitionSchema>;

/**
 * 分页查询通知列表入参（F1）。
 * [约束] page 从 1 起，默认 1；pageSize 默认 10，上限 100（与 user/role 域一致，NFR 性能）。
 * [约束] status 可选，缺省表示不按状态过滤；传入须为 notificationStatusSchema 闭合枚举值。
 * [advisory] 非 strict（未知 query 键 strip，与 listUserQuerySchema / listAuditLogQuerySchema 一致）。
 */
export const listNotificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  status: notificationStatusSchema.optional(),
});
export type ListNotificationQuery = z.infer<typeof listNotificationQuerySchema>;

/**
 * 分页查询通知列表结果（F1）。
 * [约束] total = 满足筛选条件的总条数（非当前页条数）；totalPages = ceil(total/pageSize)；空列表 totalPages=0（对齐 user/role/dept 域约定）。
 * [约束] 输出 schema 带 .strict()（SEC-003a）。
 */
export const notificationListResultSchema = z
  .object({
    items: z.array(notificationSchema),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    totalPages: z.number().int().min(0),
  })
  .strict();
export type NotificationListResult = z.infer<typeof notificationListResultSchema>;
