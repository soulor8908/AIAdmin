// apps/api/test/audit.test.ts —— 测试先行（AI-002，test-writer 先于 impl-writer 产出）
// 覆盖 Tech-Spec TECH-AUDIT-001 测试矩阵五类：
//   1. 单测 · domain 常量 + redactEmail 纯函数 + repository append-only + service 裁决
//   2. 契约测 · 出参 schema 匹配（.strict）+ 入参 safeParse + redactedEmailSchema 校验
//   3. 边界 · F1 旁路写入 / F2 列表查询 / F3 PII 脱敏 / F4 append-only（B1-B4，B4 预留不触发）
//   4. 权限 · 非 admin 调 list → FORBIDDEN；SEC-003 出参 .strict 不夹带 PII；SEC-001 procedure 元数据
//   5. 状态机 · append-only 不可变 + list 守卫序列顺序 B1→B2/B3 + F1 旁路闭环
//
// 设计说明（impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由）：
//   - AuditLogRepository 构造时 **不 seed** 任何内置日志（空起步）。
//   - AuditLogService 构造签名：`new AuditLogService(auditRepo)`；list 入口 requireAdmin(ctx)。
//   - AuditLogRepository 方法：
//       insert(log: AuditLog): AuditLog                                       // append-only，仅追加
//       list(opts: AuditLogListOptions): { items: AuditLog[]; total: number } // 过滤+分页+按 operated_at 倒序
//       **不暴露 update / delete 方法**（append-only 编译期保障，F4）
//   - AuditLogListOptions：{ page; pageSize; operated_from?; operated_to?; operator_id?; entity_type? }
//   - AuditLogService 方法：
//       list(query: ListAuditLogQuery, ctx): Promise<AuditLogListResult>      // 入口 requireAdmin；返回脱敏 items
//       record(input: AuditLogRecordInput, ctx): Promise<AuditLog>            // 旁路调用，权限校验在调用方
//   - AuditLogRecordInput：{ operator_id; operator_name; entity_type; entity_id; action; operated_at; before; after }
//   - record 返回存储态 AuditLog（before/after 含原 PII）；list 返回脱敏 items（redactedAuditLogSchema）。
//   - router 导出：createAuditRouter / AuditProcedure 类型；list procedure 复用 contracts 的 listAuditLogQuerySchema。
//   - AuditProcedure<I, O> = Procedure<I, O> & { permission: 'audit:read' }（SEC-001 元数据）。
//   - domain/audit.ts 导出 redactEmail + AUDIT_LOG_RETENTION_DAYS（ARCH-002：contracts 不导出函数）。
//   - redactEmail 边界：正常→ab***@example.com；local 恰好 2 字符→ab***@example.com；
//       local < 2 字符 / 无 @ / 首个 @ 在 <2 位置 → 原样返回（advisory）。
//   - 守卫顺序（先到先返）：list: B1（Zod）→ B2/B3（鉴权）→ 过滤 → 倒序 → 分页 → 脱敏 → 返回。
//       空结果 items=[]/total=0/totalPages=0（不触发 B4 AUDIT_LOG_NOT_FOUND）。
import { describe, it, expect } from 'vitest';
import {
  auditLogSchema,
  auditLogListResultSchema,
  auditLogEntityTypeSchema,
  auditLogActionSchema,
  redactedAuditLogSchema,
  redactedEmailSchema,
  listAuditLogQuerySchema,
  permissionCodeSchema,
  changeFieldSchema,
  piiFieldRegistrySchema,
  type ErrorCode,
  type AuditLog,
  type ListAuditLogQuery,
  type AuditLogListResult,
  type ChangeField,
} from '@admin/contracts';
import { AuditLogRepository } from '../src/repository/audit.js';
import { AuditLogService } from '../src/service/audit.js';
import { createAuditRouter, type AuditProcedure } from '../src/router/audit.js';
import {
  redactEmail,
  AUDIT_LOG_RETENTION_DAYS,
  markPii,
  PII_FIELD_REGISTRY,
} from '../src/domain/audit.js';
import { AppError } from '../src/errors.js';
import type { Ctx } from '../src/context.js';
import type { Procedure } from '../src/router/user.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const PLAIN_USER_ID = '00000000-0000-4000-8000-000000000002';
const SEED_TS = '2020-01-01T00:00:00.000Z';
const MISSING_ID = '00000000-0000-4000-8000-000000000099';

const adminCtx: Ctx = { user: { id: ADMIN_ID, role: 'admin' } };
const userCtx: Ctx = { user: { id: PLAIN_USER_ID, role: 'user' } };

function setup(): {
  auditRepo: AuditLogRepository;
  service: AuditLogService;
  router: ReturnType<typeof createAuditRouter>;
} {
  const auditRepo = new AuditLogRepository();
  const service = new AuditLogService(auditRepo);
  const router = createAuditRouter(service);
  return { auditRepo, service, router };
}

/** 从 ChangeField[] 中按字段名取 value（D5 结构化访问辅助）。 */
function fieldValue(fields: ChangeField[], name: string): unknown {
  return fields.find((f) => f.field === name)?.value;
}

function makeLog(i: number, overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: `30000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    operator_id: ADMIN_ID,
    operator_name: 'admin',
    entity_type: 'user',
    entity_id: `00000000-0000-4000-8000-${String(i + 1000).padStart(12, '0')}`,
    action: 'create',
    operated_at: `2024-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
    before: [],
    after: markPii('user', [
      { field: 'email', value: 'abcdef@example.com', pii: false },
      { field: 'name', value: `user${i}`, pii: false },
    ]),
    created_at: SEED_TS,
    ...overrides,
  };
}

async function callProc<I, O>(proc: Procedure<I, O>, raw: unknown, ctx: Ctx): Promise<O> {
  const parsed = proc.input.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', parsed.error.message);
  }
  return proc.handler(parsed.data, ctx);
}

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
// 1. 单测 · domain 常量 + redactEmail 纯函数 + repository append-only + service 裁决
// ---------------------------------------------------------------------------
describe('单测 · domain 常量', () => {
  it('AUDIT_LOG_RETENTION_DAYS === 90（PRD Q6 保留期，清理任务本期不实现）', () => {
    expect(AUDIT_LOG_RETENTION_DAYS).toBe(90);
  });
});

