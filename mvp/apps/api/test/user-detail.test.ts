// apps/api/test/user-detail.test.ts —— ③类新增 GET /v1/users/:id 详情端点单测+契约测+行为测
//                                  （TECH-USER-DETAIL-WIRE-001 §9 T2，消除 R12 D19 端点 gap）
//
// 覆盖 AC（PRD-USER-DETAIL-WIRE-001）：
//   - AC-G1（查询成功：admin getById 已存在用户 → userSchema 实体）
//   - AC-G2（不存在 → USER_NOT_FOUND 404）
//   - AC-G3（id 非 uuid → VALIDATION_ERROR 400，safeParse 拒绝）
//   - AC-G6（非 admin → FORBIDDEN 403，SEC-002 service 层 requireAdmin）
//   - AC-G7 契约层（detailEtag 基于 version 生成强 ETag "version"）
//   - AC-G12（userSchema 1:1 + .strict() 拒绝 password_hash / 多余字段，SEC-003a）
//   - AC-G13（User 类型经 contracts 派生可消费，future-ready）
//   - AC-W7 契约层（errorResponseSchema 字段名 code，非 error；D10 已消除）
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由，AI-002）：
//   - 沿用 role.test.ts 模式：setup() 内建 db+repo+service+router，callProc 模拟 router 层执行（safeParse+handler），
//     expectAppError 断言 AppError + ErrorCode。
//   - 期望「断言级红」（AI-002）：以下符号尚未由 impl-writer 落地 → tsc 报「预期导入红」，
//     待 impl-writer 添加后转为断言级红（service.getById / router.detail 调用即抛 TypeError 或行为不符）：
//       1. userDetailProcedureInputSchema（来自 ../src/router/user.js，未导出）
//       2. router.detail（UserRouter 类型未声明 detail 属性）
//       3. service.getById（UserService 类未实现 getById 方法）
//   - SSOT 派生（AI-005）：USER_NOT_FOUND/VALIDATION_ERROR/FORBIDDEN 用 [...errorCodeSchema.options].toContain 断言，
//     禁硬编码跨域枚举（避免 contracts 扩枚举时漏改）。
//   - SEC-003a：测试中不 console.log/记录 password_hash 字符串；password_hash 仅作为 .strict() 拒绝样本验证。
//   - 不修改实现代码（impl-writer 阶段）+ 不修改测试断言外的测试 setup。
import { describe, it, expect } from 'vitest';
import {
  userSchema,
  errorResponseSchema,
  errorCodeSchema,
  type ErrorCode,
  type User,
} from '@admin/contracts';
import { UserRepository } from '../src/repository/user.js';
import { UserService } from '../src/service/user.js';
import {
  createUserRouter,
  userDetailProcedureInputSchema,
  type Procedure,
} from '../src/router/user.js';
import { AppError, errorCodeToHttpStatus } from '../src/errors.js';
import { detailEtag } from '../src/etag.js';
import { createTestDb } from './helpers/db.js';
import type { Ctx } from '../src/context.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const USER_ROLE_ID = '00000000-0000-4000-8000-000000000002';
const SEED_TS = '2020-01-01T00:00:00.000Z';
const MISSING_ID = '00000000-0000-4000-8000-000000000099';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };
const userCtx: Ctx = { user: { id: USER_ROLE_ID, role: 'user' } };

/** SSOT 派生（AI-005）：errorCodeSchema 全集，禁硬编码跨域枚举子集。 */
const ALL_ERROR_CODES: ErrorCode[] = [...errorCodeSchema.options];

function setup(): {
  repo: UserRepository;
  service: UserService;
  router: ReturnType<typeof createUserRouter>;
} {
  const db = createTestDb();
  const repo = new UserRepository(db);
  repo.insert({
    id: ADMIN_ID,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    version: 0,
    password_hash: 'test-hash-placeholder',
    created_at: SEED_TS,
    updated_at: SEED_TS,
  });
  const service = new UserService(repo);
  const router = createUserRouter(service);
  return { repo, service, router };
}

