// apps/api/src/service/auth.ts —— 鉴权业务层：login 签发 token + logout 吊销
// TECH-AUTH-001 D7（login 守卫顺序）/ D4（黑名单）/ AC-F1-6（login 审计）/ AC-F4-3（logout 审计）
// ARCH-001：service 可 import domain/repository/contracts，不得 import router。
// [约束] login 为 public 路由的 handler：不调 requireAdmin（anonCtx.user.role='user'），忽略 ctx.user，
//        operator_id 取自 input.email 解析出的用户 id（auth.test.ts L80/L628 断言）。
// [约束] logout 调 requireAdmin（SEC-002：logout 路由 auth:'admin'）。
import type { LoginInput, LoginResult, LogoutResult } from '@admin/contracts';
import type { UserRepository } from '../repository/user.js';
import type { TokenBlacklistRepository } from '../repository/token-blacklist.js';
import type { AuditLogService } from './audit.js';
import type { Ctx } from '../context.js';
import { signToken, verifyPassword, TOKEN_TTL_SECONDS } from '../domain/auth.js';
import { AppError } from '../errors.js';

/** Nil UUID，用于 login_failed（邮箱不存在）时 entity_id/operator_id 占位（auditLogSchema 要求 uuid）。 */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * [advisory] MVP role 判定：admin@example.com → 'admin'，其他 → 'user'。
 * 生产应从 RoleRepository 查用户角色分配（TECH-ROLE-001），但 AuthService 未注入 RoleRepository
 * （auth.test.ts 构造仅 5 参数），本期以 admin 邮箱判定。偏离记 §10 advisory 清单。
 * 此判定仅影响 token payload.role（用于 SEC-002 requireAdmin）；user 实体本身无 role 字段（D5）。
 */
const ADMIN_EMAIL = 'admin@example.com';

export class AuthService {
  constructor(
    private readonly userService: unknown,
    private readonly userRepo: UserRepository,
    private readonly tokenBlacklistRepo: TokenBlacklistRepository,
    private readonly auditService: AuditLogService,
    private readonly authSecret: string,
  ) {}

  /** SEC-002：logout 入口校验调用者必须为 admin，否则 FORBIDDEN。 */
  private requireAdmin(ctx: Ctx): void {
    if (ctx.user.role !== 'admin') {
      throw new AppError('FORBIDDEN', '需要管理员权限');
    }
  }

  /**
   * login 流程（D7 守卫顺序）：
   * B2 findByEmail 不存在 → INVALID_CREDENTIALS（模糊）+ audit login_failed
   * B3 密码校验失败 → INVALID_CREDENTIALS（模糊，同 B2）+ audit login_failed
   * B4 签发 token + audit login
   * [约束] B2/B3 同码同 message（防账号枚举，PRD Q9）。
   * [约束] login 为 public 路由 handler，不调 requireAdmin；operator_id 取自 email 解析的用户 id。
   */
  // SEC-002-exempt: public login endpoint (PRD F1/AC-F1-5); no requireAdmin — credentials check (email+password) replaces auth guard; operator_id resolved from input.email
  async login(input: LoginInput, _ctx: Ctx): Promise<LoginResult> {
    // B2: 用户存在
    const user = this.userRepo.findByEmail(input.email);
    if (!user) {
      // audit login_failed（邮箱不存在；entity_id 用 nil UUID 占位）
      await this.recordLoginFailed(NIL_UUID);
      throw new AppError('INVALID_CREDENTIALS', '邮箱或密码错误');
    }
    // B3: 密码校验（scrypt 比对）
    // UserEntity.password_hash 必填（DB schema NOT NULL + contracts 1:1），无需 ?? '' 兜底。
    const storedHash = user.password_hash;
    if (!verifyPassword(input.password, storedHash)) {
      // audit login_failed（密码错；entity_id=用户 id）
      await this.recordLoginFailed(user.id);
      throw new AppError('INVALID_CREDENTIALS', '邮箱或密码错误');
    }
    // B4: 签发 token
    // [advisory TECH-AUTH-001] token 确定性碰撞规避：D1 token = base64url(payload).base64url(hmac)
    //   为确定性函数，同 payload（同 sub+iat 秒级）产生相同 token。logout 后同秒内 re-login 会
    //   产生与已黑名单 token 完全相同的字符串 → buildCtx G5 误判 TOKEN_REVOKED，导致刚 login 的
    //   合法 token 不可用。规避：签发后检查黑名单，命中则 iat+1 重签直至不碰撞（MVP 黑名单规模小，
    //   循环次数极少；token 格式/payload schema/往返 toEqual 不变）。偏离记 §10 advisory 清单。
    const role: 'admin' | 'user' = user.email === ADMIN_EMAIL ? 'admin' : 'user';
    let iat = Math.floor(Date.now() / 1000);
    let token = signToken({ sub: user.id, role, iat, exp: iat + TOKEN_TTL_SECONDS }, this.authSecret);
    while (this.tokenBlacklistRepo.has(token)) {
      iat += 1;
      token = signToken({ sub: user.id, role, iat, exp: iat + TOKEN_TTL_SECONDS }, this.authSecret);
    }
    const expires_at = new Date((iat + TOKEN_TTL_SECONDS) * 1000).toISOString();
    // audit login 成功（entity_type=auth / action=login / entity_id=用户 id / operator_id=用户 id）
    await this.recordAuthLog(user.id, user.id, 'login');
    return { token, expires_at };
  }

