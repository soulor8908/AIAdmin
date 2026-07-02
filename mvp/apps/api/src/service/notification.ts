// apps/api/src/service/notification.ts —— 业务层：编排 repository + domain + 跨 service 收件人校验 + 抛 AppError
// 校验顺序（Tech-Spec §边界与异常，先到先返，不叠加）：
//   create:  B3 鉴权 → 写入（status=draft, sent_at=null, read_at=null）→ 返回 + 埋点
//   update:  B3 鉴权 → B5 通知不存在(NOTIFICATION_NOT_FOUND) → B6 仅 draft 允许(NOTIFICATION_INVALID_TRANSITION) → 写入（updated_at 刷新）→ 返回 + 埋点
//   send:    B3 鉴权 → B5 → B6 仅 draft 允许 → B7 收件人不存在(NOTIFICATION_RECIPIENT_NOT_FOUND) → B8 收件人禁用(NOTIFICATION_RECIPIENT_DISABLED) → 写入（status=sent, sent_at=now）→ 返回 + 埋点
//   markRead: B2 登录 → B5 → B4 收件人校验(FORBIDDEN，非 admin 守卫，自服务) → B6 仅 sent 允许 → 写入（status=read, read_at=now）→ 返回 + 埋点
//   delete:  B3 鉴权 → B5 → B6 仅 draft 允许 → 删除（204）→ 埋点（after=[]）
//   list/detail: B3 鉴权 → 返回（读不埋点）
//   [约束] TECH-OPTIMISTIC-LOCKING-001 D9：写操作守卫顺序 B5 实体存在 → B_version 版本匹配 → B6/B7/B8 业务规则。
// D1：跨 service 依赖新模式——NotificationService 注入 UserService（service→service，ARCH-001 仅禁 service→router，不禁 service→service）。
// D6：5 类写操作返回 WriteResult<Notification>（{entity, changes, before?}），供 router 层 withAudit 提取 entity + 旁路记日志。
// D5/D4：markRead 为收件人自服务，**不**走 requireAdmin，带 SEC-002-exempt 豁免标记（scanner 识别跳过 + push info 供 Reviewer 审计）。
// ARCH-001：service 不得 import router；service 不 import AuditLogService（埋点在 router 层 withAudit）。
import { randomUUID } from 'node:crypto';
import type {
  CreateNotificationInput,
  ListNotificationQuery,
  Notification,
  NotificationListResult,
  UpdateNotificationInput,
} from '@admin/contracts';
import type { UserService } from './user.js';
import type { NotificationRepository } from '../repository/notification.js';
import type { Ctx } from '../context.js';
import { transitionStatus } from '../domain/notification.js';
import { markPii, type WriteResult } from '../domain/audit.js';
import { AppError } from '../errors.js';
import { validateVersion } from '../domain/version.js';

export class NotificationService {
  constructor(
    private readonly userService: UserService,
    private readonly notificationRepo: NotificationRepository,
  ) {}

  /** SEC-002：service 入口校验调用者必须为 admin（admin 桩下视为具备 notification:read/write），否则 FORBIDDEN。 */
  private requireAdmin(ctx: Ctx): void {
    if (ctx.user.role !== 'admin') {
      throw new AppError('FORBIDDEN', '需要管理员权限');
    }
  }

  async create(input: CreateNotificationInput, ctx: Ctx): Promise<WriteResult<Notification>> {
    this.requireAdmin(ctx);
    const now = new Date().toISOString();
    const notification: Notification = {
      id: randomUUID(),
      title: input.title,
      content: input.content,
      recipient_id: input.recipient_id,
      status: 'draft',
      created_at: now,
      updated_at: now,
      sent_at: null, // draft 态 null，send 时置非空
      read_at: null, // draft/sent 态 null，markRead 时置非空
      version: 0, // TECH-OPTIMISTIC-LOCKING-001 D1：新建实体 version 初始 0
    };
    const inserted = this.notificationRepo.insert(notification);
    // D3/D6：changes 为 after 快照（markPii('notification',...) 全 false，无 PII），create 无 before
    // after 仅含业务字段 title/content/recipient_id/status:draft（不含 id/created_at/updated_at/sent_at/read_at 等服务端元数据，沿用 audit Q3）
    const changes = markPii('notification', [
      { field: 'title', value: inserted.title, pii: false },
      { field: 'content', value: inserted.content, pii: false },
      { field: 'recipient_id', value: inserted.recipient_id, pii: false },
      { field: 'status', value: inserted.status, pii: false },
    ]);
    return { entity: inserted, changes };
  }