describe('单测 · redactEmail 纯函数（domain 层）', () => {
  it('正常邮箱：redactEmail("abcdef@example.com") === "ab***@example.com"', () => {
    expect(redactEmail('abcdef@example.com')).toBe('ab***@example.com');
  });

  it('local 恰好 2 字符：redactEmail("ab@example.com") === "ab***@example.com"', () => {
    expect(redactEmail('ab@example.com')).toBe('ab***@example.com');
  });

  it('local < 2 字符：原样返回（advisory 边缘场景）', () => {
    expect(redactEmail('a@example.com')).toBe('a@example.com');
  });

  it('无 @：原样返回（indexOf=-1 < 2，advisory 边缘场景）', () => {
    expect(redactEmail('no-at-sign')).toBe('no-at-sign');
  });

  it('多 @ 且首个 @ 在 < 2 位置：原样返回（advisory 边缘场景）', () => {
    expect(redactEmail('a@b@example.com')).toBe('a@b@example.com');
  });

  it('redactEmail 输出可被 redactedEmailSchema 解析（SEC-003b 契约对齐）', () => {
    const redacted = redactEmail('abcdef@example.com');
    expect(redactedEmailSchema.safeParse(redacted).success).toBe(true);
  });
});

describe('单测 · PII 清单（D6：shape SSOT 在 contracts，data SSOT 在 domain）', () => {
  it('PII_FIELD_REGISTRY 经 piiFieldRegistrySchema.parse 校验通过（shape SSOT 对齐）', () => {
    expect(() => piiFieldRegistrySchema.parse(PII_FIELD_REGISTRY)).not.toThrow();
  });

  it('PII_FIELD_REGISTRY 本期 = { user: Set(["email"]) }（D6 data SSOT）', () => {
    expect(PII_FIELD_REGISTRY.user).toBeInstanceOf(Set);
    expect([...(PII_FIELD_REGISTRY.user ?? [])]).toEqual(['email']);
  });

  it('markPii("user", [...]) → email 项 pii=true、name 项 pii=false（D6 辅助函数）', () => {
    const marked = markPii('user', [
      { field: 'email', value: 'x@example.com', pii: false },
      { field: 'name', value: 'y', pii: false },
    ]);
    expect(marked.find((f) => f.field === 'email')?.pii).toBe(true);
    expect(marked.find((f) => f.field === 'name')?.pii).toBe(false);
  });

  it('markPii("role", [...]) → 全部 pii=false（role 本期无 PII 字段）', () => {
    const marked = markPii('role', [
      { field: 'name', value: 'r', pii: false },
      { field: 'permission_codes', value: ['user:read'], pii: false },
    ]);
    for (const f of marked) {
      expect(f.pii).toBe(false);
    }
  });

  it('markPii 不改原数组项的 field/value，仅覆盖 pii 标记', () => {
    const input = [
      { field: 'email', value: 'a@b.com', pii: false },
      { field: 'status', value: 'active', pii: false },
    ];
    const marked = markPii('user', input);
    expect(marked).toHaveLength(2);
    expect(marked[0]!.field).toBe('email');
    expect(marked[0]!.value).toBe('a@b.com');
    expect(marked[1]!.field).toBe('status');
    expect(marked[1]!.value).toBe('active');
  });
});

describe('契约测 · changeFieldSchema（D5：{field, value, pii}）', () => {
  it('合法样本通过：{field, value, pii} 三字段齐全', () => {
    expect(
      changeFieldSchema.safeParse({ field: 'email', value: 'a@b.com', pii: true }).success,
    ).toBe(true);
  });

  it('value 为标量/null/同类型标量数组均通过（Q18）', () => {
    for (const value of ['s', 1, true, null, ['a', 'b'], [1, 2], [true, false]]) {
      expect(
        changeFieldSchema.safeParse({ field: 'f', value, pii: false }).success,
      ).toBe(true);
    }
  });

  it('缺 pii 字段被拒绝（.strict + 必填）', () => {
    expect(
      changeFieldSchema.safeParse({ field: 'email', value: 'a@b.com' }).success,
    ).toBe(false);
  });

  it('value 为对象被拒绝（Q18 不支持嵌套对象）', () => {
    expect(
      changeFieldSchema.safeParse({ field: 'f', value: { nested: 1 }, pii: false }).success,
    ).toBe(false);
  });

  it('value 为异构数组被拒绝（同类型标量数组，Q18）', () => {
    expect(
      changeFieldSchema.safeParse({ field: 'f', value: ['a', 1], pii: false }).success,
    ).toBe(false);
  });

  it('.strict：多余字段被拒绝（SEC-003a）', () => {
    expect(
      changeFieldSchema.safeParse({ field: 'f', value: 'v', pii: false, extra: 1 }).success,
    ).toBe(false);
  });

  it('field 为空字符串被拒绝（min 1）', () => {
    expect(
      changeFieldSchema.safeParse({ field: '', value: 'v', pii: false }).success,
    ).toBe(false);
  });
});