/** 模拟 router 层执行：safeParse 失败统一转 VALIDATION_ERROR，成功则调 handler。 */
async function callProc<I, O>(proc: Procedure<I, O>, raw: unknown, ctx: Ctx): Promise<O> {
  const parsed = proc.input.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', parsed.error.message);
  }
  return proc.handler(parsed.data, ctx);
}

/** 断言 Promise 抛 AppError 且 code 匹配（断言级红：未实现 → TypeError 也走 reject 分支，断言失败可见）。 */
async function expectAppError(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  const err = await promise.then(
    () => {
      throw new Error(`期望抛出 ${code}，但 Promise 已 resolve`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  if (err instanceof AppError) {
    expect(err.code).toBe(code);
  }
}

// ---------------------------------------------------------------------------
// 1. 单测 · service getById（AC-G1 / G2 / G6）
// ---------------------------------------------------------------------------
describe('单测 · service getById', () => {
  it('AC-G1: admin getById 已存在用户 → 返回 userSchema 实体（含全部字段）', async () => {
    const { service } = setup();
    const result = await service.getById(ADMIN_ID, adminCtx);
    expect(result.id).toBe(ADMIN_ID);
    expect(result.name).toBe('admin');
    expect(result.email).toBe('admin@example.com');
    expect(result.status).toBe('active');
    expect(result.version).toBe(0);
    expect(result.department_id).toBeNull();
    expect(() => userSchema.parse(result)).not.toThrow();
  });

  it('AC-G2: admin getById 不存在用户 → USER_NOT_FOUND（404，错误码 SSOT 派生）', async () => {
    const { service } = setup();
    await expectAppError(service.getById(MISSING_ID, adminCtx), 'USER_NOT_FOUND');
    expect(ALL_ERROR_CODES).toContain('USER_NOT_FOUND');
  });

  it('AC-G6: 非 admin 调 getById → FORBIDDEN（403，SEC-002 service 层 requireAdmin）', async () => {
    const { service } = setup();
    await expectAppError(service.getById(ADMIN_ID, userCtx), 'FORBIDDEN');
    expect(ALL_ERROR_CODES).toContain('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// 2. 单测 · repository findById（user-detail 落点复用，TECH-USER-DETAIL-WIRE-001 §1.2 核验四）
// ---------------------------------------------------------------------------
describe('单测 · repository findById（user-detail 复用）', () => {
  it('findById 已存在 → 返回 UserEntity（含 password_hash 存储态）', () => {
    const { repo } = setup();
    const found = repo.findById(ADMIN_ID);
    expect(found).toBeDefined();
    expect(found?.id).toBe(ADMIN_ID);
    expect(found?.email).toBe('admin@example.com');
  });

  it('findById 不存在 → 返回 undefined（service 层据此抛 USER_NOT_FOUND）', () => {
    const { repo } = setup();
    expect(repo.findById(MISSING_ID)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. 契约测 · 出参 schema 匹配（AC-G1 / G12 / G13）
// ---------------------------------------------------------------------------
describe('契约测 · 出参 schema 匹配', () => {
  it('AC-G1: detail procedure 返回值匹配 userSchema（.strict 通过）', async () => {
    const { router } = setup();
    const result = await callProc(router.detail, { id: ADMIN_ID }, adminCtx);
    expect(() => userSchema.parse(result)).not.toThrow();
    expect(result.id).toBe(ADMIN_ID);
  });

  it('AC-G12: detail 返回不含 password_hash（SEC-003a 输出 schema 1:1，剥离存储态敏感字段）', async () => {
    const { router } = setup();
    const result = await callProc(router.detail, { id: ADMIN_ID }, adminCtx);
    expect(result).not.toHaveProperty('password_hash');
    // userSchema.strict() 拒绝含 password_hash 的样本（多余字段）
    expect(() => userSchema.parse({ ...result, password_hash: 'should-be-stripped' })).toThrow();
  });

  it('AC-G12: userSchema .strict() 拒绝任意多余字段（无业务意义的别名违背 ARCH-002）', () => {
    const validSample: User = {
      id: ADMIN_ID,
      name: 'admin',
      email: 'admin@example.com',
      status: 'active',
      department_id: null,
      created_at: SEED_TS,
      updated_at: SEED_TS,
      version: 0,
    };
    expect(() => userSchema.parse(validSample)).not.toThrow();
    expect(() => userSchema.parse({ ...validSample, extra: 'x' })).toThrow();
    expect(() => userSchema.parse({ ...validSample, password_hash: 'leak' })).toThrow();
  });

  it('AC-G13: User 类型可被消费（future-ready，前端 future 轮次 getUser(id) 可消费此 contracts 派生类型）', async () => {
    const { router } = setup();
    // 静态保证：callProc 返回值满足 User 类型（contracts z.infer 派生，AC-ARCH-2，禁止手写 TS 类型副本）
    const result: User = await callProc(router.detail, { id: ADMIN_ID }, adminCtx);
    expect(result.id).toBe(ADMIN_ID);
    // 派生类型可构造合法样本（无手写副本漂移风险）
    const sample: User = {
      id: ADMIN_ID,
      name: 'admin',
      email: 'admin@example.com',
      status: 'active',
      department_id: null,
      created_at: SEED_TS,
      updated_at: SEED_TS,
      version: 0,
    };
    expect(sample.id).toBe(ADMIN_ID);
  });
});

// ---------------------------------------------------------------------------
// 4. 契约测 · 入参 safeParse（AC-G3）
// ---------------------------------------------------------------------------
describe('契约测 · 入参 safeParse', () => {
  it('AC-G3: userDetailProcedureInputSchema.safeParse id 非 uuid → 拒绝', () => {
    expect(userDetailProcedureInputSchema.safeParse({ id: 'not-uuid' }).success).toBe(false);
  });

  it('AC-G3: userDetailProcedureInputSchema.safeParse id 合法 uuid → 通过', () => {
    expect(userDetailProcedureInputSchema.safeParse({ id: ADMIN_ID }).success).toBe(true);
  });

  it('AC-G3: userDetailProcedureInputSchema.safeParse 缺失 id → 拒绝', () => {
    expect(userDetailProcedureInputSchema.safeParse({}).success).toBe(false);
  });

  it('AC-G3: userDetailProcedureInputSchema.safeParse 多余字段 → 拒绝（.strict）', () => {
    expect(userDetailProcedureInputSchema.safeParse({ id: ADMIN_ID, extra: 'x' }).success).toBe(false);
  });

  it('AC-G3: router.detail 调用 id 非 uuid → VALIDATION_ERROR（safeParse 失败转 VALIDATION_ERROR）', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.detail, { id: 'not-uuid' }, adminCtx), 'VALIDATION_ERROR');
    expect(ALL_ERROR_CODES).toContain('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// 5. 边界 · F1 detail（AC-G1 / G2 / G6）
// ---------------------------------------------------------------------------
describe('边界 · F1 detail', () => {
  it('AC-G1: detail 已存在用户 → 返回 name/email/status/version', async () => {
    const { router } = setup();
    const result = await callProc(router.detail, { id: ADMIN_ID }, adminCtx);
    expect(result.name).toBe('admin');
    expect(result.email).toBe('admin@example.com');
    expect(result.status).toBe('active');
    expect(result.version).toBe(0);
  });

  it('AC-G1: detail 跨域字段 department_id 可读（null 表示未归属部门，TECH-DEPT-001 D1 联动）', async () => {
    const { router } = setup();
    const result = await callProc(router.detail, { id: ADMIN_ID }, adminCtx);
    expect(result.department_id).toBeNull();
  });

  it('AC-G1: detail 返回 created_at/updated_at（datetime 字符串，审计可追溯）', async () => {
    const { router } = setup();
    const result = await callProc(router.detail, { id: ADMIN_ID }, adminCtx);
    expect(typeof result.created_at).toBe('string');
    expect(typeof result.updated_at).toBe('string');
  });

  it('AC-G2: detail 不存在 → USER_NOT_FOUND', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.detail, { id: MISSING_ID }, adminCtx), 'USER_NOT_FOUND');
  });

  it('AC-G6: detail 非 admin → FORBIDDEN', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.detail, { id: ADMIN_ID }, userCtx), 'FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// 6. 权限 · SEC-002（AC-G6，service 层 requireAdmin）
// ---------------------------------------------------------------------------
describe('权限 · SEC-002 detail 非 admin → FORBIDDEN', () => {
  it('AC-G6: 非 admin 调 detail → FORBIDDEN（service 层 requireAdmin 拒绝）', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.detail, { id: ADMIN_ID }, userCtx), 'FORBIDDEN');
  });

  it('AC-G6 优先于 AC-G2: 非 admin + 不存在 id → FORBIDDEN（requireAdmin 先于 findById）', async () => {
    const { service } = setup();
    await expectAppError(service.getById(MISSING_ID, userCtx), 'FORBIDDEN');
  });

  it('AC-G6: 鉴权守卫执行顺序 = buildCtx(Bearer 验签 G1-G5) → safeParse → handler(requireAdmin)（D4，单元层验证 service requireAdmin）', async () => {
    // 单元层验证 service.getById 内 requireAdmin 先于 findById（401/403 鉴权层在 HTTP embedding 测试 AC-G4/G5 验证）
    const { service } = setup();
    await expectAppError(service.getById(ADMIN_ID, userCtx), 'FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// 7. 状态机 · 守卫序列顺序（AC-G2 / G6）
// ---------------------------------------------------------------------------
describe('状态机 · 守卫序列顺序', () => {
  it('getById 守卫：requireAdmin(B3) → findById(B5)，admin+不存在 → USER_NOT_FOUND', async () => {
    const { service } = setup();
    await expectAppError(service.getById(MISSING_ID, adminCtx), 'USER_NOT_FOUND');
  });

  it('getById 守卫：requireAdmin(B3) 先于 findById(B5)，非 admin+不存在 → FORBIDDEN', async () => {
    const { service } = setup();
    await expectAppError(service.getById(MISSING_ID, userCtx), 'FORBIDDEN');
  });

  it('router.detail 守卫：safeParse 先于 handler，id 非 uuid + 非 admin → VALIDATION_ERROR（safeParse 失败优先）', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.detail, { id: 'not-uuid' }, userCtx), 'VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// 8. SSOT 派生断言（AI-005，禁硬编码跨域枚举）
// ---------------------------------------------------------------------------
describe('SSOT 派生断言 · errorCodeSchema 全集 + errors.ts 映射', () => {
  it('AI-005: USER_NOT_FOUND ∈ errorCodeSchema.options（SSOT 派生，禁硬编码）', () => {
    expect(ALL_ERROR_CODES).toContain('USER_NOT_FOUND');
  });

  it('AI-005: VALIDATION_ERROR ∈ errorCodeSchema.options', () => {
    expect(ALL_ERROR_CODES).toContain('VALIDATION_ERROR');
  });

  it('AI-005: FORBIDDEN ∈ errorCodeSchema.options', () => {
    expect(ALL_ERROR_CODES).toContain('FORBIDDEN');
  });

  it('AI-005: USER_NOT_FOUND 映射 404（errors.ts errorCodeToHttpStatus 联动 SSOT 一致）', () => {
    expect(errorCodeToHttpStatus.USER_NOT_FOUND).toBe(404);
    expect(errorCodeToHttpStatus.VALIDATION_ERROR).toBe(400);
    expect(errorCodeToHttpStatus.FORBIDDEN).toBe(403);
  });

  it('AI-005: errorCodeToHttpStatus 为 Record<ErrorCode, number> 穷举映射（新增码须补齐，无遗漏）', () => {
    // SSOT 一致性：每个 errorCodeSchema 枚举值都须有 HTTP 映射（防止 contracts 扩枚举时漏改 errors.ts）
    for (const code of ALL_ERROR_CODES) {
      expect(errorCodeToHttpStatus[code]).toBeDefined();
      expect(typeof errorCodeToHttpStatus[code]).toBe('number');
      expect(errorCodeToHttpStatus[code]).toBeGreaterThanOrEqual(400);
      expect(errorCodeToHttpStatus[code]).toBeLessThan(600);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. ETag 契约 · detailEtag 基于 version（AC-G7 契约层，HTTP 层验证见 embedding 测试）
// ---------------------------------------------------------------------------
describe('ETag 契约 · detailEtag 基于 version（AC-G7）', () => {
  it('AC-G7: detailEtag(getById 返回 user v=0) → "\\"0\\""（强 ETag，RFC 7232 引号格式）', async () => {
    const { router } = setup();
    const result = await callProc(router.detail, { id: ADMIN_ID }, adminCtx);
    const etag = detailEtag(result);
    expect(etag).toBe('"0"');
    expect(etag).toMatch(/^"\d+"$/);
  });

  it('AC-G7: detailEtag(user v=5) → "\\"5\\""', () => {
    const sample: User = {
      id: ADMIN_ID,
      name: 'admin',
      email: 'admin@example.com',
      status: 'active',
      department_id: null,
      created_at: SEED_TS,
      updated_at: SEED_TS,
      version: 5,
    };
    expect(detailEtag(sample)).toBe('"5"');
  });

  it('AC-G7: detailEtag 缺失 version → 回退 "\\"0\\""（防御性，detailEtag 实现语义）', () => {
    expect(detailEtag({})).toBe('"0"');
  });
});

// ---------------------------------------------------------------------------
// 10. wire 契约 · errorResponseSchema 字段名 code（AC-W7 契约层，D10 已消除）
// ---------------------------------------------------------------------------
describe('wire 契约 · errorResponseSchema 字段名 code（AC-W7，D10 已消除）', () => {
  it('AC-W7: errorResponseSchema.safeParse 接受 {code, message}（字段名 code，非 error）', () => {
    const parsed = errorResponseSchema.safeParse({ code: 'USER_NOT_FOUND', message: '用户不存在' });
    expect(parsed.success).toBe(true);
  });

  it('AC-W7: errorResponseSchema .strict() 拒绝旧字段名 error（D10 已消除，wire 字段名对齐 code）', () => {
    // 旧 wire 适配 {error: ...} 现已被 .strict() 拒绝（contracts SSOT 强约束）
    const parsed = errorResponseSchema.safeParse({ error: 'USER_NOT_FOUND', message: '用户不存在' });
    expect(parsed.success).toBe(false);
  });

  it('AC-W7: errorResponseSchema 接受 current_version 可选字段（VERSION_CONFLICT 409 重试链，D9 [约束]）', () => {
    const parsed = errorResponseSchema.safeParse({
      code: 'VERSION_CONFLICT',
      message: '版本冲突',
      current_version: 5,
    });
    expect(parsed.success).toBe(true);
  });

  it('AC-W7: errorResponseSchema.code ∈ errorCodeSchema.options（SSOT 派生，code 字段不可为非枚举值）', () => {
    // 合法枚举值通过
    expect(errorResponseSchema.safeParse({ code: 'USER_NOT_FOUND', message: 'x' }).success).toBe(true);
    // 非枚举值拒绝（如 NOT_FOUND/INTERNAL_ERROR 是 client fallback，非 contracts 码，D7）
    expect(errorResponseSchema.safeParse({ code: 'NOT_FOUND', message: 'x' }).success).toBe(false);
    expect(errorResponseSchema.safeParse({ code: 'INTERNAL_ERROR', message: 'x' }).success).toBe(false);
  });
});