  async update(
    id: string,
    input: UpdateNotificationInput,
    expectedVersion: number,
    ctx: Ctx,
  ): Promise<WriteResult<Notification>> {
    this.requireAdmin(ctx);
    // B5: 通知不存在（先于 B_version 版本匹配守卫，再先于 B6 状态守卫；含乐观锁版本校验 TECH-OPTIMISTIC-LOCKING-001 D9）
    const n = this.notificationRepo.findById(id);
    if (!n) {
      throw new AppError('NOTIFICATION_NOT_FOUND', `通知不存在: ${id}`);
    }
    // B_version: 乐观锁版本校验（先于 B6 状态守卫，TECH-OPTIMISTIC-LOCKING-001 D9）
    const versionCheck = validateVersion(expectedVersion, n.version);
    if (!versionCheck.ok) {
      throw new AppError('VERSION_CONFLICT', `版本冲突: 期望 ${expectedVersion}，实际 ${n.version}`, { current_version: n.version });
    }
    // B6: 仅 draft 允许编辑（状态守卫，违规同样 NOTIFICATION_INVALID_TRANSITION，Q1）
    if (n.status !== 'draft') {
      throw new AppError('NOTIFICATION_INVALID_TRANSITION', `仅 draft 态允许编辑，当前态: ${n.status}`);
    }
    // 计算实际变更字段（before/after 仅含本次实际变更字段，未变更不入快照，沿用 audit Q3）
    const before = markPii('notification', []);
    const changes = markPii('notification', []);
    if (input.title !== undefined && input.title !== n.title) {
      before.push({ field: 'title', value: n.title, pii: false });
      changes.push({ field: 'title', value: input.title, pii: false });
    }
    if (input.content !== undefined && input.content !== n.content) {
      before.push({ field: 'content', value: n.content, pii: false });
      changes.push({ field: 'content', value: input.content, pii: false });
    }
    if (input.recipient_id !== undefined && input.recipient_id !== n.recipient_id) {
      before.push({ field: 'recipient_id', value: n.recipient_id, pii: false });
      changes.push({ field: 'recipient_id', value: input.recipient_id, pii: false });
    }
    // D12：version 字段无条件纳入 before/after 快照（repo.update 自增 version，新值 = n.version + 1）
    before.push({ field: 'version', value: n.version, pii: false });
    changes.push({ field: 'version', value: n.version + 1, pii: false });
    // 保证 updated_at 单调递增：ms 精度下 create 与 update back-to-back 可能同毫秒产生同戳，
    // 取 max(Date.now(), prev+1ms) 确保 updated_at 严格晚于前值（测试断言 updated_at 刷新）。
    const prevMs = Date.parse(n.updated_at);
    const now = new Date(Math.max(Date.now(), prevMs + 1)).toISOString();
    const updated = this.notificationRepo.update(id, {
      title: input.title,
      content: input.content,
      recipient_id: input.recipient_id,
      updated_at: now,
    });
    if (!updated) {
      // 极小竞态：刚查到又被并发删除，按不存在处理
      throw new AppError('NOTIFICATION_NOT_FOUND', `通知不存在: ${id}`);
    }
    return { entity: updated, changes, before };
  }

  async send(id: string, expectedVersion: number, ctx: Ctx): Promise<WriteResult<Notification>> {
    this.requireAdmin(ctx);
    // B5: 通知不存在（先于 B_version 版本匹配守卫；含乐观锁版本校验 TECH-OPTIMISTIC-LOCKING-001 D9）
    const n = this.notificationRepo.findById(id);
    if (!n) {
      throw new AppError('NOTIFICATION_NOT_FOUND', `通知不存在: ${id}`);
    }
    // B_version: 乐观锁版本校验（先于 B6 状态守卫，TECH-OPTIMISTIC-LOCKING-001 D9）
    const versionCheck = validateVersion(expectedVersion, n.version);
    if (!versionCheck.ok) {
      throw new AppError('VERSION_CONFLICT', `版本冲突: 期望 ${expectedVersion}，实际 ${n.version}`, { current_version: n.version });
    }
    // B6: 状态守卫——send 仅 draft 允许（用 transitionStatus(draft, sent) 裁决，非 draft → NOTIFICATION_INVALID_TRANSITION）
    const transition = transitionStatus(n.status, 'sent');
    if (!transition.ok) {
      throw new AppError(transition.errorCode, `状态转移非法: ${n.status}→sent`);
    }
    // B7: 收件人不存在（跨 service 调用 userService.findByIds，D1 新模式）
    const recipients = await this.userService.findByIds([n.recipient_id], ctx);
    if (recipients.length === 0) {
      throw new AppError('NOTIFICATION_RECIPIENT_NOT_FOUND', `收件人不存在: ${n.recipient_id}`);
    }
    // B8: 收件人禁用
    const recipient = recipients[0]!;
    if (recipient.status === 'disabled') {
      throw new AppError('NOTIFICATION_RECIPIENT_DISABLED', `收件人已禁用: ${n.recipient_id}`);
    }
    // 校验通过 → 写入 status=sent + sent_at + updated_at
    const now = new Date().toISOString();
    const updated = this.notificationRepo.updateStatusAndSentAt(id, now, now);
    if (!updated) {
      throw new AppError('NOTIFICATION_NOT_FOUND', `通知不存在: ${id}`);
    }
    // before=[status:draft, sent_at:null, version] / after=[status:sent, sent_at:ISO, version]（read_at 未变更不入快照）
    const before = markPii('notification', [
      { field: 'status', value: n.status, pii: false },
      { field: 'sent_at', value: n.sent_at, pii: false },
      { field: 'version', value: n.version, pii: false },
    ]);
    const changes = markPii('notification', [
      { field: 'status', value: updated.status, pii: false },
      { field: 'sent_at', value: updated.sent_at, pii: false },
      { field: 'version', value: updated.version, pii: false },
    ]);
    return { entity: updated, changes, before };
  }

