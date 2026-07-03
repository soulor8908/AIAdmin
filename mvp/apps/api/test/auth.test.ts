// apps/api/test/auth.test.ts —— ③类新增鉴权域测试（TECH-AUTH-001 / PRD-AUTH-001）
//
// 本文件在 SERVICE / DOMAIN / 契约层覆盖鉴权域验收点（非端到端，不经 server.ts）：
//   - F1 login：AC-F1-2/3（INVALID_CREDENTIALS 模糊错误，邮箱不存在与密码错同码同 message）
//                 AC-F1-4（password 短于 8 位 → VALIDATION_ERROR，schema 层）
//                 AC-F1-6（login 成功/失败记审计）
//   - F2 token 校验：直接测 domain/auth.ts 纯函数 signToken/verifyToken（验签失败→TOKEN_INVALID）
//   - F3 密码哈希：AC-F3-1（password_hash 不在 userSchema 输出，.strict 拒绝）
//                 AC-F3-2（scrypt 哈希 salt.hash 格式非明文）
//                 AC-F3-3（createUser 缺省 password 生成临时密码 → 存储 password_hash）
//                 AC-F3-4（密码校验正确/错误）
//   - F4 logout：AC-F4-1（logout 入黑名单）、AC-F4-3（记审计）、SEC-002（logout requireAdmin）
//   - F5 seed：AC-F5-3（seed 凭据可登录，unit 层 login 路径）
//   - 契约测：loginInputSchema/loginResultSchema/logoutResultSchema/tokenPayloadSchema .strict 拒绝多余字段、
//             userEntitySchema 含 password_hash / userSchema 拒绝 password_hash、createUserInputSchema password optional、
//             errorCodeSchema 含 4 AUTH 码（SSOT 派生 toContain，AI-005）、errorResponseSchema 不变、
//             errorCodeToHttpStatus 4 码全 401
//
// 端到端 AC（F1-1/F1-5/F2-1~F2-6/F4-2/F4-4/F5-1/F5-2）在 auth-embedding.test.ts 中覆盖（spawn 真实 server + fetch）。
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - 测试在 SERVICE 层调用（authService.login / authService.logout），不经 router，故不触发 buildCtx 鉴权中间件（F2 范畴）。
//   - in-process 构造 Ctx（直接传 {user:{id,role}}），参考 optimistic-locking.test.ts setup 风格。
//   - AuthService 注入：UserService + UserRepository + TokenBlacklistRepository + AuditLogService + authSecret（桩）。
//   - 期望的「导入级红」符号（impl-writer 未实现）：AuthService（service/auth.ts）、
//     signToken/verifyToken/hashPassword/verifyPassword（domain/auth.ts）、TokenBlacklistRepository（repository/token-blacklist.ts）。
//   - 期望的「契约缺口红」（AI-006 反向核实）：auditLogEntityTypeSchema 须含 'auth'、auditLogActionSchema 须含
//     'login'/'login_failed'/'logout'，否则 PRD AC-F1-6/F4-3 不可达。Tech-Spec §5/§9 未列出此 contracts 联动，
//     本文件以 SSOT 派生 toContain 断言显式表达需求（断言级红），impl-writer / contracts 拥有者须补齐枚举。
//
// [AI-002 动态 import 隔离 → 已移除] impl-writer 已实现全部模块（service/auth / repository/token-blacklist
//   / domain/auth），lazy loader 已移除，改回顶层静态 import（不改测试断言，仅改 setup/import 路径）。
import { describe, it, expect } from 'vitest';
import {
  loginInputSchema,
  loginResultSchema,
  logoutResultSchema,
  tokenPayloadSchema,
  userSchema,
  userEntitySchema,
  createUserInputSchema,
  errorCodeSchema,
  errorResponseSchema,
  auditLogEntityTypeSchema,
  auditLogActionSchema,
  type ErrorCode,
  type TokenPayload,
  type UserEntity,
} from '@admin/contracts';
import { UserRepository } from '../src/repository/user.js';
import { UserService } from '../src/service/user.js';
import { AuditLogRepository } from '../src/repository/audit.js';
import { AuditLogService } from '../src/service/audit.js';
import { AuthService } from '../src/service/auth.js';
import { TokenBlacklistRepository } from '../src/repository/token-blacklist.js';
import { signToken, verifyToken, hashPassword, verifyPassword } from '../src/domain/auth.js';
import { AppError, errorCodeToHttpStatus } from '../src/errors.js';
import type { Ctx } from '../src/context.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const SEED_TS = '2020-01-01T00:00:00.000Z';
const AUTH_SECRET = 'test-auth-secret-for-unit-tests';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'admin123';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };
const userCtx: Ctx = { user: { id: 'u-non-admin', role: 'user' } };
// login 为 public 路由，调用时尚无认证用户；AuthService.login 应忽略 ctx.user，operator_id 取自 input.email 解析出的用户
const anonCtx: Ctx = { user: { id: '', role: 'user' } };