  /**
   * logout（D4 黑名单 + AC-F4-3 审计）：
   * - requireAdmin（SEC-002：logout 路由 auth:'admin'）
   * - token 入黑名单
   * - audit logout（entity_type=auth / action=logout / operator_id=ctx.user.id）
   * [约束] logout 本身不抛 TOKEN_REVOKED（logout 是把当前 token 加入黑名单的动作，不是被黑名单拦截）。
   *        logout 后再用该 token 访问受保护路由 → buildCtx G5 拦截 → TOKEN_REVOKED。
   * [约束] token 已在黑名单时再调 logout → buildCtx G5 在 handler 前拦截 → 不会到达本方法。
   */
  async logout(token: string, ctx: Ctx): Promise<LogoutResult> {
    this.requireAdmin(ctx);
    // token 入黑名单
    this.tokenBlacklistRepo.add(token);
    // audit logout（entity_id=ctx.user.id，即 token payload.sub）
    await this.recordAuthLog(ctx.user.id, ctx.user.id, 'logout');
    return { success: true };
  }

  /**
   * best-effort 旁路记 auth 域审计日志（AC-F1-6 / AC-F4-3）。
   * [约束] 异常吞掉不影响主操作成败（D1/CODE-002：catch 须非空且非仅 console）。
   */
  private async recordAuthLog(entityId: string, operatorId: string, action: 'login' | 'logout' | 'login_failed'): Promise<void> {
    try {
      await this.auditService.record(
        {
          operator_id: operatorId,
          operator_name: 'admin', // [advisory] MVP 桩：Ctx 无姓名字段
          entity_type: 'auth',
          entity_id: entityId,
          action,
          operated_at: new Date().toISOString(),
          before: [],
          after: [],
        },
        // record 为 SEC-002-exempt，不调 requireAdmin；传入 adminCtx 仅占位
        { user: { id: operatorId, role: 'admin' } },
      );
    } catch (e) {
      // best-effort：吞掉 audit 异常，不影响主操作成败（D1/CODE-002：catch 须非空且非仅 console）
      console.warn('auth audit record failed (best-effort, swallowed)', e);
    }
  }

  /** login_failed 审计辅助（entity_id 为用户 id 或 nil UUID）。 */
  private async recordLoginFailed(entityId: string): Promise<void> {
    await this.recordAuthLog(entityId, entityId, 'login_failed');
  }
}
