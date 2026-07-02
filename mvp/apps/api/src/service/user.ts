// apps/api/src/service/user.ts —— 业务层：编排 repository + domain + 权限校验 + 抛 AppError
// 校验顺序（Tech-Spec）：鉴权(B3) → 业务规则(B4/B5/B6) → 状态守卫(B7/B8)，先到先返。
// D3：写操作返回 {entity, changes, before?}（WriteResult），供 router 层 withAudit 提取 entity + 旁路记日志。
import { randomUUID } from 'node:crypto';
import type {
  CreateUserInput,
  ListUserQuery,
  User,
  UserListResult,
  UserStatus,
} from '@admin/contracts';
import type { UserRepository } from '../repository/user.js';
import type { Ctx } from '../context.js';
import { transitionStatus } from '../domain/user.js';
import { markPii, type WriteResult } from '../domain/audit.js';
import { AppError } from '../errors.js';

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  /** SEC-002：service 入口校验调用者必须为 admin，否则 FORBIDDEN。 */
  private requireAdmin(ctx: Ctx): void {
    if (ctx.user.role !== 'admin') {
      throw new AppError('FORBIDDEN', '需要管理员权限');
    }
  }

  async list(query: ListUserQuery, ctx: Ctx): Promise<UserListResult> {
    this.requireAdmin(ctx);
    const { items, total } = this.repo.list({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    });
    // F1: 空列表 totalPages=0；否则 ceil(total/pageSize)
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
    return { items, total, page: query.page, pageSize: query.pageSize, totalPages };
  }

  /**
   * 批量查用户（TECH-NOTIFICATION-001 D1/D2 落点）：调 repo.findByIds(ids) + requireAdmin。
   * [约束] 入口 requireAdmin(ctx)（SEC-002：public 方法须调 requireAdmin；findByIds 为 admin 运营侧调用的批量查询，沿用 list/create 的 admin 守卫语义）。
   * [约束] 不存在的 id 静默 omitted（repo 层语义）；调用方传唯一 id（去重由调用方负责，PRD Q10）。
   * [约束] 本期为 NotificationService.send 校验收件人存在与禁用态的唯一消费方（跨 service 依赖新模式 D1）。
   */
  async findByIds(ids: string[], ctx: Ctx): Promise<User[]> {
    this.requireAdmin(ctx);
    return this.repo.findByIds(ids);
  }

  async create(input: CreateUserInput, ctx: Ctx): Promise<WriteResult<User>> {
    this.requireAdmin(ctx);
    // B4: 邮箱唯一
    const existing = this.repo.findByEmail(input.email);
    if (existing) {
      throw new AppError('USER_EMAIL_DUPLICATE', `邮箱已被占用: ${input.email}`);
    }
    const now = new Date().toISOString();
    const user: User = {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      status: 'active', // F2: 新建默认 active，不接受创建时指定 status
      department_id: null, // 跨域联动（TECH-DEPT-001）：新建用户默认无部门归属
      created_at: now,
      updated_at: now,
    };
    const inserted = this.repo.insert(user);
    // D3：changes 为 after 快照（经 markPii 标记 pii），create 无 before
    const changes = markPii('user', [
      { field: 'email', value: inserted.email, pii: false },
      { field: 'name', value: inserted.name, pii: false },
      { field: 'status', value: inserted.status, pii: false },
      { field: 'department_id', value: inserted.department_id ?? null, pii: false },
    ]);
    return { entity: inserted, changes };
  }

  async updateStatus(targetId: string, newStatus: UserStatus, ctx: Ctx): Promise<WriteResult<User>> {
    this.requireAdmin(ctx);
    // B5: 目标不存在（先于 B6/B7）
    const target = this.repo.findById(targetId);
    if (!target) {
      throw new AppError('USER_NOT_FOUND', `用户不存在: ${targetId}`);
    }
    // B6: 禁用自身禁止（权限校验先于状态校验；仅禁用场景，启用自身不禁止）
    if (newStatus === 'disabled' && targetId === ctx.user.id) {
      throw new AppError('USER_DISABLE_SELF_FORBIDDEN', '不能禁用自身当前登录账号');
    }
    // B7/B8: 状态守卫（domain 纯函数裁决）
    const result = transitionStatus(target.status, newStatus);
    if (!result.ok) {
      throw new AppError(result.errorCode, '状态变更冲突: 目标已是请求状态');
    }
    const now = new Date().toISOString();
    const updated = this.repo.updateStatus(targetId, result.next, now);
    if (!updated) {
      // 极小竞态：刚查到又被并发删除，按不存在处理
      throw new AppError('USER_NOT_FOUND', `用户不存在: ${targetId}`);
    }
    // D3：update 含 before/after 快照（仅 status 变更）
    const before = markPii('user', [
      { field: 'status', value: target.status, pii: false },
    ]);
    const changes = markPii('user', [
      { field: 'status', value: updated.status, pii: false },
    ]);
    return { entity: updated, changes, before };
  }
}