/**
 * 将含 password_hash 的 UserEntity 插入 UserRepository。
 * [impl 桥接已移除] domain/user.ts 的 UserEntity 已对齐为 User & { password_hash?: string }，
 *   repo.insert 接受 UserEntity，无需 cast（password_hash 为 optional，既有不带 password_hash 的 seed 仍兼容）。
 */
function insertUserWithPassword(repo: UserRepository, entity: UserEntity): void {
  repo.insert(entity);
}

/**
 * auth setup：构造共享 auditRepo + auditService + userService + tokenBlacklistRepo + authService。
 * seed 一个 admin 用户（password_hash = scrypt('admin123')），供 login 成功路径与 seed 凭据验收使用。
 * 返回的 repo/service 可观测存储态（断言黑名单 / 审计日志）。
 * [注] userService 注入 auditService —— auth.test.ts 直接调 service.create（不经 router/withAudit），
 *      AC-F3-3 审计断言依赖 service 层直接记日志（与 server.ts 中 UserService 不注入 auditService、
 *      由 withAudit 记日志的分工不同，二者不冲突：经 router 调时 withAudit 记，直接调 service 时 service 记）。
 */
async function setupAuth(): Promise<{
  userRepo: UserRepository;
  auditRepo: AuditLogRepository;
  auditService: AuditLogService;
  userService: UserService;
  tokenBlacklistRepo: TokenBlacklistRepository;
  authService: AuthService;
}> {
  const userRepo = new UserRepository();
  const auditRepo = new AuditLogRepository();
  const auditService = new AuditLogService(auditRepo);
  const userService = new UserService(userRepo, auditService);
  const tokenBlacklistRepo = new TokenBlacklistRepository();
  const authService = new AuthService(userService, userRepo, tokenBlacklistRepo, auditService, AUTH_SECRET);
  // seed admin（password_hash 由 domain/hashPassword 生成，与 server.ts seedDemoData 一致：admin@example.com/admin123）
  const adminEntity: UserEntity = {
    id: ADMIN_ID,
    name: 'admin',
    email: ADMIN_EMAIL,
    status: 'active',
    department_id: null,
    created_at: SEED_TS,
    updated_at: SEED_TS,
    version: 0,
    password_hash: hashPassword(ADMIN_PASSWORD),
  };
  insertUserWithPassword(userRepo, adminEntity);
  return { userRepo, auditRepo, auditService, userService, tokenBlacklistRepo, authService };
}