  // SEC-002-exempt: recipient self-service (PRD Q4b); guard via ctx.user.id === recipient_id
  async markRead(id: string, expectedVersion: number, ctx: Ctx): Promise<WriteResult<Notification>> {
    // B5: 通知存在（先于 B_version 版本匹配守卫，再先于 B4 收件人校验，PRD Q4b 钦定序；含乐观锁版本校验 TECH-OPTIMISTIC-LOCKING-001 D9）
    const n = this.notificationRepo.findById(id);
    if (!n) {
      throw new AppError('NOTIFICATION_NOT_FOUND', `通知不存在: ${id}`);
    }
    // B_version: 乐观锁版本校验（先于 B4 收件人校验，TECH-OPTIMISTIC-LOCKING-001 D9）
    const versionCheck = validateVersion(expectedVersion, n.version);
    if (!versionCheck.ok) {
      throw new AppError('VERSION_CONFLICT', `版本冲突: 期望 ${expectedVersion}，实际 ${n.version}`, { current_version: n.version });
    }
    // B4: 收件人自服务守卫（非 admin 守卫；admin 代标记亦拒绝，自服务语义）
    if (ctx.user.id !== n.recipient_id) {
      throw new AppError('FORBIDDEN', '仅收件人可标记已读');
    }
    // B6: 状态守卫——markRead 仅 sent 允许（用 transitionStatus(sent, read) 裁决）
    const transition = transitionStatus(n.status, 'read');
    if (!transition.ok) {
      throw new AppError(transition.errorCode, `状态转移非法: ${n.status}→read`);
    }
    const now = new Date().toISOString();
    const updated = this.notificationRepo.updateStatusAndReadAt(id, now, now);
    if (!updated) {
      throw new AppError('NOTIFICATION_NOT_FOUND', `通知不存在: ${id}`);
    }
    // before=[status:sent, read_at:null, version] / after=[status:read, read_at:ISO, version]（sent_at 未变更不入快照）
    const before = markPii('notification', [
      { field: 'status', value: n.status, pii: false },
      { field: 'read_at', value: n.read_at, pii: false },
      { field: 'version', value: n.version, pii: false },
    ]);
    const changes = markPii('notification', [
      { field: 'status', value: updated.status, pii: false },
      { field: 'read_at', value: updated.read_at, pii: false },
      { field: 'version', value: updated.version, pii: false },
    ]);
    return { entity: updated, changes, before };
  }

  async delete(id: string, expectedVersion: number, ctx: Ctx): Promise<WriteResult<void>> {
    this.requireAdmin(ctx);
    // B5: 通知不存在（先于 B_version 版本匹配守卫，再先于 B6 状态守卫；含乐观锁版本校验 TECH-OPTIMISTIC-LOCKING-001 D9）
    const n = this.notificationRepo.findById(id);
    if (!n) {
      throw new AppError('NOTIFICATION_NOT_FOUND', `通知不存在: ${id}`);
    }
    // B_version: 乐观锁版本校验（先于 B6 状态守卫，TECH-OPTIMISTIC-LOCKING-001 D9）
    const versionCheck = validateVersion(expectedVersion, n.version);
    if (!versionCheck.ok) {
      throw new AppError('VERSION_CONFLICT', `版本冲突: 期望 ${expectedVersion}，实际 ${n.version}`, { current_version: n.version });
    }
    // B6: 状态守卫——delete 仅 draft 允许（append-only：sent/read 不可删）
    if (n.status !== 'draft') {
      throw new AppError('NOTIFICATION_INVALID_TRANSITION', `仅 draft 态允许删除，当前态: ${n.status}`);
    }
    this.notificationRepo.delete(id);
    // D3：delete 返回 entity=void（204 无体），before 为删除前快照，changes=after=[]
    const before = markPii('notification', [
      { field: 'title', value: n.title, pii: false },
      { field: 'content', value: n.content, pii: false },
      { field: 'recipient_id', value: n.recipient_id, pii: false },
      { field: 'status', value: n.status, pii: false },
      { field: 'version', value: n.version, pii: false },
    ]);
    return { entity: undefined, changes: [], before };
  }

  async list(query: ListNotificationQuery, ctx: Ctx): Promise<NotificationListResult> {
    this.requireAdmin(ctx);
    const { items, total } = this.notificationRepo.list({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    });
    // 空列表 totalPages=0；否则 ceil(total/pageSize)
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
    return { items, total, page: query.page, pageSize: query.pageSize, totalPages };
  }

  async detail(id: string, ctx: Ctx): Promise<Notification> {
    this.requireAdmin(ctx);
    const n = this.notificationRepo.findById(id);
    if (!n) {
      throw new AppError('NOTIFICATION_NOT_FOUND', `通知不存在: ${id}`);
    }
    return n;
  }
}