describe('单测 · repository append-only（内存）', () => {
  it('初始化为空（无内置 audit seed）：list 返回 items=[] total=0', () => {
    const repo = new AuditLogRepository();
    const result = repo.list({ page: 1, pageSize: 20 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('insert 后 list 可查回（按 id 一致）', () => {
    const repo = new AuditLogRepository();
    const log = makeLog(1);
    repo.insert(log);
    const result = repo.list({ page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(log.id);
  });

  it('insert 返回写入的 log（值一致）', () => {
    const repo = new AuditLogRepository();
    const log = makeLog(2);
    const inserted = repo.insert(log);
    expect(inserted).toEqual(log);
  });

  it('list 按 operated_at 倒序排列（最新优先）', () => {
    const repo = new AuditLogRepository();
    repo.insert(makeLog(1, { operated_at: '2024-01-01T10:00:00.000Z' }));
    repo.insert(makeLog(2, { operated_at: '2024-01-05T10:00:00.000Z' }));
    repo.insert(makeLog(3, { operated_at: '2024-01-03T10:00:00.000Z' }));
    const result = repo.list({ page: 1, pageSize: 20 });
    expect(result.items[0]!.operated_at).toBe('2024-01-05T10:00:00.000Z');
    expect(result.items[1]!.operated_at).toBe('2024-01-03T10:00:00.000Z');
    expect(result.items[2]!.operated_at).toBe('2024-01-01T10:00:00.000Z');
  });

  it('list 按 operated_from 闭区间过滤（含边界）', () => {
    const repo = new AuditLogRepository();
    repo.insert(makeLog(1, { operated_at: '2024-01-01T10:00:00.000Z' }));
    repo.insert(makeLog(2, { operated_at: '2024-01-02T10:00:00.000Z' }));
    repo.insert(makeLog(3, { operated_at: '2024-01-03T10:00:00.000Z' }));
    const result = repo.list({
      page: 1,
      pageSize: 20,
      operated_from: '2024-01-02T10:00:00.000Z',
    });
    expect(result.total).toBe(2);
    expect(result.items.map((l: AuditLog) => l.operated_at)).toEqual([
      '2024-01-03T10:00:00.000Z',
      '2024-01-02T10:00:00.000Z',
    ]);
  });

  it('list 按 operated_to 闭区间过滤（含边界）', () => {
    const repo = new AuditLogRepository();
    repo.insert(makeLog(1, { operated_at: '2024-01-01T10:00:00.000Z' }));
    repo.insert(makeLog(2, { operated_at: '2024-01-02T10:00:00.000Z' }));
    repo.insert(makeLog(3, { operated_at: '2024-01-03T10:00:00.000Z' }));
    const result = repo.list({
      page: 1,
      pageSize: 20,
      operated_to: '2024-01-02T10:00:00.000Z',
    });
    expect(result.total).toBe(2);
    expect(result.items.map((l: AuditLog) => l.operated_at)).toEqual([
      '2024-01-02T10:00:00.000Z',
      '2024-01-01T10:00:00.000Z',
    ]);
  });

  it('list 按 operator_id 过滤', () => {
    const repo = new AuditLogRepository();
    const otherOp = '00000000-0000-4000-8000-000000000050';
    repo.insert(makeLog(1, { operator_id: ADMIN_ID }));
    repo.insert(makeLog(2, { operator_id: otherOp }));
    repo.insert(makeLog(3, { operator_id: ADMIN_ID }));
    const result = repo.list({ page: 1, pageSize: 20, operator_id: ADMIN_ID });
    expect(result.total).toBe(2);
    for (const l of result.items) {
      expect(l.operator_id).toBe(ADMIN_ID);
    }
  });

  it('list 按 entity_type 过滤', () => {
    const repo = new AuditLogRepository();
    repo.insert(makeLog(1, { entity_type: 'user' }));
    repo.insert(makeLog(2, { entity_type: 'role' }));
    repo.insert(makeLog(3, { entity_type: 'dept' }));
    repo.insert(makeLog(4, { entity_type: 'user' }));
    const result = repo.list({ page: 1, pageSize: 20, entity_type: 'user' });
    expect(result.total).toBe(2);
    for (const l of result.items) {
      expect(l.entity_type).toBe('user');
    }
  });

  it('list 分页切片：25 条 page=2 pageSize=10 → 10 条 + total=25', () => {
    const repo = new AuditLogRepository();
    for (let i = 1; i <= 25; i++) {
      repo.insert(
        makeLog(i, { operated_at: `2024-01-${String(i).padStart(2, '0')}T10:00:00.000Z` }),
      );
    }
    const result = repo.list({ page: 2, pageSize: 10 });
    expect(result.total).toBe(25);
    expect(result.items).toHaveLength(10);
  });

  it('append-only：repository 不暴露 update 方法（编译期保障）', () => {
    const repo = new AuditLogRepository();
    expect((repo as unknown as { update?: unknown }).update).toBeUndefined();
  });

  it('append-only：repository 不暴露 delete 方法（编译期保障）', () => {
    const repo = new AuditLogRepository();
    expect((repo as unknown as { delete?: unknown }).delete).toBeUndefined();
  });

  it('append-only：重复 insert 相同记录允许（不去重，视为追加）', () => {
    const repo = new AuditLogRepository();
    const log = makeLog(10);
    repo.insert(log);
    expect(() => repo.insert(log)).not.toThrow();
    expect(repo.list({ page: 1, pageSize: 20 }).total).toBe(2);
  });
});

describe('单测 · service 裁决', () => {
  it('list 空库返回 items=[]/total=0/totalPages=0（不触发 B4 AUDIT_LOG_NOT_FOUND）', async () => {
    const { service } = setup();
    const result = await service.list({}, adminCtx);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it('list 默认参数（空对象）：page=1 pageSize=20', async () => {
    const { service } = setup();
    const result = await service.list({}, adminCtx);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('list pageSize=200 经 schema transform 钳制为 100（返回 pageSize=100 提示）', async () => {
    const { service } = setup();
    const result = await service.list({ pageSize: 200 }, adminCtx);
    expect(result.pageSize).toBe(100);
  });

  it('list 入口对非 admin 抛 FORBIDDEN（admin 桩下统一为 requireAdmin）', async () => {
    const { service } = setup();
    await expectAppError(service.list({}, userCtx), 'FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// 2. 契约测 · 出参 schema 匹配 + 入参 safeParse + redactedEmailSchema 校验
// ---------------------------------------------------------------------------
describe('契约测 · 出参 schema 匹配', () => {
  it('list 返回匹配 auditLogListResultSchema（.strict 拒绝多余字段）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1));
    const result = await service.list({}, adminCtx);
    expect(() => auditLogListResultSchema.parse(result)).not.toThrow();
  });

  it('list 返回的 items 元素匹配 redactedAuditLogSchema（脱敏态）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1));
    const result = await service.list({}, adminCtx);
    expect(result.items).toHaveLength(1);
    expect(() => redactedAuditLogSchema.parse(result.items[0])).not.toThrow();
  });

  it('auditLogListResultSchema.strict：多余字段被拒绝', () => {
    expect(
      auditLogListResultSchema.safeParse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it('auditLogSchema：合法存储态样本通过（before=[]/after=ChangeField[]，D5 改型）', () => {
    const sample = {
      id: '30000000-0000-4000-8000-000000000001',
      operator_id: ADMIN_ID,
      operator_name: 'admin',
      entity_type: 'user',
      entity_id: '00000000-0000-4000-8000-000000000002',
      action: 'create',
      operated_at: '2024-01-01T10:00:00.000Z',
      before: [],
      after: [{ field: 'email', value: 'abcdef@example.com', pii: true }],
      created_at: SEED_TS,
    };
    expect(auditLogSchema.safeParse(sample).success).toBe(true);
  });

  it('auditLogSchema.strict：多余字段被拒绝', () => {
    const sample = {
      id: '30000000-0000-4000-8000-000000000001',
      operator_id: ADMIN_ID,
      operator_name: 'admin',
      entity_type: 'user',
      entity_id: '00000000-0000-4000-8000-000000000002',
      action: 'create',
      operated_at: '2024-01-01T10:00:00.000Z',
      before: [],
      after: [{ field: 'email', value: 'ab***@example.com', pii: true }],
      created_at: SEED_TS,
      secret: 'leak',
    };
    expect(auditLogSchema.safeParse(sample).success).toBe(false);
  });

  it('redactedEmailSchema：ab***@example.com 通过', () => {
    expect(redactedEmailSchema.safeParse('ab***@example.com').success).toBe(true);
  });

  it('redactedEmailSchema：未脱敏 abcdef@example.com 拒绝（防漂移）', () => {
    expect(redactedEmailSchema.safeParse('abcdef@example.com').success).toBe(false);
  });

  it('redactedEmailSchema：a***@x.com 拒绝（local 部分不足 2 字符，前缀不符正则）', () => {
    expect(redactedEmailSchema.safeParse('a***@x.com').success).toBe(false);
  });

  it('list 返回的 after 中 email 项 value 可被 redactedEmailSchema 解析（脱敏闭环，ChangeField[] 访问）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(
      makeLog(1, {
        after: markPii('user', [
          { field: 'email', value: 'abcdef@example.com', pii: false },
          { field: 'name', value: 'u1', pii: false },
        ]),
      }),
    );
    const result = await service.list({}, adminCtx);
    const email = fieldValue(result.items[0]!.after, 'email') as string;
    expect(redactedEmailSchema.safeParse(email).success).toBe(true);
    expect(email).toBe('ab***@example.com');
  });
});

describe('契约测 · 入参 safeParse 合法/非法样本', () => {
  it('listAuditLogQuerySchema: page=0 非法（min 1）', () => {
    expect(listAuditLogQuerySchema.safeParse({ page: 0, pageSize: 10 }).success).toBe(false);
  });

  it('listAuditLogQuerySchema: pageSize=0 非法（min 1）', () => {
    expect(listAuditLogQuerySchema.safeParse({ page: 1, pageSize: 0 }).success).toBe(false);
  });

  it('listAuditLogQuerySchema: pageSize=200 通过（transform 钳制为 100，非拒绝）', () => {
    const r = listAuditLogQuerySchema.safeParse({ page: 1, pageSize: 200 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.pageSize).toBe(100);
    }
  });

  it('listAuditLogQuerySchema: operated_from 非 datetime 非法', () => {
    expect(listAuditLogQuerySchema.safeParse({ operated_from: '2024-01-01' }).success).toBe(false);
  });

  it('listAuditLogQuerySchema: operated_to 非 datetime 非法', () => {
    expect(listAuditLogQuerySchema.safeParse({ operated_to: 'not-a-date' }).success).toBe(false);
  });

  it('listAuditLogQuerySchema: operator_id 非 uuid 非法', () => {
    expect(listAuditLogQuerySchema.safeParse({ operator_id: 'not-uuid' }).success).toBe(false);
  });

  it('listAuditLogQuerySchema: entity_type 非 user/role/dept 非法', () => {
    expect(listAuditLogQuerySchema.safeParse({ entity_type: 'unknown' }).success).toBe(false);
  });

  it('listAuditLogQuerySchema: entity_type 合法值通过（SSOT 派生遍历，AI-005）', () => {
    for (const t of auditLogEntityTypeSchema.options) {
      expect(listAuditLogQuerySchema.safeParse({ entity_type: t }).success).toBe(true);
    }
  });

  it('listAuditLogQuerySchema: 空对象合法（走默认值 page=1 pageSize=20）', () => {
    const r = listAuditLogQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.pageSize).toBe(20);
    }
  });

  it('listAuditLogQuerySchema: 合法样本（含全部过滤维度）通过', () => {
    expect(
      listAuditLogQuerySchema.safeParse({
        page: 2,
        pageSize: 50,
        operated_from: '2024-01-01T00:00:00.000Z',
        operated_to: '2024-12-31T23:59:59.000Z',
        operator_id: ADMIN_ID,
        entity_type: 'user',
      }).success,
    ).toBe(true);
  });

  it('auditLogActionSchema.safeParse: 各动作均通过（SSOT 派生遍历，AI-005）', () => {
    for (const a of auditLogActionSchema.options) {
      expect(auditLogActionSchema.safeParse(a).success).toBe(true);
    }
  });

  it('auditLogActionSchema.safeParse: 非法动作 "audit" 拒绝', () => {
    expect(auditLogActionSchema.safeParse('audit').success).toBe(false);
  });

  it('auditLogEntityTypeSchema.safeParse: 各实体类型均通过（SSOT 派生遍历，AI-005）', () => {
    for (const t of auditLogEntityTypeSchema.options) {
      expect(auditLogEntityTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it('auditLogEntityTypeSchema.safeParse: 非法实体类型 "audit" 拒绝', () => {
    expect(auditLogEntityTypeSchema.safeParse('audit').success).toBe(false);
  });

  it('permissionCodeSchema.options 含 audit:read（SSOT 派生，AI-005）', () => {
    expect([...permissionCodeSchema.options]).toContain('audit:read');
  });
});

// ---------------------------------------------------------------------------
// 3. 边界 · F1 旁路写入 / F2 列表查询 / F3 PII 脱敏 / F4 append-only
// ---------------------------------------------------------------------------
describe('边界 · F1 写操作旁路生成日志（service.record）', () => {
  it('F1: record 写入 create 日志 → 返回存储态 AuditLog（before=[]/after 含原邮箱，未脱敏）', async () => {
    const { service } = setup();
    const log = await service.record(
      {
        operator_id: ADMIN_ID,
        operator_name: 'admin',
        entity_type: 'user' as const,
        entity_id: '00000000-0000-4000-8000-000000000002',
        action: 'create' as const,
        operated_at: '2024-01-01T10:00:00.000Z',
        before: [],
        after: markPii('user', [
          { field: 'email', value: 'abcdef@example.com', pii: false },
          { field: 'name', value: 'u1', pii: false },
        ]),
      },
      adminCtx,
    );
    expect(log.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(log.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(log.operator_id).toBe(ADMIN_ID);
    expect(log.action).toBe('create');
    expect(log.entity_type).toBe('user');
    expect(log.before).toEqual([]);
    expect(fieldValue(log.after, 'email')).toBe('abcdef@example.com');
  });

  it('F1: record 后 list 查回 → after.email 项已脱敏（ab***@example.com）', async () => {
    const { service } = setup();
    await service.record(
      {
        operator_id: ADMIN_ID,
        operator_name: 'admin',
        entity_type: 'user' as const,
        entity_id: '00000000-0000-4000-8000-000000000002',
        action: 'create' as const,
        operated_at: '2024-01-01T10:00:00.000Z',
        before: [],
        after: markPii('user', [
          { field: 'email', value: 'abcdef@example.com', pii: false },
          { field: 'name', value: 'u1', pii: false },
        ]),
      },
      adminCtx,
    );
    const result = await service.list({}, adminCtx);
    expect(result.total).toBe(1);
    expect(result.items[0]!.action).toBe('create');
    expect(result.items[0]!.before).toEqual([]);
    expect(fieldValue(result.items[0]!.after, 'email')).toBe('ab***@example.com');
  });

  it('F1: record 写入 delete 日志 → before 含原值，after=[]', async () => {
    const { service } = setup();
    await service.record(
      {
        operator_id: ADMIN_ID,
        operator_name: 'admin',
        entity_type: 'role' as const,
        entity_id: '00000000-0000-4000-8000-000000000002',
        action: 'delete' as const,
        operated_at: '2024-01-01T10:00:00.000Z',
        before: [{ field: 'name', value: 'role-x', pii: false }],
        after: [],
      },
      adminCtx,
    );
    const result = await service.list({}, adminCtx);
    expect(result.items[0]!.action).toBe('delete');
    expect(result.items[0]!.entity_type).toBe('role');
    expect(result.items[0]!.after).toEqual([]);
    expect(fieldValue(result.items[0]!.before, 'name')).toBe('role-x');
  });

  it('F1 旁路闭环：多次 record → 多条日志按 operated_at 倒序可查', async () => {
    const { service } = setup();
    await service.record(
      {
        operator_id: ADMIN_ID,
        operator_name: 'admin',
        entity_type: 'user' as const,
        entity_id: '00000000-0000-4000-8000-000000000002',
        action: 'create' as const,
        operated_at: '2024-01-01T10:00:00.000Z',
        before: [],
        after: [{ field: 'name', value: 'u1', pii: false }],
      },
      adminCtx,
    );
    await service.record(
      {
        operator_id: ADMIN_ID,
        operator_name: 'admin',
        entity_type: 'user' as const,
        entity_id: '00000000-0000-4000-8000-000000000003',
        action: 'create' as const,
        operated_at: '2024-01-05T10:00:00.000Z',
        before: [],
        after: [{ field: 'name', value: 'u2', pii: false }],
      },
      adminCtx,
    );
    const result = await service.list({}, adminCtx);
    expect(result.total).toBe(2);
    expect(result.items[0]!.operated_at).toBe('2024-01-05T10:00:00.000Z');
    expect(result.items[1]!.operated_at).toBe('2024-01-01T10:00:00.000Z');
  });
});

describe('边界 · F2 列表查询', () => {
  it('F2: 25 条日志 page=2 pageSize=10 → 第 11-20 条 + total=25 + totalPages=3 + 按 operated_at 倒序', async () => {
    const { service, auditRepo } = setup();
    for (let i = 1; i <= 25; i++) {
      auditRepo.insert(
        makeLog(i, { operated_at: `2024-01-${String(i).padStart(2, '0')}T10:00:00.000Z` }),
      );
    }
    const result = await service.list({ page: 2, pageSize: 10 }, adminCtx);
    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(result.items).toHaveLength(10);
    expect(result.items[0]!.operated_at).toBe('2024-01-15T10:00:00.000Z');
    expect(result.items[9]!.operated_at).toBe('2024-01-06T10:00:00.000Z');
  });

  it('F2: 按时间范围过滤 → 仅返回区间内', async () => {
    const { service, auditRepo } = setup();
    for (let i = 1; i <= 10; i++) {
      auditRepo.insert(
        makeLog(i, { operated_at: `2024-01-${String(i).padStart(2, '0')}T10:00:00.000Z` }),
      );
    }
    const result = await service.list(
      {
        operated_from: '2024-01-03T00:00:00.000Z',
        operated_to: '2024-01-07T23:59:59.000Z',
      },
      adminCtx,
    );
    expect(result.total).toBe(5);
    for (const l of result.items) {
      expect(l.operated_at >= '2024-01-03T00:00:00.000Z').toBe(true);
      expect(l.operated_at <= '2024-01-07T23:59:59.000Z').toBe(true);
    }
  });

  it('F2: 按 operator_id 过滤 → 仅返回该操作者', async () => {
    const { service, auditRepo } = setup();
    const otherOp = '00000000-0000-4000-8000-000000000050';
    auditRepo.insert(makeLog(1, { operator_id: ADMIN_ID }));
    auditRepo.insert(makeLog(2, { operator_id: otherOp }));
    auditRepo.insert(makeLog(3, { operator_id: ADMIN_ID }));
    const result = await service.list({ operator_id: ADMIN_ID }, adminCtx);
    expect(result.total).toBe(2);
    for (const l of result.items) {
      expect(l.operator_id).toBe(ADMIN_ID);
    }
  });

  it('F2: 按 entity_type=user 过滤 → 仅返回 user', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(makeLog(1, { entity_type: 'user' }));
    auditRepo.insert(makeLog(2, { entity_type: 'role' }));
    auditRepo.insert(makeLog(3, { entity_type: 'user' }));
    const result = await service.list({ entity_type: 'user' }, adminCtx);
    expect(result.total).toBe(2);
    for (const l of result.items) {
      expect(l.entity_type).toBe('user');
    }
  });

  it('F2: 无过滤 → 全量第 1 页默认 pageSize=20', async () => {
    const { service, auditRepo } = setup();
    for (let i = 1; i <= 25; i++) {
      auditRepo.insert(makeLog(i));
    }
    const result = await service.list({}, adminCtx);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.items).toHaveLength(20);
    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(2);
  });

  it('F2: pageSize=200 → 钳制为 100 返回', async () => {
    const { service, auditRepo } = setup();
    for (let i = 1; i <= 5; i++) auditRepo.insert(makeLog(i));
    const result = await service.list({ pageSize: 200 }, adminCtx);
    expect(result.pageSize).toBe(100);
  });

  it('F2: 空库 → items=[] + total=0 + totalPages=0（不触发 B4 AUDIT_LOG_NOT_FOUND）', async () => {
    const { service } = setup();
    const result = await service.list({}, adminCtx);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });
});

describe('边界 · F3 PII 脱敏', () => {
  it('F3: after email 项（pii=true）含 abcdef@example.com → 返回 ab***@example.com', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(
      makeLog(1, {
        after: markPii('user', [
          { field: 'email', value: 'abcdef@example.com', pii: false },
          { field: 'name', value: 'u1', pii: false },
        ]),
      }),
    );
    const result = await service.list({}, adminCtx);
    expect(fieldValue(result.items[0]!.after, 'email')).toBe('ab***@example.com');
  });

  it('F3: before email 项（pii=true）含原邮箱 → 同样脱敏', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(
      makeLog(1, {
        before: markPii('user', [
          { field: 'email', value: 'abcdef@example.com', pii: false },
          { field: 'name', value: 'old', pii: false },
        ]),
        after: markPii('user', [
          { field: 'email', value: 'new@example.com', pii: false },
          { field: 'name', value: 'new', pii: false },
        ]),
        action: 'update',
      }),
    );
    const result = await service.list({}, adminCtx);
    expect(fieldValue(result.items[0]!.before, 'email')).toBe('ab***@example.com');
    expect(fieldValue(result.items[0]!.after, 'email')).toBe('ne***@example.com');
  });

  it('F3: 非邮箱字段（name/status，pii=false）原样返回', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(
      makeLog(1, {
        after: markPii('user', [
          { field: 'email', value: 'abcdef@example.com', pii: false },
          { field: 'name', value: 'u1', pii: false },
          { field: 'status', value: 'active', pii: false },
        ]),
      }),
    );
    const result = await service.list({}, adminCtx);
    expect(fieldValue(result.items[0]!.after, 'name')).toBe('u1');
    expect(fieldValue(result.items[0]!.after, 'status')).toBe('active');
  });

  it('F3: 多条日志 email 项均脱敏无遗漏（SEC-003b 批量闭环）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(
      makeLog(1, { after: markPii('user', [{ field: 'email', value: 'a1@example.com', pii: false }]) }),
    );
    auditRepo.insert(
      makeLog(2, { after: markPii('user', [{ field: 'email', value: 'a2@example.com', pii: false }]) }),
    );
    auditRepo.insert(
      makeLog(3, { after: markPii('user', [{ field: 'email', value: 'a3@example.com', pii: false }]) }),
    );
    const result = await service.list({}, adminCtx);
    expect(result.items).toHaveLength(3);
    for (const l of result.items) {
      const email = fieldValue(l.after, 'email') as string;
      expect(email).toMatch(/^.{2}\*\*\*@[^\s@]+$/);
    }
  });

  it('F3: 未标记 pii 但值像邮箱的字段原样返回（D7 移除正则兜底，信任标记）', async () => {
    const { service, auditRepo } = setup();
    // 注入一条 entity_type='role' 的日志，note 字段值像邮箱但 pii=false（role 本期无 PII）
    auditRepo.insert(
      makeLog(1, {
        entity_type: 'role',
        action: 'update',
        before: [],
        after: [
          { field: 'note', value: 'looks-like-email@example.com', pii: false },
          { field: 'name', value: 'role-x', pii: false },
        ],
      }),
    );
    const result = await service.list({}, adminCtx);
    // note 未标记 pii，即使值像邮箱也原样返回（无运行时正则兜底）
    expect(fieldValue(result.items[0]!.after, 'note')).toBe('looks-like-email@example.com');
  });
});

describe('边界 · F4 append-only', () => {
  it('F4: repository 不暴露 update 方法（编译期保障）', () => {
    const repo = new AuditLogRepository();
    expect((repo as unknown as { update?: unknown }).update).toBeUndefined();
  });

  it('F4: repository 不暴露 delete 方法（编译期保障）', () => {
    const repo = new AuditLogRepository();
    expect((repo as unknown as { delete?: unknown }).delete).toBeUndefined();
  });

  it('F4: router 不注册 update/delete/patch procedure（无 PUT/PATCH/DELETE /v1/audit-logs）', () => {
    const { router } = setup();
    expect((router as unknown as { update?: unknown }).update).toBeUndefined();
    expect((router as unknown as { delete?: unknown }).delete).toBeUndefined();
    expect((router as unknown as { patch?: unknown }).patch).toBeUndefined();
  });

  it('F4: 重复 insert 相同记录允许（append-only 不去重）', () => {
    const repo = new AuditLogRepository();
    const log = makeLog(99);
    repo.insert(log);
    expect(() => repo.insert(log)).not.toThrow();
    expect(repo.list({ page: 1, pageSize: 20 }).total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. 权限 · SEC-002 非 admin 拒绝 / SEC-003 出参不夹带 PII / SEC-001 元数据
// ---------------------------------------------------------------------------
describe('权限 · SEC-002 非 admin 调 list → FORBIDDEN', () => {
  it('router.list 由非 admin（role=user）调用 → 抛 FORBIDDEN（service 层 requireAdmin）', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.list, {}, userCtx), 'FORBIDDEN');
  });

  it('router.list 由非 admin 调用：即使库非空也先抛 FORBIDDEN（鉴权先于数据返回）', async () => {
    const { router, auditRepo } = setup();
    auditRepo.insert(makeLog(1));
    await expectAppError(callProc(router.list, { page: 1, pageSize: 10 }, userCtx), 'FORBIDDEN');
  });

  it('service.list 由非 admin 调用 → 抛 FORBIDDEN（与 router 行为一致）', async () => {
    const { service } = setup();
    await expectAppError(service.list({}, userCtx), 'FORBIDDEN');
  });

  it('admin 调 list 正常返回（admin 桩下视为具备 audit:read，放行）', async () => {
    const { router } = setup();
    const result = await callProc<ListAuditLogQuery, AuditLogListResult>(router.list, {}, adminCtx);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('权限 · SEC-003 出参不夹带 PII', () => {
  it('SEC-003a：list 出参匹配 auditLogListResultSchema.strict（无未声明的多余字段）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(
      makeLog(1, {
        after: markPii('user', [
          { field: 'email', value: 'abcdef@example.com', pii: false },
          { field: 'name', value: 'u1', pii: false },
        ]),
      }),
    );
    const result = await service.list({}, adminCtx);
    expect(() => auditLogListResultSchema.parse(result)).not.toThrow();
  });

  it('SEC-003b：list 出参 items 的 after 中 email 项已脱敏，未暴露原值 abcdef@example.com', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(
      makeLog(1, {
        after: markPii('user', [
          { field: 'email', value: 'abcdef@example.com', pii: false },
          { field: 'name', value: 'u1', pii: false },
        ]),
      }),
    );
    const result = await service.list({}, adminCtx);
    const email = fieldValue(result.items[0]!.after, 'email') as string;
    expect(email).toBe('ab***@example.com');
    expect(email).not.toBe('abcdef@example.com');
    expect(redactedEmailSchema.safeParse(email).success).toBe(true);
  });

  it('SEC-003b：before 中原邮箱同样脱敏（update 场景前后双脱敏）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(
      makeLog(1, {
        action: 'update',
        before: markPii('user', [{ field: 'email', value: 'old@example.com', pii: false }]),
        after: markPii('user', [{ field: 'email', value: 'new@example.com', pii: false }]),
      }),
    );
    const result = await service.list({}, adminCtx);
    expect(fieldValue(result.items[0]!.before, 'email')).toBe('ol***@example.com');
    expect(fieldValue(result.items[0]!.after, 'email')).toBe('ne***@example.com');
  });

  it('SEC-003b：非邮箱字段（name/status，pii=false）不脱敏，原样返回（避免误伤）', async () => {
    const { service, auditRepo } = setup();
    auditRepo.insert(
      makeLog(1, {
        after: markPii('user', [
          { field: 'email', value: 'abcdef@example.com', pii: false },
          { field: 'name', value: 'u1', pii: false },
          { field: 'status', value: 'active', pii: false },
        ]),
      }),
    );
    const result = await service.list({}, adminCtx);
    expect(fieldValue(result.items[0]!.after, 'name')).toBe('u1');
    expect(fieldValue(result.items[0]!.after, 'status')).toBe('active');
  });
});

describe('权限 · SEC-001 procedure 元数据声明', () => {
  it('router.list 声明 auth: "admin"（受保护入口）', () => {
    const { router } = setup();
    expect(router.list.auth).toBe('admin');
  });

  it('router.list 声明 permission: "audit:read"（SEC-001 元数据，AuditProcedure 形状）', () => {
    const { router } = setup();
    const listProc = router.list as AuditProcedure<unknown, unknown>;
    expect(listProc.permission).toBe('audit:read');
  });

  it('router 仅暴露 list procedure，不注册 update/delete/patch（无 PUT/PATCH/DELETE 路由）', () => {
    const { router } = setup();
    expect((router as unknown as { update?: unknown }).update).toBeUndefined();
    expect((router as unknown as { delete?: unknown }).delete).toBeUndefined();
    expect((router as unknown as { patch?: unknown }).patch).toBeUndefined();
    expect((router as unknown as { create?: unknown }).create).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. 状态机 · append-only 不可变 + list 守卫序列顺序 B1→B2/B3 + F1 旁路闭环
// ---------------------------------------------------------------------------
describe('状态机 · append-only 不可变（无修改/删除路径）', () => {
  it('repository 不暴露 update 方法（编译期保障，无路径可修改日志）', () => {
    const repo = new AuditLogRepository();
    expect((repo as unknown as { update?: unknown }).update).toBeUndefined();
  });

  it('repository 不暴露 delete 方法（编译期保障，无路径可删除日志）', () => {
    const repo = new AuditLogRepository();
    expect((repo as unknown as { delete?: unknown }).delete).toBeUndefined();
  });

  it('service 不暴露 update/delete 方法（业务层无修改/删除入口）', () => {
    const { service } = setup();
    expect((service as unknown as { update?: unknown }).update).toBeUndefined();
    expect((service as unknown as { delete?: unknown }).delete).toBeUndefined();
  });

  it('router 不注册 update/delete/patch/create procedure（HTTP 层无修改/删除/创建路由）', () => {
    const { router } = setup();
    expect((router as unknown as { update?: unknown }).update).toBeUndefined();
    expect((router as unknown as { delete?: unknown }).delete).toBeUndefined();
    expect((router as unknown as { patch?: unknown }).patch).toBeUndefined();
  });

  it('append-only 闭环：insert 后再 insert 同记录 → 追加为 2 条（不覆盖、不去重、不报错）', () => {
    const repo = new AuditLogRepository();
    const log = makeLog(7);
    repo.insert(log);
    repo.insert(log);
    expect(repo.list({ page: 1, pageSize: 20 }).total).toBe(2);
  });
});

describe('状态机 · list 守卫序列顺序 B1→B2/B3（先到先返）', () => {
  it('B1 先于 B3：入参非法（page=0）+ 非 admin → 抛 VALIDATION_ERROR（校验先于鉴权）', async () => {
    const { router } = setup();
    // callProc 内 safeParse 先行：page=0 不通过 → VALIDATION_ERROR，handler 不执行故不到 B3
    await expectAppError(callProc(router.list, { page: 0, pageSize: 10 }, userCtx), 'VALIDATION_ERROR');
  });

  it('B1 先于 B3：入参非法（entity_type=unknown）+ 非 admin → 抛 VALIDATION_ERROR', async () => {
    const { router } = setup();
    await expectAppError(
      callProc(router.list, { entity_type: 'unknown' }, userCtx),
      'VALIDATION_ERROR',
    );
  });

  it('B3 在 B1 通过后触发：入参合法 + 非 admin → 抛 FORBIDDEN（鉴权在 Zod 校验之后）', async () => {
    const { router } = setup();
    await expectAppError(callProc(router.list, { page: 1, pageSize: 10 }, userCtx), 'FORBIDDEN');
  });

  it('B1→B3→数据：入参合法 + admin → 正常返回（鉴权通过后进入过滤/分页/脱敏）', async () => {
    const { router, auditRepo } = setup();
    auditRepo.insert(makeLog(1));
    const result = await callProc<ListAuditLogQuery, AuditLogListResult>(
      router.list,
      { page: 1, pageSize: 10 },
      adminCtx,
    );
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it('空结果不触发 B4：B1→B3 通过 + 库空 → items=[]/total=0（无 AUDIT_LOG_NOT_FOUND 路径）', async () => {
    const { router } = setup();
    const result = await callProc<ListAuditLogQuery, AuditLogListResult>(router.list, {}, adminCtx);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });
});

describe('状态机 · F1 旁路闭环（主操作成功 → 日志写入）', () => {
  it('F1 闭环：record(create) 成功 → list 可查回该日志（写入→只读查询闭环）', async () => {
    const { service } = setup();
    await service.record(
      {
        operator_id: ADMIN_ID,
        operator_name: 'admin',
        entity_type: 'user' as const,
        entity_id: '00000000-0000-4000-8000-000000000002',
        action: 'create' as const,
        operated_at: '2024-01-01T10:00:00.000Z',
        before: [],
        after: markPii('user', [
          { field: 'email', value: 'abcdef@example.com', pii: false },
          { field: 'name', value: 'u1', pii: false },
        ]),
      },
      adminCtx,
    );
    const result = await service.list({}, adminCtx);
    expect(result.total).toBe(1);
    expect(result.items[0]!.action).toBe('create');
    expect(result.items[0]!.entity_type).toBe('user');
  });

  it('F1 闭环：record(create) 存原邮箱 → list 返回脱敏邮箱（存储原值/查询脱敏分离闭环）', async () => {
    const { service, auditRepo } = setup();
    await service.record(
      {
        operator_id: ADMIN_ID,
        operator_name: 'admin',
        entity_type: 'user' as const,
        entity_id: '00000000-0000-4000-8000-000000000002',
        action: 'create' as const,
        operated_at: '2024-01-01T10:00:00.000Z',
        before: [],
        after: markPii('user', [{ field: 'email', value: 'abcdef@example.com', pii: false }]),
      },
      adminCtx,
    );
    // 存储态保留原值（record 返回值含原邮箱）
    const stored = auditRepo.list({ page: 1, pageSize: 20 }).items[0]!;
    expect(fieldValue(stored.after, 'email')).toBe('abcdef@example.com');
    // 查询态脱敏（list 返回值邮箱已脱敏）
    const result = await service.list({}, adminCtx);
    expect(fieldValue(result.items[0]!.after, 'email')).toBe('ab***@example.com');
  });

  it('F1 闭环：多次 record → 多条日志按 operated_at 倒序可查（写入顺序与查询顺序解耦）', async () => {
    const { service } = setup();
    for (let i = 1; i <= 3; i++) {
      await service.record(
        {
          operator_id: ADMIN_ID,
          operator_name: 'admin',
          entity_type: 'user' as const,
          entity_id: `00000000-0000-4000-8000-${String(i + 1000).padStart(12, '0')}`,
          action: 'create' as const,
          operated_at: `2024-01-0${i}T10:00:00.000Z`,
          before: [],
          after: [{ field: 'name', value: `u${i}`, pii: false }],
        },
        adminCtx,
      );
    }
    const result = await service.list({}, adminCtx);
    expect(result.total).toBe(3);
    expect(result.items[0]!.operated_at).toBe('2024-01-03T10:00:00.000Z');
    expect(result.items[1]!.operated_at).toBe('2024-01-02T10:00:00.000Z');
    expect(result.items[2]!.operated_at).toBe('2024-01-01T10:00:00.000Z');
  });

  it('F1 闭环：record 写入 delete 日志 → before 含原值快照、after=[]（delete 动作快照约定）', async () => {
    const { service } = setup();
    await service.record(
      {
        operator_id: ADMIN_ID,
        operator_name: 'admin',
        entity_type: 'role' as const,
        entity_id: '00000000-0000-4000-8000-000000000002',
        action: 'delete' as const,
        operated_at: '2024-01-01T10:00:00.000Z',
        before: [
          { field: 'name', value: 'role-x', pii: false },
          { field: 'permission_codes', value: ['user:read'], pii: false },
        ],
        after: [],
      },
      adminCtx,
    );
    const result = await service.list({}, adminCtx);
    expect(result.items[0]!.action).toBe('delete');
    expect(result.items[0]!.after).toEqual([]);
    expect(fieldValue(result.items[0]!.before, 'name')).toBe('role-x');
  });
});