/** 捕获 Promise 拒绝并断言为 AppError + 指定 code，返回该错误以供进一步断言（如 message 比对）。 */
async function captureAppError(promise: Promise<unknown>, code: ErrorCode): Promise<AppError> {
  const err = await promise.then(
    () => {
      throw new Error(`期望抛出 ${code}，但 Promise 已 resolve`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  if (err instanceof AppError) {
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error('unreachable: captureAppError');
}

/** 在 auditRepo 中查找最近一条匹配的存储态日志（未脱敏原值）。 */
function findAuditLog(
  repo: AuditLogRepository,
  match: { entityType?: string; entityId?: string; action?: string },
): { entity_type: string; action: string; entity_id: string; operator_id: string } | undefined {
  return repo.listAll().find((l) =>
    (match.entityType === undefined || (l.entity_type as string) === match.entityType) &&
    (match.entityId === undefined || l.entity_id === match.entityId) &&
    (match.action === undefined || (l.action as string) === match.action),
  );
}

// ===========================================================================
// 契约测 · auth schemas（.strict 拒绝多余字段，SEC-003a）
// ===========================================================================
describe('契约测 · auth schemas（.strict）', () => {
  it('loginInputSchema 接受合法 {email, password≥8}', () => {
    expect(loginInputSchema.safeParse({ email: 'a@b.com', password: '12345678' }).success).toBe(true);
  });

  it('AC-F1-4: loginInputSchema 拒绝 password 短于 8 位（schema 层 VALIDATION_ERROR）', () => {
    const r = loginInputSchema.safeParse({ email: 'a@b.com', password: '123' });
    expect(r.success).toBe(false);
  });

  it('loginInputSchema 拒绝非 email 格式', () => {
    expect(loginInputSchema.safeParse({ email: 'not-an-email', password: '12345678' }).success).toBe(false);
  });

  it('loginInputSchema .strict 拒绝多余字段', () => {
    expect(
      loginInputSchema.safeParse({ email: 'a@b.com', password: '12345678', extra: 'bad' }).success,
    ).toBe(false);
  });

  it('loginResultSchema 接受合法 {token, expires_at(datetime)}', () => {
    expect(
      loginResultSchema.safeParse({ token: 'abc.def', expires_at: '2026-07-02T00:00:00.000Z' }).success,
    ).toBe(true);
  });

  it('loginResultSchema 拒绝空 token', () => {
    expect(
      loginResultSchema.safeParse({ token: '', expires_at: '2026-07-02T00:00:00.000Z' }).success,
    ).toBe(false);
  });

  it('loginResultSchema 拒绝非 datetime 的 expires_at', () => {
    expect(loginResultSchema.safeParse({ token: 'abc.def', expires_at: 'not-a-date' }).success).toBe(false);
  });

  it('loginResultSchema .strict 拒绝多余字段（不含 password_hash）', () => {
    expect(
      loginResultSchema.safeParse({
        token: 'abc.def',
        expires_at: '2026-07-02T00:00:00.000Z',
        password_hash: 'leak',
      }).success,
    ).toBe(false);
  });

  it('logoutResultSchema 接受 {success: true}', () => {
    expect(logoutResultSchema.safeParse({ success: true }).success).toBe(true);
  });

  it('logoutResultSchema 拒绝 {success: false}', () => {
    expect(logoutResultSchema.safeParse({ success: false }).success).toBe(false);
  });

  it('logoutResultSchema .strict 拒绝多余字段', () => {
    expect(logoutResultSchema.safeParse({ success: true, extra: 'bad' }).success).toBe(false);
  });

  it('tokenPayloadSchema 接受合法 payload（sub uuid / role admin|user / iat / exp int）', () => {
    expect(
      tokenPayloadSchema.safeParse({
        sub: '00000000-0000-4000-8000-000000000001',
        role: 'admin',
        iat: 1700000000,
        exp: 1700003600,
      }).success,
    ).toBe(true);
  });

  it('tokenPayloadSchema 拒绝非法 role', () => {
    expect(
      tokenPayloadSchema.safeParse({
        sub: '00000000-0000-4000-8000-000000000001',
        role: 'superadmin',
        iat: 1700000000,
        exp: 1700003600,
      }).success,
    ).toBe(false);
  });

  it('tokenPayloadSchema 拒绝非 uuid sub', () => {
    expect(
      tokenPayloadSchema.safeParse({ sub: 'not-uuid', role: 'admin', iat: 1, exp: 2 }).success,
    ).toBe(false);
  });

  it('tokenPayloadSchema .strict 拒绝多余字段', () => {
    expect(
      tokenPayloadSchema.safeParse({
        sub: '00000000-0000-4000-8000-000000000001',
        role: 'admin',
        iat: 1,
        exp: 2,
        extra: 'bad',
      }).success,
    ).toBe(false);
  });
});

// ===========================================================================
// 契约测 · user schema 拆分（D5：userEntitySchema 含 password_hash / userSchema 输出不变）
// ===========================================================================
describe('契约测 · user schema 拆分（D5 / AC-F3-1）', () => {
  const baseUser = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'admin',
    email: 'admin@example.com',
    status: 'active' as const,
    department_id: null,
    created_at: '2026-07-02T00:00:00.000Z',
    updated_at: '2026-07-02T00:00:00.000Z',
    version: 0,
  };

  it('AC-F3-1: userSchema.strict() 拒绝含 password_hash 的对象（响应输出不含敏感字段，SEC-003a）', () => {
    expect(userSchema.safeParse({ ...baseUser, password_hash: 'salt.hash' }).success).toBe(false);
  });

  it('userSchema 接受不含 password_hash 的标准输出（向后兼容，既有测试零变更）', () => {
    expect(userSchema.safeParse(baseUser).success).toBe(true);
  });

  it('userEntitySchema 接受含 password_hash 的存储实体', () => {
    expect(userEntitySchema.safeParse({ ...baseUser, password_hash: 'salt.hash' }).success).toBe(true);
  });

  it('userEntitySchema 拒绝缺失 password_hash（必填，非 optional）', () => {
    expect(userEntitySchema.safeParse(baseUser).success).toBe(false);
  });

  it('userEntitySchema .strict 拒绝多余字段', () => {
    expect(userEntitySchema.safeParse({ ...baseUser, password_hash: 'salt.hash', extra: 'bad' }).success).toBe(false);
  });
});

// ===========================================================================
// 契约测 · createUserInputSchema（D6：password optional min(8)）
// ===========================================================================
describe('契约测 · createUserInputSchema（D6 password optional）', () => {
  it('接受 {email, name}（无 password，缺省时 service 生成临时密码，AC-F3-3）', () => {
    expect(createUserInputSchema.safeParse({ email: 'a@b.com', name: 'Alice' }).success).toBe(true);
  });

  it('接受 {email, name, password≥8}', () => {
    expect(createUserInputSchema.safeParse({ email: 'a@b.com', name: 'Alice', password: '12345678' }).success).toBe(true);
  });

  it('拒绝 password 短于 8 位（Q12 决策①）', () => {
    expect(createUserInputSchema.safeParse({ email: 'a@b.com', name: 'Alice', password: '123' }).success).toBe(false);
  });

  it('.strict 拒绝多余字段', () => {
    expect(createUserInputSchema.safeParse({ email: 'a@b.com', name: 'Alice', extra: 'bad' }).success).toBe(false);
  });
});

// ===========================================================================
// 契约测 · errorCodeSchema 含 4 AUTH 码（SSOT 派生 toContain，AI-005）
// ===========================================================================
describe('契约测 · errorCodeSchema 含 4 AUTH 码（SSOT 派生，AI-005）', () => {
  it('errorCodeSchema.options 含 INVALID_CREDENTIALS / TOKEN_INVALID / TOKEN_EXPIRED / TOKEN_REVOKED', () => {
    const allCodes = [...errorCodeSchema.options];
    expect(allCodes).toContain('INVALID_CREDENTIALS');
    expect(allCodes).toContain('TOKEN_INVALID');
    expect(allCodes).toContain('TOKEN_EXPIRED');
    expect(allCodes).toContain('TOKEN_REVOKED');
    // 既有码不被破坏
    expect(allCodes).toContain('UNAUTHORIZED');
    expect(allCodes).toContain('VALIDATION_ERROR');
  });

  it('errorCodeToHttpStatus: 4 AUTH 码全 401（PRD Q10）', () => {
    expect(errorCodeToHttpStatus.INVALID_CREDENTIALS).toBe(401);
    expect(errorCodeToHttpStatus.TOKEN_INVALID).toBe(401);
    expect(errorCodeToHttpStatus.TOKEN_EXPIRED).toBe(401);
    expect(errorCodeToHttpStatus.TOKEN_REVOKED).toBe(401);
    // UNAUTHORIZED 仍 401（复用，非新增）
    expect(errorCodeToHttpStatus.UNAUTHORIZED).toBe(401);
  });

  it('errorResponseSchema 接受 INVALID_CREDENTIALS 标准错误响应（不变，向后兼容）', () => {
    expect(errorResponseSchema.safeParse({ code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' }).success).toBe(true);
  });

  it('errorResponseSchema 接受 TOKEN_INVALID 含 current_version optional（不变）', () => {
    expect(
      errorResponseSchema.safeParse({ code: 'TOKEN_INVALID', message: 'token 无效' }).success,
    ).toBe(true);
  });

  it('errorResponseSchema .strict 拒绝多余字段', () => {
    expect(
      errorResponseSchema.safeParse({ code: 'TOKEN_EXPIRED', message: 'token 过期', extra: 'bad' }).success,
    ).toBe(false);
  });
});

// ===========================================================================
// 契约测 · audit 枚举须含 auth/login/logout/login_failed（AI-006 反向核实 · 断言级红）
// ---------------------------------------------------------------------------
// PRD AC-F1-6 要求 audit_log 落库 entityType='auth' action='login'/'login_failed'；
// PRD AC-F4-3 要求 action='logout'。但 contracts 的 auditLogEntityTypeSchema=['user','role','dept','notification']
// / auditLogActionSchema=['create','update','delete'] 当前不含这些值，Tech-Spec §5/§9 未列出此 contracts 联动。
// 本组断言以 SSOT 派生 toContain 表达需求：当前为断言级红，impl-writer / contracts 拥有者须补齐枚举
// （既有测试用 containment/遍历派生断言，扩展枚举不破坏既有测试，见 AI-006 反向核实报告）。
// ===========================================================================
describe('契约测 · audit 枚举须含 auth 域值（AI-006 反向核实）', () => {
  it('auditLogEntityTypeSchema 须含 "auth"（AC-F1-6/F4-3 的 entityType）', () => {
    expect([...auditLogEntityTypeSchema.options]).toContain('auth');
  });

  it('auditLogActionSchema 须含 "login"（AC-F1-6 成功）', () => {
    expect([...auditLogActionSchema.options]).toContain('login');
  });

  it('auditLogActionSchema 须含 "login_failed"（AC-F1-6 失败，防暴力破解审计依据）', () => {
    expect([...auditLogActionSchema.options]).toContain('login_failed');
  });

  it('auditLogActionSchema 须含 "logout"（AC-F4-3）', () => {
    expect([...auditLogActionSchema.options]).toContain('logout');
  });
});

// ===========================================================================
// 单测 · domain/auth signToken + verifyToken（D1 HMAC-SHA256 不透明 token）
// ===========================================================================
describe('单测 · domain/auth signToken + verifyToken', () => {
  const payload: TokenPayload = {
    sub: ADMIN_ID,
    role: 'admin',
    iat: 1700000000,
    exp: 1700003600,
  };

  it('signToken → verifyToken 往返：还原相同 payload', async () => {
    const token = signToken(payload, AUTH_SECRET);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(token).toContain('.');
    const result = verifyToken(token, AUTH_SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual(payload);
    }
  });

  it('token 结构 = base64url(payload).base64url(hmac)（两段，点分隔）', async () => {
    const token = signToken(payload, AUTH_SECRET);
    const parts = token.split('.');
    expect(parts.length).toBe(2);
    expect(parts[0]!.length).toBeGreaterThan(0);
    expect(parts[1]!.length).toBeGreaterThan(0);
  });

  it('verifyToken 伪造随机字符串 → { ok: false, errorCode: TOKEN_INVALID }', async () => {
    const result = verifyToken('totally-fake-token-string', AUTH_SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('TOKEN_INVALID');
    }
  });

  it('verifyToken 篡改签名段（替换第二段）→ TOKEN_INVALID', async () => {
    const token = signToken(payload, AUTH_SECRET);
    const parts = token.split('.');
    const tampered = `${parts[0]!}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    const result = verifyToken(tampered, AUTH_SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('TOKEN_INVALID');
    }
  });

  it('verifyToken 篡改 payload 段（替换第一段）→ TOKEN_INVALID', async () => {
    const token = signToken(payload, AUTH_SECRET);
    const parts = token.split('.');
    const tampered = `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.${parts[1]!}`;
    const result = verifyToken(tampered, AUTH_SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('TOKEN_INVALID');
    }
  });

  it('verifyToken 用错误 secret → TOKEN_INVALID（签名不匹配）', async () => {
    const token = signToken(payload, AUTH_SECRET);
    const result = verifyToken(token, 'wrong-secret');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('TOKEN_INVALID');
    }
  });

  it('verifyToken 不检查过期（G4 exp 由 buildCtx 负责）：过期但签名有效的 token → ok:true', async () => {
    // exp 在 1 小时前（已过期），但签名有效 → verifyToken 仍 ok（过期判定 G4 在 buildCtx 中间件，非 verifyToken 职责）
    const expiredPayload: TokenPayload = {
      sub: ADMIN_ID,
      role: 'admin',
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    };
    const token = signToken(expiredPayload, AUTH_SECRET);
    const result = verifyToken(token, AUTH_SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 验证过期判定逻辑可由调用方独立完成（buildCtx G4）：exp ≤ now 即过期
      const nowSec = Math.floor(Date.now() / 1000);
      expect(result.payload.exp).toBeLessThanOrEqual(nowSec);
    }
  });

  it('signToken 不同 payload 产生不同 token（含 sub/role/iat/exp）', async () => {
    const t1 = signToken(payload, AUTH_SECRET);
    const t2 = signToken({ ...payload, sub: '00000000-0000-4000-8000-000000000002' }, AUTH_SECRET);
    expect(t1).not.toBe(t2);
  });
});

// ===========================================================================
// 单测 · domain/auth hashPassword + verifyPassword（D2 scrypt salt.hash）
// ===========================================================================
describe('单测 · domain/auth hashPassword + verifyPassword（D2）', () => {
  it('AC-F3-2: hashPassword 输出为 salt.hash 格式（含点分隔，两段 base64，非明文）', async () => {
    const hash = hashPassword(ADMIN_PASSWORD);
    expect(typeof hash).toBe('string');
    expect(hash).toContain('.');
    const parts = hash.split('.');
    expect(parts.length).toBe(2);
    expect(parts[0]!.length).toBeGreaterThan(0); // salt
    expect(parts[1]!.length).toBeGreaterThan(0); // hash
    // 非明文：hash 不等于密码本身
    expect(hash).not.toBe(ADMIN_PASSWORD);
    expect(hash).not.toContain(ADMIN_PASSWORD);
  });

  it('hashPassword 每次产生不同 salt（随机性，相同密码 → 不同 hash）', async () => {
    const h1 = hashPassword(ADMIN_PASSWORD);
    const h2 = hashPassword(ADMIN_PASSWORD);
    expect(h1).not.toBe(h2); // salt 不同
  });

  it('AC-F3-4: verifyPassword 正确密码 → true', async () => {
    const hash = hashPassword(ADMIN_PASSWORD);
    expect(verifyPassword(ADMIN_PASSWORD, hash)).toBe(true);
  });

  it('AC-F3-4: verifyPassword 错误密码 → false', async () => {
    const hash = hashPassword(ADMIN_PASSWORD);
    expect(verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('verifyPassword 空密码 → false', async () => {
    const hash = hashPassword(ADMIN_PASSWORD);
    expect(verifyPassword('', hash)).toBe(false);
  });

  it('verifyPassword 对格式错误的 stored（无点分隔）→ false（不抛错）', async () => {
    expect(verifyPassword(ADMIN_PASSWORD, 'no-dot-just-string')).toBe(false);
  });
});

// ===========================================================================
// 行为 · AuthService.login 成功签发（AC-F1-1 unit level / AC-F2-6 Ctx 一致）
// ===========================================================================
describe('行为 · AuthService.login 成功签发', () => {
  it('AC-F1-1: 正确凭据 → {token, expires_at}，expires_at 为未来时间', async () => {
    const { authService } = await setupAuth();
    const result = await (authService as { login: (input: { email: string; password: string }, ctx: Ctx) => Promise<{ token: string; expires_at: string }> }).login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, anonCtx);
    expect(loginResultSchema.safeParse(result).success).toBe(true);
    expect(result.token.length).toBeGreaterThan(0);
    const now = Date.now();
    expect(new Date(result.expires_at).getTime()).toBeGreaterThan(now);
  });

  it('AC-F2-6: 登录返回的 token 经 verifyToken 解析后 sub/role 与用户一致（Ctx 来源切换不破坏 service）', async () => {
    const { authService } = await setupAuth();
    const result = await (authService as { login: (input: { email: string; password: string }, ctx: Ctx) => Promise<{ token: string; expires_at: string }> }).login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, anonCtx);
    const verified = verifyToken(result.token, AUTH_SECRET);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.sub).toBe(ADMIN_ID);
      expect(verified.payload.role).toBe('admin');
      // exp = iat + 3600（1 小时，Q6）
      expect(verified.payload.exp - verified.payload.iat).toBe(3600);
    }
  });

  it('AC-F5-3: seed 凭据 admin@example.com/admin123 可登录（unit 层 login 路径）', async () => {
    const { authService } = await setupAuth();
    const result = await (authService as { login: (input: { email: string; password: string }, ctx: Ctx) => Promise<{ token: string; expires_at: string }> }).login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, anonCtx);
    expect(loginResultSchema.safeParse(result).success).toBe(true);
  });
});

// ===========================================================================
// 行为 · AuthService.login 失败路径（AC-F1-2/F1-3/F1-4）
// ===========================================================================
describe('行为 · AuthService.login 失败路径', () => {
  it('AC-F1-2: 邮箱不存在 → INVALID_CREDENTIALS', async () => {
    const { authService } = await setupAuth();
    await captureAppError(
      (authService as { login: (input: { email: string; password: string }, ctx: Ctx) => Promise<unknown> }).login({ email: 'nobody@example.com', password: '12345678' }, anonCtx),
      'INVALID_CREDENTIALS',
    );
  });

  it('AC-F1-3: 密码错误 → INVALID_CREDENTIALS（与 AC-F1-2 同码）', async () => {
    const { authService } = await setupAuth();
    await captureAppError(
      (authService as { login: (input: { email: string; password: string }, ctx: Ctx) => Promise<unknown> }).login({ email: ADMIN_EMAIL, password: 'wrong-password' }, anonCtx),
      'INVALID_CREDENTIALS',
    );
  });

  it('AC-F1-2/F1-3: 邮箱不存在与密码错返回相同 message（防账号枚举，PRD Q9）', async () => {
    const { authService } = await setupAuth();
    const errEmailNotFound = await captureAppError(
      (authService as { login: (input: { email: string; password: string }, ctx: Ctx) => Promise<unknown> }).login({ email: 'nobody@example.com', password: '12345678' }, anonCtx),
      'INVALID_CREDENTIALS',
    );
    const errWrongPassword = await captureAppError(
      (authService as { login: (input: { email: string; password: string }, ctx: Ctx) => Promise<unknown> }).login({ email: ADMIN_EMAIL, password: 'wrong-password' }, anonCtx),
      'INVALID_CREDENTIALS',
    );
    // 同码同 message，不区分"邮箱不存在"与"密码错"
    expect(errEmailNotFound.code).toBe(errWrongPassword.code);
    expect(errEmailNotFound.message).toBe(errWrongPassword.message);
  });

  it('AC-F1-4: password 短于 8 位 → loginInputSchema.safeParse 失败（schema 层，非 INVALID_CREDENTIALS）', () => {
    // B1 守卫在 server.ts safeParse 阶段；service 层不接收非法 input。
    // 此处断言 schema 层拒绝（400 VALIDATION_ERROR），区别于 B2/B3 的 401 INVALID_CREDENTIALS。
    const r = loginInputSchema.safeParse({ email: ADMIN_EMAIL, password: '123' });
    expect(r.success).toBe(false);
  });
});

// ===========================================================================
// 行为 · AuthService.login 记审计（AC-F1-6）
// ===========================================================================
describe('行为 · AuthService.login 记审计（AC-F1-6）', () => {
  it('login 成功 → audit_log 落库 entityType=auth action=login', async () => {
    const { authService, auditRepo } = await setupAuth();
    await (authService as { login: (input: { email: string; password: string }, ctx: Ctx) => Promise<unknown> }).login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, anonCtx);
    const log = findAuditLog(auditRepo, { entityType: 'auth', action: 'login' });
    expect(log).toBeDefined();
    if (log) {
      expect(log.entity_id).toBe(ADMIN_ID);
      expect(log.operator_id).toBe(ADMIN_ID);
    }
  });

  it('login 失败 → audit_log 落库 action=login_failed（防暴力破解审计依据）', async () => {
    const { authService, auditRepo } = await setupAuth();
    try {
      await (authService as { login: (input: { email: string; password: string }, ctx: Ctx) => Promise<unknown> }).login({ email: ADMIN_EMAIL, password: 'wrong-password' }, anonCtx);
    } catch {
      // 预期抛 INVALID_CREDENTIALS
    }
    const log = findAuditLog(auditRepo, { action: 'login_failed' });
    expect(log).toBeDefined();
  });
});

// ===========================================================================
// 行为 · AuthService.logout（AC-F4-1/F4-3 + SEC-002）
// ===========================================================================
describe('行为 · AuthService.logout', () => {
  it('AC-F4-1: logout 成功 → token 入黑名单 + 返回 {success: true}', async () => {
    const { authService, tokenBlacklistRepo } = await setupAuth();
    const loginResult = await (authService as { login: (input: { email: string; password: string }, ctx: Ctx) => Promise<{ token: string; expires_at: string }> }).login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, anonCtx);
    expect((tokenBlacklistRepo as { has: (t: string) => boolean }).has(loginResult.token)).toBe(false);
    const result = await (authService as { logout: (token: string, ctx: Ctx) => Promise<{ success: true }> }).logout(loginResult.token, adminCtx);
    expect(logoutResultSchema.safeParse(result).success).toBe(true);
    expect(result.success).toBe(true);
    // token 已入黑名单
    expect((tokenBlacklistRepo as { has: (t: string) => boolean }).has(loginResult.token)).toBe(true);
  });

  it('AC-F4-3: logout → audit_log 落库 entityType=auth action=logout', async () => {
    const { authService, auditRepo } = await setupAuth();
    const loginResult = await (authService as { login: (input: { email: string; password: string }, ctx: Ctx) => Promise<{ token: string; expires_at: string }> }).login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, anonCtx);
    await (authService as { logout: (token: string, ctx: Ctx) => Promise<{ success: true }> }).logout(loginResult.token, adminCtx);
    const log = findAuditLog(auditRepo, { entityType: 'auth', action: 'logout' });
    expect(log).toBeDefined();
    if (log) {
      expect(log.operator_id).toBe(ADMIN_ID);
    }
  });

  it('SEC-002: logout 以非 admin ctx 调用 → FORBIDDEN（logout 路由 auth:admin，service 层 requireAdmin）', async () => {
    const { authService } = await setupAuth();
    const loginResult = await (authService as { login: (input: { email: string; password: string }, ctx: Ctx) => Promise<{ token: string; expires_at: string }> }).login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, anonCtx);
    await captureAppError((authService as { logout: (token: string, ctx: Ctx) => Promise<unknown> }).logout(loginResult.token, userCtx), 'FORBIDDEN');
  });
});

// ===========================================================================
// 行为 · createUser password_hash 存储（AC-F3-2/F3-3）
// ===========================================================================
describe('行为 · createUser password_hash 存储（AC-F3-2/F3-3）', () => {
  it('AC-F3-2: createUser 带 password → 存储 password_hash 为 salt.hash 格式（非明文）', async () => {
    const { userService, userRepo } = await setupAuth();
    const result = await userService.create(
      { email: 'newuser@example.com', name: 'New', password: 'supersecret' },
      adminCtx,
    );
    const stored = userRepo.findById(result.entity.id) as unknown as { password_hash?: string } | undefined;
    expect(stored?.password_hash).toBeDefined();
    expect(stored!.password_hash).toContain('.');
    expect(stored!.password_hash).not.toBe('supersecret');
  });

  it('AC-F3-3: createUser 缺省 password → service 生成临时密码 → 存储 password_hash 非空（用户可用临时密码登录）', async () => {
    const { userService, userRepo, auditRepo } = await setupAuth();
    const result = await userService.create(
      { email: 'tempuser@example.com', name: 'Temp' },
      adminCtx,
    );
    const stored = userRepo.findById(result.entity.id) as unknown as { password_hash?: string } | undefined;
    // 缺省 password 时 service 生成临时密码并哈希存储（非空、salt.hash 格式）
    expect(stored?.password_hash).toBeDefined();
    expect(stored!.password_hash!.length).toBeGreaterThan(0);
    expect(stored!.password_hash).toContain('.');
    // 记审计日志（create 动作）
    const log = findAuditLog(auditRepo, { entityId: result.entity.id, action: 'create' });
    expect(log).toBeDefined();
  });

  it('AC-F3-1: createUser 返回的 entity 不含 password_hash（响应输出 schema 1:1，SEC-003a）', async () => {
    const { userService } = await setupAuth();
    const result = await userService.create(
      { email: 'nohash@example.com', name: 'NoHash', password: 'supersecret' },
      adminCtx,
    );
    // userSchema.strict() 拒绝 password_hash → 返回的 entity 须可被 userSchema 解析
    expect(userSchema.safeParse(result.entity).success).toBe(true);
    expect((result.entity as unknown as { password_hash?: string }).password_hash).toBeUndefined();
  });
});

// ===========================================================================
// 辅助 · ctx 形状（保留 anonCtx/userCtx 引用，避免未用告警）
// ===========================================================================
describe('辅助 · ctx 形状', () => {
  it('anonCtx/userCtx 角色字段符合预期', () => {
    expect(anonCtx.user.role).toBe('user');
    expect(userCtx.user.role).toBe('user');
    expect(adminCtx.user.role).toBe('admin');
  });
});
